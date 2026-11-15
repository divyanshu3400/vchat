#!/bin/sh
# Nightly database dump on the app server. Messages and accounts live only in Postgres;
# Redis holds nothing worth keeping. Keeps the last KEEP_DAYS days.
#   echo '30 2 * * * root /home/<user>/vchat/deploy/backup.sh' | sudo tee /etc/cron.d/vchat-backup
set -eu
BACKUP_DIR=${BACKUP_DIR:-/var/backups/vchat}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/vchat-$(date +%F).dump"
docker exec vchat-postgres-1 pg_dump -U vchat -Fc vchat > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$BACKUP_DIR" -name 'vchat-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "backup: $OUT"
