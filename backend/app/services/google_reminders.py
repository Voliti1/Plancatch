"""Translate validated choices, preserving legacy unowned reminder settings."""
from app.schemas.google_reminders import GoogleReminders


def new_default():
    return {"mode": "none", "overrides": []}


def provider_value(settings):
    if settings is None:
        return None  # Legacy local rows do not take ownership of existing Google reminders.
    settings = GoogleReminders.model_validate(settings)
    if settings.mode == "default":
        return {"useDefault": True}
    return {"useDefault": False, "overrides": [item.model_dump() for item in settings.overrides]}


def normalize_provider(value):
    if not isinstance(value, dict) or type(value.get("useDefault")) is not bool:
        return None
    if value["useDefault"]:
        return {"useDefault": True}
    overrides = value.get("overrides", [])
    try:
        choices = GoogleReminders.model_validate({"mode": "custom" if overrides else "none", "overrides": overrides})
    except (ValueError, TypeError):
        return None
    return provider_value(choices.model_dump())


def matches(actual, payload):
    if "reminders" not in payload:
        return True
    expected = normalize_provider(payload["reminders"])
    return expected is not None and normalize_provider(actual) == expected
