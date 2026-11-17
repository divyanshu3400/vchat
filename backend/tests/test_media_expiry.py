"""Chat media files are deleted after MEDIA_KEEP_DAYS (3) so the disk doesn't fill up. The message
stays and shows "expired"; a reported random chat keeps its files as evidence."""

from datetime import timedelta

import pytest
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.utils import timezone

from apps.chat.models import Report
from apps.media.models import Attachment
from apps.media.services import payload, signed_url
from apps.social import services as social
from apps.social.models import DirectMessage, Friendship, ordered_pair
from apps.stranger.models import StrangerMessage, StrangerSession

from .conftest import auth_client, make_member


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


def photo(owner, days_old: float) -> Attachment:
    a = Attachment(owner=owner, kind="image", mime="image/jpeg", size=2048, created_at=timezone.now() - timedelta(days=days_old), used_at=timezone.now() - timedelta(days=days_old))
    a.file.save("upload", ContentFile(b"\xff\xd8\xff" + b"x" * 2045), save=False)
    a.save()
    return a


@pytest.mark.django_db
def test_files_older_than_3_days_are_deleted_and_messages_stay(alice, bob):
    x, y = ordered_pair(alice.id, bob.id)
    Friendship.objects.create(user_a_id=x, user_b_id=y)
    old, fresh = photo(alice, 4), photo(alice, 1)
    old_path, fresh_path = old.file.path, fresh.file.path
    for a in (old, fresh):
        msg = DirectMessage.objects.create(conversation=social._conversation(alice.id, bob.id) or social.Conversation.objects.create(user_a_id=x, user_b_id=y), sender=alice, attachment=a)
    old_link = signed_url(old)

    call_command("purge_old_data")

    old.refresh_from_db()
    fresh.refresh_from_db()
    assert not old.file and fresh.file  # only the old file went
    import os

    assert not os.path.exists(old_path) and os.path.exists(fresh_path)
    assert DirectMessage.objects.filter(attachment=old).exists()  # the message is still there
    assert payload(old)["expired"] is True and payload(old)["url"] == ""
    assert "expired" not in payload(fresh)
    assert auth_client(bob).get(old_link).status_code == 404  # old links stop working


@pytest.mark.django_db
def test_reported_random_chat_keeps_its_files(alice, bob):
    session = StrangerSession.objects.create(user_a=alice, user_b=bob, ended_at=timezone.now() - timedelta(days=1))
    kept = photo(alice, 5)
    StrangerMessage.objects.create(session=session, sender=alice, attachment=kept)
    Report.objects.create(reporter=bob, reported_user=alice, stranger_session=session, reason="sexual")
    call_command("purge_old_data")
    kept.refresh_from_db()
    assert kept.file


@pytest.mark.django_db
def test_days_come_from_settings(alice, bob, settings):
    settings.VCHAT = {**settings.VCHAT, "MEDIA_KEEP_DAYS": 7}
    session = StrangerSession.objects.create(user_a=alice, user_b=bob)
    a = photo(alice, 5)
    StrangerMessage.objects.create(session=session, sender=alice, attachment=a)
    call_command("purge_old_data")
    a.refresh_from_db()
    assert a.file  # 5 days old, the limit is 7
