"""GIFs through our GIPHY proxy: the key stays here, only rated pg-13 or milder."""

from unittest import mock

import pytest

from apps.chat.services import InvalidMessage, clean_content
from apps.gifs import services as gifs
from apps.social import services as social
from apps.social.models import Friendship, ordered_pair

from .conftest import auth_client

ITEM = {"id": "abcd1234", "title": "hello", "images": {"fixed_width": {"width": "200", "height": "150"}}}


@pytest.fixture
def key(settings):
    settings.GIPHY_API_KEY = "test-key"


@pytest.mark.django_db
def test_trending_and_search_go_through_the_server_with_the_rating(alice, key):
    with mock.patch.object(gifs, "_get", return_value={"data": [ITEM], "pagination": {"total_count": 100}}) as get:
        res = auth_client(alice).get("/api/gifs/?kind=stickers&q=  hi   there ")
        assert res.status_code == 200
        assert res.data == {"items": [{"id": "abcd1234", "w": 200, "h": 150, "title": "hello"}], "next": 24}
        path, params = get.call_args.args
        assert path == "stickers/search" and params["q"] == "hi there" and params["rating"] == "pg-13"
        # Cached: a second identical request doesn't call GIPHY again.
        auth_client(alice).get("/api/gifs/?kind=stickers&q=hi there")
        assert get.call_count == 1
        auth_client(alice).get("/api/gifs/")
        assert get.call_args.args[0] == "gifs/trending"


@pytest.mark.django_db
def test_no_key_means_no_gifs(alice, settings):
    settings.GIPHY_API_KEY = ""
    assert auth_client(alice).get("/api/gifs/").status_code == 503
    with pytest.raises(InvalidMessage):
        clean_content("gif:zzzz9999:200x150")


@pytest.mark.django_db
def test_only_known_or_checked_gifs_can_be_sent(alice, bob, key):
    with mock.patch.object(gifs, "_get", return_value={"data": [ITEM], "pagination": {"total_count": 1}}):
        gifs.browse("gifs", "", 0)
    assert clean_content("gif:abcd1234:200x150") == "gif:abcd1234:200x150"  # served by us: known

    with mock.patch.object(gifs, "_get", return_value={"data": {"id": "rrrr0000", "rating": "r"}}):
        with pytest.raises(InvalidMessage):
            clean_content("gif:rrrr0000:200x150")
    with mock.patch.object(gifs, "_get", return_value={"data": {"id": "gggg0000", "rating": "g"}}):
        assert clean_content("gif:gggg0000:200x150")

    # Previews say "GIF", not the code.
    x, y = ordered_pair(alice.id, bob.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)
    social.send_dm(alice, bob.id, "gif:abcd1234:200x150")
    assert social.conversations_of(bob)[0]["last_message"] == "🎞️ GIF"
