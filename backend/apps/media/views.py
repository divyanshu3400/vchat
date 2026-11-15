from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services
from .services import UploadError


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
            attachment = services.store_upload(request.user, str(request.data.get("kind", "")), upload)
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
    response = FileResponse(attachment.file.open("rb"), content_type=attachment.mime)
    response["Cache-Control"] = "private, max-age=3600"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Disposition"] = "inline"
    return response
