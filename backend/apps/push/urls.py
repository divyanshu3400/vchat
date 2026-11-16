from django.urls import path

from . import views

urlpatterns = [
    path("push/", views.PushView.as_view(), name="push"),
    path("push/subscribe/", views.SubscribeView.as_view(), name="push-subscribe"),
    path("push/unsubscribe/", views.UnsubscribeView.as_view(), name="push-unsubscribe"),
]
