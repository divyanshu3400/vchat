from datetime import timedelta

from django.contrib import admin
from django.utils import timezone
from django.contrib.auth.admin import UserAdmin

from . import moderation
from .models import BanMark, User


def _ban_action(days, label):
    @admin.action(description=label)
    def action(modeladmin, request, queryset):
        for user in queryset:
            moderation.ban(user, timedelta(days=days) if days else None, "Breaking the chat rules")
        modeladmin.message_user(request, f"Banned {queryset.count()} account(s).")

    action.__name__ = f"ban_{days or 'forever'}"
    return action


@admin.register(User)
class VChatUserAdmin(UserAdmin):
    list_display = ("nickname", "username", "gender", "is_guest", "plus_until", "banned_until", "date_joined")
    list_filter = ("is_guest", "is_active", "gender", "is_staff")
    search_fields = ("nickname", "username", "email")
    fieldsets = UserAdmin.fieldsets + (
        ("vChat", {"fields": ("nickname", "gender", "is_guest", "age_confirmed_at", "plus_until")}),
        ("Moderation", {"fields": ("banned_until", "ban_reason", "random_blocked_until")}),
    )
    actions = [
        "give_plus_30_days",
        "end_plus",
        _ban_action(1, "Ban for 24 hours"),
        _ban_action(7, "Ban for 7 days"),
        _ban_action(None, "Ban permanently"),
        "unban",
        "allow_random_chat",
    ]

    @admin.action(description="Lift the ban")
    def unban(self, request, queryset):
        for user in queryset:
            moderation.unban(user)

    @admin.action(description="Let them back into random chat now")
    def allow_random_chat(self, request, queryset):
        queryset.update(random_blocked_until=None)

    @admin.action(description="Give vChat Plus for 30 days (from now, or added to time left)")
    def give_plus_30_days(self, request, queryset):
        now = timezone.now()
        for user in queryset:
            start = user.plus_until if user.plus_until and user.plus_until > now else now
            user.plus_until = start + timedelta(days=30)
            user.save(update_fields=["plus_until"])

    @admin.action(description="End vChat Plus now")
    def end_plus(self, request, queryset):
        queryset.update(plus_until=None)


@admin.register(BanMark)
class BanMarkAdmin(admin.ModelAdmin):
    list_display = ("user", "kind", "until", "created_at")
    list_filter = ("kind",)
    raw_id_fields = ("user",)
    readonly_fields = ("kind", "value_hash", "user", "created_at")
