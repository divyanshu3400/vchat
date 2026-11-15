from django.urls import path

from . import views

urlpatterns = [
    path("guest/", views.GuestSignupView.as_view(), name="guest-signup"),
    path("refresh/", views.CookieRefreshView.as_view(), name="token-refresh"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("me/", views.MeView.as_view(), name="me"),
]
