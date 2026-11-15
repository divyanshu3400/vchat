import uuid

from django.conf import settings
from django.db import models


def _path(instance, filename):
    # Random names in date folders: nothing about the uploader or the original file leaks.
    return f"{instance.created_at:%Y/%m}/{instance.id.hex}{instance.extension}"


class Attachment(models.Model):
    """An uploaded file waiting to be (or already) sent in one message."""

    class Kind(models.TextChoices):
        IMAGE = "image", "Photo"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Voice note"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attachments")
    kind = models.CharField(max_length=5, choices=Kind.choices)
    file = models.FileField(upload_to=_path, max_length=200)
    mime = models.CharField(max_length=40)
    size = models.PositiveIntegerField()
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField()
    # Set once it is sent: an attachment goes into exactly one message.
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["owner", "-created_at"], name="attachment_owner")]

    @property
    def extension(self) -> str:
        return {
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
            "video/mp4": ".mp4",
            "video/webm": ".webm",
            "audio/webm": ".webm",
            "audio/ogg": ".ogg",
            "audio/mp4": ".m4a",
        }.get(self.mime, ".bin")
