from django.conf import settings
from django.db import models
from django.db.models import F, Q


def ordered_pair(a: int, b: int) -> tuple[int, int]:
    """Pairs of users are always stored lowest id first, so (a, b) and (b, a) are one row."""
    return (a, b) if a < b else (b, a)


class FriendRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        CANCELLED = "cancelled", "Cancelled"

    from_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friend_requests_sent"
    )
    to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friend_requests_received"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["from_user", "to_user"], condition=Q(status="pending"), name="uniq_pending_friend_request"
            ),
            models.CheckConstraint(condition=~Q(from_user=F("to_user")), name="no_self_friend_request"),
        ]
        indexes = [
            models.Index(fields=["to_user", "status"], name="freq_incoming"),
            models.Index(fields=["from_user", "status"], name="freq_outgoing"),
        ]


class Friendship(models.Model):
    user_a = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    user_b = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user_a", "user_b"], name="uniq_friendship"),
            models.CheckConstraint(condition=Q(user_a__lt=F("user_b")), name="friendship_ordered"),
        ]
        indexes = [models.Index(fields=["user_b"], name="friendship_user_b")]


class Conversation(models.Model):
    """A one-to-one DM thread. Each side keeps the id of the last message it has read."""

    user_a = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    user_b = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    last_message_at = models.DateTimeField(null=True, blank=True)
    a_last_read_id = models.BigIntegerField(default=0)
    b_last_read_id = models.BigIntegerField(default=0)
    # Messages here are deleted this many days after they were sent. Either person can change it.
    auto_delete_days = models.PositiveSmallIntegerField(default=7)
    auto_delete_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Each side's own choices: no notifications until then (far future = always), pinned on top.
    a_muted_until = models.DateTimeField(null=True, blank=True)
    b_muted_until = models.DateTimeField(null=True, blank=True)
    a_pinned_at = models.DateTimeField(null=True, blank=True)
    b_pinned_at = models.DateTimeField(null=True, blank=True)

    AUTO_DELETE_CHOICES = (1, 7, 30, 365)

    def has_user(self, user_id: int) -> bool:
        return user_id in (self.user_a_id, self.user_b_id)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user_a", "user_b"], name="uniq_conversation"),
            models.CheckConstraint(condition=Q(user_a__lt=F("user_b")), name="conversation_ordered"),
        ]
        indexes = [models.Index(fields=["user_b"], name="conversation_user_b")]


class DirectMessage(models.Model):
    """Plaintext for now (enc_version=0); same upgrade path to E2E encryption as room messages."""

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    content = models.TextField(blank=True)  # may be empty when a photo, video or voice note is attached
    attachment = models.OneToOneField(
        "media.Attachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="dm_message"
    )
    enc_version = models.PositiveSmallIntegerField(default=0)
    reply_to = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["conversation", "-id"], name="dm_conversation_id_desc")]


class DirectMessageReaction(models.Model):
    """One emoji per person per message; picking another replaces it."""

    message = models.ForeignKey(DirectMessage, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="uniq_dm_reaction")]
