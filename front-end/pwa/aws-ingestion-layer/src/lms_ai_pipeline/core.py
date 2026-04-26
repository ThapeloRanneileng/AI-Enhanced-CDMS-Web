from __future__ import annotations

from collections import Counter, defaultdict, deque
from datetime import date, datetime
from math import isfinite, sqrt
from pathlib import Path
from statistics import mean, pstdev
from typing import Dict, Iterable, List, Sequence, Tuple

from .config import (
    DATA_TYPE,
    DUPLICATE_CONFLICTS_FILE,
    ELEMENTS,
    IMPUTATION_SUMMARY_FILE,
    IMPUTED_SUPPORT_FILE,
    INPUT_FILE,
    INSPECTION_SUMMARY_FILE,
    IQR_OUTLIERS_FILE,
    MISSING_VALUES_FILE,
    NORMALIZED_FILE,
    REJECTED_VALUES_FILE,
    SOURCE_NAME,
    STATIONS,
    UNKNOWN_STATIONS_FILE,
    VALIDATION_SUMMARY_FILE,
    VALIDATION_WARNINGS_FILE,
)
from .io import read_csv, write_csv


NORMALIZED_FIELDS = [
    "stationId",
    "stationName",
    "district",
    "stationType",
    "observationDatetime",
    "elementCode",
    "elementName",
    "value",
    "unit",
    "source",
    "dataType",
    "originalRowNumber",
    "isImputed",
    "imputationMethod",
    "qualityFlags",
]

