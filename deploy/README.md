# Deploying vChat

## Layout: app server 10.10.11.6 behind the edge 10.10.11.4

```
Internet -> 10.10.11.4 nginx (TLS, sites-available/vchat)
         -> http://10.10.11.6:8081 -> app nginx
              vchat.ssmm.online      /ws/, /api/, /admin/ -> backend (uvicorn, Django + Channels)
                                     /static/            -> admin CSS/JS
                                     everything else     -> web (Next.js)
              api.vchat.ssmm.online  everything          -> backend
            postgres, redis (all in Docker, project "vchat")
```

| Name | Who uses it |
|---|---|
| `vchat.ssmm.online` | Browsers: the website, its API calls (`/api/`) and chat sockets (`/ws/`). One host, so the login cookie stays first-party and no CORS is needed. |
| `api.vchat.ssmm.online` | Direct API access: a future mobile app, integrations, health checks. Not used by the website. |

No separate WebSocket name is needed: sockets use `wss://vchat.ssmm.online/ws/...`.

Same shape as SadasyaSetu (which uses 8080 on the same server). Differences that matter:

- **WebSockets.** Both nginx hops pass `Upgrade`/`Connection` for `/ws/` and keep those
  connections open up to an hour (clients ping every 25 s).
- **Port 8081**, published on 10.10.11.6 only, and the app nginx answers only 10.10.11.4.
  Docker's published ports skip ufw, so those two are the guards.

## DNS

Point both names at the edge's public address (A records, or CNAMEs to the name that
already points there):

```
vchat.ssmm.online       A   <public IP of 10.10.11.4>
api.vchat.ssmm.online   A   <public IP of 10.10.11.4>
```

Both must resolve before `setup_edge.sh` runs: certbot proves each name over port 80.

## Live on 10.10.11.6 (deployed 2026-11-15)

- User `hashai`, code in `~/vchat` (cloned from a git bundle: the server can't reach GitHub,
  same as SadasyaSetu), settings in `~/vchat/deploy/.env`.
- Database in `~/vchat-data/pgdata` (no passwordless sudo, so not `/srv`), backups go to
  `~/vchat-data/backups`.
- All six containers healthy; port `10.10.11.6:8081`; the app nginx returns 403 to anything
  but 10.10.11.4.
- Edge 10.10.11.4 (user `hashkmpcl`): site `vchat` enabled, one Let's Encrypt certificate for
  both names (renews with the edge's certbot timer). Checked from outside: HTTP→HTTPS
  redirect, health on both names, two guests chatting live over `wss://`.

**Update** (from your machine, in the repo):

```bash
git bundle create /tmp/vchat.bundle master
scp /tmp/vchat.bundle hashai@10.10.11.6:/tmp/vchat.bundle
ssh hashai@10.10.11.6 'cd ~/vchat && git pull -q /tmp/vchat.bundle master && cd deploy && docker compose up -d --build'
```

After an update that changes `deploy/nginx/`, reload the app nginx (the image doesn't change,
so `up --build` leaves it running with the old config):

```bash
ssh hashai@10.10.11.6 'cd ~/vchat/deploy && docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload'
```

**Backups** run every night at 02:30 from `hashai`'s crontab (after SadasyaSetu's at 02:15),
into `~/vchat-data/backups`, keeping 14 days; log in `backup.log` there. Set up and
test-run on 2026-11-15 (the dump restored its table list with `pg_restore --list`). The line:

```
30 2 * * * BACKUP_DIR=$HOME/vchat-data/backups sh $HOME/vchat/deploy/backup.sh >> $HOME/vchat-data/backups/backup.log 2>&1
```

The dumps stay on this server. Copy them off it (NAS, another machine) to survive a disk loss.

### Photos, videos and voice notes (added after the first deploy)

- Uploads go to `POST /api/media/` (up to 25 MB); both nginx hops allow 30 MB on that one path.
  **The edge needs its updated site once:** copy `deploy/edge/` to 10.10.11.4 and run
  `sudo sh setup_edge.sh` again (it only rewrites the `vchat` site).
- Files live in the `vchat_media` Docker volume and are only reachable through signed links
  that expire after 6 hours. `backup.sh` archives the volume next to the database dump.

### Voice and video calls

Calls are WebRTC: media goes phone to phone; the backend only relays the call setup. Without a
TURN relay, calls work on many networks but fail when both sides are behind strict NAT (common
on mobile data). The relay is reached as TURN over TLS on port 443, so no new firewall ports:

```
phone --TLS 443--> edge 10.10.11.4: SNI router --turn.vchat.ssmm.online--> TLS ends, plain TURN
                                     \--any other name--> the normal https sites  --> 10.10.11.6:3478 coturn
```

Both callers' relay addresses live on 10.10.11.6, so two relayed callers meet inside the server.

1. **DNS:** `turn.vchat.ssmm.online` → the same address as `vchat.ssmm.online`.
2. **Edge (10.10.11.4)**, from a copy of `deploy/edge/`: `sudo sh setup_turn443.sh`. It backs up
   `/etc/nginx`, moves every https site behind a small SNI router on 443 (real client IPs kept with
   PROXY protocol), checks each site answers as before and restores the backup by itself if not.
   Undo: `sudo sh setup_turn443.sh --rollback`.
