"""PostgreSQL schema for the ward: residents, medicines, care and the audit trail.

Every clinical row hangs off a resident; the home and ward give tenancy. Two tables are
append-only at the database level (see the first migration): the audit log and the
controlled drug register.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import ARRAY, JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

Json = JSON().with_variant(JSONB(), "postgresql")
TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class Home(Base):
    __tablename__ = "homes"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    organisation: Mapped[str] = mapped_column(String(200))


class Ward(Base):
    __tablename__ = "wards"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    home_id: Mapped[str] = mapped_column(ForeignKey("homes.id"))
    code: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(100))
    beds: Mapped[int] = mapped_column(Integer)


class Staff(Base):
    __tablename__ = "staff"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    home_id: Mapped[str] = mapped_column(ForeignKey("homes.id"))
    name: Mapped[str] = mapped_column(String(120))
    short: Mapped[str] = mapped_column(String(40))
    role: Mapped[str] = mapped_column(String(4))  # RN EN CA NM DR PH
    title: Mapped[str] = mapped_column(String(120))
    shift: Mapped[str | None] = mapped_column(String(10))
    pin_hash: Mapped[str] = mapped_column(String(200))


class Resident(Base):
    __tablename__ = "residents"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.id"), index=True)
    bed: Mapped[str] = mapped_column(String(10))
    salutation: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(120))
    preferred: Mapped[str] = mapped_column(String(60))
    sex: Mapped[str] = mapped_column(String(1))
    dob: Mapped[date] = mapped_column(Date)
    nric_masked: Mapped[str] = mapped_column(String(12))
    admitted: Mapped[date] = mapped_column(Date)
    languages: Mapped[list[str]] = mapped_column(ARRAY(String))
    religion: Mapped[str] = mapped_column(String(40))
    diagnoses: Mapped[list[str]] = mapped_column(ARRAY(Text))
    acp: Mapped[dict] = mapped_column(Json)
    decision_maker: Mapped[dict] = mapped_column(Json)
    diet: Mapped[str] = mapped_column(Text)
    swallow: Mapped[str] = mapped_column(Text)
    mobility: Mapped[str] = mapped_column(Text)
    continence: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="in")
    status_note: Mapped[str | None] = mapped_column(Text)
    flags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    stay: Mapped[dict | None] = mapped_column(Json)  # respite: {"type", "from", "to", "note"}
    allergies: Mapped[list[Allergy]] = relationship(lazy="selectin", order_by="Allergy.id")


class Allergy(Base):
    __tablename__ = "allergies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    substance: Mapped[str] = mapped_column(String(120))
    classes: Mapped[list[str]] = mapped_column(ARRAY(String))
    reaction: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(10))
    type: Mapped[str] = mapped_column(String(12))


class MedicationOrder(Base):
    __tablename__ = "medication_orders"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    drug: Mapped[str] = mapped_column(String(200))
    dose: Mapped[str] = mapped_column(String(120))
    route: Mapped[str] = mapped_column(String(40))
    slots: Mapped[list[str]] = mapped_column(ARRAY(String(5)), default=list)
    indication: Mapped[str | None] = mapped_column(String(200))
    classes: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    supply: Mapped[str] = mapped_column(String(10))  # blister (multi-dose pack) | pack (original pack)
    own_supply: Mapped[str | None] = mapped_column(Text)  # resident's own medicines and who checked them
    high_alert: Mapped[bool] = mapped_column(Boolean, default=False)
    cd: Mapped[bool] = mapped_column(Boolean, default=False)
    stock_unit: Mapped[str | None] = mapped_column(String(10))
    time_critical: Mapped[bool] = mapped_column(Boolean, default=False)
    weekly: Mapped[int | None] = mapped_column(Integer)  # 0 = Sunday
    check_rule: Mapped[dict | None] = mapped_column(Json)
    instructions: Mapped[str | None] = mapped_column(Text)
    review: Mapped[date | None] = mapped_column(Date)
    prn: Mapped[dict | None] = mapped_column(Json)
    prescriber: Mapped[str] = mapped_column(String(120))
    start: Mapped[date] = mapped_column(Date)
    # Admission transcription (MOH LC section 14)
    transcribed_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    transcribed_at: Mapped[datetime | None] = mapped_column(TS)
    transcription_source: Mapped[str | None] = mapped_column(Text)
    endorse_due: Mapped[datetime | None] = mapped_column(TS)
    verified_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    verified_at: Mapped[datetime | None] = mapped_column(TS)


class Administration(Base):
    __tablename__ = "administrations"
    __table_args__ = (UniqueConstraint("order_id", "slot", "day", name="one_record_per_dose"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("medication_orders.id"), index=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    slot: Mapped[str] = mapped_column(String(5))
    day: Mapped[date] = mapped_column(Date)
    outcome: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    values: Mapped[dict | None] = mapped_column(Json)
    witness_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    prepared_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    scan: Mapped[str | None] = mapped_column(String(10))
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))


class IdentityCheck(Base):
    __tablename__ = "identity_checks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    slot: Mapped[str] = mapped_column(String(5))
    day: Mapped[date] = mapped_column(Date)
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    method: Mapped[str] = mapped_column(String(10))
    reason: Mapped[str | None] = mapped_column(Text)


class PrnDose(Base):
    __tablename__ = "prn_doses"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("medication_orders.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    witness_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    reason: Mapped[str] = mapped_column(Text)
    pain: Mapped[int | None] = mapped_column(Integer)
    effect: Mapped[dict | None] = mapped_column(Json)


class CdStock(Base):
    __tablename__ = "cd_stock"
    order_id: Mapped[str] = mapped_column(ForeignKey("medication_orders.id"), primary_key=True)
    balance: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    unit: Mapped[str] = mapped_column(String(10))


class CdRegisterEntry(Base):
    """Electronic controlled drug register. Append-only: corrections are new entries."""
    __tablename__ = "cd_register"
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("medication_orders.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    kind: Mapped[str] = mapped_column(String(12))
    change: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    balance: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    witness_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    note: Mapped[str] = mapped_column(Text)


class Vitals(Base):
    __tablename__ = "vitals"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS, index=True)
    rr: Mapped[int] = mapped_column(Integer)
    spo2: Mapped[int] = mapped_column(Integer)
    o2: Mapped[bool] = mapped_column(Boolean)
    sbp: Mapped[int] = mapped_column(Integer)
    dbp: Mapped[int] = mapped_column(Integer)
    pulse: Mapped[int] = mapped_column(Integer)
    acvpu: Mapped[str] = mapped_column(String(1))
    temp: Mapped[Decimal] = mapped_column(Numeric(4, 1))
    news2: Mapped[int] = mapped_column(Integer)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    note: Mapped[str | None] = mapped_column(Text)


class Glucose(Base):
    __tablename__ = "glucose"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    value: Mapped[Decimal] = mapped_column(Numeric(4, 1))
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    note: Mapped[str | None] = mapped_column(Text)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str | None] = mapped_column(ForeignKey("residents.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    severity: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(Text)
    detail: Mapped[str] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(10), default="open")
    ack_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    ack_at: Mapped[datetime | None] = mapped_column(TS)
    due_at: Mapped[datetime | None] = mapped_column(TS)
    due_label: Mapped[str | None] = mapped_column(String(60))
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(TS)


class Task(Base):
    __tablename__ = "care_tasks"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    due_at: Mapped[datetime] = mapped_column(TS, index=True)
    repeat: Mapped[str | None] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(20))
    assessment: Mapped[str | None] = mapped_column(String(20))
    done_at: Mapped[datetime | None] = mapped_column(TS)
    done_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    done_note: Mapped[str | None] = mapped_column(Text)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    kind: Mapped[str] = mapped_column(String(40))
    text: Mapped[str] = mapped_column(Text)


class AssessmentRecord(Base):
    __tablename__ = "assessments"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    score: Mapped[int] = mapped_column(Integer)
    answers: Mapped[dict | None] = mapped_column(Json)
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    signed_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))


class CarePlan(Base):
    __tablename__ = "care_plans"
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), primary_key=True)
    signed_by: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    signed_at: Mapped[datetime | None] = mapped_column(TS)
    review_due: Mapped[date | None] = mapped_column(Date)
    problems: Mapped[list[CareProblem]] = relationship(lazy="selectin", order_by="CareProblem.position")


class CareProblem(Base):
    __tablename__ = "care_problems"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("care_plans.resident_id"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(Text)
    basis: Mapped[str] = mapped_column(Text)
    goal: Mapped[str] = mapped_column(Text)
    interventions: Mapped[list[str]] = mapped_column(ARRAY(Text))


class Suggestion(Base):
    """Care plan changes proposed from an assessment. A nurse approves or dismisses them."""
    __tablename__ = "care_suggestions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    source: Mapped[str] = mapped_column(String(120))
    problem: Mapped[str] = mapped_column(Text)
    basis: Mapped[str] = mapped_column(Text)
    items: Mapped[list[str]] = mapped_column(ARRAY(Text))
    at: Mapped[datetime] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(10), default="pending")


class Wound(Base):
    __tablename__ = "wounds"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    site: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(120))
    found: Mapped[date] = mapped_column(Date)
    dressing: Mapped[str] = mapped_column(Text)
    next_dressing_at: Mapped[datetime] = mapped_column(TS)
    measurements: Mapped[list[WoundMeasurement]] = relationship(lazy="selectin", order_by="WoundMeasurement.at")


class WoundMeasurement(Base):
    __tablename__ = "wound_measurements"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    wound_id: Mapped[str] = mapped_column(ForeignKey("wounds.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    length: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    width: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    depth: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    bed: Mapped[str] = mapped_column(Text)
    exudate: Mapped[str] = mapped_column(String(20))
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    photo: Mapped[str | None] = mapped_column(Text)  # data URL; object storage in production


class Handover(Base):
    __tablename__ = "handovers"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    shift: Mapped[str] = mapped_column(String(10))
    at: Mapped[datetime] = mapped_column(TS)
    from_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    to_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    summary: Mapped[str] = mapped_column(Text)


class SbarMessage(Base):
    __tablename__ = "sbar_messages"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    resident_id: Mapped[str] = mapped_column(ForeignKey("residents.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    to_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    text: Mapped[str] = mapped_column(Text)


class AuditEntry(Base):
    """Hash-chained, append-only audit trail."""
    __tablename__ = "audit_log"
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(TS)
    by_id: Mapped[str] = mapped_column(ForeignKey("staff.id"))
    action: Mapped[str] = mapped_column(String(60))
    resident_id: Mapped[str | None] = mapped_column(ForeignKey("residents.id"), index=True)
    detail: Mapped[str] = mapped_column(Text)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class DemoPack(Base):
    """Items on the demo trolley that do not belong to any order (for scan-block demos)."""
    __tablename__ = "demo_packs"
    barcode: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(200))
    drug: Mapped[str] = mapped_column(String(200))
    classes: Mapped[list[str]] = mapped_column(ARRAY(String))
    owner: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str] = mapped_column(Text)


class DemoClock(Base):
    """Demo mode only: the ward's clock starts at 08:12 and can jump ahead."""
    __tablename__ = "demo_clock"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(Date)
    base_minutes: Mapped[int] = mapped_column(Integer)
    anchor: Mapped[datetime] = mapped_column(TS)
