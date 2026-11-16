"""Sending notifications to phones and browsers (Web Push with VAPID).

Only when vChat isn't on the person's screen (no tab of theirs is visible), only for what they
switched on, at most one notification per chat every 30 seconds (the next one replaces it), and
always in the background so a message is never slowed down by it.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections
from django.utils import timezone

from apps.chat import presence

from .models import NotificationPrefs, PushSubscription

log = logging.getLogger(__name__)
COLLAPSE_SECONDS = 30
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")


def enabled() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def notify(user_id: int, kind: str, *, title: str, body: str, url: str, tag: str, private_body: str = "") -> None:
    """kind: "messages" | "requests" | "calls" (the switch it belongs to). `private_body` is shown
    instead of `body` to people who hide message text."""
    if not enabled() or presence.is_looking(user_id):
        return
    if not cache.add(f"pushc:{user_id}:{tag}", 1, COLLAPSE_SECONDS):
        return
    if settings.PUSH_SYNC:
        _deliver(user_id, kind, title, body, url, tag, private_body)
    else:
        _pool.submit(_deliver, user_id, kind, title, body, url, tag, private_body)


def _deliver(user_id, kind, title, body, url, tag, private_body):
    from pywebpush import WebPushException, webpush

    close_old_connections()
    try:
        prefs = NotificationPrefs.of(user_id)
        if not getattr(prefs, kind, True):
            return
        data = json.dumps(
            {
                "title": title,
                "body": body if prefs.preview or not private_body else private_body,
                "url": url,
                "tag": tag,
                "badge": _unread_total(user_id),
            }
        )
        for sub in PushSubscription.objects.filter(user_id=user_id):
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=data,
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": settings.VAPID_SUBJECT},
                    ttl=24 * 3600,
                    timeout=10,
                )
                PushSubscription.objects.filter(pk=sub.pk).update(last_ok_at=timezone.now(), failures=0)
            except WebPushException as exc:
                status = getattr(exc.response, "status_code", None)
                if status in (404, 410):  # unsubscribed or expired: forget it
                    sub.delete()
                else:
                    PushSubscription.objects.filter(pk=sub.pk).update(failures=sub.failures + 1)
                    log.warning("push to user %s failed: %s", user_id, status or exc)
            except Exception:
                log.exception("push to user %s failed", user_id)
    finally:
        close_old_connections()


def _unread_total(user_id: int) -> int:
    from apps.accounts.models import User
    from apps.social.services import conversations_of

    user = User.objects.filter(pk=user_id).first()
    return sum(c["unread"] for c in conversations_of(user)) if user else 0
