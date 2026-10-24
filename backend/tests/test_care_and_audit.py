import pytest
from sqlalchemy import text

from app.audit import verify_chain
from app.db import SessionLocal


def test_news2_six_raises_alert_and_hourly_obs(ward):
    status, body = ward.act("s-maricel", "vitals.record", rid="r-tan", temp="38.1", pulse="104", rr="22", spo2="94", sbp="108", dbp="68", acvpu="A", o2=False)
    assert status == 200 and body["data"]["score"] == 6
    snap = ward.snap()
    alert = next(a for a in snap["alerts"] if a["rid"] == "r-tan" and a["kind"] == "news2")
    assert alert["status"] == "open" and alert["dueT"] == snap["now"] + 60
    assert any(t["text"] == "Observations (NEWS2 6)" for t in snap["tasks"])


def test_high_falls_score_suggests_care_plan_and_rn_signs(ward):
    answers = {"history": 1, "secondary": 1, "aid": 1, "iv": 0, "gait": 1, "mental": 0}
    status, body = ward.act("s-ramesh", "assessment.submit", rid="r-lee", type="morse", answers=answers, pin="1234")
    assert status == 200 and body["data"]["score"] == 65
    sid = body["data"]["suggestionId"]
    assert ward.act("s-ramesh", "careplan.approve", suggestionId=sid, items=["Bed or chair alarm on"], pin="1234")[0] == 403
    status, _ = ward.act("s-aisyah", "careplan.approve", suggestionId=sid, items=["Bed or chair alarm on", "Hourly checks at night"], pin="1234")
    assert status == 200
    plan = next(p for p in ward.snap()["carePlans"] if p["rid"] == "r-lee")
    assert plan["signedBy"] == "s-aisyah" and plan["problems"][-1]["interventions"] == ["Bed or chair alarm on", "Hourly checks at night"]


def test_repeating_task_schedules_next(ward):
    assert ward.act("s-maricel", "task.complete", id="t-7")[0] == 200
    tasks = [t for t in ward.snap()["tasks"] if t["rid"] == "r-wong" and t["text"].startswith("Reposition") and not t["done"]]
    assert tasks and tasks[0]["text"] == "Reposition (right side)"


def test_audit_chain_is_intact_after_actions(ward):
    ward.act("s-ramesh", "scan.verify", rid="r-tan", slot="08:00", barcode="PK-WARDSTOCK-AUGMENTIN")
    ward.act("s-ramesh", "note.add", rid="r-tan", kind="Nursing", text="Settled.")
    with SessionLocal() as db:
        assert verify_chain(db) == (True, None)


@pytest.mark.parametrize("table", ["audit_log", "cd_register"])
def test_append_only_tables_reject_changes(table):
    with SessionLocal() as db:
        with pytest.raises(Exception, match="append-only"):
            db.execute(text(f"DELETE FROM {table}"))
        db.rollback()
        with pytest.raises(Exception, match="append-only"):
            db.execute(text(f"UPDATE {table} SET note = 'x'" if table == "cd_register" else f"UPDATE {table} SET detail = 'x'"))
        db.rollback()


def test_sign_in_rejects_wrong_pin(client):
    r = client.post("/api/auth/sign-in", json={"staffId": "s-aisyah", "pin": "9999"})
    assert r.status_code == 401


def test_actions_need_a_session(client):
    assert client.post("/api/actions/note.add", json={"rid": "r-tan", "text": "x"}).status_code == 401


def test_bright_interface_is_a_placeholder(client):
    assert client.post("/api/integrations/bright/referrals").status_code == 501
