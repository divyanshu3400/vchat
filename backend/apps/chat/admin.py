from datetime import timedelta

from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html, format_html_join

from apps.accounts import moderation

from .models import Block, Message, Report, Room

CONTEXT_MESSAGES = 12


def _report_ban(days, label):
    @admin.action(description=label)
    def action(modeladmin, request, queryset):
        for report in queryset.select_related("reported_user"):
            moderation.ban(report.reported_user, timedelta(days=days) if days else None, report.get_reason_display())
            Report.objects.filter(reported_user=report.reported_user, status=Report.Status.OPEN).update(
                status=Report.Status.ACTIONED
            )
        modeladmin.message_user(request, f"Banned the reported account(s) of {queryset.count()} report(s).")

    action.__name__ = f"ban_reported_{days or 'forever'}"
    return action


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "kind", "timezone", "slow_mode_seconds", "is_active", "sort_order")
    list_filter = ("kind", "is_active")
    list_editable = ("slow_mode_seconds", "is_active", "sort_order")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "sender", "short", "created_at", "deleted_at")
    list_filter = ("room",)
    search_fields = ("content", "sender__nickname")
    raw_id_fields = ("sender",)
    actions = ["soft_delete"]

    @admin.display(description="Message")
    def short(self, obj):
        return obj.content[:80]

    @admin.action(description="Hide selected messages")
    def soft_delete(self, request, queryset):
        queryset.update(deleted_at=timezone.now())


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """The moderation queue: open reports first, with the conversation they came from."""

    list_display = ("id", "created_at", "reason", "reported_user", "times_reported", "reporter", "where", "status")
    list_filter = ("status", "reason")
    list_select_related = ("reported_user", "reporter", "message__room")
    search_fields = ("reported_user__nickname", "reporter__nickname", "note")
    raw_id_fields = ("reporter", "reported_user", "message", "stranger_session")
    readonly_fields = ("reported_account", "conversation")
    fields = ("status", "reason", "note", "reported_account", "conversation", "reporter", "reported_user", "message", "stranger_session")
    actions = [
        _report_ban(1, "Ban the reported user for 24 hours"),
        _report_ban(7, "Ban the reported user for 7 days"),
        _report_ban(None, "Ban the reported user permanently"),
        "dismiss",
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).order_by("status", "-created_at")

    @admin.display(description="Where")
    def where(self, obj):
        if obj.stranger_session_id:
            return "Random chat"
        if obj.message_id:
            return f"# {obj.message.room.name}"
        return "-"

    @admin.display(description="Reports in 30 days")
    def times_reported(self, obj):
        since = timezone.now() - timedelta(days=30)
        return Report.objects.filter(reported_user=obj.reported_user, created_at__gte=since).count()

    @admin.display(description="Reported account")
    def reported_account(self, obj):
        u = obj.reported_user
        state = f"banned until {u.banned_until:%d %b %Y}" if u.is_banned else "not banned"
        kind = "guest" if u.is_guest else "saved account"
        return format_html("<b>{}</b> (#{}, {}, {})", u.nickname, u.pk, kind, state)

    @admin.display(description="Conversation")
    def conversation(self, obj):
        rows = []
        if obj.stranger_session_id:
            from apps.stranger.models import StrangerMessage

            for m in StrangerMessage.objects.filter(session_id=obj.stranger_session_id).select_related("sender").order_by("id")[:300]:
                rows.append((m, m.sender_id == obj.reported_user_id))
        elif obj.message_id:
            around = Message.objects.filter(room_id=obj.message.room_id).select_related("sender")
            before = list(around.filter(id__lte=obj.message_id).order_by("-id")[: CONTEXT_MESSAGES + 1])[::-1]
            after = list(around.filter(id__gt=obj.message_id).order_by("id")[:CONTEXT_MESSAGES])
            rows = [(m, m.sender_id == obj.reported_user_id) for m in before + after]
        if not rows:
            return "No messages attached."

        def line(m, theirs):
            deleted = " (deleted)" if getattr(m, "deleted_at", None) else ""
            attachment = f" [{m.attachment.kind}]" if getattr(m, "attachment_id", None) else ""
            weight = "700" if theirs else "400"
            mark = "background:#fff4c2;" if obj.message_id == m.id else ""
            return (mark, weight, f"{m.created_at:%d %b %H:%M}", m.sender.nickname, f"{m.content}{attachment}{deleted}")

        return format_html(
            "<div style='max-height:420px;overflow:auto;font-family:monospace;font-size:13px'>{}</div>",
            format_html_join(
                "",
                "<div style='{}padding:2px 4px;font-weight:{}'>{} &lt;{}&gt; {}</div>",
                (line(m, theirs) for m, theirs in rows),
            ),
        )

    @admin.action(description="Dismiss (no action needed)")
    def dismiss(self, request, queryset):
        queryset.update(status=Report.Status.DISMISSED)


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ("blocker", "blocked", "created_at")
    raw_id_fields = ("blocker", "blocked")
