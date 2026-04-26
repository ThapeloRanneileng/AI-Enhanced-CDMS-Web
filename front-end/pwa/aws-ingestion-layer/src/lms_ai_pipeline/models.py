from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from collections import defaultdict
from statistics import mean, pstdev
from typing import Dict, List, Sequence, Tuple

from .config import ENGINE_VERSION, MODEL_VERSION

MAX_SKLEARN_ROWS = 50000


@dataclass(frozen=True)
class AutoencoderConfig:
    epochs: int = 50
    batch_size: int = 128
    validation_split: float = 0.2
    patience: int = 5
    contamination: float = 0.05
    max_training_rows: int = 50000


AUTOENCODER_STATUS_FIELDS = [
    "modelName", "status", "tensorflowInstalled", "kerasInstalled", "tensorflowVersion", "kerasVersion",
    "cpuDevices", "gpuDevices", "epochs", "batchSize", "validationSplit", "patience", "contamination",
    "maxTrainingRows", "trainRows", "testRows", "finalLoss", "finalValidationLoss", "message",
]

AUTOENCODER_HISTORY_FIELDS = ["epoch", "loss", "validationLoss"]


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


def detect_tensorflow_keras() -> Dict[str, object]:
    info: Dict[str, object] = {
        "tensorflowInstalled": False,
        "kerasInstalled": False,
        "tensorflowVersion": "",
        "kerasVersion": "",
        "cpuDevices": [],
        "gpuDevices": [],
    }
    try:
        import tensorflow as tf  # type: ignore[import-not-found]

        info["tensorflowInstalled"] = True
        info["tensorflowVersion"] = getattr(tf, "__version__", "")
        info["cpuDevices"] = [device.name for device in tf.config.list_physical_devices("CPU")]
        info["gpuDevices"] = [device.name for device in tf.config.list_physical_devices("GPU")]
    except Exception as error:
        info["tensorflowError"] = str(error)

    try:
        import keras  # type: ignore[import-not-found]

        info["kerasInstalled"] = True
        info["kerasVersion"] = getattr(keras, "__version__", "")
    except Exception as error:
        info["kerasError"] = str(error)
    return info


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


def normalized_feature_matrix(feature_rows: Sequence[Dict[str, object]], mean_values=None, std_values=None):
    import numpy as np

    matrix = np.array([feature_vector(row) for row in feature_rows], dtype=float)
    if mean_values is None:
        mean_values = matrix.mean(axis=0)
    if std_values is None:
        std_values = matrix.std(axis=0)
    std_values = np.where(std_values == 0, 1.0, std_values)
    return (matrix - mean_values) / std_values, mean_values, std_values


