from rest_framework import serializers

from .models import User


class GuestSignupSerializer(serializers.Serializer):
    nickname = serializers.CharField(max_length=18, trim_whitespace=True)
    gender = serializers.ChoiceField(choices=User.Gender.choices, required=False, allow_blank=True)
    age_confirmed = serializers.BooleanField()

    def validate_nickname(self, value: str) -> str:
        from .names import name_problem

        problem = name_problem(value, 18)
        if problem:
            raise serializers.ValidationError(problem)
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
        fields = [
            "id", "nickname", "gender", "is_guest", "email", "show_last_seen", "show_online", "read_receipts", "discoverable",
            "handle", "avatar", "handle_next_change",
        ]
        read_only_fields = fields

    avatar = serializers.SerializerMethodField()
    handle_next_change = serializers.SerializerMethodField()

    def get_avatar(self, user):
        from .profile import avatar_url

        return avatar_url(user)

    def get_handle_next_change(self, user):
        from .profile import next_handle_change

        at = next_handle_change(user)
        return at.isoformat() if at else None


class EmailField(serializers.EmailField):
    def to_internal_value(self, data):
        return super().to_internal_value(data).strip().lower()


class EmailPasswordSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class EmailCodeSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    code = serializers.CharField(max_length=12)


class LoginSerializer(serializers.Serializer):
    """`login` is a @username or an email. (Old apps send `email`; it is read the same way.)"""

    login = serializers.CharField(max_length=254, required=False, trim_whitespace=True)
    email = serializers.CharField(max_length=254, required=False, trim_whitespace=True)
    password = serializers.CharField(max_length=128, trim_whitespace=False)

    def validate(self, attrs):
        value = (attrs.get("login") or attrs.get("email") or "").strip()
        if not value:
            raise serializers.ValidationError({"login": "Enter your username or email."})
        attrs["login"] = value
        return attrs


class UsernamePasswordSerializer(serializers.Serializer):
    # Optional: guests already have the @username they picked at sign-up.
    username = serializers.CharField(max_length=25, trim_whitespace=True, required=False, allow_blank=True)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class EmailOnlySerializer(serializers.Serializer):
    email = EmailField(max_length=254)


class ResetSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    code = serializers.CharField(max_length=12)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
