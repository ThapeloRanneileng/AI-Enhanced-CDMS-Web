from __future__ import annotations

import importlib.util
from collections import defaultdict
from statistics import mean, pstdev
from typing import Dict, List, Sequence, Tuple

from .config import ENGINE_VERSION, MODEL_VERSION

MAX_SKLEARN_ROWS = 50000


PREDICTION_FIELDS = [
    "stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "elementName", "value", "unit",
    "modelName", "anomalyScore", "confidence", "severity", "outcome", "explanation", "recommendedReviewerAction",
]


def outcome_from_z(z_value: float) -> Tuple[str, str, str]:
    absolute = abs(z_value)
    if absolute >= 3:
        return "FAILED", "HIGH", "0.95"
    if absolute >= 2:
        return "SUSPECT", "MEDIUM", "0.75"
    return "NORMAL", "LOW", "0.50"


def reviewer_action(outcome: str) -> str:
    if outcome == "FAILED":
        return "Review against original LMS paper/source record before accepting."
    if outcome == "SUSPECT":
        return "Check nearby days and station metadata before approval."
    return "No reviewer action required."


def build_prediction(row: Dict[str, object], model_name: str, score: float, outcome: str, severity: str, confidence: str, explanation: str) -> Dict[str, object]:
    return {
        "stationId": row["stationId"],
        "stationName": row["stationName"],
        "district": row["district"],
        "stationType": row["stationType"],
        "observationDatetime": row["observationDatetime"],
        "elementCode": row["elementCode"],
        "elementName": row["elementName"],
        "value": row["value"],
        "unit": row["unit"],
        "modelName": model_name,
        "anomalyScore": f"{score:.6f}",
        "confidence": confidence,
        "severity": severity,
        "outcome": outcome,
        "explanation": explanation,
        "recommendedReviewerAction": reviewer_action(outcome),
    }


