from django.conf import settings
from django.core.mail import EmailMessage
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import ContactMessage


class ContactSerializer(serializers.Serializer):
    topic = serializers.ChoiceField(choices=ContactMessage.Topic.choices)
    name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    email = serializers.EmailField(max_length=254)
    message = serializers.CharField(min_length=10, max_length=4000)
    # A field people never see; bots fill it in.
    website = serializers.CharField(required=False, allow_blank=True)


class OptionalJWT(JWTAuthentication):
    """Signed in: remember who wrote. Not signed in, or an expired token: still fine."""

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except Exception:
            return None


class ContactView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [OptionalJWT]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "contact"

    def post(self, request):
        s = ContactSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        if data.get("website"):
            return Response(status=status.HTTP_202_ACCEPTED)  # a bot: say thanks, keep nothing
        user = request.user if request.user and request.user.is_authenticated else None
        row = ContactMessage.objects.create(
            topic=data["topic"], name=data.get("name", ""), email=data["email"].lower(), message=data["message"], user=user
        )
        if settings.EMAIL_ENABLED:
            who = f"{row.name} <{row.email}>" if row.name else row.email
            account = f"vChat user #{user.id} ({user.nickname})" if user else "not signed in"
            body = f"From: {who}\nTopic: {row.get_topic_display()}\nAccount: {account}\n\n{row.message}\n"
            try:
                EmailMessage(
                    f"[vChat contact] {row.get_topic_display()}",
                    body,
                    None,
                    [settings.SUPPORT_EMAIL],
                    reply_to=[row.email],
                ).send()
                ContactMessage.objects.filter(pk=row.pk).update(emailed=True)
            except Exception:
                pass  # kept in the admin either way
        return Response({"detail": "Thanks. We'll reply by email."}, status=status.HTTP_202_ACCEPTED)
