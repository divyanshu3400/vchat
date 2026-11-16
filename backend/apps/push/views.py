from django.conf import settings
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import sender
from .models import NotificationPrefs, PushSubscription


class SubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=2000)
    keys = serializers.DictField(child=serializers.CharField(max_length=200))

    def validate_endpoint(self, value):
        if not value.startswith("https://"):
            raise serializers.ValidationError("Push endpoints are https.")
        return value

    def validate_keys(self, value):
        if not value.get("p256dh") or not value.get("auth"):
            raise serializers.ValidationError("p256dh and auth are required.")
        return value


def _prefs_payload(prefs: NotificationPrefs) -> dict:
    return {f: getattr(prefs, f) for f in NotificationPrefs.FIELDS}


class PushView(APIView):
    """GET: is push on, the server's public key, and your settings. PATCH: change settings."""

    def get(self, request):
        return Response(
            {
                "enabled": sender.enabled(),
                "public_key": settings.VAPID_PUBLIC_KEY,
                "prefs": _prefs_payload(NotificationPrefs.of(request.user.id)),
                "devices": PushSubscription.objects.filter(user=request.user).count(),
            }
        )

    def patch(self, request):
        prefs = NotificationPrefs.of(request.user.id)
        for field in NotificationPrefs.FIELDS:
            if isinstance(request.data.get(field), bool):
                setattr(prefs, field, request.data[field])
        prefs.save()
        return Response({"prefs": _prefs_payload(prefs)})


class SubscribeView(APIView):
    def post(self, request):
        s = SubscriptionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        endpoint = s.validated_data["endpoint"]
        keys = s.validated_data["keys"]
        PushSubscription.objects.update_or_create(
            endpoint_hash=PushSubscription.hash_endpoint(endpoint),
            defaults={
                "user": request.user,  # a shared browser moves to whoever signed in last
                "endpoint": endpoint,
                "p256dh": keys["p256dh"],
                "auth": keys["auth"],
                "user_agent": request.headers.get("User-Agent", "")[:200],
                "failures": 0,
            },
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class UnsubscribeView(APIView):
    def post(self, request):
        endpoint = request.data.get("endpoint")
        if isinstance(endpoint, str):
            PushSubscription.objects.filter(
                endpoint_hash=PushSubscription.hash_endpoint(endpoint), user=request.user
            ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
