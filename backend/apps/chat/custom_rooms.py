"""Rooms people make themselves: private, joined only through an invite link (/r/<code>).

The owner can rename, make a new link (the old one stops working), remove people and delete the
room. Members can leave. Someone removed can't come back through the link. Messages, blocks,
automod and reports work exactly as in the public rooms.
"""

import re
import secrets

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone

from . import presence
from .models import Room, RoomMember
from .realtime import push_control

MAX_OWNED = 3
MAX_MEMBERS = 200
NAME_RE = re.compile(r"^[^\x00-\x1f<>]{2,40}$")


class RoomError(Exception):
    def __init__(self, detail: str, status: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status = status


def _code() -> str:
    return secrets.token_urlsafe(6)  # 8 characters, ~48 bits


def _clean_name(value) -> str:
    name = " ".join(str(value or "").split())
    if not NAME_RE.match(name):
        raise RoomError("Room names are 2 to 40 characters.")
    return name


def _clean_emoji(value) -> str:
    emoji = str(value or "").strip()[:8]
    return "" if any(ch.isalnum() or ch in "<>" for ch in emoji) else emoji


def is_member(room: Room, user_id: int) -> bool:
    if not room.is_custom:
        return True
    return RoomMember.objects.filter(room=room, user_id=user_id, removed_at__isnull=True).exists()


def member_count(room: Room) -> int:
    return RoomMember.objects.filter(room=room, removed_at__isnull=True).count()


def room_payload(room: Room, user_id: int | None, members: int | None = None, online: int | None = None) -> dict:
    data = {
        "slug": room.slug,
        "name": room.name,
        "kind": room.kind,
        "description": room.description,
        "emoji": room.emoji,
        "members": member_count(room) if members is None else members,
        "is_owner": user_id is not None and room.owner_id == user_id,
    }
    if online is not None:
        data["online"] = online
    if user_id is not None:  # members (and the owner) can share the link
        data["invite_code"] = room.invite_code
    return data


def create_room(user, name, description="", emoji="") -> Room:
    if user.is_guest:
        raise RoomError("Save your account to make a room.", 403)
    if Room.objects.filter(owner=user, kind=Room.Kind.CUSTOM, is_active=True).count() >= MAX_OWNED:
        raise RoomError(f"You can have {MAX_OWNED} rooms. Delete one to make another.")
    name = _clean_name(name)
    for _ in range(5):
        try:
            with transaction.atomic():
                room = Room.objects.create(
                    slug=f"c-{secrets.token_hex(5)}",
                    name=name,
                    kind=Room.Kind.CUSTOM,
                    description=" ".join(str(description or "").split())[:200],
                    emoji=_clean_emoji(emoji),
                    owner=user,
                    invite_code=_code(),
                )
                RoomMember.objects.create(room=room, user=user)
                return room
        except IntegrityError:  # slug or code collision: try another
            continue
    raise RoomError("Couldn't make the room. Try again.", 500)


def my_rooms(user) -> list[dict]:
    rooms = list(
        Room.objects.filter(kind=Room.Kind.CUSTOM, is_active=True, members__user=user, members__removed_at__isnull=True)
        .annotate(n=Count("members", filter=Q(members__removed_at__isnull=True), distinct=True))
        .order_by("-created_at")
    )
    online = presence.room_counts([r.id for r in rooms]) if rooms else {}
    return [room_payload(r, user.id, members=r.n, online=online.get(r.id, 0)) for r in rooms]


def by_code(code: str) -> Room | None:
    code = str(code or "")[:16]
    return Room.objects.filter(invite_code=code, kind=Room.Kind.CUSTOM, is_active=True).first() if code else None


def invite_preview(code: str, user=None) -> dict:
    """What an invite card shows: name, emoji, how many are in it; and for you, whether you're in."""
    room = by_code(code)
    if room is None:
        raise RoomError("This invite link doesn't work any more.", 404)
    data = {"name": room.name, "emoji": room.emoji, "description": room.description, "members": member_count(room)}
    if user is not None and user.is_authenticated:
        data["is_member"] = is_member(room, user.id)
        if data["is_member"]:
            data["slug"] = room.slug
    return data


def join(user, code: str) -> Room:
    room = by_code(code)
    if room is None:
        raise RoomError("This invite link doesn't work any more.", 404)
    existing = RoomMember.objects.filter(room=room, user=user).first()
    if existing and existing.removed_at is None:
        return room
    if existing:
        raise RoomError("You were removed from this room.", 403)
    from .services import blocked_user_ids

    if room.owner_id in blocked_user_ids(user.id):
        raise RoomError("You can't join this room.", 403)
    if member_count(room) >= MAX_MEMBERS:
        raise RoomError(f"This room is full ({MAX_MEMBERS} people).")
    RoomMember.objects.get_or_create(room=room, user=user)
    return room


def owned(user, slug: str) -> Room:
    room = Room.objects.filter(slug=slug, kind=Room.Kind.CUSTOM, is_active=True).first()
    if room is None:
        raise RoomError("That room is gone.", 404)
    if room.owner_id != user.id:
        raise RoomError("Only the room's owner can do that.", 403)
    return room


def joined(user, slug: str) -> Room:
    room = Room.objects.filter(slug=slug, kind=Room.Kind.CUSTOM, is_active=True).first()
    if room is None or not is_member(room, user.id):
        raise RoomError("That room is gone.", 404)
    return room


def update(user, slug: str, data: dict) -> Room:
    room = owned(user, slug)
    fields = []
    if "name" in data:
        room.name = _clean_name(data["name"])
        fields.append("name")
    if "description" in data:
        room.description = " ".join(str(data["description"] or "").split())[:200]
        fields.append("description")
    if "emoji" in data:
        room.emoji = _clean_emoji(data["emoji"])
        fields.append("emoji")
    if data.get("new_link"):
        room.invite_code = _code()
        fields.append("invite_code")
    if fields:
        room.save(update_fields=fields)
    return room


def _kick_sockets(room: Room, user_ids) -> None:
    for uid in user_ids:
        push_control(uid, {"type": "room_removed", "room": room.slug})


def remove_member(user, slug: str, member_id: int) -> None:
    room = owned(user, slug)
    if member_id == user.id:
        raise RoomError("You own this room. Delete it instead.")
    updated = RoomMember.objects.filter(room=room, user_id=member_id, removed_at__isnull=True).update(removed_at=timezone.now())
    if updated:
        _kick_sockets(room, [member_id])


def leave(user, slug: str) -> None:
    room = joined(user, slug)
    if room.owner_id == user.id:
        raise RoomError("You own this room. Delete it instead.")
    RoomMember.objects.filter(room=room, user=user).delete()  # leaving freely: the link works again
    _kick_sockets(room, [user.id])


def delete(user, slug: str) -> None:
    room = owned(user, slug)
    people = list(RoomMember.objects.filter(room=room, removed_at__isnull=True).values_list("user_id", flat=True))
    room.delete()  # messages and memberships go with it
    _kick_sockets(room, people)


def members(user, slug: str) -> list[dict]:
    from apps.accounts.closing import public_user

    room = joined(user, slug)
    rows = RoomMember.objects.filter(room=room, removed_at__isnull=True).select_related("user").order_by("joined_at")
    return [{"user": public_user(m.user), "is_owner": m.user_id == room.owner_id, "joined_at": m.joined_at.isoformat()} for m in rows]
