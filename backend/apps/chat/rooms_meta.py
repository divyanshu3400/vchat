"""Room slugs known in code. Keep in sync with seed_rooms.py and web/src/lib/rooms.ts."""

from .management.commands.seed_rooms import REGIONS

REGION_SLUGS = frozenset(slug for slug, _name, _tz in REGIONS)
