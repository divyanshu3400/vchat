from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services
from .services import RewardError


class PremiumStatusView(APIView):
    def get(self, request):
        return Response(services.status(request.user))


class RewardView(APIView):
    """Called by the page after a rewarded ad reports it was watched to the end."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "rewards"

    def post(self, request):
        try:
            grant = services.grant_reward(request.user, str(request.data.get("kind", "")))
        except RewardError as exc:
            code = status.HTTP_429_TOO_MANY_REQUESTS if exc.code == "daily_limit" else status.HTTP_400_BAD_REQUEST
            return Response({"code": exc.code, "detail": exc.detail}, status=code)
        return Response(
            {"kind": grant.kind, "uses_left": grant.uses_left, "expires_at": grant.expires_at.isoformat(), "status": services.status(request.user)},
            status=status.HTTP_201_CREATED,
        )
