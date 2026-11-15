from datetime import timedelta

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.premium.models import RewardGrant
from apps.stranger import matchmaker
from apps.stranger.matchmaker import Entry
from config.asgi import application

from .conftest import auth_client

ORIGIN = [(b"origin", b"http://localhost:3000")]


@pytest.fixture
def rewards_on(settings):
    settings.VCHAT = {**settings.VCHAT, "REWARDED_ADS": True, "REWARDS_PER_DAY": 2, "STRANGER_FIND_COOLDOWN": 0}


# --- status and rewards ------------------------------------------------------------


@pytest.mark.django_db
def test_status_for_free_and_plus_users(alice):
    res = auth_client(alice).get("/api/premium/status/").data
    assert res["plus"] is False and res["grants"]["gender_filter"] is None

    alice.plus_until = timezone.now() + timedelta(days=3)
    alice.save()
    res = auth_client(alice).get("/api/premium/status/").data
    assert res["plus"] is True and res["plus_until"]


@pytest.mark.django_db
def test_reward_grants_uses_and_has_a_daily_cap(alice, rewards_on):
    client = auth_client(alice)
    first = client.post("/api/premium/reward/", {"kind": "gender_filter"}, format="json")
    assert first.status_code == 201 and first.data["uses_left"] == 15
    assert first.data["status"]["grants"]["gender_filter"]["uses_left"] == 15
    assert client.post("/api/premium/reward/", {"kind": "gender_filter"}, format="json").status_code == 201
    capped = client.post("/api/premium/reward/", {"kind": "gender_filter"}, format="json")
    assert capped.status_code == 429 and capped.data["code"] == "daily_limit"
    assert client.post("/api/premium/reward/", {"kind": "free_money"}, format="json").status_code == 400


@pytest.mark.django_db
def test_rewards_can_be_switched_off(alice, settings):
    settings.VCHAT = {**settings.VCHAT, "REWARDED_ADS": False}
    res = auth_client(alice).post("/api/premium/reward/", {"kind": "gender_filter"}, format="json")
    assert res.status_code == 400 and res.data["code"] == "unavailable"


# --- gender filter in matching -----------------------------------------------------


def test_gender_filter_is_two_way():
    man_wants_women = Entry("a", 1, "a", "M", "any", want="F")
    woman_any = Entry("b", 2, "b", "F", "any")
    man_any = Entry("c", 3, "c", "M", "any")
    woman_wants_women = Entry("d", 4, "d", "F", "any", want="F")
    assert man_wants_women.compatible(woman_any) and woman_any.compatible(man_wants_women)
    assert not man_wants_women.compatible(man_any)
    assert not man_wants_women.compatible(woman_wants_women)  # her filter excludes him


@database_sync_to_async
def make_user(nickname, gender):
    user = User.create_guest(nickname=nickname, gender=gender)
    return user, str(AccessToken.for_user(user))


async def me_socket(token):
    comm = WebsocketCommunicator(application, "/ws/me/", headers=ORIGIN)
    await comm.connect()
    await comm.send_json_to({"type": "auth", "token": token})
    assert (await comm.receive_json_from())["type"] == "ready"
    return comm


@pytest.mark.django_db(transaction=True)
async def test_filter_needs_plus_or_reward_and_spends_one_use(rewards_on):
    man, m_token = await make_user("man", "M")
    woman, w_token = await make_user("woman", "F")
    m, w = await me_socket(m_token), await me_socket(w_token)

    await m.send_json_to({"type": "stranger.find", "want": "F"})
    assert (await m.receive_json_from())["code"] == "locked_filter"

    await database_sync_to_async(auth_client(man).post)("/api/premium/reward/", {"kind": "gender_filter"}, format="json")
    await m.send_json_to({"type": "stranger.find", "want": "F"})
    assert (await m.receive_json_from())["type"] == "stranger.waiting"
    grant = await database_sync_to_async(RewardGrant.objects.get)(user=man)
    assert grant.uses_left == 14

    await w.send_json_to({"type": "stranger.find"})
    assert (await w.receive_json_from())["type"] == "stranger.matched"
    assert (await m.receive_json_from())["partner"]["gender"] == "F"
    await m.disconnect()
    await w.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_plus_members_filter_for_free(rewards_on):
    vip, token = await make_user("vip", "O")
    await database_sync_to_async(User.objects.filter(pk=vip.pk).update)(plus_until=timezone.now() + timedelta(days=1))
    s = await me_socket(token)  # socket opened after Plus started; the check still reads the database
    await s.send_json_to({"type": "stranger.find", "want": "M"})
    assert (await s.receive_json_from())["type"] == "stranger.waiting"
    assert await database_sync_to_async(RewardGrant.objects.count)() == 0
    assert matchmaker.waiting_count() == 1
    await s.disconnect()
