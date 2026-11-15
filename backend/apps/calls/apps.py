from django.apps import AppConfig


class CallsConfig(AppConfig):
    """Voice and video calls: WebRTC signaling on the personal socket, plus TURN credentials."""

    name = "apps.calls"
    label = "calls"
