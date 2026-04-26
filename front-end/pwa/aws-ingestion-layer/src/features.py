"""Reusable feature engineering for the AWS anomaly engine."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Sequence, Tuple

import numpy as np


TEMPORAL_FEATURE_FIELDS = [
    "previous_value",
    "difference_from_previous",
    "rolling_mean_3",
    "rolling_std_3",
    "hour_of_day",
    "month",
]


def build_category_maps(rows: Sequence[Dict[str, str]]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """Create stable integer positions for stations and element codes."""
    station_ids = sorted({row["station_id"] for row in rows})
    element_codes = sorted({row["element_code"] for row in rows})
    station_map = {station_id: index for index, station_id in enumerate(station_ids)}
    element_map = {element_code: index for index, element_code in enumerate(element_codes)}
    return station_map, element_map


def standardize_numeric_column(values: List[float]) -> np.ndarray:
    """Scale a numeric column using simple standardization."""
    array = np.array(values, dtype=float)
    std = array.std()
    if std == 0:
        return np.zeros(len(array), dtype=float)
    return (array - array.mean()) / std


def engineer_temporal_features(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Attach sequential and seasonal features within each station-element series."""
    indexed_rows = list(enumerate(rows))
    sorted_rows = sorted(
        indexed_rows,
        key=lambda item: (
            item[1]["station_id"],
            item[1]["element_code"],
            item[1]["observation_datetime"],
        ),
    )

    enriched_rows = [dict(row) for row in rows]
    series_history: Dict[Tuple[str, str], List[float]] = {}

    for original_index, row in sorted_rows:
        series_key = (row["station_id"], row["element_code"])
        current_value = float(row["value"])
        history = series_history.setdefault(series_key, [])

        previous_value = history[-1] if history else current_value
        difference_from_previous = current_value - previous_value

        rolling_window = (history + [current_value])[-3:]
        rolling_mean = sum(rolling_window) / len(rolling_window)
        rolling_std = float(np.std(np.array(rolling_window, dtype=float)))

        timestamp = datetime.strptime(row["observation_datetime"], "%Y-%m-%d %H:%M:%S")
        enriched_rows[original_index].update(
            {
                "previous_value": f"{previous_value:.6f}",
                "difference_from_previous": f"{difference_from_previous:.6f}",
                "rolling_mean_3": f"{rolling_mean:.6f}",
                "rolling_std_3": f"{rolling_std:.6f}",
                "hour_of_day": str(timestamp.hour),
                "month": str(timestamp.month),
            }
        )
        history.append(current_value)

    return enriched_rows


def prepare_feature_matrix(rows: Sequence[Dict[str, str]]) -> np.ndarray:
    """Convert observation rows into a model-ready feature matrix."""
    enriched_rows = engineer_temporal_features(rows)
    station_map, element_map = build_category_maps(rows)

    value_features: List[float] = []
    previous_values: List[float] = []
    difference_values: List[float] = []
    rolling_means: List[float] = []
    rolling_stds: List[float] = []
    hours: List[float] = []
    months: List[float] = []
    station_vectors: List[np.ndarray] = []
    element_vectors: List[np.ndarray] = []

    for row in enriched_rows:
        value_features.append(float(row["value"]))
        previous_values.append(float(row["previous_value"]))
        difference_values.append(float(row["difference_from_previous"]))
        rolling_means.append(float(row["rolling_mean_3"]))
        rolling_stds.append(float(row["rolling_std_3"]))
        hours.append(float(row["hour_of_day"]))
        months.append(float(row["month"]))

        station_vector = np.zeros(len(station_map), dtype=float)
        station_vector[station_map[row["station_id"]]] = 1.0
        station_vectors.append(station_vector)

        element_vector = np.zeros(len(element_map), dtype=float)
        element_vector[element_map[row["element_code"]]] = 1.0
        element_vectors.append(element_vector)

    numeric_block = np.column_stack(
        [
            standardize_numeric_column(value_features),
            standardize_numeric_column(previous_values),
            standardize_numeric_column(difference_values),
            standardize_numeric_column(rolling_means),
            standardize_numeric_column(rolling_stds),
            standardize_numeric_column(hours),
            standardize_numeric_column(months),
        ]
    )
    station_block = np.vstack(station_vectors)
    element_block = np.vstack(element_vectors)
    return np.hstack([numeric_block, station_block, element_block])
