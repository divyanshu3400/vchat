"""Random 1-on-1 chat, carried on the personal socket (/ws/me/). Mixed into UserConsumer.

A chat belongs to the one tab (socket) that started looking, not to the user, so a second tab
can browse rooms without being pulled into it. Messages go straight from one socket to the
other's channel; nothing is broadcast.

client -> {"type": "stranger.find", "region": "any" | "<region slug>", "want": "any" | "F" | "M"}
          ("want" other than "any" needs Plus or a rewarded-ad grant: else error "locked_filter")
server -> {"type": "stranger.waiting", "waiting": <people in the queue>}
server -> {"type": "stranger.matched", "session": "<uuid>", "partner": {id, nickname: "Anonymous", gender: "", region: "any"}, "common": [interests]}
          (stranger.find may carry "interests": up to 5 of matchmaker.INTERESTS; most shared first)
client -> {"type": "stranger.message", "content": "...", "client_id": "..."}
server -> {"type": "stranger.message", "message": {id, session, sender_id, content, created_at}, "client_id": "..."}
          (+ "reply_to": <message id>, "attachment": <upload id> for a voice message, or a photo after an unlock)
client -> {"type": "stranger.react", "message_id", "emoji"} | "stranger.edit" (+ "content") | "stranger.delete"
server -> {"type": "stranger.update", "message": {...}}  (to both sides)
client -> {"type": "stranger.typing"}           server -> {"type": "stranger.typing"} (to the partner)
client -> {"type": "stranger.next"}             end this chat and look again
client -> {"type": "stranger.leave"}            end this chat
client -> {"type": "stranger.cancel"}           stop looking
server -> {"type": "stranger.ended", "by": "you" | "stranger" | "connection"}
server -> {"type": "stranger.idle"}

A random chat lasts until someone ends it (Leave, Next, block or report), like y99: a dropped
connection, a reload or closing the app only makes you "away". The chat lives in the database, not
in a socket. On every (re)connect the app sends:
client -> {"type": "stranger.resume"}             (+ "session" if it knows one)
server -> {"type": "stranger.resumed", "session", "partner", "partner_away", "messages": [...]}
          or {"type": "stranger.idle"} when you have no open chat.
The other person hears {"type": "stranger.away"} / {"type": "stranger.back"}; messages sent while
they're away are saved and arrive with their next "resumed". The data purge removes chats older
than 7 days, open or not.
"""

import asyncio
import time


from channels.db import database_sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.chat import message_ops
from apps.chat import services as chat_services
from apps.chat.rooms_meta import REGION_SLUGS
from apps.premium import services as premium
from apps.premium.models import RewardGrant

from . import matchmaker, services


def _owner_key(session: str, user_id: int) -> str:
    """Which socket of this user holds the chat (a reconnect takes it over)."""
    return f"st:own:{session}:{user_id}"


def _away_key(session: str, user_id: int) -> str:
    """When this user's socket dropped out of the chat."""
    return f"st:away:{session}:{user_id}"


_cache_get = database_sync_to_async(cache.get)
_cache_set = database_sync_to_async(cache.set)
_cache_delete = database_sync_to_async(cache.delete)
_KEY_TTL = 6 * 3600


