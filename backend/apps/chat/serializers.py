from rest_framework import serializers

from .models import Report, Room


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = ["slug", "name", "kind", "description", "timezone", "slow_mode_seconds"]


class ReportCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ["id", "reported_user", "message", "stranger_session", "reason", "note"]

    def validate(self, attrs):
        me = self.context["request"].user
        if attrs["reported_user"] == me:
            raise serializers.ValidationError("You can't report yourself.")
        message = attrs.get("message")
        if message and message.sender_id != attrs["reported_user"].id:
            raise serializers.ValidationError("That message wasn't sent by this user.")
        session = attrs.get("stranger_session")
        if session and not (session.has_user(me.id) and session.has_user(attrs["reported_user"].id)):
            raise serializers.ValidationError("You can only report someone from your own chat with them.")
        return attrs
