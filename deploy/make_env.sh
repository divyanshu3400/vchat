#!/bin/sh
# Writes deploy/.env with fresh secrets for a new server. Refuses to touch an existing one.
#   sh make_env.sh                       # vchat.ssmm.online + api.vchat.ssmm.online
#   sh make_env.sh <host> <api host>     # other names
set -eu
HOST=${1:-vchat.ssmm.online}
API_HOST=${2:-api.$HOST}
OUT=$(dirname "$0")/.env
[ -e "$OUT" ] && { echo "$OUT exists; not replacing it." >&2; exit 1; }

token() { python3 -c "import secrets; print(secrets.token_urlsafe(64))"; }
hex() { python3 -c "import secrets; print(secrets.token_hex(24))"; }
DB_PASSWORD=$(hex)

umask 077
cat > "$OUT" <<EOF
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=$(token)
# The site and the API host. localhost: the container health check. backend: calls inside Docker.
# WebSocket connections are accepted only from pages on these hosts.
DJANGO_ALLOWED_HOSTS=$HOST,$API_HOST,localhost,backend
DJANGO_CSRF_TRUSTED_ORIGINS=https://$HOST,https://$API_HOST
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
echo "Wrote $OUT for $HOST and $API_HOST. Keep a copy of it outside the server (password manager)."
