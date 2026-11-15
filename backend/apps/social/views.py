from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.chat import presence

from . import services
from .services import SocialError


def _social_error(exc: SocialError) -> Response:
    code = status.HTTP_404_NOT_FOUND if exc.code == "not_found" else status.HTTP_400_BAD_REQUEST
    return Response({"code": exc.code, "detail": exc.detail}, status=code)


# Guests save their account (email + password) before making friends. While email isn't set up
# on the server, nobody could, so the rule waits until it is.
ACCOUNT_REQUIRED = {
    "code": "account_required",
    "detail": "Save your account with an email to make friends, so you never lose them.",
}


def _int_param(value, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError({name: "Must be a number."})


class FriendListView(APIView):
    def get(self, request):
        return Response(services.friends_of(request.user))


class FriendsOnlineView(APIView):
    """Ids of friends online right now. Clients poll this as a backstop for missed presence events."""

    def get(self, request):
        return Response({"online": sorted(presence.online_among(services.friend_ids(request.user.id)))})


class FriendDetailView(APIView):
    def delete(self, request, user_id):
        services.unfriend(request.user, user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FriendRequestListView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friend_requests"

    def get_throttles(self):
        # Only sending requests is rate limited; listing them is not.
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        return Response(services.pending_requests(request.user))

    def post(self, request):
        if request.user.is_guest and settings.EMAIL_ENABLED:
            return Response(ACCOUNT_REQUIRED, status=status.HTTP_403_FORBIDDEN)
        target = get_object_or_404(User, id=_int_param(request.data.get("to_user"), "to_user"))
        try:
            outcome, req = services.send_friend_request(request.user, target)
        except SocialError as exc:
            return _social_error(exc)
        if outcome == "accepted":
            return Response({"status": "accepted", "friend": services.brief(target)})
        return Response({"status": "pending", "request": services.request_payload(req)}, status=status.HTTP_201_CREATED)


class FriendRequestActionView(APIView):
    def post(self, request, request_id, action):
        if action not in ("accept", "decline", "cancel"):
            return Response(status=status.HTTP_404_NOT_FOUND)
        if action == "accept" and request.user.is_guest and settings.EMAIL_ENABLED:
            return Response(ACCOUNT_REQUIRED, status=status.HTTP_403_FORBIDDEN)
        try:
            services.respond_to_request(request_id, request.user, action)
        except SocialError as exc:
            return _social_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConversationListView(APIView):
    def get(self, request):
        return Response(services.conversations_of(request.user))


class DmMessagesView(APIView):
    def get(self, request, user_id):
        partner = get_object_or_404(User, id=user_id, is_active=True)
        if partner.id == request.user.id or services.is_blocked_between(request.user.id, partner.id):
            return Response(status=status.HTTP_404_NOT_FOUND)
        limit = min(_int_param(request.query_params.get("limit", 50), "limit"), settings.VCHAT["HISTORY_PAGE_MAX"])
        if limit < 1:
            raise ValidationError({"limit": "Must be at least 1."})
        before = request.query_params.get("before")
        messages, has_more = services.dm_history(
            request.user, partner.id, _int_param(before, "before") if before else None, limit
        )
        return Response(
            {
                "partner": services.brief(partner),
                "is_friend": services.are_friends(request.user.id, partner.id),
                "messages": messages,
                "has_more": has_more,
                "partner_read_id": services.partner_read_id(request.user, partner.id),
            }
        )


class DmReadView(APIView):
    def post(self, request, user_id):
        services.mark_read(request.user, user_id, _int_param(request.data.get("last_id"), "last_id"))
        return Response(status=status.HTTP_204_NO_CONTENT)
