from channels.db import database_sync_to_async

from . import automod, message_ops, presence, services
from .models import Message, Room
from .realtime import control_group
from .ws_auth import AuthenticatedJsonConsumer


class RoomConsumer(AuthenticatedJsonConsumer):
    """One socket per open room.

    client -> {"type": "auth", "token": "..."}                       (see AuthenticatedJsonConsumer)
    server -> {"type": "ready", "room": "...", "user": {...}}
    client -> {"type": "message", "content": "...", "client_id": "...", "reply_to": <id>?}
    server -> {"type": "message", "message": {...}, "client_id": "..."}   broadcast to the room
    client -> {"type": "react", "message_id": <id>, "emoji": "❤️" | null}
    client -> {"type": "edit", "message_id": <id>, "content": "..."}     own messages, 15 min
    client -> {"type": "delete", "message_id": <id>}                     own messages, 1 hour
    server -> {"type": "message.update", "message": {...}}               broadcast after any of those
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
        if kind in ("react", "edit", "delete"):
            return await self._change(kind, content)
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
        muted = await database_sync_to_async(automod.check_room_message)(self.user.id, text)
        if muted:
            minutes = max(1, round(muted / 60))
            return await self.error(
                "muted",
                f"You're muted in rooms for {minutes} more minute{'s' if minutes != 1 else ''} for repeating messages or posting too many links.",
                client_id,
            )

        # Persist first, then broadcast: a message everyone saw is always in history.
        payload = await self._save_message(text, content.get("reply_to"))
        await self.channel_layer.group_send(
            self.group, {"type": "chat.message", "message": payload, "client_id": client_id}
        )

    async def _change(self, kind, content):
        if kind == "react" and not await database_sync_to_async(services.allow_message)(self.user.id):
            return await self.error("rate_limited", "Slow down a little.")
        try:
            payload = await self._apply(kind, content)
        except message_ops.MessageOpError as exc:
            return await self.error(exc.code, exc.detail)
        await self.channel_layer.group_send(self.group, {"type": "chat.update", "message": payload})

    async def chat_message(self, event):
        if event["message"]["sender"]["id"] in self.blocked:
            return
        await self.send_json({"type": "message", "message": event["message"], "client_id": event["client_id"]})

    async def chat_update(self, event):
        if event["message"]["sender"]["id"] in self.blocked:
            return
        await self.send_json({"type": "message.update", "message": event["message"]})

    async def control_event(self, event):
        # Someone blocked or unblocked this user (or the reverse): reload who is hidden.
        if event["payload"].get("type") == "blocks_changed":
            self.blocked = await database_sync_to_async(services.blocked_user_ids)(self.user.id)

    @database_sync_to_async
    def _get_room(self, slug):
        return Room.objects.filter(slug=slug, is_active=True).first()

    @database_sync_to_async
    def _save_message(self, text, reply_id):
        reply_to = message_ops.find_reply(Message, reply_id, room=self.room)
        message = Message.objects.create(room=self.room, sender=self.user, content=text, reply_to=reply_to)
        return services.message_payload(services.load_message(self.room, message.id))

    @database_sync_to_async
    def _apply(self, kind, content):
        message = services.load_message(self.room, content.get("message_id"))
        if message is None or message.sender_id in self.blocked:
            raise message_ops.MessageOpError("not_found", "That message is gone.")
        if kind == "react":
            message_ops.react(message, self.user, content.get("emoji"))
        elif kind == "edit":
            message_ops.edit(message, self.user, content.get("content"))
        else:
            message_ops.delete(message, self.user)
        return services.message_payload(services.load_message(self.room, message.id))
