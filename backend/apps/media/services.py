"""Checking, storing and handing out attachments.

- The type comes from the file's own bytes, never from its name or the browser's claim.
- Photos are decoded and re-encoded as JPEG (max 1600 px): this drops EXIF data (camera,
  GPS location) and anything hidden after the image data.
- Videos and voice notes are stored as uploaded, within size limits (no transcoding yet).
- Files are only reachable through signed links that expire.
- Disappearing media (view once, 10/20/30 s, voice twice) never has a link in a message: the
  recipient asks open_timed() for a short-lived one, and the count is kept here, not by the app.
"""

import io
import secrets
import time

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db.models import F
from django.db.models.functions import Coalesce
from django.urls import reverse
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import Attachment

MAX_BYTES = {"image": 8 * 1024 * 1024, "video": 25 * 1024 * 1024, "audio": 10 * 1024 * 1024}
MAX_IMAGE_SIDE = 1600
SIGNER_SALT = "vchat.media"
TIMED_SALT = "vchat.media.timed"
VIEW_MODES = {"image": ("once", "10", "20", "30"), "video": ("once", "10", "20", "30"), "audio": ("twice",)}
# How long an opened link works. A photo's link works once (the app downloads it, then shows it).
TIMED_LINK_SECONDS = {"image": 60, "video": 15 * 60, "audio": 15 * 60}

Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs


class UploadError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def _sniff(head: bytes) -> str | None:
    """Real type from magic bytes."""
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        return "audio/mp4" if brand in (b"M4A ", b"M4B ") else "video/mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"  # container shared by video and audio; the declared kind decides
    if head[:4] == b"OggS":
        return "audio/ogg"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0 and head[1] & 0x06):
        return "audio/mpeg"  # MP3: ID3 tag or an MPEG frame (layer bits set, which rules out AAC/ADTS)
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    return None


def _process_image(data: bytes) -> tuple[bytes, int, int]:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise UploadError("That photo couldn't be read. Try a JPEG or PNG.")
    img = ImageOps.exif_transpose(img)  # keep the photo upright once EXIF is gone
    if img.mode not in ("RGB", "L"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.convert("RGBA").split()[-1])
        img = background
    img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=85, optimize=True)  # no exif= : metadata is not written
    return out.getvalue(), img.width, img.height


def max_views(attachment: Attachment) -> int:
    return 2 if attachment.view_mode == "twice" else 1


def view_seconds(attachment: Attachment) -> int | None:
    """Seconds on screen for a timed photo or video; None when it stays until closed."""
    return int(attachment.view_mode) if attachment.view_mode.isdigit() else None


def store_upload(owner, kind: str, upload, view: str = "") -> Attachment:
    if kind not in MAX_BYTES:
        raise UploadError("Unknown kind of file.")
    if view and view not in VIEW_MODES[kind]:
        raise UploadError("That timer isn't available for this file.")
    if upload.size > MAX_BYTES[kind]:
        raise UploadError(f"That file is too big. The limit is {MAX_BYTES[kind] // (1024 * 1024)} MB.")
    data = upload.read()
    sniffed = _sniff(data[:16])

    width = height = None
    if kind == "image":
        if sniffed not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            raise UploadError("Photos must be JPEG, PNG, WebP or GIF.")
        data, width, height = _process_image(data)
        mime = "image/jpeg"
    elif kind == "video":
        if sniffed not in ("video/mp4", "webm"):
            raise UploadError("Videos must be MP4 or WebM.")
        mime = "video/webm" if sniffed == "webm" else "video/mp4"
    else:
        if sniffed not in ("webm", "audio/ogg", "audio/mp4", "video/mp4", "audio/mpeg", "audio/wav"):
            raise UploadError("Audio must be MP3, M4A, WAV, OGG or WebM.")
        mime = {"webm": "audio/webm", "video/mp4": "audio/mp4"}.get(sniffed, sniffed)

    attachment = Attachment(
        owner=owner, kind=kind, mime=mime, size=len(data), width=width, height=height, created_at=timezone.now(), view_mode=view
    )
    attachment.file.save("upload", ContentFile(data), save=False)
    attachment.save()
    return attachment


def pending_kind(owner_id: int, attachment_id) -> str | None:
    """Kind of an unsent upload of this user ("image", "video", "audio"), else None."""
    try:
        return (
            Attachment.objects.filter(id=attachment_id, owner_id=owner_id, used_at__isnull=True)
            .values_list("kind", flat=True)
            .first()
        )
    except (ValueError, ValidationError):
        return None


