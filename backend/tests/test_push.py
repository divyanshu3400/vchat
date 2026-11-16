"""Notifications: who gets one, when, what it says, and cleaning up dead devices."""

import json

import pytest
from channels.db import database_sync_to_async
from django.core.cache import cache

from apps.push.models import NotificationPrefs, PushSubscription

from .conftest import auth_client
from .test_message_ops import next_event
from .test_social_ws import make_friends, make_user, personal_socket

ENDPOINT = "https://push.example.com/send/abc"
KEYS = {"p256dh": "BOr_public_key_for_tests", "auth": "auth_secret"}


@pytest.fixture
def sent(settings, monkeypatch):
    """Push is on; every webpush call is recorded instead of sent."""
    settings.VAPID_PUBLIC_KEY = "test-public"
    settings.VAPID_PRIVATE_KEY = "test-private"
    calls = []

    def fake_webpush(subscription_info, data, **kwargs):
        calls.append({"endpoint": subscription_info["endpoint"], **json.loads(data)})

    import pywebpush

    monkeypatch.setattr(pywebpush, "webpush", fake_webpush)
    return calls


@database_sync_to_async
def subscribe(user, endpoint=ENDPOINT):
    res = auth_client(user).post("/api/push/subscribe/", {"endpoint": endpoint, "keys": KEYS}, format="json")
    assert res.status_code == 204


pytestmark = pytest.mark.django_db(transaction=True)


async def test_a_message_notifies_a_friend_who_is_away(sent):
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    await make_friends(alice, bob)
    await subscribe(bob)
    a = await personal_socket(a_token)

    await a.send_json_to({"type": "dm", "to": bob.id, "content": "hey, free tonight?", "client_id": "1"})
    await next_event(a)
    assert len(sent) == 1
    assert sent[0]["title"] == "alice" and sent[0]["body"] == "hey, free tonight?"
    assert sent[0]["url"] == f"/chat/dm/{alice.id}" and sent[0]["tag"] == f"dm-{alice.id}"
    assert sent[0]["badge"] == 1

    # A second message within 30 s doesn't buzz again.
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "?", "client_id": "2"})
    await next_event(a)
    assert len(sent) == 1
    await a.disconnect()


async def test_no_notification_while_vchat_is_on_screen(sent):
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    await make_friends(alice, bob)
    await subscribe(bob)
    a, b = await personal_socket(a_token), await personal_socket(b_token)
    await b.send_json_to({"type": "visible", "visible": True})
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "you there?", "client_id": "1"})
    await next_event(a)
    assert sent == []

    # Bob switches apps: the next message notifies.
    await b.send_json_to({"type": "visible", "visible": False})
    await database_sync_to_async(cache.clear)()
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "hello?", "client_id": "2"})
    await next_event(a)
    assert [s["body"] for s in sent] == ["hello?"]
    await a.disconnect()
    await b.disconnect()


async def test_settings_switch_off_or_hide_the_text(sent):
    alice, a_token = await make_user("alice")
    bob, _ = await make_user("bob")
    await make_friends(alice, bob)
    await subscribe(bob)
    res = await database_sync_to_async(auth_client(bob).patch)("/api/push/", {"preview": False}, format="json")
    assert res.data["prefs"] == {"messages": True, "requests": True, "calls": True, "preview": False, "email": False}
    a = await personal_socket(a_token)
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "secret stuff", "client_id": "1"})
    await next_event(a)
    assert sent[-1]["body"] == "New message"

    await database_sync_to_async(auth_client(bob).patch)("/api/push/", {"messages": False}, format="json")
    await database_sync_to_async(cache.clear)()
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "again", "client_id": "2"})
    await next_event(a)
    assert len(sent) == 1
    await a.disconnect()


async def test_friend_requests_and_accepts_notify(sent):
    alice, _ = await make_user("alice")
    bob, _ = await make_user("bob")
    await subscribe(alice)
    await subscribe(bob, "https://push.example.com/send/bob")
    res = await database_sync_to_async(auth_client(alice).post)("/api/friends/requests/", {"to_user": bob.id}, format="json")
    assert sent[-1]["title"] == "New friend request" and "alice" in sent[-1]["body"]
    assert sent[-1]["endpoint"].endswith("/bob")
    req_id = res.data["request"]["id"]
    await database_sync_to_async(auth_client(bob).post)(f"/api/friends/requests/{req_id}/accept/")
    assert sent[-1]["title"] == "bob accepted" and sent[-1]["url"] == f"/chat/dm/{bob.id}"
    assert sent[-1]["endpoint"] == ENDPOINT


async def test_unanswered_friend_call_is_a_missed_call(sent):
    alice, a_token = await make_user("alice")
    bob, _ = await make_user("bob")
    await make_friends(alice, bob)
    await subscribe(bob)
    a = await personal_socket(a_token)
    await a.send_json_to({"type": "call.invite", "call_id": "0f0f0f0f-1111-2222-3333-444455556666", "kind": "video", "to": bob.id})
    assert (await next_event(a))["type"] == "call.ringing"
    await a.send_json_to({"type": "call.end", "call_id": "0f0f0f0f-1111-2222-3333-444455556666"})
    for _ in range(20):
        if sent:
            break
        import asyncio

        await asyncio.sleep(0.05)
    assert sent[-1]["title"] == "Missed video call" and "alice" in sent[-1]["body"]
    await a.disconnect()


async def test_dead_devices_are_forgotten(sent, monkeypatch):
    from pywebpush import WebPushException

    import pywebpush

    class Gone:
        status_code = 410

    def gone(**kwargs):
        raise WebPushException("gone", response=Gone())

    monkeypatch.setattr(pywebpush, "webpush", gone)
    alice, a_token = await make_user("alice")
    bob, _ = await make_user("bob")
    await make_friends(alice, bob)
    await subscribe(bob)
    a = await personal_socket(a_token)
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "hi", "client_id": "1"})
    await next_event(a)
    assert not await database_sync_to_async(PushSubscription.objects.exists)()
    await a.disconnect()


async def test_push_api(sent):
    bob, _ = await make_user("bob")
    client = auth_client(bob)
    info = await database_sync_to_async(client.get)("/api/push/")
    assert info.data["enabled"] is True and info.data["public_key"] == "test-public" and info.data["devices"] == 0
    await subscribe(bob)
    await subscribe(bob)  # the same device again: still one
    assert (await database_sync_to_async(client.get)("/api/push/")).data["devices"] == 1
    res = await database_sync_to_async(client.post)(
        "/api/push/subscribe/", {"endpoint": "http://insecure.example", "keys": KEYS}, format="json"
    )
    assert res.status_code == 400
    await database_sync_to_async(client.post)("/api/push/unsubscribe/", {"endpoint": ENDPOINT}, format="json")
    assert (await database_sync_to_async(client.get)("/api/push/")).data["devices"] == 0
    assert await database_sync_to_async(NotificationPrefs.objects.count)() == 0
