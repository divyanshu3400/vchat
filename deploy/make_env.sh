#!/bin/sh
# Writes deploy/.env with fresh secrets for a new server. Refuses to touch an existing one.
#   sh make_env.sh vchat.example.com
set -eu
HOST=${1:?usage: sh make_env.sh <public host name, e.g. vchat.example.com>}
OUT=$(dirname "$0")/.env
[ -e "$OUT" ] && { echo "$OUT exists; not replacing it." >&2; exit 1; }

token() { python3 -c "import secrets; print(secrets.token_urlsafe(64))"; }
hex() { python3 -c "import secrets; print(secrets.token_hex(24))"; }
DB_PASSWORD=$(hex)

umask 077
cat > "$OUT" <<EOF
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=$(token)
# localhost: the container health check. backend: calls from inside Docker.
DJANGO_ALLOWED_HOSTS=$HOST,localhost,backend
DJANGO_CSRF_TRUSTED_ORIGINS=https://$HOST
# The app nginx sits right in front of the backend and sets X-Forwarded-For to the visitor.
NUM_PROXIES=1
LOG_LEVEL=INFO

POSTGRES_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgres://vchat:$DB_PASSWORD@postgres:5432/vchat
PGDATA_PATH=/srv/vchat/pgdata
REDIS_URL=redis://redis:6379/0

# Public address of the site (canonical URLs, sitemap). Changing it needs a rebuild of web.
SITE_URL=https://$HOST

# Where the edge (10.10.11.4) reaches this server. 8080 is SadasyaSetu's.
BIND_ADDR=10.10.11.6
HTTP_PORT=8081
EOF
echo "Wrote $OUT. Keep a copy of it outside the server (password manager)."
