"""Replies, reactions, edits and deletes. One set of rules for room, friend and random-chat messages.

The three message models share the fields this needs: sender, content, reply_to, edited_at,
deleted_at and a `reactions` relation (one emoji per person per message).
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.closing import GONE_NAME, MASK, is_gone

from .services import InvalidMessage, clean_content

KIND_LABEL = {"image": "📷 Photo", "video": "🎬 Video", "audio": "🎤 Voice message"}
REPLY_PREVIEW_CHARS = 120
# Characters that never belong in a reaction (it is shown as-is in other people's chats).
_NOT_EMOJI = set(" \t\r\n<>&\"'`")


class MessageOpError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


# --- reading -----------------------------------------------------------------------


def related_fields(model) -> tuple[list[str], list[str]]:
    """select_related / prefetch_related for building payloads without extra queries."""
    names = {f.name for f in model._meta.get_fields()}
    select = ["sender", "reply_to", "reply_to__sender"]
    if "attachment" in names:
        select += ["attachment", "reply_to__attachment"]
    return select, ["reactions"]


def _attachment(message):
    return getattr(message, "attachment", None)


def reply_preview(message) -> dict | None:
    target = message.reply_to
    if target is None:
        return None
    attachment = _attachment(target)
    if target.deleted_at:
        text, kind = "", None
    else:
        text = target.content[:REPLY_PREVIEW_CHARS] or KIND_LABEL.get(attachment.kind if attachment else "", "")
        kind = attachment.kind if attachment else None
        if is_gone(target.sender):
            text, kind = MASK, None
    return {
        "id": target.id,
        "sender_id": target.sender_id,
        "nickname": GONE_NAME if is_gone(target.sender) else target.sender.nickname,
        "text": text,
        "kind": kind,
        "deleted": target.deleted_at is not None,
    }


def reactions_of(message) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for r in message.reactions.all():
        out.setdefault(r.emoji, []).append(r.user_id)
    return out


def extras(message) -> dict:
    """Fields every message payload carries. A deleted message keeps only its place in the chat."""
    deleted = message.deleted_at is not None
    return {
        "reply_to": None if deleted else reply_preview(message),
        "reactions": {} if deleted else reactions_of(message),
        "edited": message.edited_at is not None and not deleted,
        "deleted": deleted,
    }


def visible_content(message) -> str:
    """Deleted: nothing. From a deactivated or deleted account: "********" (the text is kept)."""
    if message.deleted_at:
        return ""
    return MASK if is_gone(message.sender) else message.content


def hides_attachment(message) -> bool:
    return message.deleted_at is not None or is_gone(message.sender)


# --- writing ---------------------------------------------------------------------------


def find_reply(model, reply_id, **same_chat):
    """The message being answered, only if it is in the same chat. Anything else: no reply."""
    if not isinstance(reply_id, int) or isinstance(reply_id, bool):
        return None
    return model.objects.filter(id=reply_id, deleted_at__isnull=True, **same_chat).first()


def clean_emoji(raw) -> str | None:
    """None removes the reaction."""
    if raw is None or raw == "":
        return None
    if (
        not isinstance(raw, str)
        or len(raw) > 16
        or any(c in _NOT_EMOJI or (c.isascii() and c.isalpha()) for c in raw)
        or all(c.isascii() for c in raw)
    ):
        raise MessageOpError("invalid_reaction", "Pick an emoji.")
    return raw


def react(message, user, raw_emoji) -> None:
    if message.deleted_at:
        raise MessageOpError("gone", "That message was deleted.")
    emoji = clean_emoji(raw_emoji)
    model = message.reactions.model
    if emoji is None:
        model.objects.filter(message=message, user=user).delete()
    else:
        model.objects.update_or_create(message=message, user=user, defaults={"emoji": emoji})


def _own_and_recent(message, user, window_key: str, too_late: str) -> None:
    if message.sender_id != user.id:
        raise MessageOpError("not_yours", "You can only change your own messages.")
    if message.deleted_at:
        raise MessageOpError("gone", "That message was deleted.")
    age = (timezone.now() - message.created_at).total_seconds()
    if age > settings.VCHAT[window_key]:
        raise MessageOpError("too_late", too_late)


def edit(message, user, raw) -> None:
    minutes = settings.VCHAT["MESSAGE_EDIT_SECONDS"] // 60
    _own_and_recent(message, user, "MESSAGE_EDIT_SECONDS", f"Messages can be edited for {minutes} minutes.")
    if not message.content:
        raise MessageOpError("not_text", "Only text can be edited.")
    try:
        text = clean_content(raw)
    except InvalidMessage as exc:
        raise MessageOpError("invalid_message", str(exc))
    if text == message.content:
        return
    message.content = text
    message.edited_at = timezone.now()
    message.save(update_fields=["content", "edited_at"])


def delete(message, user) -> None:
    """Delete for everyone. The text stays stored for abuse reports; nobody is sent it again."""
    minutes = settings.VCHAT["MESSAGE_DELETE_SECONDS"] // 60
    _own_and_recent(message, user, "MESSAGE_DELETE_SECONDS", f"Messages can be deleted for {minutes} minutes.")
    with transaction.atomic():
        message.deleted_at = timezone.now()
        message.save(update_fields=["deleted_at"])
        message.reactions.all().delete()