3. **ufw on 10.10.11.6**, if enabled: `sudo ufw allow from 10.10.11.4 to any port 3478 proto tcp`.
4. **Start it and point the app at it** (in `~/vchat/deploy/.env`):
   ```
   TURN_URLS=turns:turn.vchat.ssmm.online:443?transport=tcp
   ```
   ```bash
   docker compose --profile turn up -d turn && docker compose up -d backend
   ```

`TURN_SECRET` is in `.env` (made by `make_env.sh`); TURN logins are derived from it and expire
after 6 hours. The relay refuses to forward into private networks.

### Saved accounts (email)

Guests save their account with an email and a password (verified with a 6-digit emailed code),
then log in on any device and reset a forgotten password the same way. Once email is on,
guests must save their account before sending or accepting friend requests.

Add the SMTP settings to `~/vchat/deploy/.env`, then `docker compose up -d backend`:
```
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=true
DEFAULT_FROM_EMAIL=vChat <no-reply@ssmm.online>
```
Without `EMAIL_HOST` the feature is off (the app says so) and friend requests work as before.
Set SPF/DKIM for the sending domain, or the codes land in spam.

## First time

### On 10.10.11.6 (app server)

```bash
# 1. Code (a deploy key or SSH alias with read access to the repo)
git clone git@github.com:divyanshu3400/vchat.git ~/vchat
cd ~/vchat/deploy

# 2. Check port 8081 is free (8080 is SadasyaSetu)
ss -ltnp | grep -E ':8081\b' || echo "8081 free"

# 3. Secrets and settings, once (defaults to vchat.ssmm.online + api.vchat.ssmm.online).
#    Keep a copy of .env in the password manager.
sh make_env.sh

# 4. Database folder
sudo install -d -m 700 /srv/vchat/pgdata

# 5. Build and start
docker compose config -q && docker compose up -d --build
docker compose ps          # migrate: exited (0); others: running / healthy

# 6. Health (inside the network; the app nginx refuses everyone but the edge)
docker compose exec backend python -c "import urllib.request as u; print(u.urlopen(u.Request('http://127.0.0.1:8000/api/health/', headers={'Host': 'localhost'})).read())"

# 7. A moderator account for https://vchat.ssmm.online/admin/
docker compose exec backend python manage.py createsuperuser
```

### On 10.10.11.4 (edge)

Copy `deploy/edge/` there, then:

```bash
sudo sh setup_edge.sh
```

It adds one site, `vchat`, gets one certificate for both names with certbot (webroot
`/var/www/certbot`, same as SadasyaSetu) and never edits another site. Undo:
`sudo rm /etc/nginx/sites-enabled/vchat && sudo systemctl reload nginx`.

### Check from outside

```bash
curl -sS https://vchat.ssmm.online/api/health/       # {"status": "ok", "database": "ok", "cache": "ok"}
curl -sS https://api.vchat.ssmm.online/api/health/   # same, straight to the backend
curl -sSI https://vchat.ssmm.online/ | head -1        # HTTP/2 200
```

Then open https://vchat.ssmm.online, join with a nickname and send a message. If the page
loads but the chat says "Reconnecting…", the WebSocket upgrade is missing on one of the two
nginx hops.

## Updating

```bash
cd ~/vchat && git pull && cd deploy && docker compose up -d --build
```

`migrate` runs migrations, re-seeds the default rooms (no duplicates) and collects static
files before the new backend starts. Open chat sockets drop during the restart and the
clients reconnect by themselves.

Changing `SITE_URL` in `.env` needs `docker compose build web` (it is baked into the
sitemap and canonical links).

## Backups

Messages and accounts live only in Postgres; Redis holds nothing worth keeping.

```bash
sudo install -d -m 700 /var/backups/vchat
echo "30 2 * * * root $HOME/vchat/deploy/backup.sh" | sudo tee /etc/cron.d/vchat-backup
```

Keeps 14 days. Restore into an empty database:

```bash
docker exec -i vchat-postgres-1 pg_restore -U vchat -d vchat --clean --if-exists < /var/backups/vchat/vchat-YYYY-MM-DD.dump
```

## Operating

| Task | Command (from `deploy/`) |
|---|---|
| Logs | `docker compose logs -f backend` (or `web`, `nginx`) |
| Restart one service | `docker compose restart backend` |
| Django shell | `docker compose exec backend python manage.py shell` |
| Add rooms | Django admin → Rooms, or edit `seed_rooms.py` and `web/src/lib/rooms.ts`, then update |
| More capacity | Raise `--workers` in `backend.Dockerfile` (state is in Redis, so workers scale freely) |

## Other host names

`make_env.sh <host> <api host>` and `setup_edge.sh <host> <api host>` take other names.
The app nginx's API server block (`server_name api.vchat.ssmm.online` in `nginx/default.conf`)
must be changed to match.

## Not checked yet

These files were written and checked piece by piece on a machine without Docker:
production server (uvicorn) with production settings, health check, secure cookies,
per-visitor rate limits, WebSocket origin check, `manage.py check --deploy`, the
standalone Next.js build, the env generator and the edge config rendering. The images,
the compose file and both nginx configs have not run yet, so watch the first
`docker compose up` and `nginx -t`.
