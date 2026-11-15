from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse


def health(request):
    """Liveness + readiness for Docker and the proxies: the database and Redis must answer."""
    checks = {}
    try:
        connection.ensure_connection()
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001 - report, never raise, from a health check
        checks["database"] = "down"
    try:
        cache.set("health:ping", "1", 5)
        checks["cache"] = "ok" if cache.get("health:ping") == "1" else "down"
    except Exception:  # noqa: BLE001
        checks["cache"] = "down"
    healthy = all(v == "ok" for v in checks.values())
    return JsonResponse({"status": "ok" if healthy else "degraded", **checks}, status=200 if healthy else 503)
