"""Who is online, and how many people are in each room.

Every socket registers itself and must ping within PRESENCE_TTL seconds or it expires. Expiry is
what makes this safe when a server crashes and never runs disconnect handlers.

Storage: Redis sorted sets (member -> expiry timestamp) in production, so all servers share it.
Without REDIS_URL (local dev, tests) an in-process store is used: correct for one process only.

Keys
  pr:u:<user_id>   members = connection ids of the user's personal sockets  (online = any live member)
  pr:r:<room_id>   members = "<user_id>|<connection id>"                      (count = unique user ids)
  pr:site          members = "<user_id>|<connection id>"                      (site-wide online users)
"""

import threading
import time

from django.conf import settings

SITE_KEY = "pr:site"


def _user_key(user_id: int) -> str:
    return f"pr:u:{user_id}"


def _room_key(room_id: int) -> str:
    return f"pr:r:{room_id}"


def _ttl() -> int:
    return settings.VCHAT["PRESENCE_TTL"]


class MemoryBackend:
    def __init__(self):
        self._data: dict[str, dict[str, float]] = {}
        self._lock = threading.Lock()

    def _live(self, key: str, now: float) -> dict[str, float]:
        members = self._data.get(key, {})
        for member in [m for m, expires in members.items() if expires <= now]:
            del members[member]
        return members

    def add(self, key: str, member: str) -> int:
        """Add or refresh a member. Returns how many live members there were before."""
        now = time.time()
        with self._lock:
            members = self._live(key, now)
            before = len(members)
            members[member] = now + _ttl()
            self._data[key] = members
            return before

    def remove(self, key: str, member: str) -> int:
        """Remove a member. Returns how many live members remain."""
        now = time.time()
        with self._lock:
            members = self._live(key, now)
            members.pop(member, None)
            if not members:
                self._data.pop(key, None)
            return len(members)

    def members(self, keys: list[str]) -> list[list[str]]:
        now = time.time()
        with self._lock:
            return [list(self._live(k, now)) for k in keys]


class RedisBackend:
    def __init__(self, client):
        self.r = client

    def add(self, key: str, member: str) -> int:
        now = time.time()
        pipe = self.r.pipeline()
        pipe.zremrangebyscore(key, "-inf", now)
        pipe.zcard(key)
        pipe.zadd(key, {member: now + _ttl()})
        pipe.expire(key, _ttl() * 2)
        _, before, _, _ = pipe.execute()
        return int(before)

    def remove(self, key: str, member: str) -> int:
        now = time.time()
        pipe = self.r.pipeline()
        pipe.zrem(key, member)
        pipe.zremrangebyscore(key, "-inf", now)
        pipe.zcard(key)
        return int(pipe.execute()[-1])

    def members(self, keys: list[str]) -> list[list[str]]:
        if not keys:
            return []
        now = time.time()
        pipe = self.r.pipeline()
        for key in keys:
            pipe.zrangebyscore(key, now, "+inf")
        return [[m.decode() if isinstance(m, bytes) else m for m in found] for found in pipe.execute()]


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


def _unique_users(members: list[str]) -> set[int]:
    return {int(m.split("|", 1)[0]) for m in members}


# --- personal sockets: is this user online? ------------------------------


def connect_user(user_id: int, conn: str) -> bool:
    """Register a personal socket. True if the user just came online (it's their first live socket)."""
    backend().add(SITE_KEY, f"{user_id}|{conn}")
    return backend().add(_user_key(user_id), conn) == 0


def ping_user(user_id: int, conn: str) -> None:
    backend().add(SITE_KEY, f"{user_id}|{conn}")
    backend().add(_user_key(user_id), conn)


# --- is vChat on this person's screen? (no notifications then) ---------------------------


def _visible_key(user_id: int) -> str:
    return f"pr:vis:{user_id}"


def set_visible(user_id: int, conn: str, visible: bool) -> None:
    """A personal socket reports whether its tab is on screen (refreshed with the heartbeat)."""
    if visible:
        backend().add(_visible_key(user_id), conn)
    else:
        backend().remove(_visible_key(user_id), conn)


def is_looking(user_id: int) -> bool:
    return bool(backend().members([_visible_key(user_id)])[0])


def disconnect_user(user_id: int, conn: str) -> bool:
    """Unregister a personal socket. True if that was the user's last one (they just went offline)."""
    backend().remove(SITE_KEY, f"{user_id}|{conn}")
    return backend().remove(_user_key(user_id), conn) == 0


def online_among(user_ids) -> set[int]:
    ids = list(user_ids)
    found = backend().members([_user_key(u) for u in ids])
    return {uid for uid, members in zip(ids, found) if members}


def site_online_count() -> int:
    return len(_unique_users(backend().members([SITE_KEY])[0]))


# --- room sockets: how many people are here? ------------------------------


def join_room(room_id: int, user_id: int, conn: str) -> None:
    """Also used as the heartbeat for room sockets."""
    backend().add(_room_key(room_id), f"{user_id}|{conn}")


def leave_room(room_id: int, user_id: int, conn: str) -> None:
    backend().remove(_room_key(room_id), f"{user_id}|{conn}")


def room_counts(room_ids) -> dict[int, int]:
    ids = list(room_ids)
    found = backend().members([_room_key(r) for r in ids])
    return {rid: len(_unique_users(members)) for rid, members in zip(ids, found)}
