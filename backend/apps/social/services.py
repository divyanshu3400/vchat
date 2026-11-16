"""Friends and direct messages. Views and the personal socket call these; nothing else writes these tables."""

from datetime import timedelta

from django.db import transaction
from django.db.models import Case, Count, IntegerField, OuterRef, Q, Subquery, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from django.core.exceptions import ValidationError

from apps.accounts import closing
from apps.gifs.services import label as gif_label
from apps.accounts.models import User
from apps.chat import message_ops, presence
from apps.media import services as media
from apps.chat.models import Block
from apps.chat.realtime import push_to_user
from apps.push import events as push_events

from .models import Conversation, DirectMessage, FriendRequest, Friendship, ordered_pair

MAX_PENDING_OUTGOING = 50


class SocialError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def brief(user: User) -> dict:
    # A deactivated or deleted account shows as "vChat user".
    return closing.public_user(user)


def request_payload(req: FriendRequest) -> dict:
    return {
        "id": req.id,
        "from_user": brief(req.from_user),
        "to_user": brief(req.to_user),
        "created_at": req.created_at.isoformat(),
    }


def dm_payload(message: DirectMessage, recipient_id: int) -> dict:
    return {
        "id": message.id,
        "sender": brief(message.sender),
        "recipient_id": recipient_id,
        "content": message_ops.visible_content(message),
        # fresh signed link each time; none once deleted (or from a closed account)
        "attachment": None if message_ops.hides_attachment(message) else media.payload(message.attachment),
        "created_at": message.created_at.isoformat(),
        **message_ops.extras(message),
    }


def _load_dm(message_id) -> DirectMessage | None:
    if not isinstance(message_id, int) or isinstance(message_id, bool):
        return None
    select, prefetch = message_ops.related_fields(DirectMessage)
    return (
        DirectMessage.objects.select_related("conversation", *select)
        .prefetch_related(*prefetch)
        .filter(id=message_id)
        .first()
    )


def change_dm(user: User, kind: str, message_id, value=None) -> tuple[dict, int]:
    """React to, edit or delete a message in one of your chats. Returns (payload, partner id)."""
    message = _load_dm(message_id)
    if message is None or user.id not in (message.conversation.user_a_id, message.conversation.user_b_id):
        raise SocialError("not_found", "That message is gone.")
    c = message.conversation
    partner_id = c.user_b_id if c.user_a_id == user.id else c.user_a_id
    try:
        if kind == "react":
            if is_blocked_between(user.id, partner_id):
                raise SocialError("not_found", "That message is gone.")
            message_ops.react(message, user, value)
        elif kind == "edit":
            message_ops.edit(message, user, value)
        else:
            message_ops.delete(message, user)
    except message_ops.MessageOpError as exc:
        raise SocialError(exc.code, exc.detail)
    message = _load_dm(message.id)
    return dm_payload(message, partner_id if message.sender_id == user.id else user.id), partner_id


ATTACHMENT_PREVIEW = {"image": "📷 Photo", "video": "🎬 Video", "audio": "🎤 Voice note"}


def is_blocked_between(a: int, b: int) -> bool:
    return Block.objects.filter(Q(blocker_id=a, blocked_id=b) | Q(blocker_id=b, blocked_id=a)).exists()


def are_friends(a: int, b: int) -> bool:
    x, y = ordered_pair(a, b)
    return Friendship.objects.filter(user_a_id=x, user_b_id=y).exists()


def _on_commit_push(user_id: int, payload: dict) -> None:
    transaction.on_commit(lambda: push_to_user(user_id, payload))


# --- friend requests ------------------------------------------------------


