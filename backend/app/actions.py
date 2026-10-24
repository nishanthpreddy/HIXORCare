"""Server actions. Each one declares the roles allowed to run it (deny by default) and enforces
the safety rules; the tablet app only previews them.

Mirrors frontend/src/api/engine.ts so demo mode and server mode behave the same.
"""
from __future__ import annotations

import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m
from .audit import append_audit
from .auth import check_pin
from .db import Clock
from .rules import (
    ASSESSMENTS, ESCALATION, allergy_clash, can_give_meds, cd_units, check_advice, is_rn, needs_witness, news2, news2_risk, rn_only,
    score_assessment, verify_scan, wristband,
)


class ActionError(Exception):
    STATUS = {"blocked": 409, "forbidden": 403, "invalid": 422, "pin": 401}

    def __init__(self, code: str, message: str, detail: str | None = None):
        super().__init__(message)
        self.code, self.message, self.detail = code, message, detail

    @property
    def status(self) -> int:
        return self.STATUS[self.code]

    def body(self) -> dict:
        return {"ok": False, "code": self.code, "message": self.message, **({"detail": self.detail} if self.detail else {})}


@dataclass
class Ctx:
    db: Session
    clk: Clock
    me: m.Staff
    message: str | None = None
    data: dict | None = field(default=None)

    @property
    def now(self):
        return self.clk.at_now()

    def audit(self, action: str, rid: str | None, detail: str) -> None:
        append_audit(self.db, self.me.id, action, rid, detail, self.now)

    def staff(self, sid: str | None) -> m.Staff | None:
        return self.db.get(m.Staff, sid) if sid else None


Handler = Callable[[Ctx, dict], None]
ACTIONS: dict[str, tuple[set[str] | None, Handler]] = {}


def action(name: str, roles: set[str] | None):
    def wrap(fn: Handler) -> Handler:
        ACTIONS[name] = (roles, fn)
        return fn
    return wrap


def uid(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(5)}"


def full_name(r: m.Resident) -> str:
    return f"{r.salutation} {r.name}"


def resident(ctx: Ctx, rid: str) -> m.Resident:
    r = ctx.db.get(m.Resident, rid)
    if not r:
        raise ActionError("invalid", "Resident not found.")
    return r


def need_pin(ctx: Ctx, staff_id: str | None, pin: str | None, who: str = "That") -> m.Staff:
    s = ctx.staff(staff_id)
    if not s or not check_pin(pin, s.pin_hash):
        raise ActionError("pin", f"{who} PIN is not right." if who != "That" else "That PIN is not right. Try again.")
    return s


def witness(ctx: Ctx, b: dict) -> m.Staff:
    w = ctx.staff(b.get("witnessId"))
    if not w:
        raise ActionError("invalid", "Choose the second nurse.")
    if w.id == ctx.me.id:
        raise ActionError("invalid", "The second check must be done by another nurse.")
    if not (can_give_meds(w.role) or w.role == "NM"):
        raise ActionError("forbidden", f"{w.short} cannot act as second checker", "Second checks need a registered or enrolled nurse.")
    need_pin(ctx, w.id, b.get("witnessPin"), f"{w.short}'s")
    return w


def raise_alert(ctx: Ctx, rid: str | None, kind: str, severity: str, title: str, detail: str, due_min: int | None = None, due_label: str | None = None) -> m.Alert:
    a = m.Alert(id=uid("a"), resident_id=rid, kind=kind, severity=severity, title=title, detail=detail, at=ctx.now, status="open",
                due_at=ctx.clk.dt(due_min) if due_min is not None else None, due_label=due_label)
    ctx.db.add(a)
    return a


def resolve_alerts(ctx: Ctx, rid: str, kind: str) -> None:
    for a in ctx.db.scalars(select(m.Alert).where(m.Alert.resident_id == rid, m.Alert.kind == kind, m.Alert.status != "resolved")):
        a.status, a.resolved_by, a.resolved_at = "resolved", ctx.me.id, ctx.now


