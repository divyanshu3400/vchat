import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    """Every chatter is a User. Guests get a random username and no password;
    later they can attach Google sign-in and keep the same row (and friends)."""

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
