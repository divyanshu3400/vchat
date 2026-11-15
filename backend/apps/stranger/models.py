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
    content = models.TextField()
    enc_version = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["session", "id"], name="stranger_msg_session")]