def cd_take(ctx: Ctx, o: m.MedicationOrder, witness_id: str | None, note: str) -> str:
    stock = ctx.db.get(m.CdStock, o.id, with_for_update=True)
    used = Decimal(str(cd_units(o)))
    if stock.balance < used:
        raise ActionError("blocked", "Not enough stock in the register", f"Balance is {stock.balance} {stock.unit}. Count the stock and tell the nurse manager.")
    before = stock.balance
    stock.balance = before - used
    ctx.db.add(m.CdRegisterEntry(order_id=o.id, at=ctx.now, kind="given", change=-used, balance=stock.balance, by_id=ctx.me.id, witness_id=witness_id, note=note))
    return f" CD register: {before.normalize()} → {stock.balance.normalize()} {stock.unit}."


def slot_orders(ctx: Ctx, rid: str, slot: str) -> list[m.MedicationOrder]:
    weekday = (ctx.clk.day.weekday() + 1) % 7  # Python Monday=0 → Sunday=0
    return [o for o in ctx.db.scalars(select(m.MedicationOrder).where(m.MedicationOrder.resident_id == rid))
            if not o.prn and slot in o.slots and (o.weekly is None or o.weekly == weekday)]


# ---------- Medication ----------

@action("identity.confirm", {"RN", "EN"})
def identity_confirm(ctx: Ctx, b: dict) -> None:
    r = resident(ctx, b["rid"])
    if b.get("method") == "wristband" and b.get("barcode") and b["barcode"] != wristband(r.id):
        other = next((x for x in ctx.db.scalars(select(m.Resident)) if wristband(x.id) == b["barcode"]), None)
        ctx.audit("Identity mismatch", r.id, f"Scanned wristband of {full_name(other) if other else 'unknown person'} while giving {full_name(r)}'s medicines.")
        ctx.db.commit()
        raise ActionError("blocked", "Wrong wristband",
                          f"This wristband belongs to {full_name(other)} ({other.bed}). Find {r.preferred} and scan again." if other else "Wristband not recognised.")
    if b.get("method") == "manual" and not b.get("reason"):
        raise ActionError("invalid", "Give a reason for confirming identity without the wristband.")
    ctx.db.add(m.IdentityCheck(resident_id=r.id, slot=b["slot"], day=ctx.clk.day, at=ctx.now, by_id=ctx.me.id, method=b["method"], reason=b.get("reason")))
    ctx.audit("Identity confirmed", r.id, f"Wristband scanned for the {b['slot']} round." if b["method"] == "wristband"
              else f"Confirmed by photo and two identifiers for the {b['slot']} round. Reason: {b['reason']}.")


@action("scan.verify", {"RN", "EN"})
def scan_verify(ctx: Ctx, b: dict) -> None:
    r = resident(ctx, b["rid"])
    res = verify_scan(r, slot_orders(ctx, r.id, b["slot"]), ctx.db.scalars(select(m.MedicationOrder)).all(), ctx.db.scalars(select(m.Resident)).all(),
                      ctx.db.scalars(select(m.DemoPack)).all(), ctx.clk.iso_day, b["slot"], b["barcode"])
    if not res.ok:
        ctx.audit("Allergy block" if res.kind == "allergy" else "Scan blocked", r.id, f"{res.title} {res.detail}")
        if res.kind in ("allergy", "wrong-resident"):
            raise_alert(ctx, r.id, "near-miss", "medium", "Near miss: allergy block" if res.kind == "allergy" else "Near miss: wrong resident",
                        f"{res.title} Stopped at the bedside by {ctx.me.name}. Review for the medication safety log.")
    else:
        ctx.audit("Pack scanned", r.id, f"{res.title}: {res.detail}")
    ctx.data = res.__dict__


