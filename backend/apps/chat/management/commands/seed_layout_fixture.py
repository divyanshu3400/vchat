"""Local test data for the layout checks (web/e2e): two friends with a chat that has every kind of
message the layout must survive (short, long, room invites), and a private room they're both in.

    DJANGO_DEBUG=1 python manage.py seed_layout_fixture --out ../web/e2e/.fixture.json

Development only: refuses to run unless DEBUG is on. Safe to run again (it reuses what it made).
The password is a fixed test value for these two local accounts and nothing else.
"""

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.chat import custom_rooms
from apps.chat.models import Room, RoomMember
from apps.social import services as social
from apps.social.models import DirectMessage, Friendship, ordered_pair

PASSWORD = "layout-check-only-123"


def _member(handle: str, nickname: str) -> User:
    user = User.objects.filter(handle=handle).first()
    if user is None:
        user = User.create_guest(nickname=nickname, handle=handle)
    user.is_guest = False
    user.set_password(PASSWORD)
    user.save()
    return user


class Command(BaseCommand):
    help = "Create local data for the web layout checks (DEBUG only)."

    def add_arguments(self, parser):
        parser.add_argument("--out", help="Write the fixture (ids, room, invite code) to this JSON file.")

    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError("Development only: set DJANGO_DEBUG=1.")
        me = _member("layout_me", "Layout_Me")
        friend = _member("layout_friend", "A_Rather_Long_Name")
        x, y = ordered_pair(me.id, friend.id)
        Friendship.objects.get_or_create(user_a_id=x, user_b_id=y)

        room = Room.objects.filter(owner=me, kind=Room.Kind.CUSTOM, name="Weekend gang with a long name").first()
        if room is None:
            room = custom_rooms.create_room(me, "Weekend gang with a long name", "Plans, memes and everything else", "🎮")
        RoomMember.objects.get_or_create(room=room, user=friend)

        convo_exists = DirectMessage.objects.filter(sender=friend, content="Hii there").exists()
        if not convo_exists:
            link = f"http://localhost:3100/r/{room.invite_code}"
            for text in ["Hii there", "Baby", "long message " * 14, link, f"Join my room on vChat: {link}", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]:
                social.send_dm(friend, me.id, text)
            for text in ["hey", "how are you doing today? " * 3]:
                social.send_dm(me, friend.id, text)

        data = {"login": me.handle, "password": PASSWORD, "friend_id": friend.id, "room_slug": room.slug, "invite_code": room.invite_code}
        if opts.get("out"):
            Path(opts["out"]).write_text(json.dumps(data, indent=2), encoding="utf-8")
        self.stdout.write(json.dumps(data))
