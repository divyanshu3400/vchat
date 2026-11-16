from django.urls import path

from . import views

urlpatterns = [
    path("media/", views.UploadView.as_view(), name="media-upload"),
    path("media/f/<str:token>/", views.media_file, name="media-file"),
    path("media/<uuid:pk>/open/", views.OpenTimedView.as_view(), name="media-open"),
    path("media/t/<str:token>/", views.timed_file, name="media-timed"),
    path("media/staff/<uuid:pk>/", views.staff_file, name="media-staff"),
]
