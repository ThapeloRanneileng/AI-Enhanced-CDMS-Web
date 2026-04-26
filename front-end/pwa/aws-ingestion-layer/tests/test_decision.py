from __future__ import annotations

from decision import decide_final_status


def test_decide_final_status_returns_failed_when_both_models_flag_strong_anomaly() -> None:
    result = decide_final_status("TEMP", "anomaly", "anomaly", 0.42, 0.51)

    assert result["final_decision"] == "FAILED"
    assert result["ml_status"] == "flagged_by_model"
    assert result["anomaly_label"] == "anomaly"
    assert result["anomaly_score"] == "0.510000"


def test_decide_final_status_returns_suspect_when_one_model_flags_anomaly() -> None:
    result = decide_final_status("TEMP", "anomaly", "normal", 0.17, -0.03)

    assert result["final_decision"] == "SUSPECT"
    assert result["ml_status"] == "flagged_by_model"


def test_decide_final_status_returns_normal_when_both_models_are_normal() -> None:
    result = decide_final_status("TEMP", "normal", "normal", -0.20, -0.12)

    assert result["final_decision"] == "NORMAL"
    assert result["ml_status"] == "passed_baseline_model"
    assert result["anomaly_label"] == "normal"


def test_decide_final_status_returns_suspect_when_both_models_agree_but_signal_is_weak() -> None:
    result = decide_final_status("TEMP", "anomaly", "anomaly", 0.24, 0.07)

    assert result["final_decision"] == "SUSPECT"
    assert result["ml_status"] == "flagged_by_model"


def test_decide_final_status_is_more_tolerant_for_rainfall_scores() -> None:
    result = decide_final_status("RAIN", "anomaly", "normal", 0.08, -0.02)

    assert result["final_decision"] == "NORMAL"


def test_decide_final_status_is_stricter_for_pressure_scores() -> None:
    result = decide_final_status("PRES", "anomaly", "normal", 0.08, -0.02)

    assert result["final_decision"] == "SUSPECT"
