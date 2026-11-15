"""The queue of people waiting for a stranger, shared by every server through Redis.

One lock covers "look for a partner, or join the queue", so two servers can never hand the same
waiting person to two different people. Each waiting entry is one socket (one browser tab) and
carries a timestamp; heartbeats refresh it and entries that stop refreshing are dropped, so a
crashed server can't leave ghosts in the queue.

Matching rules, in order:
  - never yourself (another tab of yours), never someone either of you blocked
  - prefer someone new: a partner from the last RECENT_SECONDS is picked only when nobody
    else fits (with few people online, the same two can always meet again)
  - region: compatible when either side picked "any" or both picked the same region
  - gender filter (Plus / rewarded ad): someone wanting women only meets women only, and is
    only offered to people whose own filter (if any) fits them
  - otherwise whoever has waited longest
"""

import json
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass

from django.conf import settings

QUEUE_KEY = "st:queue"
LOCK_KEY = "st:lock"


def _cfg(name: str) -> int:
    return settings.VCHAT[name]


@dataclass
class Entry:
    channel: str  # the socket that will chat
    user_id: int
    nickname: str
    gender: str
    region: str  # "any" or a region room slug
    ts: float = 0.0
    want: str = "any"  # "any", or a gender ("F", "M") for Plus / rewarded-ad users

    def compatible(self, other: "Entry") -> bool:
        region_ok = self.region == "any" or other.region == "any" or self.region == other.region
        # Gender filters work both ways: each side's wish must fit the other person.
        mine_ok = self.want == "any" or other.gender == self.want
        theirs_ok = other.want == "any" or self.gender == other.want
        return region_ok and mine_ok and theirs_ok


# --- storage backends ------------------------------------------------------------


class MemoryBackend:
    """Single-process store for development and tests."""

    def __init__(self):
        self._lock = threading.RLock()
        self._queue: dict[str, Entry] = {}  # insertion order = waiting order
        self._recent: dict[int, dict[int, float]] = {}

    @contextmanager
    def lock(self):
        with self._lock:
            yield

    def entries(self) -> list[Entry]:
        return list(self._queue.values())

    def add(self, entry: Entry) -> None:
        self._queue.pop(entry.channel, None)
        self._queue[entry.channel] = entry

    def remove(self, channel: str) -> bool:
        return self._queue.pop(channel, None) is not None

    def touch(self, channel: str, ts: float) -> None:
        if channel in self._queue:
            self._queue[channel].ts = ts

    def size(self) -> int:
        return len(self._queue)

    def remember(self, user_id: int, other_id: int, until: float) -> None:
        self._recent.setdefault(user_id, {})[other_id] = until

    def recent(self, user_id: int, now: float) -> set[int]:
        return {uid for uid, until in self._recent.get(user_id, {}).items() if until > now}


class RedisBackend:
    """Shared by every server. A list keeps waiting order; one key per entry holds its data."""

    def __init__(self, client):
        self.r = client

    @contextmanager
    def lock(self):
        with self.r.lock(LOCK_KEY, timeout=5, blocking_timeout=5):
            yield

    def entries(self) -> list[Entry]:
        channels = [c.decode() if isinstance(c, bytes) else c for c in self.r.lrange(QUEUE_KEY, 0, -1)]
        if not channels:
            return []
        raw = self.r.mget([f"st:e:{c}" for c in channels])
        found = []
        for channel, data in zip(channels, raw):
            if data is None:  # expired entry: drop its place in line
                self.r.lrem(QUEUE_KEY, 0, channel)
                continue
            found.append(Entry(**json.loads(data)))
        return found

    def add(self, entry: Entry) -> None:
        pipe = self.r.pipeline()
        pipe.lrem(QUEUE_KEY, 0, entry.channel)
        pipe.rpush(QUEUE_KEY, entry.channel)
        pipe.set(f"st:e:{entry.channel}", json.dumps(asdict(entry)), ex=_cfg("STRANGER_QUEUE_TTL"))
        pipe.execute()

    def remove(self, channel: str) -> bool:
        pipe = self.r.pipeline()
        pipe.lrem(QUEUE_KEY, 0, channel)
        pipe.delete(f"st:e:{channel}")
        removed, _ = pipe.execute()
        return bool(removed)

    def touch(self, channel: str, ts: float) -> None:
        key = f"st:e:{channel}"
        data = self.r.get(key)
        if data is not None:
            entry = json.loads(data)
            entry["ts"] = ts
            self.r.set(key, json.dumps(entry), ex=_cfg("STRANGER_QUEUE_TTL"))

    def size(self) -> int:
        return int(self.r.llen(QUEUE_KEY))

    def remember(self, user_id: int, other_id: int, until: float) -> None:
        key = f"st:recent:{user_id}"
        pipe = self.r.pipeline()
        pipe.zadd(key, {str(other_id): until})
        pipe.expire(key, _cfg("STRANGER_RECENT_SECONDS"))
        pipe.execute()

    def recent(self, user_id: int, now: float) -> set[int]:
        return {int(m) for m in self.r.zrangebyscore(f"st:recent:{user_id}", now, "+inf")}


_backend = None


def backend():
    global _backend
    if _backend is None:
        if settings.REDIS_URL and not settings.TESTING:
            import redis

            _backend = RedisBackend(redis.Redis.from_url(settings.REDIS_URL))
        else:
            _backend = MemoryBackend()
    return _backend


def set_backend(new_backend) -> None:
    """For tests."""
    global _backend
    _backend = new_backend


# --- operations -------------------------------------------------------------------


def find_or_wait(me: Entry, blocked: set[int]) -> Entry | None:
    """Pair `me` with the best waiting stranger (removing them from the queue), or queue `me`."""
    store = backend()
    now = time.time()
    me.ts = now
    stale_before = now - _cfg("STRANGER_QUEUE_TTL")
    with store.lock():
        store.remove(me.channel)
        recent = store.recent(me.user_id, now)
        fallback = None
        for other in store.entries():
            if other.ts < stale_before:
                store.remove(other.channel)
                continue
            if other.user_id == me.user_id or other.user_id in blocked or not me.compatible(other):
                continue
            if other.user_id in recent:
                fallback = fallback or other
                continue
            return _pair(store, me, other, now)
        if fallback:
            return _pair(store, me, fallback, now)
        store.add(me)
        return None


def _pair(store, me: Entry, other: Entry, now: float) -> Entry:
    store.remove(other.channel)
    until = now + _cfg("STRANGER_RECENT_SECONDS")
    store.remember(me.user_id, other.user_id, until)
    store.remember(other.user_id, me.user_id, until)
    return other


def leave_queue(channel: str) -> bool:
    store = backend()
    with store.lock():
        return store.remove(channel)


def heartbeat(channel: str) -> None:
    backend().touch(channel, time.time())


def waiting_count() -> int:
    return backend().size()
