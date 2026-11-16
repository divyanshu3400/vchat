import hashlib

from django.conf import settings
from django.db import models


class PushSubscription(models.Model):
    """One browser or installed app that accepted notifications."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.TextField()
    endpoint_hash = models.CharField(max_length=64, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_ok_at = models.DateTimeField(null=True, blank=True)
    failures = models.PositiveSmallIntegerField(default=0)

    @staticmethod
    def hash_endpoint(endpoint: str) -> str:
        return hashlib.sha256(endpoint.encode()).hexdigest()


class NotificationPrefs(models.Model):
    """What someone wants to be told about when vChat isn't on their screen."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_prefs")
    messages = models.BooleanField(default=True)
    requests = models.BooleanField(default=True)
    calls = models.BooleanField(default=True)
    # False: "New message from Asha" without the text.
    preview = models.BooleanField(default=True)
    # Emails about the account itself (e.g. a deletion was scheduled). Off unless turned on.
    email = models.BooleanField(default=False)

    FIELDS = ("messages", "requests", "calls", "preview", "email")

    @classmethod
    def of(cls, user_id: int) -> "NotificationPrefs":
        return cls.objects.filter(user_id=user_id).first() or cls(user_id=user_id)
