import fakeredis
import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat.models import Block, Report
from apps.stranger import matchmaker
from apps.stranger.matchmaker import Entry
from apps.stranger.models import StrangerMessage, StrangerSession
from config.asgi import application

from .conftest import auth_client

ORIGIN = [(b"origin", b"http://localhost:3000")]


# --- matching rules, on both stores ----------------------------------------------


@pytest.fixture(params=["memory", "redis"])
def store(request):
    backend = matchmaker.MemoryBackend() if request.param == "memory" else matchmaker.RedisBackend(fakeredis.FakeRedis())
    matchmaker.set_backend(backend)
    return backend


def entry(uid, channel=None, region="any"):
    return Entry(channel=channel or f"ch{uid}", user_id=uid, nickname=f"u{uid}", gender="O", region=region)


def test_pairing_order_and_queue(store):
    assert matchmaker.find_or_wait(entry(1), set()) is None
    assert matchmaker.waiting_count() == 1
    partner = matchmaker.find_or_wait(entry(2), set())
    assert partner.user_id == 1
    assert matchmaker.waiting_count() == 0


def test_never_yourself_blocked_or_recent(store):
    matchmaker.find_or_wait(entry(1, "tab-a"), set())
    assert matchmaker.find_or_wait(entry(1, "tab-b"), set()) is None  # own second tab: both wait
    assert matchmaker.find_or_wait(entry(2), {1}) is None  # blocked
    assert matchmaker.find_or_wait(entry(3), set()).user_id == 1  # oldest compatible: tab-a
    # 1 and 3 just chatted: not matched again even when both search
    assert matchmaker.leave_queue("tab-b") and matchmaker.leave_queue("ch2")
    assert matchmaker.find_or_wait(entry(1, "tab-c"), set()) is None
    assert matchmaker.find_or_wait(entry(3, "ch3b"), set()) is None
    assert matchmaker.waiting_count() == 2


def test_region_preferences(store):
    matchmaker.find_or_wait(entry(1, region="europe"), set())
    assert matchmaker.find_or_wait(entry(2, region="south-asia"), set()) is None
    assert matchmaker.find_or_wait(entry(3, region="europe"), set()).user_id == 1
    assert matchmaker.find_or_wait(entry(4, region="any"), set()).user_id == 2  # "any" fits anyone


