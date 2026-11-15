import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone


class User(AbstractUser):
    """Every chatter is a User. Guests get a random username and no password. A guest saves
    the account by verifying an email and choosing a password; it stays the same row (same
    nickname, friends and chats) and can then log in on any device."""

    class Gender(models.TextChoices):
        MALE = "M", "Male"
        FEMALE = "F", "Female"
        OTHER = "O", "Other"

    nickname = models.CharField(max_length=18)
    gender = models.CharField(max_length=1, choices=Gender.choices, blank=True)
    is_guest = models.BooleanField(default=True)
    age_confirmed_at = models.DateTimeField(null=True, blank=True)
    # vChat Plus is active until this moment (no ads, all filters). Set by payments or an admin.
    plus_until = models.DateTimeField(null=True, blank=True)
    # Bumped when the password is reset: every session signed in before that stops refreshing.
    session_version = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            # One account per email, whatever the capitals. Guests have no email.
            models.UniqueConstraint(Lower("email"), condition=~Q(email=""), name="uniq_user_email_ci"),
        ]

    @property
    def is_plus(self) -> bool:
        return self.plus_until is not None and self.plus_until > timezone.now()

    @classmethod
    def create_guest(cls, *, nickname: str, gender: str = "") -> "User":
        user = cls(
            username=f"g_{secrets.token_hex(8)}",
            nickname=nickname,
            gender=gender,
            is_guest=True,
            age_confirmed_at=timezone.now(),
        )
        user.set_unusable_password()
        user.save()
        return user

    def __str__(self) -> str:
        return f"{self.nickname} ({self.username})"


class EmailCode(models.Model):
    """A 6-digit code sent by email. Only its hash is stored. One live code per email and purpose."""

    class Purpose(models.TextChoices):
        VERIFY = "verify", "Verify email (save a guest account)"
        RESET = "reset", "Reset password"

    email = models.EmailField()
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    purpose = models.CharField(max_length=10, choices=Purpose.choices)
    code_hash = models.CharField(max_length=64)
    # VERIFY: the password the guest chose, already hashed; it is set when the code is right.
    password_hash = models.CharField(max_length=128, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["email", "purpose", "-created_at"], name="email_code_lookup")]
