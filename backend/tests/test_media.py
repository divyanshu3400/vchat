import io

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.media.models import Attachment
from apps.social.models import DirectMessage, Friendship, ordered_pair
from config.asgi import application

from .conftest import auth_client

ORIGIN = [(b"origin", b"http://localhost:3000")]


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    settings.VCHAT = {**settings.VCHAT, "REWARDED_ADS": True, "STRANGER_FIND_COOLDOWN": 0}


def photo_with_gps(fmt="JPEG", size=(2400, 1200)):
    img = Image.new("RGB", size, (30, 160, 100))
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # camera make
    gps = exif.get_ifd(0x8825)  # GPS location: must not survive
    gps[1] = "N"
    gps[2] = (28.0, 36.0, 0.0)
    buf = io.BytesIO()
    img.save(buf, fmt, exif=exif.tobytes()) if fmt == "JPEG" else img.save(buf, fmt)
    return buf.getvalue()


def upload(client, data, kind="image", name="pic.jpg", ctype="image/jpeg"):
    return client.post("/api/media/", {"kind": kind, "file": SimpleUploadedFile(name, data, content_type=ctype)}, format="multipart")


@pytest.mark.django_db
def test_photo_is_reencoded_resized_and_stripped(alice):
    res = upload(auth_client(alice), photo_with_gps())
    assert res.status_code == 201 and res.data["kind"] == "image"
    a = Attachment.objects.get(id=res.data["id"])
    assert (a.width, a.height) == (1600, 800)
    stored = Image.open(a.file.path)
    assert stored.format == "JPEG"
    assert not stored.getexif()  # no camera, no GPS


@pytest.mark.django_db
def test_type_comes_from_the_bytes_not_the_name(alice):
    client = auth_client(alice)
    fake = upload(client, b"<?php echo 'hi'; ?>" + b"x" * 100, name="evil.jpg")
    assert fake.status_code == 400
    exe_as_video = upload(client, b"MZ\x90\x00" + b"\x00" * 100, kind="video", name="clip.mp4", ctype="video/mp4")
    assert exe_as_video.status_code == 400
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200
    assert upload(client, mp4, kind="video", name="clip.mp4", ctype="video/mp4").status_code == 201
    webm_voice = b"\x1a\x45\xdf\xa3" + b"\x00" * 200
    voice = upload(client, webm_voice, kind="audio", name="note.webm", ctype="audio/webm")
    assert voice.status_code == 201 and voice.data["mime"] == "audio/webm"


@pytest.mark.django_db
def test_size_limit(alice):
    big = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * (25 * 1024 * 1024 + 1)
    res = upload(auth_client(alice), big, kind="video", name="big.mp4", ctype="video/mp4")
    assert res.status_code == 400 and "too big" in res.data["detail"]


@pytest.mark.django_db
def test_upload_needs_login():
    assert upload(APIClient(), photo_with_gps()).status_code == 401


# --- sending ----------------------------------------------------------------------


@database_sync_to_async
def make_user(nickname, gender="O"):
    user = User.create_guest(nickname=nickname, gender=gender)
    return user, str(AccessToken.for_user(user))


async def me_socket(token):
    comm = WebsocketCommunicator(application, "/ws/me/", headers=ORIGIN)
    await comm.connect()
    await comm.send_json_to({"type": "auth", "token": token})
    assert (await comm.receive_json_from())["type"] == "ready"
    return comm


