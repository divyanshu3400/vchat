from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import User
from apps.chat import message_ops
from apps.media import services as media
from apps.premium import services as premium
from apps.premium.models import RewardGrant

from .models import StrangerMessage, StrangerSession


class PhotoLocked(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


ANON_NAME = "Anonymous"


def partner_brief(user_id: int) -> dict:
    """What a stranger learns about you: nothing. Random chat is anonymous: no name, gender or
    region. The id is only there to add a friend, block or report; becoming friends reveals the name."""
    return {"id": user_id, "nickname": ANON_NAME, "gender": "", "region": "any"}


def start_session(waiting_user_id: int, finder_id: int) -> StrangerSession:
    return StrangerSession.objects.create(user_a_id=waiting_user_id, user_b_id=finder_id)


def open_partner_id(session_id, user_id: int) -> int | None:
    """The other person in a random chat this user is in and that hasn't ended, else None."""
    try:
        s = StrangerSession.objects.filter(id=session_id, ended_at__isnull=True).first()
    except (ValidationError, ValueError):
        return None
    if s is None or not s.has_user(user_id):
        return None
    return s.user_b_id if s.user_a_id == user_id else s.user_a_id


def open_session_of(user_id: int) -> tuple[str, int] | None:
    """This user's random chat that nobody has ended yet: (session id, the other person)."""
    s = (
        StrangerSession.objects.filter(Q(user_a_id=user_id) | Q(user_b_id=user_id), ended_at__isnull=True)
        .order_by("-started_at")
        .first()
    )
    if s is None:
        return None
    return str(s.id), (s.user_b_id if s.user_a_id == user_id else s.user_a_id)


def history(session_id, limit: int = 200) -> list[dict]:
    """The latest messages of a random chat, oldest first (to rebuild the chat after a reload)."""
    select, prefetch = message_ops.related_fields(StrangerMessage)
    rows = list(
        StrangerMessage.objects.select_related(*select)
        .prefetch_related(*prefetch)
        .filter(session_id=session_id)
        .order_by("-id")[:limit]
    )
    return [message_payload(m) for m in reversed(rows)]


def end_session(session_id, ended_by_id: int | None) -> None:
    ended = StrangerSession.objects.filter(id=session_id, ended_at__isnull=True).update(
        ended_at=timezone.now(), ended_by_id=ended_by_id
    )
    if ended:
        # Became friends during the chat: what they said after that moves to their friend chat too.
        session = StrangerSession.objects.filter(id=session_id).first()
        if session:
            carry_to_friend_chat(session)


def carry_recent_chat(a: int, b: int) -> int:
    """Two people just became friends: if they met in random chat today, copy that chat into
    their friend chat, so nothing they said is lost."""
    session = (
        StrangerSession.objects.filter(
            Q(user_a_id=a, user_b_id=b) | Q(user_a_id=b, user_b_id=a),
            started_at__gte=timezone.now() - timedelta(days=1),
        )
        .order_by("-started_at")
        .first()
    )
    return carry_to_friend_chat(session) if session else 0


def carry_to_friend_chat(session: StrangerSession) -> int:
    """Copy the random chat's messages (not copied yet) into the two friends' chat. Photos move along."""
    from apps.chat.realtime import push_to_user
    from apps.social.models import Conversation, DirectMessage, ordered_pair
    from apps.social.services import are_friends

    if not are_friends(session.user_a_id, session.user_b_id):
        return 0
    messages = list(
        StrangerMessage.objects.filter(session=session, id__gt=session.carried_upto, deleted_at__isnull=True)
        .select_related("attachment")
        .order_by("id")
    )
    if not messages:
        return 0
    x, y = ordered_pair(session.user_a_id, session.user_b_id)
    with transaction.atomic():
        conversation, _ = Conversation.objects.get_or_create(user_a_id=x, user_b_id=y)
        for m in messages:
            attachment = m.attachment
            if attachment is not None:
                StrangerMessage.objects.filter(pk=m.pk).update(attachment=None)
            dm = DirectMessage.objects.create(
                conversation=conversation, sender_id=m.sender_id, content=m.content, attachment=attachment
            )
            DirectMessage.objects.filter(pk=dm.pk).update(created_at=m.created_at)
        StrangerSession.objects.filter(pk=session.pk).update(carried_upto=messages[-1].id)
        latest = messages[-1].created_at
        if not conversation.last_message_at or conversation.last_message_at < latest:
            Conversation.objects.filter(pk=conversation.pk).update(last_message_at=latest)
        for uid in (x, y):
            transaction.on_commit(lambda uid=uid: push_to_user(uid, {"type": "conversations.changed"}))
    return len(messages)


def save_message(session_id, sender: User, text: str, attachment_id=None, reply_id=None) -> dict:
    """Voice messages are free. Photos with strangers need Plus or a rewarded-ad unlock; each photo
    spends one use."""
    with transaction.atomic():
        attachment = None
        if attachment_id:
            pending = media.pending_kind(sender.id, attachment_id)
            if pending == "audio":
                kinds = ("audio",)
            elif pending == "image":
                if not premium.consume(sender, RewardGrant.Kind.RANDOM_PHOTOS):
                    raise PhotoLocked("locked_photos", "Photos with strangers need vChat Plus or a short ad.")
                kinds = ("image",)
            else:
                raise PhotoLocked("invalid_attachment", "Only photos and voice messages can be sent to strangers.")
            try:
                attachment = media.claim_for_message(sender.id, attachment_id, kinds)
            except (media.UploadError, ValueError, ValidationError):
                raise PhotoLocked("invalid_attachment", "That file can't be sent. Try again.")
        reply_to = message_ops.find_reply(StrangerMessage, reply_id, session_id=session_id)
        message = StrangerMessage.objects.create(
            session_id=session_id, sender_id=sender.id, content=text, attachment=attachment, reply_to=reply_to
        )
    return message_payload(load_message(session_id, message.id))


def load_message(session_id, message_id) -> StrangerMessage | None:
    if not isinstance(message_id, int) or isinstance(message_id, bool):
        return None
    select, prefetch = message_ops.related_fields(StrangerMessage)
    return (
        StrangerMessage.objects.select_related(*select)
        .prefetch_related(*prefetch)
        .filter(id=message_id, session_id=session_id)
        .first()
    )


def message_payload(message: StrangerMessage) -> dict:
    return {
        "id": message.id,
        "session": str(message.session_id),
        "sender_id": message.sender_id,
        "content": message_ops.visible_content(message),
        "attachment": None if message_ops.hides_attachment(message) else media.payload(message.attachment),
        "created_at": message.created_at.isoformat(),
        **_anonymous_reply(message_ops.extras(message)),
    }


def _anonymous_reply(extras: dict) -> dict:
    """A reply quotes the message, never the name behind it."""
    if extras.get("reply_to"):
        extras["reply_to"] = {**extras["reply_to"], "nickname": ANON_NAME}
    return extras


def change_message(session_id, user: User, kind: str, message_id, value=None) -> dict:
    """React to, edit or delete a message of the current random chat."""
    message = load_message(session_id, message_id)
    if message is None:
        raise message_ops.MessageOpError("not_found", "That message is gone.")
    if kind == "react":
        message_ops.react(message, user, value)
    elif kind == "edit":
        message_ops.edit(message, user, value)
    else:
        message_ops.delete(message, user)
    return message_payload(load_message(session_id, message.id))
