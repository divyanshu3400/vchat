"""Rules for the names people pick: the sign-up name, the display name and the @username.

One place, so the join form, Edit profile and Save account all say the same thing. The web app
mirrors the format rules (components/HandleStatus.tsx) for instant feedback; this is the authority.
Names taken before these rules existed keep working; only new or changed names are checked.
"""

import re

MIN_LEN = 4
ALLOWED = re.compile(r"^[A-Za-z0-9_.]+$")
LONG_NUMBER = re.compile(r"\d{6,}")  # a phone number or an ID hidden in a name
DOUBLE_SYMBOL = re.compile(r"[_.]{2,}")

RESERVED = {
    "admin", "administrator", "mod", "moderator", "vchat", "support", "system", "staff",
    "help", "about", "settings", "root", "official", "team", "everyone", "here", "null", "undefined",
}

# Words that may not appear anywhere in a name (long enough not to hide inside normal words).
BLOCKED_ANYWHERE = (
    "fuck", "shit", "bitch", "cunt", "pussy", "porn", "nude", "slut", "whore", "rapist", "nigg", "faggot",
    "bhenchod", "behenchod", "benchod", "madarchod", "maderchod", "chutiya", "chutia", "bhosdi", "bhosad", "gaand", "randi",
)
# Short words blocked only as a whole part of the name (between _ . or digits): "sex" yes, "sussex" no.
BLOCKED_PARTS = {"sex", "ass", "dick", "cock", "rape", "cum", "lund", "gandu", "bc", "mc", "bsdk", "lauda", "loda"}


def name_problem(value: str, max_len: int) -> str | None:
    """Why this name can't be used, or None. Plain words, ready to show under the field."""
    name = value.strip()
    low = name.lower()
    if len(name) < MIN_LEN:
        return f"At least {MIN_LEN} characters."
    if len(name) > max_len:
        return f"At most {max_len} characters."
    if not ALLOWED.match(name):
        return "Only letters, numbers, _ and . (no spaces)."
    if not name[0].isalpha():
        return "Start with a letter."
    if not name[-1].isalnum():
        return "End with a letter or a number."
    if DOUBLE_SYMBOL.search(name):
        return "No two _ or . in a row."
    if sum(ch.isalpha() for ch in name) < 2:
        return "Use at least 2 letters."
    if LONG_NUMBER.search(name):
        return "No long numbers (like a phone number) in a name."
    if low.strip("._") in RESERVED or low.startswith(("vchat", "admin")):
        return "That name is reserved. Pick another."
    parts = set(re.split(r"[_.\d]+", low))
    if any(word in low for word in BLOCKED_ANYWHERE) or parts & BLOCKED_PARTS:
        return "That name isn't allowed. Pick another."
    return None
