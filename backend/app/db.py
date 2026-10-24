import os
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://hixor@127.0.0.1:5433/hixor")
DEMO = os.environ.get("HIXOR_DEMO", "1") == "1"
SGT = ZoneInfo("Asia/Singapore")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def today_sg() -> date:
    return datetime.now(SGT).date()


class Clock:
    """Ward time as minutes from 00:00 on `day` (Singapore), the unit the app works in."""

    def __init__(self, day: date, now: int):
        self.day = day
        self.now = now
        self.start = datetime.combine(day, time(0), SGT)

    def dt(self, minutes: float) -> datetime:
        return self.start + timedelta(minutes=minutes)

    def at_now(self) -> datetime:
        return self.dt(self.now)

    def mins(self, dt: datetime | None) -> int | None:
        if dt is None:
            return None
        return round((dt - self.start).total_seconds() / 60)

    @property
    def iso_day(self) -> str:
        return self.day.isoformat()


def ward_clock(db: Session) -> Clock:
    if DEMO:
        from .models import DemoClock

        c = db.get(DemoClock, 1)
        if c:
            elapsed = (datetime.now(timezone.utc) - c.anchor).total_seconds() // 60
            return Clock(c.day, int(c.base_minutes + elapsed))
    now = datetime.now(SGT)
    return Clock(now.date(), now.hour * 60 + now.minute)