WARNING_FIELDS = ["rowNumber", "stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "warningType", "value", "message"]
REJECTED_FIELDS = ["rowNumber", "id", "stationId", "stationName", "district", "stationType", "year", "month", "day", "observationDatetime", "elementCode", "rawValue", "reason"]
MISSING_FIELDS = ["rowNumber", "stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "missingReason"]
DUPLICATE_CONFLICT_FIELDS = ["stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "firstRowNumber", "firstValue", "conflictRowNumber", "conflictValue", "reason"]
UNKNOWN_STATION_FIELDS = ["rowNumber", "rawStationId", "year", "month", "day", "reason"]
IQR_OUTLIER_FIELDS = ["stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "value", "q1", "q3", "iqr", "lowerBound", "upperBound", "flag"]
IMPUTED_FIELDS = ["stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "originalValue", "imputedValue", "imputationMethod", "imputationFlag"]
IMPUTATION_SUMMARY_FIELDS = ["stationId", "stationName", "district", "stationType", "elementCode", "missingValues", "imputedValues", "monthlyMeanImputations", "historicalMeanImputations", "notImputedValues"]

NULL_MARKERS = {"", "null", "none", "nan", "na", "n/a", "-999", "-9999"}
EXTREME_BOUNDS = {
    "rain": (0.0, 300.0),
    "tmax": (-20.0, 50.0),
    "tmin": (-30.0, 40.0),
}
MIN_MONTHLY_VALUES_FOR_IMPUTATION = 3


def parse_float(value: str) -> float | None:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if isfinite(parsed) else None


def is_missing_value(value: object) -> bool:
    return value is None or str(value).strip().lower() in NULL_MARKERS


def parse_observation_date(row: Dict[str, str]) -> date | None:
    try:
        return date(int(row["year"]), int(row["month"]), int(row["day"]))
    except (KeyError, TypeError, ValueError):
        return None


def format_observation_date(obs_date: date) -> str:
    return obs_date.isoformat()


def parse_normalized_datetime(value: object) -> datetime:
    text = str(value)
    if len(text) == 10:
        return datetime.strptime(text, "%Y-%m-%d")
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")


def normalize_station_id(raw_station_id: object) -> str:
    return str(raw_station_id or "").strip().upper()


def station_metadata(station_id: str) -> Dict[str, str]:
    metadata = STATIONS.get(station_id)
    if not metadata:
        return {"stationName": "", "district": "", "stationType": ""}
    return metadata


def warning(row_number: int, station_id: str, obs_date: date | None, element_code: str, warning_type: str, value: object, message: str) -> Dict[str, object]:
    return {
        **station_metadata(station_id),
        "rowNumber": row_number,
        "stationId": station_id,
        "observationDatetime": format_observation_date(obs_date) if obs_date else "",
        "elementCode": element_code,
        "warningType": warning_type,
        "value": value,
        "message": message,
    }


def reject_value(row: Dict[str, str], row_number: int, station_id: str, obs_date: date | None, element_code: str, raw_value: object, reason: str) -> Dict[str, object]:
    return {
        **station_metadata(station_id),
        "rowNumber": row_number,
        "id": row.get("id", ""),
        "stationId": station_id,
        "year": row.get("year", ""),
        "month": row.get("month", ""),
        "day": row.get("day", ""),
        "observationDatetime": format_observation_date(obs_date) if obs_date else "",
        "elementCode": element_code,
        "rawValue": "" if raw_value is None else raw_value,
        "reason": reason,
    }


def normalize_rows(rows: Sequence[Dict[str, str]], include_derived_outputs: bool = True) -> Tuple[
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
    List[Dict[str, object]],
]:
    normalized: List[Dict[str, object]] = []
    warnings: List[Dict[str, object]] = []
    rejected: List[Dict[str, object]] = []
    missing_values: List[Dict[str, object]] = []
    duplicate_conflicts: List[Dict[str, object]] = []
    unknown_stations: List[Dict[str, object]] = []
    accepted_by_key: Dict[Tuple[str, str, str], Dict[str, object]] = {}
    station_dates: Dict[str, List[date]] = defaultdict(list)
    station_counts: Counter[str] = Counter()
    invalid_date_rows = 0
    unknown_station_rows = 0

    for index, row in enumerate(rows, start=2):
        station_id = normalize_station_id(row.get("id", ""))
        obs_date = parse_observation_date(row)
        if obs_date is None:
            invalid_date_rows += 1
            rejected.append(reject_value(row, index, station_id, None, "", "", "Invalid or missing observation date"))
            continue
        if station_id not in STATIONS:
            unknown_station_rows += 1
            unknown_stations.append({
                "rowNumber": index,
                "rawStationId": row.get("id", ""),
                "year": row.get("year", ""),
                "month": row.get("month", ""),
                "day": row.get("day", ""),
                "reason": "Station ID is not in the official LMS station mapping",
            })
            continue

        observation_datetime = format_observation_date(obs_date)
        station_dates[station_id].append(obs_date)
        station_counts[station_id] += 1
        parsed_values: Dict[str, float] = {}

        for code, meta in ELEMENTS.items():
            raw_value = row.get(code, "")
            if is_missing_value(raw_value):
                missing_values.append({
                    **station_metadata(station_id),
                    "rowNumber": index,
                    "stationId": station_id,
                    "observationDatetime": observation_datetime,
                    "elementCode": code,
                    "missingReason": f"Missing {code} value",
                })
                continue

            value = parse_float(raw_value)
            if value is None:
                rejected.append(reject_value(row, index, station_id, obs_date, code, raw_value, "Non-numeric or malformed value"))
                continue

            if code == "rain" and value < 0:
                warnings.append(warning(index, station_id, obs_date, code, "NEGATIVE_RAINFALL", value, "Rainfall is negative and was rejected."))
                rejected.append(reject_value(row, index, station_id, obs_date, code, raw_value, "Negative rainfall"))
                continue

            parsed_values[code] = value
            quality_flags: List[str] = []
            lower, upper = EXTREME_BOUNDS[code]
            if value < lower or value > upper:
                quality_flags.append("EXTREME_VALUE")
                warnings.append(warning(index, station_id, obs_date, code, "EXTREME_VALUE", value, f"{code} value is outside the expected climate range and needs QC review."))

            key = (station_id, observation_datetime, code)
            existing = accepted_by_key.get(key)
            if existing:
                if float(existing["value"]) == value:
                    warnings.append(warning(index, station_id, obs_date, code, "DUPLICATE_IDENTICAL", value, "Duplicate station-date-element value matched an earlier value; one copy was kept."))
                else:
                    duplicate_conflicts.append({
                        **station_metadata(station_id),
                        "stationId": station_id,
                        "observationDatetime": observation_datetime,
                        "elementCode": code,
                        "firstRowNumber": existing["originalRowNumber"],
                        "firstValue": existing["value"],
                        "conflictRowNumber": index,
                        "conflictValue": value,
                        "reason": "Duplicate station-date-element values conflict",
                    })
                    warnings.append(warning(index, station_id, obs_date, code, "DUPLICATE_CONFLICT", value, "Duplicate station-date-element values conflict; later value was excluded."))
                continue

            accepted_by_key[key] = {
                **station_metadata(station_id),
                "stationId": station_id,
                "observationDatetime": observation_datetime,
                "elementCode": code,
                "elementName": meta["name"],
                "value": f"{value:.6f}",
                "unit": meta["unit"],
                "source": SOURCE_NAME,
                "dataType": DATA_TYPE,
                "originalRowNumber": index,
                "isImputed": "false",
                "imputationMethod": "",
                "qualityFlags": ";".join(quality_flags),
            }

        if "tmin" in parsed_values and "tmax" in parsed_values and parsed_values["tmin"] > parsed_values["tmax"]:
            warnings.append(warning(index, station_id, obs_date, "tmin,tmax", "TMIN_GREATER_THAN_TMAX", f"{parsed_values['tmin']},{parsed_values['tmax']}", "Minimum temperature is greater than maximum temperature; keep values but flag for QC review."))

    normalized = sorted(accepted_by_key.values(), key=lambda item: (str(item["stationId"]), str(item["observationDatetime"]), str(item["elementCode"])))
    iqr_outliers: List[Dict[str, object]] = []
    imputed_support: List[Dict[str, object]] = []
    imputation_summary: List[Dict[str, object]] = []
    if include_derived_outputs:
        iqr_outliers = detect_iqr_outliers(normalized)
        warnings.extend(iqr_outlier_warnings(iqr_outliers))
        warnings.extend(detect_constant_sequence_warnings(normalized))
        imputed_support, imputation_summary = build_imputed_support_dataset(normalized, missing_values)

    summary = [{
        "metric": "normalizedObservationRows",
        "value": len(normalized),
    }, {
        "metric": "validationWarnings",
        "value": len(warnings),
    }, {
        "metric": "rejectedValues",
        "value": len(rejected),
    }, {
        "metric": "missingValues",
        "value": len(missing_values),
    }, {
        "metric": "duplicateConflicts",
        "value": len(duplicate_conflicts),
    }, {
        "metric": "unknownStationRows",
        "value": unknown_station_rows,
    }, {
        "metric": "invalidDateRows",
        "value": invalid_date_rows,
    }, {
        "metric": "iqrOutliers",
        "value": len(iqr_outliers),
    }]
    inspection = build_inspection_summary(station_counts, station_dates, normalized, missing_values, rejected, duplicate_conflicts, unknown_station_rows, invalid_date_rows)
    return normalized, summary, warnings, rejected, missing_values, duplicate_conflicts, unknown_stations, iqr_outliers, imputed_support, imputation_summary, inspection


def percentile(sorted_values: Sequence[float], fraction: float) -> float:
    if not sorted_values:
        return 0.0
    position = (len(sorted_values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def detect_iqr_outliers(rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    outliers: List[Dict[str, object]] = []
    for (station_id, element_code), series in group_series(rows).items():
        values = sorted(float(row["value"]) for row in series)
        if len(values) < 4:
            continue
        q1 = percentile(values, 0.25)
        q3 = percentile(values, 0.75)
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        for row in series:
            value = float(row["value"])
            is_outlier = value < lower_bound or value > upper_bound
            if iqr == 0:
                is_outlier = value != q1
            if is_outlier:
                flags = [flag for flag in str(row.get("qualityFlags", "")).split(";") if flag]
                if "IQR_OUTLIER" not in flags:
                    flags.append("IQR_OUTLIER")
                row["qualityFlags"] = ";".join(flags)
                outliers.append({
                    "stationId": station_id,
                    "stationName": row["stationName"],
                    "district": row["district"],
                    "stationType": row["stationType"],
                    "observationDatetime": row["observationDatetime"],
                    "elementCode": element_code,
                    "value": f"{value:.6f}",
                    "q1": f"{q1:.6f}",
                    "q3": f"{q3:.6f}",
                    "iqr": f"{iqr:.6f}",
                    "lowerBound": f"{lower_bound:.6f}",
                    "upperBound": f"{upper_bound:.6f}",
                    "flag": "IQR_OUTLIER",
                })
    return outliers


def iqr_outlier_warnings(outliers: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    output: List[Dict[str, object]] = []
    for outlier in outliers:
        output.append({
            "rowNumber": "",
            "stationId": outlier["stationId"],
            "stationName": outlier["stationName"],
            "district": outlier["district"],
            "stationType": outlier["stationType"],
            "observationDatetime": outlier["observationDatetime"],
            "elementCode": outlier["elementCode"],
            "warningType": "IQR_OUTLIER",
            "value": outlier["value"],
            "message": "Value is outside the station-element IQR bounds and needs QC review.",
        })
    return output


def detect_constant_sequence_warnings(rows: Sequence[Dict[str, object]], min_length: int = 7) -> List[Dict[str, object]]:
    output: List[Dict[str, object]] = []
    for (station_id, element_code), series in group_series(rows).items():
        run_value: float | None = None
        run_start = 0
        for idx, row in enumerate(series + [None]):  # type: ignore[list-item]
            value = float(row["value"]) if row is not None else None
            if run_value is None or value != run_value:
                run_length = idx - run_start
                if run_value is not None and run_length >= min_length:
                    start_row = series[run_start]
                    end_row = series[idx - 1]
                    output.append({
                        "rowNumber": "",
                        "stationId": station_id,
                        "stationName": start_row["stationName"],
                        "district": start_row["district"],
                        "stationType": start_row["stationType"],
                        "observationDatetime": f"{start_row['observationDatetime']}..{end_row['observationDatetime']}",
                        "elementCode": element_code,
                        "warningType": "SUSPICIOUS_CONSTANT_SEQUENCE",
                        "value": f"{run_value:.6f}",
                        "message": f"{run_length} consecutive identical values need QC review.",
                    })
                run_value = value
                run_start = idx
    return output


def build_imputed_support_dataset(normalized: Sequence[Dict[str, object]], missing_values: Sequence[Dict[str, object]]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    values_by_group_month: Dict[Tuple[str, str, int], List[float]] = defaultdict(list)
    values_by_group: Dict[Tuple[str, str], List[float]] = defaultdict(list)
    for row in normalized:
        dt = datetime.strptime(str(row["observationDatetime"]), "%Y-%m-%d")
        key = (str(row["stationId"]), str(row["elementCode"]))
        value = float(row["value"])
        values_by_group_month[(key[0], key[1], dt.month)].append(value)
        values_by_group[key].append(value)
    monthly_means = {
        key: mean(values)
        for key, values in values_by_group_month.items()
        if len(values) >= MIN_MONTHLY_VALUES_FOR_IMPUTATION
    }
    historical_means = {
        key: mean(values)
        for key, values in values_by_group.items()
        if values
    }

    imputed: List[Dict[str, object]] = []
    summary_counter: Dict[Tuple[str, str], Counter[str]] = defaultdict(Counter)
    for missing in missing_values:
        station_id = str(missing["stationId"])
        element_code = str(missing["elementCode"])
        dt = datetime.strptime(str(missing["observationDatetime"]), "%Y-%m-%d")
        key = (station_id, element_code)
        summary_counter[key]["missingValues"] += 1

        imputed_value = ""
        method = ""
        flag = "NOT_IMPUTED"
        monthly_key = (station_id, element_code, dt.month)
        if monthly_key in monthly_means:
            imputed_value = f"{monthly_means[monthly_key]:.6f}"
            method = "station_element_monthly_mean"
            flag = "IMPUTED"
            summary_counter[key]["monthlyMeanImputations"] += 1
        elif key in historical_means:
            imputed_value = f"{historical_means[key]:.6f}"
            method = "station_element_historical_mean"
            flag = "IMPUTED"
            summary_counter[key]["historicalMeanImputations"] += 1
        else:
            summary_counter[key]["notImputedValues"] += 1
        if flag == "IMPUTED":
            summary_counter[key]["imputedValues"] += 1

        imputed.append({
            "stationId": station_id,
            "stationName": missing["stationName"],
            "district": missing["district"],
            "stationType": missing["stationType"],
            "observationDatetime": missing["observationDatetime"],
            "elementCode": element_code,
            "originalValue": "",
            "imputedValue": imputed_value,
            "imputationMethod": method,
            "imputationFlag": flag,
        })

    summary = []
    for (station_id, element_code), counts in sorted(summary_counter.items()):
        summary.append({
            **station_metadata(station_id),
            "stationId": station_id,
            "elementCode": element_code,
            "missingValues": counts["missingValues"],
            "imputedValues": counts["imputedValues"],
            "monthlyMeanImputations": counts["monthlyMeanImputations"],
            "historicalMeanImputations": counts["historicalMeanImputations"],
            "notImputedValues": counts["notImputedValues"],
        })
    return imputed, summary


def build_inspection_summary(
    station_counts: Counter[str],
    station_dates: Dict[str, List[date]],
    normalized: Sequence[Dict[str, object]],
    missing_values: Sequence[Dict[str, object]],
    rejected: Sequence[Dict[str, object]],
    duplicate_conflicts: Sequence[Dict[str, object]],
    unknown_station_rows: int,
    invalid_date_rows: int,
) -> List[Dict[str, object]]:
    normalized_counts = Counter(str(row["stationId"]) for row in normalized)
    missing_counts = Counter(str(row["stationId"]) for row in missing_values)
    rejected_counts = Counter(str(row["stationId"]) for row in rejected)
    conflict_counts = Counter(str(row["stationId"]) for row in duplicate_conflicts)
    summary: List[Dict[str, object]] = []
    for station_id in sorted(STATIONS):
        dates = station_dates.get(station_id, [])
        summary.append({
            **station_metadata(station_id),
            "stationId": station_id,
            "rawRows": station_counts.get(station_id, 0),
            "normalizedObservationRows": normalized_counts.get(station_id, 0),
            "dateFrom": min(dates).isoformat() if dates else "",
            "dateTo": max(dates).isoformat() if dates else "",
            "missingValues": missing_counts.get(station_id, 0),
            "rejectedValues": rejected_counts.get(station_id, 0),
            "duplicateConflicts": conflict_counts.get(station_id, 0),
            "invalidDateRows": invalid_date_rows,
            "unknownStationRows": unknown_station_rows,
        })
    return summary


def inspect_rows(rows: Sequence[Dict[str, str]]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]], List[Dict[str, object]]]:
    _, _, warnings, rejected, _, _, _, _, _, _, inspection = normalize_rows(rows, include_derived_outputs=False)
    return inspection, warnings, rejected


def inspect(input_path: Path = INPUT_FILE) -> List[Dict[str, object]]:
    rows = read_csv(input_path)
    summary, warnings, rejected = inspect_rows(rows)
    write_csv(INSPECTION_SUMMARY_FILE, summary, [
        "stationId", "stationName", "district", "stationType", "rawRows", "normalizedObservationRows", "dateFrom", "dateTo",
        "missingValues", "rejectedValues", "duplicateConflicts", "invalidDateRows", "unknownStationRows",
    ])
    write_csv(VALIDATION_WARNINGS_FILE, warnings, WARNING_FIELDS)
    write_csv(REJECTED_VALUES_FILE, rejected, REJECTED_FIELDS)
    return summary


def prepare(input_path: Path = INPUT_FILE) -> int:
    rows = read_csv(input_path)
    normalized, summary, warnings, rejected, missing_values, duplicate_conflicts, unknown_stations, iqr_outliers, imputed_support, imputation_summary, inspection = normalize_rows(rows)
    if not normalized:
        raise ValueError("No LMS observations were normalized. Check station mapping and CSV headers.")
    write_csv(NORMALIZED_FILE, normalized, NORMALIZED_FIELDS)
    write_csv(VALIDATION_SUMMARY_FILE, summary, ["metric", "value"])
    write_csv(VALIDATION_WARNINGS_FILE, warnings, WARNING_FIELDS)
    write_csv(REJECTED_VALUES_FILE, rejected, REJECTED_FIELDS)
    write_csv(MISSING_VALUES_FILE, missing_values, MISSING_FIELDS)
    write_csv(DUPLICATE_CONFLICTS_FILE, duplicate_conflicts, DUPLICATE_CONFLICT_FIELDS)
    write_csv(UNKNOWN_STATIONS_FILE, unknown_stations, UNKNOWN_STATION_FIELDS)
    write_csv(IQR_OUTLIERS_FILE, iqr_outliers, IQR_OUTLIER_FIELDS)
    write_csv(IMPUTED_SUPPORT_FILE, imputed_support, IMPUTED_FIELDS)
    write_csv(IMPUTATION_SUMMARY_FILE, imputation_summary, IMPUTATION_SUMMARY_FIELDS)
    write_csv(INSPECTION_SUMMARY_FILE, inspection, [
        "stationId", "stationName", "district", "stationType", "rawRows", "normalizedObservationRows", "dateFrom", "dateTo",
        "missingValues", "rejectedValues", "duplicateConflicts", "invalidDateRows", "unknownStationRows",
    ])
    return len(normalized)


def group_series(rows: Sequence[Dict[str, object]]) -> Dict[Tuple[str, str], List[Dict[str, object]]]:
    grouped: Dict[Tuple[str, str], List[Dict[str, object]]] = defaultdict(list)
    for row in rows:
        grouped[(str(row["stationId"]), str(row["elementCode"]))].append(row)
    for key in grouped:
        grouped[key].sort(key=lambda row: str(row["observationDatetime"]))
    return grouped


def split_train_test(rows: Sequence[Dict[str, object]]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]], List[Dict[str, object]]]:
    train: List[Dict[str, object]] = []
    test: List[Dict[str, object]] = []
    summary: List[Dict[str, object]] = []
    for (station_id, element_code), series in sorted(group_series(rows).items()):
        split_index = int(len(series) * 0.8)
        if len(series) > 1:
            split_index = max(1, min(split_index, len(series) - 1))
        train_rows = series[:split_index]
        test_rows = series[split_index:]
        train.extend(train_rows)
        test.extend(test_rows)
        summary.append({
            "stationId": station_id,
            "elementCode": element_code,
            "totalRows": len(series),
            "trainRows": len(train_rows),
            "testRows": len(test_rows),
            "trainFrom": train_rows[0]["observationDatetime"] if train_rows else "",
            "trainTo": train_rows[-1]["observationDatetime"] if train_rows else "",
            "testFrom": test_rows[0]["observationDatetime"] if test_rows else "",
            "testTo": test_rows[-1]["observationDatetime"] if test_rows else "",
        })
    return train, test, summary


def calculate_feature_rows(rows: Sequence[Dict[str, object]], baseline_rows: Sequence[Dict[str, object]] | None = None) -> List[Dict[str, object]]:
    baseline_rows = baseline_rows or rows
    baseline_by_group_month: Dict[Tuple[str, str, int], List[float]] = defaultdict(list)
    baseline_by_group: Dict[Tuple[str, str], List[float]] = defaultdict(list)
    for row in baseline_rows:
        dt = parse_normalized_datetime(row["observationDatetime"])
        value = float(row["value"])
        key = (str(row["stationId"]), str(row["elementCode"]))
        baseline_by_group[key].append(value)
        baseline_by_group_month[(key[0], key[1], dt.month)].append(value)
    baseline_group_stats = {
        key: (mean(values), pstdev(values) if len(values) > 1 else 0.0)
        for key, values in baseline_by_group.items()
    }
    baseline_month_stats = {
        key: (mean(values), pstdev(values) if len(values) > 1 else 0.0)
        for key, values in baseline_by_group_month.items()
    }

    station_codes = {station: i for i, station in enumerate(sorted({str(row["stationId"]) for row in rows}))}
    element_codes = {element: i for i, element in enumerate(sorted({str(row["elementCode"]) for row in rows}))}
    output: List[Dict[str, object]] = []

    for key, series in group_series(rows).items():
        previous_value: float | None = None
        roll7: deque[float] = deque()
        roll30: deque[float] = deque()
        roll7_sum = roll7_sum_sq = 0.0
        roll30_sum = roll30_sum_sq = 0.0
        group_mean, group_std = baseline_group_stats.get(key, (0.0, 0.0))
        for row in series:
            dt = parse_normalized_datetime(row["observationDatetime"])
            value = float(row["value"])
            monthly_mean, monthly_std = baseline_month_stats.get((key[0], key[1], dt.month), (value, 0.0))
            previous = previous_value if previous_value is not None else value

            roll7.append(value)
            roll7_sum += value
            roll7_sum_sq += value * value
            if len(roll7) > 7:
                removed = roll7.popleft()
                roll7_sum -= removed
                roll7_sum_sq -= removed * removed

            roll30.append(value)
            roll30_sum += value
            roll30_sum_sq += value * value
            if len(roll30) > 30:
                removed = roll30.popleft()
                roll30_sum -= removed
                roll30_sum_sq -= removed * removed

            rolling_mean_7, rolling_std_7 = rolling_stats(roll7_sum, roll7_sum_sq, len(roll7))
            rolling_mean_30, rolling_std_30 = rolling_stats(roll30_sum, roll30_sum_sq, len(roll30))
            output.append({
                **row,
                "stationIdEncoding": station_codes[key[0]],
                "elementCodeEncoding": element_codes[key[1]],
                "year": dt.year,
                "month": dt.month,
                "day": dt.day,
                "dayOfYear": dt.timetuple().tm_yday,
                "monthlyMean": f"{monthly_mean:.6f}",
                "monthlyStandardDeviation": f"{monthly_std:.6f}",
                "z_score": f"{((value - group_mean) / group_std) if group_std else 0.0:.6f}",
                "seasonal_z_score": f"{((value - monthly_mean) / monthly_std) if monthly_std else 0.0:.6f}",
                "rolling_mean_7": f"{rolling_mean_7:.6f}",
                "rolling_std_7": f"{rolling_std_7:.6f}",
                "rolling_mean_30": f"{rolling_mean_30:.6f}",
                "rolling_std_30": f"{rolling_std_30:.6f}",
                "previous_value": f"{previous:.6f}",
                "value_difference": f"{value - previous:.6f}",
                "missing_indicator": "false",
            })
            previous_value = value
    return output


def rolling_stats(total: float, total_sq: float, count: int) -> Tuple[float, float]:
    if count <= 0:
        return 0.0, 0.0
    avg = total / count
    if count == 1:
        return avg, 0.0
    variance = max((total_sq / count) - (avg * avg), 0.0)
    return avg, sqrt(variance)


FEATURE_FIELDS = NORMALIZED_FIELDS + [
    "stationIdEncoding", "elementCodeEncoding", "year", "month", "day", "dayOfYear",
    "monthlyMean", "monthlyStandardDeviation", "z_score", "seasonal_z_score",
    "rolling_mean_7", "rolling_std_7", "rolling_mean_30", "rolling_std_30",
    "previous_value", "value_difference", "missing_indicator",
]
