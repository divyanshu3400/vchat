from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.social.services import remove_social_links

from . import presence, services
from . import automod, custom_rooms, message_ops
from .models import Block, Message, Room
from .realtime import push_control
from .serializers import ReportCreateSerializer, RoomSerializer


class RoomListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = RoomSerializer
    queryset = Room.objects.filter(is_active=True).exclude(kind=Room.Kind.CUSTOM)
    pagination_class = None


class RoomPresenceView(APIView):
    """Public live counts: people in each room and on the whole site. Cached briefly."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        def compute():
            rooms = dict(Room.objects.filter(is_active=True).exclude(kind=Room.Kind.CUSTOM).values_list("id", "slug"))
            counts = presence.room_counts(rooms)
            return {
                "rooms": {slug: counts.get(rid, 0) for rid, slug in rooms.items()},
                "online": presence.site_online_count(),
            }

        data = cache.get_or_set("presence:counts", compute, settings.VCHAT["PRESENCE_COUNTS_CACHE"])
        return Response(data)


class RoomMessagesView(APIView):
    """Room history, newest page first. `?before=<id>` loads older messages."""

    def get(self, request, slug):
        room = get_object_or_404(Room, slug=slug, is_active=True)
        if not custom_rooms.is_member(room, request.user.id):
            raise Http404
        try:
            limit = min(int(request.query_params.get("limit", 50)), settings.VCHAT["HISTORY_PAGE_MAX"])
            before = request.query_params.get("before")
            before = int(before) if before else None
        except ValueError:
            raise ValidationError("limit and before must be numbers.")
        if limit < 1:
            raise ValidationError("limit must be at least 1.")

        select, prefetch = message_ops.related_fields(Message)
        qs = (
            # Deleted messages stay as "This message was deleted" in their place.
            Message.objects.filter(room=room)
            .exclude(sender_id__in=services.blocked_user_ids(request.user.id))
            .select_related("room", *select)
            .prefetch_related(*prefetch)
            .order_by("-id")
        )
        if before:
            qs = qs.filter(id__lt=before)
        page = list(qs[:limit])
        return Response(
            {
                "messages": [services.message_payload(m) for m in reversed(page)],
                "has_more": len(page) == limit,
            }
        )


def _blocks_changed(*user_ids: int) -> None:
    # Open room sockets of both people reload who they hide.
    for uid in user_ids:
        transaction.on_commit(lambda uid=uid: push_control(uid, {"type": "blocks_changed"}))


class BlockView(APIView):
    def post(self, request, user_id):
        if user_id == request.user.id:
            raise ValidationError("You can't block yourself.")
        target = get_object_or_404(User, id=user_id)
        with transaction.atomic():
            Block.objects.get_or_create(blocker=request.user, blocked=target)
            remove_social_links(request.user, target)
            _blocks_changed(request.user.id, target.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, user_id):
        with transaction.atomic():
            deleted, _ = Block.objects.filter(blocker=request.user, blocked_id=user_id).delete()
            if deleted:
                _blocks_changed(request.user.id, user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReportCreateView(generics.CreateAPIView):
    serializer_class = ReportCreateSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "reports"

    def perform_create(self, serializer):
        report = serializer.save(reporter=self.request.user)
        automod.after_report(report.reported_user_id)


# --- custom rooms (made by people, joined by invite link) ---------------------------------


def _room_error(exc) -> Response:
    return Response({"detail": exc.detail}, status=exc.status)


class MyRoomsView(APIView):
    """GET: your custom rooms (made or joined). POST {name, description?, emoji?}: make one."""

    throttle_scope = "rooms_custom"

    def get_throttles(self):
        return [ScopedRateThrottle()] if self.request.method == "POST" else []

    def get(self, request):
        return Response({"rooms": custom_rooms.my_rooms(request.user)})

    def post(self, request):
        try:
            room = custom_rooms.create_room(
                request.user, request.data.get("name"), request.data.get("description", ""), request.data.get("emoji", "")
            )
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(custom_rooms.room_payload(room, request.user.id), status=status.HTTP_201_CREATED)


class CustomRoomView(APIView):
    """GET: the room (members only). PATCH {name?, description?, emoji?, new_link?}: owner. DELETE: owner."""

    def get(self, request, slug):
        try:
            room = custom_rooms.joined(request.user, slug)
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(custom_rooms.room_payload(room, request.user.id))

    def patch(self, request, slug):
        try:
            room = custom_rooms.update(request.user, slug, request.data)
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(custom_rooms.room_payload(room, request.user.id))

    def delete(self, request, slug):
        try:
            custom_rooms.delete(request.user, slug)
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomRoomLeaveView(APIView):
    def post(self, request, slug):
        try:
            custom_rooms.leave(request.user, slug)
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomRoomMembersView(APIView):
    """GET: who is in the room. DELETE <user_id>: the owner removes someone."""

    def get(self, request, slug):
        try:
            return Response({"members": custom_rooms.members(request.user, slug)})
        except custom_rooms.RoomError as exc:
            return _room_error(exc)

    def delete(self, request, slug, user_id):
        try:
            custom_rooms.remove_member(request.user, slug, user_id)
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class InviteView(APIView):
    """GET (anyone, also for link previews): the room behind an invite code. POST: join it."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "rooms_invite"

    def get_permissions(self):
        return [AllowAny()] if self.request.method == "GET" else super().get_permissions()

    def get(self, request, code):
        try:
            return Response(custom_rooms.invite_preview(code, request.user))
        except custom_rooms.RoomError as exc:
            return _room_error(exc)

    def post(self, request, code):
        try:
            room = custom_rooms.join(request.user, code)
        except custom_rooms.RoomError as exc:
            return _room_error(exc)
        return Response(custom_rooms.room_payload(room, request.user.id))