def claim_for_message(owner_id: int, attachment_id, allowed_kinds: tuple[str, ...]) -> Attachment:
    """Mark an unused attachment of this user as sent. Raises UploadError if it can't be used."""
    updated = Attachment.objects.filter(
        id=attachment_id, owner_id=owner_id, used_at__isnull=True, kind__in=allowed_kinds
    ).update(used_at=timezone.now())
    if not updated:
        raise UploadError("That file can't be sent here.")
    return Attachment.objects.get(id=attachment_id)


def signed_url(attachment: Attachment) -> str:
    token = signing.TimestampSigner(salt=SIGNER_SALT).sign(attachment.id.hex)
    return reverse("media-file", kwargs={"token": token})


def resolve(token: str) -> Attachment | None:
    try:
        hex_id = signing.TimestampSigner(salt=SIGNER_SALT).unsign(token, max_age=settings.VCHAT["MEDIA_LINK_SECONDS"])
    except signing.BadSignature:  # also covers expired links
        return None
    # Disappearing media has no lasting link (see open_timed).
    return Attachment.objects.filter(id=hex_id, used_at__isnull=False, view_mode="").first()


class OpenError(Exception):
    def __init__(self, code: str, detail: str, status: int = 400):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status = status


def _chat_of(attachment: Attachment):
    """(message, the two people in its chat) or (None, ())."""
    for name, chat in (("dm_message", "conversation"), ("stranger_message", "session")):
        message = getattr(attachment, name, None)  # reverse one-to-one: missing raises AttributeError
        if message is not None:
            room = getattr(message, chat)
            return message, (room.user_a_id, room.user_b_id)
    return None, ()


def open_timed(user, attachment_id) -> tuple[dict, tuple[int, ...]]:
    """The recipient opens disappearing media: counts the view and returns a short-lived link.
    Returns (response, the two people in the chat, who are told it was opened)."""
    try:
        attachment = Attachment.objects.filter(id=attachment_id, used_at__isnull=False).exclude(view_mode="").first()
    except (ValueError, ValidationError):
        attachment = None
    if attachment is None:
        raise OpenError("not_found", "That file isn't available.", 404)
    message, people = _chat_of(attachment)
    if message is None or message.deleted_at or user.id not in people or message.sender_id == user.id:
        raise OpenError("not_found", "That file isn't available.", 404)
    if not attachment.file:
        raise OpenError("gone", "This has expired.", 410)
    limit = max_views(attachment)
    counted = Attachment.objects.filter(id=attachment.id, views__lt=limit).update(
        views=F("views") + 1, opened_at=Coalesce(F("opened_at"), timezone.now())
    )
    if not counted:
        raise OpenError("spent", "You've already opened this.", 410)

    nonce = secrets.token_urlsafe(9)
    ttl = TIMED_LINK_SECONDS[attachment.kind]
    if attachment.kind == "image":
        cache.set(f"mediaonce:{nonce}", 1, ttl)
    token = signing.dumps({"a": attachment.id.hex, "n": nonce, "e": int(time.time()) + ttl}, salt=TIMED_SALT, compress=True)
    data = {
        "url": reverse("media-timed", kwargs={"token": token}),
        "seconds": view_seconds(attachment),
        "views_left": limit - attachment.views - 1,
    }
    return data, people


def resolve_timed(token: str) -> Attachment | None:
    """A link from open_timed(): before it expires, and a photo's only once."""
    try:
        data = signing.loads(token, salt=TIMED_SALT)
    except signing.BadSignature:
        return None
    if not isinstance(data, dict) or data.get("e", 0) < time.time():
        return None
    attachment = Attachment.objects.filter(id=data.get("a"), used_at__isnull=False).exclude(view_mode="").first()
    if attachment is None or not attachment.file:
        return None
    if attachment.kind == "image" and not cache.delete(f"mediaonce:{data.get('n')}"):
        return None
    return attachment


def payload(attachment: Attachment | None) -> dict | None:
    if attachment is None:
        return None
    out = {
        "id": str(attachment.id),
        "kind": attachment.kind,
        "mime": attachment.mime,
        "url": signed_url(attachment),
        "width": attachment.width,
        "height": attachment.height,
        "size": attachment.size,
    }
    if attachment.view_mode:
        # No link: the recipient opens it through open_timed(), the sender can't open it again.
        left = max(0, max_views(attachment) - attachment.views) if attachment.file else 0
        out.update(url="", view=attachment.view_mode, views_left=left, opened=attachment.views > 0)
    return out