def send_friend_request(sender: User, target: User) -> tuple[str, FriendRequest | None]:
    """Returns ("pending", request) or ("accepted", None) when the target had already asked."""
    if sender.id == target.id:
        raise SocialError("invalid", "You can't add yourself.")
    # Same answer for blocked and inactive users, so a block is never revealed.
    if not target.is_active or is_blocked_between(sender.id, target.id):
        raise SocialError("not_allowed", "You can't add this user.")
    if are_friends(sender.id, target.id):
        raise SocialError("already_friends", f"You're already friends with {target.nickname}.")

    with transaction.atomic():
        reverse = (
            FriendRequest.objects.select_for_update()
            .select_related("from_user", "to_user")
            .filter(from_user=target, to_user=sender, status=FriendRequest.Status.PENDING)
            .first()
        )
        if reverse:
            _accept(reverse)
            return "accepted", None

        existing = FriendRequest.objects.filter(
            from_user=sender, to_user=target, status=FriendRequest.Status.PENDING
        ).first()
        if existing:
            return "pending", existing

        pending = FriendRequest.objects.filter(from_user=sender, status=FriendRequest.Status.PENDING).count()
        if pending >= MAX_PENDING_OUTGOING:
            raise SocialError("too_many", "You have too many requests waiting. Cancel some or wait for answers.")

        req = FriendRequest.objects.create(from_user=sender, to_user=target)
        event = {"type": "friend_request", "request": request_payload(req)}
        _on_commit_push(target.id, event)
        _on_commit_push(sender.id, event)  # sender's other tabs
        transaction.on_commit(lambda: push_events.friend_request(target.id, sender.nickname))
    return "pending", req


def _accept(req: FriendRequest) -> None:
    req.status = FriendRequest.Status.ACCEPTED
    req.responded_at = timezone.now()
    req.save(update_fields=["status", "responded_at"])
    x, y = ordered_pair(req.from_user_id, req.to_user_id)
    Friendship.objects.get_or_create(user_a_id=x, user_b_id=y)
    online = presence.online_among([req.from_user_id, req.to_user_id])
    _on_commit_push(
        req.from_user_id,
        {"type": "friend_added", "friend": brief(req.to_user), "online": req.to_user_id in online, "request_id": req.id},
    )
    _on_commit_push(
        req.to_user_id,
        {"type": "friend_added", "friend": brief(req.from_user), "online": req.from_user_id in online, "request_id": req.id},
    )
    transaction.on_commit(lambda: push_events.request_accepted(req.from_user_id, req.to_user_id, req.to_user.nickname))
    # Met in random chat? That chat continues in their friend chat.
    from apps.stranger.services import carry_recent_chat

    transaction.on_commit(lambda: carry_recent_chat(req.from_user_id, req.to_user_id))


def respond_to_request(req_id: int, user: User, action: str) -> None:
    """accept / decline (recipient only) or cancel (sender only)."""
    with transaction.atomic():
        req = (
            FriendRequest.objects.select_for_update()
            .select_related("from_user", "to_user")
            .filter(id=req_id, status=FriendRequest.Status.PENDING)
            .first()
        )
        allowed = req and (
            (action in ("accept", "decline") and req.to_user_id == user.id)
            or (action == "cancel" and req.from_user_id == user.id)
        )
        if not allowed:
            raise SocialError("not_found", "That request isn't waiting any more.")

        if action == "accept":
            _accept(req)
            return
        req.status = FriendRequest.Status.DECLINED if action == "decline" else FriendRequest.Status.CANCELLED
        req.responded_at = timezone.now()
        req.save(update_fields=["status", "responded_at"])
        # Declines are silent: the sender just sees the request disappear.
        for uid in (req.from_user_id, req.to_user_id):
            _on_commit_push(uid, {"type": "friend_request_removed", "request_id": req.id})


def pending_requests(user: User) -> dict:
    qs = FriendRequest.objects.filter(status=FriendRequest.Status.PENDING).select_related("from_user", "to_user")
    return {
        "incoming": [request_payload(r) for r in qs.filter(to_user=user).order_by("-created_at")],
        "outgoing": [request_payload(r) for r in qs.filter(from_user=user).order_by("-created_at")],
    }


# --- friendships ----------------------------------------------------------


def friend_ids(user_id: int) -> list[int]:
    rows = Friendship.objects.filter(Q(user_a_id=user_id) | Q(user_b_id=user_id)).values_list("user_a_id", "user_b_id")
    return [b if a == user_id else a for a, b in rows]


def friends_of(user: User) -> list[dict]:
    rows = Friendship.objects.filter(Q(user_a=user) | Q(user_b=user)).select_related("user_a", "user_b")
    others = [(f.user_b if f.user_a_id == user.id else f.user_a, f.created_at) for f in rows]
    # Deactivated friends stay listed (as "vChat user"); accounts disabled by an admin don't.
    others = [(u, since) for u, since in others if u.is_active or closing.is_gone(u)]
    online = visible_online(user, [u.id for u, _ in others])
    friends = [
        {"user": brief(u), "since": since.isoformat(), "online": u.id in online, "last_seen": last_seen_for(user, u, u.id in online)}
        for u, since in others
    ]
    return sorted(friends, key=lambda f: f["user"]["nickname"].lower())


