from django.urls import path

from . import views

urlpatterns = [
    path("rooms/", views.RoomListView.as_view(), name="room-list"),
    path("rooms/presence/", views.RoomPresenceView.as_view(), name="room-presence"),
    path("rooms/<slug:slug>/messages/", views.RoomMessagesView.as_view(), name="room-messages"),
    path("users/<int:user_id>/block/", views.BlockView.as_view(), name="user-block"),
    path("reports/", views.ReportCreateView.as_view(), name="report-create"),
]