class StrangerMixin:
    stranger: dict | None = None  # {"session", "partner_channel", "partner_id", "away"?}
    _st_grace_task: asyncio.Task | None = None

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
            "stranger.resume": self._st_resume,
            "stranger.react": self._st_change,
            "stranger.edit": self._st_change,
            "stranger.delete": self._st_change,
        }
        handler = handlers.get(kind)
        if handler is None:
            return False
        if handler == self._st_change:
            await handler(kind.removeprefix("stranger."), content)
        else:
            await handler(content)
        return True

    async def _st_find(self, content):
        blocked_until = await database_sync_to_async(
            lambda: type(self.user).objects.filter(pk=self.user.pk).values_list("random_blocked_until", flat=True).first()
        )()
        if blocked_until and blocked_until > timezone.now():
            return await self.error(
                "random_suspended",
                "You were reported by several people, so random chat is paused for you until "
                f"{blocked_until:%d %b, %H:%M} UTC while a moderator takes a look. Rooms and friends still work.",
            )
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
        # A new stranger ends the chat you had (even one left open before a reload).
        await self._st_end(by="you")

        raw_interests = content.get("interests")
        interests = (
            sorted({i for i in raw_interests if isinstance(i, str) and i in matchmaker.INTERESTS})[: matchmaker.MAX_INTERESTS]
            if isinstance(raw_interests, list)
            else []
        )
        blocked = await database_sync_to_async(chat_services.blocked_user_ids)(self.user.id)
        me = matchmaker.Entry(
            channel=self.channel_name, user_id=self.user.id, nickname=self.user.nickname,
            gender=self.user.gender, region=region, want=want, interests=interests,
        )
        partner = await database_sync_to_async(matchmaker.find_or_wait)(me, blocked)
        if partner is None:
            waiting = await database_sync_to_async(matchmaker.waiting_count)()
            return await self.send_json({"type": "stranger.waiting", "waiting": waiting})

        session = await database_sync_to_async(services.start_session)(partner.user_id, self.user.id)
        sid = str(session.id)
        self.stranger = {"session": sid, "partner_channel": partner.channel, "partner_id": partner.user_id}
        await _cache_set(_owner_key(sid, self.user.id), self.channel_name, _KEY_TTL)
        await self.channel_layer.send(
            partner.channel,
            {
                "type": "stranger.paired",
                "session": sid,
                "partner_channel": self.channel_name,
                "partner": services.partner_brief(self.user.id),
                "common": me.shared(partner),
            },
        )
        await self.send_json(
            {
                "type": "stranger.matched",
                "session": sid,
                "partner": services.partner_brief(partner.user_id),
                # Interests you both picked: the app opens with an ice-breaker about them.
                "common": me.shared(partner),
            }
        )

    async def _to_partner(self, event: dict) -> bool:
        """Send to the other person's socket, if they're here. False while they're away."""
        st = self.stranger
        if not st:
            return False
        channel = st.get("partner_channel") or await _cache_get(_owner_key(st["session"], st["partner_id"]))
        if not channel:
            return False
        st["partner_channel"] = channel
        await self.channel_layer.send(channel, event)
        return True

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
            payload = await database_sync_to_async(services.save_message)(
                st["session"], self.user, text, attachment_id, content.get("reply_to")
            )
        except services.PhotoLocked as exc:
            return await self.error(exc.code, exc.detail, client_id)
        event = {"type": "stranger.deliver", "session": st["session"], "payload": {"type": "stranger.message", "message": payload, "client_id": client_id}}
        await self._to_partner(event)  # away: they get it when they come back
        await self.send_json(event["payload"])

    async def _st_change(self, op, content):
        if not self.stranger:
            return await self.error("no_chat", "You're not chatting with anyone right now.")
        if op == "react" and not await database_sync_to_async(chat_services.allow_message)(self.user.id):
            return await self.error("rate_limited", "Slow down a little.")
        st = self.stranger
        value = content.get("emoji") if op == "react" else content.get("content")
        try:
            payload = await database_sync_to_async(services.change_message)(
                st["session"], self.user, op, content.get("message_id"), value
            )
        except message_ops.MessageOpError as exc:
            return await self.error(exc.code, exc.detail)
        event = {"type": "stranger.deliver", "session": st["session"], "payload": {"type": "stranger.update", "message": payload}}
        await self._to_partner(event)
        await self.send_json(event["payload"])

    async def _st_typing(self, content):
        if self.stranger:
            await self._to_partner({"type": "stranger.deliver", "session": self.stranger["session"], "payload": {"type": "stranger.typing"}})

    async def _st_next(self, content):
        await self._st_find({"region": content.get("region", "any")})

    async def _st_leave(self, content):
        # Also ends a chat this socket hasn't picked up yet (left open before a reload).
        await self._st_end(by="you")
        await self.send_json({"type": "stranger.idle"})

    async def _st_resume(self, content):
        """This socket (a reload, the app opened again, a new connection) picks up my open chat."""
        found = await database_sync_to_async(services.open_session_of)(self.user.id)
        if found is None:
            self.stranger = None
            return await self.send_json({"type": "stranger.idle"})
        sid, partner_id = found
        partner_channel = await _cache_get(_owner_key(sid, partner_id))
        old_channel = await _cache_get(_owner_key(sid, self.user.id))
        await _cache_set(_owner_key(sid, self.user.id), self.channel_name, _KEY_TTL)
        await _cache_delete(_away_key(sid, self.user.id))
        if old_channel and old_channel != self.channel_name:
            # The old socket may not know yet that it is dead (phones often vanish without a close).
            await self.channel_layer.send(old_channel, {"type": "stranger.taken_over", "session": sid})
        self.stranger = {"session": sid, "partner_channel": partner_channel, "partner_id": partner_id}
        if partner_channel:
            await self.channel_layer.send(
                partner_channel, {"type": "stranger.partner_back", "session": sid, "channel": self.channel_name}
            )
        messages = await database_sync_to_async(services.history)(sid)
        await self.send_json(
            {
                "type": "stranger.resumed",
                "session": sid,
                "partner": services.partner_brief(partner_id),
                "partner_away": not partner_channel,
                "messages": messages,
            }
        )

    async def _st_cancel(self, content):
        await database_sync_to_async(matchmaker.leave_queue)(self.channel_name)
        await self.send_json({"type": "stranger.idle"})

    # --- shared ------------------------------------------------------------------

    async def _st_end(self, by: str):
        """End my current chat (also one left open in another tab or before a reload) and tell the other side."""
        st = self.stranger
        if not st:
            found = await database_sync_to_async(services.open_session_of)(self.user.id)
            if found:
                st = {"session": found[0], "partner_id": found[1], "partner_channel": None}
        self._st_stop_grace()
        if not st:
            self.stranger = None
            return
        await database_sync_to_async(services.end_session)(st["session"], self.user.id)
        self.stranger = st
        await self._to_partner({"type": "stranger.partner_left", "session": st["session"]})
        self.stranger = None
        await _cache_delete(_owner_key(st["session"], self.user.id))
        if by == "you":
            await self.send_json({"type": "stranger.ended", "by": "you", "session": st["session"]})

    async def stranger_disconnect(self):
        """Socket closing: leave the queue. A chat stays open (I'm just "away") until someone ends it."""
        await database_sync_to_async(matchmaker.leave_queue)(self.channel_name)
        st = self.stranger
        self._st_stop_grace()
        if not st:
            return
        sid = st["session"]
        if await _cache_get(_owner_key(sid, self.user.id)) != self.channel_name:
            self.stranger = None
            return  # a newer socket of mine already took this chat over
        await _cache_delete(_owner_key(sid, self.user.id))
        await _cache_set(_away_key(sid, self.user.id), time.time(), _KEY_TTL)
        await self._to_partner({"type": "stranger.partner_away", "session": sid})
        self.stranger = None

    def _st_stop_grace(self):
        if self._st_grace_task:
            self._st_grace_task.cancel()
            self._st_grace_task = None

    async def stranger_heartbeat(self):
        await database_sync_to_async(matchmaker.heartbeat)(self.channel_name)

    # --- events from the other socket (channel layer) ----------------------------

    async def stranger_paired(self, event):
        self.stranger = {"session": event["session"], "partner_channel": event["partner_channel"], "partner_id": event["partner"]["id"]}
        await _cache_set(_owner_key(event["session"], self.user.id), self.channel_name, _KEY_TTL)
        await self.send_json(
            {"type": "stranger.matched", "session": event["session"], "partner": event["partner"], "common": event.get("common", [])}
        )

    async def stranger_deliver(self, event):
        if self.stranger and self.stranger["session"] == event["session"]:
            await self.send_json(event["payload"])

    async def stranger_partner_away(self, event):
        st = self.stranger
        if st and st["session"] == event["session"]:
            # Their app is closed or offline: the chat waits for them (no time limit).
            st["away"] = True
            st["partner_channel"] = None
            await self.send_json({"type": "stranger.away", "session": st["session"]})

    async def stranger_partner_back(self, event):
        st = self.stranger
        if not (st and st["session"] == event["session"]):
            # Too late: this side already ended the chat.
            await self.channel_layer.send(event["channel"], {"type": "stranger.partner_left", "session": event["session"]})
            return
        self._st_stop_grace()
        st.pop("away", None)
        st["partner_channel"] = event["channel"]
        await self.send_json({"type": "stranger.back", "session": st["session"]})

    async def stranger_taken_over(self, event):
        if self.stranger and self.stranger["session"] == event["session"]:
            self.stranger = None

    async def stranger_partner_left(self, event):
        if self.stranger and self.stranger["session"] == event["session"]:
            self.stranger = None
            self._st_stop_grace()
            await self.send_json({"type": "stranger.ended", "by": "stranger", "session": event["session"]})
