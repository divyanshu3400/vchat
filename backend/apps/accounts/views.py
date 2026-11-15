from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .serializers import GuestSignupSerializer, PublicUserSerializer

COOKIE_PATH = "/api/auth/"


def _set_refresh_cookie(response: Response, token: str) -> None:
    # httpOnly: page scripts (and any XSS) can never read the long-lived token.
    response.set_cookie(
        settings.VCHAT["REFRESH_COOKIE"],
        token,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=not settings.DEBUG,
        samesite="Lax",
        path=COOKIE_PATH,
    )


class GuestSignupView(APIView):
    """Create an anonymous guest. Returns a short-lived access token; the refresh
    token goes into an httpOnly cookie so the guest identity survives reloads."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "guest_signup"

    def post(self, request):
        serializer = GuestSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.create_guest(
            nickname=serializer.validated_data["nickname"],
            gender=serializer.validated_data.get("gender", ""),
        )
        refresh = RefreshToken.for_user(user)
        response = Response(
            {"user": PublicUserSerializer(user).data, "access": str(refresh.access_token)},
            status=status.HTTP_201_CREATED,
        )
        _set_refresh_cookie(response, str(refresh))
        return response


class CookieRefreshView(APIView):
    """Exchange the refresh cookie for a fresh access token."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        raw = request.COOKIES.get(settings.VCHAT["REFRESH_COOKIE"])
        if not raw:
            return Response({"detail": "No session."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            refresh = RefreshToken(raw)
        except TokenError:
            return Response({"detail": "Session expired."}, status=status.HTTP_401_UNAUTHORIZED)

        user = User.objects.filter(id=refresh.get("user_id"), is_active=True).first()
        if user is None:
            return Response({"detail": "Session expired."}, status=status.HTTP_401_UNAUTHORIZED)

        return Response({"user": PublicUserSerializer(user).data, "access": str(refresh.access_token)})


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.VCHAT["REFRESH_COOKIE"], path=COOKIE_PATH)
        return response


class MeView(APIView):
    def get(self, request):
        return Response(PublicUserSerializer(request.user).data)
