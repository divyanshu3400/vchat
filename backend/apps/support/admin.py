from django.contrib import admin

from .models import ContactMessage


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ("created_at", "topic", "email", "short", "emailed", "handled")
    list_filter = ("topic", "handled", "emailed")
    list_editable = ("handled",)
    search_fields = ("email", "name", "message")
    raw_id_fields = ("user",)
    readonly_fields = ("topic", "name", "email", "message", "user", "emailed", "created_at")

    @admin.display(description="Message")
    def short(self, obj):
        return obj.message[:80]
