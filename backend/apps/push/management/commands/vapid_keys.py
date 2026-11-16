"""Prints a new VAPID key pair as .env lines:  manage.py vapid_keys >> .env
Keep the private key secret. Changing keys later means every device has to allow notifications again."""

from cryptography.hazmat.primitives import serialization
from django.core.management.base import BaseCommand
from py_vapid import Vapid02, b64urlencode


class Command(BaseCommand):
    help = "Generate VAPID keys for Web Push."

    def handle(self, *args, **options):
        v = Vapid02()
        v.generate_keys()
        private = b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32, "big"))
        public = b64urlencode(
            v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        )
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}\n")
