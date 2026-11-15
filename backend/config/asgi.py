import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.asgi import get_asgi_application  # noqa: E402

# Initialise Django before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from apps.chat.routing import websocket_urlpatterns as chat_ws  # noqa: E402
from apps.social.routing import websocket_urlpatterns as social_ws  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # Rejects WebSocket handshakes from origins not in ALLOWED_HOSTS.
        # Auth happens inside the socket (first message), never via the URL.
        "websocket": AllowedHostsOriginValidator(URLRouter(chat_ws + social_ws)),
    }
)
