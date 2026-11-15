from django.urls import path

from .consumers import RoomConsumer

websocket_urlpatterns = [
    path("ws/rooms/<slug:slug>/", RoomConsumer.as_asgi()),
]
