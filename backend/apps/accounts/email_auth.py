"""Email codes for saving a guest account and for resetting a password.

A code is 6 digits, lives 10 minutes, allows 5 wrong tries, and only its HMAC is stored. Each
email gets at most 5 codes an hour and one per minute; asking again cancels the previous code.
"""

import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import EmailCode, User

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
RESEND_AFTER = timedelta(seconds=60)
PER_EMAIL_PER_HOUR = 5


class AccountError(Exception):
    def __init__(self, code: str, detail: str, status: int = 400):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status = status


def normalize(email: str) -> str:
    return email.strip().lower()


def _hash(email: str, code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def email_taken(email: str, exclude_user_id: int | None = None) -> bool:
    qs = User.objects.filter(email__iexact=email)
    if exclude_user_id is not None:
        qs = qs.exclude(id=exclude_user_id)
    return qs.exists()


def require_enabled() -> None:
    if not settings.EMAIL_ENABLED:
        raise AccountError("email_off", "Email accounts aren't switched on yet. Try again later.", 503)


SUBJECTS = {
    EmailCode.Purpose.VERIFY: "Your vChat code: {code}",
    EmailCode.Purpose.RESET: "Reset your vChat password: {code}",
}
BODIES = {
    EmailCode.Purpose.VERIFY: (
        "Hi {nickname},\n\nYour code to save your vChat account is:\n\n    {code}\n\n"
        "It works for 10 minutes. If you didn't ask for it, ignore this email.\n\n- vChat"
    ),
    EmailCode.Purpose.RESET: (
        "Hi {nickname},\n\nYour code to reset your vChat password is:\n\n    {code}\n\n"
        "It works for 10 minutes. If you didn't ask for it, ignore this email: "
        "your password stays the same.\n\n- vChat"
    ),
}


def send_code(email: str, purpose: str, user: User, password_hash: str = "") -> None:
    now = timezone.now()
    recent = EmailCode.objects.filter(email=email, created_at__gte=now - timedelta(hours=1))
    if recent.count() >= PER_EMAIL_PER_HOUR:
        raise AccountError("too_many_codes", "Too many codes for this email. Try again in an hour.", 429)
    last = recent.filter(purpose=purpose).order_by("-created_at").first()
    if last and now - last.created_at < RESEND_AFTER:
        raise AccountError("wait", "Wait a minute before asking for another code.", 429)

    code = f"{secrets.randbelow(10**6):06d}"
    EmailCode.objects.filter(email=email, purpose=purpose, used_at__isnull=True).update(used_at=now)
    row = EmailCode.objects.create(
        email=email, user=user, purpose=purpose, code_hash=_hash(email, code), password_hash=password_hash
    )
    try:
        send_mail(
            SUBJECTS[purpose].format(code=code),
            BODIES[purpose].format(code=code, nickname=user.nickname),
            None,
            [email],
        )
    except Exception:
        row.delete()
        raise AccountError("email_failed", "We couldn't send the email. Check the address or try again soon.", 503)


def check_code(email: str, purpose: str, code) -> EmailCode:
    """The live code for this email, if `code` matches. Each wrong try counts."""
    row = (
        EmailCode.objects.filter(
            email=email, purpose=purpose, used_at__isnull=True, created_at__gte=timezone.now() - CODE_TTL
        )
        .select_related("user")
        .order_by("-created_at")
        .first()
    )
    if row is None:
        raise AccountError("code_expired", "That code has expired. Ask for a new one.")
    if row.attempts >= MAX_ATTEMPTS:
        raise AccountError("code_expired", "Too many wrong tries. Ask for a new code.")
    code = str(code or "").strip()
    if not (len(code) == 6 and code.isdigit() and hmac.compare_digest(row.code_hash, _hash(email, code))):
        EmailCode.objects.filter(pk=row.pk).update(attempts=row.attempts + 1)
        left = MAX_ATTEMPTS - row.attempts - 1
        raise AccountError("wrong_code", f"That code isn't right. {left} tries left." if left else "That code isn't right.")
    EmailCode.objects.filter(pk=row.pk).update(used_at=timezone.now())
    return row
