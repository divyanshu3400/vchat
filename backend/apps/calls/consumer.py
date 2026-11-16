"""Call signaling on the personal socket (/ws/me/). Mixed into UserConsumer.

Media never touches our servers: the two browsers connect with WebRTC (directly, or through the
TURN relay). We only pass the invite, the answer and the WebRTC setup messages between exactly
two sockets.

Who may call whom
  friends   voice or video
  strangers voice only, inside the current random chat; it starts only if the other person
            accepts (so both have agreed), and it can't be made a video call

client -> {"type": "call.invite", "call_id": "<uuid>", "kind": "voice"|"video", "to": <friend id>}
client -> {"type": "call.invite", "call_id": "<uuid>", "kind": "voice", "stranger": true}
server -> caller {"type": "call.ringing", "call_id"}
server -> callee {"type": "call.incoming", "call_id", "kind", "stranger", "from": {id, nickname, gender}}
client -> {"type": "call.accept" | "call.decline" | "call.end", "call_id"}
server -> {"type": "call.accepted" | "call.declined" | "call.ended" | "call.taken", "call_id", "reason"?}
client -> {"type": "call.signal", "call_id", "data": {sdp | candidate}}   relayed to the other side only
"""

import json
import re

from channels.db import database_sync_to_async
from django.core.cache import cache

from apps.chat import services as chat_services
from apps.chat.realtime import user_group
from apps.push import events as push_events
from apps.social import services as social
from apps.stranger import services as stranger_services

CALL_ID_RE = re.compile(r"^[0-9a-fA-F-]{8,64}$")
RING_SECONDS = 60
ACTIVE_SECONDS = 6 * 3600
MAX_SIGNAL_BYTES = 32 * 1024


def _key(call_id):
    return f"call:{call_id}"


@database_sync_to_async
def _get(call_id):
    return cache.get(_key(call_id))


@database_sync_to_async
def _put(call_id, state, ttl):
    cache.set(_key(call_id), state, ttl)


@database_sync_to_async
def _create(call_id, state):
    return cache.add(_key(call_id), state, RING_SECONDS)


@database_sync_to_async
def _claim_answer(call_id, channel):
    """First tab to answer wins."""
    return cache.add(f"{_key(call_id)}:answered", channel, RING_SECONDS)


@database_sync_to_async
def _busy(user_id):
    return cache.get(f"busy:{user_id}")


@database_sync_to_async
def _set_busy(user_id, call_id, ttl):
    cache.set(f"busy:{user_id}", call_id, ttl)


@database_sync_to_async
def _clear(call_id, state):
    for uid in (state["caller"], state["callee"]):
        if cache.get(f"busy:{uid}") == call_id:
            cache.delete(f"busy:{uid}")
    cache.delete_many([_key(call_id), f"{_key(call_id)}:answered"])


