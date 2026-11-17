"""Deletes what the privacy policy says we don't keep. Run hourly (cron): `manage.py purge_old_data`.

  friend chats ............................. after each chat's auto-delete setting (1 day to 1 year)
  random chats ............................. 7 days after they end, unless someone reported them
  room messages ............................ 1 year, unless a report from the last 2 years needs them
  photos, videos, voice messages ........... file deleted after MEDIA_KEEP_DAYS (3 days); the message stays
                                             and shows "expired". Unsent uploads: 1 day. A reported random
                                             chat keeps its files as evidence until the chat itself goes.
  reports, contact messages ................ 2 years
  email codes .............................. 2 days; expired ban marks ........ 30 days
  accounts asked to be deleted ............. erased 15 days later, unless they logged in again
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.accounts import closing
from apps.accounts.models import BanMark, EmailCode, User
from apps.chat.models import Message, Report
from apps.media.models import Attachment
from apps.social.models import Conversation, DirectMessage
from apps.stranger.models import StrangerSession
from apps.support.models import ContactMessage

MESSAGES = timedelta(days=365)
RANDOM_CHATS = timedelta(days=7)
MEDIA = timedelta(days=365)
UNSENT_UPLOADS = timedelta(days=1)
TIMED_MEDIA = timedelta(days=30)
REPORTS = timedelta(days=730)


class Command(BaseCommand):
    help = "Delete messages, files, reports and codes older than the privacy policy allows."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only count what would be deleted.")

    def handle(self, *args, dry_run=False, **options):
        now = timezone.now()
        self.dry = dry_run

        self.purge("reports", Report.objects.filter(created_at__lt=now - REPORTS))
        self.purge("contact messages", ContactMessage.objects.filter(created_at__lt=now - REPORTS))

        # Messages a recent report points to stay as evidence until the report itself expires.
        reported_rooms = Report.objects.filter(message__isnull=False).values("message_id")
        self.purge("room messages", Message.objects.filter(created_at__lt=now - MESSAGES).exclude(id__in=reported_rooms))
        for days in Conversation.AUTO_DELETE_CHOICES:
            self.purge(
                f"friend messages ({days}-day chats)",
                DirectMessage.objects.filter(conversation__auto_delete_days=days, created_at__lt=now - timedelta(days=days)),
            )
        self.purge(
            "friend messages (other settings)",
            DirectMessage.objects.exclude(conversation__auto_delete_days__in=Conversation.AUTO_DELETE_CHOICES).filter(
                created_at__lt=now - MESSAGES
            ),
        )
        reported_sessions = Report.objects.filter(stranger_session__isnull=False).values("stranger_session_id")
        self.purge(
            "random chats",
            StrangerSession.objects.filter(
                Q(ended_at__lt=now - RANDOM_CHATS) | Q(ended_at__isnull=True, started_at__lt=now - RANDOM_CHATS)
            ).exclude(id__in=reported_sessions),
        )

        # Disappearing media is kept (hidden) 30 days for reports, even after its message is gone.
        kept_for_reports = Q(created_at__gte=now - TIMED_MEDIA) & ~Q(view_mode="")
        old_files = Attachment.objects.filter(
            Q(created_at__lt=now - MEDIA)
            | Q(used_at__isnull=True, created_at__lt=now - UNSENT_UPLOADS)
            # sent, but its message is gone (auto-deleted, or the random chat expired)
            | (Q(used_at__isnull=False, dm_message__isnull=True, stranger_message__isnull=True) & ~kept_for_reports)
        )
        count = old_files.count()
        if not dry_run:
            for a in old_files.iterator():
                a.file.delete(save=False)
                a.delete()
        self.report("files", count)

        # Sent files go after MEDIA_KEEP_DAYS to keep the disk from filling up. The message and the
        # attachment row stay (the chat shows "expired"); only the file is deleted. A reported random
        # chat keeps its files as evidence until the chat itself is purged.
        keep = timedelta(days=settings.VCHAT["MEDIA_KEEP_DAYS"])
        expired = (
            Attachment.objects.exclude(file="")
            .filter(used_at__isnull=False, created_at__lt=now - keep)
            .exclude(stranger_message__session_id__in=reported_sessions)
        )
        count = expired.count()
        freed = sum(expired.values_list("size", flat=True)) if count else 0
        if not dry_run:
            for a in expired.iterator():
                a.file.delete(save=False)
                Attachment.objects.filter(pk=a.pk).update(file="")
        self.report(f"media files older than {keep.days} days ({freed / 1_048_576:.1f} MB)", count)

        if dry_run:
            self.report("accounts", User.objects.filter(delete_after__lte=now, deleted_at__isnull=True).count())
        else:
            self.report("accounts", closing.erase_due(now))

        self.purge("email codes", EmailCode.objects.filter(created_at__lt=now - timedelta(days=2)))
        self.purge("expired ban marks", BanMark.objects.filter(until__lt=now - timedelta(days=30)))

    def purge(self, label, qs):
        count = qs.count()
        if not self.dry and count:
            qs.delete()
        self.report(label, count)

    def report(self, label, count):
        verb = "would delete" if self.dry else "deleted"
        self.stdout.write(f"{verb} {count} {label}")
