"""Automatic moderation that needs no moderator.

- Rooms: the same message three times in a minute, or more than three messages with links in a
  minute, mutes the sender in rooms for 10 minutes.
- Reports: three different people reporting someone within an hour takes them out of random chat
  for 24 hours (a moderator can let them back earlier).
- The worst slurs are refused everywhere (other swearing is only masked on screen).
"""

import hashlib
import re
import time
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

MUTE_SECONDS = 10 * 60
WINDOW = 60
SAME_TEXT_LIMIT = 3
LINK_LIMIT = 3
REPORTERS_FOR_SUSPENSION = 3
SUSPENSION = timedelta(hours=24)

LINK_RE = re.compile(r"(https?://|www\.)\S+", re.I)
# Hate slurs only. Ordinary swear words are masked by the app, not refused.
SLURS = re.compile(
    r"\b(n[i1!|]gg(?:[e3]r|a|ah)s?|f[a@4]gg?[o0]ts?|k[i1!]k[e3]s?|ch[i1!]nks?|sp[i1!]cs?|w[e3]tbacks?|ragh[e3]ads?"
    r"|tow[e3]lh[e3]ads?|trann(?:y|i[e3]s))\b",
    re.I,
)


def has_slur(text: str) -> bool:
    return bool(SLURS.search(text))


def muted_for(user_id: int) -> int:
    """Seconds of room mute left (0 = not muted)."""
    until = cache.get(f"mute:{user_id}")
    return max(0, int(until - time.time())) if until else 0


def _mute(user_id: int) -> int:
    cache.set(f"mute:{user_id}", time.time() + MUTE_SECONDS, MUTE_SECONDS)
    return MUTE_SECONDS


def check_room_message(user_id: int, text: str) -> int:
    """Call before posting in a room. Returns seconds of mute left, 0 if the message may go."""
    left = muted_for(user_id)
    if left:
        return left
    now = time.time()
    digest = hashlib.sha1(text.strip().lower().encode()).hexdigest()[:16]
    recent = [(h, t) for h, t in (cache.get(f"amsg:{user_id}") or []) if now - t < WINDOW]
    recent.append((digest, now))
    cache.set(f"amsg:{user_id}", recent[-20:], WINDOW)
    if sum(1 for h, _ in recent if h == digest) >= SAME_TEXT_LIMIT:
        return _mute(user_id)
    if LINK_RE.search(text):
        links = [t for t in (cache.get(f"alink:{user_id}") or []) if now - t < WINDOW] + [now]
        cache.set(f"alink:{user_id}", links, WINDOW)
        if len(links) > LINK_LIMIT:
            return _mute(user_id)
    return 0


def after_report(reported_user_id: int) -> bool:
    """Suspend from random chat when enough different people reported them lately. True if suspended."""
    from apps.accounts.models import User

    from .models import Report

    since = timezone.now() - timedelta(hours=1)
    reporters = (
        Report.objects.filter(reported_user_id=reported_user_id, created_at__gte=since)
        .values("reporter_id")
        .distinct()
        .count()
    )
    if reporters < REPORTERS_FOR_SUSPENSION:
        return False
    User.objects.filter(pk=reported_user_id).update(random_blocked_until=timezone.now() + SUSPENSION)
    return True
