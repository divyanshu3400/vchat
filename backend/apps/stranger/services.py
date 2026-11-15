from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
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


def end_session(session_id, ended_by_id: int | None) -> None:
    StrangerSession.objects.filter(id=session_id, ended_at__isnull=True).update(
        ended_at=timezone.now(), ended_by_id=ended_by_id
    )


def save_message(session_id, sender: User, text: str, attachment_id=None) -> dict:
    """Photos with strangers need Plus or a rewarded-ad unlock; each photo spends one use."""
    with transaction.atomic():
        attachment = None
        if attachment_id:
            if not premium.consume(sender, RewardGrant.Kind.RANDOM_PHOTOS):
                raise PhotoLocked("locked_photos", "Photos with strangers need vChat Plus or a short ad.")
            try:
                attachment = media.claim_for_message(sender.id, attachment_id, ("image",))
            except (media.UploadError, ValueError, ValidationError):
                raise PhotoLocked("invalid_attachment", "Only photos can be sent to strangers.")
        message = StrangerMessage.objects.create(
            session_id=session_id, sender_id=sender.id, content=text, attachment=attachment
        )
    return {
        "id": message.id,
        "session": str(session_id),
        "sender_id": sender.id,
        "content": message.content,
        "attachment": media.payload(attachment),
        "created_at": message.created_at.isoformat(),
    }
