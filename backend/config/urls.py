from django.contrib import admin
from django.urls import include, path

from .health import health

urlpatterns = [
    path("api/health/", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.chat.urls")),
    path("api/", include("apps.social.urls")),
    path("api/", include("apps.premium.urls")),
    path("api/", include("apps.media.urls")),
    path("api/", include("apps.calls.urls")),
    path("api/", include("apps.support.urls")),
]
