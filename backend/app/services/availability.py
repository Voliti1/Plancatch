"""Owner lock shared with plan approval prevents concurrent preference changes."""
from fastapi import HTTPException

from app.models.availability import AvailabilityProfile
from app.schemas.availability import default_weekly
from app.services.google_sync import lock_owner


def read(db, owner):
    row = db.get(AvailabilityProfile, owner, populate_existing=True)
    return {
        "revision": row.revision if row else 0,
        "timezone": "Asia/Seoul",
        "weekly": row.weekly if row else [day.model_dump(mode="json", exclude_none=True) for day in default_weekly()],
        "exceptions": row.exceptions if row else [],
    }


def save(db, owner, payload):
    lock_owner(db, owner)
    current = read(db, owner)
    if payload.revision != current["revision"]:
        raise HTTPException(409, "다른 화면에서 설정이 변경됐습니다. 다시 불러온 뒤 저장해 주세요.")
    row = db.get(AvailabilityProfile, owner)
    if row is None:
        row = AvailabilityProfile(user_id=owner)
        db.add(row)
    row.revision = current["revision"] + 1
    row.weekly = [day.model_dump(mode="json", exclude_none=True) for day in payload.weekly]
    row.exceptions = [day.model_dump(mode="json") for day in payload.exceptions]
    db.commit()
    return read(db, owner)


def intervals(profile, day):
    override = next((entry for entry in profile["exceptions"] if entry["date"] == day.isoformat()), None)
    if override is not None:
        return override["intervals"]
    return next((entry["intervals"] for entry in profile["weekly"] if entry["weekday"] == day.weekday()), [])
