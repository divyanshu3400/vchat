import pytest
from django.conf import settings
from rest_framework.test import APIClient

from apps.accounts.models import User

COOKIE = settings.VCHAT["REFRESH_COOKIE"]


@pytest.mark.django_db
def test_guest_signup_creates_guest_and_sets_httponly_refresh_cookie():
    client = APIClient()
    res = client.post("/api/auth/guest/", {"nickname": "night_owl", "gender": "O", "age_confirmed": True}, format="json")

    assert res.status_code == 201
    assert res.data["user"]["nickname"] == "night_owl"
    assert res.data["access"]
    assert "refresh" not in res.data  # never exposed to page scripts
    cookie = res.cookies[COOKIE]
    assert cookie["httponly"]
    user = User.objects.get(id=res.data["user"]["id"])
    assert user.is_guest and not user.has_usable_password() and user.age_confirmed_at


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        {"nickname": "night_owl", "age_confirmed": False},
        {"nickname": "ab", "age_confirmed": True},
        {"nickname": "bad name!", "age_confirmed": True},
        {"nickname": "Admin", "age_confirmed": True},
    ],
)
def test_guest_signup_rejects_invalid_input(payload):
    res = APIClient().post("/api/auth/guest/", payload, format="json")
    assert res.status_code == 400
    assert not User.objects.exists()


@pytest.mark.django_db
def test_refresh_cookie_returns_new_access_token():
    client = APIClient()
    client.post("/api/auth/guest/", {"nickname": "night_owl", "age_confirmed": True}, format="json")

    res = client.post("/api/auth/refresh/")
    assert res.status_code == 200
    assert res.data["access"]
    assert res.data["user"]["nickname"] == "night_owl"

    me = APIClient()
    me.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
    assert me.get("/api/auth/me/").data["nickname"] == "night_owl"


@pytest.mark.django_db
def test_health_reports_database_and_cache():
    res = APIClient().get("/api/health/")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "database": "ok", "cache": "ok"}


@pytest.mark.django_db
def test_refresh_without_cookie_or_for_banned_user_is_rejected():
    assert APIClient().post("/api/auth/refresh/").status_code == 401

    client = APIClient()
    res = client.post("/api/auth/guest/", {"nickname": "spammer", "age_confirmed": True}, format="json")
    User.objects.filter(id=res.data["user"]["id"]).update(is_active=False)
    assert client.post("/api/auth/refresh/").status_code == 401
