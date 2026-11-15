from django.urls import path

from . import views

urlpatterns = [
    path("calls/ice/", views.IceServersView.as_view(), name="calls-ice"),
]
