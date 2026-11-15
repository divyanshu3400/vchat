import pytest

from apps.accounts.models import User
from apps.social.models import FriendRequest, Friendship
from apps.social.services import send_dm

from .conftest import auth_client

pytestmark = pytest.mark.django_db


def befriend(a, b):
    auth_client(a).post("/api/friends/requests/", {"to_user": b.id}, format="json")
    req = FriendRequest.objects.get(from_user=a, to_user=b, status="pending")
    assert auth_client(b).post(f"/api/friends/requests/{req.id}/accept/").status_code == 204


def test_request_accept_and_list(alice, bob):
    res = auth_client(alice).post("/api/friends/requests/", {"to_user": bob.id}, format="json")
    assert res.status_code == 201 and res.data["status"] == "pending"

    incoming = auth_client(bob).get("/api/friends/requests/").data["incoming"]
    assert [r["from_user"]["nickname"] for r in incoming] == ["alice"]
    assert auth_client(alice).get("/api/friends/requests/").data["outgoing"][0]["to_user"]["id"] == bob.id

    # Only the recipient can accept.
    assert auth_client(alice).post(f"/api/friends/requests/{incoming[0]['id']}/accept/").status_code == 404
    assert auth_client(bob).post(f"/api/friends/requests/{incoming[0]['id']}/accept/").status_code == 204

    assert [f["user"]["nickname"] for f in auth_client(alice).get("/api/friends/").data] == ["bob"]
    assert [f["user"]["nickname"] for f in auth_client(bob).get("/api/friends/").data] == ["alice"]
    assert auth_client(bob).get("/api/friends/requests/").data == {"incoming": [], "outgoing": []}


def test_repeat_request_is_idempotent_and_crossed_requests_auto_accept(alice, bob):
    auth_client(alice).post("/api/friends/requests/", {"to_user": bob.id}, format="json")
    again = auth_client(alice).post("/api/friends/requests/", {"to_user": bob.id}, format="json")
    assert again.status_code == 201
    assert FriendRequest.objects.filter(status="pending").count() == 1

    crossed = auth_client(bob).post("/api/friends/requests/", {"to_user": alice.id}, format="json")
    assert crossed.status_code == 200 and crossed.data["status"] == "accepted"
    assert Friendship.objects.count() == 1

    dup = auth_client(alice).post("/api/friends/requests/", {"to_user": bob.id}, format="json")
    assert dup.status_code == 400 and dup.data["code"] == "already_friends"


def test_decline_and_cancel(alice, bob, db):
    carol = User.create_guest(nickname="carol")
    auth_client(alice).post("/api/friends/requests/", {"to_user": bob.id}, format="json")
    auth_client(alice).post("/api/friends/requests/", {"to_user": carol.id}, format="json")
    to_bob = FriendRequest.objects.get(to_user=bob)
    to_carol = FriendRequest.objects.get(to_user=carol)

    assert auth_client(bob).post(f"/api/friends/requests/{to_bob.id}/decline/").status_code == 204
    assert auth_client(bob).post(f"/api/friends/requests/{to_carol.id}/cancel/").status_code == 404  # not his
    assert auth_client(alice).post(f"/api/friends/requests/{to_carol.id}/cancel/").status_code == 204
    assert not FriendRequest.objects.filter(status="pending").exists()
    assert not Friendship.objects.exists()


def test_cannot_add_self_or_someone_blocked(alice, bob):
    assert auth_client(alice).post("/api/friends/requests/", {"to_user": alice.id}, format="json").status_code == 400
    auth_client(bob).post(f"/api/users/{alice.id}/block/")
    res = auth_client(alice).post("/api/friends/requests/", {"to_user": bob.id}, format="json")
    assert res.status_code == 400 and res.data["code"] == "not_allowed"


def test_blocking_removes_friendship_and_pending_requests(alice, bob, db):
    befriend(alice, bob)
    carol = User.create_guest(nickname="carol")
    auth_client(carol).post("/api/friends/requests/", {"to_user": alice.id}, format="json")

    auth_client(alice).post(f"/api/users/{bob.id}/block/")
    auth_client(alice).post(f"/api/users/{carol.id}/block/")
    assert not Friendship.objects.exists()
    assert not FriendRequest.objects.filter(status="pending").exists()


def test_unfriend(alice, bob):
    befriend(alice, bob)
    assert auth_client(bob).delete(f"/api/friends/{alice.id}/").status_code == 204
    assert auth_client(alice).get("/api/friends/").data == []


def test_dm_history_unread_and_read(alice, bob):
    befriend(alice, bob)
    for text in ("hey", "you there?", "hello?"):
        send_dm(alice, bob.id, text)

    convos = auth_client(bob).get("/api/dms/").data
    assert convos[0]["user"]["nickname"] == "alice"
    assert convos[0]["last_message"] == "hello?" and convos[0]["unread"] == 3
    assert auth_client(alice).get("/api/dms/").data[0]["unread"] == 0  # own messages count as read

    history = auth_client(bob).get(f"/api/dms/{alice.id}/messages/?limit=2").data
    assert [m["content"] for m in history["messages"]] == ["you there?", "hello?"]
    assert history["has_more"] is True and history["is_friend"] is True
    assert history["messages"][0]["recipient_id"] == bob.id

    last_id = history["messages"][-1]["id"]
    assert auth_client(bob).post(f"/api/dms/{alice.id}/read/", {"last_id": last_id}, format="json").status_code == 204
    assert auth_client(bob).get("/api/dms/").data[0]["unread"] == 0
    # Read position never moves backwards.
    auth_client(bob).post(f"/api/dms/{alice.id}/read/", {"last_id": 1}, format="json")
    assert auth_client(bob).get("/api/dms/").data[0]["unread"] == 0


def test_dm_history_hidden_when_blocked(alice, bob):
    befriend(alice, bob)
    send_dm(alice, bob.id, "hi")
    auth_client(bob).post(f"/api/users/{alice.id}/block/")
    assert auth_client(alice).get(f"/api/dms/{bob.id}/messages/").status_code == 404
