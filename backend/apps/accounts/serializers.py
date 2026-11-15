import re

from rest_framework import serializers

from .models import User

NICKNAME_RE = re.compile(r"^[A-Za-z0-9_.]{3,18}$")
RESERVED = {"admin", "administrator", "mod", "moderator", "vchat", "support", "system", "staff"}


class GuestSignupSerializer(serializers.Serializer):
    nickname = serializers.CharField(max_length=18, trim_whitespace=True)
    gender = serializers.ChoiceField(choices=User.Gender.choices, required=False, allow_blank=True)
    age_confirmed = serializers.BooleanField()

    def validate_nickname(self, value: str) -> str:
        if not NICKNAME_RE.match(value):
            raise serializers.ValidationError(
                "Use 3 to 18 letters, numbers, dots or underscores."
            )
        if value.lower().strip("._") in RESERVED:
            raise serializers.ValidationError("That nickname is reserved. Pick another.")
        return value

    def validate_age_confirmed(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("You must be 18 or older to use vChat.")
        return value


class PublicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "nickname", "gender", "is_guest"]
        read_only_fields = fields


class MeSerializer(serializers.ModelSerializer):
    """You, as you see yourself: with your email. Never sent about anyone else."""

    class Meta:
        model = User
        fields = ["id", "nickname", "gender", "is_guest", "email"]
        read_only_fields = fields


class EmailField(serializers.EmailField):
    def to_internal_value(self, data):
        return super().to_internal_value(data).strip().lower()


class EmailPasswordSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class EmailCodeSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    code = serializers.CharField(max_length=12)


class EmailOnlySerializer(serializers.Serializer):
    email = EmailField(max_length=254)


class ResetSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    code = serializers.CharField(max_length=12)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
