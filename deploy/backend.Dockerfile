FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./

# Runs as a plain user. /app/staticfiles is shared with nginx through a volume; making it
# here gives the volume this owner the first time it is created.
RUN useradd --system --uid 10002 --home-dir /app vchat \
    && mkdir -p /app/staticfiles /app/media \
    && chown vchat /app/staticfiles /app/media
USER vchat

EXPOSE 8000
# Uvicorn serves HTTP and WebSockets. Workers share state through Redis (channel layer,
# presence, rate limits), so add workers freely. Only the app nginx can reach this port.
CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "4", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
