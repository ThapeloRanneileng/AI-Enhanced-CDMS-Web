"""Element-specific threshold configuration for the AWS anomaly engine."""

from __future__ import annotations

from typing import Dict


DEFAULT_THRESHOLDS = {
    "failed_score_threshold": 0.25,
    "suspect_score_threshold": 0.05,
    "drop_std_multiplier": 2.0,
    "spike_std_multiplier": 2.0,
    "rolling_deviation_std_multiplier": 1.5,
}

ELEMENT_THRESHOLDS = {
    "TEMP": {
        "failed_score_threshold": 0.25,
        "suspect_score_threshold": 0.05,
        "drop_std_multiplier": 2.0,
        "spike_std_multiplier": 2.0,
        "rolling_deviation_std_multiplier": 1.5,
    },
    "RH": {
        "failed_score_threshold": 0.22,
        "suspect_score_threshold": 0.05,
        "drop_std_multiplier": 1.5,
        "spike_std_multiplier": 2.0,
        "rolling_deviation_std_multiplier": 1.4,
    },
    "RAIN": {
        "failed_score_threshold": 0.35,
        "suspect_score_threshold": 0.10,
        "drop_std_multiplier": 3.0,
        "spike_std_multiplier": 3.0,
        "rolling_deviation_std_multiplier": 2.0,
    },
    "PRES": {
        "failed_score_threshold": 0.20,
        "suspect_score_threshold": 0.04,
        "drop_std_multiplier": 1.5,
        "spike_std_multiplier": 1.5,
        "rolling_deviation_std_multiplier": 1.2,
    },
    "WSPD": {
        "failed_score_threshold": 0.28,
        "suspect_score_threshold": 0.06,
        "drop_std_multiplier": 2.0,
        "spike_std_multiplier": 1.8,
        "rolling_deviation_std_multiplier": 1.5,
    },
    "WDIR": {
        "failed_score_threshold": 0.30,
        "suspect_score_threshold": 0.08,
        "drop_std_multiplier": 3.0,
        "spike_std_multiplier": 3.0,
        "rolling_deviation_std_multiplier": 2.5,
    },
}


def get_thresholds(element_code: str) -> Dict[str, float]:
    """Return thresholds for one element, falling back to defaults."""
    return {**DEFAULT_THRESHOLDS, **ELEMENT_THRESHOLDS.get(element_code, {})}
