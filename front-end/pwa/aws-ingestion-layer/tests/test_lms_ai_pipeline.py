from __future__ import annotations

import csv
from pathlib import Path

import pytest

from lms_ai_pipeline.core import calculate_feature_rows, inspect_rows, normalize_rows, split_train_test
from lms_ai_pipeline.io import read_csv
from lms_ai_pipeline.models import random_forest_status_rows, zscore_predictions
from lms_ai_pipeline import inspect as inspect_module
from lms_ai_pipeline import pipeline


def test_lms_inspection_detects_station_counts_and_warnings():
    rows = [
        {"id": "LESBUT01", "year": "2020", "month": "1", "day": "1", "rain": "0", "tmax": "22", "tmin": "10"},
        {"id": "LESBUT01", "year": "2020", "month": "1", "day": "2", "rain": "1", "tmax": "20", "tmin": "21"},
        {"id": "LESLER01", "year": "2020", "month": "1", "day": "1", "rain": "2", "tmax": "24", "tmin": "11"},
    ]

    summary, warnings, rejected = inspect_rows(rows)

    assert {row["stationId"]: row["rawRows"] for row in summary if row["rawRows"]} == {"LESBUT01": 2, "LESLER01": 1}
    assert any(row["warningType"] == "TMIN_GREATER_THAN_TMAX" for row in warnings)
    assert rejected == []


def test_lms_normalize_creates_long_rows():
    rows = [{"id": "LESBUT01", "year": "2020", "month": "1", "day": "1", "rain": "0", "tmax": "22", "tmin": "10"}]

    normalized, summary, warnings, rejected, missing, duplicate_conflicts, unknown_stations, iqr_outliers, imputed_support, imputation_summary, inspection = normalize_rows(rows)

    assert len(normalized) == 3
    assert {row["elementCode"] for row in normalized} == {"rain", "tmax", "tmin"}
    assert normalized[0]["stationName"] == "BUTHA-BUTHE"
    assert normalized[0]["district"] == "BUTHA-BUTHE"
    assert normalized[0]["stationType"] == "CLIMATE"
    assert normalized[0]["source"] == "LMS Historical Daily CSV"
    assert normalized[0]["observationDatetime"] == "2020-01-01"
    assert normalized[0]["isImputed"] == "false"
    assert summary[0]["value"] == 3
    assert warnings == []
    assert rejected == []
    assert missing == []
    assert duplicate_conflicts == []
    assert unknown_stations == []


def test_lms_normalize_keeps_valid_elements_when_one_value_is_missing():
    rows = [{"id": "LESBUT01", "year": "2020", "month": "1", "day": "1", "rain": "12", "tmax": "", "tmin": "8"}]

    normalized, _, _, rejected, missing, *_ = normalize_rows(rows)

    assert {row["elementCode"] for row in normalized} == {"rain", "tmin"}
    assert rejected == []
    assert missing == [ {
        "rowNumber": 2,
        "stationId": "LESBUT01",
        "stationName": "BUTHA-BUTHE",
        "district": "BUTHA-BUTHE",
        "stationType": "CLIMATE",
        "observationDatetime": "2020-01-01",
        "elementCode": "tmax",
        "missingReason": "Missing tmax value",
    } ]


def test_lms_normalize_reports_unknown_station_and_duplicate_conflict():
    rows = [
        {"id": "BAD01", "year": "2020", "month": "1", "day": "1", "rain": "1", "tmax": "20", "tmin": "10"},
        {"id": "LESBUT01", "year": "2020", "month": "1", "day": "1", "rain": "2", "tmax": "20", "tmin": "10"},
        {"id": "LESBUT01", "year": "2020", "month": "1", "day": "1", "rain": "3", "tmax": "20", "tmin": "10"},
    ]

    normalized, _, warnings, rejected, missing, duplicate_conflicts, unknown_stations, *_ = normalize_rows(rows)

    assert len(unknown_stations) == 1
    assert unknown_stations[0]["rawStationId"] == "BAD01"
    assert len([row for row in normalized if row["elementCode"] == "rain"]) == 1
    assert len(duplicate_conflicts) == 1
    assert duplicate_conflicts[0]["elementCode"] == "rain"
    assert any(row["warningType"] == "DUPLICATE_CONFLICT" for row in warnings)
    assert rejected == []
    assert missing == []


def test_lms_official_station_names_are_used_for_required_mapping():
    rows = [
        {"id": "LESBUT01", "year": "2020", "month": "1", "day": "1", "rain": "1", "tmax": "20", "tmin": "10"},
        {"id": "LESLER01", "year": "2020", "month": "1", "day": "1", "rain": "1", "tmax": "20", "tmin": "10"},
        {"id": "LESMAS27", "year": "2020", "month": "1", "day": "1", "rain": "1", "tmax": "20", "tmin": "10"},
    ]

    normalized, _, warnings, _, missing, _, _, _, _, _, inspection = normalize_rows(rows)
    by_station = {row["stationId"]: row for row in normalized if row["elementCode"] == "rain"}
    inspection_by_station = {row["stationId"]: row for row in inspection}

    assert by_station["LESBUT01"]["stationName"] == "BUTHA-BUTHE"
    assert by_station["LESLER01"]["stationName"] == "LERIBE"
    assert by_station["LESMAS27"]["stationName"] == "MOSHOESHOE-I"
    assert by_station["LESMAS27"]["district"] == "MASERU"
    assert by_station["LESMAS27"]["stationType"] == "SYNOPTIC"
    assert inspection_by_station["LESLER01"]["stationName"] == "LERIBE"
    assert inspection_by_station["LESLER01"]["district"] == "LERIBE"
    assert warnings == []
    assert missing == []


