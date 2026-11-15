"""Watching a YouTube video together in friend chats and random chats."""

import pytest

from .test_message_ops import both, next_event
from .test_social_ws import make_friends, make_user, personal_socket
from .test_stranger import matched_pair

pytestmark = pytest.mark.django_db(transaction=True)

VIDEO = "dQw4w9WgXcQ"


@pytest.fixture(autouse=True)
def no_cooldown(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 0}


async def test_friends_share_one_player_state():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    eve, e_token = await make_user("eve")
    await make_friends(alice, bob)
    a, b, e = await personal_socket(a_token), await personal_socket(b_token), await personal_socket(e_token)

    await a.send_json_to({"type": "watch.start", "chat": {"kind": "dm", "with": bob.id}, "video": VIDEO})
    for ev in await both(a, b):
        assert ev["type"] == "watch.state"
        assert ev["chat"] == {"kind": "dm", "users": sorted([alice.id, bob.id])}
        assert ev["state"]["video"] == VIDEO and ev["state"]["playing"] is True and ev["state"]["by"] == alice.id
        assert isinstance(ev["server_now"], int)

    # Either side controls it; both follow.
    await b.send_json_to({"type": "watch.control", "chat": {"kind": "dm", "with": alice.id}, "action": "pause", "position": 42.5})
    for ev in await both(a, b):
        assert ev["state"]["playing"] is False and ev["state"]["position"] == 42.5 and ev["state"]["by"] == bob.id
    await a.send_json_to({"type": "watch.control", "chat": {"kind": "dm", "with": bob.id}, "action": "seek", "position": 90})
    assert (await both(a, b))[1]["state"]["position"] == 90

    # Joining late: ask for the state.
    await b.send_json_to({"type": "watch.sync", "chat": {"kind": "dm", "with": alice.id}})
    assert (await next_event(b))["state"]["position"] == 90

    # Not your chat / not a friend.
    await e.send_json_to({"type": "watch.start", "chat": {"kind": "dm", "with": alice.id}, "video": VIDEO})
    assert (await next_event(e))["code"] == "watch_unavailable"
    await a.send_json_to({"type": "watch.start", "chat": {"kind": "dm", "with": bob.id}, "video": "<script>x"})
    assert (await next_event(a))["code"] == "invalid_video"

    await a.send_json_to({"type": "watch.stop", "chat": {"kind": "dm", "with": bob.id}})
    for ev in await both(a, b):
        assert ev["type"] == "watch.state" and ev["state"] is None
    for comm in (a, b, e):
        await comm.disconnect()


async def test_strangers_watch_inside_their_chat_only():
    alice, bob, a, b, session = await matched_pair()
    await a.send_json_to({"type": "watch.start", "chat": {"kind": "stranger"}, "video": VIDEO})
    for ev in (await a.receive_json_from(), await b.receive_json_from()):
        assert ev["type"] == "watch.state" and ev["chat"] == {"kind": "stranger", "session": session}
    await b.send_json_to({"type": "watch.control", "chat": {"kind": "stranger"}, "action": "play", "position": 12})
    for ev in (await a.receive_json_from(), await b.receive_json_from()):
        assert ev["state"]["playing"] is True and ev["state"]["position"] == 12

    await a.send_json_to({"type": "stranger.leave"})
    await a.receive_json_from()
    await a.receive_json_from()
    await b.receive_json_from()
    await b.send_json_to({"type": "watch.start", "chat": {"kind": "stranger"}, "video": VIDEO})
    assert (await b.receive_json_from())["code"] == "watch_unavailable"
    await a.disconnect()
    await b.disconnect()
