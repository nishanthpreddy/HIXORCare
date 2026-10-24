"""HIXOR Care ward API.

GET  /api/wards/{ward_id}/snapshot   everything the ward tablet shows
POST /api/auth/sign-in               staff id + PIN → 10-minute token (renewed on every action)
POST /api/actions/{name}             one server action (see app/actions.py)
GET  /api/audit/verify               recompute the audit hash chain
POST /api/integrations/bright/referrals   placeholder for the AIC Bright interface
POST /api/demo/reset, /api/demo/advance   demo mode only
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import models as m
from .actions import ActionError, run
from .audit import verify_chain
from .auth import check_pin, make_token, read_token
from .db import DEMO, get_db, ward_clock
from .snapshot import build

app = FastAPI(title="HIXOR Care ward API", version="0.1.0")


@app.exception_handler(ActionError)
async def action_error(_: Request, e: ActionError):
    return JSONResponse(e.body(), status_code=e.status)


def current_staff(db: Session = Depends(get_db), authorization: str | None = Header(default=None)) -> m.Staff:
    sid = read_token(authorization.removeprefix("Bearer ").strip()) if authorization else None
    staff = db.get(m.Staff, sid) if sid else None
    if not staff:
        raise HTTPException(401, detail={"ok": False, "code": "forbidden", "message": "Your session has ended. Unlock the tablet again."})
    return staff


@app.get("/api/health")
def health():
    return {"ok": True, "demo": DEMO}


@app.get("/api/wards/{ward_id}/snapshot")
def snapshot(ward_id: str, db: Session = Depends(get_db)):
    # The lock screen shows ward totals before anyone signs in, as on the tablet today.
    if not db.get(m.Ward, ward_id):
        raise HTTPException(404, "Ward not found")
    return build(db, ward_clock(db), ward_id)


class SignIn(BaseModel):
    staffId: str
    pin: str


@app.post("/api/auth/sign-in")
def sign_in(body: SignIn, db: Session = Depends(get_db)):
    s = db.get(m.Staff, body.staffId)
    if not s or not check_pin(body.pin, s.pin_hash):
        return JSONResponse({"ok": False, "code": "pin", "message": "That PIN is not right. Try again."}, status_code=401)
    return {"ok": True, "data": {"token": make_token(s.id), "staff": {"id": s.id, "name": s.name, "role": s.role}}}


@app.post("/api/actions/{name}")
def act(name: str, body: dict, db: Session = Depends(get_db), me: m.Staff = Depends(current_staff)):
    res = run(db, ward_clock(db), me, name, body)
    resp = JSONResponse(res)
    resp.headers["X-Token"] = make_token(me.id)  # sliding session while the nurse is working
    return resp


@app.get("/api/audit/verify")
def audit_verify(db: Session = Depends(get_db), me: m.Staff = Depends(current_staff)):
    ok, broken = verify_chain(db)
    return {"ok": ok, "brokenAt": broken}


@app.post("/api/integrations/bright/referrals", status_code=501)
def bright_referral():
    """Placeholder. AIC referrals arrive from Bright (Open Government Products) system to system;
    the interface spec is not available yet. Incoming referrals will land in Admissions, not the ward."""
    return {"ok": False, "code": "not-implemented", "message": "Bright interface pending the AIC / OGP specification."}


if DEMO:
    from .seed import load

    @app.post("/api/demo/reset")
    def demo_reset(db: Session = Depends(get_db)):
        load(db)
        return {"ok": True}

    class Advance(BaseModel):
        minutes: int

    @app.post("/api/demo/advance")
    def demo_advance(body: Advance, db: Session = Depends(get_db)):
        c = db.get(m.DemoClock, 1)
        c.anchor = c.anchor - timedelta(minutes=body.minutes)
        db.commit()
        return {"ok": True}
