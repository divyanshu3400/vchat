"""Watch a YouTube video together, in any 1-on-1 chat (friends or the current random chat).
Mixed into the personal socket (/ws/me/).

The server keeps one shared state per chat: which video, whether it plays, and where it was at a
known server time. Anyone in the chat can play, pause or seek; every change goes to both people,
and each browser follows the shared state (seeking when it drifts more than a couple of seconds).
Someone who joins late simply jumps to where the other person is.

    chat: {"kind": "dm", "with": <friend id>}  or  {"kind": "stranger"}

client -> {"type": "watch.start", "chat", "video": "<11-char YouTube id>"}
client -> {"type": "watch.control", "chat", "action": "play"|"pause"|"seek", "position": <seconds>}
client -> {"type": "watch.sync", "chat"}            what is playing now? (opening the chat, reconnecting)
client -> {"type": "watch.stop", "chat"}
server -> {"type": "watch.state", "chat": {...}, "state": {video, playing, position, at, by} | null,
           "server_now": <ms>}
           chat is {"kind": "dm", "users": [a, b]} or {"kind": "stranger", "session": "<uuid>"}
"""

import re
import time

from channels.db import database_sync_to_async
from django.core.cache import cache

from apps.chat.realtime import user_group
from apps.social import services as social

VIDEO_RE = re.compile(r"^[\w-]{11}$")
STATE_SECONDS = 6 * 3600
MAX_POSITION = 24 * 3600


def _allow(user_id: int) -> bool:
    """At most 20 player changes per 5 seconds per person."""
    key = f"wrl:{user_id}:{int(time.time() / 5)}"
    if cache.add(key, 1, 10):
        return True
    try:
        return cache.incr(key) <= 20
    except ValueError:
        return True


def _now_ms() -> int:
    return int(time.time() * 1000)


_get = database_sync_to_async(cache.get)
_set = database_sync_to_async(cache.set)
_delete = database_sync_to_async(cache.delete)


class WatchMixin:
    async def watch_handle(self, kind: str, content: dict) -> bool:
        handlers = {
            "watch.start": self._w_start,
            "watch.control": self._w_control,
            "watch.sync": self._w_sync,
            "watch.stop": self._w_stop,
        }
        handler = handlers.get(kind)
        if handler is None:
            return False
        chat = await self._w_chat(content.get("chat"))
        if chat is None:
            await self.error("watch_unavailable", "You can only watch together in a chat with a friend or a stranger.")
            return True
        if kind != "watch.sync" and not await database_sync_to_async(_allow)(self.user.id):
            await self.error("rate_limited", "Slow down a little.")
            return True
        await handler(chat, content)
        return True

    async def _w_chat(self, raw):
        """Which chat this is, as {"key", "public", "dm_users"} or {"key", "public", "stranger"}."""
        if not isinstance(raw, dict):
            return None
        if raw.get("kind") == "dm":
            other = raw.get("with")
            if not isinstance(other, int) or isinstance(other, bool) or other == self.user.id:
                return None
            if not await database_sync_to_async(social.are_friends)(self.user.id, other):
                return None
            a, b = sorted((self.user.id, other))
            return {"key": f"watch:dm:{a}:{b}", "public": {"kind": "dm", "users": [a, b]}, "dm_users": (a, b)}
        if raw.get("kind") == "stranger":
            st = getattr(self, "stranger", None)
            if not st:
                return None
            sid = st["session"]
            return {"key": f"watch:st:{sid}", "public": {"kind": "stranger", "session": sid}, "stranger": st}
        return None

    async def _w_publish(self, chat, state):
        payload = {"type": "watch.state", "chat": chat["public"], "state": state, "server_now": _now_ms()}
        if "dm_users" in chat:
            for uid in chat["dm_users"]:
                await self.channel_layer.group_send(user_group(uid), {"type": "user.event", "payload": payload})
        else:
            st = chat["stranger"]
            await self.channel_layer.send(
                st["partner_channel"], {"type": "stranger.deliver", "session": st["session"], "payload": payload}
            )
            await self.send_json(payload)

    async def _w_start(self, chat, content):
        video = content.get("video")
        if not isinstance(video, str) or not VIDEO_RE.match(video):
            return await self.error("invalid_video", "That isn't a YouTube video link.")
        state = {"video": video, "playing": True, "position": 0.0, "at": _now_ms(), "by": self.user.id}
        await _set(chat["key"], state, STATE_SECONDS)
        await self._w_publish(chat, state)

    async def _w_control(self, chat, content):
        state = await _get(chat["key"])
        if not state:
            return await self._w_publish(chat, None)
        action = content.get("action")
        pos = content.get("position")
        if action not in ("play", "pause", "seek") or not isinstance(pos, (int, float)) or isinstance(pos, bool):
            return await self.error("invalid", "Unknown player action.")
        pos = min(max(float(pos), 0.0), MAX_POSITION)
        state = {
            **state,
            "playing": action == "play" or (action == "seek" and state["playing"]),
            "position": pos,
            "at": _now_ms(),
            "by": self.user.id,
        }
        await _set(chat["key"], state, STATE_SECONDS)
        await self._w_publish(chat, state)

    async def _w_sync(self, chat, content):
        state = await _get(chat["key"])
        await self.send_json({"type": "watch.state", "chat": chat["public"], "state": state, "server_now": _now_ms()})

    async def _w_stop(self, chat, content):
        await _delete(chat["key"])
        await self._w_publish(chat, None)

