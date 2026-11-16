"""GIFs and stickers from GIPHY, through our server.

- The API key stays on the server (GIPHY_API_KEY); the app only talks to /api/gifs/.
- Everything is rated pg-13 or milder: vChat has anonymous chats with strangers.
- Results are cached (trending 10 min, searches 1 h), which keeps us inside GIPHY's limits.
- A GIF travels in a message as plain text, "gif:<id>:<w>x<h>"; the app shows it as an image from
  GIPHY's CDN. Before such a message is saved, the id is checked: it must be a real GIPHY id with
  an allowed rating (ids we served recently are known already, others are looked up once).
"""

import json
import logging
import re
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

API = "https://api.giphy.com/v1"
RATINGS = {"g", "pg", "pg-13"}
PAGE = 24
GIF_RE = re.compile(r"^gif:([A-Za-z0-9]{4,64}):(\d{1,4})x(\d{1,4})$")
OK_KEY = "gif:ok:{}"
OK_SECONDS = 7 * 86400


class GifError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.GIPHY_API_KEY)


def _get(path: str, params: dict) -> dict:
    query = urllib.parse.urlencode({"api_key": settings.GIPHY_API_KEY, **params})
    req = urllib.request.Request(f"{API}/{path}?{query}", headers={"User-Agent": "vChat"})
    try:
        with urllib.request.urlopen(req, timeout=5) as res:  # noqa: S310 - fixed https host
            return json.loads(res.read().decode())
    except Exception as exc:  # network, HTTP or JSON: the picker shows "try again"
        log.warning("giphy %s failed: %s", path, exc.__class__.__name__)
        raise GifError("GIFs aren't available right now.") from exc


def _brief(item: dict) -> dict | None:
    images = item.get("images") or {}
    small = images.get("fixed_width") or {}
    try:
        w, h = int(small.get("width") or 0), int(small.get("height") or 0)
    except ValueError:
        return None
    gid = item.get("id", "")
    if not (w and h and re.fullmatch(r"[A-Za-z0-9]{4,64}", gid)):
        return None
    return {"id": gid, "w": w, "h": h, "title": (item.get("title") or "")[:80]}


def browse(kind: str, query: str, offset: int) -> dict:
    """{"items": [{id, w, h, title}], "next": offset or None}. kind: "gifs" or "stickers"."""
    if not enabled():
        raise GifError("GIFs aren't switched on yet.")
    kind = "stickers" if kind == "stickers" else "gifs"
    query = " ".join(query.split())[:50]
    offset = max(0, min(offset, 4975))
    key = f"giphy:{kind}:{query.lower()}:{offset}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    params = {"limit": PAGE, "offset": offset, "rating": settings.GIF_RATING, "bundle": "messaging_non_clips"}
    if query:
        data = _get(f"{kind}/search", {**params, "q": query, "lang": "en"})
    else:
        data = _get(f"{kind}/trending", params)
    items = [b for b in (_brief(i) for i in data.get("data") or []) if b]
    for b in items:
        cache.set(OK_KEY.format(b["id"]), True, OK_SECONDS)
    total = (data.get("pagination") or {}).get("total_count") or 0
    nxt = offset + PAGE if offset + PAGE < min(total, 5000) and items else None
    out = {"items": items, "next": nxt}
    cache.set(key, out, 3600 if query else 600)
    return out


def verify(gid: str) -> bool:
    """A real GIPHY id with an allowed rating."""
    known = cache.get(OK_KEY.format(gid))
    if known is not None:
        return bool(known)
    if not enabled():
        return False
    try:
        data = _get(f"gifs/{gid}", {}).get("data") or {}
    except GifError:
        return False
    ok = data.get("id") == gid and data.get("rating", "r") in RATINGS
    cache.set(OK_KEY.format(gid), ok, OK_SECONDS)
    return ok


def is_gif(text: str) -> bool:
    return bool(GIF_RE.match(text or ""))


def label(text: str) -> str:
    """How a message reads in previews and notifications."""
    return "🎞️ GIF" if is_gif(text) else text
