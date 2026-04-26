"""Human-readable explanations for AWS anomaly outcomes."""

from __future__ import annotations

from typing import Dict

try:
    from .thresholds import get_thresholds
except ImportError:
    from thresholds import get_thresholds


def infer_severity(final_decision: str) -> str:
    """Map a final decision to a simple review severity."""
    return {
        "NORMAL": "LOW",
        "SUSPECT": "MEDIUM",
        "FAILED": "HIGH",
    }[final_decision]


def describe_element_behavior(element_code: str, anomaly_type: str) -> str:
    """Describe the observation in element-specific terms."""
    descriptions = {
        "TEMP": {
            "SUDDEN_DROP": "Temperature shows a sudden drop.",
            "SUDDEN_SPIKE": "Temperature shows a sudden spike.",
            "ROLLING_DEVIATION": "Temperature is away from the recent trend.",
            "MODEL_AGREEMENT_ANOMALY": "Temperature looks abnormal to both models.",
            "NORMAL_PATTERN": "Temperature is following the expected pattern.",
        },
        "RH": {
            "SUDDEN_DROP": "Humidity shows a sudden drop or unusual moisture loss.",
            "SUDDEN_SPIKE": "Humidity shows a sudden rise in moisture.",
            "ROLLING_DEVIATION": "Humidity is shifting away from the recent moisture pattern.",
            "MODEL_AGREEMENT_ANOMALY": "Humidity looks abnormal to both models.",
            "NORMAL_PATTERN": "Humidity is following the expected moisture pattern.",
        },
        "RAIN": {
            "SUDDEN_DROP": "Rainfall dropped sharply relative to the previous reading.",
            "SUDDEN_SPIKE": "Rainfall shows an unusual spike or surge.",
            "ROLLING_DEVIATION": "Rainfall is off the recent accumulation pattern.",
            "MODEL_AGREEMENT_ANOMALY": "Rainfall looks abnormal to both models.",
            "NORMAL_PATTERN": "Rainfall is following the expected pattern.",
        },
        "PRES": {
            "SUDDEN_DROP": "Pressure shows a sudden drop relative to the recent trend.",
            "SUDDEN_SPIKE": "Pressure shows a sudden spike relative to the recent trend.",
            "ROLLING_DEVIATION": "Pressure is deviating from the recent trend.",
            "MODEL_AGREEMENT_ANOMALY": "Pressure looks abnormal to both models.",
            "NORMAL_PATTERN": "Pressure is following the expected trend.",
        },
        "WSPD": {
            "SUDDEN_DROP": "Wind speed dropped sharply from the previous reading.",
            "SUDDEN_SPIKE": "Wind speed shows a sudden jump or gust-like spike.",
            "ROLLING_DEVIATION": "Wind speed is unstable relative to the recent pattern.",
            "MODEL_AGREEMENT_ANOMALY": "Wind speed looks abnormal to both models.",
            "NORMAL_PATTERN": "Wind speed is following the expected pattern.",
        },
        "WDIR": {
            "SUDDEN_DROP": "Wind direction shifted sharply from the previous bearing.",
            "SUDDEN_SPIKE": "Wind direction shifted sharply from the previous bearing.",
            "ROLLING_DEVIATION": "Wind direction is shifting away from the recent pattern.",
            "MODEL_AGREEMENT_ANOMALY": "Wind direction looks abnormal to both models.",
            "NORMAL_PATTERN": "Wind direction is following the expected pattern.",
        },
    }
    element_descriptions = descriptions.get(
        element_code,
        {
            "SUDDEN_DROP": "This reading shows a sudden drop.",
            "SUDDEN_SPIKE": "This reading shows a sudden spike.",
            "ROLLING_DEVIATION": "This reading is away from the recent trend.",
            "MODEL_AGREEMENT_ANOMALY": "This reading looks abnormal to both models.",
            "NORMAL_PATTERN": "This reading is consistent with the normal pattern.",
        },
    )
    return element_descriptions[anomaly_type]


def recommend_action(final_decision: str, element_code: str) -> str:
    """Provide a simple analyst action recommendation."""
    if final_decision == "NORMAL":
        return "No action needed; keep in the normal review flow."

    suspect_actions = {
        "RAIN": "Compare with nearby stations and local storm context before approval.",
        "PRES": "Verify pressure sensor calibration or short-term pressure sensor behavior.",
        "RH": "Inspect the humidity sensor and check for abrupt environmental moisture change.",
        "WSPD": "Check for a gust event or possible wind-speed sensor issue.",
        "WDIR": "Review for a sharp wind-direction shift and compare with nearby stations.",
        "TEMP": "Compare with nearby stations and recent temperature history before approval.",
    }
    failed_actions = {
        "RAIN": "Hold for manual review and verify against nearby stations, radar, or storm context.",
        "PRES": "Hold for manual review and verify pressure sensor calibration or sensor drift.",
        "RH": "Hold for manual review and inspect the humidity sensor or abrupt moisture change.",
        "WSPD": "Hold for manual review and check for a gust event or wind-speed sensor fault.",
        "WDIR": "Hold for manual review and verify the wind vane or abrupt direction shift.",
        "TEMP": "Hold for manual review and verify the temperature sensor against nearby stations.",
    }
    if final_decision == "FAILED":
        return failed_actions.get(
            element_code,
            "Hold this observation for manual review and verify the source reading.",
        )
    return suspect_actions.get(
        element_code,
        "Review against nearby observations or station history before approval.",
    )