def unfriend(user: User, other_id: int) -> bool:
    x, y = ordered_pair(user.id, other_id)
    with transaction.atomic():
        deleted, _ = Friendship.objects.filter(user_a_id=x, user_b_id=y).delete()
        if deleted:
            _on_commit_push(user.id, {"type": "friend_removed", "user_id": other_id})
            _on_commit_push(other_id, {"type": "friend_removed", "user_id": user.id})
    return bool(deleted)


def remove_social_links(a: User, b: User) -> None:
    """Called when either user blocks the other: drop the friendship and any pending requests."""
    with transaction.atomic():
        unfriend(a, b.id)
        pending = FriendRequest.objects.filter(
            Q(from_user=a, to_user=b) | Q(from_user=b, to_user=a), status=FriendRequest.Status.PENDING
        )
        for req_id in list(pending.values_list("id", flat=True)):
            for uid in (a.id, b.id):
                _on_commit_push(uid, {"type": "friend_request_removed", "request_id": req_id})
        pending.update(status=FriendRequest.Status.CANCELLED, responded_at=timezone.now())


# --- mute, pin, last seen ----------------------------------------------------

MUTE_FOR = {"8h": timedelta(hours=8), "1w": timedelta(days=7), "always": timedelta(days=36500)}
MAX_PINNED = 3


def _mine(c: Conversation, user_id: int, what: str):
    return getattr(c, f"{'a' if c.user_a_id == user_id else 'b'}_{what}")


def is_muted(user_id: int, partner_id: int) -> bool:
    c = _conversation(user_id, partner_id)
    until = c and _mine(c, user_id, "muted_until")
    return bool(until and until > timezone.now())


def set_chat_prefs(user: User, partner_id, mute=None, pin=None) -> dict:
    """Your own settings for one chat: mute ("8h" | "1w" | "always" | "off") and pin (bool)."""
    if not isinstance(partner_id, int) or partner_id == user.id:
        raise SocialError("invalid", "Pick a chat.")
    if not are_friends(user.id, partner_id) and _conversation(user.id, partner_id) is None:
        raise SocialError("not_found", "That chat doesn't exist.")
    if mute is not None and mute != "off" and mute not in MUTE_FOR:
        raise SocialError("invalid", "Mute for 8 hours, a week, or always.")
    side = "a" if user.id < partner_id else "b"
    x, y = ordered_pair(user.id, partner_id)
    now = timezone.now()
    with transaction.atomic():
        c, _ = Conversation.objects.select_for_update().get_or_create(user_a_id=x, user_b_id=y)
        if mute is not None:
            setattr(c, f"{side}_muted_until", None if mute == "off" else now + MUTE_FOR[mute])
        if pin is True and not getattr(c, f"{side}_pinned_at"):
            pinned = Conversation.objects.filter(
                Q(user_a=user, a_pinned_at__isnull=False) | Q(user_b=user, b_pinned_at__isnull=False)
            ).count()
            if pinned >= MAX_PINNED:
                raise SocialError("too_many_pins", f"You can pin up to {MAX_PINNED} chats.")
            setattr(c, f"{side}_pinned_at", now)
        elif pin is False:
            setattr(c, f"{side}_pinned_at", None)
        c.save()
    _on_commit_push(user.id, {"type": "conversations.changed"})
    return chat_prefs(c, user.id)


def chat_prefs(c: Conversation, user_id: int) -> dict:
    until = _mine(c, user_id, "muted_until")
    now = timezone.now()
    muted = bool(until and until > now)
    return {
        "muted": muted,
        # null while muted: "always" (shown without a date)
        "muted_until": until.isoformat() if muted and until < now + timedelta(days=3650) else None,
        "pinned": _mine(c, user_id, "pinned_at") is not None,
    }


def prefs_with(user: User, partner_id: int) -> dict:
    c = _conversation(user.id, partner_id)
    return chat_prefs(c, user.id) if c else {"muted": False, "muted_until": None, "pinned": False}


