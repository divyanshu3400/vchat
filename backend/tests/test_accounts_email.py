"""Saving a guest account with email + password, logging in, resetting the password."""

import re
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import EmailCode, User

from .conftest import auth_client, make_member

pytestmark = pytest.mark.django_db

PASSWORD = "milk-and-mint-42"


@pytest.fixture(autouse=True)
def no_throttles(settings):
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {
        **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "email_codes": "1000/hour", "login": "1000/hour"}}


def last_code() -> str:
    return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)


def test_guest_saves_account_and_keeps_the_same_user():
    guest = User.create_guest(nickname="milky", gender="F")
    client = auth_client(guest)

    res = client.post("/api/auth/account/start/", {"email": " Milky@Example.com ", "password": PASSWORD}, format="json")
    assert res.status_code == 202 and res.data["sent_to"] == "milky@example.com"
    assert mail.outbox[-1].to == ["milky@example.com"]
    code = last_code()
    assert not EmailCode.objects.filter(code_hash__contains=code).exists()  # only a hash is stored

    assert client.post("/api/auth/account/verify/", {"email": "milky@example.com", "code": "000000"}, format="json").data["code"] == "wrong_code"
    res = client.post("/api/auth/account/verify/", {"email": "milky@example.com", "code": code}, format="json")
    assert res.status_code == 200
    assert res.data["user"] == {"id": guest.id, "nickname": "milky", "gender": "F", "is_guest": False, "email": "milky@example.com", "show_last_seen": True, "show_online": True, "read_receipts": True, "discoverable": True}
    guest.refresh_from_db()
    assert guest.check_password(PASSWORD) and not guest.is_guest

    # The code works once.
    assert client.post("/api/auth/account/verify/", {"email": "milky@example.com", "code": code}, format="json").status_code == 400


def test_weak_password_taken_email_and_cooldown():
    make_member("taken")
    client = auth_client(User.create_guest(nickname="newbie"))
    assert client.post("/api/auth/account/start/", {"email": "a@b.co", "password": "12345678"}, format="json").data["code"] == "weak_password"
    res = client.post("/api/auth/account/start/", {"email": "TAKEN@example.com", "password": PASSWORD}, format="json")
    assert res.status_code == 409 and res.data["code"] == "email_taken"
    assert client.post("/api/auth/account/start/", {"email": "n@example.com", "password": PASSWORD}, format="json").status_code == 202
    res = client.post("/api/auth/account/start/", {"email": "n@example.com", "password": PASSWORD}, format="json")
    assert res.status_code == 429 and res.data["code"] == "wait"


def test_codes_expire_and_wrong_tries_run_out():
    client = auth_client(User.create_guest(nickname="tries"))
    client.post("/api/auth/account/start/", {"email": "t@example.com", "password": PASSWORD}, format="json")
    code = last_code()
    for _ in range(5):
        client.post("/api/auth/account/verify/", {"email": "t@example.com", "code": "111111" if code != "111111" else "222222"}, format="json")
    assert client.post("/api/auth/account/verify/", {"email": "t@example.com", "code": code}, format="json").data["code"] == "code_expired"

    EmailCode.objects.all().delete()
    client2 = auth_client(User.create_guest(nickname="late"))
    client2.post("/api/auth/account/start/", {"email": "late@example.com", "password": PASSWORD}, format="json")
    EmailCode.objects.update(created_at=timezone.now() - timedelta(minutes=11))
    assert client2.post("/api/auth/account/verify/", {"email": "late@example.com", "code": last_code()}, format="json").data["code"] == "code_expired"


def test_login_on_another_device():
    user = make_member("lena")
    user.set_password(PASSWORD)
    user.save()
    anon = APIClient()
    assert anon.post("/api/auth/login/", {"email": "lena@example.com", "password": "nope-nope-1"}, format="json").data["code"] == "wrong_login"
    res = anon.post("/api/auth/login/", {"email": "LENA@example.com", "password": PASSWORD}, format="json")
    assert res.status_code == 200 and res.data["user"]["id"] == user.id and res.data["access"]
    assert "vchat_refresh" in res.cookies
    # Guests can't log in with an email they never verified.
    assert anon.post("/api/auth/login/", {"email": "nobody@example.com", "password": PASSWORD}, format="json").status_code == 400


def test_forgot_and_reset_password_signs_out_old_sessions():
    user = make_member("rita")
    user.set_password(PASSWORD)
    user.save()
    old = APIClient()
    old.post("/api/auth/login/", {"email": "rita@example.com", "password": PASSWORD}, format="json")
    assert old.post("/api/auth/refresh/").status_code == 200

    anon = APIClient()
    # Same answer whether or not the email has an account.
    unknown = anon.post("/api/auth/password/forgot/", {"email": "ghost@example.com"}, format="json")
    known = anon.post("/api/auth/password/forgot/", {"email": "rita@example.com"}, format="json")
    assert unknown.status_code == known.status_code == 202 and unknown.data == known.data
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["rita@example.com"]

    res = anon.post("/api/auth/password/reset/", {"email": "rita@example.com", "code": last_code(), "password": "brand-new-pass-7"}, format="json")
    assert res.status_code == 200 and res.data["user"]["id"] == user.id
    user.refresh_from_db()
    assert user.check_password("brand-new-pass-7")
    assert old.post("/api/auth/refresh/").status_code == 401  # signed out everywhere else
    assert anon.post("/api/auth/refresh/").status_code == 200  # this device is signed in


def test_guests_cannot_send_or_accept_friend_requests():
    guest = User.create_guest(nickname="guesty")
    member = make_member("member")
    res = auth_client(guest).post("/api/friends/requests/", {"to_user": member.id}, format="json")
    assert res.status_code == 403 and res.data["code"] == "account_required"

    res = auth_client(member).post("/api/friends/requests/", {"to_user": guest.id}, format="json")
    assert res.status_code == 201
    req_id = res.data["request"]["id"]
    res = auth_client(guest).post(f"/api/friends/requests/{req_id}/accept/")
    assert res.status_code == 403 and res.data["code"] == "account_required"
    assert auth_client(guest).post(f"/api/friends/requests/{req_id}/decline/").status_code == 204


def test_me_shows_your_email_but_others_never_see_it():
    member = make_member("private")
    assert auth_client(member).get("/api/auth/me/").data["email"] == "private@example.com"
    other = make_member("other")
    friends = auth_client(other).get("/api/friends/").data
    assert "private@example.com" not in str(friends)


def test_guests_make_friends_as_before_while_email_is_off(settings):
    settings.EMAIL_ENABLED = False
    guest = User.create_guest(nickname="early")
    member = make_member("member2")
    assert auth_client(guest).post("/api/friends/requests/", {"to_user": member.id}, format="json").status_code == 201
    res = auth_client(guest).post("/api/auth/account/start/", {"email": "e@example.com", "password": PASSWORD}, format="json")
    assert res.status_code == 503 and res.data["code"] == "email_off"
