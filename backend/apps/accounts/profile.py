"""Editing your profile: display name, @username and photo.

The photo is private to friends: other people never get a link to it (random chats and rooms show
the coloured initial). Links are signed with the photo's version, so changing it changes the link.
"""

import io
import re
from datetime import timedelta

from django.core import signing
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import User
from .serializers import NICKNAME_RE, RESERVED

HANDLE_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_.]{1,18})[a-z0-9_]$")
HANDLE_COOLDOWN = timedelta(days=14)
HANDLE_HOLD = timedelta(days=14)
NAME_CHANGES_PER_DAY = 3
AVATAR_SIDE = 512
AVATAR_MAX_BYTES = 8 * 1024 * 1024
AVATAR_SALT = "vchat.avatar"
RESERVED_HANDLES = RESERVED | {"help", "about", "settings", "root", "official", "team", "everyone", "here"}


class ProfileError(Exception):
    def __init__(self, detail: str, field: str = ""):
        super().__init__(detail)
        self.detail = detail
        self.field = field


# --- display name ---


def set_nickname(user: User, value) -> None:
    name = str(value or "").strip()
    if name == user.nickname:
        return
    if not NICKNAME_RE.match(name):
        raise ProfileError("Use 3 to 18 letters, numbers, dots or underscores.", "nickname")
    if name.lower().strip("._") in RESERVED:
        raise ProfileError("That name is reserved. Pick another.", "nickname")
    key = f"profile:name:{user.pk}:{timezone.now():%Y%m%d}"
    if cache.get(key, 0) >= NAME_CHANGES_PER_DAY:
        raise ProfileError("You can change your name 3 times a day. Try again tomorrow.", "nickname")
    cache.set(key, cache.get(key, 0) + 1, 60 * 60 * 24)
    User.objects.filter(pk=user.pk).update(nickname=name)
    user.nickname = name


# --- @username ---


def normalise_handle(value) -> str:
    return str(value or "").strip().lstrip("@").lower()


def handle_problem(user: User | None, handle: str) -> str | None:
    """Why `user` (None: someone signing up) can't take `handle` right now, or None if they can."""
    if not HANDLE_RE.match(handle) or ".." in handle:
        return "3 to 20 letters, numbers, _ or . (not at the start or end)."
    if handle.strip("._") in RESERVED_HANDLES or handle.startswith(("vchat", "admin")):
        return "That username is reserved."
    others = User.objects.exclude(pk=user.pk) if user is not None and user.pk else User.objects.all()
    if others.filter(handle=handle).exists():
        return "That username is taken."
    if others.filter(previous_handle=handle, handle_changed_at__gt=timezone.now() - HANDLE_HOLD).exists():
        return "That username was in use recently. Try another."
    return None


def suggest_handles(user: User | None, wanted: str, count: int = 3) -> list[str]:
    """A few free usernames close to `wanted` (for "that name is taken")."""
    import secrets

    base = re.sub(r"[^a-z0-9_.]", "", normalise_handle(wanted)).strip("._").replace("..", ".")[:15] or "user"
    if len(base) < 3:
        base = f"{base}_x"
    candidates = [f"{base}_{n}" for n in range(2, 5)]
    candidates += [f"{base}{secrets.randbelow(900) + 100}" for _ in range(4)]
    candidates += [f"the.{base}", f"{base}.in", f"real.{base}", f"{base}_x"]
    found: list[str] = []
    for c in candidates:
        c = c[:20].strip("._")
        if c not in found and handle_problem(user, c) is None:
            found.append(c)
        if len(found) == count:
            break
    return found


def next_handle_change(user: User):
    """When the handle can change again (None: now)."""
    if not user.handle or not user.handle_changed_at:
        return None
    at = user.handle_changed_at + HANDLE_COOLDOWN
    return at if at > timezone.now() else None


def set_handle(user: User, value) -> None:
    handle = normalise_handle(value)
    if handle == (user.handle or ""):
        return
    if user.is_guest:
        raise ProfileError("Save your account to pick a username.", "handle")
    if not handle:
        raise ProfileError("A username can be changed, not removed.", "handle")
    wait = next_handle_change(user)
    if wait:
        raise ProfileError(f"You can change your username again on {wait:%d %b}.", "handle")
    problem = handle_problem(user, handle)
    if problem:
        raise ProfileError(problem, "handle")
    now = timezone.now()
    previous = user.handle or ""
    try:
        with transaction.atomic():
            User.objects.filter(pk=user.pk).update(handle=handle, handle_changed_at=now, previous_handle=previous)
    except IntegrityError:  # taken a moment ago by someone else
        raise ProfileError("That username is taken.", "handle")
    user.handle, user.handle_changed_at, user.previous_handle = handle, now, previous


# --- photo ---


def _square_jpeg(data: bytes) -> bytes:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ProfileError("That photo couldn't be read. Try a JPEG or PNG.", "avatar")
    if img.format not in ("JPEG", "PNG", "WEBP", "GIF"):
        raise ProfileError("Photos must be JPEG, PNG, WebP or GIF.", "avatar")
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.convert("RGBA").split()[-1])
        img = background
    img = ImageOps.fit(img.convert("RGB"), (AVATAR_SIDE, AVATAR_SIDE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85, optimize=True)  # metadata is not written
    return out.getvalue()


def set_avatar(user: User, upload) -> None:
    if upload is None:
        raise ProfileError("Choose a photo.", "avatar")
    if upload.size > AVATAR_MAX_BYTES:
        raise ProfileError("That photo is too big. The limit is 8 MB.", "avatar")
    data = _square_jpeg(upload.read())
    old = user.avatar.name if user.avatar else ""
    user.avatar_version += 1
    user.avatar.save(f"{user.pk}-{user.avatar_version}.jpg", ContentFile(data), save=False)
    User.objects.filter(pk=user.pk).update(avatar=user.avatar.name, avatar_version=user.avatar_version)
    if old:
        user.avatar.storage.delete(old)


def remove_avatar(user: User) -> None:
    if not user.avatar:
        return
    user.avatar.storage.delete(user.avatar.name)
    user.avatar = ""
    user.avatar_version += 1
    User.objects.filter(pk=user.pk).update(avatar="", avatar_version=user.avatar_version)


def avatar_url(user: User) -> str | None:
    """A link to the photo, for the owner and their friends only. Changes with every new photo."""
    if not user.avatar or user.deactivated_at is not None:
        return None
    # No timestamp in the signature: the same photo keeps the same link, so browsers cache it.
    token = signing.Signer(salt=AVATAR_SALT).sign_object([user.pk, user.avatar_version], compress=True)
    return reverse("avatar-file", args=[token])


def resolve_avatar(token: str) -> User | None:
    try:
        pk, version = signing.Signer(salt=AVATAR_SALT).unsign_object(token)
    except (signing.BadSignature, ValueError, TypeError):
        return None
    user = User.objects.filter(pk=pk, avatar_version=version, deactivated_at__isnull=True).first()
    return user if user and user.avatar else None
