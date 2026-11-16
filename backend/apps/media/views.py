from django.contrib.admin.views.decorators import staff_member_required
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.chat.realtime import push_to_user

from . import services
from .models import Attachment
from .services import OpenError, UploadError


class UploadView(APIView):
    """Upload first, then send a message that points at the returned id."""

    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "uploads"

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "Choose a file to send."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            attachment = services.store_upload(
                request.user, str(request.data.get("kind", "")), upload, str(request.data.get("view", ""))
            )
        except UploadError as exc:
            return Response({"detail": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"id": str(attachment.id), "kind": attachment.kind, "mime": attachment.mime, "size": attachment.size},
            status=status.HTTP_201_CREATED,
        )


def media_file(request, token):
    """Serves a sent attachment through a signed, expiring link (no login needed, like a CDN link)."""
    attachment = services.resolve(token)
    if attachment is None:
        raise Http404
    return _serve(attachment, "private, max-age=3600")


def _serve(attachment, cache_control: str):
    response = FileResponse(attachment.file.open("rb"), content_type=attachment.mime)
    response["Cache-Control"] = cache_control
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Disposition"] = "inline"
    return response


class OpenTimedView(APIView):
    """The recipient opens a view-once / timed photo or video, or a listen-twice voice message."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "media_open"

    def post(self, request, pk):
        try:
            data, people = services.open_timed(request.user, pk)
        except OpenError as exc:
            return Response({"code": exc.code, "detail": exc.detail}, status=exc.status)
        event = {"type": "media.opened", "attachment_id": str(pk), "views_left": data["views_left"]}
        for uid in set(people):
            push_to_user(uid, event)
        return Response(data)


def timed_file(request, token):
    """A link from OpenTimedView: short-lived, and a photo's works once. Never cached."""
    attachment = services.resolve_timed(token)
    if attachment is None:
        raise Http404
    return _serve(attachment, "no-store")


@staff_member_required
def staff_file(request, pk):
    """Moderators checking a report: any attachment, disappearing ones included, while it is kept."""
    attachment = get_object_or_404(Attachment, pk=pk)
    if not attachment.file:
        raise Http404
    return _serve(attachment, "no-store")