@action("dose.record", {"RN", "EN"})
def dose_record(ctx: Ctx, b: dict) -> None:
    db = ctx.db
    o = db.get(m.MedicationOrder, b.get("orderId"))
    if not o:
        raise ActionError("invalid", "Medicine order not found.")
    r = resident(ctx, o.resident_id)
    slot, outcome = b["slot"], b["outcome"]
    if r.status != "in":
        raise ActionError("blocked", f"{r.preferred} is away from the home", r.status_note)
    if db.scalar(select(m.Administration).where(m.Administration.order_id == o.id, m.Administration.slot == slot, m.Administration.day == ctx.clk.day)):
        raise ActionError("invalid", "This dose is already recorded.")
    w = None
    values = b.get("values")
    if outcome == "given":
        if o.transcribed_by and not o.verified_by:
            raise ActionError("blocked", "Waiting for RN verification", f"{o.drug} was transcribed on admission and must be verified by a different RN before the first dose.")
        if rn_only(o) and not is_rn(ctx.me.role):
            raise ActionError("forbidden", "A registered nurse must give this",
                              f"{'Controlled drugs' if o.cd else 'Injectables'} are prepared and given by an RN. You can act as the second checker.")
        if not db.scalar(select(m.IdentityCheck).where(m.IdentityCheck.resident_id == r.id, m.IdentityCheck.slot == slot, m.IdentityCheck.day == ctx.clk.day)):
            raise ActionError("blocked", "Confirm identity first", "Scan the wristband before giving medicines.")
        if not b.get("scan"):
            raise ActionError("blocked", "Scan the medicine first", "Scan the blister pack or original pack so the system can check it.")
        clash = allergy_clash(r.allergies, o.classes)
        if clash:
            raise ActionError("blocked", f"Allergy: {clash.substance}", f"{r.preferred} has a recorded {clash.type} to {clash.substance} ({clash.reaction}). Contact the doctor.")
        if o.check_rule:
            field_ = o.check_rule["field"]
            if not values or values.get(field_) in (None, ""):
                raise ActionError("invalid", f"Enter {o.check_rule['label'].lower()} first.")
            adv = check_advice(o.check_rule, float(values[field_]))
            if adv and adv[0] == "critical":
                raise ActionError("blocked", "Hold this dose", adv[1])
        if needs_witness(o):
            w = witness(ctx, b)
    elif not b.get("reason"):
        raise ActionError("invalid", "Choose a reason.")

    stock_note = cd_take(ctx, o, w.id if w else None, f"{slot} dose for {full_name(r)}") if outcome == "given" and o.cd else ""
    db.add(m.Administration(order_id=o.id, resident_id=r.id, slot=slot, day=ctx.clk.day, outcome=outcome, reason=b.get("reason"), note=b.get("note"),
                            values=values, witness_id=w.id if w else None, prepared_by=ctx.me.id if outcome == "given" else None, scan=b.get("scan"),
                            at=ctx.now, by_id=ctx.me.id))
    if o.check_rule and o.check_rule["field"] == "cbg" and values and values.get("cbg") is not None:
        db.add(m.Glucose(resident_id=r.id, at=ctx.now, value=values["cbg"], by_id=ctx.me.id, note=f"Before {o.drug.split(' ')[0].lower()}"))
    verb = {"given": "Dose given", "held": "Dose held", "refused": "Dose refused", "unavailable": "Dose not available", "omitted": "Dose omitted"}.get(outcome, "Dose recorded")
    vals = f" {', '.join(f'{k.upper()} {v}' for k, v in values.items())}." if values else ""
    ctx.audit(verb, r.id, f"{o.drug} {o.dose}, {slot} dose.{f' Reason: ' + b['reason'] + '.' if b.get('reason') else ''}"
                          f"{f' Second check: {w.name} ({w.role}).' if w else ''}{vals}{stock_note}")
    if outcome != "given" and (o.time_critical or o.high_alert or outcome in ("unavailable", "refused")):
        state = "held" if outcome == "held" else "refused" if outcome == "refused" else "not given"
        raise_alert(ctx, r.id, "refused" if outcome == "refused" else "missed-dose", "high" if (o.time_critical or o.high_alert) else "low",
                    f"{o.drug.split(' (')[0]} {state}",
                    f"{slot} dose. {b['reason']}.{' Time-critical medicine: inform the doctor.' if o.time_critical else ''}{(' ' + b['note']) if b.get('note') else ''}")
    ctx.message = stock_note.strip() or None


@action("order.verify", {"RN", "NM"})
def order_verify(ctx: Ctx, b: dict) -> None:
    orders = [o for o in ctx.db.scalars(select(m.MedicationOrder).where(m.MedicationOrder.resident_id == b["rid"])) if o.transcribed_by and not o.verified_by]
    if not orders:
        raise ActionError("invalid", "Nothing is waiting for verification.")
    if any(o.transcribed_by == ctx.me.id for o in orders):
        raise ActionError("blocked", "A different RN must verify", "You transcribed these medicines, so another RN has to check them.")
    need_pin(ctx, ctx.me.id, b.get("pin"))
    for o in orders:
        o.verified_by, o.verified_at = ctx.me.id, ctx.now
    resolve_alerts(ctx, b["rid"], "transcription")
    ctx.audit("Transcription verified", b["rid"], f"{len(orders)} admission medicines checked against {orders[0].transcription_source}: "
                                                  f"{', '.join(o.drug for o in orders)}. Doctor endorsement still due.")


