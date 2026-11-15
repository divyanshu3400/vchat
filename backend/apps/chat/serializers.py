from rest_framework import serializers

from .models import Report, Room


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = ["slug", "name", "kind", "description", "timezone", "slow_mode_seconds"]


class ReportCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ["id", "reported_user", "message", "reason", "note"]

    def validate(self, attrs):
        if attrs["reported_user"] == self.context["request"].user:
            raise serializers.ValidationError("You can't report yourself.")
        message = attrs.get("message")
        if message and message.sender_id != attrs["reported_user"].id:
            raise serializers.ValidationError("That message wasn't sent by this user.")
        return attrs
