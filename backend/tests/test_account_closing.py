"""Deactivating and deleting accounts."""

from datetime import timedelta

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.chat.models import Message, Room
from apps.chat.services import message_payload
from apps.push.models import NotificationPrefs
from apps.social import services as social
from apps.social.models import Friendship, FriendRequest, ordered_pair

from .conftest import auth_client, make_member

PASSWORD = "a-Long-pass-123"


@pytest.fixture
def pair(db):
    alice, bob = make_member("alice", "F"), make_member("bob", "M")
    for u in (alice, bob):
        u.set_password(PASSWORD)
        u.save()
    x, y = ordered_pair(alice.id, bob.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)
    social.send_dm(alice, bob.id, "my secret words")
    return alice, bob


def login(email, password=PASSWORD):
    return APIClient().post("/api/auth/login/", {"email": email, "password": password}, format="json")


@pytest.mark.django_db
def test_deactivated_account_is_masked_everywhere_and_comes_back_on_login(pair):
    alice, bob = pair
    room = Room.objects.create(slug="lobby", name="Lobby", kind=Room.Kind.TOPIC)
    room_msg = Message.objects.create(room=room, sender=alice, content="hi room")

    assert auth_client(alice).post("/api/auth/account/deactivate/", {"password": "nope"}, format="json").status_code == 400
    res = auth_client(alice).post("/api/auth/account/deactivate/", {"password": PASSWORD}, format="json")
    assert res.status_code == 200

    alice.refresh_from_db()
    assert not alice.is_active and alice.deactivated_at and alice.delete_after is None
    # Signed out: the old token no longer works.
    assert auth_client(alice).get("/api/auth/me/").status_code == 401

    history, _ = social.dm_history(bob, alice.id, None, 50)
    assert history[0]["content"] == "********" and history[0]["sender"]["nickname"] == "vChat user"
    assert history[0]["sender"]["inactive"] is True
    assert social.conversations_of(bob)[0]["last_message"] == "********"
    assert social.conversations_of(bob)[0]["user"]["nickname"] == "vChat user"
    assert [f["user"]["nickname"] for f in social.friends_of(bob)] == ["vChat user"]
    room_msg.refresh_from_db()
    payload = message_payload(room_msg)
    assert payload["content"] == "********" and payload["sender"]["nickname"] == "vChat user"
    # The text itself is kept.
    assert room_msg.content == "hi room"

    with pytest.raises(social.SocialError):
        social.send_dm(bob, alice.id, "are you there?")
    # The old chat still opens for bob, masked.
    res = auth_client(bob).get(f"/api/dms/{alice.id}/messages/")
    assert res.status_code == 200 and res.data["partner"]["inactive"] is True
    assert res.data["messages"][0]["content"] == "********"

    res = login("alice@example.com")
    assert res.status_code == 200 and "deletion_cancelled" not in res.data
    alice.refresh_from_db()
    assert alice.is_active and alice.deactivated_at is None
    history, _ = social.dm_history(bob, alice.id, None, 50)
    assert history[0]["content"] == "my secret words" and history[0]["sender"]["nickname"] == "alice"


@pytest.mark.django_db
def test_delete_waits_15_days_and_login_cancels_it(pair):
    alice, bob = pair
    FriendRequest.objects.create(from_user=alice, to_user=make_member("carol"))
    assert auth_client(alice).post("/api/auth/account/delete/", {"password": PASSWORD}, format="json").status_code == 400
    res = auth_client(alice).post("/api/auth/account/delete/", {"password": PASSWORD, "confirm": "DELETE"}, format="json")
    assert res.status_code == 200 and res.data["delete_after"]
    alice.refresh_from_db()
    assert not alice.is_active and alice.delete_after - timezone.now() > timedelta(days=14)
    assert not FriendRequest.objects.filter(from_user=alice).exists()

    res = login("alice@example.com")
    assert res.status_code == 200 and res.data["deletion_cancelled"] is True
    alice.refresh_from_db()
    assert alice.is_active and alice.delete_after is None


@pytest.mark.django_db
def test_after_15_days_the_account_is_erased_but_messages_stay_masked(pair):
    alice, bob = pair
    auth_client(alice).post("/api/auth/account/delete/", {"password": PASSWORD, "confirm": "DELETE"}, format="json")
    User.objects.filter(pk=alice.pk).update(delete_after=timezone.now() - timedelta(minutes=1))
    call_command("purge_old_data")

    alice.refresh_from_db()
    assert alice.deleted_at and alice.email == "" and alice.nickname == "vChat user"
    assert not alice.has_usable_password()
    assert not Friendship.objects.filter(user_a=alice).exists() and not Friendship.objects.filter(user_b=alice).exists()
    assert login("alice@example.com").status_code == 400
    history, _ = social.dm_history(bob, alice.id, None, 50)
    assert history[0]["content"] == "********"
    # The email can be used for a new account.
    assert not User.objects.filter(email__iexact="alice@example.com").exists()


@pytest.mark.django_db
def test_guest_is_deleted_at_once_and_cannot_deactivate():
    guest = User.create_guest(nickname="ghost")
    assert auth_client(guest).post("/api/auth/account/deactivate/", {}, format="json").status_code == 400
    res = auth_client(guest).post("/api/auth/account/delete/", {"confirm": "DELETE"}, format="json")
    assert res.status_code == 200 and res.data["deleted"] is True
    guest.refresh_from_db()
    assert guest.deleted_at and not guest.is_active


@pytest.mark.django_db
def test_deletion_email_only_when_account_emails_are_on(pair, settings):
    alice, bob = pair
    settings.EMAIL_ENABLED = True
    auth_client(alice).post("/api/auth/account/delete/", {"password": PASSWORD, "confirm": "DELETE"}, format="json")
    assert len(mail.outbox) == 0

    NotificationPrefs.objects.create(user=bob, email=True)
    auth_client(bob).post("/api/auth/account/delete/", {"password": PASSWORD, "confirm": "DELETE"}, format="json")
    assert len(mail.outbox) == 1 and "deleted" in mail.outbox[0].subject
