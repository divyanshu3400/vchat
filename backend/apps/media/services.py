"""Checking, storing and handing out attachments.

- The type comes from the file's own bytes, never from its name or the browser's claim.
- Photos are decoded and re-encoded as JPEG (max 1600 px): this drops EXIF data (camera,
  GPS location) and anything hidden after the image data.
- Videos and voice notes are stored as uploaded, within size limits (no transcoding yet).
- Files are only reachable through signed links that expire.
"""

import io

from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.urls import reverse
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import Attachment

MAX_BYTES = {"image": 8 * 1024 * 1024, "video": 25 * 1024 * 1024, "audio": 3 * 1024 * 1024}
MAX_IMAGE_SIDE = 1600
SIGNER_SALT = "vchat.media"

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


def store_upload(owner, kind: str, upload) -> Attachment:
    if kind not in MAX_BYTES:
        raise UploadError("Unknown kind of file.")
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
        if sniffed not in ("webm", "audio/ogg", "audio/mp4", "video/mp4"):
            raise UploadError("That recording couldn't be read.")
        mime = {"webm": "audio/webm", "audio/ogg": "audio/ogg"}.get(sniffed, "audio/mp4")

    attachment = Attachment(owner=owner, kind=kind, mime=mime, size=len(data), width=width, height=height, created_at=timezone.now())
    attachment.file.save("upload", ContentFile(data), save=False)
    attachment.save()
    return attachment


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
    return Attachment.objects.filter(id=hex_id, used_at__isnull=False).first()


def payload(attachment: Attachment | None) -> dict | None:
    if attachment is None:
        return None
    return {
        "id": str(attachment.id),
        "kind": attachment.kind,
        "mime": attachment.mime,
        "url": signed_url(attachment),
        "width": attachment.width,
        "height": attachment.height,
        "size": attachment.size,
    }
