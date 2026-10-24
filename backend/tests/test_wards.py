from app.audit import verify_chain
from app.db import SessionLocal


def test_home_has_two_wards_and_each_snapshot_is_scoped(client):
    wards = client.get("/api/wards").json()
    assert [(w["code"], w["unit"]) for w in wards] == [("2B", "General nursing"), ("3A", "Dementia care")]
    b, a = (client.get(f"/api/wards/{w}/snapshot").json() for w in ("w-2b", "w-3a"))
    assert len(b["residents"]) == 12 and len(a["residents"]) == 9
    assert not {r["id"] for r in b["residents"]} & {r["id"] for r in a["residents"]}
    staff_a = {s["id"] for s in a["staff"]}
    assert "s-priya" in staff_a and "s-aisyah" not in staff_a and "s-mary" in staff_a
    assert {o["rid"] for o in a["orders"]} <= {r["id"] for r in a["residents"]}


def test_manager_closes_fall_on_second_ward_once_follow_up_is_done(ward):
    status, _ = ward.act("s-mary", "incident.close", id="inc-3a-2", summary="No injury. Night light, bed alarm, tamsulosin moved to the morning.")
    assert status == 200
    snap = ward.c.get("/api/wards/w-3a/snapshot").json()
    assert next(i for i in snap["incidents"] if i["id"] == "inc-3a-2")["status"] == "closed"
    with SessionLocal() as db:
        assert verify_chain(db) == (True, None)
