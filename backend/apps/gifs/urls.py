from django.urls import path

from . import views

urlpatterns = [
    path("gifs/", views.GifBrowseView.as_view(), name="gifs"),
]
