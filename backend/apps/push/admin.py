from django.contrib import admin

from .models import NotificationPrefs, PushSubscription


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "user_agent", "created_at", "last_ok_at", "failures")
    raw_id_fields = ("user",)
    readonly_fields = ("endpoint", "endpoint_hash", "p256dh", "auth")


@admin.register(NotificationPrefs)
class NotificationPrefsAdmin(admin.ModelAdmin):
    list_display = ("user", "messages", "requests", "calls", "preview")
    raw_id_fields = ("user",)
