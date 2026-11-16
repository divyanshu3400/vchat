"""Disappearing media: view once, 10/20/30 s on screen, voice messages heard twice."""

from datetime import timedelta

import pytest
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.media.models import Attachment
from apps.social import services as social
from apps.social.models import Friendship, ordered_pair
from apps.stranger.models import StrangerMessage, StrangerSession

from .conftest import auth_client, make_member
from .test_media import photo_with_gps


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


def befriend(a, b):
    x, y = ordered_pair(a.id, b.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)


def send_timed(sender, recipient, view="once", kind="image", data=None):
    client = auth_client(sender)
    if kind == "image":
        file = SimpleUploadedFile("p.jpg", data or photo_with_gps(), content_type="image/jpeg")
    else:
        file = SimpleUploadedFile("v.webm", b"\x1a\x45\xdf\xa3" + b"\0" * 64, content_type="audio/webm")
    res = client.post("/api/media/", {"kind": kind, "view": view, "file": file}, format="multipart")
    assert res.status_code == 201, res.data
    return social.send_dm(sender, recipient.id, "", res.data["id"])


@pytest.mark.django_db
def test_view_once_photo_has_no_link_and_opens_once(alice, bob):
    befriend(alice, bob)
    msg = send_timed(alice, bob, "once")
    att = msg["attachment"]
    assert att["url"] == "" and att["view"] == "once" and att["views_left"] == 1

    # The sender can't open it, nor can anyone outside the chat.
    assert auth_client(alice).post(f"/api/media/{att['id']}/open/").status_code == 404
    carol = make_member("carol")
    assert auth_client(carol).post(f"/api/media/{att['id']}/open/").status_code == 404

    res = auth_client(bob).post(f"/api/media/{att['id']}/open/")
    assert res.status_code == 200 and res.data["seconds"] is None and res.data["views_left"] == 0
    link = res.data["url"]
    assert link.startswith("/api/media/t/")

    # The photo's link works one time; opening again is refused.
    assert auth_client(bob).get(link).status_code == 200
    assert auth_client(bob).get(link).status_code == 404
    again = auth_client(bob).post(f"/api/media/{att['id']}/open/")
    assert again.status_code == 410 and again.data["code"] == "spent"

    a = Attachment.objects.get(id=att["id"])
    assert a.views == 1 and a.opened_at is not None
    # The lasting signed link never works for it either.
    from apps.media import services

    assert services.resolve(services.signed_url(a).split("/")[-2]) is None


@pytest.mark.django_db
def test_timed_photo_returns_its_seconds(alice, bob):
    befriend(alice, bob)
    att = send_timed(alice, bob, "20")["attachment"]
    res = auth_client(bob).post(f"/api/media/{att['id']}/open/")
    assert res.data["seconds"] == 20


@pytest.mark.django_db
def test_only_known_timers(alice):
    file = SimpleUploadedFile("p.jpg", photo_with_gps(), content_type="image/jpeg")
    res = auth_client(alice).post("/api/media/", {"kind": "image", "view": "twice", "file": file}, format="multipart")
    assert res.status_code == 400
    file = SimpleUploadedFile("p.jpg", photo_with_gps(), content_type="image/jpeg")
    res = auth_client(alice).post("/api/media/", {"kind": "image", "view": "5", "file": file}, format="multipart")
    assert res.status_code == 400


@pytest.mark.django_db
def test_voice_twice_in_a_random_chat(alice, bob):
    file = SimpleUploadedFile("v.webm", b"\x1a\x45\xdf\xa3" + b"\0" * 64, content_type="audio/webm")
    res = auth_client(alice).post("/api/media/", {"kind": "audio", "view": "twice", "file": file}, format="multipart")
    assert res.status_code == 201
    a = Attachment.objects.get(id=res.data["id"])
    session = StrangerSession.objects.create(user_a=alice, user_b=bob)
    Attachment.objects.filter(pk=a.pk).update(used_at=timezone.now())
    StrangerMessage.objects.create(session=session, sender=alice, attachment=a)

    first = auth_client(bob).post(f"/api/media/{a.id}/open/")
    assert first.status_code == 200 and first.data["views_left"] == 1
    # Audio links work for the whole listen (the player may fetch more than once).
    assert auth_client(bob).get(first.data["url"]).status_code == 200
    assert auth_client(bob).get(first.data["url"]).status_code == 200
    assert auth_client(bob).post(f"/api/media/{a.id}/open/").data["views_left"] == 0
    assert auth_client(bob).post(f"/api/media/{a.id}/open/").status_code == 410


@pytest.mark.django_db
def test_hidden_copy_kept_30_days_then_file_goes(alice, bob):
    befriend(alice, bob)
    att = send_timed(alice, bob, "once")["attachment"]
    a = Attachment.objects.get(id=att["id"])
    # Its message is gone (auto-deleted chat), but reports may still need the file.
    a.dm_message.delete()
    call_command("purge_old_data")
    a.refresh_from_db()
    assert a.file

    Attachment.objects.filter(pk=a.pk).update(created_at=timezone.now() - timedelta(days=31))
    call_command("purge_old_data")
    assert not Attachment.objects.filter(pk=a.pk).exists()


@pytest.mark.django_db
def test_timed_file_in_a_kept_chat_expires_after_30_days(alice, bob):
    befriend(alice, bob)
    att = send_timed(alice, bob, "10")["attachment"]
    Attachment.objects.filter(pk=att["id"]).update(created_at=timezone.now() - timedelta(days=31))
    call_command("purge_old_data")
    a = Attachment.objects.get(pk=att["id"])
    assert not a.file
    res = auth_client(bob).post(f"/api/media/{a.id}/open/")
    assert res.status_code == 410 and res.data["code"] == "gone"


@pytest.mark.django_db
def test_staff_can_open_for_reports(alice, bob, client):
    befriend(alice, bob)
    att = send_timed(alice, bob, "once")["attachment"]
    url = f"/api/media/staff/{att['id']}/"
    assert client.get(url).status_code == 302  # to the admin login
    staff = make_member("mod")
    staff.is_staff = True
    staff.save()
    client.force_login(staff)
    assert client.get(url).status_code == 200
