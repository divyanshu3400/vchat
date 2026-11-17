from django.core.management.base import BaseCommand

from apps.chat.models import Room

# Keep in sync with web/src/lib/rooms.ts (the landing page lists the same rooms).
REGIONS = [
    ("us-west", "US West", "America/Los_Angeles"),
    ("us-east", "US East & Canada", "America/New_York"),
    ("latin-america", "Latin America", "America/Sao_Paulo"),
    ("uk-ireland", "UK & Ireland", "Europe/London"),
    ("europe", "Europe", "Europe/Berlin"),
    ("africa", "Africa", "Africa/Lagos"),
    ("middle-east", "Middle East", "Asia/Dubai"),
    ("south-asia", "South Asia", "Asia/Kolkata"),
    ("southeast-asia", "Southeast Asia", "Asia/Manila"),
    ("australia-nz", "Australia & NZ", "Australia/Sydney"),
]
TOPICS = [
    ("random", "Random chat"),
    ("late-night", "Late-night talks"),
    ("hindi", "Hindi & Hinglish"),
    ("music", "Music"),
    ("gaming", "Gaming"),
    ("movies-tv", "Movies & TV"),
    ("sports", "Sports"),
    ("memes", "Memes"),
    ("students", "Students"),
    ("someone-to-talk-to", "Need someone to talk to"),
]


class Command(BaseCommand):
    help = "Create or update the default chat rooms. Safe to run repeatedly."

    def handle(self, *args, **options):
        for order, (slug, name, tz) in enumerate(REGIONS):
            Room.objects.update_or_create(
                slug=slug, defaults={"name": name, "kind": Room.Kind.REGION, "timezone": tz, "sort_order": order}
            )
        for order, (slug, name) in enumerate(TOPICS):
            Room.objects.update_or_create(
                slug=slug, defaults={"name": name, "kind": Room.Kind.TOPIC, "sort_order": order}
            )
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(REGIONS)} region and {len(TOPICS)} topic rooms."))
