"""Replies, reactions, edits and deletes in rooms, friend chats and random chats."""

from datetime import timedelta

import pytest
from channels.db import database_sync_to_async
from django.utils import timezone

from apps.chat.models import Message
from apps.social.models import DirectMessage
from apps.stranger.models import StrangerMessage

from .conftest import auth_client
from .test_social_ws import make_friends, make_user, personal_socket
from .test_stranger import matched_pair
from .test_ws import connect, make_room

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def no_cooldown(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 0}


SKIP = {"presence", "friend_added"}  # friends' online status arrives on the same socket


async def next_event(comm):
    while True:
        ev = await comm.receive_json_from()
        if ev.get("type") not in SKIP:
            return ev


async def both(a, b):
    return await next_event(a), await next_event(b)


# --- rooms ------------------------------------------------------------------------------


async def test_room_reply_react_edit_delete():
    await make_room()
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    a, b = await connect("random", a_token), await connect("random", b_token)

    await a.send_json_to({"type": "message", "content": "hello room", "client_id": "1"})
    first = (await both(a, b))[0]["message"]
    assert first["reply_to"] is None and first["reactions"] == {} and first["edited"] is False

    await b.send_json_to({"type": "message", "content": "hi alice", "client_id": "2", "reply_to": first["id"]})
    reply = (await both(a, b))[1]["message"]
    assert reply["reply_to"] == {
        "id": first["id"], "sender_id": alice.id, "nickname": "alice", "text": "hello room", "kind": None, "deleted": False,
    }

    await b.send_json_to({"type": "react", "message_id": first["id"], "emoji": "❤️"})
    for ev in await both(a, b):
        assert ev["type"] == "message.update" and ev["message"]["reactions"] == {"❤️": [bob.id]}
    await b.send_json_to({"type": "react", "message_id": first["id"], "emoji": "😂"})  # replaces
    assert (await both(a, b))[0]["message"]["reactions"] == {"😂": [bob.id]}
    await b.send_json_to({"type": "react", "message_id": first["id"], "emoji": None})  # removes
    assert (await both(a, b))[0]["message"]["reactions"] == {}
    await b.send_json_to({"type": "react", "message_id": first["id"], "emoji": "<script>"})
    assert (await b.receive_json_from())["code"] == "invalid_reaction"

    await b.send_json_to({"type": "edit", "message_id": first["id"], "content": "mine now"})
    assert (await b.receive_json_from())["code"] == "not_yours"
    await a.send_json_to({"type": "edit", "message_id": first["id"], "content": "hello everyone"})
    edited = (await both(a, b))[1]["message"]
    assert edited["content"] == "hello everyone" and edited["edited"] is True

    await a.send_json_to({"type": "delete", "message_id": first["id"]})
    gone = (await both(a, b))[1]["message"]
    assert gone["deleted"] is True and gone["content"] == "" and gone["reactions"] == {}
    # The text stays stored for abuse reports.
    row = await database_sync_to_async(Message.objects.get)(id=first["id"])
    assert row.content == "hello everyone" and row.deleted_at is not None

    history = await database_sync_to_async(auth_client(bob).get)("/api/rooms/random/messages/")
    by_id = {m["id"]: m for m in history.data["messages"]}
    assert by_id[first["id"]]["deleted"] is True
    assert by_id[reply["id"]]["reply_to"]["deleted"] is True and by_id[reply["id"]]["reply_to"]["text"] == ""
    await a.disconnect()
    await b.disconnect()


async def test_edit_and_delete_windows():
    await make_room()
    alice, a_token = await make_user("alice")
    a = await connect("random", a_token)
    await a.send_json_to({"type": "message", "content": "old news", "client_id": "1"})
    msg = (await a.receive_json_from())["message"]
    await database_sync_to_async(Message.objects.filter(id=msg["id"]).update)(
        created_at=timezone.now() - timedelta(minutes=30)
    )
    await a.send_json_to({"type": "edit", "message_id": msg["id"], "content": "new news"})
    assert (await a.receive_json_from())["code"] == "too_late"
    await a.send_json_to({"type": "delete", "message_id": msg["id"]})  # 1 hour for deletes
    assert (await a.receive_json_from())["message"]["deleted"] is True
    await a.disconnect()


