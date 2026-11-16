"""Auto-delete in friend chats, random chats expiring 7 days after they end, and a random chat
moving into the friend chat when the two become friends."""

from datetime import timedelta

import pytest
from channels.db import database_sync_to_async
from django.core.management import call_command
from django.utils import timezone

from apps.chat.models import Report
from apps.social.models import Conversation, DirectMessage, ordered_pair
from apps.stranger.models import StrangerMessage, StrangerSession

from .conftest import auth_client, make_member
from .test_message_ops import next_event
from .test_social_ws import make_friends, make_user, personal_socket
from .test_stranger import matched_pair


@pytest.fixture(autouse=True)
def no_cooldown(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 0}


def chat_of(a, b):
    x, y = ordered_pair(a.id, b.id)
    return Conversation.objects.get_or_create(user_a_id=x, user_b_id=y)[0]


@pytest.mark.django_db
def test_friend_chats_hide_and_purge_after_their_setting(alice, bob):
    x, y = ordered_pair(alice.id, bob.id)
    from apps.social.models import Friendship

    Friendship.objects.create(user_a_id=x, user_b_id=y)
    chat = chat_of(alice, bob)
    assert chat.auto_delete_days == 7  # the default
    old = DirectMessage.objects.create(conversation=chat, sender=alice, content="ten days ago")
    new = DirectMessage.objects.create(conversation=chat, sender=bob, content="today")
    DirectMessage.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10))

    res = auth_client(alice).get(f"/api/dms/{bob.id}/messages/")
    assert [m["content"] for m in res.data["messages"]] == ["today"] and res.data["auto_delete_days"] == 7

    Conversation.objects.filter(pk=chat.pk).update(auto_delete_days=30)
    assert len(auth_client(alice).get(f"/api/dms/{bob.id}/messages/").data["messages"]) == 2
    Conversation.objects.filter(pk=chat.pk).update(auto_delete_days=7)
    call_command("purge_old_data")
    assert list(DirectMessage.objects.values_list("content", flat=True)) == ["today"]
    assert new


@pytest.mark.django_db(transaction=True)
async def test_either_friend_changes_auto_delete_and_both_hear():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    await make_friends(alice, bob)
    a, b = await personal_socket(a_token), await personal_socket(b_token)
    await a.send_json_to({"type": "dm.autodelete", "to": bob.id, "days": 1})
    for comm in (a, b):
        ev = await next_event(comm)
        assert ev["type"] == "dm.settings" and ev["auto_delete_days"] == 1 and ev["by"]["id"] == alice.id
    await a.send_json_to({"type": "dm.autodelete", "to": bob.id, "days": 3})
    assert (await next_event(a))["code"] == "invalid"
    for comm in (a, b):
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_random_chat_moves_into_the_friend_chat():
    alice, bob, a, b, session = await matched_pair()
    for who, text in ((a, "hi from alice"), (b, "hey alice")):
        await who.send_json_to({"type": "stranger.message", "content": text, "client_id": "x"})
        await a.receive_json_from()
        await b.receive_json_from()

    # They save their accounts and become friends, then talk a bit more and end.
    from apps.accounts.models import User

    await database_sync_to_async(User.objects.filter(pk__in=[alice.pk, bob.pk]).update)(is_guest=False)
    res = await database_sync_to_async(auth_client(alice).post)("/api/friends/requests/", {"to_user": bob.id}, format="json")
    req_id = res.data["request"]["id"]
    await database_sync_to_async(auth_client(bob).post)(f"/api/friends/requests/{req_id}/accept/")
    await b.send_json_to({"type": "stranger.message", "content": "after we became friends", "client_id": "y"})
    while (await b.receive_json_from())["type"] != "stranger.message":
        pass
    await a.send_json_to({"type": "stranger.leave"})
    while (await a.receive_json_from())["type"] != "stranger.ended":
        pass

    contents = await database_sync_to_async(
        lambda: list(DirectMessage.objects.order_by("id").values_list("content", flat=True))
    )()
    assert contents == ["hi from alice", "hey alice", "after we became friends"]
    history = await database_sync_to_async(auth_client(alice).get)(f"/api/dms/{bob.id}/messages/")
    assert [m["content"] for m in history.data["messages"]] == contents
    await a.disconnect()
    await b.disconnect()


@pytest.mark.django_db
def test_random_chats_expire_a_week_after_they_end_unless_reported():
    a, b, c = make_member("ra"), make_member("rb"), make_member("rc")
    old = StrangerSession.objects.create(user_a=a, user_b=b, ended_at=timezone.now() - timedelta(days=8))
    reported = StrangerSession.objects.create(user_a=a, user_b=c, ended_at=timezone.now() - timedelta(days=8))
    recent = StrangerSession.objects.create(user_a=b, user_b=c, ended_at=timezone.now() - timedelta(days=2))
    for s in (old, reported, recent):
        StrangerMessage.objects.create(session=s, sender=a if s.user_a == a else b, content="x")
    Report.objects.create(reporter=c, reported_user=a, stranger_session=reported, reason="harassment")
    call_command("purge_old_data")
    assert set(StrangerSession.objects.values_list("id", flat=True)) == {reported.id, recent.id}
    assert StrangerMessage.objects.count() == 2
