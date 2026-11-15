"""Push events to connected users from sync code (REST views, services).

Groups:
  user.<id>     every personal socket of a user (/ws/me/): friend and DM events
  userctl.<id>  every room socket of a user: control events such as block changes
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def user_group(user_id: int) -> str:
    return f"user.{user_id}"


def control_group(user_id: int) -> str:
    return f"userctl.{user_id}"


def push_to_user(user_id: int, payload: dict) -> None:
    async_to_sync(get_channel_layer().group_send)(user_group(user_id), {"type": "user.event", "payload": payload})


def push_control(user_id: int, payload: dict) -> None:
    async_to_sync(get_channel_layer().group_send)(
        control_group(user_id), {"type": "control.event", "payload": payload}
    )
