from django.urls import path

from . import views

urlpatterns = [
    path("premium/status/", views.PremiumStatusView.as_view(), name="premium-status"),
    path("premium/reward/", views.RewardView.as_view(), name="premium-reward"),
]
