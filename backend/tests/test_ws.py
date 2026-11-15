import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat.models import Block, Message, Room
from config.asgi import application

ORIGIN = [(b"origin", b"http://localhost:3000")]
pytestmark = pytest.mark.django_db(transaction=True)


@database_sync_to_async
def make_room(**kw):
    return Room.objects.create(slug=kw.pop("slug", "random"), name="Random", kind="topic", **kw)


@database_sync_to_async
def make_user(nickname):
    user = User.create_guest(nickname=nickname, gender="O")
    return user, str(AccessToken.for_user(user))


async def connect(slug, token=None):
    comm = WebsocketCommunicator(application, f"/ws/rooms/{slug}/", headers=ORIGIN)
    connected, _ = await comm.connect()
    assert connected
    if token:
        await comm.send_json_to({"type": "auth", "token": token})
        ready = await comm.receive_json_from()
        assert ready["type"] == "ready"
    return comm


async def test_message_is_saved_and_broadcast_to_room():
    await make_room()
    alice, alice_token = await make_user("alice")
    _, bob_token = await make_user("bob")
    a = await connect("random", alice_token)
    b = await connect("random", bob_token)

    await a.send_json_to({"type": "message", "content": "  hi there  ", "client_id": "c1"})
    for comm in (a, b):
        event = await comm.receive_json_from()
        assert event["type"] == "message"
        assert event["message"]["content"] == "hi there"
        assert event["message"]["sender"]["nickname"] == "alice"
        assert event["client_id"] == "c1"

    assert await database_sync_to_async(Message.objects.filter(sender=alice).count)() == 1
    await a.disconnect()
    await b.disconnect()


async def test_unknown_room_is_refused():
    comm = WebsocketCommunicator(application, "/ws/rooms/nope/", headers=ORIGIN)
    connected, code = await comm.connect()
    assert not connected and code == 4404


async def test_message_before_auth_closes_socket():
    await make_room()
    comm = await connect("random")
    await comm.send_json_to({"type": "message", "content": "sneaky"})
    closed = await comm.receive_output()
    assert closed == {"type": "websocket.close", "code": 4401}
    await comm.disconnect()


async def test_bad_token_is_rejected():
    await make_room()
    comm = await connect("random")
    await comm.send_json_to({"type": "auth", "token": "not-a-jwt"})
    err = await comm.receive_json_from()
    assert err["code"] == "unauthorized"
    await comm.disconnect()


async def test_flood_and_length_limits():
    await make_room()
    _, token = await make_user("flooder")
    comm = await connect("random", token)

    await comm.send_json_to({"type": "message", "content": "x" * 1001})
    assert (await comm.receive_json_from())["code"] == "invalid_message"

    codes = []
    for i in range(7):
        await comm.send_json_to({"type": "message", "content": f"spam {i}"})
        codes.append((await comm.receive_json_from()).get("code"))
    assert codes[:5] == [None] * 5  # delivered
    assert codes[5:] == ["rate_limited", "rate_limited"]
    await comm.disconnect()


async def test_blocked_sender_is_not_delivered():
    await make_room()
    alice, alice_token = await make_user("alice")
    bob, bob_token = await make_user("bob")
    await database_sync_to_async(Block.objects.create)(blocker=bob, blocked=alice)

    a = await connect("random", alice_token)
    b = await connect("random", bob_token)
    await a.send_json_to({"type": "message", "content": "hello bob"})
    assert (await a.receive_json_from())["type"] == "message"  # alice sees her own message
    assert await b.receive_nothing(timeout=0.3)
    await a.disconnect()
    await b.disconnect()