def classify_anomaly_type(
    *,
    element_code: str,
    current_value: float,
    previous_value: float,
    rolling_mean_3: float,
    rolling_std_3: float,
    isolation_forest_label: str,
    one_class_svm_label: str,
) -> str:
    """Classify the behavior behind the anomaly in reviewer-friendly terms."""
    thresholds = get_thresholds(element_code)
    delta_from_previous = current_value - previous_value
    delta_from_rolling_mean = current_value - rolling_mean_3
    baseline_std = rolling_std_3 if rolling_std_3 > 0 else 1.0
    both_models_flagged = (
        isolation_forest_label == "anomaly" and one_class_svm_label == "anomaly"
    )

    if both_models_flagged:
        return "MODEL_AGREEMENT_ANOMALY"
    if delta_from_previous <= -(thresholds["drop_std_multiplier"] * baseline_std):
        return "SUDDEN_DROP"
    if delta_from_previous >= thresholds["spike_std_multiplier"] * baseline_std:
        return "SUDDEN_SPIKE"
    if abs(delta_from_rolling_mean) >= thresholds["rolling_deviation_std_multiplier"] * baseline_std:
        return "ROLLING_DEVIATION"
    return "NORMAL_PATTERN"


def build_summary(
    *,
    element_code: str,
    anomaly_type: str,
    current_value: float,
    previous_value: float,
    rolling_mean_3: float,
    delta_from_previous: float,
    delta_from_rolling_mean: float,
    isolation_forest_label: str,
    isolation_forest_score: float,
    one_class_svm_label: str,
    one_class_svm_score: float,
    final_decision: str,
) -> str:
    """Build a clear review-oriented summary string."""
    type_intro = describe_element_behavior(element_code, anomaly_type)
    return (
        f"{type_intro} Current value is {current_value:.2f}, compared with {previous_value:.2f} in the "
        f"previous reading and a rolling mean of {rolling_mean_3:.2f}. "
        f"Change from previous is {delta_from_previous:.2f} and change from the rolling mean is "
        f"{delta_from_rolling_mean:.2f}. Isolation Forest is {isolation_forest_label} "
        f"(score {isolation_forest_score:.3f}) and One-Class SVM is {one_class_svm_label} "
        f"(score {one_class_svm_score:.3f}), so the final review status is {final_decision}."
    )


def build_explanation(
    *,
    element_code: str,
    current_value: str,
    previous_value: str,
    rolling_mean_3: str,
    rolling_std_3: str,
    isolation_forest_label: str,
    isolation_forest_score: float,
    one_class_svm_label: str,
    one_class_svm_score: float,
    final_decision: str,
) -> Dict[str, str]:
    """Generate a concise human-readable explanation bundle."""
    current_value_float = float(current_value)
    previous_value_float = float(previous_value)
    rolling_mean_float = float(rolling_mean_3)
    rolling_std_float = float(rolling_std_3)
    delta_from_previous = current_value_float - previous_value_float
    delta_from_rolling_mean = current_value_float - rolling_mean_float
    if final_decision == "NORMAL":
        anomaly_type = "NORMAL_PATTERN"
    else:
        anomaly_type = classify_anomaly_type(
            element_code=element_code,
            current_value=current_value_float,
            previous_value=previous_value_float,
            rolling_mean_3=rolling_mean_float,
            rolling_std_3=rolling_std_float,
            isolation_forest_label=isolation_forest_label,
            one_class_svm_label=one_class_svm_label,
        )
    severity = infer_severity(final_decision)
    explanation_summary = build_summary(
        element_code=element_code,
        anomaly_type=anomaly_type,
        current_value=current_value_float,
        previous_value=previous_value_float,
        rolling_mean_3=rolling_mean_float,
        delta_from_previous=delta_from_previous,
        delta_from_rolling_mean=delta_from_rolling_mean,
        isolation_forest_label=isolation_forest_label,
        isolation_forest_score=float(isolation_forest_score),
        one_class_svm_label=one_class_svm_label,
        one_class_svm_score=float(one_class_svm_score),
        final_decision=final_decision,
    )
    return {
        "anomaly_type": anomaly_type,
        "delta_from_previous": f"{delta_from_previous:.6f}",
        "delta_from_rolling_mean": f"{delta_from_rolling_mean:.6f}",
        "severity": severity,
        "recommended_action": recommend_action(final_decision, element_code),
        "explanation_summary": explanation_summary,
    }