def last_seen_for(viewer: User, other: User, online: bool) -> str | None:
    """Only when both allow it, and only while offline."""
    if online or not other.last_seen_at or not (viewer.show_last_seen and other.show_last_seen):
        return None
    return other.last_seen_at.isoformat()


def presence_events(user_id: int, online: bool) -> list[tuple[int, dict]]:
    """For each friend: the presence event to send. Going offline records the moment (last seen).
    Coming online is told only when you show "online" and they show theirs too."""
    now = timezone.now()
    if not online:
        User.objects.filter(pk=user_id).update(last_seen_at=now)
    me = User.objects.filter(pk=user_id).values("show_last_seen", "show_online").first() or {}
    if online and not me.get("show_online", True):
        return []
    ids = friend_ids(user_id)
    flags = {u["id"]: u for u in User.objects.filter(id__in=ids).values("id", "show_last_seen", "show_online")}
    out = []
    for fid in ids:
        theirs = flags.get(fid, {})
        if online and not theirs.get("show_online", True):
            continue
        payload = {"type": "presence", "user_id": user_id, "online": online}
        if not online and me.get("show_last_seen", True) and theirs.get("show_last_seen", True):
            payload["last_seen"] = now.isoformat()
        out.append((fid, payload))
    return out


def visible_online(viewer: User, ids) -> set[int]:
    """Friends shown as online to `viewer`: nobody when either side hides "online"."""
    if not viewer.show_online:
        return set()
    online = presence.online_among(ids)
    if not online:
        return set()
    return set(User.objects.filter(id__in=online, show_online=True).values_list("id", flat=True))


def online_visibility_changed(user: User) -> None:
    """Turned "online" off or on while connected: friends see it at once; your own list reloads."""
    from apps.chat.realtime import push_to_user

    connected = user.id in presence.online_among([user.id])
    if connected:
        if user.show_online:
            for fid, payload in presence_events(user.id, online=True):
                push_to_user(fid, payload)
        else:
            for fid in friend_ids(user.id):
                push_to_user(fid, {"type": "presence", "user_id": user.id, "online": False})
    push_to_user(user.id, {"type": "conversations.changed"})


def receipts_between(a_id: int, b_id: int) -> bool:
    """"Seen" ticks only when both people keep read receipts on."""
    return not User.objects.filter(id__in=[a_id, b_id], read_receipts=False).exists()


def touch_last_seen(user_id: int) -> None:
    User.objects.filter(pk=user_id).update(last_seen_at=timezone.now())


# --- people search and message requests -------------------------------------------

REQUEST_MESSAGES = 3  # text messages before the other person accepts
REQUESTS_PER_DAY = 20  # new people one account can write to in a day
SEARCH_PAGE = 20


def _active_people():
    """Accounts others may find: saved, active, findable, not banned."""
    now = timezone.now()
    return User.objects.filter(is_active=True, is_guest=False, discoverable=True, deactivated_at__isnull=True).filter(
        Q(banned_until__isnull=True) | Q(banned_until__lt=now)
    )


def search_people(viewer: User, query: str, offset: int = 0) -> dict:
    """Names starting with the query first, then names containing it. Never yourself, blocked
    people (either way), guests, banned or closed accounts, or people who turned search off."""
    from apps.chat.services import blocked_user_ids

    q = " ".join(str(query or "").split())[:30]
    if len(q) < 2:
        return {"results": [], "next": None}
    hidden = blocked_user_ids(viewer.id) | {viewer.id}
    base = _active_people().exclude(id__in=hidden).filter(nickname__icontains=q)
    starts = base.annotate(rank=Case(When(nickname__istartswith=q, then=Value(0)), default=Value(1), output_field=IntegerField()))
    page = list(starts.order_by("rank", "nickname", "id")[offset : offset + SEARCH_PAGE + 1])
    more = len(page) > SEARCH_PAGE
    page = page[:SEARCH_PAGE]
    friends = set(friend_ids(viewer.id))
    sent = set(FriendRequest.objects.filter(from_user=viewer, status=FriendRequest.Status.PENDING).values_list("to_user_id", flat=True))
    got = set(FriendRequest.objects.filter(to_user=viewer, status=FriendRequest.Status.PENDING).values_list("from_user_id", flat=True))
    results = []
    for u in page:
        mutual = len(friends & set(friend_ids(u.id))) if friends else 0
        relation = "friend" if u.id in friends else "requested" if u.id in sent else "incoming" if u.id in got else "none"
        results.append({
            "user": brief(u),
            "relation": relation,
            "joined": u.date_joined.strftime("%b %Y"),
            "mutual_friends": mutual,
        })
    return {"results": results, "next": offset + SEARCH_PAGE if more else None}


