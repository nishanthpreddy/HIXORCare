"""Load the demo home into PostgreSQL, timed relative to today: Ward 2B (shared/seed.json, which also holds the
home, shifts and staff) and Ward 3A (shared/seed-3a.json).

Run: python -m app.seed
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models as m
from .audit import append_audit
from .auth import hash_pin
from .db import Clock, SessionLocal, today_sg
from .rules import SHARED, news2

DEMO_PIN = "1234"
WARD_FILES = ["seed.json", "seed-3a.json"]


def load(db: Session, day: date | None = None) -> None:
    raw = json.loads((SHARED / "seed.json").read_text())
    day = day or today_sg()
    clk = Clock(day, raw["clockStart"])
    dt = clk.dt

    tables = [t.name for t in reversed(m.Base.metadata.sorted_tables)]
    db.execute(text("SET LOCAL hixor.allow_reset = 'on'"))
    db.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))

    h = raw["home"]
    db.add(m.Home(id=h["id"], name=h["name"], organisation=h["organisation"]))
    wards = [raw] + [json.loads((SHARED / f).read_text()) for f in WARD_FILES[1:]]
    for wr in wards:
        w = wr["ward"]
        db.add(m.Ward(id=w["id"], home_id=h["id"], code=w["code"], name=w["name"], unit=w["unit"], beds=w["beds"]))
    db.flush()
    pin = hash_pin(DEMO_PIN)
    for s in raw["staff"]:
        db.add(m.Staff(id=s["id"], home_id=h["id"], name=s["name"], short=s["short"], role=s["role"], title=s["title"], shift=s["shift"], wards=s["wards"], pin_hash=pin))
    db.flush()

    for wr in wards:
        load_ward(db, wr, clk)
    db.flush()
    for e in sorted((e for wr in wards for e in wr["audit"]), key=lambda e: e["t"]):
        append_audit(db, e["by"], e["action"], e["rid"], e["detail"], dt(e["t"]))

    db.add(m.DemoClock(id=1, day=day, base_minutes=raw["clockStart"], anchor=datetime.now(timezone.utc)))
    db.commit()


def load_ward(db: Session, raw: dict, clk: Clock) -> None:
    dt = clk.dt
    w = raw["ward"]

    for r in raw["residents"]:
        db.add(m.Resident(
            id=r["id"], ward_id=w["id"], bed=r["bed"], salutation=r["salutation"], name=r["name"], preferred=r["preferred"], sex=r["sex"],
            dob=date.fromisoformat(r["dob"]), nric_masked=r["nric"], admitted=date.fromisoformat(r["admitted"]), languages=r["languages"],
            religion=r["religion"], diagnoses=r["diagnoses"], acp=r["acp"], decision_maker=r["decisionMaker"], diet=r["diet"],
            swallow=r["swallow"], mobility=r["mobility"], continence=r["continence"], status=r["status"], status_note=r.get("statusNote"), flags=r["flags"], stay=r.get("stay"),
        ))
        for a in r["allergies"]:
            db.add(m.Allergy(resident_id=r["id"], substance=a["substance"], classes=a["classes"], reaction=a["reaction"], severity=a["severity"], type=a["type"]))
    db.flush()

    for o in raw["orders"]:
        tr = o.get("transcribed") or {}
        db.add(m.MedicationOrder(
            id=o["id"], resident_id=o["rid"], drug=o["drug"], dose=o["dose"], route=o["route"], slots=o["slots"], indication=o.get("indication"),
            classes=o["classes"], supply=o["supply"], own_supply=o.get("ownSupply"), high_alert=o.get("highAlert", False), cd=o.get("cd", False), stock_unit=o.get("stockUnit"),
            time_critical=o.get("timeCritical", False), weekly=o.get("weekly"), check_rule=o.get("check"), instructions=o.get("instructions"),
            review=date.fromisoformat(o["review"]) if o.get("review") else None, prn=o.get("prn"), prescriber=o["prescriber"], start=date.fromisoformat(o["start"]),
            transcribed_by=tr.get("by"), transcribed_at=dt(tr["t"]) if tr else None, transcription_source=tr.get("source"),
            endorse_due=dt(tr["endorseDue"]) if tr else None,
            stopped_at=dt(o["stopped"]["t"]) if o.get("stopped") else None, stopped_by=(o.get("stopped") or {}).get("by"),
            stop_reason=(o.get("stopped") or {}).get("reason"),
        ))
    for d in raw["decoyPacks"]:
        db.add(m.DemoPack(barcode=d["barcode"], label=d["label"], drug=d["drug"], classes=d["classes"], owner=d["owner"], note=d["note"]))
    db.flush()

    for c in raw["cdStock"]:
        db.add(m.CdStock(order_id=c["orderId"], balance=c["balance"], unit=c["unit"]))
    for e in raw["cdLedger"]:
        db.add(m.CdRegisterEntry(order_id=e["orderId"], at=dt(e["t"]), kind=e["kind"], change=e["change"], balance=e["balance"], by_id=e["by"], witness_id=e.get("witness"), note=e["note"]))
    rid_of = {o["id"]: o["rid"] for o in raw["orders"]}
    for a in raw["administrations"]:
        db.add(m.Administration(
            order_id=a["orderId"], resident_id=rid_of[a["orderId"]], slot=a["slot"], day=clk.dt(a["day"] * 1440).date(), outcome=a["outcome"],
            reason=a.get("reason"), note=a.get("note"), scan=a.get("scan"), at=dt(a["t"]), by_id=a["by"], values=a.get("values"), witness_id=a.get("witness"),
            prepared_by=a["by"] if a["outcome"] == "given" else None,
        ))
    for p in raw["prn"]:
        eff = p.get("effect")
        db.add(m.PrnDose(id=p["id"], order_id=p["orderId"], at=dt(p["t"]), by_id=p["by"], witness_id=p.get("witness"), reason=p["reason"], pain=p.get("pain"),
                         effect={**eff, "t": dt(eff["t"]).isoformat()} if eff else None))
    for v in raw["vitals"]:
        score = news2(rr=v["rr"], spo2=v["spo2"], o2=v["o2"], sbp=v["sbp"], pulse=v["pulse"], acvpu=v["acvpu"], temp=v["temp"])
        db.add(m.Vitals(resident_id=v["rid"], at=dt(v["t"]), rr=v["rr"], spo2=v["spo2"], o2=v["o2"], sbp=v["sbp"], dbp=v["dbp"], pulse=v["pulse"],
                        acvpu=v["acvpu"], temp=v["temp"], news2=score, by_id=v["by"], note=v.get("note"), neuro=v.get("neuro")))
    for g in raw["glucose"]:
        db.add(m.Glucose(resident_id=g["rid"], at=dt(g["t"]), value=g["value"], by_id=g["by"], note=g.get("note")))
    for a in raw["alerts"]:
        db.add(m.Alert(id=a["id"], resident_id=a["rid"], kind=a["kind"], severity=a["severity"], title=a["title"], detail=a["detail"], at=dt(a["t"]),
                       status=a["status"], ack_by=a.get("ackBy"), ack_at=dt(a["ackT"]) if "ackT" in a else None,
                       due_at=dt(a["dueT"]) if "dueT" in a else None, due_label=a.get("dueLabel")))
    for t in raw["tasks"]:
        done = t.get("done")
        db.add(m.Task(id=t["id"], resident_id=t["rid"], text=t["text"], due_at=dt(t["due"]), repeat=t.get("repeat"), category=t["category"],
                      assessment=t.get("assessment"), done_at=dt(done["t"]) if done else None, done_by=done["by"] if done else None,
                      done_note=done.get("note") if done else None))
    for n in raw["notes"]:
        db.add(m.Note(id=n["id"], resident_id=n["rid"], at=dt(n["t"]), by_id=n["by"], kind=n["kind"], text=n["text"]))
    for a in raw["assessments"]:
        db.add(m.AssessmentRecord(id=a["id"], resident_id=a["rid"], type=a["type"], score=a["score"], at=dt(a["t"]), by_id=a["by"], signed_by=a.get("signedBy")))
    for cp in raw["carePlans"]:
        db.add(m.CarePlan(resident_id=cp["rid"], signed_by=cp["signedBy"], signed_at=dt(cp["signedT"]) if cp["signedT"] is not None else None,
                          review_due=date.fromisoformat(cp["reviewDue"]) if cp["reviewDue"] else None))
        db.flush()
        for i, p in enumerate(cp["problems"]):
            db.add(m.CareProblem(id=p["id"], resident_id=cp["rid"], position=i, title=p["title"], basis=p["basis"], goal=p["goal"], interventions=p["interventions"]))
    for wd in raw["wounds"]:
        db.add(m.Wound(id=wd["id"], resident_id=wd["rid"], site=wd["site"], type=wd["type"], found=date.fromisoformat(wd["found"]), dressing=wd["dressing"],
                       next_dressing_at=dt(wd["nextDressing"])))
        db.flush()
        for ms in wd["measurements"]:
            db.add(m.WoundMeasurement(wound_id=wd["id"], at=dt(ms["t"]), length=ms["length"], width=ms["width"], depth=ms["depth"], bed=ms["bed"], exudate=ms["exudate"], by_id=ms["by"]))
    db.flush()
    told = lambda x: {k: {"at": dt(v["t"]).isoformat(), "by": v["by"], "who": v["who"], "how": v["how"]} for k, v in x.items()}
    for i in raw.get("incidents", []):
        rv, cl = i.get("review"), i.get("closed")
        db.add(m.Incident(id=i["id"], resident_id=i["rid"], type=i["type"], at=dt(i["t"]), reported_at=dt(i["reportedT"]), by_id=i["by"], place=i["where"],
                          what=i["what"], injury=i["injury"], harm=i["harm"], action=i["action"], fall=i.get("fall"), told=told(i["told"]), status=i["status"],
                          review={k: rv[k] for k in ("factors", "findings", "actions")} if rv else None, review_by=rv["by"] if rv else None,
                          review_at=dt(rv["t"]) if rv else None, closed_by=cl["by"] if cl else None, closed_at=dt(cl["t"]) if cl else None,
                          close_summary=cl["summary"] if cl else None, moh_due=dt(i["mohDue"]) if i.get("mohDue") is not None else None))
    for ho in raw["handovers"]:
        db.add(m.Handover(id=ho["id"], shift=ho["shift"], at=dt(ho["t"]), from_id=ho["from"], to_id=ho["to"], summary=ho["summary"]))


if __name__ == "__main__":
    with SessionLocal() as s:
        load(s)
    print("Seeded the demo home: Ward 2B and Ward 3A.")
