from django.contrib import admin
from django.utils import timezone

from .models import Block, Message, Report, Room


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
    list_display = ("id", "reason", "reported_user", "reporter", "status", "created_at")
    list_filter = ("status", "reason")
    raw_id_fields = ("reporter", "reported_user", "message")


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ("blocker", "blocked", "created_at")
    raw_id_fields = ("blocker", "blocked")