class CallMixin:
    def _call_ids(self) -> set:
        if not hasattr(self, "_calls"):
            self._calls = set()
        return self._calls

    async def call_handle(self, kind: str, content: dict) -> bool:
        handlers = {
            "call.invite": self._call_invite,
            "call.accept": self._call_accept,
            "call.decline": self._call_decline,
            "call.end": self._call_end,
            "call.signal": self._call_signal,
        }
        handler = handlers.get(kind)
        if handler is None:
            return False
        call_id = str(content.get("call_id", ""))
        if not CALL_ID_RE.match(call_id):
            await self.error("invalid", "Bad call id.")
            return True
        await handler(call_id, content)
        return True

    async def _to_user(self, user_id: int, payload: dict):
        await self.channel_layer.group_send(user_group(user_id), {"type": "user.event", "payload": payload})

    async def _to_channel(self, channel: str, payload: dict):
        await self.channel_layer.send(channel, {"type": "user.event", "payload": payload})

    # --- client commands ----------------------------------------------------------

    async def _call_invite(self, call_id, content):
        kind = content.get("kind")
        if kind not in ("voice", "video"):
            return await self.error("invalid", "Choose a voice or video call.")

        if content.get("stranger"):
            st = getattr(self, "stranger", None)
            if not st:
                return await self.error("no_chat", "You're not chatting with anyone right now.")
            if kind != "voice":
                return await self.error("call_not_allowed", "Video calls are only for friends.")
            callee, callee_channel = st["partner_id"], st.get("partner_channel")
            if not callee_channel:
                return await self.error("call_unavailable", "They're away right now. Try again when they're back.")
        else:
            callee = content.get("to")
            if not isinstance(callee, int) or isinstance(callee, bool) or callee == self.user.id:
                return await self.error("invalid", "Pick a friend to call.")
            allowed = await database_sync_to_async(
                lambda: social.are_friends(self.user.id, callee) and not social.is_blocked_between(self.user.id, callee)
            )()
            if not allowed:
                return await self.error("call_not_allowed", "You can only call friends.")
            callee_channel = None

        if await _busy(self.user.id):
            return await self.error("busy", "You're already in a call.")
        if await _busy(callee):
            return await self.error("busy", "They're on another call. Try again in a bit.")

        state = {
            "caller": self.user.id,
            "caller_ch": self.channel_name,
            "callee": callee,
            "callee_ch": callee_channel,  # known up front for strangers; set on answer for friends
            "kind": kind,
            "stranger": bool(content.get("stranger")),
            "state": "ringing",
        }
        if not await _create(call_id, state):
            return await self.error("invalid", "That call already exists.")
        await _set_busy(self.user.id, call_id, RING_SECONDS)
        self._call_ids().add(call_id)

        incoming = {
            "type": "call.incoming",
            "call_id": call_id,
            "kind": kind,
            "stranger": state["stranger"],
            # Random chat stays anonymous on calls too.
            "from": stranger_services.partner_brief(self.user.id) if state["stranger"] else social.brief(self.user),
        }
        if callee_channel:
            await self._to_channel(callee_channel, incoming)
        else:
            await self._to_user(callee, incoming)
        await self.send_json({"type": "call.ringing", "call_id": call_id})

    async def _call_accept(self, call_id, content):
        state = await _get(call_id)
        if not state or state["state"] != "ringing" or state["callee"] != self.user.id:
            return await self.error("call_gone", "That call has ended.")
        if state["callee_ch"] and state["callee_ch"] != self.channel_name:
            return await self.error("call_gone", "That call has ended.")
        if not await _claim_answer(call_id, self.channel_name):
            return await self.error("call_gone", "Answered on another device.")

        state.update(callee_ch=self.channel_name, state="active")
        await _put(call_id, state, ACTIVE_SECONDS)
        await _set_busy(state["caller"], call_id, ACTIVE_SECONDS)
        await _set_busy(self.user.id, call_id, ACTIVE_SECONDS)
        self._call_ids().add(call_id)

        await self._to_channel(state["caller_ch"], {"type": "call.accepted", "call_id": call_id})
        if not state["stranger"]:
            # Stop the ringing on the callee's other tabs and devices.
            await self._to_user(self.user.id, {"type": "call.taken", "call_id": call_id})

    async def _call_decline(self, call_id, content):
        state = await _get(call_id)
        if not state or state["callee"] != self.user.id or state["state"] != "ringing":
            return
        await _clear(call_id, state)
        await self._to_channel(state["caller_ch"], {"type": "call.declined", "call_id": call_id})
        if not state["stranger"]:
            await self._to_user(self.user.id, {"type": "call.ended", "call_id": call_id, "reason": "declined"})

    async def _call_end(self, call_id, content, reason=None):
        state = await _get(call_id)
        self._call_ids().discard(call_id)
        if not state or self.user.id not in (state["caller"], state["callee"]):
            return
        await _clear(call_id, state)
        reason = reason or str(content.get("reason", "ended"))[:20]
        payload = {"type": "call.ended", "call_id": call_id, "reason": reason}
        if self.channel_name == state["caller_ch"]:
            if state["callee_ch"]:
                await self._to_channel(state["callee_ch"], payload)
            else:  # still ringing on every tab of the friend
                await self._to_user(state["callee"], payload)
                if not state["stranger"]:
                    # Nobody answered: a "missed call" for when they look at their phone.
                    await database_sync_to_async(push_events.missed_call)(
                        state["callee"], self.user.id, self.user.nickname, state["kind"]
                    )
        else:
            await self._to_channel(state["caller_ch"], payload)

    async def _call_signal(self, call_id, content):
        data = content.get("data")
        if not isinstance(data, dict) or len(json.dumps(data)) > MAX_SIGNAL_BYTES:
            return await self.error("invalid", "Bad call data.")
        state = await _get(call_id)
        if not state or state["state"] != "active":
            return
        if self.channel_name == state["caller_ch"]:
            other = state["callee_ch"]
        elif self.channel_name == state["callee_ch"]:
            other = state["caller_ch"]
        else:
            return  # not one of the two sockets in this call
        await self._to_channel(other, {"type": "call.signal", "call_id": call_id, "data": data})

    async def call_disconnect(self):
        """Tab closed: end its calls for the other side."""
        for call_id in list(self._call_ids()):
            await self._call_end(call_id, {}, reason="disconnected")
