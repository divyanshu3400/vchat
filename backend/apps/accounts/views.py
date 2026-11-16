from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from . import closing, email_auth, moderation
from .email_auth import AccountError
from .models import EmailCode, User
from .serializers import (
    EmailCodeSerializer,
    EmailOnlySerializer,
    EmailPasswordSerializer,
    GuestSignupSerializer,
    MeSerializer,
    ResetSerializer,
)

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


def _start_session(user: User, request, status_code: int = status.HTTP_200_OK) -> Response:
    """Log in: an access token in the body, the refresh token in the httpOnly cookie."""
    if user.is_banned:
        return Response(moderation.ban_payload(user), status=status.HTTP_403_FORBIDDEN)
    new_device = moderation.remember_device(user, request)
    refresh = RefreshToken.for_user(user)
    refresh["sv"] = user.session_version
    response = Response({"user": MeSerializer(user).data, "access": str(refresh.access_token)}, status=status_code)
    _set_refresh_cookie(response, str(refresh))
    moderation.set_device_cookie(response, new_device)
    return response


def _account_error(exc: AccountError) -> Response:
    return Response({"code": exc.code, "detail": exc.detail}, status=exc.status)


def _password_problems(password: str, user: User | None) -> str | None:
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        return " ".join(exc.messages)
    return None


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
        device_hash, _ = moderation.device_of(request)
        ip = moderation.client_ip(request)
        if moderation.evading(device_hash, moderation.digest(ip) if ip else ""):
            return Response(
                {"code": "banned", "detail": "You can't start a new account right now: this browser or network is under a ban."},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = User.create_guest(
            nickname=serializer.validated_data["nickname"],
            gender=serializer.validated_data.get("gender", ""),
        )
        return _start_session(user, request, status.HTTP_201_CREATED)


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
        # A password reset ends every session started before it.
        if user is None or refresh.get("sv", 0) != user.session_version:
            return Response({"detail": "Session expired."}, status=status.HTTP_401_UNAUTHORIZED)
        if user.is_banned:
            return Response(moderation.ban_payload(user), status=status.HTTP_403_FORBIDDEN)

        new_device = moderation.remember_device(user, request)
        response = Response({"user": MeSerializer(user).data, "access": str(refresh.access_token)})
        moderation.set_device_cookie(response, new_device)
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.VCHAT["REFRESH_COOKIE"], path=COOKIE_PATH)
        return response


class MeView(APIView):
    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        """Privacy settings: {"show_last_seen": bool}."""
        value = request.data.get("show_last_seen")
        if isinstance(value, bool):
            User.objects.filter(pk=request.user.pk).update(show_last_seen=value)
            request.user.show_last_seen = value
        return Response(MeSerializer(request.user).data)


def _loginable(email: str):
    """Active, or deactivated by its owner (log in to come back). Never erased or admin-disabled."""
    return (
        User.objects.filter(email__iexact=email, is_guest=False, deleted_at__isnull=True)
        .filter(Q(is_active=True) | Q(deactivated_at__isnull=False))
        .first()
    )


def _signed_out(payload: dict) -> Response:
    response = Response(payload)
    response.delete_cookie(settings.VCHAT["REFRESH_COOKIE"], path=COOKIE_PATH)
    return response


class DeactivateView(APIView):
    """Saved accounts: password, then signed out everywhere. Logging in again brings it back."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        user = request.user
        if user.is_guest:
            return Response(
                {"code": "guest", "detail": "Guest accounts can't be deactivated: you couldn't log back in. Save your account first, or delete it."},
                status=400,
            )
        if not user.check_password(str(request.data.get("password", ""))):
            return Response({"code": "wrong_password", "detail": "That password isn't right."}, status=400)
        closing.deactivate(user)
        return _signed_out({"deactivated": True})


class DeleteAccountView(APIView):
    """Saved accounts: deactivated now, deleted after 15 days unless they log in. Guests: deleted now."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        user = request.user
        if request.data.get("confirm") != "DELETE":
            return Response({"code": "confirm", "detail": "Type DELETE to confirm."}, status=400)
        if user.is_guest:
            closing.erase(user)
            return _signed_out({"deleted": True})
        if not user.check_password(str(request.data.get("password", ""))):
            return Response({"code": "wrong_password", "detail": "That password isn't right."}, status=400)
        closing.deactivate(user, delete=True)
        return _signed_out({"delete_after": user.delete_after.isoformat()})


