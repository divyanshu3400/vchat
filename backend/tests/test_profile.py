import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.accounts.models import User
from apps.social.models import Friendship, ordered_pair

from .conftest import auth_client, make_member


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


def png(w=900, h=600) -> SimpleUploadedFile:
    out = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(out, "PNG")
    return SimpleUploadedFile("me.png", out.getvalue(), content_type="image/png")


def befriend(a, b):
    x, y = ordered_pair(a.id, b.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)


@pytest.mark.django_db
def test_change_display_name_with_rules_and_daily_limit(alice):
    c = auth_client(alice)
    assert c.patch("/api/auth/me/", {"nickname": "Alice_2"}, format="json").data["nickname"] == "Alice_2"
    bad = c.patch("/api/auth/me/", {"nickname": "a b"}, format="json")
    assert bad.status_code == 400 and bad.data["field"] == "nickname"
    assert c.patch("/api/auth/me/", {"nickname": "admin"}, format="json").status_code == 400
    c.patch("/api/auth/me/", {"nickname": "Alice_3"}, format="json")
    c.patch("/api/auth/me/", {"nickname": "Alice_4"}, format="json")
    limited = c.patch("/api/auth/me/", {"nickname": "Alice_5"}, format="json")
    assert limited.status_code == 400 and "3 times a day" in limited.data["detail"]
    assert User.objects.get(pk=alice.pk).nickname == "Alice_4"


@pytest.mark.django_db
def test_handle_unique_lowercase_and_cooldown(alice, bob):
    a, b = auth_client(alice), auth_client(bob)
    res = a.patch("/api/auth/me/", {"handle": "@Alice.Real"}, format="json")
    assert res.status_code == 200 and res.data["handle"] == "alice.real" and res.data["handle_next_change"]
    taken = b.patch("/api/auth/me/", {"handle": "alice.real"}, format="json")
    assert taken.status_code == 400 and "taken" in taken.data["detail"]
    assert b.get("/api/auth/handle/check/", {"handle": "Alice.Real"}).data["available"] is False
    assert b.get("/api/auth/handle/check/", {"handle": "bob_99"}).data["available"] is True
    for bad in ("ab", ".bob", "bob.", "b..ob", "admin", "vchat_team", "x" * 21, "bo b"):
        assert b.patch("/api/auth/me/", {"handle": bad}, format="json").status_code == 400, bad
    # Changing again within 14 days is refused.
    again = a.patch("/api/auth/me/", {"handle": "alice_new"}, format="json")
    assert again.status_code == 400 and "again on" in again.data["detail"]


@pytest.mark.django_db
def test_old_handle_is_held_for_14_days(alice, bob):
    a = auth_client(alice)
    a.patch("/api/auth/me/", {"handle": "alice_one"}, format="json")
    User.objects.filter(pk=alice.pk).update(handle_changed_at=timezone.now() - timedelta(days=15))
    assert a.patch("/api/auth/me/", {"handle": "alice_two"}, format="json").status_code == 200
    held = auth_client(bob).patch("/api/auth/me/", {"handle": "alice_one"}, format="json")
    assert held.status_code == 400 and "recently" in held.data["detail"]


@pytest.mark.django_db
def test_guests_cannot_pick_a_handle(db):
    guest = User.create_guest(nickname="guesty")
    res = auth_client(guest).patch("/api/auth/me/", {"handle": "guesty"}, format="json")
    assert res.status_code == 400 and "Save your account" in res.data["detail"]


@pytest.mark.django_db
def test_photo_is_square_and_only_friends_get_it(alice, bob):
    carol = make_member("carol")
    befriend(alice, bob)
    a = auth_client(alice)
    me = a.post("/api/auth/me/avatar/", {"file": png()}, format="multipart")
    assert me.status_code == 200 and me.data["avatar"]
    img = Image.open(io.BytesIO(b"".join(a.get(me.data["avatar"]).streaming_content)))
    assert img.size == (512, 512) and img.format == "JPEG"

    bob_sees = auth_client(bob).get("/api/friends/").data
    friends = bob_sees["friends"] if isinstance(bob_sees, dict) else bob_sees
    assert friends[0]["user"]["avatar"] == me.data["avatar"]
    found = auth_client(carol).get("/api/people/", {"q": "alice"}).data["results"]
    assert found and "avatar" not in found[0]["user"]

    # A new photo changes the link; the old one stops working.
    new = a.post("/api/auth/me/avatar/", {"file": png(300, 300)}, format="multipart").data["avatar"]
    assert new != me.data["avatar"] and a.get(me.data["avatar"]).status_code == 404
    gone = a.delete("/api/auth/me/avatar/")
    assert gone.data["avatar"] is None and a.get(new).status_code == 404


@pytest.mark.django_db
def test_photo_must_be_an_image(alice):
    bad = SimpleUploadedFile("x.png", b"not an image" * 20, content_type="image/png")
    res = auth_client(alice).post("/api/auth/me/avatar/", {"file": bad}, format="multipart")
    assert res.status_code == 400 and res.data["field"] == "avatar"


@pytest.mark.django_db
def test_search_by_handle(alice, bob):
    auth_client(bob).patch("/api/auth/me/", {"handle": "bobby.k"}, format="json")
    a = auth_client(alice)
    assert [r["user"]["handle"] for r in a.get("/api/people/", {"q": "@bobby"}).data["results"]] == ["bobby.k"]
    assert a.get("/api/people/", {"q": "bobby"}).data["results"][0]["user"]["id"] == bob.id
