from django.core.exceptions import ValidationError
from django.db import transaction
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


def partner_brief(user: User, region: str) -> dict:
    """What a stranger learns about you: nickname, gender and the region you picked. Nothing else."""
    return {"id": user.id, "nickname": user.nickname, "gender": user.gender, "region": region}


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


def end_session(session_id, ended_by_id: int | None) -> None:
    StrangerSession.objects.filter(id=session_id, ended_at__isnull=True).update(
        ended_at=timezone.now(), ended_by_id=ended_by_id
    )


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
    deleted = message.deleted_at is not None
    return {
        "id": message.id,
        "session": str(message.session_id),
        "sender_id": message.sender_id,
        "content": message_ops.visible_content(message),
        "attachment": None if deleted else media.payload(message.attachment),
        "created_at": message.created_at.isoformat(),
        **message_ops.extras(message),
    }


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
