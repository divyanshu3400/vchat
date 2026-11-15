from channels.db import database_sync_to_async

from apps.chat import presence
from apps.chat import services as chat_services
from apps.chat.realtime import user_group
from apps.calls.consumer import CallMixin
from apps.chat.ws_auth import AuthenticatedJsonConsumer
from apps.stranger.consumer import StrangerMixin

from . import services
from .services import SocialError


class UserConsumer(CallMixin, StrangerMixin, AuthenticatedJsonConsumer):
    """The personal socket (/ws/me/): one per open tab, carries everything private to a user.

    client -> {"type": "dm", "to": <user id>, "content": "...", "client_id": "..."}
    server -> {"type": "dm", "message": {...}, "client_id": "..."}      to both people
    server -> {"type": "friend_request" | "friend_added" | "friend_removed" | "friend_request_removed", ...}
    Random 1-on-1 chat ("stranger.*") is documented in apps/stranger/consumer.py,
    calls ("call.*") in apps/calls/consumer.py.
    """

    async def on_authenticated(self):
        await self.channel_layer.group_add(user_group(self.user.id), self.channel_name)
        await self.send_json({"type": "ready", "user": services.brief(self.user)})
        came_online = await database_sync_to_async(presence.connect_user)(self.user.id, self.channel_name)
        if came_online:
            await self._announce(online=True)

    async def on_leave(self):
        await self.call_disconnect()
        await self.stranger_disconnect()
        await self.channel_layer.group_discard(user_group(self.user.id), self.channel_name)
        went_offline = await database_sync_to_async(presence.disconnect_user)(self.user.id, self.channel_name)
        if went_offline:
            await self._announce(online=False)

    async def on_ping(self):
        await database_sync_to_async(presence.ping_user)(self.user.id, self.channel_name)
        await self.stranger_heartbeat()

    async def _announce(self, online: bool):
        """Tell this user's friends they came online or went offline (only on the first/last tab)."""
        friend_ids = await database_sync_to_async(services.friend_ids)(self.user.id)
        event = {"type": "user.event", "payload": {"type": "presence", "user_id": self.user.id, "online": online}}
        for fid in friend_ids:
            await self.channel_layer.group_send(user_group(fid), event)

    async def handle(self, kind, content):
        if isinstance(kind, str) and kind.startswith("stranger.") and await self.stranger_handle(kind, content):
            return
        if isinstance(kind, str) and kind.startswith("call.") and await self.call_handle(kind, content):
            return
        if kind != "dm":
            return await self.error("unknown_type", "Unknown message type.")
        client_id = str(content.get("client_id", ""))[:64]
        recipient_id = content.get("to")
        if not isinstance(recipient_id, int) or isinstance(recipient_id, bool):
            return await self.error("invalid", "Pick someone to message.", client_id)
        attachment_id = content.get("attachment") or None
        raw = content.get("content") or ""
        try:
            # With an attachment the text is an optional caption.
            text = chat_services.clean_content(raw) if (raw or not attachment_id) else ""
        except chat_services.InvalidMessage as exc:
            return await self.error("invalid_message", str(exc), client_id)

        if not await database_sync_to_async(chat_services.allow_message)(self.user.id):
            return await self.error("rate_limited", "You're sending messages too fast. Wait a moment.", client_id)

        try:
            payload = await database_sync_to_async(services.send_dm)(self.user, recipient_id, text, attachment_id)
        except SocialError as exc:
            return await self.error(exc.code, exc.detail, client_id)

        event = {"type": "user.event", "payload": {"type": "dm", "message": payload, "client_id": client_id}}
        for uid in {self.user.id, recipient_id}:
            await self.channel_layer.group_send(user_group(uid), event)

    async def user_event(self, event):
        await self.send_json(event["payload"])
