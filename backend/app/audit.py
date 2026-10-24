"""Hash-chained audit trail: each entry's hash covers the previous hash, so any edit or deletion breaks the chain."""
import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import AuditEntry

GENESIS = "0" * 64


def entry_hash(prev: str, at: datetime, by: str, action: str, rid: str | None, detail: str) -> str:
    body = json.dumps({"at": at.astimezone(timezone.utc).isoformat(timespec="microseconds"), "by": by, "action": action, "rid": rid, "detail": detail}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256((prev + body).encode()).hexdigest()


def append_audit(db: Session, by: str, action: str, rid: str | None, detail: str, at: datetime) -> AuditEntry:
    db.execute(text("SELECT pg_advisory_xact_lock(7201)"))  # one writer at a time keeps the chain linear
    prev = db.scalar(select(AuditEntry.hash).order_by(AuditEntry.seq.desc()).limit(1)) or GENESIS
    e = AuditEntry(at=at, by_id=by, action=action, resident_id=rid, detail=detail, prev_hash=prev, hash=entry_hash(prev, at, by, action, rid, detail))
    db.add(e)
    db.flush()
    return e


def verify_chain(db: Session) -> tuple[bool, int | None]:
    """Recompute every hash. Returns (intact, first broken seq)."""
    prev = GENESIS
    for e in db.scalars(select(AuditEntry).order_by(AuditEntry.seq)):
        if e.prev_hash != prev or e.hash != entry_hash(prev, e.at, e.by_id, e.action, e.resident_id, e.detail):
            return False, e.seq
        prev = e.hash
    return True, None