@action("prn.give", {"RN", "EN"})
def prn_give(ctx: Ctx, b: dict) -> None:
    o = ctx.db.get(m.MedicationOrder, b.get("orderId"))
    if not o or not o.prn:
        raise ActionError("invalid", "PRN order not found.")
    r = resident(ctx, o.resident_id)
    doses = ctx.db.scalars(select(m.PrnDose).where(m.PrnDose.order_id == o.id).order_by(m.PrnDose.at.desc())).all()
    in24 = [d for d in doses if d.at > ctx.now - timedelta(hours=24)]
    if len(in24) >= o.prn["maxPer24h"]:
        raise ActionError("blocked", "Not allowed yet", f"Maximum of {o.prn['maxPer24h']} doses in 24 hours reached.")
    if doses and ctx.now < doses[0].at + timedelta(hours=o.prn["minHours"]):
        nxt = ctx.clk.mins(doses[0].at + timedelta(hours=o.prn["minHours"]))
        raise ActionError("blocked", "Not allowed yet", f"Too soon. Next dose allowed at {nxt // 60 % 24:02d}:{nxt % 60:02d}.")
    if rn_only(o) and not is_rn(ctx.me.role):
        raise ActionError("forbidden", "A registered nurse must give this", "Controlled drugs and injectables are prepared and given by an RN.")
    if not b.get("reason"):
        raise ActionError("invalid", "Give the reason for this dose.")
    w = witness(ctx, b) if needs_witness(o) else None
    stock_note = cd_take(ctx, o, w.id if w else None, f"PRN for {full_name(r)}: {b['reason']}") if o.cd else ""
    pid = uid("p")
    ctx.db.add(m.PrnDose(id=pid, order_id=o.id, at=ctx.now, by_id=ctx.me.id, witness_id=w.id if w else None, reason=b["reason"], pain=b.get("pain")))
    ctx.db.add(m.Task(id=uid("t"), resident_id=r.id, text=f"Check effect of {o.drug.split(' ')[0].lower()} (PRN)", due_at=ctx.clk.dt(ctx.clk.now + 60), category="medication"))
    pain = f", pain {b['pain']}/10" if b.get("pain") is not None else ""
    ctx.audit("PRN given", r.id, f"{o.drug} {o.dose}. Reason: {b['reason']}{pain}.{stock_note}")
    ctx.data, ctx.message = {"id": pid}, "Effect check added for 1 hour from now."


@action("prn.effect", {"RN", "EN"})
def prn_effect(ctx: Ctx, b: dict) -> None:
    p = ctx.db.get(m.PrnDose, b.get("prnId"))
    if not p:
        raise ActionError("invalid", "PRN dose not found.")
    p.effect = {"t": ctx.now.isoformat(), "by": ctx.me.id, "text": b.get("text") or "", "result": b["result"]}
    o = ctx.db.get(m.MedicationOrder, p.order_id)
    task = ctx.db.scalar(select(m.Task).where(m.Task.resident_id == o.resident_id, m.Task.done_at.is_(None), m.Task.text.like("Check effect of%")))
    if task:
        task.done_at, task.done_by = ctx.now, ctx.me.id
    ctx.audit("PRN effect recorded", o.resident_id, f"{o.drug}: {b['result']}. {b.get('text') or ''}".strip())


# ---------- Care ----------

