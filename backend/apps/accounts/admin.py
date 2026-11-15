from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class VChatUserAdmin(UserAdmin):
    list_display = ("nickname", "username", "gender", "is_guest", "is_active", "date_joined")
    list_filter = ("is_guest", "is_active", "gender", "is_staff")
    search_fields = ("nickname", "username", "email")
    fieldsets = UserAdmin.fieldsets + (
        ("vChat", {"fields": ("nickname", "gender", "is_guest", "age_confirmed_at")}),
    )
