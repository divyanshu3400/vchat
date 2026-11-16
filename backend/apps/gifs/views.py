from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services


class GifBrowseView(APIView):
    """GET /api/gifs/?kind=gifs|stickers&q=<search>&offset=<n>: trending without q."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "gifs"

    def get(self, request):
        try:
            offset = int(request.query_params.get("offset", 0))
        except ValueError:
            offset = 0
        try:
            data = services.browse(request.query_params.get("kind", "gifs"), request.query_params.get("q", ""), offset)
        except services.GifError as exc:
            return Response({"code": "gifs_unavailable", "detail": str(exc)}, status=503)
        return Response(data)