@action("vitals.record", {"RN", "EN", "CA"})
def vitals_record(ctx: Ctx, b: dict) -> None:
    r = resident(ctx, b["rid"])
    try:
        v = dict(rr=float(b["rr"]), spo2=float(b["spo2"]), o2=bool(b.get("o2")), sbp=float(b["sbp"]), pulse=float(b["pulse"]), acvpu=b["acvpu"], temp=float(b["temp"]))
        dbp = int(float(b["dbp"]))
    except (KeyError, TypeError, ValueError):
        raise ActionError("invalid", "Fill in every reading.")
    score, risk = news2(**v), news2_risk(**v)
    pol = ESCALATION[risk]
    ctx.db.add(m.Vitals(resident_id=r.id, at=ctx.now, rr=int(v["rr"]), spo2=int(v["spo2"]), o2=v["o2"], sbp=int(v["sbp"]), dbp=dbp, pulse=int(v["pulse"]),
                        acvpu=v["acvpu"], temp=v["temp"], news2=score, by_id=ctx.me.id, note=b.get("note") or None))
    resolve_alerts(ctx, r.id, "news2")
    alert_id = None
    if pol["alert"]:
        title = {"high": "emergency response", "medium": "urgent review"}.get(risk, "single red score")
        a = raise_alert(ctx, r.id, "news2", "high" if risk in ("high", "medium") else "medium", f"NEWS2 {score}: {title}",
                        f"Temp {v['temp']} °C, RR {int(v['rr'])}, SpO₂ {int(v['spo2'])}%{' on oxygen' if v['o2'] else ''}, pulse {int(v['pulse'])}, "
                        f"BP {int(v['sbp'])}/{dbp}, {'alert' if v['acvpu'] == 'A' else 'ACVPU ' + v['acvpu']}. {pol['action']}",
                        ctx.clk.now + pol["obs_every"], "Next observations")
        alert_id = a.id
    obs = ctx.db.scalar(select(m.Task).where(m.Task.resident_id == r.id, m.Task.done_at.is_(None), m.Task.category == "obs",
                                             m.Task.due_at <= ctx.clk.dt(ctx.clk.now + 60), ~m.Task.text.ilike("%glucose%")).order_by(m.Task.due_at))
    if obs:
        obs.done_at, obs.done_by = ctx.now, ctx.me.id
    if pol["obs_every"] <= 60:
        ctx.db.add(m.Task(id=uid("t"), resident_id=r.id, text=f"Observations (NEWS2 {score})", due_at=ctx.clk.dt(ctx.clk.now + pol["obs_every"]), category="obs"))
    ctx.audit("Observations recorded", r.id, f"NEWS2 {score} ({pol['label'].lower()} risk).{' Alert raised to nurse in charge.' if pol['alert'] else ''}")
    ctx.data = {"score": score, "risk": risk, "alertId": alert_id}


@action("alert.ack", {"RN", "EN", "NM"})
def alert_ack(ctx: Ctx, b: dict) -> None:
    a = ctx.db.get(m.Alert, b.get("id"))
    if not a:
        raise ActionError("invalid", "Alert not found.")
    a.status, a.ack_by, a.ack_at = "ack", ctx.me.id, ctx.now
    ctx.audit("Alert acknowledged", a.resident_id, a.title)


@action("alert.resolve", {"RN", "NM"})
def alert_resolve(ctx: Ctx, b: dict) -> None:
    a = ctx.db.get(m.Alert, b.get("id"))
    if not a:
        raise ActionError("invalid", "Alert not found.")
    a.status, a.resolved_by, a.resolved_at = "resolved", ctx.me.id, ctx.now
    ctx.audit("Alert closed", a.resident_id, f"{a.title}.{(' ' + b['note']) if b.get('note') else ''}")


@action("sbar.send", {"RN", "EN"})
def sbar_send(ctx: Ctx, b: dict) -> None:
    if not (b.get("text") or "").strip():
        raise ActionError("invalid", "The message is empty.")
    if not b.get("reviewed"):
        raise ActionError("invalid", "Confirm that you have checked the draft.")
    to = ctx.staff(b.get("to"))
    ctx.db.add(m.SbarMessage(id=uid("sb"), resident_id=b["rid"], at=ctx.now, by_id=ctx.me.id, to_id=to.id, text=b["text"]))
    ctx.db.add(m.Note(id=uid("n"), resident_id=b["rid"], at=ctx.now, by_id=ctx.me.id, kind="SBAR to doctor", text=b["text"]))
    ctx.audit("SBAR sent", b["rid"], f"To {to.name}. Drafted by assistant, checked and signed by {ctx.me.name}.")


STEP = {"hourly": 60, "2-hourly": 120, "30 min": 30}


