#!/bin/sh
# Run once on 10.10.11.4 with sudo, from a copy of this folder:
#   sudo sh setup_turn443.sh
#
# Puts the vChat TURN relay on port 443 next to the existing sites (no new firewall ports):
#   1. backs up /etc/nginx to /root/nginx-before-turn443-<time>.tgz
#   2. installs nginx's stream module (libnginx-mod-stream)
#   3. adds TURN_HOST to the vchat certificate
#   4. moves every "listen 443 ssl" site to 127.0.0.1:8443 (PROXY protocol, real client IPs kept)
#      and puts a small SNI router on 443 in front (vchat-443.stream.conf)
#   5. checks every https site still answers; anything wrong puts the backup back by itself
#
# Undo by hand at any time:   sudo sh setup_turn443.sh --rollback
set -eu
HOST=${VCHAT_HOST:-vchat.ssmm.online}
TURN_HOST=${TURN_HOST:-turn.$HOST}
TURN_UPSTREAM=${TURN_UPSTREAM:-10.10.11.6:3478}
CERT_NAME=$HOST
HERE=$(cd "$(dirname "$0")" && pwd)
MARK=/root/.nginx-before-turn443
REALIP=/etc/nginx/conf.d/zz-proxy-protocol-realip.conf
STREAM_DIR=/etc/nginx/stream.d
INCLUDE_LINE="include /etc/nginx/stream.d/*.conf;"

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

restore() {
    backup=$(cat "$MARK")
    echo "restoring /etc/nginx from $backup" >&2
    rm -rf /etc/nginx.failed && mv /etc/nginx /etc/nginx.failed
    mkdir /etc/nginx && tar -xzf "$backup" -C /etc/nginx
    nginx -t && systemctl reload nginx
    echo "restored; the failed config is kept in /etc/nginx.failed" >&2
}

if [ "${1:-}" = "--rollback" ]; then
    [ -f "$MARK" ] || { echo "no backup recorded" >&2; exit 1; }
    restore
    exit 0
fi

# --- preflight -----------------------------------------------------------------
nginx -t
site_ip=$(getent ahostsv4 "$HOST" | awk 'NR==1{print $1}')
turn_ip=$(getent ahostsv4 "$TURN_HOST" | awk 'NR==1{print $1}')
if [ -z "$turn_ip" ] || [ "$turn_ip" != "$site_ip" ]; then
    echo "$TURN_HOST must point to the same address as $HOST ($site_ip); it gives '$turn_ip'." >&2
    exit 1
fi
if grep -q "stream.d" /etc/nginx/nginx.conf; then
    echo "already set up (nginx.conf includes stream.d)." >&2
    exit 1
fi

# --- 1. backup -------------------------------------------------------------------
backup=/root/nginx-before-turn443-$(date +%Y%m%d-%H%M%S).tgz
tar -czf "$backup" -C /etc/nginx .
echo "$backup" > "$MARK"
echo "backup: $backup"

# --- 2. stream module ---------------------------------------------------------------
DEBIAN_FRONTEND=noninteractive apt-get install -y -q libnginx-mod-stream

# --- 3. certificate ---------------------------------------------------------------
VCHAT_SITE=/etc/nginx/sites-available/vchat
if ! grep -q "server_name $HOST api.$HOST $TURN_HOST;" "$VCHAT_SITE"; then
    # The port 80 block (first server_name) answers the certificate challenge for the new name.
    sed -i "0,/server_name $HOST api.$HOST;/s//server_name $HOST api.$HOST $TURN_HOST;/" "$VCHAT_SITE"
fi
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/certbot --cert-name "$CERT_NAME" \
    -d "$HOST" -d "api.$HOST" -d "$TURN_HOST" \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring --expand

# --- 4. sites behind the SNI router --------------------------------------------------
https_sites=""
for link in /etc/nginx/sites-enabled/*; do
    file=$(readlink -f "$link")
    if grep -qE '^\s*listen\s+443\s+ssl' "$file"; then
        https_sites="$https_sites $(grep -E '^\s*server_name' "$file" | awk '{for (i=2;i<=NF;i++) print $i}' | tr -d ';' | grep -v '^_$' | grep -v '^[0-9.]*$' | grep -vx "$TURN_HOST" | sort -u | tr '\n' ' ')"
    fi
done
probe() { curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$1:443:127.0.0.1" "https://$1/" || true; }
before=""
for name in $https_sites; do before="$before $name=$(probe "$name")"; done
for link in /etc/nginx/sites-enabled/*; do
    file=$(readlink -f "$link")
    sed -i -E 's/^(\s*)listen\s+443\s+ssl(\s+http2)?(\s+default_server)?;/\1listen 127.0.0.1:8443 ssl\2\3 proxy_protocol;/' "$file"
done
if grep -RqE '^\s*listen\s+(\S+:)?443\b' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/; then
    echo "a 'listen 443' line is left that this script doesn't understand; restoring." >&2
    restore
    exit 1
fi
cat > "$REALIP" <<EOF
# Installed by vChat setup_turn443.sh: the SNI router on 443 passes the visitor's IP by PROXY protocol.
set_real_ip_from 127.0.0.1;
real_ip_header proxy_protocol;
EOF
mkdir -p "$STREAM_DIR"
sed -e "s/TURN_HOST/$TURN_HOST/" -e "s/CERT_NAME/$CERT_NAME/g" -e "s/TURN_UPSTREAM/$TURN_UPSTREAM/" \
    "$HERE/vchat-443.stream.conf" > "$STREAM_DIR/vchat-443.conf"
printf '\n# vChat: SNI router on 443 (setup_turn443.sh)\n%s\n' "$INCLUDE_LINE" >> /etc/nginx/nginx.conf

if ! nginx -t; then
    restore
    exit 1
fi
systemctl reload nginx
sleep 2

# --- 5. every https site must answer as it did before ------------------------------------
failed=""
for pair in $before; do
    name=${pair%%=*}; was=${pair#*=}
    now=$(probe "$name")
    echo "  https://$name/  before $was  now $now"
    [ "$now" = "$was" ] || failed="$failed $name"
done
if [ -n "$failed" ]; then
    echo "not answering:$failed" >&2
    restore
    exit 1
fi
echo "done. TURN over TLS: turns:$TURN_HOST:443?transport=tcp -> $TURN_UPSTREAM"
echo "undo: sudo sh $0 --rollback"
