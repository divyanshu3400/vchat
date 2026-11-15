#!/bin/sh
# Nightly backup on the app server: the database dump and the uploaded media (photos, videos,
# voice notes). Redis holds nothing worth keeping. Keeps the last KEEP_DAYS days.
#   BACKUP_DIR=$HOME/vchat-data/backups sh backup.sh
set -eu
BACKUP_DIR=${BACKUP_DIR:-/var/backups/vchat}
KEEP_DAYS=${KEEP_DAYS:-14}
DAY=$(date +%F)
mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/vchat-$DAY.dump"
docker exec vchat-postgres-1 pg_dump -U vchat -Fc vchat > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "backup: $OUT"

# Media lives in the "vchat_media" Docker volume; archive it with a throwaway container.
if docker volume inspect vchat_media > /dev/null 2>&1; then
    MEDIA="$BACKUP_DIR/vchat-media-$DAY.tar.gz"
    docker run --rm -v vchat_media:/media:ro -v "$BACKUP_DIR":/out alpine:3.20 \
        sh -c "tar czf /out/vchat-media-$DAY.tar.gz.tmp -C /media . && mv /out/vchat-media-$DAY.tar.gz.tmp /out/vchat-media-$DAY.tar.gz"
    echo "backup: $MEDIA"
fi

find "$BACKUP_DIR" \( -name 'vchat-*.dump' -o -name 'vchat-media-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