@action("task.complete", {"RN", "EN", "CA"})
def task_complete(ctx: Ctx, b: dict) -> None:
    t = ctx.db.get(m.Task, b.get("id"))
    if not t:
        raise ActionError("invalid", "Task not found.")
    if t.done_at:
        raise ActionError("invalid", "Already done.")
    t.done_at, t.done_by, t.done_note = ctx.now, ctx.me.id, b.get("note")
    step = STEP.get(t.repeat or "")
    if step:
        text_ = t.text
        if t.category == "skin" and t.text.startswith("Reposition"):
            text_ = "Reposition (right side)" if "left" in t.text else "Reposition (left side)"
        ctx.db.add(m.Task(id=uid("t"), resident_id=t.resident_id, text=text_, due_at=max(t.due_at, ctx.now) + timedelta(minutes=step), repeat=t.repeat,
                          category=t.category, assessment=t.assessment))
    ctx.audit("Care task done", t.resident_id, f"{t.text}.{(' ' + b['note']) if b.get('note') else ''}")


@action("note.add", {"RN", "EN", "CA", "NM", "DR"})
def note_add(ctx: Ctx, b: dict) -> None:
    text_ = (b.get("text") or "").strip()
    if not text_:
        raise ActionError("invalid", "Write the note first.")
    ctx.db.add(m.Note(id=uid("n"), resident_id=b["rid"], at=ctx.now, by_id=ctx.me.id, kind=b.get("kind") or "Nursing", text=text_))
    ctx.audit("Note added", b["rid"], f"{b.get('kind') or 'Nursing'} note.")


@action("assessment.submit", {"RN", "EN"})
def assessment_submit(ctx: Ctx, b: dict) -> None:
    kind = b.get("type")
    if kind not in ASSESSMENTS:
        raise ActionError("invalid", "Unknown assessment.")
    try:
        score, bd = score_assessment(kind, b.get("answers") or {})
    except (ValueError, IndexError, TypeError):
        raise ActionError("invalid", "Answer every question.")
    need_pin(ctx, ctx.me.id, b.get("pin"))
    d = ASSESSMENTS[kind]
    rid = b["rid"]
    ctx.db.add(m.AssessmentRecord(id=uid("as"), resident_id=rid, type=kind, score=score, answers=b["answers"], at=ctx.now, by_id=ctx.me.id,
                                  signed_by=ctx.me.id if ctx.me.role == "RN" else None))
    task = ctx.db.scalar(select(m.Task).where(m.Task.resident_id == rid, m.Task.done_at.is_(None), m.Task.assessment == kind))
    if task:
        task.done_at, task.done_by = ctx.now, ctx.me.id
    items = d["suggest"].get(bd["level"]) or []
    sid = None
    if items:
        plan = ctx.db.get(m.CarePlan, rid)
        existing = {i.lower() for p in (plan.problems if plan else []) for i in p.interventions}
        fresh = [i for i in items if i.lower() not in existing]
        if fresh:
            sid = uid("sg")
            ctx.db.add(m.Suggestion(id=sid, resident_id=rid, source=d["name"], problem=f"{bd['label']}: {d['short'].lower()}",
                                    basis=f"{d['name']} {score} on {ctx.clk.day.strftime('%-d %b')}", items=fresh, at=ctx.now))
    ctx.db.flush()
    if not ctx.db.scalar(select(m.Task).where(m.Task.resident_id == rid, m.Task.done_at.is_(None), m.Task.assessment.is_not(None))):
        resolve_alerts(ctx, rid, "assessment")
    ctx.audit("Assessment signed", rid, f"{d['name']}: {score} ({bd['label']}).{' Care plan suggestions created.' if sid else ''}")
    ctx.data = {"score": score, "band": bd, "suggestionId": sid}


@action("careplan.approve", {"RN", "NM"})
def careplan_approve(ctx: Ctx, b: dict) -> None:
    sg = ctx.db.get(m.Suggestion, b.get("suggestionId"))
    if not sg:
        raise ActionError("invalid", "Suggestion not found.")
    need_pin(ctx, ctx.me.id, b.get("pin"))
    items = [i for i in (b.get("items") or []) if i in sg.items]
    if not items:
        raise ActionError("invalid", "Keep at least one item, or dismiss the suggestion.")
    plan = ctx.db.get(m.CarePlan, sg.resident_id)
    if not plan:
        plan = m.CarePlan(resident_id=sg.resident_id)
        ctx.db.add(plan)
        ctx.db.flush()
    ctx.db.add(m.CareProblem(id=uid("cp"), resident_id=sg.resident_id, position=len(plan.problems), title=sg.problem[:1].upper() + sg.problem[1:],
                             basis=sg.basis, goal="Agreed with resident and family at next review", interventions=items))
    plan.signed_by, plan.signed_at, plan.review_due = ctx.me.id, ctx.now, ctx.clk.day + timedelta(days=30)
    sg.status = "approved"
    for it in items:
        if re.search(r"hourly|reposition|chart|check", it, re.I):
            ctx.db.add(m.Task(id=uid("t"), resident_id=sg.resident_id, text=it, due_at=ctx.clk.dt(ctx.clk.now + 60), category="care plan"))
    removed = len(sg.items) - len(items)
    ctx.audit("Care plan signed", sg.resident_id, f'Added "{sg.problem}" with {len(items)} interventions{f" ({removed} suggestions removed)" if removed else ""}.')


