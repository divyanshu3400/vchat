from django.contrib import admin

from .models import RewardGrant


@admin.register(RewardGrant)
class RewardGrantAdmin(admin.ModelAdmin):
    list_display = ("user", "kind", "uses_left", "expires_at", "created_at")
    list_filter = ("kind",)
    raw_id_fields = ("user",)