def zscore_predictions(feature_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    predictions: List[Dict[str, object]] = []
    for row in feature_rows:
        z_score = float(row["z_score"])
        seasonal_z = float(row["seasonal_z_score"])
        chosen = seasonal_z if abs(seasonal_z) >= abs(z_score) else z_score
        outcome, severity, confidence = outcome_from_z(chosen)
        explanation = (
            f"{row['elementName']} value {row['value']} has z_score={z_score:.2f} "
            f"and seasonal_z_score={seasonal_z:.2f} for {row['stationName']}."
        )
        predictions.append(build_prediction(row, "Z-score", abs(chosen), outcome, severity, confidence, explanation))
    return predictions


def dependency_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def feature_vector(row: Dict[str, object]) -> List[float]:
    return [
        float(row["value"]),
        float(row["stationIdEncoding"]),
        float(row["elementCodeEncoding"]),
        float(row["month"]),
        float(row["dayOfYear"]),
        float(row["seasonal_z_score"]),
        float(row["rolling_mean_7"]),
        float(row["rolling_std_7"]),
        float(row["rolling_mean_30"]),
        float(row["rolling_std_30"]),
        float(row["previous_value"]),
        float(row["value_difference"]),
    ]


def distance_predictions(feature_rows: Sequence[Dict[str, object]], model_name: str) -> List[Dict[str, object]]:
    """Dependency-free fallback used when sklearn is unavailable."""
    grouped: Dict[Tuple[str, str], List[Dict[str, object]]] = defaultdict(list)
    for row in feature_rows:
        grouped[(str(row["stationId"]), str(row["elementCode"]))].append(row)

    predictions: List[Dict[str, object]] = []
    for series in grouped.values():
        values = [abs(float(row["seasonal_z_score"])) for row in series]
        center = mean(values) if values else 0.0
        spread = pstdev(values) if len(values) > 1 else 0.0
        for row, value in zip(series, values):
            score = ((value - center) / spread) if spread else value
            outcome, severity, confidence = outcome_from_z(score)
            explanation = (
                f"{model_name} fallback used because scikit-learn is unavailable; "
                f"score is based on seasonal z-score distance."
            )
            predictions.append(build_prediction(row, model_name, abs(score), outcome, severity, confidence, explanation))
    return predictions


def isolation_forest_predictions(feature_rows: Sequence[Dict[str, object]], contamination: float = 0.05) -> List[Dict[str, object]]:
    if not feature_rows:
        return []
    if not dependency_available("sklearn") or len(feature_rows) > MAX_SKLEARN_ROWS:
        return distance_predictions(feature_rows, "Isolation Forest")
    import numpy as np
    from sklearn.ensemble import IsolationForest

    matrix = np.array([feature_vector(row) for row in feature_rows], dtype=float)
    model = IsolationForest(n_estimators=200, contamination=contamination, random_state=42)
    model.fit(matrix)
    labels = model.predict(matrix)
    scores = -model.decision_function(matrix)
    predictions: List[Dict[str, object]] = []
    for row, label, score in zip(feature_rows, labels, scores):
        outcome = "SUSPECT" if int(label) == -1 else "NORMAL"
        severity = "MEDIUM" if outcome == "SUSPECT" else "LOW"
        predictions.append(build_prediction(row, "Isolation Forest", float(score), outcome, severity, "0.70", "Isolation Forest scored the row in feature space."))
    return predictions


def one_class_svm_predictions(feature_rows: Sequence[Dict[str, object]], nu: float = 0.05) -> List[Dict[str, object]]:
    if not feature_rows:
        return []
    if not dependency_available("sklearn") or len(feature_rows) > MAX_SKLEARN_ROWS:
        return distance_predictions(feature_rows, "One-Class SVM")
    import numpy as np
    from sklearn.svm import OneClassSVM

    matrix = np.array([feature_vector(row) for row in feature_rows], dtype=float)
    model = OneClassSVM(kernel="rbf", gamma="scale", nu=nu)
    model.fit(matrix)
    labels = model.predict(matrix)
    scores = -model.decision_function(matrix)
    predictions: List[Dict[str, object]] = []
    for row, label, score in zip(feature_rows, labels, scores):
        outcome = "SUSPECT" if int(label) == -1 else "NORMAL"
        severity = "MEDIUM" if outcome == "SUSPECT" else "LOW"
        predictions.append(build_prediction(row, "One-Class SVM", float(score), outcome, severity, "0.70", "One-Class SVM scored the row against the learned normal boundary."))
    return predictions


def autoencoder_predictions(feature_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    if not (dependency_available("tensorflow") or dependency_available("keras")):
        return []
    return []


def model_status_rows() -> List[Dict[str, object]]:
    return [
        {"modelName": "Isolation Forest", "status": "available" if dependency_available("sklearn") else "fallback", "message": f"Uses scikit-learn when installed for up to {MAX_SKLEARN_ROWS} rows; otherwise uses deterministic seasonal-distance fallback."},
        {"modelName": "One-Class SVM", "status": "available" if dependency_available("sklearn") else "fallback", "message": f"Uses scikit-learn when installed for up to {MAX_SKLEARN_ROWS} rows; otherwise uses deterministic seasonal-distance fallback."},
        {"modelName": "Autoencoder", "status": "available" if (dependency_available("tensorflow") or dependency_available("keras")) else "unavailable", "message": "Install TensorFlow/Keras to enable reconstruction-error autoencoder predictions."},
        {"modelName": "Random Forest", "status": "not_trained", "message": "Requires labelled QC outcomes; cleaned LMS CSV has no NORMAL/SUSPECT/FAILED labels."},
    ]


def random_forest_status_rows() -> List[Dict[str, object]]:
    return [{
        "modelName": "Random Forest",
        "status": "not_trained",
        "reason": "No reliable QC-reviewed labels are present in the cleaned LMS CSV.",
        "requiredInput": "Future labelled rows with stationId, elementCode, features, and QC outcome NORMAL/SUSPECT/FAILED.",
    }]