def chat_state(user_id: int, partner_id: int, conversation: Conversation | None = None) -> str:
    """What this user may do in the chat with partner:
    friend | accepted (a request was accepted) | outgoing (my request, waiting) |
    incoming (their request, waiting for me) | none (nothing yet)."""
    if are_friends(user_id, partner_id):
        return "friend"
    c = conversation if conversation is not None else _conversation(user_id, partner_id)
    if c is None or c.requested_by_id is None:
        return "none"
    if c.accepted_at:
        return "accepted"
    if c.requested_by_id == user_id:
        return "outgoing"
    return "declined" if c.declined_at else "incoming"


def request_messages_left(user_id: int, partner_id: int) -> int | None:
    """While my request waits: how many more messages I may send. None otherwise."""
    c = _conversation(user_id, partner_id)
    if chat_state(user_id, partner_id, c) not in ("outgoing", "none"):
        return None
    sent = DirectMessage.objects.filter(conversation=c, sender_id=user_id).count() if c else 0
    return max(0, REQUEST_MESSAGES - sent)


def connected_ids(user_id: int) -> set[int]:
    """Friends and people whose message request was accepted: random chat never pairs them."""
    out = set(friend_ids(user_id))
    rows = Conversation.objects.filter(Q(user_a_id=user_id) | Q(user_b_id=user_id), accepted_at__isnull=False).values_list("user_a_id", "user_b_id")
    for a, b in rows:
        out.add(b if a == user_id else a)
    out.discard(user_id)
    return out


def answer_message_request(user: User, partner_id, action: str) -> str:
    """The person who got a request: "accept" opens the chat both ways; "delete" hides it for them."""
    if not isinstance(partner_id, int):
        raise SocialError("invalid", "Pick a chat.")
    c = _conversation(user.id, partner_id)
    if c is None or chat_state(user.id, partner_id, c) not in ("incoming", "declined"):
        raise SocialError("not_found", "That request isn't waiting any more.")
    now = timezone.now()
    if action == "accept":
        Conversation.objects.filter(pk=c.pk).update(accepted_at=now, declined_at=None)
    elif action == "delete":
        Conversation.objects.filter(pk=c.pk).update(declined_at=now)
    else:
        raise SocialError("invalid", "Accept or delete.")
    _on_commit_push(user.id, {"type": "conversations.changed"})
    if action == "accept":
        _on_commit_push(partner_id, {"type": "conversations.changed"})
    return "accepted" if action == "accept" else "deleted"


# --- direct messages ------------------------------------------------------


def _conversation(a: int, b: int) -> Conversation | None:
    x, y = ordered_pair(a, b)
    return Conversation.objects.filter(user_a_id=x, user_b_id=y).first()


