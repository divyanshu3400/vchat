from django.contrib import admin

from .models import StrangerMessage, StrangerSession


class StrangerMessageInline(admin.TabularInline):
    model = StrangerMessage
    fields = ("created_at", "sender", "content")
    readonly_fields = fields
    extra = 0
    can_delete = False


@admin.register(StrangerSession)
class StrangerSessionAdmin(admin.ModelAdmin):
    # Private chats: open them to review a report, not to browse.
    list_display = ("id", "user_a", "user_b", "started_at", "ended_at", "ended_by")
    list_filter = ("started_at",)
    raw_id_fields = ("user_a", "user_b", "ended_by")
    inlines = [StrangerMessageInline]