# --- email accounts ------------------------------------------------------------------


class AccountStartView(APIView):
    """A guest picks an email and a password; we email a code to prove the address."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_codes"

    def post(self, request):
        user = request.user
        if not user.is_guest:
            return Response({"code": "already_saved", "detail": "Your account is already saved."}, status=400)
        s = EmailPasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email, password = s.validated_data["email"], s.validated_data["password"]
        problem = _password_problems(password, user)
        if problem:
            return Response({"code": "weak_password", "detail": problem}, status=400)
        try:
            email_auth.require_enabled()
            if email_auth.email_taken(email):
                raise AccountError("email_taken", "That email already has an account. Log in instead.", 409)
            email_auth.send_code(email, EmailCode.Purpose.VERIFY, user, make_password(password))
        except AccountError as exc:
            return _account_error(exc)
        return Response({"sent_to": email}, status=status.HTTP_202_ACCEPTED)


class AccountVerifyView(APIView):
    """The right code saves the guest account: same user, now with an email and a password."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        s = EmailCodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data["email"]
        try:
            row = email_auth.check_code(email, EmailCode.Purpose.VERIFY, s.validated_data["code"])
            if row.user_id != request.user.id:
                raise AccountError("wrong_code", "That code isn't right.")
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=request.user.pk)
                user.email = email
                user.password = row.password_hash
                user.is_guest = False
                user.save(update_fields=["email", "password", "is_guest"])
        except AccountError as exc:
            return _account_error(exc)
        except IntegrityError:
            return _account_error(AccountError("email_taken", "That email already has an account. Log in instead.", 409))
        return Response({"user": MeSerializer(user).data})


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        s = EmailPasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = _loginable(s.validated_data["email"])
        if user is None or not user.check_password(s.validated_data["password"]):
            return Response({"code": "wrong_login", "detail": "Wrong email or password."}, status=400)
        if user.is_banned:
            return _start_session(user, request)  # the ban answer; a banned account stays as it is
        # Deactivated (or waiting to be deleted): logging in brings the account back.
        cancelled = closing.reactivate(user)
        response = _start_session(user, request)
        if cancelled:
            response.data["deletion_cancelled"] = True
        return response


class ForgotPasswordView(APIView):
    """Always the same answer, so nobody can find out which emails have an account."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_codes"

    def post(self, request):
        s = EmailOnlySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            email_auth.require_enabled()
        except AccountError as exc:
            return _account_error(exc)
        email = s.validated_data["email"]
        user = _loginable(email)
        if user is not None:
            try:
                email_auth.send_code(email, EmailCode.Purpose.RESET, user)
            except AccountError:
                pass  # rate limits and mail failures look the same as "no account"
        return Response(
            {"detail": "If that email has a vChat account, we sent it a code."}, status=status.HTTP_202_ACCEPTED
        )


class ResetPasswordView(APIView):
    """The emailed code plus a new password; every other session is signed out."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        s = ResetSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            row = email_auth.check_code(s.validated_data["email"], EmailCode.Purpose.RESET, s.validated_data["code"])
        except AccountError as exc:
            return _account_error(exc)
        user = row.user
        problem = _password_problems(s.validated_data["password"], user)
        if problem:
            # The code was spent; ask for the password first next time. A new code is one tap away.
            return Response({"code": "weak_password", "detail": problem + " Ask for a new code and try again."}, status=400)
        user.set_password(s.validated_data["password"])
        User.objects.filter(pk=user.pk).update(password=user.password, session_version=F("session_version") + 1)
        user.refresh_from_db()
        return _start_session(user, request)
