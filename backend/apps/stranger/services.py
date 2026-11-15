from django.utils import timezone

from apps.accounts.models import User

from .models import StrangerMessage, StrangerSession


def partner_brief(user: User, region: str) -> dict:
    """What a stranger learns about you: nickname, gender and the region you picked. Nothing else."""
    return {"id": user.id, "nickname": user.nickname, "gender": user.gender, "region": region}


def start_session(waiting_user_id: int, finder_id: int) -> StrangerSession:
    return StrangerSession.objects.create(user_a_id=waiting_user_id, user_b_id=finder_id)


def end_session(session_id, ended_by_id: int | None) -> None:
    StrangerSession.objects.filter(id=session_id, ended_at__isnull=True).update(
        ended_at=timezone.now(), ended_by_id=ended_by_id
    )


def save_message(session_id, sender_id: int, text: str) -> dict:
    message = StrangerMessage.objects.create(session_id=session_id, sender_id=sender_id, content=text)
    return {
        "id": message.id,
        "session": str(session_id),
        "sender_id": sender_id,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
    }
