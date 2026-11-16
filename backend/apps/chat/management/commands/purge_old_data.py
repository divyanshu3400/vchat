"""Deletes what the privacy policy says we don't keep. Run daily (cron): `manage.py purge_old_data`.

  messages (rooms, friends, random chats) .. 1 year, unless a report from the last 2 years needs them
  photos, videos, voice messages ........... 1 year; uploads never sent ......... 1 day
  reports, contact messages ................ 2 years
  email codes .............................. 2 days; expired ban marks ........ 30 days
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import BanMark, EmailCode
from apps.chat.models import Message, Report
from apps.media.models import Attachment
from apps.social.models import DirectMessage
from apps.stranger.models import StrangerSession
from apps.support.models import ContactMessage

MESSAGES = timedelta(days=365)
MEDIA = timedelta(days=365)
UNSENT_UPLOADS = timedelta(days=1)
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
        self.purge("friend messages", DirectMessage.objects.filter(created_at__lt=now - MESSAGES))
        reported_sessions = Report.objects.filter(stranger_session__isnull=False).values("stranger_session_id")
        self.purge(
            "random chats",
            StrangerSession.objects.filter(started_at__lt=now - MESSAGES).exclude(id__in=reported_sessions),
        )

        old_files = Attachment.objects.filter(
            Q(created_at__lt=now - MEDIA) | Q(used_at__isnull=True, created_at__lt=now - UNSENT_UPLOADS)
        )
        count = old_files.count()
        if not dry_run:
            for a in old_files.iterator():
                a.file.delete(save=False)
                a.delete()
        self.report("files", count)

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
