"""Clinical and medication safety rules.

These are the authority. The React app keeps copies (frontend/src/domain/clinical.ts)
only to preview results while the nurse is typing; the server decides.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

SHARED = Path(__file__).resolve().parents[2] / "shared"
ASSESSMENTS: dict = json.loads((SHARED / "assessments.json").read_text())

# ---------- NEWS2 (Royal College of Physicians, SpO2 scale 1) ----------


def news2_parts(rr: float, spo2: float, o2: bool, sbp: float, pulse: float, acvpu: str, temp: float) -> dict[str, int]:
    return {
        "rr": 3 if rr <= 8 else 1 if rr <= 11 else 0 if rr <= 20 else 2 if rr <= 24 else 3,
        "spo2": 3 if spo2 <= 91 else 2 if spo2 <= 93 else 1 if spo2 <= 95 else 0,
        "o2": 2 if o2 else 0,
        "sbp": 3 if sbp <= 90 else 2 if sbp <= 100 else 1 if sbp <= 110 else 0 if sbp <= 219 else 3,
        "pulse": 3 if pulse <= 40 else 1 if pulse <= 50 else 0 if pulse <= 90 else 1 if pulse <= 110 else 2 if pulse <= 130 else 3,
        "acvpu": 0 if acvpu == "A" else 3,
        "temp": 3 if temp <= 35 else 1 if temp <= 36 else 0 if temp <= 38 else 1 if temp <= 39 else 2,
    }


def news2(**v) -> int:
    return sum(news2_parts(**v).values())


def news2_risk(**v) -> str:
    parts = news2_parts(**v)
    total = sum(parts.values())
    if total >= 7:
        return "high"
    if total >= 5:
        return "medium"
    if 3 in parts.values():
        return "low-single"
    return "low"


# The home sets the response to each band; NEWS2 itself is fixed.
ESCALATION = {
    "low": {"label": "Low", "action": "Routine observations every 12 hours.", "obs_every": 720, "alert": False},
    "low-single": {"label": "Low (single red score)", "action": "Nurse in charge to review within 1 hour. Observations every hour.", "obs_every": 60, "alert": True},
    "medium": {"label": "Medium", "action": "Nurse in charge now. Observations every hour. Inform the doctor.", "obs_every": 60, "alert": True},
    "high": {"label": "High", "action": "Emergency response. Call the doctor now, check the advance care plan, consider 995. Continuous monitoring.", "obs_every": 30, "alert": True},
}

# ---------- Assessments ----------


def score_assessment(kind: str, answers: dict[str, int]) -> tuple[int, dict]:
    d = ASSESSMENTS[kind]
    missing = [i["id"] for i in d["items"] if i["id"] not in answers]
    if missing:
        raise ValueError("Answer every question.")
    score = sum(i["options"][answers[i["id"]]]["score"] for i in d["items"])
    return score, band(kind, score)


def band(kind: str, score: int) -> dict:
    bands = ASSESSMENTS[kind]["bands"]
    return next((b for b in bands if b["min"] <= score <= b["max"]), bands[-1])


# ---------- Medication ----------

INJECTABLE = {"Subcutaneous", "Intramuscular", "Intravenous"}


def rn_only(order) -> bool:
    """MOH LC section 14: ENs may not prepare injectables or controlled drugs."""
    return bool(order.cd) or order.route in INJECTABLE


def is_rn(role: str) -> bool:
    return role in ("RN", "NM")


def can_give_meds(role: str) -> bool:
    return role in ("RN", "EN")


def needs_witness(order) -> bool:
    return bool(order.high_alert or order.cd)


def allergy_clash(allergies, classes: list[str]):
    return next((a for a in allergies if set(a.classes) & set(classes)), None)


def check_advice(check: dict | None, value: float | None) -> tuple[str, str] | None:
    if not check or value is None:
        return None
    if check.get("holdBelow") is not None and value < check["holdBelow"]:
        return "critical", f"{check['label']} is below {check['holdBelow']} {check['unit']}. Hold this dose and tell the nurse in charge."
    if check.get("warnAbove") is not None and value > check["warnAbove"]:
        return "warning", f"{check['label']} is above {check['warnAbove']} {check['unit']}. Give, and inform the doctor."
    return "ok", "Within range."


def cd_units(order) -> float:
    """Stock units one dose uses: 1 tablet, or the mL in brackets for liquids ("2.5 mg (1.25 mL)")."""
    if order.stock_unit != "mL":
        return 1.0
    import re

    m = re.search(r"\(([\d.]+) mL\)", order.dose)
    return float(m.group(1)) if m else 1.0


def sachet_barcode(rid: str, day: str, slot: str) -> str:
    return f"SCH-{rid[2:].upper()}-{day.replace('-', '')}-{slot.replace(':', '')}"


def pack_barcode(order_id: str) -> str:
    return f"PK-{order_id[2:].upper()}"


def wristband(rid: str) -> str:
    return f"WB-{rid[2:].upper()}"


@dataclass
class ScanResult:
    ok: bool
    kind: str
    title: str
    detail: str
    orderIds: list[str]


def verify_scan(resident, due_orders, all_orders, residents, decoys, day: str, slot: str, barcode: str) -> ScanResult:
    """What happens when a nurse scans `barcode` while giving `resident` their `slot` doses."""
    name = f"{resident.salutation} {resident.name}"
    decoy = next((d for d in decoys if d.barcode == barcode), None)
    if decoy:
        clash = allergy_clash(resident.allergies, decoy.classes)
        if clash:
            return ScanResult(
                False, "allergy",
                f"Stop. {resident.preferred} is allergic to {clash.substance.lower()}.",
                f"{decoy.label} contains a {clash.classes[0].replace('-', ' ')}. Recorded reaction: {clash.reaction}. "
                f"It is also not prescribed for {name}. Put the pack aside and tell the nurse in charge.",
                [],
            )
        return ScanResult(False, "not-prescribed", "Not prescribed for this resident", f"{decoy.label} is not on {name}'s chart. Put it aside.", [])
    if barcode.startswith("SCH-"):
        if barcode == sachet_barcode(resident.id, day, slot):
            ids = [o.id for o in due_orders if o.supply == "sachet"]
            return ScanResult(True, "match", "Sachet matches", f"{len(ids)} medicine{'' if len(ids) == 1 else 's'} for {slot}.", ids)
        other = next((r for r in residents if barcode.startswith(f"SCH-{r.id[2:].upper()}-")), None)
        if other and other.id != resident.id:
            return ScanResult(False, "wrong-resident", "Wrong resident", f"This sachet belongs to {other.salutation} {other.name} ({other.bed}). Do not give it.", [])
        return ScanResult(False, "wrong-time", "Wrong time", f"This sachet is not for the {slot} round.", [])
    order = next((o for o in all_orders if pack_barcode(o.id) == barcode), None)
    if not order:
        return ScanResult(False, "not-prescribed", "Unknown barcode", "This barcode is not on any chart in this ward.", [])
    if order.resident_id != resident.id:
        other = next(r for r in residents if r.id == order.resident_id)
        return ScanResult(False, "wrong-resident", "Wrong resident", f"This pack is {order.drug} for {other.salutation} {other.name} ({other.bed}).", [])
    if not order.prn and slot not in order.slots:
        return ScanResult(False, "wrong-time", "Not due now", f"{order.drug} is due at {', '.join(order.slots)}.", [])
    return ScanResult(True, "match", "Pack matches", f"{order.drug} {order.dose}.", [order.id])
