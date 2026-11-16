from django.urls import path

from . import views

urlpatterns = [
    path("rooms/", views.RoomListView.as_view(), name="room-list"),
    path("rooms/presence/", views.RoomPresenceView.as_view(), name="room-presence"),
    path("rooms/mine/", views.MyRoomsView.as_view(), name="rooms-mine"),
    path("rooms/invite/<str:code>/", views.InviteView.as_view(), name="room-invite"),
    path("rooms/c/<slug:slug>/", views.CustomRoomView.as_view(), name="room-custom"),
    path("rooms/c/<slug:slug>/leave/", views.CustomRoomLeaveView.as_view(), name="room-custom-leave"),
    path("rooms/c/<slug:slug>/members/", views.CustomRoomMembersView.as_view(), name="room-custom-members"),
    path("rooms/c/<slug:slug>/members/<int:user_id>/", views.CustomRoomMembersView.as_view(), name="room-custom-member"),
    path("rooms/<slug:slug>/messages/", views.RoomMessagesView.as_view(), name="room-messages"),
    path("users/<int:user_id>/block/", views.BlockView.as_view(), name="user-block"),
    path("reports/", views.ReportCreateView.as_view(), name="report-create"),
]
