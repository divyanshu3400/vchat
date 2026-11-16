"""Bans, and keeping banned people from coming straight back.

A ban sets User.banned_until (a far date for "permanent") and a reason. While it lasts the API
answers 403 {"code": "banned"}, sign-in and refresh are refused, and open sockets are closed at
once. The browser's device cookie (for the whole ban) and the last IP (for at most a day: phone
networks share IPs) are marked, so the same person can't simply start a new guest account.
"""

import hashlib
import hmac
import secrets
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import BasePermission
from rest_framework.throttling import SimpleRateThrottle

from .models import BanMark, User

DEVICE_COOKIE = "vchat_dev"
DEVICE_COOKIE_AGE = 2 * 365 * 24 * 3600
IP_MARK_MAX = timedelta(hours=24)
PERMANENT = timedelta(days=365 * 100)


def digest(value: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"vchat:{value}".encode(), hashlib.sha256).hexdigest()


def client_ip(request) -> str:
    """The visitor's IP, trusting exactly the proxies in NUM_PROXIES (same as the rate limits)."""
    return _IpReader().get_ident(request) or ""


class _IpReader(SimpleRateThrottle):
    """Only borrows DRF's get_ident (X-Forwarded-For with NUM_PROXIES); never throttles."""

    rate = "1/s"

    def get_cache_key(self, request, view):
        return None


def account_group(user_id: int) -> str:
    """Every socket of a user joins this group, so a ban can close them all."""
    return f"acct.{user_id}"


def ban_payload(user: User) -> dict:
    permanent = user.banned_until and user.banned_until - timezone.now() > timedelta(days=3650)
    when = "for good" if permanent else f"until {user.banned_until:%d %b %Y, %H:%M} UTC"
    reason = f" Reason: {user.ban_reason}." if user.ban_reason else ""
    return {
        "code": "banned",
        "detail": f"This account is banned {when}.{reason} If you think this is a mistake, write to us on the contact page.",
        "until": user.banned_until.isoformat() if user.banned_until else None,
    }


def ban(user: User, duration: timedelta | None, reason: str) -> None:
    """duration None = permanent. Ends Plus too (see the terms)."""
    now = timezone.now()
    until = now + (duration or PERMANENT)
    User.objects.filter(pk=user.pk).update(banned_until=until, ban_reason=reason[:200], plus_until=None)
    user.banned_until, user.ban_reason, user.plus_until = until, reason[:200], None
    if user.device_hash:
        BanMark.objects.create(kind=BanMark.Kind.DEVICE, value_hash=user.device_hash, until=until, user=user)
    if user.last_ip_hash:
        BanMark.objects.create(kind=BanMark.Kind.IP, value_hash=user.last_ip_hash, until=min(until, now + IP_MARK_MAX), user=user)
    layer = get_channel_layer()
    if layer is not None:
        async_to_sync(layer.group_send)(account_group(user.pk), {"type": "account.banned"})


def unban(user: User) -> None:
    User.objects.filter(pk=user.pk).update(banned_until=None, ban_reason="")
    BanMark.objects.filter(user=user, until__gt=timezone.now()).update(until=timezone.now())
    user.banned_until, user.ban_reason = None, ""


def evading(device_hash: str, ip_hash: str) -> bool:
    """Is this browser or IP under someone's ban right now?"""
    values = [v for v in (device_hash, ip_hash) if v]
    return bool(values) and BanMark.objects.filter(value_hash__in=values, until__gt=timezone.now()).exists()


def device_of(request) -> tuple[str, str | None]:
    """(hash of this browser's device id, a new raw id to set as a cookie, or None if it has one)."""
    raw = request.COOKIES.get(DEVICE_COOKIE, "")
    if raw and len(raw) <= 64:
        return digest(raw), None
    raw = secrets.token_urlsafe(24)
    return digest(raw), raw


def set_device_cookie(response, raw: str | None) -> None:
    if raw:
        response.set_cookie(
            DEVICE_COOKIE, raw, max_age=DEVICE_COOKIE_AGE, httponly=True, secure=not settings.DEBUG,
            samesite="Lax", path="/api/auth/",
        )


def remember_device(user: User, request) -> str | None:
    """Store this browser's device and IP hashes on the account. Returns a new device id to set, if any."""
    device_hash, new_raw = device_of(request)
    ip = client_ip(request)
    updates = {}
    if user.device_hash != device_hash:
        updates["device_hash"] = device_hash
    ip_hash = digest(ip) if ip else ""
    if ip_hash and user.last_ip_hash != ip_hash:
        updates["last_ip_hash"] = ip_hash
    if updates:
        User.objects.filter(pk=user.pk).update(**updates)
        for k, v in updates.items():
            setattr(user, k, v)
    return new_raw


class NotBanned(BasePermission):
    """Default permission next to IsAuthenticated: a banned account can't use the API."""

    def has_permission(self, request, view):
        user = request.user
        if user and user.is_authenticated and getattr(user, "is_banned", False):
            self.message = ban_payload(user)
            return False
        return True
