"""Who may use paid features: Plus members always; others with an unused rewarded-ad grant.

Web rewarded ads report "watched" to the browser only (there is no server-to-server proof),
so a client could claim rewards without watching. The daily cap keeps that cheap: the most
anyone can take is REWARDS_PER_DAY small grants.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.accounts.models import User

from .models import RewardGrant

# What one watched ad gives.
REWARDS = {
    RewardGrant.Kind.GENDER_FILTER: {"uses": 15, "minutes": 120},
    RewardGrant.Kind.RANDOM_PHOTOS: {"uses": 3, "minutes": 30},
}


class RewardError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _active(user: User, kind: str):
    return RewardGrant.objects.filter(user=user, kind=kind, uses_left__gt=0, expires_at__gt=timezone.now())


def is_plus_now(user: User) -> bool:
    """Reads the database, not the (possibly hours-old) user object a socket holds."""
    return User.objects.filter(pk=user.pk, plus_until__gt=timezone.now()).exists()


def can_use(user: User, kind: str) -> bool:
    return is_plus_now(user) or _active(user, kind).exists()


def consume(user: User, kind: str) -> bool:
    """Use one unit of `kind`. Plus members never spend anything. False if not allowed."""
    if is_plus_now(user):
        return True
    with transaction.atomic():
        grant = _active(user, kind).select_for_update().order_by("expires_at").first()
        if grant is None:
            return False
        RewardGrant.objects.filter(pk=grant.pk).update(uses_left=F("uses_left") - 1)
    return True


def grant_reward(user: User, kind: str) -> RewardGrant:
    if not settings.VCHAT["REWARDED_ADS"]:
        raise RewardError("unavailable", "Rewarded ads aren't available right now.")
    if kind not in REWARDS:
        raise RewardError("invalid", "That can't be unlocked with an ad.")
    since = timezone.now() - timedelta(days=1)
    if RewardGrant.objects.filter(user=user, created_at__gte=since).count() >= settings.VCHAT["REWARDS_PER_DAY"]:
        raise RewardError("daily_limit", "You've used today's free unlocks. Try again tomorrow, or get vChat Plus.")
    spec = REWARDS[kind]
    return RewardGrant.objects.create(
        user=user, kind=kind, uses_left=spec["uses"], expires_at=timezone.now() + timedelta(minutes=spec["minutes"])
    )


def status(user: User) -> dict:
    grants = {}
    for kind in REWARDS:
        active = list(_active(user, kind).order_by("expires_at"))
        grants[kind] = (
            {"uses_left": sum(g.uses_left for g in active), "expires_at": active[-1].expires_at.isoformat()}
            if active
            else None
        )
    return {
        "plus": user.is_plus,
        "plus_until": user.plus_until.isoformat() if user.is_plus else None,
        "grants": grants,
        "rewarded_ads": settings.VCHAT["REWARDED_ADS"],
    }
