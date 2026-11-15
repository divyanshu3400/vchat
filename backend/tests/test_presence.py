import fakeredis
import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat import presence
from apps.chat.models import Room
from apps.social.models import Friendship, ordered_pair
from config.asgi import application

from .conftest import auth_client

ORIGIN = [(b"origin", b"http://localhost:3000")]


# --- the store itself, against both backends -----------------------------------


@pytest.fixture(params=["memory", "redis"])
def store(request):
    backend = (
        presence.MemoryBackend()
        if request.param == "memory"
        else presence.RedisBackend(fakeredis.FakeRedis())
    )
    presence.set_backend(backend)
    return backend


def test_online_transitions_only_on_first_and_last_socket(store):
    assert presence.connect_user(1, "tab-a") is True  # came online
    assert presence.connect_user(1, "tab-b") is False  # second tab: already online
    assert presence.online_among([1, 2]) == {1}
    assert presence.disconnect_user(1, "tab-a") is False  # one tab still open
    assert presence.disconnect_user(1, "tab-b") is True  # went offline
    assert presence.online_among([1]) == set()


def test_room_counts_unique_people_not_tabs(store):
    presence.join_room(10, 1, "a1")
    presence.join_room(10, 1, "a2")  # same person, second tab
    presence.join_room(10, 2, "b1")
    presence.join_room(11, 3, "c1")
    assert presence.room_counts([10, 11, 12]) == {10: 2, 11: 1, 12: 0}
    presence.leave_room(10, 1, "a1")
    assert presence.room_counts([10])[10] == 2  # user 1 still has a2 open
    presence.leave_room(10, 1, "a2")
    assert presence.room_counts([10])[10] == 1


def test_sockets_expire_without_pings(store, monkeypatch, settings):
    settings.VCHAT = {**settings.VCHAT, "PRESENCE_TTL": 30}
    now = [1_000_000.0]
    monkeypatch.setattr(presence.time, "time", lambda: now[0])

    presence.connect_user(1, "tab")
    presence.join_room(10, 1, "tab")
    now[0] += 20
    presence.ping_user(1, "tab")  # heartbeat keeps the user online
    now[0] += 20
    assert presence.online_among([1]) == {1}
    assert presence.room_counts([10]) == {10: 0}  # room socket never pinged: expired
    now[0] += 31
    assert presence.online_among([1]) == set()  # crashed server: expires on its own
    assert presence.site_online_count() == 0


# --- through the sockets and the API -------------------------------------------


@database_sync_to_async
def make_user(nickname):
    user = User.create_guest(nickname=nickname, gender="O")
    return user, str(AccessToken.for_user(user))


async def open_socket(path, token):
    comm = WebsocketCommunicator(application, path, headers=ORIGIN)
    connected, _ = await comm.connect()
    assert connected
    await comm.send_json_to({"type": "auth", "token": token})
    assert (await comm.receive_json_from())["type"] == "ready"
    return comm


@pytest.mark.django_db(transaction=True)
async def test_friends_hear_online_and_offline_once():
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    x, y = ordered_pair(alice.id, bob.id)
    await database_sync_to_async(Friendship.objects.create)(user_a_id=x, user_b_id=y)

    a = await open_socket("/ws/me/", a_token)
    b1 = await open_socket("/ws/me/", b_token)
    assert await a.receive_json_from() == {"type": "presence", "user_id": bob.id, "online": True}

    b2 = await open_socket("/ws/me/", b_token)  # second tab: no new event
    assert await a.receive_nothing(timeout=0.2)

    await b2.send_json_to({"type": "ping"})
    assert await b2.receive_json_from() == {"type": "pong"}

    await b1.disconnect()
    assert await a.receive_nothing(timeout=0.2)  # bob still has b2 open
    await b2.disconnect()
    assert await a.receive_json_from() == {"type": "presence", "user_id": bob.id, "online": False}
    await a.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_room_counts_and_friend_online_flags_in_api():
    await database_sync_to_async(Room.objects.create)(slug="random", name="Random", kind="topic")
    await database_sync_to_async(Room.objects.create)(slug="music", name="Music", kind="topic")
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    x, y = ordered_pair(alice.id, bob.id)
    await database_sync_to_async(Friendship.objects.create)(user_a_id=x, user_b_id=y)

    me_b = await open_socket("/ws/me/", b_token)
    room_a = await open_socket("/ws/rooms/random/", a_token)
    room_b = await open_socket("/ws/rooms/random/", b_token)

    await database_sync_to_async(cache.clear)()
    counts = (await database_sync_to_async(APIClient().get)("/api/rooms/presence/")).data
    assert counts["rooms"] == {"random": 2, "music": 0}
    assert counts["online"] == 1  # only bob has a personal socket open

    friends = (await database_sync_to_async(auth_client(alice).get)("/api/friends/")).data
    assert friends[0]["online"] is True
    online = (await database_sync_to_async(auth_client(alice).get)("/api/friends/online/")).data
    assert online == {"online": [bob.id]}

    await room_b.disconnect()
    await me_b.disconnect()
    await database_sync_to_async(cache.clear)()
    counts = (await database_sync_to_async(APIClient().get)("/api/rooms/presence/")).data
    assert counts["rooms"]["random"] == 1 and counts["online"] == 0
    await room_a.disconnect()
