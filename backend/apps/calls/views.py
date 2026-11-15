from rest_framework.response import Response
from rest_framework.views import APIView

from .ice import ice_servers


class IceServersView(APIView):
    """Fetched right before a call: STUN/TURN servers with short-lived TURN credentials."""

    def get(self, request):
        return Response(ice_servers(request.user.id))