def autoencoder_predictions(
    train_rows: Sequence[Dict[str, object]],
    test_rows: Sequence[Dict[str, object]],
    config: AutoencoderConfig | None = None,
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]], List[Dict[str, object]]]:
    config = config or AutoencoderConfig()
    detection = detect_tensorflow_keras()
    base_status = {
        "modelName": "Autoencoder",
        "tensorflowInstalled": str(detection["tensorflowInstalled"]).lower(),
        "kerasInstalled": str(detection["kerasInstalled"]).lower(),
        "tensorflowVersion": detection.get("tensorflowVersion", ""),
        "kerasVersion": detection.get("kerasVersion", ""),
        "cpuDevices": ";".join(detection.get("cpuDevices", [])),
        "gpuDevices": ";".join(detection.get("gpuDevices", [])),
        "epochs": config.epochs,
        "batchSize": config.batch_size,
        "validationSplit": config.validation_split,
        "patience": config.patience,
        "contamination": config.contamination,
        "maxTrainingRows": config.max_training_rows,
        "trainRows": len(train_rows),
        "testRows": len(test_rows),
        "finalLoss": "",
        "finalValidationLoss": "",
    }
    if not detection["tensorflowInstalled"]:
        return [], [], [{**base_status, "status": "unavailable", "message": "TensorFlow is not installed; autoencoder predictions were skipped."}]
    if not train_rows or not test_rows:
        return [], [], [{**base_status, "status": "skipped", "message": "Autoencoder requires non-empty train and test feature rows."}]

    import numpy as np
    import tensorflow as tf  # type: ignore[import-not-found]

    training_rows = list(train_rows)[: max(1, int(config.max_training_rows))]
    x_train, mean_values, std_values = normalized_feature_matrix(training_rows)
    x_test, _, _ = normalized_feature_matrix(test_rows, mean_values, std_values)
    input_dim = x_train.shape[1]
    bottleneck_dim = max(2, input_dim // 3)
    hidden_dim = max(4, input_dim // 2)

    tf.random.set_seed(42)
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(input_dim,)),
            tf.keras.layers.Dense(hidden_dim, activation="relu"),
            tf.keras.layers.Dense(bottleneck_dim, activation="relu"),
            tf.keras.layers.Dense(hidden_dim, activation="relu"),
            tf.keras.layers.Dense(input_dim, activation="linear"),
        ]
    )
    model.compile(optimizer="adam", loss="mse")
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss" if len(x_train) > 2 and config.validation_split > 0 else "loss",
            patience=max(1, int(config.patience)),
            restore_best_weights=True,
        )
    ]
    effective_validation_split = float(config.validation_split) if len(x_train) > 2 else 0.0
    history = model.fit(
        x_train,
        x_train,
        epochs=max(1, int(config.epochs)),
        batch_size=max(1, int(config.batch_size)),
        validation_split=max(0.0, min(effective_validation_split, 0.8)),
        callbacks=callbacks,
        verbose=0,
        shuffle=False,
    )

    train_reconstructions = model.predict(x_train, verbose=0)
    test_reconstructions = model.predict(x_test, verbose=0)
    train_errors = np.mean(np.square(x_train - train_reconstructions), axis=1)
    test_errors = np.mean(np.square(x_test - test_reconstructions), axis=1)
    suspect_threshold = float(np.quantile(train_errors, max(0.0, min(0.999, 1.0 - config.contamination))))
    failed_threshold = float(np.quantile(train_errors, max(0.0, min(0.999, 1.0 - (config.contamination / 5.0)))))
    if failed_threshold <= suspect_threshold:
        failed_threshold = suspect_threshold * 1.5 if suspect_threshold > 0 else suspect_threshold + 0.001

    predictions: List[Dict[str, object]] = []
    for row, error in zip(test_rows, test_errors):
        score = float(error)
        if score >= failed_threshold:
            outcome, severity = "FAILED", "HIGH"
        elif score >= suspect_threshold:
            outcome, severity = "SUSPECT", "MEDIUM"
        else:
            outcome, severity = "NORMAL", "LOW"
        denominator = failed_threshold if outcome == "FAILED" else suspect_threshold
        ratio = score / denominator if denominator > 0 else score
        confidence = f"{min(0.99, max(0.50, 0.50 + (ratio * 0.35))):.2f}"
        explanation = (
            f"Autoencoder reconstruction error is {score:.6f}; suspect threshold is "
            f"{suspect_threshold:.6f} and failed threshold is {failed_threshold:.6f}."
        )
        predictions.append(build_prediction(row, "Autoencoder", score, outcome, severity, confidence, explanation))

    losses = history.history.get("loss", [])
    val_losses = history.history.get("val_loss", [])
    history_rows = [
        {
            "epoch": index + 1,
            "loss": f"{loss:.10f}",
            "validationLoss": f"{val_losses[index]:.10f}" if index < len(val_losses) else "",
        }
        for index, loss in enumerate(losses)
    ]
    status = {
        **base_status,
        "status": "trained",
        "finalLoss": f"{losses[-1]:.10f}" if losses else "",
        "finalValidationLoss": f"{val_losses[-1]:.10f}" if val_losses else "",
        "message": "TensorFlow/Keras autoencoder trained on normalized LMS numeric features using CPU/GPU devices reported by TensorFlow.",
    }
    return predictions, history_rows, [status]


def model_status_rows() -> List[Dict[str, object]]:
    detection = detect_tensorflow_keras()
    return [
        {"modelName": "Isolation Forest", "status": "available" if dependency_available("sklearn") else "fallback", "message": f"Uses scikit-learn when installed for up to {MAX_SKLEARN_ROWS} rows; otherwise uses deterministic seasonal-distance fallback."},
        {"modelName": "One-Class SVM", "status": "available" if dependency_available("sklearn") else "fallback", "message": f"Uses scikit-learn when installed for up to {MAX_SKLEARN_ROWS} rows; otherwise uses deterministic seasonal-distance fallback."},
        {"modelName": "Autoencoder", "status": "available" if detection["tensorflowInstalled"] else "unavailable", "message": f"TensorFlow={detection.get('tensorflowVersion', '') or 'missing'}; Keras={detection.get('kerasVersion', '') or 'missing'}; GPUs={len(detection.get('gpuDevices', []))}."},
        {"modelName": "Random Forest", "status": "not_trained", "message": "Requires labelled QC outcomes; cleaned LMS CSV has no NORMAL/SUSPECT/FAILED labels."},
    ]


def random_forest_status_rows() -> List[Dict[str, object]]:
    return [{
        "modelName": "Random Forest",
        "status": "not_trained",
        "reason": "No reliable QC-reviewed labels are present in the cleaned LMS CSV.",
        "requiredInput": "Future labelled rows with stationId, elementCode, features, and QC outcome NORMAL/SUSPECT/FAILED.",
    }]
