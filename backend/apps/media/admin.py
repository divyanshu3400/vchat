from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import Attachment


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    """Read-only: moderators open files here when checking a report (disappearing ones too)."""

    list_display = ("id", "kind", "view_mode", "views", "owner", "created_at", "file_link")
    list_filter = ("kind", "view_mode")
    search_fields = ("id", "owner__nickname")
    readonly_fields = [f.name for f in Attachment._meta.fields] + ["file_link"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description="File")
    def file_link(self, obj):
        if not obj.file:
            return "deleted"
        return format_html('<a href="{}" target="_blank" rel="noopener">Open</a>', reverse("media-staff", kwargs={"pk": obj.pk}))
