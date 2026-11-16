"""Bans, ban evasion, auto-mute, auto-suspension from random chat, slurs, the contact form, purging."""

from datetime import timedelta

import pytest
from channels.db import database_sync_to_async
from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts import moderation
from apps.accounts.models import User
from apps.chat.models import Message, Report
from apps.support.models import ContactMessage

from .conftest import auth_client, make_member
from .test_social_ws import make_user, personal_socket
from .test_ws import connect, make_room

GUEST = {"nickname": "comeback", "gender": "O", "age_confirmed": True}


@pytest.fixture(autouse=True)
def no_throttles(settings):
    rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {**rates, "guest_signup": "1000/hour", "contact": "1000/hour", "login": "1000/hour"},
    }


@pytest.mark.django_db
def test_a_ban_blocks_the_api_refresh_and_a_new_guest_from_the_same_browser():
    browser = APIClient()
    res = browser.post("/api/auth/guest/", GUEST, format="json")
    assert "vchat_dev" in res.cookies  # the device cookie
    user = User.objects.get(id=res.data["user"]["id"])
    assert user.device_hash and user.last_ip_hash

    moderation.ban(user, timedelta(days=1), "Spam")
    assert auth_client(user).get("/api/friends/").status_code == 403
    res = browser.post("/api/auth/refresh/")
    assert res.status_code == 403 and res.data["code"] == "banned" and "Spam" in res.data["detail"]

    # Same browser (device cookie) can't start over as a new guest.
    res = browser.post("/api/auth/guest/", GUEST, format="json")
    assert res.status_code == 403 and res.data["code"] == "banned"

    moderation.unban(user)
    assert browser.post("/api/auth/refresh/").status_code == 200
    assert browser.post("/api/auth/guest/", {**GUEST, "nickname": "comeback2"}, format="json").status_code == 201  # names are unique now


@pytest.mark.django_db
def test_an_ip_mark_lasts_at_most_a_day():
    user = User.create_guest(nickname="ipban")
    User.objects.filter(pk=user.pk).update(last_ip_hash=moderation.digest("127.0.0.1"))
    user.refresh_from_db()
    moderation.ban(user, None, "Hate speech")
    other_browser = APIClient()  # new device, same IP (the test client's)
    assert other_browser.post("/api/auth/guest/", GUEST, format="json").status_code == 403
    mark = user.ban_marks.get(kind="ip")
    assert mark.until <= timezone.now() + timedelta(hours=24, minutes=1)
    assert user.ban_marks.get(kind="device" if user.device_hash else "ip")


@pytest.mark.django_db
def test_login_is_refused_while_banned():
    user = make_member("banme")
    user.set_password("milk-and-mint-42")
    user.save()
    moderation.ban(user, timedelta(days=7), "Harassment")
    res = APIClient().post("/api/auth/login/", {"email": "banme@example.com", "password": "milk-and-mint-42"}, format="json")
    assert res.status_code == 403 and res.data["code"] == "banned"


