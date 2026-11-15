from datetime import timedelta

from django.contrib import admin
from django.utils import timezone
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class VChatUserAdmin(UserAdmin):
    list_display = ("nickname", "username", "gender", "is_guest", "plus_until", "is_active", "date_joined")
    list_filter = ("is_guest", "is_active", "gender", "is_staff")
    search_fields = ("nickname", "username", "email")
    fieldsets = UserAdmin.fieldsets + (
        ("vChat", {"fields": ("nickname", "gender", "is_guest", "age_confirmed_at", "plus_until")}),
    )
    actions = ["give_plus_30_days", "end_plus"]

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
