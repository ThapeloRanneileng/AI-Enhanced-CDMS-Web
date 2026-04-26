"""Model runners for the AWS anomaly engine."""

from __future__ import annotations

from typing import Tuple

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM


def run_isolation_forest(feature_matrix: np.ndarray, contamination: float) -> Tuple[np.ndarray, np.ndarray]:
    """Fit Isolation Forest and return labels plus anomaly scores."""
    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=42,
    )
    model.fit(feature_matrix)
    predictions = model.predict(feature_matrix)
    anomaly_scores = -model.decision_function(feature_matrix)
    return predictions, anomaly_scores


def run_one_class_svm(feature_matrix: np.ndarray, contamination: float) -> Tuple[np.ndarray, np.ndarray]:
    """Fit One-Class SVM and return labels plus anomaly scores."""
    model = OneClassSVM(kernel="rbf", gamma="scale", nu=contamination)
    model.fit(feature_matrix)
    predictions = model.predict(feature_matrix)
    anomaly_scores = -model.decision_function(feature_matrix)
    return predictions, anomaly_scores