def send_dm(sender: User, recipient_id: int, text: str, attachment_id=None, reply_id=None) -> dict:
    """Text, an attachment (photo, video, voice note), or both."""
    if not isinstance(recipient_id, int) or recipient_id == sender.id:
        raise SocialError("invalid", "Pick someone to message.")
    recipient = User.objects.filter(id=recipient_id, is_active=True).first()
    if recipient is None:
        raise SocialError("inactive", "This account isn't active.")
    if is_blocked_between(sender.id, recipient_id):
        raise SocialError("not_allowed", "You can't message this user.")
    x, y = ordered_pair(sender.id, recipient_id)
    with transaction.atomic():
        existing = Conversation.objects.select_for_update().filter(user_a_id=x, user_b_id=y).first()
        state = chat_state(sender.id, recipient_id, existing)
        # Photos, videos and voice stay between friends; GIFs and text are fine once accepted.
        if attachment_id and state != "friend":
            raise SocialError("friends_only", "Photos, videos and voice messages are for friends. Send a friend request first.")
        if state == "incoming":
            # Writing back to a request accepts it.
            Conversation.objects.filter(pk=existing.pk).update(accepted_at=timezone.now(), declined_at=None)
            _on_commit_push(recipient_id, {"type": "conversations.changed"})
        elif state in ("none", "outgoing"):
            from apps.gifs.services import is_gif

            if sender.is_guest:
                raise SocialError("account_required", "Save your account with an email to message people who aren't your friends.")
            if is_gif(text):
                raise SocialError("text_only", "Message requests are text only until they accept.")
            if state == "none":
                if recipient.is_guest or not recipient.discoverable:
                    raise SocialError("not_allowed", "You can't message this user. Send a friend request instead.")
                started = Conversation.objects.filter(requested_by=sender, created_at__gte=timezone.now() - timedelta(days=1)).count()
                if started >= REQUESTS_PER_DAY:
                    raise SocialError("too_many", "You've messaged a lot of new people today. Try again tomorrow.")
            else:
                sent = DirectMessage.objects.filter(conversation=existing, sender=sender).count()
                if sent >= REQUEST_MESSAGES:
                    raise SocialError("request_limit", f"You can send {REQUEST_MESSAGES} messages until they accept your request.")
        attachment = None
        if attachment_id:
            try:
                attachment = media.claim_for_message(sender.id, attachment_id, ("image", "video", "audio"))
            except (media.UploadError, ValueError, ValidationError):
                raise SocialError("invalid_attachment", "That file can't be sent. Try uploading it again.")
        conversation = existing or Conversation.objects.create(
            user_a_id=x, user_b_id=y, requested_by=None if state == "friend" else sender
        )
        if existing and state == "none":
            Conversation.objects.filter(pk=existing.pk).update(requested_by=sender)
        reply_to = message_ops.find_reply(DirectMessage, reply_id, conversation=conversation)
        message = DirectMessage.objects.create(
            conversation=conversation, sender=sender, content=text, attachment=attachment, reply_to=reply_to
        )
        Conversation.objects.filter(pk=conversation.pk).update(last_message_at=message.created_at)
        # Your own message counts as read for you.
        _advance_read(conversation, sender.id, message.id)
        if state in ("none", "outgoing"):
            # A request: both lists move it to (or keep it in) the right place.
            _on_commit_push(sender.id, {"type": "conversations.changed"})
            _on_commit_push(recipient_id, {"type": "conversations.changed"})
    payload = dm_payload(_load_dm(message.id), recipient_id)
    payload["request"] = state in ("none", "outgoing")
    return payload


def auto_delete_days(user: User, partner_id: int) -> int:
    conversation = _conversation(user.id, partner_id)
    return conversation.auto_delete_days if conversation else Conversation._meta.get_field("auto_delete_days").default


def set_auto_delete(user: User, partner_id: int, days) -> int:
    """Either friend picks how long messages stay (1, 7, 30 or 365 days). Both are told."""
    if days not in Conversation.AUTO_DELETE_CHOICES or isinstance(days, bool):
        raise SocialError("invalid", "Pick 1 day, 1 week, 1 month or 1 year.")
    if not isinstance(partner_id, int) or partner_id == user.id or not are_friends(user.id, partner_id):
        raise SocialError("not_friends", "You can only change this in a chat with a friend.")
    x, y = ordered_pair(user.id, partner_id)
    with transaction.atomic():
        conversation, _ = Conversation.objects.get_or_create(user_a_id=x, user_b_id=y)
        Conversation.objects.filter(pk=conversation.pk).update(auto_delete_days=days, auto_delete_changed_by=user)
        event = {"type": "dm.settings", "users": [x, y], "auto_delete_days": days, "by": brief(user)}
        _on_commit_push(user.id, event)
        _on_commit_push(partner_id, event)
    return days


def dm_history(user: User, partner_id: int, before: int | None, limit: int) -> tuple[list[dict], bool]:
    conversation = _conversation(user.id, partner_id)
    if conversation is None:
        return [], False
    select, prefetch = message_ops.related_fields(DirectMessage)
    # Older than the chat's auto-delete setting: gone (the nightly purge removes them for good).
    shown_from = timezone.now() - timedelta(days=conversation.auto_delete_days)
    qs = (
        # Deleted messages stay as "This message was deleted" in their place.
        DirectMessage.objects.filter(conversation=conversation, created_at__gte=shown_from)
        .select_related(*select)
        .prefetch_related(*prefetch)
        .order_by("-id")
    )
    if before:
        qs = qs.filter(id__lt=before)
    page = list(qs[:limit])
    messages = [dm_payload(m, partner_id if m.sender_id == user.id else user.id) for m in reversed(page)]
    return messages, len(page) == limit


