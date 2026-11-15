import base64
import hashlib
import hmac
import uuid

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat.models import Block
from apps.social.models import Friendship, ordered_pair
from config.asgi import application

from .conftest import auth_client

ORIGIN = [(b"origin", b"http://localhost:3000")]
pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def fast(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 0}


@database_sync_to_async
def make_user(nickname):
    user = User.create_guest(nickname=nickname, gender="O")
    return user, str(AccessToken.for_user(user))


@database_sync_to_async
def befriend(a, b):
    x, y = ordered_pair(a.id, b.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)


async def sock(token):
    comm = WebsocketCommunicator(application, "/ws/me/", headers=ORIGIN)
    await comm.connect()
    await comm.send_json_to({"type": "auth", "token": token})
    assert (await comm.receive_json_from())["type"] == "ready"
    return comm


async def next_of(comm, *types):
    """Skip presence noise; return the next event of one of `types`."""
    for _ in range(10):
        ev = await comm.receive_json_from()
        if ev["type"] in types:
            return ev
    raise AssertionError(types)


def cid():
    return str(uuid.uuid4())


async def test_friend_video_call_ring_answer_signal_end():
    alice, a_tok = await make_user("alice")
    bob, b_tok = await make_user("bob")
    await befriend(alice, bob)
    a, b1, b2 = await sock(a_tok), await sock(b_tok), await sock(b_tok)  # bob has two tabs
    call = cid()

    await a.send_json_to({"type": "call.invite", "call_id": call, "kind": "video", "to": bob.id})
    assert (await next_of(a, "call.ringing"))["call_id"] == call
    for tab in (b1, b2):
        inc = await next_of(tab, "call.incoming")
        assert inc["kind"] == "video" and inc["from"]["nickname"] == "alice" and inc["stranger"] is False

    await b2.send_json_to({"type": "call.accept", "call_id": call})
    assert (await next_of(a, "call.accepted"))["call_id"] == call
    assert (await next_of(b1, "call.taken"))["call_id"] == call  # stop ringing on the other tab
    await b1.send_json_to({"type": "call.accept", "call_id": call})
    assert (await next_of(b1, "error"))["code"] == "call_gone"

    await a.send_json_to({"type": "call.signal", "call_id": call, "data": {"sdp": {"type": "offer", "sdp": "v=0"}}})
    sig = await next_of(b2, "call.signal")
    assert sig["data"]["sdp"]["type"] == "offer"
    assert await b1.receive_nothing(timeout=0.2)  # only the answering tab gets media setup

    await b2.send_json_to({"type": "call.end", "call_id": call})
    assert (await next_of(a, "call.ended"))["reason"] == "ended"
    for c in (a, b1, b2):
        await c.disconnect()


async def test_only_friends_can_call_and_blocks_stop_calls():
    alice, a_tok = await make_user("alice")
    bob, _ = await make_user("bob")
    a = await sock(a_tok)
    await a.send_json_to({"type": "call.invite", "call_id": cid(), "kind": "voice", "to": bob.id})
    assert (await next_of(a, "error"))["code"] == "call_not_allowed"

    await befriend(alice, bob)
    await database_sync_to_async(Block.objects.create)(blocker=bob, blocked=alice)
    await a.send_json_to({"type": "call.invite", "call_id": cid(), "kind": "voice", "to": bob.id})
    assert (await next_of(a, "error"))["code"] == "call_not_allowed"
    await a.disconnect()


async def test_decline_busy_and_hang_up_on_tab_close():
    alice, a_tok = await make_user("alice")
    bob, b_tok = await make_user("bob")
    carol, c_tok = await make_user("carol")
    await befriend(alice, bob)
    await befriend(carol, bob)
    a, b, c = await sock(a_tok), await sock(b_tok), await sock(c_tok)

    first = cid()
    await a.send_json_to({"type": "call.invite", "call_id": first, "kind": "voice", "to": bob.id})
    await next_of(b, "call.incoming")
    await b.send_json_to({"type": "call.decline", "call_id": first})
    assert (await next_of(a, "call.declined"))["call_id"] == first

    second = cid()
    await a.send_json_to({"type": "call.invite", "call_id": second, "kind": "voice", "to": bob.id})
    await next_of(b, "call.incoming")
    await b.send_json_to({"type": "call.accept", "call_id": second})
    await next_of(a, "call.accepted")

    await c.send_json_to({"type": "call.invite", "call_id": cid(), "kind": "voice", "to": bob.id})
    assert (await next_of(c, "error"))["code"] == "busy"

    await b.disconnect()  # bob's tab dies mid-call
    assert (await next_of(a, "call.ended"))["reason"] == "disconnected"
    await a.disconnect()
    await c.disconnect()


async def test_stranger_calls_are_voice_only_and_need_a_chat():
    alice, a_tok = await make_user("alice")
    bob, b_tok = await make_user("bob")
    a, b = await sock(a_tok), await sock(b_tok)

    await a.send_json_to({"type": "call.invite", "call_id": cid(), "kind": "voice", "stranger": True})
    assert (await next_of(a, "error"))["code"] == "no_chat"

    await a.send_json_to({"type": "stranger.find"})
    await next_of(a, "stranger.waiting")
    await b.send_json_to({"type": "stranger.find"})
    await next_of(b, "stranger.matched")
    await next_of(a, "stranger.matched")

    await a.send_json_to({"type": "call.invite", "call_id": cid(), "kind": "video", "stranger": True})
    assert (await next_of(a, "error"))["code"] == "call_not_allowed"

    call = cid()
    await a.send_json_to({"type": "call.invite", "call_id": call, "kind": "voice", "stranger": True})
    inc = await next_of(b, "call.incoming")
    assert inc["stranger"] is True and inc["kind"] == "voice"
    await b.send_json_to({"type": "call.accept", "call_id": call})  # the stranger agreed
    assert (await next_of(a, "call.accepted"))["call_id"] == call
    await a.disconnect()
    await b.disconnect()


@database_sync_to_async
def get_ice(user, settings_obj):
    return auth_client(user).get("/api/calls/ice/").data


async def test_ice_servers_and_turn_credentials(settings):
    user, _ = await make_user("alice")
    settings.VCHAT = {**settings.VCHAT, "STUN_URLS": "stun:turn.example:3478", "TURN_URLS": "", "TURN_SECRET": ""}
    data = await get_ice(user, settings)
    assert data["relay"] is False and data["ice_servers"] == [{"urls": ["stun:turn.example:3478"]}]

    settings.VCHAT = {**settings.VCHAT, "TURN_URLS": "turn:turn.example:3478?transport=udp", "TURN_SECRET": "s3cret"}
    data = await get_ice(user, settings)
    turn = data["ice_servers"][1]
    expiry, uid = turn["username"].split(":")
    assert int(uid) == user.id and int(expiry) > 0
    expected = base64.b64encode(hmac.new(b"s3cret", turn["username"].encode(), hashlib.sha1).digest()).decode()
    assert turn["credential"] == expected and data["relay"] is True
