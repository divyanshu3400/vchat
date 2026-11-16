from django.conf import settings
from django.core.cache import cache
from django.db import transaction
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
from . import automod, message_ops
from .models import Block, Message, Room
from .realtime import push_control
from .serializers import ReportCreateSerializer, RoomSerializer


class RoomListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = RoomSerializer
    queryset = Room.objects.filter(is_active=True)
    pagination_class = None


class RoomPresenceView(APIView):
    """Public live counts: people in each room and on the whole site. Cached briefly."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        def compute():
            rooms = dict(Room.objects.filter(is_active=True).values_list("id", "slug"))
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
