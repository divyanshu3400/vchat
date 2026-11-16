"""Mute and pin chats, last seen with privacy, random-chat interests."""

import time
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.push import events as push_events
from apps.social import services as social
from apps.social.models import Friendship, ordered_pair
from apps.stranger import matchmaker

from .conftest import auth_client, make_member


def befriend(a, b):
    x, y = ordered_pair(a.id, b.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)


@pytest.mark.django_db
def test_mute_stops_notifications_and_pin_goes_on_top(alice, bob):
    carol = make_member("carol")
    befriend(alice, bob)
    befriend(alice, carol)
    social.send_dm(bob, alice.id, "from bob")
    social.send_dm(carol, alice.id, "from carol")  # most recent

    res = auth_client(alice).post(f"/api/dms/{bob.id}/prefs/", {"mute": "8h"}, format="json")
    assert res.status_code == 200 and res.data["muted"] and res.data["muted_until"]
    assert social.is_muted(alice.id, bob.id) and not social.is_muted(bob.id, alice.id)  # only for alice
    with mock.patch("apps.push.events.sender.notify") as notify:
        push_events.dm_received(alice.id, bob.id, "bob", "hi", None)
        notify.assert_not_called()
        push_events.dm_received(alice.id, carol.id, "carol", "hi", None)
        notify.assert_called_once()

    assert auth_client(alice).post(f"/api/dms/{bob.id}/prefs/", {"mute": "always"}, format="json").data["muted_until"] is None
    assert auth_client(alice).post(f"/api/dms/{bob.id}/prefs/", {"mute": "5m"}, format="json").status_code == 400

    # Pinned bob comes before the newer chat with carol.
    assert [c["user"]["id"] for c in social.conversations_of(alice)] == [carol.id, bob.id]
    auth_client(alice).post(f"/api/dms/{bob.id}/prefs/", {"pin": True}, format="json")
    rows = social.conversations_of(alice)
    assert [c["user"]["id"] for c in rows] == [bob.id, carol.id] and rows[0]["pinned"] and rows[0]["muted"]
    assert auth_client(alice).get(f"/api/dms/{bob.id}/messages/").data["prefs"]["pinned"] is True

    auth_client(alice).post(f"/api/dms/{bob.id}/prefs/", {"mute": "off", "pin": False}, format="json")
    assert not social.is_muted(alice.id, bob.id)
    assert [c["user"]["id"] for c in social.conversations_of(alice)] == [carol.id, bob.id]


@pytest.mark.django_db
def test_at_most_three_pins(alice):
    others = [make_member(f"p{i}") for i in range(4)]
    for o in others:
        befriend(alice, o)
    for o in others[:3]:
        assert auth_client(alice).post(f"/api/dms/{o.id}/prefs/", {"pin": True}, format="json").status_code == 200
    res = auth_client(alice).post(f"/api/dms/{others[3].id}/prefs/", {"pin": True}, format="json")
    assert res.status_code == 400 and res.data["code"] == "too_many_pins"


@pytest.mark.django_db
def test_last_seen_only_when_both_allow(alice, bob):
    befriend(alice, bob)
    User.objects.filter(pk=bob.pk).update(last_seen_at=timezone.now() - timedelta(minutes=10))
    friend = social.friends_of(alice)[0]
    assert friend["last_seen"]

    # Bob hides his: nobody sees it.
    assert auth_client(bob).patch("/api/auth/me/", {"show_last_seen": False}, format="json").data["show_last_seen"] is False
    alice.refresh_from_db()
    assert social.friends_of(alice)[0]["last_seen"] is None
    events = dict(social.presence_events(bob.id, online=False))
    assert "last_seen" not in events[alice.id]

    # Alice hides hers (bob shows his again): she doesn't see his either.
    auth_client(bob).patch("/api/auth/me/", {"show_last_seen": True}, format="json")
    User.objects.filter(pk=alice.pk).update(show_last_seen=False)
    alice.refresh_from_db()
    assert social.friends_of(alice)[0]["last_seen"] is None
    events = dict(social.presence_events(bob.id, online=False))
    assert "last_seen" not in events[alice.id]


def entry(uid, interests=(), ts=0.0):
    return matchmaker.Entry(channel=f"c{uid}", user_id=uid, nickname=f"u{uid}", gender="O", region="any", interests=list(interests), ts=ts)


@pytest.mark.django_db
def test_most_shared_interests_first_but_nobody_waits_for_them(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_QUEUE_TTL": 600}
    store = matchmaker.backend()
    now = time.time()
    store.add(entry(1, ["music"], now))  # waited longest
    store.add(entry(2, ["music", "cricket", "movies"], now))
    store.add(entry(3, [], now))
    me = entry(9, ["cricket", "movies", "gaming"])
    partner = matchmaker.find_or_wait(me, set())
    assert partner.user_id == 2 and me.shared(partner) == ["cricket", "movies"]

    # No interests in common with anyone: the longest waiting, as before.
    other = entry(8, ["anime"])
    assert matchmaker.find_or_wait(other, set()).user_id == 1


@pytest.mark.django_db
def test_random_chat_replies_hide_the_name(alice, bob):
    from apps.stranger import services as st
    from apps.stranger.models import StrangerMessage, StrangerSession

    session = StrangerSession.objects.create(user_a=alice, user_b=bob)
    first = StrangerMessage.objects.create(session=session, sender=alice, content="hi")
    reply = StrangerMessage.objects.create(session=session, sender=bob, content="hey", reply_to=first)
    payload = st.message_payload(reply)
    assert payload["reply_to"]["nickname"] == "Anonymous" and payload["reply_to"]["text"] == "hi"
