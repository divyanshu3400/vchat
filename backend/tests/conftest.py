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


@pytest.fixture
def alice(db):
    return User.create_guest(nickname="alice", gender="F")


@pytest.fixture
def bob(db):
    return User.create_guest(nickname="bob", gender="M")


def auth_client(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    return client
