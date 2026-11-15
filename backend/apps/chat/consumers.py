from channels.db import database_sync_to_async

from . import presence, services
from .models import Message, Room
from .realtime import control_group
from .ws_auth import AuthenticatedJsonConsumer


class RoomConsumer(AuthenticatedJsonConsumer):
    """One socket per open room.

    client -> {"type": "auth", "token": "..."}                       (see AuthenticatedJsonConsumer)
    server -> {"type": "ready", "room": "...", "user": {...}}
    client -> {"type": "message", "content": "...", "client_id": "..."}
    server -> {"type": "message", "message": {...}, "client_id": "..."}   broadcast to the room
    server -> {"type": "error", "code": "...", "detail": "..."}
    """

    async def can_connect(self) -> bool:
        self.blocked: set[int] = set()
        self.room = await self._get_room(self.scope["url_route"]["kwargs"]["slug"])
        if self.room is None:
            return False
        self.group = f"room.{self.room.id}"
        return True

    async def on_authenticated(self):
        self.blocked = await database_sync_to_async(services.blocked_user_ids)(self.user.id)
        await database_sync_to_async(presence.join_room)(self.room.id, self.user.id, self.channel_name)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.channel_layer.group_add(control_group(self.user.id), self.channel_name)
        await self.send_json(
            {
                "type": "ready",
                "room": self.room.slug,
                "user": {"id": self.user.id, "nickname": self.user.nickname, "gender": self.user.gender},
            }
        )

    async def on_leave(self):
        await database_sync_to_async(presence.leave_room)(self.room.id, self.user.id, self.channel_name)
        await self.channel_layer.group_discard(self.group, self.channel_name)
        await self.channel_layer.group_discard(control_group(self.user.id), self.channel_name)

    async def on_ping(self):
        await database_sync_to_async(presence.join_room)(self.room.id, self.user.id, self.channel_name)

    async def handle(self, kind, content):
        if kind != "message":
            return await self.error("unknown_type", "Unknown message type.")
        client_id = str(content.get("client_id", ""))[:64]
        try:
            text = services.clean_content(content.get("content"))
        except services.InvalidMessage as exc:
            return await self.error("invalid_message", str(exc), client_id)

        allowed = await database_sync_to_async(services.allow_message)(self.user.id, self.room)
        if not allowed:
            return await self.error("rate_limited", "You're sending messages too fast. Wait a moment.", client_id)

        # Persist first, then broadcast: a message everyone saw is always in history.
        payload = await self._save_message(text)
        await self.channel_layer.group_send(
            self.group, {"type": "chat.message", "message": payload, "client_id": client_id}
        )

    async def chat_message(self, event):
        if event["message"]["sender"]["id"] in self.blocked:
            return
        await self.send_json({"type": "message", "message": event["message"], "client_id": event["client_id"]})

    async def control_event(self, event):
        # Someone blocked or unblocked this user (or the reverse): reload who is hidden.
        if event["payload"].get("type") == "blocks_changed":
            self.blocked = await database_sync_to_async(services.blocked_user_ids)(self.user.id)

    @database_sync_to_async
    def _get_room(self, slug):
        return Room.objects.filter(slug=slug, is_active=True).first()

    @database_sync_to_async
    def _save_message(self, text):
        message = Message.objects.create(room=self.room, sender=self.user, content=text)
        return services.message_payload(message)
