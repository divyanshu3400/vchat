"""Every account gets a unique @username: the sign-up name, lowercased (name_2, name_3… if taken)."""

import re

from django.db import migrations

HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_.]{1,18}[a-z0-9_]$")


def backfill(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    taken = set(User.objects.exclude(handle__isnull=True).values_list("handle", flat=True))
    taken |= set(User.objects.exclude(previous_handle="").values_list("previous_handle", flat=True))
    for user in User.objects.filter(handle__isnull=True, deleted_at__isnull=True).exclude(nickname="").order_by("id"):
        base = re.sub(r"[^a-z0-9_.]", "", user.nickname.lower()).strip(".").replace("..", ".")[:16]
        if len(base) < 3 or not HANDLE_RE.match(base):
            base = f"user{user.pk}"
        handle, n = base, 1
        while handle in taken:
            n += 1
            handle = f"{base}_{n}"
        taken.add(handle)
        User.objects.filter(pk=user.pk).update(handle=handle)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0009_profile_handle_avatar")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
