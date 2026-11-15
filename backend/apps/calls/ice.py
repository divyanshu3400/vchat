"""ICE servers for WebRTC.

STUN lets two phones find their public addresses; TURN relays the media when a direct path is
blocked (mobile carriers, office networks). TURN credentials are short-lived and derived from a
shared secret with coturn's "TURN REST API" scheme (use-auth-secret), so nothing per-user is
stored and leaked credentials expire on their own.
"""

import base64
import hashlib
import hmac
import time

from django.conf import settings


def _urls(name: str) -> list[str]:
    return [u.strip() for u in settings.VCHAT.get(name, "").split(",") if u.strip()]


def ice_servers(user_id: int) -> dict:
    servers = []
    stun = _urls("STUN_URLS")
    if stun:
        servers.append({"urls": stun})
    turn = _urls("TURN_URLS")
    secret = settings.VCHAT.get("TURN_SECRET", "")
    ttl = settings.VCHAT["TURN_CREDENTIAL_SECONDS"]
    if turn and secret:
        username = f"{int(time.time()) + ttl}:{user_id}"
        digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
        servers.append({"urls": turn, "username": username, "credential": base64.b64encode(digest).decode()})
    return {"ice_servers": servers, "ttl": ttl, "relay": bool(turn and secret)}
