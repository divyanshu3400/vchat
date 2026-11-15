import pytest
from rest_framework.test import APIClient

from apps.chat.models import Block, Message, Report

from .conftest import auth_client


@pytest.mark.django_db
def test_room_list_is_public(room):
    res = APIClient().get("/api/rooms/")
    assert res.status_code == 200
    assert [r["slug"] for r in res.data] == ["random"]


@pytest.mark.django_db
def test_history_pages_backwards_and_hides_deleted(room, alice):
    msgs = [Message.objects.create(room=room, sender=alice, content=f"m{i}") for i in range(5)]
    Message.objects.filter(id=msgs[1].id).update(deleted_at=msgs[1].created_at)
    client = auth_client(alice)

    first = client.get("/api/rooms/random/messages/?limit=2").data
    assert [m["content"] for m in first["messages"]] == ["m3", "m4"]
    assert first["has_more"] is True

    older = client.get(f"/api/rooms/random/messages/?limit=10&before={first['messages'][0]['id']}").data
    assert [m["content"] for m in older["messages"]] == ["m0", "m2"]
    assert older["has_more"] is False


@pytest.mark.django_db
def test_history_requires_auth(room):
    assert APIClient().get("/api/rooms/random/messages/").status_code == 401


@pytest.mark.django_db
def test_blocked_users_are_hidden_both_ways(room, alice, bob):
    Message.objects.create(room=room, sender=bob, content="from bob")
    Message.objects.create(room=room, sender=alice, content="from alice")

    assert auth_client(alice).post(f"/api/users/{bob.id}/block/").status_code == 204
    assert Block.objects.filter(blocker=alice, blocked=bob).exists()

    alice_view = auth_client(alice).get("/api/rooms/random/messages/").data["messages"]
    bob_view = auth_client(bob).get("/api/rooms/random/messages/").data["messages"]
    assert [m["content"] for m in alice_view] == ["from alice"]
    assert [m["content"] for m in bob_view] == ["from bob"]

    assert auth_client(alice).post(f"/api/users/{alice.id}/block/").status_code == 400


@pytest.mark.django_db
def test_report_validates_message_owner(room, alice, bob):
    msg = Message.objects.create(room=room, sender=bob, content="buy crypto now")
    client = auth_client(alice)

    ok = client.post("/api/reports/", {"reported_user": bob.id, "message": msg.id, "reason": "scam"}, format="json")
    assert ok.status_code == 201
    assert Report.objects.get().reporter == alice

    wrong_owner = client.post(
        "/api/reports/", {"reported_user": alice.id, "message": msg.id, "reason": "spam"}, format="json"
    )
    assert wrong_owner.status_code == 400
