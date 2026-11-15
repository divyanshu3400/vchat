from django.conf import settings
from django.db import models
from django.db.models import Q


class Room(models.Model):
    class Kind(models.TextChoices):
        REGION = "region", "Region"
        TOPIC = "topic", "Topic"

    slug = models.SlugField(max_length=48, unique=True)
    name = models.CharField(max_length=64)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    description = models.CharField(max_length=200, blank=True)
    # IANA zone shown as the room's local clock on region rooms, e.g. "Europe/London".
    timezone = models.CharField(max_length=48, blank=True)
    slow_mode_seconds = models.PositiveSmallIntegerField(default=0)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["kind", "sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class Message(models.Model):
    """One chat message. Stored as plaintext for now (enc_version=0).
    When end-to-end encryption arrives, new rows get enc_version>=1 and
    `content` holds ciphertext; old rows stay readable as-is.
    TODO(scale): range-partition by created_at (monthly) once volume warrants it."""

    class ContentType(models.TextChoices):
        TEXT = "text", "Text"
        SYSTEM = "system", "System"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages")
    content = models.TextField()
    content_type = models.CharField(max_length=10, choices=ContentType.choices, default=ContentType.TEXT)
    enc_version = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["room", "-id"], name="msg_room_id_desc")]

    def __str__(self) -> str:
        return f"{self.sender_id}@{self.room_id}: {self.content[:40]}"


class Block(models.Model):
    blocker = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocks_made")
    blocked = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocks_received")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blocked"], name="uniq_block"),
            models.CheckConstraint(condition=~Q(blocker=models.F("blocked")), name="no_self_block"),
        ]


class Report(models.Model):
    class Reason(models.TextChoices):
        SPAM = "spam", "Spam or bot"
        HARASSMENT = "harassment", "Harassment or hate"
        SEXUAL = "sexual", "Sexual content"
        UNDERAGE = "underage", "Looks under 18"
        SCAM = "scam", "Scam or asking for money"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACTIONED = "actioned", "Actioned"
        DISMISSED = "dismissed", "Dismissed"

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_made")
    reported_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_received"
    )
    message = models.ForeignKey(Message, on_delete=models.SET_NULL, null=True, blank=True)
    reason = models.CharField(max_length=12, choices=Reason.choices)
    note = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "-created_at"], name="report_queue")]
