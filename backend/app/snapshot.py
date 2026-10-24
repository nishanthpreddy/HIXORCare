"""The ward snapshot the tablet app renders: one read, shaped like frontend/src/domain/types.ts (Snapshot)."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m
from .db import Clock

AUDIT_LIMIT = 300
MED_HISTORY_DAYS = 6  # the nurse manager's medication trend covers today and the six days before


def _f(x):
    return float(x) if x is not None else None


def build(db: Session, clk: Clock, ward_id: str) -> dict:
    T = clk.mins
    ward = db.get(m.Ward, ward_id)
    home = db.get(m.Home, ward.home_id)
    residents = db.scalars(select(m.Resident).where(m.Resident.ward_id == ward_id).order_by(m.Resident.bed)).all()
    rids = [r.id for r in residents]
    orders = db.scalars(select(m.MedicationOrder).where(m.MedicationOrder.resident_id.in_(rids)).order_by(m.MedicationOrder.resident_id, m.MedicationOrder.id)).all()
    oids = [o.id for o in orders]
    since = clk.dt(-7 * 1440)

    def order_json(o: m.MedicationOrder) -> dict:
        d = {
            "id": o.id, "rid": o.resident_id, "drug": o.drug, "dose": o.dose, "route": o.route, "slots": o.slots, "indication": o.indication,
            "classes": o.classes, "supply": o.supply, "ownSupply": o.own_supply, "highAlert": o.high_alert, "cd": o.cd, "stockUnit": o.stock_unit, "timeCritical": o.time_critical,
            "weekly": o.weekly, "check": o.check_rule, "instructions": o.instructions, "review": o.review.isoformat() if o.review else None,
            "prn": o.prn, "prescriber": o.prescriber, "start": o.start.isoformat(),
        }
        if o.transcribed_by:
            d["transcribed"] = {"by": o.transcribed_by, "t": T(o.transcribed_at), "source": o.transcription_source, "endorseDue": T(o.endorse_due),
                                "verifiedBy": o.verified_by, "verifiedT": T(o.verified_at)}
        if o.stopped_at:
            d["stopped"] = {"t": T(o.stopped_at), "by": o.stopped_by, "reason": o.stop_reason}
        return {k: v for k, v in d.items() if v is not None}

    return {
        "day": clk.iso_day,
        "now": clk.now,
        "home": {"id": home.id, "name": home.name, "organisation": home.organisation},
        "ward": {"id": ward.id, "code": ward.code, "name": ward.name, "beds": ward.beds},
        "staff": [{"id": s.id, "name": s.name, "short": s.short, "role": s.role, "title": s.title, "shift": s.shift}
                  for s in db.scalars(select(m.Staff).where(m.Staff.home_id == home.id).order_by(m.Staff.id))],
        "residents": [{
            "id": r.id, "bed": r.bed, "salutation": r.salutation, "name": r.name, "preferred": r.preferred, "sex": r.sex, "dob": r.dob.isoformat(),
            "nric": r.nric_masked, "admitted": r.admitted.isoformat(), "languages": r.languages, "religion": r.religion, "diagnoses": r.diagnoses,
            "allergies": [{"substance": a.substance, "classes": a.classes, "reaction": a.reaction, "severity": a.severity, "type": a.type} for a in r.allergies],
            "acp": r.acp, "decisionMaker": r.decision_maker, "diet": r.diet, "swallow": r.swallow, "mobility": r.mobility, "continence": r.continence,
            "status": r.status, **({"statusNote": r.status_note} if r.status_note else {}), "flags": r.flags, **({"stay": r.stay} if r.stay else {}),
        } for r in residents],
        "orders": [order_json(o) for o in orders],
        "decoyPacks": [{"barcode": d.barcode, "label": d.label, "drug": d.drug, "classes": d.classes, "owner": d.owner, "note": d.note}
                       for d in db.scalars(select(m.DemoPack))],
        "cdStock": {c.order_id: {"balance": _f(c.balance), "unit": c.unit} for c in db.scalars(select(m.CdStock).where(m.CdStock.order_id.in_(oids)))},
        "cdLedger": [{"seq": e.seq, "orderId": e.order_id, "t": T(e.at), "kind": e.kind, "change": _f(e.change), "balance": _f(e.balance), "by": e.by_id,
                      "witness": e.witness_id, "note": e.note}
                     for e in db.scalars(select(m.CdRegisterEntry).where(m.CdRegisterEntry.order_id.in_(oids)).order_by(m.CdRegisterEntry.seq))],
        "administrations": [{
            "id": str(a.id), "orderId": a.order_id, "rid": a.resident_id, "slot": a.slot, "day": (a.day - clk.day).days, "outcome": a.outcome,
            "reason": a.reason, "note": a.note, "values": a.values, "witness": a.witness_id, "preparedBy": a.prepared_by, "scan": a.scan, "t": T(a.at), "by": a.by_id,
        } for a in db.scalars(select(m.Administration).where(m.Administration.resident_id.in_(rids), m.Administration.day >= clk.day - timedelta(days=MED_HISTORY_DAYS)))],
        "idChecks": [{"rid": c.resident_id, "slot": c.slot, "t": T(c.at), "by": c.by_id, "method": c.method, "reason": c.reason}
                     for c in db.scalars(select(m.IdentityCheck).where(m.IdentityCheck.resident_id.in_(rids), m.IdentityCheck.day == clk.day))],
        "prn": [{
            "id": p.id, "orderId": p.order_id, "t": T(p.at), "by": p.by_id, "witness": p.witness_id, "reason": p.reason, "pain": p.pain,
            "effect": ({**p.effect, "t": T(datetime.fromisoformat(p.effect["t"]))} if p.effect else None),
        } for p in db.scalars(select(m.PrnDose).where(m.PrnDose.order_id.in_(oids), m.PrnDose.at >= since))],
        "vitals": [{
            "id": str(v.id), "rid": v.resident_id, "t": T(v.at), "rr": v.rr, "spo2": v.spo2, "o2": v.o2, "sbp": v.sbp, "dbp": v.dbp, "pulse": v.pulse,
            "acvpu": v.acvpu, "temp": _f(v.temp), "by": v.by_id, "note": v.note, "news2": v.news2,
        } for v in db.scalars(select(m.Vitals).where(m.Vitals.resident_id.in_(rids), m.Vitals.at >= since).order_by(m.Vitals.at))],
        "glucose": [{"id": str(g.id), "rid": g.resident_id, "t": T(g.at), "value": _f(g.value), "by": g.by_id, "note": g.note}
                    for g in db.scalars(select(m.Glucose).where(m.Glucose.resident_id.in_(rids), m.Glucose.at >= since))],
        "alerts": [{
            "id": a.id, "rid": a.resident_id, "kind": a.kind, "severity": a.severity, "title": a.title, "detail": a.detail, "t": T(a.at), "status": a.status,
            "ackBy": a.ack_by, "ackT": T(a.ack_at), "dueT": T(a.due_at), "dueLabel": a.due_label, "resolvedBy": a.resolved_by, "resolvedT": T(a.resolved_at),
        } for a in db.scalars(select(m.Alert).where((m.Alert.resident_id.in_(rids)) | (m.Alert.resident_id.is_(None))).order_by(m.Alert.at.desc()))],
        "tasks": [{
            "id": t.id, "rid": t.resident_id, "text": t.text, "due": T(t.due_at), "repeat": t.repeat, "category": t.category, "assessment": t.assessment,
            "done": {"t": T(t.done_at), "by": t.done_by, "note": t.done_note} if t.done_at else None,
        } for t in db.scalars(select(m.Task).where(m.Task.resident_id.in_(rids), (m.Task.done_at.is_(None)) | (m.Task.done_at >= clk.dt(-1440))))],
        "notes": [{"id": n.id, "rid": n.resident_id, "t": T(n.at), "by": n.by_id, "kind": n.kind, "text": n.text}
                  for n in db.scalars(select(m.Note).where(m.Note.resident_id.in_(rids), m.Note.at >= clk.dt(-30 * 1440)))],
        "assessments": [{"id": a.id, "rid": a.resident_id, "type": a.type, "score": a.score, "t": T(a.at), "by": a.by_id, "signedBy": a.signed_by, "answers": a.answers}
                        for a in db.scalars(select(m.AssessmentRecord).where(m.AssessmentRecord.resident_id.in_(rids)))],
        "carePlans": [{
            "rid": c.resident_id, "signedBy": c.signed_by, "signedT": T(c.signed_at), "reviewDue": c.review_due.isoformat() if c.review_due else None,
            "problems": [{"id": p.id, "title": p.title, "basis": p.basis, "goal": p.goal, "interventions": p.interventions} for p in c.problems],
        } for c in db.scalars(select(m.CarePlan).where(m.CarePlan.resident_id.in_(rids)))],
        "suggestions": [{"id": s.id, "rid": s.resident_id, "source": s.source, "problem": s.problem, "basis": s.basis, "items": s.items, "t": T(s.at), "status": s.status}
                        for s in db.scalars(select(m.Suggestion).where(m.Suggestion.resident_id.in_(rids)).order_by(m.Suggestion.at.desc()))],
        "wounds": [{
            "id": w.id, "rid": w.resident_id, "site": w.site, "type": w.type, "found": w.found.isoformat(), "dressing": w.dressing, "nextDressing": T(w.next_dressing_at),
            "measurements": [{"t": T(x.at), "length": _f(x.length), "width": _f(x.width), "depth": _f(x.depth), "bed": x.bed, "exudate": x.exudate, "by": x.by_id, "photo": x.photo}
                             for x in w.measurements],
        } for w in db.scalars(select(m.Wound).where(m.Wound.resident_id.in_(rids)))],
        "handovers": [{"id": h.id, "shift": h.shift, "t": T(h.at), "from": h.from_id, "to": h.to_id, "summary": h.summary}
                      for h in db.scalars(select(m.Handover).order_by(m.Handover.at.desc()).limit(10))],
        "sbar": [{"id": x.id, "rid": x.resident_id, "t": T(x.at), "by": x.by_id, "to": x.to_id, "text": x.text}
                 for x in db.scalars(select(m.SbarMessage).where(m.SbarMessage.resident_id.in_(rids)).order_by(m.SbarMessage.at.desc()))],
        "audit": [{"seq": e.seq, "t": T(e.at), "by": e.by_id, "action": e.action, "rid": e.resident_id, "detail": e.detail, "hash": e.hash[:8]}
                  for e in db.scalars(select(m.AuditEntry).order_by(m.AuditEntry.seq.desc()).limit(AUDIT_LIMIT))],
    }
