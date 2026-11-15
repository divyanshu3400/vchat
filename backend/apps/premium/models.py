from django.conf import settings
from django.db import models


class RewardGrant(models.Model):
    """A feature unlocked by watching a rewarded ad: a number of uses within a time window."""

    class Kind(models.TextChoices):
        GENDER_FILTER = "gender_filter", "Women-only / men-only matching"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reward_grants")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    uses_left = models.PositiveSmallIntegerField()
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "kind", "-expires_at"], name="reward_active")]
