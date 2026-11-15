# Deploying vChat

## Layout: app server 10.10.11.6 behind the edge 10.10.11.4

```
Internet -> 10.10.11.4 nginx (TLS, sites-available/vchat)
         -> http://10.10.11.6:8081 -> app nginx -> /ws/, /api/, /admin/ -> backend (uvicorn, Django + Channels)
                                               -> /static/           -> admin CSS/JS
                                               -> everything else    -> web (Next.js)
                                    postgres, redis (all in Docker, project "vchat")
```

Same shape as SadasyaSetu (which uses 8080 on the same server). Differences that matter:

- **WebSockets.** Both nginx hops pass `Upgrade`/`Connection` for `/ws/` and keep those
  connections open up to an hour (clients ping every 25 s).
- **One host name.** Website, API and sockets share it, so the login cookie stays first-party.
- **Port 8081**, published on 10.10.11.6 only, and the app nginx answers only 10.10.11.4.
  Docker's published ports skip ufw, so those two are the guards.

## First time

Pick the public host name first (example below: `vchat.example.com`) and point its DNS
A record at the edge's public address.

### On 10.10.11.6 (app server)

```bash
# 1. Code (deploy key or your SSH alias with read access to the repo)
git clone git@github.com:divyanshu3400/vchat.git ~/vchat
cd ~/vchat/deploy

# 2. Check port 8081 is free (8080 is SadasyaSetu)
ss -ltnp | grep -E ':8081\b' || echo "8081 free"

# 3. Secrets and settings, once. Keep a copy of .env in the password manager.
sh make_env.sh vchat.example.com

# 4. Database folder
sudo install -d -m 700 /srv/vchat/pgdata

# 5. Build and start
docker compose config -q && docker compose up -d --build
docker compose ps          # migrate: exited (0); others: running / healthy

# 6. Health (inside the network; the app nginx refuses everyone but the edge)
docker compose exec backend python -c "import urllib.request as u; print(u.urlopen(u.Request('http://127.0.0.1:8000/api/health/', headers={'Host': 'localhost'})).read())"

# 7. A moderator account for /admin/
docker compose exec backend python manage.py createsuperuser
```

### On 10.10.11.4 (edge)

Copy `deploy/edge/` there, then:

```bash
sudo sh setup_edge.sh vchat.example.com
```

It adds one site, `vchat`, gets its certificate with certbot (webroot `/var/www/certbot`,
same as SadasyaSetu) and never edits another site. Undo:
`sudo rm /etc/nginx/sites-enabled/vchat && sudo systemctl reload nginx`.

### Check from outside

```bash
curl -sS https://vchat.example.com/api/health/      # {"status": "ok", "database": "ok", "cache": "ok"}
curl -sSI https://vchat.example.com/ | head -1       # HTTP/2 200
```

Then open the site, join with a nickname and send a message. If the page loads but the
chat says "Reconnecting…", the WebSocket upgrade is missing on one of the two nginx hops.

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

## Not checked yet

These files were written and checked piece by piece on a machine without Docker:
production server (uvicorn) with production settings, health check, secure cookies,
per-visitor rate limits, WebSocket origin check, `manage.py check --deploy`, the
standalone Next.js build, the env generator and the edge config rendering. The images,
the compose file and both nginx configs have not run yet, so watch the first
`docker compose up` and `nginx -t`.
