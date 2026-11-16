from channels.db import database_sync_to_async
from django.core.cache import cache

from apps.chat import presence
from apps.chat import services as chat_services
from apps.chat.realtime import user_group
from apps.calls.consumer import CallMixin
from apps.chat.ws_auth import AuthenticatedJsonConsumer
from apps.stranger.consumer import StrangerMixin
from apps.push import events as push_events
from apps.watch.consumer import WatchMixin

from . import services
from .services import SocialError


class UserConsumer(WatchMixin, CallMixin, StrangerMixin, AuthenticatedJsonConsumer):
    """The personal socket (/ws/me/): one per open tab, carries everything private to a user.

    client -> {"type": "dm", "to": <user id>, "content": "...", "client_id": "..."}
    server -> {"type": "dm", "message": {...}, "client_id": "..."}      to both people
    server -> {"type": "friend_request" | "friend_added" | "friend_removed" | "friend_request_removed", ...}
    Random 1-on-1 chat ("stranger.*") is documented in apps/stranger/consumer.py,
    calls ("call.*") in apps/calls/consumer.py, watching together ("watch.*") in apps/watch/consumer.py.
    """

    async def on_authenticated(self):
        await self.channel_layer.group_add(user_group(self.user.id), self.channel_name)
        await self.send_json({"type": "ready", "user": services.brief(self.user)})
        came_online = await database_sync_to_async(presence.connect_user)(self.user.id, self.channel_name)
        await database_sync_to_async(services.touch_last_seen)(self.user.id)
        if came_online:
            await self._announce(online=True)

    async def on_leave(self):
        await database_sync_to_async(presence.set_visible)(self.user.id, self.channel_name, False)
        await self.call_disconnect()
        await self.stranger_disconnect()
        await self.channel_layer.group_discard(user_group(self.user.id), self.channel_name)
        went_offline = await database_sync_to_async(presence.disconnect_user)(self.user.id, self.channel_name)
        if went_offline:
            await self._announce(online=False)

    async def on_ping(self):
        await database_sync_to_async(presence.ping_user)(self.user.id, self.channel_name)
        # Last seen stays roughly right even if the server never sees the tab close.
        if await database_sync_to_async(cache.add)(f"lastseen:{self.user.id}", 1, 120):
            await database_sync_to_async(services.touch_last_seen)(self.user.id)
        if getattr(self, "_visible", False):
            await database_sync_to_async(presence.set_visible)(self.user.id, self.channel_name, True)
        await self.stranger_heartbeat()

    async def _announce(self, online: bool):
        """Tell this user's friends they came online or went offline (only on the first/last tab)."""
        events = await database_sync_to_async(services.presence_events)(self.user.id, online)
        for fid, payload in events:
            await self.channel_layer.group_send(user_group(fid), {"type": "user.event", "payload": payload})

    async def handle(self, kind, content):
        if isinstance(kind, str) and kind.startswith("stranger.") and await self.stranger_handle(kind, content):
            return
        if isinstance(kind, str) and kind.startswith("call.") and await self.call_handle(kind, content):
            return
        if isinstance(kind, str) and kind.startswith("watch.") and await self.watch_handle(kind, content):
            return
        if kind in ("dm.react", "dm.edit", "dm.delete"):
            return await self._dm_change(kind[3:], content)
        if kind == "dm.typing":
            return await self._dm_typing(content.get("to"))
        if kind == "dm.autodelete":
            # {"type": "dm.autodelete", "to": <friend id>, "days": 1 | 7 | 30 | 365}
            try:
                await database_sync_to_async(services.set_auto_delete)(self.user, content.get("to"), content.get("days"))
            except SocialError as exc:
                await self.error(exc.code, exc.detail)
            return
        if kind == "visible":
            # {"type": "visible", "visible": bool}: is this tab on screen? Notifications skip people who are looking.
            self._visible = content.get("visible") is True
            return await database_sync_to_async(presence.set_visible)(self.user.id, self.channel_name, self._visible)
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

        # The app re-sends unconfirmed messages after a reconnect. If this one was already saved
        # (its confirmation was lost with the old connection), confirm it again instead of saving twice.
        sent_key = f"dmsent:{self.user.id}:{client_id}" if client_id else ""
        if sent_key:
            already = await database_sync_to_async(cache.get)(sent_key)
            if already:
                return await self.send_json({"type": "dm", "message": already, "client_id": client_id})

        if not await database_sync_to_async(chat_services.allow_message)(self.user.id):
            return await self.error("rate_limited", "You're sending messages too fast. Wait a moment.", client_id)

        try:
            payload = await database_sync_to_async(services.send_dm)(
                self.user, recipient_id, text, attachment_id, content.get("reply_to")
            )
        except SocialError as exc:
            return await self.error(exc.code, exc.detail, client_id)
        if sent_key:
            await database_sync_to_async(cache.set)(sent_key, payload, 3600)

        event = {"type": "user.event", "payload": {"type": "dm", "message": payload, "client_id": client_id}}
        for uid in {self.user.id, recipient_id}:
            await self.channel_layer.group_send(user_group(uid), event)
        attachment = payload.get("attachment") or {}
        await database_sync_to_async(push_events.dm_received)(
            recipient_id, self.user.id, self.user.nickname, payload["content"], attachment.get("kind")
        )

    async def _dm_typing(self, to):
        """{"type": "dm.typing", "to": <friend id>} -> the friend gets {"type": "dm.typing", "user_id"}."""
        if not isinstance(to, int) or isinstance(to, bool) or to == self.user.id:
            return
        if not await database_sync_to_async(services.are_friends)(self.user.id, to):
            return
        # At most one every 2 s per sender, whatever the client does.
        if not await database_sync_to_async(cache.add)(f"dmtyping:{self.user.id}:{to}", 1, 2):
            return
        event = {"type": "user.event", "payload": {"type": "dm.typing", "user_id": self.user.id}}
        await self.channel_layer.group_send(user_group(to), event)

    async def _dm_change(self, op, content):
        """{"type": "dm.react", "message_id", "emoji"} / "dm.edit" (+ "content") / "dm.delete".
        Both people's tabs get {"type": "dm.update", "message": {...}}."""
        if op == "react" and not await database_sync_to_async(chat_services.allow_message)(self.user.id):
            return await self.error("rate_limited", "Slow down a little.")
        value = content.get("emoji") if op == "react" else content.get("content")
        try:
            payload, partner_id = await database_sync_to_async(services.change_dm)(
                self.user, op, content.get("message_id"), value
            )
        except SocialError as exc:
            return await self.error(exc.code, exc.detail)
        event = {"type": "user.event", "payload": {"type": "dm.update", "message": payload}}
        for uid in {self.user.id, partner_id}:
            await self.channel_layer.group_send(user_group(uid), event)

    async def user_event(self, event):
        await self.send_json(event["payload"])
