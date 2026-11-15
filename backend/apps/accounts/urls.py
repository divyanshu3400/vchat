from django.urls import path

from . import views

urlpatterns = [
    path("guest/", views.GuestSignupView.as_view(), name="guest-signup"),
    path("refresh/", views.CookieRefreshView.as_view(), name="token-refresh"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("me/", views.MeView.as_view(), name="me"),
    path("account/start/", views.AccountStartView.as_view(), name="account-start"),
    path("account/verify/", views.AccountVerifyView.as_view(), name="account-verify"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("password/forgot/", views.ForgotPasswordView.as_view(), name="password-forgot"),
    path("password/reset/", views.ResetPasswordView.as_view(), name="password-reset"),
]
