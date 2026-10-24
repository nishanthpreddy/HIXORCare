from app.rules import band, check_advice, news2, news2_risk, score_assessment


def v(**kw):
    base = dict(rr=16, spo2=97, o2=False, sbp=128, pulse=76, acvpu="A", temp=36.8)
    base.update(kw)
    return base


def test_news2_normal_observations_score_zero():
    assert news2(**v()) == 0
    assert news2_risk(**v()) == "low"


def test_news2_mdm_tan_deterioration_scores_six():
    # Temp 38.1, pulse 104, RR 22, SpO2 94 on air, BP 108: the story in the knowledge base.
    obs = v(temp=38.1, pulse=104, rr=22, spo2=94, sbp=108)
    assert news2(**obs) == 6
    assert news2_risk(**obs) == "medium"


def test_single_red_parameter_triggers_review():
    obs = v(acvpu="V")
    assert news2(**obs) == 3
    assert news2_risk(**obs) == "low-single"


def test_news2_high_risk_at_seven():
    assert news2_risk(**v(rr=25, spo2=91, temp=39.2)) == "high"


def test_hold_parameters():
    rule = {"field": "sbp", "label": "Systolic BP", "unit": "mmHg", "holdBelow": 100}
    assert check_advice(rule, 95)[0] == "critical"
    assert check_advice(rule, 120)[0] == "ok"
    insulin = {"field": "cbg", "label": "Capillary glucose", "unit": "mmol/L", "holdBelow": 4, "warnAbove": 20}
    assert check_advice(insulin, 22)[0] == "warning"


def test_assessment_scoring_and_bands():
    score, b = score_assessment("morse", {"history": 1, "secondary": 1, "aid": 1, "iv": 0, "gait": 2, "mental": 0})
    assert score == 75 and b["level"] == "high"
    assert band("braden", 12)["level"] == "high"
    assert band("mna", 13)["label"] == "Normal nutrition"
