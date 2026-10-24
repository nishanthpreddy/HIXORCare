def post_fall(snap, rid):
    return sorted((t for t in snap["tasks"] if t["rid"] == rid and t["text"].startswith("Post-fall")), key=lambda t: t["due"])


def test_carer_reports_witnessed_fall_on_blood_thinner_and_gets_neuro_obs(ward):
    status, body = ward.act("s-maricel", "incident.report", rid="r-siti", type="fall", what="Slid from chair to floor.", harm=4,
                            fall={"witnessed": True, "headStrike": "no"})
    assert status == 200 and "Neuro observations" in body["message"]
    snap = ward.snap()
    inc = next(i for i in snap["incidents"] if i["id"] == body["data"]["id"])
    assert inc["fall"] == {"witnessed": True, "headStrike": "no", "bloodThinner": True, "neuroObs": True}
    tasks = post_fall(snap, "r-siti")
    assert [t["due"] - inc["t"] for t in tasks] == [15, 30, 45, 60, 120, 240, 480, 720, 1440]
    assert any(t["rid"] == "r-siti" and t.get("assessment") == "morse" for t in snap["tasks"])
    assert any(a["rid"] == "r-siti" and a["kind"] == "incident" for a in snap["alerts"])


def test_witnessed_fall_without_head_strike_gets_routine_obs(ward):
    _, body = ward.act("s-aisyah", "incident.report", rid="r-lee", type="fall", what="Sat down hard beside bed.", harm=5,
                       fall={"witnessed": True, "headStrike": "no"})
    assert body["message"] == "Post-fall observations are scheduled."
    assert [t["text"] for t in post_fall(ward.snap(), "r-lee")] == ["Post-fall obs 1 of 3", "Post-fall obs 2 of 3", "Post-fall obs 3 of 3"]


def test_abuse_allegation_sets_moh_deadline_and_cannot_be_closed_here(ward):
    _, body = ward.act("s-ramesh", "incident.report", rid="r-tan", type="abuse", what="Resident says a visitor shouted at her.", harm=3)
    snap = ward.snap()
    inc = next(i for i in snap["incidents"] if i["id"] == body["data"]["id"])
    assert inc["mohDue"] == snap["now"] + 72 * 60
    status, err = ward.act("s-mary", "incident.close", id=inc["id"], summary="Done")
    assert status == 409 and "Escalate to the Head of Nursing" in err["detail"]


def test_neuro_drop_raises_alert(ward):
    vitals = dict(rid="r-chua", temp="36.8", pulse="80", rr="16", spo2="97", sbp="130", dbp="78", acvpu="A", o2=False)
    assert ward.act("s-aisyah", "vitals.record", **vitals, neuro={"gcs": 12, "pupils": "equal and reactive", "limbs": "normal"})[0] == 200
    alert = next(a for a in ward.snap()["alerts"] if a["rid"] == "r-chua" and a["kind"] == "neuro")
    assert alert["severity"] == "high" and "(was 15)" in alert["detail"]


def test_only_manager_reviews_and_close_waits_for_follow_up(ward):
    assert ward.act("s-aisyah", "incident.review", id="inc-1", findings="x")[0] == 403
    status, err = ward.act("s-mary", "incident.close", id="inc-1", summary="Settled.")
    assert status == 409 and "Finish post-fall observations" in err["detail"] and "post-fall analysis" in err["detail"]
    assert ward.act("s-aisyah", "incident.tell", id="inc-1", party="family", who="Daughter", how="Phone call")[0] == 200
    assert ward.act("s-mary", "incident.review", id="inc-1", factors=["Getting up to the toilet"], findings="Got up alone at night.")[0] == 200
    inc = next(i for i in ward.snap()["incidents"] if i["id"] == "inc-1")
    assert inc["status"] == "review" and inc["told"]["family"]["who"] == "Daughter"


def test_moh_chain_escalate_notify_rca_then_head_of_nursing_closes(ward):
    inc = "inc-3a-5"  # Mdm Chan: head laceration on apixaban, sent to A&E (moderate harm)
    status, err = ward.act("s-mary", "incident.close", id=inc, summary="x")
    assert status == 409 and "Escalate to the Head of Nursing" in err["detail"]
    assert ward.act("s-mary", "incident.moh", id=inc, decision="notified", ref="X")[0] == 403
    assert ward.act("s-catherine", "incident.moh", id=inc, decision="notified", ref="X")[0] == 422  # not escalated yet
    status, body = ward.act("s-mary", "incident.escalate", id=inc, note="Fall with head laceration, A&E, CT clear.")
    assert status == 200 and "Catherine Wee" in body["message"]
    snap = ward.c.get("/api/wards/w-3a/snapshot").json()
    i = next(x for x in snap["incidents"] if x["id"] == inc)
    assert i["mohDue"] == snap["now"] + 72 * 60 and i["rcaDue"] == snap["now"] + 30 * 1440 and i["escalated"]["by"] == "s-mary"
    assert ward.act("s-catherine", "incident.moh", id=inc, decision="notified", ref="FSG-20261024-118")[0] == 200
    assert ward.act("s-catherine", "incident.rca", id=inc, ref="RCA-118", summary="Night toilet trips without frame.")[0] == 200
    ward.act("s-mary", "incident.review", id=inc, findings="Got up alone at night.")
    status, err = ward.act("s-mary", "incident.close", id=inc, summary="x")
    assert status == 403 and "Head of Nursing" in err["message"]
    i = next(x for x in ward.c.get("/api/wards/w-3a/snapshot").json()["incidents"] if x["id"] == inc)
    assert i["moh"]["ref"] == "FSG-20261024-118" and i["rca"]["ref"] == "RCA-118"


def test_abuse_allegation_cannot_be_marked_not_reportable(ward):
    _, body = ward.act("s-ramesh", "incident.report", rid="r-tan", type="abuse", what="Says a visitor shouted at her.", harm=4)
    ward.act("s-aisyah", "incident.escalate", id=body["data"]["id"], note="Allegation against a visitor.")
    status, err = ward.act("s-catherine", "incident.moh", id=body["data"]["id"], decision="not-reportable", reason="Minor")
    assert status == 409 and "must be notified" in err["message"]
