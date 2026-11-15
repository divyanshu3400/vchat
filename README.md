# vChat

Anonymous, worldwide chat rooms. Guests pick a nickname (18+) and chat in region and topic rooms; no email or phone.

| Part | Stack | Folder |
|---|---|---|
| API, auth, moderation, admin | Django 5.2 + DRF + SimpleJWT | `backend/` |
| Realtime chat | Django Channels (WebSockets) + Redis | `backend/apps/chat/consumers.py` |
| Website + chat UI | Next.js 16 (App Router, TypeScript) | `web/` |
| Data | PostgreSQL (SQLite fallback for quick local runs) | — |

## Run locally

Postgres and Redis are optional for a first run: without `DATABASE_URL` / `REDIS_URL` the backend uses SQLite and an in-memory channel layer (single process only).

```bash
# 1. Optional: Postgres + Redis
docker compose up -d

# 2. Backend  (http://localhost:8000, admin at /admin/)
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
set DJANGO_DEBUG=1                # macOS/Linux: export DJANGO_DEBUG=1
python manage.py migrate
python manage.py seed_rooms
python manage.py createsuperuser  # for the moderator/admin panel
python manage.py runserver

# 3. Web  (http://localhost:3000)
cd web
npm install
npm run dev
```

## Tests and checks

```bash
cd backend && python -m pytest          # API + WebSocket tests
cd web && npm run lint && npm run build
```

## How it fits together

- The browser only calls same-origin `/api/*`; Next.js rewrites it to Django. The long-lived refresh token sits in an **httpOnly cookie** scoped to `/api/auth/`; page scripts only ever hold a 30-minute access token.
- The chat socket is `ws(s)://<api>/ws/rooms/<slug>/`. The client authenticates with its first message (`{"type":"auth","token":...}`), never in the URL, and must do so within 5 seconds.
- Messages are **saved before they are broadcast**, so anything anyone saw is in history. Reconnecting clients reload recent history.
- Flood control (5 messages / 5 s per user, plus optional per-room slow mode) uses the cache, which is Redis in production, so it holds across tabs and servers.
- Blocks hide messages both ways, in history and live.
- Messages are stored as plaintext with `enc_version = 0`; end-to-end encryption can be added later per conversation without rewriting old rows.
- **Friends and DMs** (`backend/apps/social/`): friend requests (crossed requests auto-accept, declines are silent), friendships, and one-to-one DMs that only friends can send. Each open tab holds one personal socket, `/ws/me/`, which carries DMs and live friend events; room sockets stay one per room. Unread counts come from each side's last-read message id. Blocking someone removes the friendship and any pending requests, and their open room sockets stop showing each other's messages immediately.
- SEO: `/` and `/rooms/<slug>` are static, indexable pages with a sitemap and FAQ structured data. `/chat/*` and `/api/*` are `noindex` / disallowed.

- **Presence** (`backend/apps/chat/presence.py`): every socket registers in Redis sorted sets and pings every 25 s; a socket that stops pinging expires after 70 s, so crashed servers never leave ghosts. Friends get a live `presence` event only when someone's first tab opens or last tab closes, and clients re-check friends' status every 60 s as a backstop. Room and site counts (`GET /api/rooms/presence/`, public, cached 10 s) count unique people, not tabs. Counts are hidden in the UI until they're above zero.

## Rooms

Default rooms are defined twice and must stay in sync:
`backend/apps/chat/management/commands/seed_rooms.py` and `web/src/lib/rooms.ts`.

## Not built yet (next steps)

1. DM extras: typing indicator, delivered/seen ticks, unread total in the tab title
2. Privacy setting to appear offline
3. Moderation: auto-mute after repeated reports, bans by device and IP, word/link filters
4. Legal pages (Privacy, Terms, Rules, Report abuse) and EU/UK cookie consent before ads
5. Google sign-in to save a guest profile across devices
6. Voice notes, voice rooms, then 1:1 calls (WebRTC)
7. Production: Postgres + Redis required, `DJANGO_DEBUG` off, HTTPS/WSS, multiple ASGI workers behind Nginx
