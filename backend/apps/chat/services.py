"""Chat rules shared by the REST API and the WebSocket consumer."""

from django.conf import settings
from django.core.cache import cache

from .models import Block, Message, Room


class InvalidMessage(ValueError):
    pass


def clean_content(raw) -> str:
    if not isinstance(raw, str):
        raise InvalidMessage("Message must be text.")
    text = raw.strip()
    if not text:
        raise InvalidMessage("Message is empty.")
    limit = settings.VCHAT["MESSAGE_MAX_LENGTH"]
    if len(text) > limit:
        raise InvalidMessage(f"Message is longer than {limit} characters.")
    return text


def allow_message(user_id: int, room: Room | None = None) -> bool:
    """Flood control shared across tabs, servers, rooms and DMs (the cache is Redis in production)."""
    if room and room.slow_mode_seconds and not cache.add(f"slow:{room.id}:{user_id}", 1, room.slow_mode_seconds):
        return False

    key = f"rl:msg:{user_id}"
    window = settings.VCHAT["RATE_LIMIT_WINDOW"]
    if cache.add(key, 1, window):
        return True
    try:
        count = cache.incr(key)
    except ValueError:  # key expired between add() and incr()
        cache.add(key, 1, window)
        return True
    return count <= settings.VCHAT["RATE_LIMIT_MESSAGES"]


def blocked_user_ids(user_id: int) -> set[int]:
    """Users hidden from this user: anyone they blocked, and anyone who blocked them."""
    made = Block.objects.filter(blocker_id=user_id).values_list("blocked_id", flat=True)
    received = Block.objects.filter(blocked_id=user_id).values_list("blocker_id", flat=True)
    return set(made) | set(received)


def message_payload(message: Message) -> dict:
    from . import message_ops

    sender = message.sender
    return {
        "id": message.id,
        "room": message.room.slug,
        "sender": {"id": sender.id, "nickname": sender.nickname, "gender": sender.gender},
        "content": message_ops.visible_content(message),
        "content_type": message.content_type,
        "created_at": message.created_at.isoformat(),
        **message_ops.extras(message),
    }


def load_message(room: Room, message_id) -> Message | None:
    """A message of this room, with everything its payload needs."""
    from . import message_ops

    if not isinstance(message_id, int) or isinstance(message_id, bool):
        return None
    select, prefetch = message_ops.related_fields(Message)
    return (
        Message.objects.select_related("room", *select)
        .prefetch_related(*prefetch)
        .filter(id=message_id, room=room)
        .first()
    )