def test_lms_iqr_outlier_is_flagged_not_deleted():
    rows = []
    for day, value in enumerate([1, 1, 1, 1, 1, 30], start=1):
        rows.append({"id": "LESBUT01", "year": "2020", "month": "1", "day": str(day), "rain": str(value), "tmax": "20", "tmin": "10"})

    normalized, _, warnings, _, _, _, _, iqr_outliers, *_ = normalize_rows(rows)

    assert len([row for row in normalized if row["elementCode"] == "rain"]) == 6
    assert len(iqr_outliers) == 1
    assert iqr_outliers[0]["flag"] == "IQR_OUTLIER"
    assert any(row["warningType"] == "IQR_OUTLIER" for row in warnings)


def test_lms_split_is_time_based_per_station_element():
    normalized = []
    for day in range(1, 11):
        normalized.append({
            "stationId": "LESBUT01",
            "stationName": "BUTHA-BUTHE",
            "district": "BUTHA-BUTHE",
            "stationType": "CLIMATE",
            "observationDatetime": f"2020-01-{day:02d} 00:00:00",
            "elementCode": "rain",
            "elementName": "Rainfall",
            "value": str(day),
            "unit": "mm",
            "source": "LMS Historical Daily CSV",
            "dataType": "historical",
            "originalRowNumber": day + 1,
        })

    train, test, summary = split_train_test(normalized)

    assert len(train) == 8
    assert len(test) == 2
    assert train[-1]["observationDatetime"] == "2020-01-08 00:00:00"
    assert test[0]["observationDatetime"] == "2020-01-09 00:00:00"
    assert summary[0]["trainRows"] == 8


def test_lms_zscore_and_random_forest_label_status():
    normalized = []
    for day, value in enumerate([1, 1, 1, 1, 20], start=1):
        normalized.append({
            "stationId": "LESBUT01",
            "stationName": "BUTHA-BUTHE",
            "district": "BUTHA-BUTHE",
            "stationType": "CLIMATE",
            "observationDatetime": f"2020-01-{day:02d} 00:00:00",
            "elementCode": "rain",
            "elementName": "Rainfall",
            "value": str(value),
            "unit": "mm",
            "source": "LMS Historical Daily CSV",
            "dataType": "historical",
            "originalRowNumber": day + 1,
        })
    features = calculate_feature_rows(normalized, normalized)
    predictions = zscore_predictions(features)

    assert len(predictions) == 5
    assert random_forest_status_rows()[0]["status"] == "not_trained"


def test_lms_read_csv_handles_utf8_bom_header(tmp_path: Path):
    path = tmp_path / "NULClimsofttext.csv"
    path.write_text("\ufeffid,year,month,day,rain,tmax,tmin\nLESBUT01,2020,1,1,1,20,10\n", encoding="utf-8")

    rows = read_csv(path)

    assert rows[0]["id"] == "LESBUT01"
    assert set(["id", "year", "month", "day", "rain", "tmax", "tmin"]).issubset(rows[0])


def test_lms_read_csv_normalizes_whitespace_headers(tmp_path: Path):
    path = tmp_path / "NULClimsofttext.csv"
    path.write_text(" id , year , month , day , rain , tmax , tmin \nLESLER01,2020,1,1,1,20,10\n", encoding="utf-8")

    rows = read_csv(path)

    assert rows[0]["id"] == "LESLER01"
    assert rows[0]["tmax"] == "20"


def test_lms_read_csv_preserves_generated_pipeline_headers(tmp_path: Path):
    path = tmp_path / "lms_all_station_training_input_normalized.csv"
    path.write_text(" stationId , elementCode \nLESBUT01,rain\n", encoding="utf-8")

    rows = read_csv(path)

    assert rows[0]["stationId"] == "LESBUT01"
    assert rows[0]["elementCode"] == "rain"


def test_lms_read_csv_missing_required_columns_raises_clear_error(tmp_path: Path):
    path = tmp_path / "NULClimsofttext.csv"
    path.write_text("id,year,month,day,rain,tmax\nLESBUT01,2020,1,1,1,20\n", encoding="utf-8")

    with pytest.raises(ValueError, match="missing required columns"):
        read_csv(path)


def test_lms_inspect_prints_raw_rows_not_row_count(monkeypatch, capsys):
    monkeypatch.setattr(inspect_module, "inspect", lambda: [{
        "stationId": "LESBUT01",
        "rawRows": 2,
        "normalizedObservationRows": 6,
        "dateFrom": "2020-01-01",
        "dateTo": "2020-01-02",
    }])

    inspect_module.main()

    captured = capsys.readouterr()
    assert "2 raw rows" in captured.out
    assert "6 normalized observations" in captured.out


def test_lms_prepare_does_not_silently_succeed_with_zero_normalized_observations(tmp_path: Path):
    path = tmp_path / "NULClimsofttext.csv"
    path.write_text("id,year,month,day,rain,tmax,tmin\nBAD01,2020,1,1,1,20,10\n", encoding="utf-8")

    from lms_ai_pipeline.core import prepare

    with pytest.raises(ValueError, match="No LMS observations were normalized"):
        prepare(path)


def test_lms_predict_fails_clearly_on_empty_test_data(tmp_path: Path, monkeypatch):
    test_file = tmp_path / "lms_test_split.csv"
    test_file.write_text(",".join(pipeline.FEATURE_FIELDS) + "\n", encoding="utf-8")
    monkeypatch.setattr(pipeline, "TEST_SPLIT_FILE", test_file)

    with pytest.raises(ValueError, match="No LMS test rows"):
        pipeline.predict_anomalies()
