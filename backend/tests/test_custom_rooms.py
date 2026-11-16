import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat.models import Block, Room, RoomMember
from config.asgi import application

from .conftest import auth_client, make_member

ORIGIN = [(b"origin", b"http://localhost:3000")]


def create(client, name="Our gang", **kw):
    return client.post("/api/rooms/mine/", {"name": name, **kw}, format="json")


@pytest.mark.django_db
def test_make_a_room_share_the_link_and_join(alice, bob):
    a, b = auth_client(alice), auth_client(bob)
    res = create(a, emoji="🎮", description="  weekend   plans ")
    assert res.status_code == 201
    room = res.data
    assert room["is_owner"] and room["members"] == 1 and room["emoji"] == "🎮" and room["description"] == "weekend plans"
    code = room["invite_code"]

    # Anyone with the link sees the card (link previews too); members-only things stay hidden.
    card = APIClient().get(f"/api/rooms/invite/{code}/").data
    assert card == {"name": "Our gang", "emoji": "🎮", "description": "weekend plans", "members": 1}
    assert b.get(f"/api/rooms/invite/{code}/").data["is_member"] is False

    # Not a member yet: no history, no room details.
    assert b.get(f"/api/rooms/{room['slug']}/messages/").status_code == 404
    assert b.get(f"/api/rooms/c/{room['slug']}/").status_code == 404

    joined = b.post(f"/api/rooms/invite/{code}/")
    assert joined.status_code == 200 and joined.data["invite_code"] == code and joined.data["members"] == 2 and not joined.data["is_owner"]
    assert b.post(f"/api/rooms/invite/{code}/").status_code == 200  # joining twice is fine
    assert b.get(f"/api/rooms/invite/{code}/").data == {**card, "members": 2, "is_member": True, "slug": room["slug"]}
    assert b.get(f"/api/rooms/{room['slug']}/messages/").status_code == 200
    assert [r["slug"] for r in b.get("/api/rooms/mine/").data["rooms"]] == [room["slug"]]

    # Custom rooms never show in the public list.
    assert all(r["kind"] != "custom" for r in APIClient().get("/api/rooms/").data)


@pytest.mark.django_db
def test_owner_controls(alice, bob):
    a, b = auth_client(alice), auth_client(bob)
    room = create(a).data
    slug, code = room["slug"], room["invite_code"]
    b.post(f"/api/rooms/invite/{code}/")

    assert b.patch(f"/api/rooms/c/{slug}/", {"name": "Mine now"}, format="json").status_code == 403
    renamed = a.patch(f"/api/rooms/c/{slug}/", {"name": "Gang 2", "new_link": True}, format="json").data
    assert renamed["name"] == "Gang 2" and renamed["invite_code"] != code
    assert APIClient().get(f"/api/rooms/invite/{code}/").status_code == 404  # old link stops working

    members = a.get(f"/api/rooms/c/{slug}/members/").data["members"]
    assert [m["user"]["id"] for m in members] == [alice.id, bob.id] and members[0]["is_owner"]

    assert a.delete(f"/api/rooms/c/{slug}/members/{bob.id}/").status_code == 204
    assert b.get(f"/api/rooms/{slug}/messages/").status_code == 404
    again = b.post(f"/api/rooms/invite/{renamed['invite_code']}/")
    assert again.status_code == 403 and "removed" in again.data["detail"]

    assert a.post(f"/api/rooms/c/{slug}/leave/").status_code == 400  # the owner deletes instead
    assert a.delete(f"/api/rooms/c/{slug}/").status_code == 204
    assert not Room.objects.filter(slug=slug).exists()


@pytest.mark.django_db
def test_leaving_lets_you_back_in(alice, bob):
    a, b = auth_client(alice), auth_client(bob)
    room = create(a).data
    b.post(f"/api/rooms/invite/{room['invite_code']}/")
    assert b.post(f"/api/rooms/c/{room['slug']}/leave/").status_code == 204
    assert b.get("/api/rooms/mine/").data["rooms"] == []
    assert b.post(f"/api/rooms/invite/{room['invite_code']}/").status_code == 200


@pytest.mark.django_db
def test_limits(alice, bob):
    a = auth_client(alice)
    for i in range(3):
        assert create(a, name=f"Room {i}").status_code == 201
    assert create(a, name="One more").status_code == 400
    assert create(auth_client(bob), name="x").status_code == 400  # name too short
    guest = User.create_guest(nickname="guesty")
    assert create(auth_client(guest)).status_code == 403
    # Guests can still join with a link.
    code = Room.objects.filter(owner=alice).first().invite_code
    assert auth_client(guest).post(f"/api/rooms/invite/{code}/").status_code == 200


@pytest.mark.django_db
def test_someone_the_owner_blocked_cant_join(alice, bob):
    room = create(auth_client(alice)).data
    Block.objects.create(blocker=alice, blocked=bob)
    assert auth_client(bob).post(f"/api/rooms/invite/{room['invite_code']}/").status_code == 403


@pytest.mark.django_db(transaction=True)
async def test_socket_is_members_only_and_closes_when_removed():
    @database_sync_to_async
    def setup():
        owner, member, outsider = make_member("owner1"), make_member("member1"), make_member("outsider1")
        room = Room.objects.create(slug="c-test", name="Test", kind="custom", owner=owner, invite_code="abcd1234")
        RoomMember.objects.create(room=room, user=owner)
        RoomMember.objects.create(room=room, user=member)
        return room, owner, member, outsider

    room, owner, member, outsider = await setup()

    async def open_as(user):
        comm = WebsocketCommunicator(application, "/ws/rooms/c-test/", headers=ORIGIN)
        assert (await comm.connect())[0]
        await comm.send_json_to({"type": "auth", "token": str(AccessToken.for_user(user))})
        return comm

    out = await open_as(outsider)
    assert (await out.receive_json_from())["code"] == "not_member"
    assert (await out.receive_output())["type"] == "websocket.close"

    m = await open_as(member)
    assert (await m.receive_json_from())["type"] == "ready"
    await database_sync_to_async(auth_client(owner).delete)(f"/api/rooms/c/c-test/members/{member.id}/")
    assert (await m.receive_json_from())["code"] == "room_removed"
    assert (await m.receive_output())["type"] == "websocket.close"
