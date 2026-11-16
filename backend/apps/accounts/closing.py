"""Deactivating and deleting accounts.

- Deactivate: signed out everywhere at once. Everyone else sees "vChat user" and "********"
  instead of the name and messages (rooms, friend chats, random chats, replies). Logging in
  again brings everything back.
- Delete (saved accounts): deactivated now, erased DELETE_GRACE later unless the person logs
  in before that. Guests can't log in again, so a guest is erased at once.
- Erase: email, password, name, device and IP traces go; friendships, requests and push
  devices go. The user row and the messages stay (still shown only as "********"), so chats
  keep their shape and reports can still be checked. Ban marks stay: deleting an account
  doesn't lift a ban.
"""

import logging
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .models import EmailCode, User
from .moderation import account_group

log = logging.getLogger(__name__)

GONE_NAME = "vChat user"
MASK = "********"
DELETE_GRACE = timedelta(days=15)


def is_gone(user) -> bool:
    """Deactivated or deleted: shown to others as GONE_NAME / MASK."""
    return user is not None and user.deactivated_at is not None


def public_user(user) -> dict:
    """What other people get to see of an account."""
    if is_gone(user):
        return {"id": user.id, "nickname": GONE_NAME, "gender": "", "inactive": True}
    return {"id": user.id, "nickname": user.nickname, "gender": user.gender, "handle": user.handle or ""}


# --- deactivate / reactivate -------------------------------------------------------


def _people_who_see(user_id: int) -> set[int]:
    from apps.social.models import Conversation, Friendship

    out: set[int] = set()
    for a, b in Friendship.objects.filter(Q(user_a_id=user_id) | Q(user_b_id=user_id)).values_list("user_a_id", "user_b_id"):
        out.add(b if a == user_id else a)
    for a, b in Conversation.objects.filter(Q(user_a_id=user_id) | Q(user_b_id=user_id)).values_list("user_a_id", "user_b_id"):
        out.add(b if a == user_id else a)
    out.discard(user_id)
    return out


def _announce(user_id: int, close_sockets: bool) -> None:
    """Friends' and chat partners' apps reload names and chats; the account's own sockets close."""
    from apps.chat.realtime import push_to_user

    for uid in _people_who_see(user_id):
        push_to_user(uid, {"type": "conversations.changed"})
    layer = get_channel_layer()
    if close_sockets and layer is not None:
        async_to_sync(layer.group_send)(account_group(user_id), {"type": "account.closed"})


def deactivate(user: User, *, delete: bool = False) -> None:
    from apps.push.models import PushSubscription
    from apps.social.models import FriendRequest

    now = timezone.now()
    with transaction.atomic():
        User.objects.filter(pk=user.pk).update(
            is_active=False,
            deactivated_at=now,
            delete_after=now + DELETE_GRACE if delete else None,
            # Every signed-in device stops refreshing.
            session_version=F("session_version") + 1,
        )
        FriendRequest.objects.filter(Q(from_user=user) | Q(to_user=user), status=FriendRequest.Status.PENDING).delete()
        PushSubscription.objects.filter(user=user).delete()
        transaction.on_commit(lambda: _announce(user.pk, close_sockets=True))
    user.refresh_from_db()
    if delete:
        _email_deletion_notice(user)


def reactivate(user: User) -> bool:
    """On login. Returns True when this cancelled a scheduled deletion."""
    if user.deactivated_at is None or user.deleted_at is not None:
        return False
    cancelled = user.delete_after is not None
    User.objects.filter(pk=user.pk).update(is_active=True, deactivated_at=None, delete_after=None)
    user.is_active, user.deactivated_at, user.delete_after = True, None, None
    transaction.on_commit(lambda: _announce(user.pk, close_sockets=False))
    return cancelled


def can_log_in_again(user: User) -> bool:
    return user.deleted_at is None and not user.is_guest


def _email_deletion_notice(user: User) -> None:
    """Only to people who turned on account emails (Me > Notifications)."""
    from apps.push.models import NotificationPrefs

    if not (settings.EMAIL_ENABLED and user.email and NotificationPrefs.of(user.id).email):
        return
    when = f"{user.delete_after:%d %b %Y}"
    try:
        send_mail(
            f"Your vChat account will be deleted on {when}",
            f"Hi {user.nickname},\n\n"
            f"You asked us to delete your vChat account. It's deactivated now and will be deleted for good on {when}.\n\n"
            "Changed your mind? Just log in before then and everything comes back.\n\n"
            "If this wasn't you, log in and change your password.\n\n- vChat",
            None,
            [user.email],
        )
    except Exception:  # the deletion goes ahead either way
        log.exception("deletion notice email failed for user %s", user.pk)


# --- erase -------------------------------------------------------------------------------


def erase(user: User) -> None:
    """For good. Messages stay in place (shown as "********"); everything that identifies the person goes."""
    from apps.push.models import NotificationPrefs, PushSubscription
    from apps.social.models import FriendRequest, Friendship

    now = timezone.now()
    with transaction.atomic():
        people = _people_who_see(user.pk)
        Friendship.objects.filter(Q(user_a=user) | Q(user_b=user)).delete()
        FriendRequest.objects.filter(Q(from_user=user) | Q(to_user=user)).delete()
        PushSubscription.objects.filter(user=user).delete()
        NotificationPrefs.objects.filter(user=user).delete()
        EmailCode.objects.filter(user=user).delete()
        user.username = f"deleted_{user.pk}"
        user.email = ""
        user.nickname = GONE_NAME
        user.handle = None
        user.previous_handle = ""
        if user.avatar:
            user.avatar.storage.delete(user.avatar.name)
            user.avatar = ""
        user.gender = ""
        user.first_name = user.last_name = ""
        user.set_unusable_password()
        user.plus_until = None
        user.device_hash = ""
        user.last_ip_hash = ""
        user.is_active = False
        user.deactivated_at = user.deactivated_at or now
        user.delete_after = None
        user.deleted_at = now
        user.session_version += 1
        user.save()

        def tell():
            from apps.chat.realtime import push_to_user

            for uid in people:
                push_to_user(uid, {"type": "conversations.changed"})
            layer = get_channel_layer()
            if layer is not None:
                async_to_sync(layer.group_send)(account_group(user.pk), {"type": "account.closed"})

        transaction.on_commit(tell)


def erase_due(now=None) -> int:
    """Accounts whose 15 days are over (purge_old_data, hourly)."""
    now = now or timezone.now()
    due = User.objects.filter(delete_after__lte=now, deleted_at__isnull=True, deactivated_at__isnull=False)
    count = 0
    for user in due.iterator():
        erase(user)
        count += 1
    return count