# --- friends ----------------------------------------------------------------------------


async def test_dm_reply_react_edit_delete():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    eve, e_token = await make_user("eve")
    await make_friends(alice, bob)
    a, b, e = await personal_socket(a_token), await personal_socket(b_token), await personal_socket(e_token)

    await a.send_json_to({"type": "dm", "to": bob.id, "content": "lunch?", "client_id": "1"})
    first = (await both(a, b))[0]["message"]
    await b.send_json_to({"type": "dm", "to": alice.id, "content": "yes", "client_id": "2", "reply_to": first["id"]})
    reply = (await both(a, b))[0]["message"]
    assert reply["reply_to"]["text"] == "lunch?"

    await b.send_json_to({"type": "dm.react", "message_id": first["id"], "emoji": "👍"})
    for ev in await both(a, b):
        assert ev["type"] == "dm.update" and ev["message"]["reactions"] == {"👍": [bob.id]}

    # Someone outside the chat can't touch it.
    await e.send_json_to({"type": "dm.react", "message_id": first["id"], "emoji": "👍"})
    assert (await next_event(e))["code"] == "not_found"

    await a.send_json_to({"type": "dm.edit", "message_id": first["id"], "content": "dinner?"})
    assert (await both(a, b))[1]["message"]["content"] == "dinner?"
    await a.send_json_to({"type": "dm.delete", "message_id": first["id"]})
    assert (await both(a, b))[1]["message"]["deleted"] is True
    assert (await database_sync_to_async(DirectMessage.objects.get)(id=first["id"])).deleted_at is not None
    for comm in (a, b, e):
        await comm.disconnect()


# --- random chat ------------------------------------------------------------------------


async def test_stranger_reply_react_edit_delete():
    alice, bob, a, b, session = await matched_pair()
    await a.send_json_to({"type": "stranger.message", "content": "hey", "client_id": "1"})
    first = (await both(a, b))[0]["message"]
    await b.send_json_to({"type": "stranger.message", "content": "hi!", "client_id": "2", "reply_to": first["id"]})
    assert (await both(a, b))[0]["message"]["reply_to"]["text"] == "hey"

    await b.send_json_to({"type": "stranger.react", "message_id": first["id"], "emoji": "🔥"})
    for ev in await both(a, b):
        assert ev["type"] == "stranger.update" and ev["message"]["reactions"] == {"🔥": [bob.id]}
    await a.send_json_to({"type": "stranger.edit", "message_id": first["id"], "content": "hey there"})
    assert (await both(a, b))[1]["message"]["edited"] is True
    await a.send_json_to({"type": "stranger.delete", "message_id": first["id"]})
    assert (await both(a, b))[1]["message"]["deleted"] is True
    assert (await database_sync_to_async(StrangerMessage.objects.get)(id=first["id"])).deleted_at is not None

    # After the chat ends nothing can be changed.
    await a.send_json_to({"type": "stranger.leave"})
    await a.receive_json_from()
    await a.receive_json_from()
    await b.receive_json_from()
    await b.send_json_to({"type": "stranger.react", "message_id": first["id"], "emoji": "🔥"})
    assert (await b.receive_json_from())["code"] == "no_chat"
    await a.disconnect()
    await b.disconnect()


async def test_dm_seen_and_typing():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    await make_friends(alice, bob)
    a, b = await personal_socket(a_token), await personal_socket(b_token)
    await a.send_json_to({"type": "dm", "to": bob.id, "content": "you there?", "client_id": "1"})
    msg = (await both(a, b))[0]["message"]

    await b.send_json_to({"type": "dm.typing", "to": alice.id})
    assert await next_event(a) == {"type": "dm.typing", "user_id": bob.id}

    res = await database_sync_to_async(auth_client(bob).post)(f"/api/dms/{alice.id}/read/", {"last_id": msg["id"]}, format="json")
    assert res.status_code == 204
    assert await next_event(a) == {"type": "dm.read", "user_id": bob.id, "last_id": msg["id"]}
    history = await database_sync_to_async(auth_client(alice).get)(f"/api/dms/{bob.id}/messages/")
    assert history.data["partner_read_id"] == msg["id"]
    await a.disconnect()
    await b.disconnect()
