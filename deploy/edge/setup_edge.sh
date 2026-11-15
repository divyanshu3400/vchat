#!/bin/sh
# Run once on 10.10.11.4 with sudo, from a copy of this folder. Adds one new site, "vchat",
# and its certificate. It never edits another site. To undo:
#   sudo rm /etc/nginx/sites-enabled/vchat && sudo systemctl reload nginx
#
#   sudo sh setup_edge.sh vchat.example.com
set -eu
HOST=${1:?usage: sudo sh setup_edge.sh <host name, e.g. vchat.example.com>}
NAME=vchat
SITE=/etc/nginx/sites-available/$NAME
HERE=$(dirname "$0")

render() { sed "s/VCHAT_HOST/$HOST/g" "$HERE/$NAME.conf"; }

if [ -e "$SITE" ] && ! grep -q "server_name $HOST;" "$SITE"; then
    echo "$SITE exists and is not this site; stopping." >&2
    exit 1
fi

# Port 80 first, so certbot can prove the domain.
render | sed -n '1,/^}/p' > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/$NAME
if ! nginx -t; then
    rm -f /etc/nginx/sites-enabled/$NAME
    echo "nginx -t failed; the site is disabled again." >&2
    exit 1
fi
systemctl reload nginx

certbot certonly --webroot -w /var/www/certbot --cert-name "$HOST" -d "$HOST" \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring

render > "$SITE"
if ! nginx -t; then
    render | sed -n '1,/^}/p' > "$SITE"
    echo "nginx -t failed with TLS; left the port 80 part only." >&2
    exit 1
fi
systemctl reload nginx
echo "done: https://$HOST"
