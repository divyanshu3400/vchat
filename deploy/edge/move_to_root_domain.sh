#!/bin/sh
# Run once on the edge (10.10.11.4) with sudo, from a copy of this folder:
#
#     sudo sh move_to_root_domain.sh
#
# Makes vChat answer on ssmm.online (and www.ssmm.online), which Google AdSense needs (it only
# accepts a root domain). The old address vchat.ssmm.online sends people on with a 301, keeping the
# path, so shared links and room invites still work. api.vchat.ssmm.online and the TURN relay are
# not touched.
#
# It edits only the "vchat" site, after a backup. If nginx rejects the result, the backup goes back.
# Undo by hand:   sudo cp /etc/nginx/sites-available/vchat.bak-before-root /etc/nginx/sites-available/vchat
#                 sudo nginx -t && sudo systemctl reload nginx
set -eu

ROOT=${1:-ssmm.online}
OLD=vchat.$ROOT
SITE=/etc/nginx/sites-available/vchat
BACKUP=$SITE.bak-before-root
CERT=$OLD   # the existing certificate's name; we add the new names to it

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -f "$SITE" ] || { echo "$SITE not found: is this the edge?" >&2; exit 1; }

# 1. Nobody else may already own the root name (another site with server_name ssmm.online).
others=$(grep -lE "server_name[^;]*[[:space:]](www\.)?$ROOT[[:space:];]" /etc/nginx/sites-enabled/* 2>/dev/null | xargs -r -n1 readlink -f | grep -vx "$SITE" || true)
if [ -n "$others" ]; then
    echo "Another site already answers for $ROOT:" >&2
    echo "$others" >&2
    echo "Stopping without changes. Decide which site should have it first." >&2
    exit 1
fi

restore() {
    cp -p "$BACKUP" "$SITE"
    nginx -t && systemctl reload nginx
    echo "Put the old site back." >&2
}

# 2. Backup, then add the names to both server blocks of the vchat site.
if grep -qE "server_name[^;]*[[:space:]]$ROOT[[:space:];]" "$SITE"; then
    echo "$SITE already lists $ROOT; skipping the name change."
else
    cp -p "$SITE" "$BACKUP"
    sed -i "s/server_name $OLD /server_name $ROOT www.$ROOT $OLD /" "$SITE"
    nginx -t || { restore; exit 1; }
    systemctl reload nginx
fi

# 3. One certificate for every name it already had plus the two new ones (port 80 answers the check).
names=$(openssl x509 -in "/etc/letsencrypt/live/$CERT/cert.pem" -noout -ext subjectAltName \
    | grep -o 'DNS:[^,]*' | sed 's/DNS://' | tr -d ' ')
args=""
for n in $names $ROOT www.$ROOT; do
    case " $args " in *" -d $n "*) ;; *) args="$args -d $n" ;; esac
done
# shellcheck disable=SC2086
certbot certonly --webroot -w /var/www/certbot --cert-name "$CERT" $args \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring --expand \
    || { echo "certbot failed: is DNS for $ROOT and www.$ROOT pointing here?" >&2; restore; exit 1; }

# 4. Send the old address (and www) to the root, path and query kept.
if ! grep -q "vchat-root-redirect" "$SITE"; then
    redirect=$(mktemp)
    escaped=$(printf '%s' "$ROOT" | sed 's/\./\\./g')
    {
        echo "    # vchat-root-redirect: the site lives on $ROOT now."
        echo "    if (\$host ~* ^(vchat|www)\\.$escaped\$) { return 301 https://$ROOT\$request_uri; }"
    } > "$redirect"
    sed -i "/ssl_certificate_key/r $redirect" "$SITE"
    rm -f "$redirect"
fi
if ! nginx -t; then
    restore
    exit 1
fi
systemctl reload nginx

echo
echo "Done. Check:"
echo "  curl -sI https://$ROOT/ | head -1                  (200)"
echo "  curl -sI https://$OLD/rooms | grep -i location     (https://$ROOT/rooms)"
echo "  curl -s  https://$ROOT/ads.txt"