def _advance_read(conversation: Conversation, user_id: int, last_id: int) -> bool:
    field = "a_last_read_id" if conversation.user_a_id == user_id else "b_last_read_id"
    # Only ever moves forward, even with several tabs racing.
    return bool(Conversation.objects.filter(pk=conversation.pk, **{f"{field}__lt": last_id}).update(**{field: last_id}))


def mark_read(user: User, partner_id: int, last_id: int) -> None:
    """Also tells the partner, for the "seen" ticks under their messages."""
    conversation = _conversation(user.id, partner_id)
    if conversation and _advance_read(conversation, user.id, last_id) and receipts_between(user.id, partner_id):
        _on_commit_push(partner_id, {"type": "dm.read", "user_id": user.id, "last_id": last_id})


def partner_read_id(user: User, partner_id: int) -> int:
    """The newest message of this chat the partner has seen."""
    conversation = _conversation(user.id, partner_id)
    if conversation is None or not receipts_between(user.id, partner_id):
        return 0
    return conversation.b_last_read_id if conversation.user_a_id == user.id else conversation.a_last_read_id


def conversations_of(user: User, limit: int = 100) -> list[dict]:
    """DM threads, most recent first, with the last message and the unread count for this user."""
    last = DirectMessage.objects.filter(conversation=OuterRef("pk"), deleted_at__isnull=True).order_by("-id")

    def unread_after(read_field: str):
        return Subquery(
            DirectMessage.objects.filter(
                conversation=OuterRef("pk"), deleted_at__isnull=True, id__gt=OuterRef(read_field)
            )
            .exclude(sender_id=user.id)
            .values("conversation")
            .annotate(n=Count("id"))
            .values("n"),
            output_field=IntegerField(),
        )

    rows = (
        Conversation.objects.filter(Q(user_a=user) | Q(user_b=user), last_message_at__isnull=False)
        .select_related("user_a", "user_b")
        .annotate(
            last_content=Subquery(last.values("content")[:1]),
            last_kind=Subquery(last.values("attachment__kind")[:1]),
            last_sender_id=Subquery(last.values("sender_id")[:1]),
            unread=Coalesce(
                Case(
                    When(user_a=user, then=unread_after("a_last_read_id")),
                    default=unread_after("b_last_read_id"),
                    output_field=IntegerField(),
                ),
                Value(0),
            ),
        )
        .order_by("-last_message_at")[:limit]
    )
    def preview(c, partner) -> str:
        if c.last_sender_id == partner.id and closing.is_gone(partner):
            return closing.MASK
        return gif_label(c.last_content or "") or ATTACHMENT_PREVIEW.get(c.last_kind or "", "")

    friends = set(friend_ids(user.id))

    def request_of(c, partner_id) -> str | None:
        """None for a normal chat; "incoming" / "outgoing" for a message request still waiting."""
        if partner_id in friends or c.requested_by_id is None or c.accepted_at:
            return None
        if c.requested_by_id == user.id:
            return "outgoing"
        return "declined" if c.declined_at else "incoming"

    out = []
    for c in rows:
        partner = c.user_b if c.user_a_id == user.id else c.user_a
        req = request_of(c, partner.id)
        if req == "declined":
            continue  # you deleted this request: it stays out of your list
        out.append({
            "user": brief(partner),
            "last_message": preview(c, partner),
            "last_from_me": c.last_sender_id == user.id,
            "last_message_at": c.last_message_at.isoformat(),
            "unread": c.unread,
            "request": req,
            **chat_prefs(c, user.id),
            "_pinned_at": _mine(c, user.id, "pinned_at"),
        })
    # Pinned chats first, in the order they were pinned; then the most recent.
    pinned = sorted((r for r in out if r["_pinned_at"]), key=lambda r: r["_pinned_at"])
    rest = [r for r in out if not r["_pinned_at"]]
    for r in out:
        del r["_pinned_at"]
    return pinned + rest
