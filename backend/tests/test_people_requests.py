"""Finding people by name, message requests, and random chat skipping people you already know."""

import time

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.chat.models import Block
from apps.social import services as social
from apps.social.models import Conversation, Friendship, ordered_pair
from apps.stranger import matchmaker

from .conftest import auth_client, make_member


def befriend(a, b):
    x, y = ordered_pair(a.id, b.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)


@pytest.mark.django_db
def test_search_finds_names_and_hides_who_should_be_hidden(alice):
    riya = make_member("riya_k")
    make_member("ariyaa")  # contains "riya", starts differently
    hidden = make_member("riya_hidden")
    User.objects.filter(pk=hidden.pk).update(discoverable=False)
    blocked = make_member("riya_blocked")
    Block.objects.create(blocker=blocked, blocked=alice)
    banned = make_member("riya_banned")
    User.objects.filter(pk=banned.pk).update(banned_until=timezone.now() + timezone.timedelta(days=1))
    User.create_guest(nickname="riya_guest")
    befriend(alice, riya)

    res = auth_client(alice).get("/api/people/?q=riya")
    assert res.status_code == 200
    names = [r["user"]["nickname"] for r in res.data["results"]]
    assert names == ["riya_k", "ariyaa"]  # starts-with first
    assert res.data["results"][0]["relation"] == "friend"
    assert res.data["results"][0]["joined"]
    assert auth_client(alice).get("/api/people/?q=r").data["results"] == []  # 2+ letters


@pytest.mark.django_db
def test_message_request_flow(alice, bob):
    # Alice writes to bob (not friends): a quiet request, text only, 3 messages.
    for i in range(3):
        social.send_dm(alice, bob.id, f"hi {i}")
    with pytest.raises(social.SocialError) as e:
        social.send_dm(alice, bob.id, "one more")
    assert e.value.code == "request_limit"
    with pytest.raises(social.SocialError):
        social.send_dm(alice, bob.id, "gif:abcd1234:200x150")
    assert social.chat_state(alice.id, bob.id) == "outgoing"
    assert social.chat_state(bob.id, alice.id) == "incoming"
    assert social.conversations_of(bob)[0]["request"] == "incoming"
    assert social.conversations_of(alice)[0]["request"] == "outgoing"
    assert social.request_messages_left(alice.id, bob.id) == 0

    # Bob accepts: both can write freely (text and GIFs), but photos stay for friends.
    res = auth_client(bob).post(f"/api/dms/{alice.id}/request/", {"action": "accept"}, format="json")
    assert res.status_code == 200 and res.data["chat_state"] == "accepted"
    social.send_dm(alice, bob.id, "thanks!")
    social.send_dm(bob, alice.id, "sure")
    assert social.conversations_of(bob)[0]["request"] is None
    history = auth_client(alice).get(f"/api/dms/{bob.id}/messages/").data
    assert history["chat_state"] == "accepted" and history["request_messages_left"] is None


@pytest.mark.django_db
def test_delete_hides_the_request_and_replying_accepts(alice, bob):
    carol = make_member("carol")
    social.send_dm(alice, bob.id, "hello?")
    auth_client(bob).post(f"/api/dms/{alice.id}/request/", {"action": "delete"}, format="json")
    assert social.conversations_of(bob) == []  # gone for bob
    assert social.conversations_of(alice)[0]["request"] == "outgoing"  # alice isn't told

    social.send_dm(carol, bob.id, "hey bob")
    social.send_dm(bob, carol.id, "hey!")  # writing back accepts
    assert social.chat_state(carol.id, bob.id) == "accepted"


@pytest.mark.django_db
def test_requests_need_a_saved_account_and_respect_blocks_and_privacy(alice, bob):
    guest = User.create_guest(nickname="guesty")
    with pytest.raises(social.SocialError) as e:
        social.send_dm(guest, alice.id, "hi")
    assert e.value.code == "account_required"
    with pytest.raises(social.SocialError):
        social.send_dm(alice, guest.id, "hi guest")
    User.objects.filter(pk=bob.pk).update(discoverable=False)
    with pytest.raises(social.SocialError):
        social.send_dm(alice, bob.id, "hi")
    carol = make_member("carol")
    Block.objects.create(blocker=carol, blocked=alice)
    with pytest.raises(social.SocialError):
        social.send_dm(alice, carol.id, "hi")
    assert not Conversation.objects.exists()


@pytest.mark.django_db
def test_random_chat_skips_friends_and_accepted_chats(alice, bob, settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_QUEUE_TTL": 600}
    carol, dave = make_member("carol"), make_member("dave")
    befriend(alice, bob)
    social.send_dm(alice, carol.id, "hi carol")
    social.send_dm(carol, alice.id, "hi!")  # accepted
    assert social.connected_ids(alice.id) == {bob.id, carol.id}

    now = time.time()
    store = matchmaker.backend()
    for u in (bob, carol, dave):
        store.add(matchmaker.Entry(channel=f"c{u.id}", user_id=u.id, nickname=u.nickname, gender="O", region="any", ts=now))
    me = matchmaker.Entry(channel="me", user_id=alice.id, nickname="alice", gender="F", region="any")
    partner = matchmaker.find_or_wait(me, social.connected_ids(alice.id))
    assert partner.user_id == dave.id
