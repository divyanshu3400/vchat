"""The notifications vChat sends. Rooms and random chats never notify: that would be noise."""

from . import sender

KIND_PREVIEW = {"image": "📷 Photo", "video": "🎬 Video", "audio": "🎤 Voice message"}


def dm_received(recipient_id: int, sender_id: int, nickname: str, content: str, attachment_kind: str | None) -> None:
    from apps.social.services import is_muted

    if is_muted(recipient_id, sender_id):
        return  # muted chat: no notification
    text = content.strip() or KIND_PREVIEW.get(attachment_kind or "", "New message")
    if len(text) > 120:
        text = text[:117] + "…"
    sender.notify(
        recipient_id,
        "messages",
        title=nickname,
        body=text,
        private_body="New message",
        url=f"/chat/dm/{sender_id}",
        tag=f"dm-{sender_id}",
    )


def friend_request(target_id: int, nickname: str) -> None:
    sender.notify(
        target_id,
        "requests",
        title="New friend request",
        body=f"{nickname} wants to be friends on vChat.",
        url="/chat/inbox",
        tag="friend-requests",
    )


def request_accepted(requester_id: int, friend_id: int, nickname: str) -> None:
    sender.notify(
        requester_id,
        "requests",
        title=f"{nickname} accepted",
        body="You're friends now. Say hi 👋",
        url=f"/chat/dm/{friend_id}",
        tag=f"accepted-{friend_id}",
    )


def missed_call(callee_id: int, caller_id: int, nickname: str, kind: str) -> None:
    sender.notify(
        callee_id,
        "calls",
        title=f"Missed {'video' if kind == 'video' else 'voice'} call",
        body=f"{nickname} called you on vChat.",
        url=f"/chat/dm/{caller_id}",
        tag=f"call-{caller_id}",
    )
