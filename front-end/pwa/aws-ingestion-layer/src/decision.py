"""Explainable final decision rules for AWS anomaly review."""

from __future__ import annotations

from typing import Dict

try:
    from .thresholds import get_thresholds
except ImportError:
    from thresholds import get_thresholds


def normalize_model_label(raw_prediction: int) -> str:
    """Convert sklearn-style predictions into readable labels."""
    return "anomaly" if int(raw_prediction) == -1 else "normal"


def decide_final_status(
    element_code: str,
    isolation_forest_label: str,
    one_class_svm_label: str,
    isolation_forest_score: float,
    one_class_svm_score: float,
) -> Dict[str, str]:
    """Combine model outputs into one review-ready decision."""
    thresholds = get_thresholds(element_code)
    model_votes = [isolation_forest_label, one_class_svm_label]
    anomaly_votes = model_votes.count("anomaly")
    combined_score = max(float(isolation_forest_score), float(one_class_svm_score))
    weaker_score = min(float(isolation_forest_score), float(one_class_svm_score))
    model_agreement = anomaly_votes == 2
    strong_agreement = model_agreement and weaker_score >= thresholds["failed_score_threshold"]
    any_strong_signal = combined_score >= thresholds["suspect_score_threshold"]

    if strong_agreement:
        final_decision = "FAILED"
    elif anomaly_votes >= 1 and any_strong_signal:
        final_decision = "SUSPECT"
    else:
        final_decision = "NORMAL"

    ml_status = {
        "FAILED": "flagged_by_model",
        "SUSPECT": "flagged_by_model",
        "NORMAL": "passed_baseline_model",
    }[final_decision]

    legacy_anomaly_label = "anomaly" if final_decision != "NORMAL" else "normal"
    return {
        "final_decision": final_decision,
        "ml_status": ml_status,
        "anomaly_label": legacy_anomaly_label,
        "anomaly_score": f"{combined_score:.6f}",
        "model_agreement": "yes" if model_agreement else "no",
        "model_name": "IsolationForest+OneClassSVM",
    }
