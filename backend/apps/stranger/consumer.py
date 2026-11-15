"""Random 1-on-1 chat, carried on the personal socket (/ws/me/). Mixed into UserConsumer.

A chat belongs to the one tab (socket) that started looking, not to the user, so a second tab
can browse rooms without being pulled into it. Messages go straight from one socket to the
other's channel; nothing is broadcast.

client -> {"type": "stranger.find", "region": "any" | "<region slug>", "want": "any" | "F" | "M"}
          ("want" other than "any" needs Plus or a rewarded-ad grant: else error "locked_filter")
server -> {"type": "stranger.waiting", "waiting": <people in the queue>}
server -> {"type": "stranger.matched", "session": "<uuid>", "partner": {id, nickname, gender, region}}
client -> {"type": "stranger.message", "content": "...", "client_id": "..."}
server -> {"type": "stranger.message", "message": {id, session, sender_id, content, created_at}, "client_id": "..."}
client -> {"type": "stranger.typing"}           server -> {"type": "stranger.typing"} (to the partner)
client -> {"type": "stranger.next"}             end this chat and look again
client -> {"type": "stranger.leave"}            end this chat
client -> {"type": "stranger.cancel"}           stop looking
server -> {"type": "stranger.ended", "by": "you" | "stranger" | "connection"}
server -> {"type": "stranger.idle"}
"""

from channels.db import database_sync_to_async
from django.conf import settings
from django.core.cache import cache

from apps.chat import services as chat_services
from apps.chat.rooms_meta import REGION_SLUGS
from apps.premium import services as premium
from apps.premium.models import RewardGrant

from . import matchmaker, services


class StrangerMixin:
    stranger: dict | None = None  # {"session", "partner_channel", "partner_id"}

    # --- client messages -------------------------------------------------------

    async def stranger_handle(self, kind: str, content: dict) -> bool:
        """Returns True if the message was a stranger.* command."""
        handlers = {
            "stranger.find": self._st_find,
            "stranger.message": self._st_message,
            "stranger.typing": self._st_typing,
            "stranger.next": self._st_next,
            "stranger.leave": self._st_leave,
            "stranger.cancel": self._st_cancel,
        }
        handler = handlers.get(kind)
        if handler is None:
            return False
        await handler(content)
        return True

    async def _st_find(self, content):
        region = content.get("region", "any")
        if region != "any" and region not in REGION_SLUGS:
            region = "any"
        want = content.get("want", "any")
        if want not in ("any", "F", "M"):
            want = "any"
        # Rapid Next-Next-Next: at most one search per cooldown per user.
        cooldown = settings.VCHAT["STRANGER_FIND_COOLDOWN"]
        if cooldown and not await database_sync_to_async(cache.add)(f"st:cool:{self.user.id}", 1, cooldown):
            return await self.error("rate_limited", "Slow down a little before the next stranger.")
        if want != "any":
            # Checked and paid for on the server: one use per search (Plus members pay nothing).
            allowed = await database_sync_to_async(premium.consume)(self.user, RewardGrant.Kind.GENDER_FILTER)
            if not allowed:
                return await self.error(
                    "locked_filter", "Women-only and men-only matching need vChat Plus or a short ad."
                )
        if self.stranger:
            await self._st_end(by="you")

        blocked = await database_sync_to_async(chat_services.blocked_user_ids)(self.user.id)
        me = matchmaker.Entry(
            channel=self.channel_name, user_id=self.user.id, nickname=self.user.nickname,
            gender=self.user.gender, region=region, want=want,
        )
        partner = await database_sync_to_async(matchmaker.find_or_wait)(me, blocked)
        if partner is None:
            waiting = await database_sync_to_async(matchmaker.waiting_count)()
            return await self.send_json({"type": "stranger.waiting", "waiting": waiting})

        session = await database_sync_to_async(services.start_session)(partner.user_id, self.user.id)
        sid = str(session.id)
        self.stranger = {"session": sid, "partner_channel": partner.channel, "partner_id": partner.user_id}
        await self.channel_layer.send(
            partner.channel,
            {
                "type": "stranger.paired",
                "session": sid,
                "partner_channel": self.channel_name,
                "partner": services.partner_brief(self.user, region),
            },
        )
        await self.send_json(
            {
                "type": "stranger.matched",
                "session": sid,
                "partner": {"id": partner.user_id, "nickname": partner.nickname, "gender": partner.gender, "region": partner.region},
            }
        )

    async def _st_message(self, content):
        client_id = str(content.get("client_id", ""))[:64]
        if not self.stranger:
            return await self.error("no_chat", "You're not chatting with anyone right now.", client_id)
        attachment_id = content.get("attachment") or None
        raw = content.get("content") or ""
        try:
            text = chat_services.clean_content(raw) if (raw or not attachment_id) else ""
        except chat_services.InvalidMessage as exc:
            return await self.error("invalid_message", str(exc), client_id)
        if not await database_sync_to_async(chat_services.allow_message)(self.user.id):
            return await self.error("rate_limited", "You're sending messages too fast. Wait a moment.", client_id)

        st = self.stranger
        try:
            payload = await database_sync_to_async(services.save_message)(st["session"], self.user, text, attachment_id)
        except services.PhotoLocked as exc:
            return await self.error(exc.code, exc.detail, client_id)
        event = {"type": "stranger.deliver", "session": st["session"], "payload": {"type": "stranger.message", "message": payload, "client_id": client_id}}
        await self.channel_layer.send(st["partner_channel"], event)
        await self.send_json(event["payload"])

    async def _st_typing(self, content):
        if self.stranger:
            await self.channel_layer.send(
                self.stranger["partner_channel"],
                {"type": "stranger.deliver", "session": self.stranger["session"], "payload": {"type": "stranger.typing"}},
            )

    async def _st_next(self, content):
        await self._st_find({"region": content.get("region", "any")})

    async def _st_leave(self, content):
        if self.stranger:
            await self._st_end(by="you")
        await self.send_json({"type": "stranger.idle"})

    async def _st_cancel(self, content):
        await database_sync_to_async(matchmaker.leave_queue)(self.channel_name)
        await self.send_json({"type": "stranger.idle"})

    # --- shared ------------------------------------------------------------------

    async def _st_end(self, by: str):
        """End my current chat and tell the other side."""
        st, self.stranger = self.stranger, None
        if not st:
            return
        await database_sync_to_async(services.end_session)(st["session"], self.user.id)
        await self.channel_layer.send(st["partner_channel"], {"type": "stranger.partner_left", "session": st["session"]})
        if by == "you":
            await self.send_json({"type": "stranger.ended", "by": "you", "session": st["session"]})

    async def stranger_disconnect(self):
        """Socket closing: leave the queue, end any chat."""
        await database_sync_to_async(matchmaker.leave_queue)(self.channel_name)
        await self._st_end(by="connection")

    async def stranger_heartbeat(self):
        await database_sync_to_async(matchmaker.heartbeat)(self.channel_name)

    # --- events from the other socket (channel layer) ----------------------------

    async def stranger_paired(self, event):
        self.stranger = {"session": event["session"], "partner_channel": event["partner_channel"], "partner_id": event["partner"]["id"]}
        await self.send_json({"type": "stranger.matched", "session": event["session"], "partner": event["partner"]})

    async def stranger_deliver(self, event):
        if self.stranger and self.stranger["session"] == event["session"]:
            await self.send_json(event["payload"])

    async def stranger_partner_left(self, event):
        if self.stranger and self.stranger["session"] == event["session"]:
            self.stranger = None
            await self.send_json({"type": "stranger.ended", "by": "stranger", "session": event["session"]})
