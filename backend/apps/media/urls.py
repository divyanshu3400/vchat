from django.urls import path

from . import views

urlpatterns = [
    path("media/", views.UploadView.as_view(), name="media-upload"),
    path("media/f/<str:token>/", views.media_file, name="media-file"),
]
