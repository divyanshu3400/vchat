import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat import presence
from apps.chat.models import Room
from apps.stranger import matchmaker


@pytest.fixture(autouse=True)
def _clear_cache():
    # Rate-limit counters and presence live outside the DB; never let them leak between tests.
    cache.clear()
    presence.set_backend(presence.MemoryBackend())
    matchmaker.set_backend(matchmaker.MemoryBackend())
    yield
    cache.clear()


@pytest.fixture
def room(db):
    return Room.objects.create(slug="random", name="Random chat", kind=Room.Kind.TOPIC)


def make_member(nickname: str, gender: str = "O") -> User:
    """A saved account (verified email): can send and accept friend requests."""
    user = User.create_guest(nickname=nickname, gender=gender)
    User.objects.filter(pk=user.pk).update(is_guest=False, email=f"{nickname}@example.com")
    user.refresh_from_db()
    return user


@pytest.fixture
def alice(db):
    return make_member("alice", "F")


@pytest.fixture
def bob(db):
    return make_member("bob", "M")


def auth_client(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    return client
