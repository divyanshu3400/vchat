"""vChat settings. Everything environment-specific comes from env vars (see .env.example)."""

import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
TESTING = "pytest" in sys.modules

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG or TESTING:
        SECRET_KEY = "dev-only-insecure-key-never-use-in-production-0000"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:3000")

INSTALLED_APPS = [
    "daphne",  # must be first: makes runserver serve ASGI (HTTP + WebSocket)
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "channels",
    "apps.accounts",
    "apps.chat",
    "apps.social",
    "apps.stranger",
    "apps.premium",
    "apps.media",
    "apps.calls",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# Postgres in every real environment; SQLite only as a zero-setup local fallback.
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        # 0 under ASGI: Django's persistent connections are per thread, and async code
        # hops threads, so reuse can leak connections. Raise only behind PgBouncer.
        conn_max_age=int(os.environ.get("DB_CONN_MAX_AGE", "0")),
        conn_health_checks=True,
    )
}

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Redis backs the channel layer (fan-out across servers), rate limits and presence.
# Without REDIS_URL everything stays in-process: fine for one dev server, wrong for production.
REDIS_URL = os.environ.get("REDIS_URL", "")


def redis_channel_layer(url: str) -> dict:
    """The channel layer waits for socket messages with a Redis read that blocks for 5 s
    (channels_redis brpop_timeout). redis-py 8 times out every read after 5 s by default, so
    an idle socket's wait failed and killed the socket every few seconds. The read timeout
    must stay well above the blocking wait."""
    return {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [
                {
                    "address": url,
                    "socket_timeout": 30,
                    "socket_connect_timeout": 5,
                    "socket_keepalive": True,
                    "health_check_interval": 30,
                }
            ]
        },
    }


if REDIS_URL and not TESTING:
    CHANNEL_LAYERS = {"default": redis_channel_layer(REDIS_URL)}
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}
else:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # Rate limits are per visitor IP. Behind the app nginx, X-Forwarded-For holds exactly the
    # visitor's address (nginx overwrites it), so trust one proxy hop. Unset in development.
    "NUM_PROXIES": int(os.environ["NUM_PROXIES"]) if os.environ.get("NUM_PROXIES") else None,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/min",
        "user": "600/min",
        "guest_signup": "10/hour",
        "reports": "30/hour",
        "friend_requests": "40/hour",
        "rewards": "20/hour",
        "uploads": "60/hour",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    # Long-lived so a guest keeps the same identity (and friends) on this browser.
    "REFRESH_TOKEN_LIFETIME": timedelta(days=60),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

VCHAT = {
    "REFRESH_COOKIE": "vchat_refresh",
    "MESSAGE_MAX_LENGTH": 1000,
    "HISTORY_PAGE_MAX": 100,
    # Flood control: at most N messages per WINDOW seconds per user, across all tabs and servers.
    "RATE_LIMIT_MESSAGES": 5,
    "RATE_LIMIT_WINDOW": 5,
    # A WebSocket must authenticate within this many seconds or it is closed.
    "WS_AUTH_TIMEOUT": 5,
    # A socket counts as present for this many seconds after its last ping (clients ping every 25 s).
    "PRESENCE_TTL": 70,
    # Room counts are cached this long so busy landing pages don't hit Redis on every view.
    "PRESENCE_COUNTS_CACHE": 10,
    # Random chat: a waiting socket that hasn't pinged for this long leaves the queue.
    "STRANGER_QUEUE_TTL": 60,
    # Two people who just chatted aren't matched again for this long.
    "STRANGER_RECENT_SECONDS": 600,
    # Seconds between two searches by the same person (stops skip-spam).
    "STRANGER_FIND_COOLDOWN": 1,
    # Rewarded ads unlock features (e.g. gender filter). Off in production until an ad network is live.
    "REWARDED_ADS": env_bool("REWARDED_ADS", DEBUG),
    "REWARDS_PER_DAY": 6,
    # Signed links to photos, videos and voice notes stop working after this long.
    # Clients get fresh links whenever they load the messages again.
    "MEDIA_LINK_SECONDS": 6 * 3600,
    # Calls (WebRTC). Comma-separated URLs. TURN relays media when phones can't connect
    # directly; its credentials are derived from TURN_SECRET (coturn use-auth-secret).
    "STUN_URLS": os.environ.get("STUN_URLS", "stun:stun.l.google.com:19302"),
    "TURN_URLS": os.environ.get("TURN_URLS", ""),
    "TURN_SECRET": os.environ.get("TURN_SECRET", ""),
    "TURN_CREDENTIAL_SECONDS": 6 * 3600,
}

# Uploaded attachments. Served only through signed links (apps/media), never as plain files.
MEDIA_ROOT = os.environ.get("MEDIA_ROOT", str(BASE_DIR / "media"))
MEDIA_URL = "/media-private/"  # not routed anywhere on purpose

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# TLS ends at the edge nginx (10.10.11.4), which redirects HTTP to HTTPS and sends HSTS.
# Doing it again here would redirect the plain-HTTP hops inside the private network.
SILENCED_SYSTEM_CHECKS = ["security.W004", "security.W008"]
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