@pytest.mark.django_db(transaction=True)
async def test_photo_dm_between_friends_with_working_link():
    alice, a_token = await make_user("alice")
    bob, _ = await make_user("bob")
    x, y = ordered_pair(alice.id, bob.id)
    await database_sync_to_async(Friendship.objects.create)(user_a_id=x, user_b_id=y)
    up = await database_sync_to_async(upload)(auth_client(alice), photo_with_gps())
    a = await me_socket(a_token)

    await a.send_json_to({"type": "dm", "to": bob.id, "attachment": up.data["id"], "content": ""})
    event = await a.receive_json_from()
    att = event["message"]["attachment"]
    assert event["type"] == "dm" and att["kind"] == "image" and att["url"].startswith("/api/media/f/")

    res = await database_sync_to_async(APIClient().get)(att["url"])
    assert res.status_code == 200 and res["Content-Type"] == "image/jpeg"

    # Each file goes into one message only.
    await a.send_json_to({"type": "dm", "to": bob.id, "attachment": up.data["id"]})
    assert (await a.receive_json_from())["code"] == "invalid_attachment"
    assert await database_sync_to_async(DirectMessage.objects.count)() == 1
    await a.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_cannot_send_someone_elses_upload():
    alice, a_token = await make_user("alice")
    bob, _ = await make_user("bob")
    x, y = ordered_pair(alice.id, bob.id)
    await database_sync_to_async(Friendship.objects.create)(user_a_id=x, user_b_id=y)
    bobs = await database_sync_to_async(upload)(auth_client(bob), photo_with_gps())
    a = await me_socket(a_token)
    await a.send_json_to({"type": "dm", "to": bob.id, "attachment": bobs.data["id"]})
    assert (await a.receive_json_from())["code"] == "invalid_attachment"
    await a.disconnect()


@pytest.mark.django_db
def test_links_are_signed_and_expire(alice, settings):
    from apps.media import services

    res = upload(auth_client(alice), photo_with_gps())
    a = Attachment.objects.get(id=res.data["id"])
    assert services.resolve(services.signed_url(a).split("/")[-2]) is None  # not sent yet: no access
    services.claim_for_message(alice.id, a.id, ("image",))
    token = services.signed_url(a).split("/")[-2]
    assert services.resolve(token).id == a.id
    assert services.resolve(token[:-2] + "xx") is None  # tampered
    settings.VCHAT = {**settings.VCHAT, "MEDIA_LINK_SECONDS": -1}
    assert services.resolve(token) is None  # expired
    assert APIClient().get(f"/api/media/f/{signing.dumps('nope')}/").status_code == 404


@pytest.mark.django_db(transaction=True)
async def test_stranger_photos_need_an_unlock_voice_is_free():
    alice, a_token = await make_user("alice", "F")
    bob, b_token = await make_user("bob", "M")
    a, b = await me_socket(a_token), await me_socket(b_token)
    await a.send_json_to({"type": "stranger.find"})
    await a.receive_json_from()
    await b.send_json_to({"type": "stranger.find"})
    await b.receive_json_from()
    await a.receive_json_from()

    up = await database_sync_to_async(upload)(auth_client(alice), photo_with_gps())
    await a.send_json_to({"type": "stranger.message", "attachment": up.data["id"]})
    assert (await a.receive_json_from())["code"] == "locked_photos"

    res = await database_sync_to_async(auth_client(alice).post)("/api/premium/reward/", {"kind": "random_photos"}, format="json")
    assert res.data["uses_left"] == 3
    await a.send_json_to({"type": "stranger.message", "attachment": up.data["id"]})
    got = await b.receive_json_from()
    assert got["message"]["attachment"]["kind"] == "image"
    assert (await a.receive_json_from())["type"] == "stranger.message"

    voice = await database_sync_to_async(upload)(
        auth_client(alice), b"\x1a\x45\xdf\xa3" + b"\x00" * 200, "audio", "n.webm", "audio/webm"
    )
    await a.send_json_to({"type": "stranger.message", "attachment": voice.data["id"]})
    got = await b.receive_json_from()  # voice messages are free, no unlock spent
    assert got["message"]["attachment"]["kind"] == "audio"
    await a.receive_json_from()
    status = await database_sync_to_async(auth_client(alice).get)("/api/premium/status/")
    assert status.data["grants"]["random_photos"]["uses_left"] == 2

    clip = await database_sync_to_async(upload)(
        auth_client(alice), b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200, "video", "c.mp4", "video/mp4"
    )
    await a.send_json_to({"type": "stranger.message", "attachment": clip.data["id"]})
    assert (await a.receive_json_from())["code"] == "invalid_attachment"  # no videos with strangers
    await a.disconnect()
    await b.disconnect()
