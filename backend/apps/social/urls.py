from django.urls import path

from . import views

urlpatterns = [
    path("friends/", views.FriendListView.as_view(), name="friend-list"),
    path("friends/online/", views.FriendsOnlineView.as_view(), name="friends-online"),
    path("friends/requests/", views.FriendRequestListView.as_view(), name="friend-requests"),
    path(
        "friends/requests/<int:request_id>/<str:action>/",
        views.FriendRequestActionView.as_view(),
        name="friend-request-action",
    ),
    path("friends/<int:user_id>/", views.FriendDetailView.as_view(), name="friend-detail"),
    path("dms/", views.ConversationListView.as_view(), name="dm-list"),
    path("dms/<int:user_id>/messages/", views.DmMessagesView.as_view(), name="dm-messages"),
    path("dms/<int:user_id>/read/", views.DmReadView.as_view(), name="dm-read"),
    path("dms/<int:user_id>/prefs/", views.DmPrefsView.as_view(), name="dm-prefs"),
]
