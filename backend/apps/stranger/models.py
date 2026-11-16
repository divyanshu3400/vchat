import uuid

from django.conf import settings
from django.db import models


class StrangerSession(models.Model):
    """One random 1-on-1 chat. Kept after it ends so reports can be reviewed with the messages."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_a = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    user_b = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # When the two became friends, this chat was copied into their friend chat up to this message.
    carried_upto = models.BigIntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=["user_a", "-started_at"], name="stranger_user_a"),
            models.Index(fields=["user_b", "-started_at"], name="stranger_user_b"),
        ]

    def has_user(self, user_id: int) -> bool:
        return user_id in (self.user_a_id, self.user_b_id)


class StrangerMessage(models.Model):
    """Plaintext (enc_version=0), like room messages; stored for moderation of reports."""

    session = models.ForeignKey(StrangerSession, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    content = models.TextField(blank=True)
    # Voice notes, and photos after an unlock (Plus or a rewarded ad).
    attachment = models.OneToOneField(
        "media.Attachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="stranger_message"
    )
    enc_version = models.PositiveSmallIntegerField(default=0)
    reply_to = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["session", "id"], name="stranger_msg_session")]


class StrangerMessageReaction(models.Model):
    """One emoji per person per message; picking another replaces it."""

    message = models.ForeignKey(StrangerMessage, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="uniq_stranger_reaction")]
