from __future__ import annotations

from explain import build_explanation


def test_build_explanation_returns_review_ready_fields() -> None:
    result = build_explanation(
        element_code="TEMP",
        current_value="25.0",
        previous_value="9.2",
        rolling_mean_3="14.4",
        rolling_std_3="7.5",
        isolation_forest_label="anomaly",
        isolation_forest_score=0.41,
        one_class_svm_label="normal",
        one_class_svm_score=-0.02,
        final_decision="SUSPECT",
    )

    assert result["severity"] == "MEDIUM"
    assert result["anomaly_type"] == "SUDDEN_SPIKE"
    assert result["delta_from_previous"] == "15.800000"
    assert result["delta_from_rolling_mean"] == "10.600000"
    assert "Temperature shows a sudden spike." in result["explanation_summary"]
    assert "final review status is SUSPECT" in result["explanation_summary"]
    assert result["recommended_action"] == (
        "Compare with nearby stations and recent temperature history before approval."
    )


def test_build_explanation_classifies_sudden_drop() -> None:
    result = build_explanation(
        element_code="RH",
        current_value="4.0",
        previous_value="10.0",
        rolling_mean_3="9.0",
        rolling_std_3="2.0",
        isolation_forest_label="anomaly",
        isolation_forest_score=0.34,
        one_class_svm_label="normal",
        one_class_svm_score=-0.03,
        final_decision="SUSPECT",
    )

    assert result["anomaly_type"] == "SUDDEN_DROP"
    assert "Humidity shows a sudden drop or unusual moisture loss." in result["explanation_summary"]
    assert result["recommended_action"] == (
        "Inspect the humidity sensor and check for abrupt environmental moisture change."
    )


def test_build_explanation_classifies_rolling_deviation() -> None:
    result = build_explanation(
        element_code="PRES",
        current_value="13.5",
        previous_value="11.0",
        rolling_mean_3="10.0",
        rolling_std_3="2.0",
        isolation_forest_label="normal",
        isolation_forest_score=-0.01,
        one_class_svm_label="anomaly",
        one_class_svm_score=0.08,
        final_decision="SUSPECT",
    )

    assert result["anomaly_type"] == "ROLLING_DEVIATION"
    assert "Pressure is deviating from the recent trend." in result["explanation_summary"]
    assert result["recommended_action"] == (
        "Verify pressure sensor calibration or short-term pressure sensor behavior."
    )


def test_build_explanation_defaults_normal_rows_to_normal_pattern() -> None:
    result = build_explanation(
        element_code="RAIN",
        current_value="25.0",
        previous_value="9.2",
        rolling_mean_3="14.4",
        rolling_std_3="7.5",
        isolation_forest_label="anomaly",
        isolation_forest_score=0.41,
        one_class_svm_label="normal",
        one_class_svm_score=-0.02,
        final_decision="NORMAL",
    )

    assert result["anomaly_type"] == "NORMAL_PATTERN"
    assert "Rainfall is following the expected pattern." in result["explanation_summary"]


def test_build_explanation_uses_rain_specific_action_for_failed_rows() -> None:
    result = build_explanation(
        element_code="RAIN",
        current_value="40.0",
        previous_value="0.0",
        rolling_mean_3="5.0",
        rolling_std_3="4.0",
        isolation_forest_label="anomaly",
        isolation_forest_score=0.62,
        one_class_svm_label="anomaly",
        one_class_svm_score=0.57,
        final_decision="FAILED",
    )

    assert result["recommended_action"] == (
        "Hold for manual review and verify against nearby stations, radar, or storm context."
    )
    assert "Rainfall looks abnormal to both models." in result["explanation_summary"]


def test_build_explanation_uses_wind_speed_language() -> None:
    result = build_explanation(
        element_code="WSPD",
        current_value="18.0",
        previous_value="5.0",
        rolling_mean_3="7.0",
        rolling_std_3="3.0",
        isolation_forest_label="anomaly",
        isolation_forest_score=0.28,
        one_class_svm_label="normal",
        one_class_svm_score=-0.04,
        final_decision="SUSPECT",
    )

    assert result["anomaly_type"] == "SUDDEN_SPIKE"
    assert "Wind speed shows a sudden jump or gust-like spike." in result["explanation_summary"]
    assert result["recommended_action"] == (
        "Check for a gust event or possible wind-speed sensor issue."
    )


def test_build_explanation_tolerates_larger_rainfall_spikes() -> None:
    result = build_explanation(
        element_code="RAIN",
        current_value="9.0",
        previous_value="1.0",
        rolling_mean_3="3.0",
        rolling_std_3="3.0",
        isolation_forest_label="anomaly",
        isolation_forest_score=0.18,
        one_class_svm_label="normal",
        one_class_svm_score=-0.02,
        final_decision="SUSPECT",
    )

    assert result["anomaly_type"] == "ROLLING_DEVIATION"


def test_build_explanation_is_stricter_for_pressure_deviation() -> None:
    result = build_explanation(
        element_code="PRES",
        current_value="13.0",
        previous_value="11.0",
        rolling_mean_3="10.0",
        rolling_std_3="2.0",
        isolation_forest_label="normal",
        isolation_forest_score=-0.01,
        one_class_svm_label="anomaly",
        one_class_svm_score=0.08,
        final_decision="SUSPECT",
    )

    assert result["anomaly_type"] == "ROLLING_DEVIATION"


def test_build_explanation_requires_larger_wind_direction_shift() -> None:
    result = build_explanation(
        element_code="WDIR",
        current_value="135.0",
        previous_value="130.0",
        rolling_mean_3="120.0",
        rolling_std_3="5.0",
        isolation_forest_label="normal",
        isolation_forest_score=-0.01,
        one_class_svm_label="anomaly",
        one_class_svm_score=0.10,
        final_decision="SUSPECT",
    )

    assert result["anomaly_type"] == "ROLLING_DEVIATION"
