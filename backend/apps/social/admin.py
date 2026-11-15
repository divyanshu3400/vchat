from django.contrib import admin

from .models import Conversation, DirectMessage, FriendRequest, Friendship


@admin.register(FriendRequest)
class FriendRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "from_user", "to_user", "status", "created_at")
    list_filter = ("status",)
    raw_id_fields = ("from_user", "to_user")


@admin.register(Friendship)
class FriendshipAdmin(admin.ModelAdmin):
    list_display = ("user_a", "user_b", "created_at")
    raw_id_fields = ("user_a", "user_b")


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "user_a", "user_b", "last_message_at")
    raw_id_fields = ("user_a", "user_b")


@admin.register(DirectMessage)
class DirectMessageAdmin(admin.ModelAdmin):
    # Private messages: visible to admins for abuse reports only. Restrict this permission to moderators.
    list_display = ("id", "conversation", "sender", "created_at", "deleted_at")
    raw_id_fields = ("conversation", "sender")
