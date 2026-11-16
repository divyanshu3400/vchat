import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.conf import settings
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
    # --- profile ---
    # Public @username: unique, lowercase. Saved accounts only; changeable every 14 days.
    handle = models.CharField(max_length=20, null=True, blank=True, unique=True)
    handle_changed_at = models.DateTimeField(null=True, blank=True)
    # The handle given up last; nobody else can take it for 14 days (no impersonating friends).
    previous_handle = models.CharField(max_length=20, blank=True, db_index=True)
    # Profile photo (square JPEG, no metadata). Only friends get a link to it.
    avatar = models.FileField(upload_to="avatars/", blank=True, max_length=200)
    avatar_version = models.PositiveIntegerField(default=0)
    gender = models.CharField(max_length=1, choices=Gender.choices, blank=True)
    is_guest = models.BooleanField(default=True)
    age_confirmed_at = models.DateTimeField(null=True, blank=True)
    # vChat Plus is active until this moment (no ads, all filters). Set by payments or an admin.
    plus_until = models.DateTimeField(null=True, blank=True)
    # Bumped when the password is reset: every session signed in before that stops refreshing.
    session_version = models.PositiveIntegerField(default=0)

    # --- moderation ---
    banned_until = models.DateTimeField(null=True, blank=True)
    ban_reason = models.CharField(max_length=200, blank=True)
    # Several reports in a short time: out of random chat until then (or until a moderator clears it).
    random_blocked_until = models.DateTimeField(null=True, blank=True)
    # Hashes (never the raw values) of this browser's device cookie and the last IP, for ban evasion.
    device_hash = models.CharField(max_length=64, blank=True, db_index=True)
    last_ip_hash = models.CharField(max_length=64, blank=True)

    # --- last seen ---
    # When the last tab closed (updated while connected, too). Shown to friends only when both
    # people allow it: hiding yours hides everyone's from you, like WhatsApp.
    last_seen_at = models.DateTimeField(null=True, blank=True)
    show_last_seen = models.BooleanField(default=True)
    # Same give-and-take rules: hide your "online" and you see nobody online; turn off read
    # receipts and you see nobody's "Seen" either.
    show_online = models.BooleanField(default=True)
    read_receipts = models.BooleanField(default=True)
    # Others can find this account by name (Chats search) and send a message request.
    discoverable = models.BooleanField(default=True)

    # --- closing the account (apps/accounts/closing.py) ---
    # Set while deactivated (is_active is False then): others see "vChat user" and "********".
    deactivated_at = models.DateTimeField(null=True, blank=True)
    # Deletion asked for: erased after this moment unless the person logs in before it.
    delete_after = models.DateTimeField(null=True, blank=True, db_index=True)
    # Erased: no email, password or name any more. The row stays so old messages keep their place.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            # One account per email, whatever the capitals. Guests have no email.
            models.UniqueConstraint(Lower("email"), condition=~Q(email=""), name="uniq_user_email_ci"),
        ]

    @property
    def is_banned(self) -> bool:
        return self.banned_until is not None and self.banned_until > timezone.now()

    @property
    def is_plus(self) -> bool:
        if settings.VCHAT.get("FREE_FOR_ALL"):
            return True  # launch phase: everything is free
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


class BanMark(models.Model):
    """Stops a banned person from coming back as a new guest: their device cookie (for the length of
    the ban) and IP (at most a day, since mobile networks share IPs). Values are HMAC hashes."""

    class Kind(models.TextChoices):
        DEVICE = "device", "Device"
        IP = "ip", "IP address"

    kind = models.CharField(max_length=6, choices=Kind.choices)
    value_hash = models.CharField(max_length=64)
    until = models.DateTimeField()
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="ban_marks")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["value_hash", "until"], name="banmark_lookup")]


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
