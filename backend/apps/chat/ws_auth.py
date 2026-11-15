import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User

CLOSE_NOT_FOUND = 4404
CLOSE_UNAUTHORIZED = 4401


class AuthenticatedJsonConsumer(AsyncJsonWebsocketConsumer):
    """Base for vChat sockets. The client must send {"type": "auth", "token": "<access JWT>"}
    as its first message, within WS_AUTH_TIMEOUT seconds. The token never travels in the URL,
    so it doesn't end up in proxy or access logs.

    Subclasses implement: can_connect(), on_authenticated(), on_leave(), handle(kind, content).
    """

    async def connect(self):
        self.user = None
        self._auth_task = None
        if not await self.can_connect():
            await self.close(code=CLOSE_NOT_FOUND)
            return
        await self.accept()
        self._auth_task = asyncio.create_task(self._close_if_unauthenticated())

    async def disconnect(self, code):
        if self._auth_task:
            self._auth_task.cancel()
        if self.user is not None:
            await self.on_leave()

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            return await self.error("bad_request", "Expected a JSON object.")
        kind = content.get("type")

        if self.user is None:
            if kind != "auth":
                await self.close(code=CLOSE_UNAUTHORIZED)
                return
            user = await self._user_from_token(content.get("token"))
            if user is None:
                await self.error("unauthorized", "Your session expired. Reload to continue.")
                await self.close(code=CLOSE_UNAUTHORIZED)
                return
            self.user = user
            if self._auth_task:
                self._auth_task.cancel()
            return await self.on_authenticated()

        if kind == "auth":
            return await self.error("already_authenticated", "This socket is already signed in.")
        if kind == "ping":
            # Heartbeat: keeps this socket counted as present (see apps/chat/presence.py).
            await self.on_ping()
            return await self.send_json({"type": "pong"})
        return await self.handle(kind, content)

    # --- hooks ----------------------------------------------------------

    async def can_connect(self) -> bool:
        return True

    async def on_authenticated(self):
        raise NotImplementedError

    async def on_leave(self):
        pass

    async def on_ping(self):
        pass

    async def handle(self, kind, content):
        await self.error("unknown_type", "Unknown message type.")

    # --- helpers --------------------------------------------------------

    async def error(self, code, detail, client_id=""):
        await self.send_json({"type": "error", "code": code, "detail": detail, "client_id": client_id})

    async def _close_if_unauthenticated(self):
        await asyncio.sleep(settings.VCHAT["WS_AUTH_TIMEOUT"])
        if self.user is None:
            await self.close(code=CLOSE_UNAUTHORIZED)

    @database_sync_to_async
    def _user_from_token(self, token):
        if not isinstance(token, str) or not token:
            return None
        try:
            user_id = AccessToken(token)["user_id"]
        except (TokenError, KeyError):
            return None
        return User.objects.filter(id=user_id, is_active=True).first()
