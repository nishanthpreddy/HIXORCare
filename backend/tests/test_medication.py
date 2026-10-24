def confirm(ward, staff, rid, slot="08:00"):
    status, body = ward.act(staff, "identity.confirm", rid=rid, slot=slot, method="wristband", barcode=f"WB-{rid[2:].upper()}")
    assert status == 200, body


def test_allergy_block_on_scan_raises_near_miss(ward):
    status, body = ward.act("s-ramesh", "scan.verify", rid="r-tan", slot="08:00", barcode="PK-WARDSTOCK-AUGMENTIN")
    assert status == 200
    assert body["data"]["ok"] is False and body["data"]["kind"] == "allergy"
    snap = ward.snap()
    assert any(a["kind"] == "near-miss" and a["rid"] == "r-tan" for a in snap["alerts"])
    assert snap["audit"][0]["action"] == "Allergy block"


def test_wrong_residents_blister_is_blocked(ward):
    _, body = ward.act("s-ramesh", "scan.verify", rid="r-tan", slot="08:00", barcode="DAA-LIM-" + ward.snap()["day"].replace("-", "") + "-0800")
    assert body["data"]["kind"] == "wrong-resident"


def test_wrong_wristband_is_blocked(ward):
    status, body = ward.act("s-ramesh", "identity.confirm", rid="r-tan", slot="08:00", method="wristband", barcode="WB-MARIA")
    assert status == 409 and "Maria Fernandez" in body["detail"]


def test_no_dose_without_identity_check(ward):
    status, body = ward.act("s-ramesh", "dose.record", orderId="o-tan-aspi", slot="08:00", outcome="given", scan="blister")
    assert status == 409 and body["message"] == "Confirm identity first"


def test_hold_parameter_blocks_giving(ward):
    confirm(ward, "s-ramesh", "r-tan")
    status, body = ward.act("s-ramesh", "dose.record", orderId="o-tan-amlo", slot="08:00", outcome="given", scan="blister", values={"sbp": 95})
    assert status == 409 and body["message"] == "Hold this dose"
    status, _ = ward.act("s-ramesh", "dose.record", orderId="o-tan-amlo", slot="08:00", outcome="held", reason="Vital signs out of range", values={"sbp": 95})
    assert status == 200


def test_care_aide_cannot_record_doses(ward):
    status, body = ward.act("s-maricel", "dose.record", orderId="o-tan-aspi", slot="08:00", outcome="given", scan="blister")
    assert status == 403


def test_enrolled_nurse_cannot_give_controlled_drug(ward):
    confirm(ward, "s-ramesh", "r-wong")
    status, body = ward.act("s-ramesh", "dose.record", orderId="o-wong-mst", slot="08:00", outcome="given", scan="pack", witnessId="s-aisyah", witnessPin="1234")
    assert status == 403 and "registered nurse" in body["message"]


def test_controlled_drug_needs_witness_and_updates_register(ward):
    confirm(ward, "s-aisyah", "r-wong")
    status, body = ward.act("s-aisyah", "dose.record", orderId="o-wong-mst", slot="08:00", outcome="given", scan="pack")
    assert status == 422 and body["message"] == "Choose the second nurse."
    status, body = ward.act("s-aisyah", "dose.record", orderId="o-wong-mst", slot="08:00", outcome="given", scan="pack", witnessId="s-aisyah", witnessPin="1234")
    assert status == 422  # cannot witness yourself
    status, body = ward.act("s-aisyah", "dose.record", orderId="o-wong-mst", slot="08:00", outcome="given", scan="pack", witnessId="s-ramesh", witnessPin="0000")
    assert status == 401
    status, body = ward.act("s-aisyah", "dose.record", orderId="o-wong-mst", slot="08:00", outcome="given", scan="pack", witnessId="s-ramesh", witnessPin="1234")
    assert status == 200, body
    snap = ward.snap()
    assert snap["cdStock"]["o-wong-mst"]["balance"] == 23
    last = [e for e in snap["cdLedger"] if e["orderId"] == "o-wong-mst"][-1]
    assert last["change"] == -1 and last["witness"] == "s-ramesh" and last["by"] == "s-aisyah"


def test_dose_recorded_once(ward):
    confirm(ward, "s-ramesh", "r-tan")
    assert ward.act("s-ramesh", "dose.record", orderId="o-tan-aspi", slot="08:00", outcome="given", scan="blister")[0] == 200
    status, body = ward.act("s-ramesh", "dose.record", orderId="o-tan-aspi", slot="08:00", outcome="given", scan="blister")
    assert status == 422


def test_admission_transcription_must_be_verified_by_another_rn(ward):
    confirm(ward, "s-aisyah", "r-lee")
    status, body = ward.act("s-aisyah", "dose.record", orderId="o-lee-omep", slot="08:00", outcome="given", scan="blister")
    assert status == 409 and body["message"] == "Waiting for RN verification"
    status, body = ward.act("s-hidayah", "order.verify", rid="r-lee", pin="1234")
    assert status == 409 and body["message"] == "A different RN must verify"
    assert ward.act("s-ramesh", "order.verify", rid="r-lee", pin="1234")[0] == 403  # ENs cannot verify
    assert ward.act("s-aisyah", "order.verify", rid="r-lee", pin="1234")[0] == 200
    assert ward.act("s-aisyah", "dose.record", orderId="o-lee-omep", slot="08:00", outcome="given", scan="blister")[0] == 200


def test_prn_minimum_interval(ward):
    assert ward.act("s-ramesh", "prn.give", orderId="o-goh-para", reason="Fever above 38 °C", pain=2)[0] == 200
    status, body = ward.act("s-ramesh", "prn.give", orderId="o-goh-para", reason="Fever above 38 °C")
    assert status == 409 and "Too soon" in body["detail"]


def test_time_critical_refusal_alerts_nurse_in_charge(ward):
    status, _ = ward.act("s-ramesh", "dose.record", orderId="o-muthu-sine", slot="08:00", outcome="refused", reason="Resident refused")
    assert status == 200
    alert = next(a for a in ward.snap()["alerts"] if a["rid"] == "r-muthu" and a["kind"] == "refused")
    assert alert["severity"] == "high"


def test_stopped_blister_medicine_is_blocked_then_discarded(ward):
    status, body = ward.act("s-ramesh", "dose.record", orderId="o-lim-amlo", slot="08:00", outcome="given", scan="blister", values={"sbp": 120})
    assert status == 409 and "stopped" in body["message"]
    snap = ward.snap()
    assert next(o for o in snap["orders"] if o["id"] == "o-lim-amlo")["stopped"]["by"] == "s-drlim"
    status, _ = ward.act("s-ramesh", "blister.discard", orderId="o-lim-amlo", slot="08:00")
    assert status == 200
    snap = ward.snap()
    assert any(a["orderId"] == "o-lim-amlo" and a["outcome"] == "discarded" for a in snap["administrations"])
    assert snap["audit"][0]["action"] == "Stopped medicine discarded"
    assert ward.act("s-ramesh", "blister.discard", orderId="o-lim-amlo", slot="08:00")[0] == 422
    assert ward.act("s-maricel", "blister.discard", orderId="o-lim-ator", slot="22:00")[0] == 403