@pytest.mark.django_db(transaction=True)
async def test_a_ban_closes_open_sockets_and_new_ones():
    alice, a_token = await make_user("alice")
    sock = await personal_socket(a_token)
    await database_sync_to_async(moderation.ban)(alice, timedelta(days=1), "Spam")
    ev = await sock.receive_json_from()
    assert ev["type"] == "error" and ev["code"] == "banned"
    assert (await sock.receive_output())["type"] == "websocket.close"

    from channels.testing import WebsocketCommunicator

    from config.asgi import application

    again = WebsocketCommunicator(application, "/ws/me/", headers=[(b"origin", b"http://localhost:3000")])
    await again.connect()
    await again.send_json_to({"type": "auth", "token": a_token})
    assert (await again.receive_json_from())["code"] == "banned"
    await again.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_room_flooding_and_link_spam_mute(settings):
    settings.VCHAT = {**settings.VCHAT, "RATE_LIMIT_MESSAGES": 100}
    await make_room()
    _, token = await make_user("flooder")
    room = await connect("random", token)
    for _ in range(2):
        await room.send_json_to({"type": "message", "content": "buy now", "client_id": "x"})
        assert (await room.receive_json_from())["type"] == "message"
    await room.send_json_to({"type": "message", "content": "buy now", "client_id": "x"})
    ev = await room.receive_json_from()
    assert ev["code"] == "muted" and "10 more minutes" in ev["detail"]
    await room.send_json_to({"type": "message", "content": "something else", "client_id": "y"})
    assert (await room.receive_json_from())["code"] == "muted"
    await room.disconnect()

    _, token2 = await make_user("linker")
    room2 = await connect("random", token2)
    for i in range(3):
        await room2.send_json_to({"type": "message", "content": f"see https://spam{i}.example", "client_id": "x"})
        assert (await room2.receive_json_from())["type"] == "message"
    await room2.send_json_to({"type": "message", "content": "and https://more.example", "client_id": "x"})
    assert (await room2.receive_json_from())["code"] == "muted"
    await room2.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_slurs_are_refused():
    await make_room()
    _, token = await make_user("hater")
    room = await connect("random", token)
    await room.send_json_to({"type": "message", "content": "you f4ggot", "client_id": "x"})
    assert (await room.receive_json_from())["code"] == "invalid_message"
    await room.send_json_to({"type": "message", "content": "what the fuck", "client_id": "y"})  # swearing: masked by the app
    assert (await room.receive_json_from())["type"] == "message"
    await room.disconnect()


@pytest.mark.django_db
def test_three_reporters_pause_random_chat():
    target = make_member("target")
    for i in range(3):
        reporter = make_member(f"rep{i}")
        res = auth_client(reporter).post("/api/reports/", {"reported_user": target.id, "reason": "harassment"}, format="json")
        assert res.status_code == 201
    target.refresh_from_db()
    assert target.random_blocked_until and target.random_blocked_until > timezone.now() + timedelta(hours=23)


@pytest.mark.django_db(transaction=True)
async def test_a_suspended_user_cannot_search_random_chat():
    user, token = await make_user("paused")
    await database_sync_to_async(User.objects.filter(pk=user.pk).update)(random_blocked_until=timezone.now() + timedelta(hours=5))
    sock = await personal_socket(token)
    await sock.send_json_to({"type": "stranger.find"})
    assert (await sock.receive_json_from())["code"] == "random_suspended"
    await sock.disconnect()


@pytest.mark.django_db
def test_contact_form_saves_and_emails_support(settings):
    settings.SUPPORT_EMAIL = "support@example.com"
    res = APIClient().post(
        "/api/contact/", {"topic": "problem", "name": "Asha", "email": "Asha@Example.com", "message": "The call button does nothing."}, format="json"
    )
    assert res.status_code == 202
    row = ContactMessage.objects.get()
    assert row.email == "asha@example.com" and row.emailed
    assert mail.outbox[-1].to == ["support@example.com"] and mail.outbox[-1].reply_to == ["asha@example.com"]

    # Bots fill the hidden field: thanked, not stored.
    APIClient().post("/api/contact/", {"topic": "other", "email": "b@example.com", "message": "cheap pills here!!", "website": "x"}, format="json")
    assert ContactMessage.objects.count() == 1


@pytest.mark.django_db
def test_purge_keeps_reported_evidence(room, alice, bob):
    old = timezone.now() - timedelta(days=400)
    kept = Message.objects.create(room=room, sender=alice, content="evidence")
    gone = Message.objects.create(room=room, sender=alice, content="old chatter")
    fresh = Message.objects.create(room=room, sender=alice, content="today")
    Message.objects.filter(id__in=[kept.id, gone.id]).update(created_at=old)
    Report.objects.create(reporter=bob, reported_user=alice, message=kept, reason="spam")
    call_command("purge_old_data")
    assert set(Message.objects.values_list("content", flat=True)) == {"evidence", "today"}
    assert fresh
