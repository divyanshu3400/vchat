import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat.models import Room
from apps.social.models import DirectMessage, Friendship, ordered_pair
from config.asgi import application

from .conftest import auth_client, make_member

ORIGIN = [(b"origin", b"http://localhost:3000")]
pytestmark = pytest.mark.django_db(transaction=True)


@database_sync_to_async
def make_user(nickname):
    user = make_member(nickname)
    return user, str(AccessToken.for_user(user))


@database_sync_to_async
def make_friends(a, b):
    x, y = ordered_pair(a.id, b.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)


async def personal_socket(token):
    comm = WebsocketCommunicator(application, "/ws/me/", headers=ORIGIN)
    connected, _ = await comm.connect()
    assert connected
    await comm.send_json_to({"type": "auth", "token": token})
    assert (await comm.receive_json_from())["type"] == "ready"
    return comm


async def test_dm_between_friends_reaches_both_and_is_saved():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    await make_friends(alice, bob)
    a = await personal_socket(a_token)
    b = await personal_socket(b_token)
    assert (await a.receive_json_from())["type"] == "presence"  # bob came online

    await a.send_json_to({"type": "dm", "to": bob.id, "content": "hey bob", "client_id": "x1"})
    for comm in (a, b):
        event = await comm.receive_json_from()
        assert event["type"] == "dm"
        assert event["message"]["content"] == "hey bob"
        assert event["message"]["sender"]["id"] == alice.id
        assert event["message"]["recipient_id"] == bob.id
        assert event["client_id"] == "x1"
    assert await database_sync_to_async(DirectMessage.objects.count)() == 1
    await a.disconnect()
    await b.disconnect()


async def test_resent_dm_after_a_reconnect_is_not_saved_twice():
    alice, a_token = await make_user("alice")
    bob, _ = await make_user("bob")
    await make_friends(alice, bob)
    a = await personal_socket(a_token)
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "once", "client_id": "same-1"})
    first = await a.receive_json_from()
    await a.disconnect()

    # The app didn't see the confirmation and sends it again on a new connection.
    a = await personal_socket(a_token)
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "once", "client_id": "same-1"})
    again = await a.receive_json_from()
    assert again["type"] == "dm" and again["client_id"] == "same-1"
    assert again["message"]["id"] == first["message"]["id"]
    assert await database_sync_to_async(DirectMessage.objects.count)() == 1
    await a.disconnect()


async def test_dm_to_a_non_friend_is_a_quiet_message_request():
    _, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    a = await personal_socket(a_token)
    b = await personal_socket(b_token)

    await a.send_json_to({"type": "dm", "to": bob.id, "content": "hi stranger", "client_id": "r1"})
    mine = [await a.receive_json_from() for _ in range(2)]
    assert {e["type"] for e in mine} == {"dm", "conversations.changed"}
    assert [e for e in mine if e["type"] == "dm"][0]["request"] is True
    events = [await b.receive_json_from() for _ in range(2)]
    assert {e["type"] for e in events} == {"dm", "conversations.changed"}
    assert [e for e in events if e["type"] == "dm"][0]["request"] is True
    assert await database_sync_to_async(DirectMessage.objects.count)() == 1
    await a.disconnect()
    await b.disconnect()


async def test_friend_request_and_accept_are_pushed_live():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    a = await personal_socket(a_token)
    b = await personal_socket(b_token)

    res = await database_sync_to_async(auth_client(alice).post)(
        "/api/friends/requests/", {"to_user": bob.id}, format="json"
    )
    assert res.status_code == 201
    incoming = await b.receive_json_from()
    assert incoming["type"] == "friend_request" and incoming["request"]["from_user"]["nickname"] == "alice"
    assert (await a.receive_json_from())["type"] == "friend_request"  # sender's own tabs stay in sync

    req_id = incoming["request"]["id"]
    res = await database_sync_to_async(auth_client(bob).post)(f"/api/friends/requests/{req_id}/accept/")
    assert res.status_code == 204
    added_for_alice = await a.receive_json_from()
    added_for_bob = await b.receive_json_from()
    assert added_for_alice == {
        "type": "friend_added",
        "friend": {"id": bob.id, "nickname": "bob", "gender": "O"},
        "online": True,  # bob has a personal socket open
        "request_id": req_id,
    }
    assert added_for_bob["friend"]["id"] == alice.id and added_for_bob["online"] is True
    await a.disconnect()
    await b.disconnect()


async def test_block_hides_sender_in_already_open_room():
    await database_sync_to_async(Room.objects.create)(slug="random", name="Random", kind="topic")
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")

    async def room_socket(token):
        comm = WebsocketCommunicator(application, "/ws/rooms/random/", headers=ORIGIN)
        await comm.connect()
        await comm.send_json_to({"type": "auth", "token": token})
        assert (await comm.receive_json_from())["type"] == "ready"
        return comm

    a = await room_socket(a_token)
    b = await room_socket(b_token)
    res = await database_sync_to_async(auth_client(bob).post)(f"/api/users/{alice.id}/block/")
    assert res.status_code == 204

    await a.send_json_to({"type": "message", "content": "can bob see this?"})
    assert (await a.receive_json_from())["type"] == "message"
    assert await b.receive_nothing(timeout=0.3)
    await a.disconnect()
    await b.disconnect()
