import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import EmailCode, User

from .conftest import auth_client, make_member

PASSWORD = "milky-mint-42"


def save(client, username="milky.way", password=PASSWORD):
    return client.post("/api/auth/account/save/", {"username": username, "password": password}, format="json")


def login(value, password=PASSWORD):
    return APIClient().post("/api/auth/login/", {"login": value, "password": password}, format="json")


@pytest.mark.django_db
def test_guest_saves_with_username_and_password_then_logs_in(db):
    guest = User.create_guest(nickname="milky")
    res = save(auth_client(guest), username="@Milky.Way")
    assert res.status_code == 200
    me = res.data["user"]
    assert me["is_guest"] is False and me["handle"] == "milky.way" and me["email"] == "" and me["id"] == guest.id
    # The username isn't locked for 14 days straight away.
    assert me["handle_next_change"] is None

    ok = login("milky.way")
    assert ok.status_code == 200 and ok.data["user"]["id"] == guest.id
    assert login("@MILKY.WAY").status_code == 200
    bad = login("milky.way", "nope-nope-nope")
    assert bad.status_code == 400 and bad.data["detail"] == "Wrong username or password."


@pytest.mark.django_db
def test_save_checks_username_and_password(alice):
    auth_client(alice).patch("/api/auth/me/", {"handle": "taken.name"}, format="json")
    guest = User.create_guest(nickname="g1")
    c = auth_client(guest)
    assert save(c, username="taken.name").data["field"] == "username"
    assert save(c, username="ab").data["field"] == "username"
    assert save(c, password="123").data["field"] == "password"
    assert save(c).status_code == 200
    assert save(c, username="other.name").data["code"] == "already_saved"


@pytest.mark.django_db
def test_email_login_still_works(alice):
    alice.set_password(PASSWORD)
    alice.save()
    assert login("ALICE@example.com").status_code == 200
    # Old apps send "email".
    assert APIClient().post("/api/auth/login/", {"email": "alice@example.com", "password": PASSWORD}, format="json").status_code == 200


@pytest.mark.django_db
def test_add_email_later_for_password_reset(settings):
    settings.EMAIL_ENABLED = True
    guest = User.create_guest(nickname="later")
    c = auth_client(guest)
    save(c, username="later.on")
    user = User.objects.get(pk=guest.pk)
    old_password = user.password

    res = c.post("/api/auth/email/start/", {"email": "Later@Example.com"}, format="json")
    assert res.status_code == 202, res.data
    code = mail.outbox[-1].body.split("    ")[1][:6]
    assert c.post("/api/auth/email/verify/", {"email": "later@example.com", "code": "000000"}, format="json").status_code == 400
    done = c.post("/api/auth/email/verify/", {"email": "later@example.com", "code": code}, format="json")
    assert done.status_code == 200 and done.data["user"]["email"] == "later@example.com"
    user.refresh_from_db()
    assert user.password == old_password  # adding an email never touches the password
    assert login("later@example.com").status_code == 200


@pytest.mark.django_db
def test_email_already_used_is_refused(alice, settings):
    settings.EMAIL_ENABLED = True
    bob = make_member("bob")
    res = auth_client(bob).post("/api/auth/email/start/", {"email": "alice@example.com"}, format="json")
    assert res.status_code == 409
    guest = User.create_guest(nickname="g2")
    assert auth_client(guest).post("/api/auth/email/start/", {"email": "x@example.com"}, format="json").status_code == 400
    assert not EmailCode.objects.exists()


@pytest.mark.django_db
def test_signup_name_is_a_unique_username():
    first = APIClient().post("/api/auth/guest/", {"nickname": "Anonym_p", "age_confirmed": True}, format="json")
    assert first.status_code == 201 and first.data["user"]["nickname"] == "Anonym_p"
    assert User.objects.get(pk=first.data["user"]["id"]).handle == "anonym_p"
    again = APIClient().post("/api/auth/guest/", {"nickname": "ANONYM_P", "age_confirmed": True}, format="json")
    assert again.status_code == 400 and again.data["detail"] == "@anonym_p is already taken. Pick another name."
    assert len(again.data["suggestions"]) == 3 and "anonym_p" not in again.data["suggestions"]
    check = APIClient().get("/api/auth/handle/check/", {"handle": "anonym_p"}).data
    assert check["available"] is False and check["reason"] == "taken" and check["suggestions"][0] == "anonym_p_2"
    # Every suggestion is really free.
    for name in check["suggestions"]:
        assert APIClient().get("/api/auth/handle/check/", {"handle": name}).data["available"] is True
    assert APIClient().get("/api/auth/handle/check/", {"handle": "admin"}).data["reason"] == "invalid"
    dotted = APIClient().post("/api/auth/guest/", {"nickname": ".dotty", "age_confirmed": True}, format="json")
    assert dotted.status_code == 400


@pytest.mark.django_db
def test_save_keeps_the_signup_username():
    res = APIClient().post("/api/auth/guest/", {"nickname": "keepme", "age_confirmed": True}, format="json")
    guest = User.objects.get(pk=res.data["user"]["id"])
    saved = auth_client(guest).post("/api/auth/account/save/", {"password": PASSWORD}, format="json")
    assert saved.status_code == 200 and saved.data["user"]["handle"] == "keepme"
    assert login("keepme").status_code == 200