@action("suggestion.dismiss", {"RN", "NM"})
def suggestion_dismiss(ctx: Ctx, b: dict) -> None:
    sg = ctx.db.get(m.Suggestion, b.get("suggestionId"))
    if not sg:
        raise ActionError("invalid", "Suggestion not found.")
    sg.status = "dismissed"
    ctx.audit("Suggestion dismissed", sg.resident_id, sg.problem)


@action("wound.measure", {"RN", "EN"})
def wound_measure(ctx: Ctx, b: dict) -> None:
    w = ctx.db.get(m.Wound, b.get("woundId"))
    if not w:
        raise ActionError("invalid", "Wound not found.")
    try:
        length, width = float(b["length"]), float(b["width"])
    except (KeyError, TypeError, ValueError):
        raise ActionError("invalid", "Enter length and width in cm.")
    if length <= 0 or width <= 0:
        raise ActionError("invalid", "Enter length and width in cm.")
    photo = b.get("photo")
    if photo and (not str(photo).startswith("data:image/") or len(photo) > 2_000_000):
        raise ActionError("invalid", "The photo must be an image under 1.5 MB.")
    ctx.db.add(m.WoundMeasurement(wound_id=w.id, at=ctx.now, length=length, width=width, depth=float(b.get("depth") or 0), bed=b.get("bed") or "",
                                  exudate=b.get("exudate") or "", by_id=ctx.me.id, photo=photo))
    if b.get("dressed"):
        days = re.search(r"every (\d+) days", w.dressing)
        w.next_dressing_at = ctx.now + timedelta(days=int(days.group(1)) if days else 3)
        task = ctx.db.scalar(select(m.Task).where(m.Task.resident_id == w.resident_id, m.Task.done_at.is_(None), m.Task.text.ilike("%dressing%")))
        if task:
            task.done_at, task.done_by = ctx.now, ctx.me.id
        resolve_alerts(ctx, w.resident_id, "skin")
    ctx.audit("Wound measured", w.resident_id, f"{w.site}: {length} × {width} cm.{' Dressing changed.' if b.get('dressed') else ''}{' Photo added.' if photo else ''}")


@action("handover.sign", {"RN", "EN"})
def handover_sign(ctx: Ctx, b: dict) -> None:
    to = ctx.staff(b.get("toId"))
    if not to or to.id == ctx.me.id:
        raise ActionError("invalid", "Choose the nurse taking over.")
    if not can_give_meds(to.role):
        raise ActionError("forbidden", "Handover must go to a nurse.")
    need_pin(ctx, to.id, b.get("pin"), f"{to.short}'s")
    ctx.db.add(m.Handover(id=uid("h"), shift=b.get("shift") or "", at=ctx.now, from_id=ctx.me.id, to_id=to.id, summary=b.get("summary") or ""))
    ctx.audit("Handover signed", None, f"{b.get('shiftLabel') or 'Shift'} handover. Received by {to.name} ({to.role}).")


def run(db: Session, clk: Clock, me: m.Staff, name: str, body: dict) -> dict:
    if name not in ACTIONS:
        raise ActionError("invalid", f"Unknown action {name}.")
    roles, fn = ACTIONS[name]
    if roles is not None and me.role not in roles:
        raise ActionError("forbidden", "Not allowed for your role", f"{me.title}s cannot do this. Ask a nurse.")
    ctx = Ctx(db, clk, me)
    fn(ctx, body)
    db.commit()
    out: dict = {"ok": True}
    if ctx.data is not None:
        out["data"] = ctx.data
    if ctx.message:
        out["message"] = ctx.message
    return out


__all__ = ["ACTIONS", "ActionError", "run", "date"]