def test_stale_entries_are_dropped(store, monkeypatch, settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_QUEUE_TTL": 60}
    now = [1_000_000.0]
    monkeypatch.setattr(matchmaker.time, "time", lambda: now[0])
    matchmaker.find_or_wait(entry(1), set())
    now[0] += 30
    matchmaker.heartbeat("ch1")  # still here
    now[0] += 50
    assert matchmaker.find_or_wait(entry(2), set()).user_id == 1
    matchmaker.find_or_wait(entry(3), set())
    now[0] += 61  # 3 never pinged: gone
    assert matchmaker.find_or_wait(entry(4), set()) is None
    assert [e.user_id for e in matchmaker.backend().entries()] == [4]


# --- over the personal socket ---------------------------------------------------

pytestmark_ws = pytest.mark.django_db(transaction=True)


@pytest.fixture
def no_cooldown(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 0}


@database_sync_to_async
def make_user(nickname, gender="O"):
    user = User.create_guest(nickname=nickname, gender=gender)
    return user, str(AccessToken.for_user(user))


async def me_socket(token):
    comm = WebsocketCommunicator(application, "/ws/me/", headers=ORIGIN)
    connected, _ = await comm.connect()
    assert connected
    await comm.send_json_to({"type": "auth", "token": token})
    assert (await comm.receive_json_from())["type"] == "ready"
    return comm


async def matched_pair():
    alice, a_token = await make_user("alice", "F")
    bob, b_token = await make_user("bob", "M")
    a, b = await me_socket(a_token), await me_socket(b_token)
    await a.send_json_to({"type": "stranger.find", "region": "europe"})
    assert (await a.receive_json_from()) == {"type": "stranger.waiting", "waiting": 1}
    await b.send_json_to({"type": "stranger.find", "region": "any"})
    got_b, got_a = await b.receive_json_from(), await a.receive_json_from()
    assert got_b["type"] == got_a["type"] == "stranger.matched"
    assert got_b["session"] == got_a["session"]
    assert got_b["partner"] == {"id": alice.id, "nickname": "alice", "gender": "F", "region": "europe"}
    assert got_a["partner"] == {"id": bob.id, "nickname": "bob", "gender": "M", "region": "any"}
    return alice, bob, a, b, got_a["session"]


@pytestmark_ws
async def test_match_chat_typing_and_saved_messages(no_cooldown):
    alice, bob, a, b, session = await matched_pair()

    await a.send_json_to({"type": "stranger.typing"})
    assert await b.receive_json_from() == {"type": "stranger.typing"}

    await a.send_json_to({"type": "stranger.message", "content": " hi stranger ", "client_id": "c1"})
    for comm in (a, b):
        event = await comm.receive_json_from()
        assert event["type"] == "stranger.message"
        assert event["message"]["content"] == "hi stranger"
        assert event["message"]["sender_id"] == alice.id
        assert event["client_id"] == "c1"
    assert await database_sync_to_async(StrangerMessage.objects.filter(session_id=session).count)() == 1
    await a.disconnect()
    await b.disconnect()


@pytestmark_ws
async def test_next_ends_chat_for_both_and_searches_again(no_cooldown):
    alice, bob, a, b, session = await matched_pair()
    await a.send_json_to({"type": "stranger.next"})
    assert (await a.receive_json_from())["by"] == "you"
    assert (await a.receive_json_from()) == {"type": "stranger.waiting", "waiting": 1}  # bob is "recent": no rematch
    assert (await b.receive_json_from()) == {"type": "stranger.ended", "by": "stranger", "session": session}

    await b.send_json_to({"type": "stranger.message", "content": "still there?"})
    assert (await b.receive_json_from())["code"] == "no_chat"
    s = await database_sync_to_async(StrangerSession.objects.get)(id=session)
    assert s.ended_at is not None and s.ended_by_id == alice.id
    await a.disconnect()
    await b.disconnect()


@pytest.fixture
def quick_resume(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 0, "STRANGER_RESUME_SECONDS": 0.5}


async def ended_at(session):
    return (await database_sync_to_async(StrangerSession.objects.get)(id=session)).ended_at


@pytestmark_ws
async def test_a_socket_that_never_comes_back_ends_the_chat(quick_resume):
    alice, bob, a, b, session = await matched_pair()
    await b.disconnect()
    assert (await a.receive_json_from()) == {"type": "stranger.away", "session": session}
    assert await ended_at(session) is None  # still waiting for bob
    assert (await a.receive_json_from(timeout=3)) == {"type": "stranger.ended", "by": "stranger", "session": session}
    s = await database_sync_to_async(StrangerSession.objects.get)(id=session)
    assert s.ended_at is not None and s.ended_by_id == bob.id
    await a.disconnect()


@pytestmark_ws
async def test_a_dropped_socket_picks_the_chat_back_up(no_cooldown):
    alice, bob, a, b, session = await matched_pair()
    await b.disconnect()
    assert (await a.receive_json_from())["type"] == "stranger.away"

    b2 = await me_socket(str(AccessToken.for_user(bob)))
    await b2.send_json_to({"type": "stranger.resume", "session": session})
    assert (await b2.receive_json_from()) == {"type": "stranger.resumed", "session": session}
    assert (await a.receive_json_from()) == {"type": "stranger.back", "session": session}

    await a.send_json_to({"type": "stranger.message", "content": "welcome back", "client_id": "c1"})
    assert (await b2.receive_json_from())["message"]["content"] == "welcome back"
    await a.receive_json_from()  # own echo
    await b2.send_json_to({"type": "stranger.message", "content": "thanks", "client_id": "c2"})
    assert (await a.receive_json_from())["message"]["content"] == "thanks"
    assert await ended_at(session) is None
    await a.disconnect()
    await b2.disconnect()


@pytestmark_ws
async def test_a_new_socket_takes_over_from_one_that_hasnt_closed_yet(no_cooldown):
    # Phones often drop off without the server seeing a close: the old socket still looks alive.
    alice, bob, a, b, session = await matched_pair()
    b2 = await me_socket(str(AccessToken.for_user(bob)))
    await b2.send_json_to({"type": "stranger.resume", "session": session})
    assert (await b2.receive_json_from())["type"] == "stranger.resumed"
    assert (await a.receive_json_from())["type"] == "stranger.back"
    await b.disconnect()  # the stale socket closing later changes nothing
    await a.send_json_to({"type": "stranger.message", "content": "hi", "client_id": "c1"})
    assert (await a.receive_json_from())["type"] == "stranger.message"
    assert (await b2.receive_json_from())["message"]["content"] == "hi"
    assert await a.receive_nothing(0.3)
    assert await ended_at(session) is None
    await a.disconnect()
    await b2.disconnect()


@pytestmark_ws
async def test_resuming_too_late_or_someone_elses_chat(quick_resume):
    alice, bob, a, b, session = await matched_pair()
    _, eve_token = await make_user("eve")
    eve = await me_socket(eve_token)
    await eve.send_json_to({"type": "stranger.resume", "session": session})
    assert (await eve.receive_json_from())["by"] == "connection"
    await eve.send_json_to({"type": "stranger.resume", "session": "not-a-uuid"})
    assert (await eve.receive_json_from())["by"] == "connection"
    assert await ended_at(session) is None  # eve can't end other people's chats

    await b.disconnect()
    assert (await a.receive_json_from())["type"] == "stranger.away"
    assert (await a.receive_json_from(timeout=3))["type"] == "stranger.ended"
    b2 = await me_socket(str(AccessToken.for_user(bob)))
    await b2.send_json_to({"type": "stranger.resume", "session": session})
    assert (await b2.receive_json_from()) == {"type": "stranger.ended", "by": "connection", "session": session}
    for comm in (a, b2, eve):
        await comm.disconnect()


@pytestmark_ws
async def test_cancel_leaves_the_queue_and_blocked_users_never_meet(no_cooldown):
    alice, a_token = await make_user("alice")
    bob, b_token = await make_user("bob")
    carol, c_token = await make_user("carol")
    await database_sync_to_async(Block.objects.create)(blocker=carol, blocked=alice)
    a, b, c = await me_socket(a_token), await me_socket(b_token), await me_socket(c_token)

    await a.send_json_to({"type": "stranger.find"})
    assert (await a.receive_json_from())["type"] == "stranger.waiting"
    await a.send_json_to({"type": "stranger.cancel"})
    assert (await a.receive_json_from()) == {"type": "stranger.idle"}
    await b.send_json_to({"type": "stranger.find"})
    assert (await b.receive_json_from())["type"] == "stranger.waiting"  # alice left the queue
    await b.send_json_to({"type": "stranger.cancel"})
    await b.receive_json_from()

    await a.send_json_to({"type": "stranger.find"})
    await a.receive_json_from()
    await c.send_json_to({"type": "stranger.find"})
    assert (await c.receive_json_from())["type"] == "stranger.waiting"  # carol blocked alice
    for comm in (a, b, c):
        await comm.disconnect()


@pytestmark_ws
async def test_find_cooldown(settings):
    settings.VCHAT = {**settings.VCHAT, "STRANGER_FIND_COOLDOWN": 5}
    _, token = await make_user("speedy")
    a = await me_socket(token)
    await a.send_json_to({"type": "stranger.find"})
    assert (await a.receive_json_from())["type"] == "stranger.waiting"
    await a.send_json_to({"type": "stranger.find"})
    assert (await a.receive_json_from())["code"] == "rate_limited"
    await a.disconnect()


@pytestmark_ws
async def test_report_from_a_stranger_chat(no_cooldown):
    alice, bob, a, b, session = await matched_pair()
    res = await database_sync_to_async(auth_client(alice).post)(
        "/api/reports/", {"reported_user": bob.id, "stranger_session": session, "reason": "sexual"}, format="json"
    )
    assert res.status_code == 201
    carol, _ = await make_user("carol")
    res = await database_sync_to_async(auth_client(carol).post)(
        "/api/reports/", {"reported_user": bob.id, "stranger_session": session, "reason": "spam"}, format="json"
    )
    assert res.status_code == 400  # not her chat
    assert await database_sync_to_async(Report.objects.count)() == 1
    await a.disconnect()
    await b.disconnect()
