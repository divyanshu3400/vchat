from django.urls import path

from .consumers import UserConsumer

websocket_urlpatterns = [
    path("ws/me/", UserConsumer.as_asgi()),
]
