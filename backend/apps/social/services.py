"""Friends and direct messages. Views and the personal socket call these; nothing else writes these tables."""

from django.db import transaction
from django.db.models import Case, Count, IntegerField, OuterRef, Q, Subquery, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from django.core.exceptions import ValidationError

from apps.accounts.models import User
from apps.chat import message_ops, presence
from apps.media import services as media
from apps.chat.models import Block
from apps.chat.realtime import push_to_user

from .models import Conversation, DirectMessage, FriendRequest, Friendship, ordered_pair

MAX_PENDING_OUTGOING = 50


class SocialError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def brief(user: User) -> dict:
    return {"id": user.id, "nickname": user.nickname, "gender": user.gender}


def request_payload(req: FriendRequest) -> dict:
    return {
        "id": req.id,
        "from_user": brief(req.from_user),
        "to_user": brief(req.to_user),
        "created_at": req.created_at.isoformat(),
    }


def dm_payload(message: DirectMessage, recipient_id: int) -> dict:
    deleted = message.deleted_at is not None
    return {
        "id": message.id,
        "sender": brief(message.sender),
        "recipient_id": recipient_id,
        "content": message_ops.visible_content(message),
        # fresh signed link each time; none once deleted
        "attachment": None if deleted else media.payload(message.attachment),
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
    others = [(u, since) for u, since in others if u.is_active]
    online = presence.online_among(u.id for u, _ in others)
    friends = [{"user": brief(u), "since": since.isoformat(), "online": u.id in online} for u, since in others]
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


# --- direct messages ------------------------------------------------------


def _conversation(a: int, b: int) -> Conversation | None:
    x, y = ordered_pair(a, b)
    return Conversation.objects.filter(user_a_id=x, user_b_id=y).first()


def send_dm(sender: User, recipient_id: int, text: str, attachment_id=None, reply_id=None) -> dict:
    """Text, an attachment (photo, video, voice note), or both."""
    if not isinstance(recipient_id, int) or recipient_id == sender.id:
        raise SocialError("invalid", "Pick someone to message.")
    if not are_friends(sender.id, recipient_id):
        raise SocialError("not_friends", "You can only message friends. Send a friend request first.")
    x, y = ordered_pair(sender.id, recipient_id)
    with transaction.atomic():
        attachment = None
        if attachment_id:
            try:
                attachment = media.claim_for_message(sender.id, attachment_id, ("image", "video", "audio"))
            except (media.UploadError, ValueError, ValidationError):
                raise SocialError("invalid_attachment", "That file can't be sent. Try uploading it again.")
        conversation, _ = Conversation.objects.get_or_create(user_a_id=x, user_b_id=y)
        reply_to = message_ops.find_reply(DirectMessage, reply_id, conversation=conversation)
        message = DirectMessage.objects.create(
            conversation=conversation, sender=sender, content=text, attachment=attachment, reply_to=reply_to
        )
        Conversation.objects.filter(pk=conversation.pk).update(last_message_at=message.created_at)
        # Your own message counts as read for you.
        _advance_read(conversation, sender.id, message.id)
    return dm_payload(_load_dm(message.id), recipient_id)


def dm_history(user: User, partner_id: int, before: int | None, limit: int) -> tuple[list[dict], bool]:
    conversation = _conversation(user.id, partner_id)
    if conversation is None:
        return [], False
    select, prefetch = message_ops.related_fields(DirectMessage)
    qs = (
        # Deleted messages stay as "This message was deleted" in their place.
        DirectMessage.objects.filter(conversation=conversation)
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
    if conversation and _advance_read(conversation, user.id, last_id):
        _on_commit_push(partner_id, {"type": "dm.read", "user_id": user.id, "last_id": last_id})


def partner_read_id(user: User, partner_id: int) -> int:
    """The newest message of this chat the partner has seen."""
    conversation = _conversation(user.id, partner_id)
    if conversation is None:
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
    return [
        {
            "user": brief(c.user_b if c.user_a_id == user.id else c.user_a),
            "last_message": c.last_content or ATTACHMENT_PREVIEW.get(c.last_kind or "", ""),
            "last_from_me": c.last_sender_id == user.id,
            "last_message_at": c.last_message_at.isoformat(),
            "unread": c.unread,
        }
        for c in rows
    ]
