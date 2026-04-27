from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import pytest

from lms_ai_pipeline.core import calculate_feature_rows, inspect_rows, normalize_rows, split_train_test
from lms_ai_pipeline.io import csv_row_count, file_metadata, read_csv
from lms_ai_pipeline.ensemble import ensemble_predictions
from lms_ai_pipeline.models import (
    AutoencoderConfig,
    AUTOENCODER_STATUS_FIELDS,
    PREDICTION_FIELDS,
    autoencoder_thresholds,
    autoencoder_predictions,
    build_prediction,
    detect_tensorflow_keras,
    random_forest_status_rows,
    threshold_pair,
    train_error_diagnostics,
    zscore_predictions,
)
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


def feature_row(day: int, value: float = 1.0) -> dict[str, object]:
    return {
        "stationId": "LESBUT01",
        "stationName": "BUTHA-BUTHE",
        "district": "BUTHA-BUTHE",
        "stationType": "CLIMATE",
        "observationDatetime": f"2020-01-{day:02d}",
        "elementCode": "rain",
        "elementName": "Rainfall",
        "value": f"{value:.6f}",
        "unit": "mm",
        "source": "LMS Historical Daily CSV",
        "dataType": "historical",
        "originalRowNumber": day + 1,
        "isImputed": "false",
        "imputationMethod": "",
        "qualityFlags": "",
        "stationIdEncoding": 0,
        "elementCodeEncoding": 0,
        "year": 2020,
        "month": 1,
        "day": day,
        "dayOfYear": day,
        "monthlyMean": "1.000000",
        "monthlyStandardDeviation": "0.100000",
        "z_score": "0.000000",
        "seasonal_z_score": "0.000000",
        "rolling_mean_7": "1.000000",
        "rolling_std_7": "0.000000",
        "rolling_mean_30": "1.000000",
        "rolling_std_30": "0.000000",
        "previous_value": "1.000000",
        "value_difference": "0.000000",
        "missing_indicator": "false",
    }


def test_lms_tensorflow_keras_detection_has_expected_keys():
    info = detect_tensorflow_keras()

    assert {"tensorflowInstalled", "kerasInstalled", "tensorflowVersion", "kerasVersion", "cpuDevices", "gpuDevices"}.issubset(info)
    assert isinstance(info["cpuDevices"], list)
    assert isinstance(info["gpuDevices"], list)


def test_lms_autoencoder_unavailable_path(monkeypatch):
    monkeypatch.setattr("lms_ai_pipeline.models.detect_tensorflow_keras", lambda: {
        "tensorflowInstalled": False,
        "kerasInstalled": False,
        "tensorflowVersion": "",
        "kerasVersion": "",
        "cpuDevices": [],
        "gpuDevices": [],
    })

    predictions, history, status = autoencoder_predictions([feature_row(1)], [feature_row(2)], AutoencoderConfig(epochs=3))

    assert predictions == []
    assert history == []
    assert status[0]["status"] == "unavailable"
    assert status[0]["epochs"] == 3
    for field in [
        "globalTrainErrorMean",
        "globalTrainErrorStd",
        "globalTrainErrorP90",
        "globalTrainErrorP95",
        "globalTrainErrorP97",
        "globalTrainErrorP99",
        "globalTrainErrorP995",
        "globalTrainErrorP999",
        "globalSuspectThreshold",
        "globalFailedThreshold",
        "calibrationMode",
    ]:
        assert field in status[0]
        assert field in AUTOENCODER_STATUS_FIELDS


def test_lms_epoch_config_parsing(monkeypatch):
    from lms_ai_pipeline import run_all as run_all_module

    monkeypatch.setattr(sys, "argv", [
        "run_all",
        "--epochs", "10",
        "--batch-size", "128",
        "--validation-split", "0.1",
        "--patience", "2",
        "--contamination", "0.07",
        "--max-training-rows", "100",
        "--autoencoder-calibration", "element_quantile",
        "--autoencoder-suspect-quantile", "0.98",
        "--autoencoder-failed-quantile", "0.997",
        "--autoencoder-min-group-rows", "25",
    ])
    args = run_all_module.parse_args()

    assert args.epochs == 10
    assert args.batch_size == 128
    assert args.validation_split == 0.1
    assert args.patience == 2
    assert args.contamination == 0.07
    assert args.max_training_rows == 100
    assert args.autoencoder_calibration == "element_quantile"
    assert args.autoencoder_suspect_quantile == 0.98
    assert args.autoencoder_failed_quantile == 0.997
    assert args.autoencoder_min_group_rows == 25


def test_lms_autoencoder_prediction_schema():
    row = build_prediction(feature_row(1), "Autoencoder", 0.123, "SUSPECT", "MEDIUM", "0.75", "Autoencoder reconstruction error is high.")

    assert list(row.keys()) == PREDICTION_FIELDS
    assert row["modelName"] == "Autoencoder"
    assert row["anomalyScore"] == "0.123000"


def test_lms_autoencoder_station_element_calibration_uses_group_threshold():
    train_rows = [{**feature_row((index % 28) + 1), "stationId": "LESBUT01", "elementCode": "rain"} for index in range(6)]
    train_rows += [{**feature_row((index % 28) + 1), "stationId": "OTHER", "elementCode": "rain"} for index in range(6)]
    train_errors = [1, 1, 1, 1, 1, 10, 50, 50, 50, 50, 50, 100]
    config = AutoencoderConfig(min_group_rows=5, min_element_rows=100, suspect_quantile=0.8, failed_quantile=0.9, contamination=0.01)

    suspect, failed, mode = autoencoder_thresholds(train_rows, train_errors, {"stationId": "LESBUT01", "elementCode": "rain"}, config)

    assert mode == "station_element_quantile"
    assert suspect < 50
    assert failed > suspect


def test_lms_autoencoder_element_calibration_fallback_when_station_element_small():
    train_rows = [{**feature_row((index % 28) + 1), "stationId": f"STATION{index}", "elementCode": "rain"} for index in range(6)]
    train_rows += [{**feature_row((index % 28) + 1), "stationId": "OTHER", "elementCode": "tmax"} for index in range(6)]
    train_errors = [1, 1, 1, 1, 1, 10, 80, 80, 80, 80, 80, 120]
    config = AutoencoderConfig(min_group_rows=5, min_element_rows=5, suspect_quantile=0.8, failed_quantile=0.9, contamination=0.01)

    suspect, failed, mode = autoencoder_thresholds(train_rows, train_errors, {"stationId": "LESBUT01", "elementCode": "rain"}, config)

    assert mode == "element_quantile"
    assert suspect < 80
    assert failed > suspect


def test_lms_autoencoder_global_calibration_fallback_when_element_small():
    train_rows = [{**feature_row((index % 28) + 1), "stationId": f"STATION{index}", "elementCode": "rain"} for index in range(4)]
    train_rows += [{**feature_row((index % 28) + 1), "stationId": "OTHER", "elementCode": "tmax"} for index in range(6)]
    train_errors = [1, 1, 1, 10, 90, 90, 90, 90, 90, 120]
    config = AutoencoderConfig(min_group_rows=5, min_element_rows=5, suspect_quantile=0.8, failed_quantile=0.9, contamination=0.01)

    suspect, failed, mode = autoencoder_thresholds(train_rows, train_errors, {"stationId": "LESBUT01", "elementCode": "rain"}, config)

    assert mode == "global_quantile"
    assert suspect > 10
    assert failed > suspect


def test_lms_autoencoder_failed_threshold_is_stricter_than_suspect():
    suspect, failed = threshold_pair([0.1, 0.2, 0.3, 0.4], 0.5, 0.5)
    diagnostics = train_error_diagnostics([0.1, 0.2, 0.3, 0.4], suspect, failed, "global_quantile")

    assert failed > suspect
    assert float(diagnostics["globalFailedThreshold"]) > float(diagnostics["globalSuspectThreshold"])


def test_lms_report_summary_generation(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import reporting

    files = {
        "NORMALIZED_FILE": tmp_path / "normalized.csv",
        "TRAIN_SPLIT_FILE": tmp_path / "train.csv",
        "TEST_SPLIT_FILE": tmp_path / "test.csv",
        "MODEL_METADATA_FILE": tmp_path / "metadata.csv",
        "RANDOM_FOREST_STATUS_FILE": tmp_path / "rf.csv",
        "AUTOENCODER_STATUS_FILE": tmp_path / "ae_status.csv",
        "AUTOENCODER_HISTORY_FILE": tmp_path / "ae_history.csv",
        "ENSEMBLE_PREDICTIONS_FILE": tmp_path / "ensemble.csv",
        "MODEL_EVALUATION_SUMMARY_CSV": tmp_path / "summary.csv",
        "MODEL_EVALUATION_SUMMARY_MD": tmp_path / "summary.md",
        "MODEL_EVALUATION_SUMMARY_JSON": tmp_path / "summary.json",
    }
    for name, path in files.items():
        monkeypatch.setattr(reporting, name, path)
    (tmp_path / "normalized.csv").write_text("stationId\nLESBUT01\n", encoding="utf-8")
    (tmp_path / "train.csv").write_text("stationId\nLESBUT01\n", encoding="utf-8")
    (tmp_path / "test.csv").write_text("stationId\nLESBUT01\n", encoding="utf-8")
    (tmp_path / "metadata.csv").write_text("modelName,status,message\nAutoencoder,trained,ok\n", encoding="utf-8")
    (tmp_path / "rf.csv").write_text("modelName,status,reason,requiredInput\nRandom Forest,not_trained,no labels,labels\n", encoding="utf-8")
    (tmp_path / "ae_status.csv").write_text(
        "modelName,status,epochs,batchSize,validationSplit,patience,contamination,calibrationMode,globalSuspectThreshold,globalFailedThreshold\n"
        "Autoencoder,trained,10,128,0.2,5,0.05,station_element_quantile,1.0,2.0\n",
        encoding="utf-8",
    )
    (tmp_path / "ae_history.csv").write_text("epoch,loss,validationLoss\n1,0.2,0.3\n2,0.1,0.2\n", encoding="utf-8")
    for name in ["lms_zscore_predictions.csv", "lms_isolation_forest_predictions.csv", "lms_one_class_svm_predictions.csv", "lms_autoencoder_predictions.csv"]:
        (tmp_path / name).write_text("stationId,elementCode,outcome,anomalyScore\nLESBUT01,rain,NORMAL,0.1\nLESLER01,rain,SUSPECT,2.0\n", encoding="utf-8")
    (tmp_path / "lms_autoencoder_predictions.csv").write_text("stationId,elementCode,outcome,anomalyScore\nLESBUT01,rain,FAILED,5.0\nLESBUT01,tmax,NORMAL,0.2\n", encoding="utf-8")
    (tmp_path / "ensemble.csv").write_text(
        "stationId,observationDatetime,elementCode,value,finalDecision,outcome,severity,modelAgreementCount,anomalyScore\n"
        "LESBUT01,2020-01-01,rain,1,FAILED,FAILED,HIGH,2,5\n"
        "LESBUT01,2020-01-02,tmax,20,NORMAL,NORMAL,LOW,0,0.1\n"
        "LESLER01,2020-01-01,rain,3,SUSPECT,SUSPECT,MEDIUM,1,2\n",
        encoding="utf-8",
    )

    payload = reporting.generate_model_evaluation_report()

    assert payload["totalNormalizedRows"] == 1
    assert files["MODEL_EVALUATION_SUMMARY_CSV"].exists()
    assert files["MODEL_EVALUATION_SUMMARY_MD"].exists()
    assert files["MODEL_EVALUATION_SUMMARY_JSON"].exists()
    assert payload["autoencoderCalibrationMode"] == "station_element_quantile"
    assert payload["autoencoderSuspectThreshold"] == "1.0"
    assert payload["autoencoderFailedThreshold"] == "2.0"
    assert payload["anomalyRatePerModel"]["Autoencoder"] == 0.5
    assert payload["modelMetrics"]["Autoencoder"]["totalRows"] == 2
    assert payload["modelMetrics"]["Autoencoder"]["anomalyCount"] == 1
    assert payload["modelMetrics"]["Autoencoder"]["anomalyRate"] == 0.5
    assert payload["modelMetrics"]["Autoencoder"]["averageAnomalyScore"] == 2.6
    assert payload["modelMetrics"]["Autoencoder"]["maxAnomalyScore"] == 5.0
    station_rates = {row["stationId"]: row for row in payload["stationAnomalyRates"]}
    assert station_rates["LESBUT01"]["anomalyCount"] == 1
    assert station_rates["LESBUT01"]["anomalyRate"] == 0.5
    assert station_rates["LESLER01"]["anomalyRate"] == 1.0
    element_rates = {row["elementCode"]: row for row in payload["elementAnomalyRates"]}
    assert element_rates["rain"]["anomalyCount"] == 2
    assert element_rates["rain"]["anomalyRate"] == 1.0
    assert element_rates["tmax"]["anomalyRate"] == 0.0
    assert payload["topStationElementPairs"]
    assert {"stationId", "elementCode", "anomalyRate", "anomalyCount"}.issubset(payload["topStationElementPairs"][0])
    assert any("threshold calibration requires review" in warning for warning in payload["calibrationWarnings"])
    markdown = files["MODEL_EVALUATION_SUMMARY_MD"].read_text(encoding="utf-8")
    assert "## Calibration Warnings" in markdown
    assert "## Per-Model Metrics" in markdown
    assert "## Station And Element Summaries" in markdown


def test_lms_qc_handoff_includes_review_metadata(tmp_path: Path, monkeypatch):
    handoff = tmp_path / "handoff.csv"
    warnings = tmp_path / "warnings.csv"
    warnings.write_text("warningType,stationId,message\n", encoding="utf-8")
    monkeypatch.setattr(pipeline, "QC_HANDOFF_FILE", handoff)
    monkeypatch.setattr(pipeline, "VALIDATION_WARNINGS_FILE", warnings)
    row = {
        "stationId": "LESBUT01",
        "stationName": "BUTHA-BUTHE",
        "district": "BUTHA-BUTHE",
        "stationType": "CLIMATE",
        "observationDatetime": "2020-01-01",
        "elementCode": "rain",
        "elementName": "Rainfall",
        "value": "10",
        "unit": "mm",
        "contributingModels": "Z-score;Autoencoder",
        "modelAgreementCount": 2,
        "modelAgreementRatio": "0.500000",
        "agreeingModels": "Z-score;Autoencoder",
        "anomalyScore": "5.0",
        "confidence": "0.85",
        "severity": "HIGH",
        "finalDecision": "FAILED",
        "outcome": "FAILED",
        "explanation": "Model Ensemble outcome=FAILED",
        "recommendedReviewerAction": "Review LMS source record.",
    }

    pipeline.write_qc_handoff([row])

    with handoff.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert rows[0]["reviewSource"] == "ai_ensemble"
    assert rows[0]["aiTriggered"] == "true"
    assert rows[0]["ensembleTriggered"] == "true"
    assert rows[0]["ruleQcTriggered"] == "false"
    assert rows[0]["previousReviewTriggered"] == "false"
    assert "AI ensemble selected this row for review" in rows[0]["reviewReason"]
    assert rows[0]["sourceSystem"] == "LMS"
    assert rows[0]["pipelineRunId"] == "manual-run"


def test_lms_explainability_text_includes_model_outcome_score_and_action():
    row = feature_row(1, value=42.0)
    row["z_score"] = "3.500000"
    row["seasonal_z_score"] = "3.200000"

    prediction = zscore_predictions([row])[0]

    assert "Model Z-score" in prediction["explanation"]
    assert "outcome=FAILED" in prediction["explanation"]
    assert "anomaly score=3.500000" in prediction["explanation"]
    assert "Recommended reviewer action:" in prediction["explanation"]


def test_lms_csv_row_count_helper_counts_data_rows(tmp_path: Path):
    path = tmp_path / "rows.csv"
    path.write_text("a,b\n1,2\n3,4\n", encoding="utf-8")

    assert csv_row_count(path) == 2


def test_lms_output_file_metadata_handles_missing_files(tmp_path: Path):
    metadata = file_metadata(tmp_path / "missing.csv")

    assert metadata["exists"] is False
    assert metadata["sizeBytes"] == 0
    assert metadata["rowCount"] is None


def test_lms_manifest_and_supervisor_summary_generation(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import operations

    input_file = tmp_path / "NULClimsofttext.csv"
    normalized = tmp_path / "normalized.csv"
    rejected = tmp_path / "rejected.csv"
    warnings = tmp_path / "warnings.csv"
    qc = tmp_path / "handoff.csv"
    ae_status = tmp_path / "ae_status.csv"
    manifest_file = tmp_path / "manifest.json"
    supervisor_file = tmp_path / "supervisor.md"
    input_file.write_text("id,year,month,day,rain,tmax,tmin\nLESBUT01,2020,1,1,1,20,10\n", encoding="utf-8")
    normalized.write_text("stationId\nLESBUT01\n", encoding="utf-8")
    rejected.write_text("stationId\n", encoding="utf-8")
    warnings.write_text("warningType\nIQR_OUTLIER\n", encoding="utf-8")
    qc.write_text("stationId,outcome\nLESBUT01,SUSPECT\n", encoding="utf-8")
    ae_status.write_text("modelName,status,calibrationMode\nAutoencoder,trained,station_element_quantile\n", encoding="utf-8")

    monkeypatch.setattr(operations, "INPUT_FILE", input_file)
    monkeypatch.setattr(operations, "NORMALIZED_FILE", normalized)
    monkeypatch.setattr(operations, "REJECTED_VALUES_FILE", rejected)
    monkeypatch.setattr(operations, "VALIDATION_WARNINGS_FILE", warnings)
    monkeypatch.setattr(operations, "QC_HANDOFF_FILE", qc)
    monkeypatch.setattr(operations, "AUTOENCODER_STATUS_FILE", ae_status)
    monkeypatch.setattr(operations, "PIPELINE_RUN_MANIFEST_FILE", manifest_file)
    monkeypatch.setattr(operations, "SUPERVISOR_SUMMARY_FILE", supervisor_file)
    monkeypatch.setattr(operations, "input_file_paths", lambda: [input_file])
    monkeypatch.setattr(operations, "output_file_paths", lambda: [normalized, rejected, warnings, qc, ae_status, supervisor_file, manifest_file])
    monkeypatch.setattr(operations, "safe_git_value", lambda args: "test-git")
    run_context = {"runId": "run-1", "runStartedAt": "2026-04-27T00:00:00Z", "processedAt": "2026-04-27T00:00:00Z", "startedMonotonic": 1.0}
    monkeypatch.setattr(operations.time, "monotonic", lambda: 3.5)
    config = AutoencoderConfig(epochs=3, batch_size=16, contamination=0.02, calibration="station_element_quantile")

    manifest = operations.write_manifest(run_context, config, total_prediction_rows=12)
    payload = {
        "modelMetrics": {"Ensemble": {"totalRows": 4, "normalCount": 2, "suspectCount": 1, "failedCount": 1, "anomalyCount": 2, "anomalyRate": 0.5}},
        "autoencoderStatus": [{"globalSuspectThreshold": "1.0", "globalFailedThreshold": "2.0", "calibrationMode": "station_element_quantile"}],
        "stationAnomalyRates": [{"stationId": "LESBUT01", "anomalyCount": 2, "anomalyRate": 0.5}],
        "elementAnomalyRates": [{"elementCode": "rain", "anomalyCount": 2, "anomalyRate": 0.5}],
        "topStationElementPairs": [{"stationId": "LESBUT01", "elementCode": "rain", "anomalyCount": 2, "anomalyRate": 0.5}],
        "calibrationWarnings": [],
    }
    markdown = operations.write_supervisor_summary(payload, manifest)

    loaded = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert manifest_file.exists()
    assert loaded["runId"] == "run-1"
    assert loaded["runStartedAt"] == "2026-04-27T00:00:00Z"
    assert loaded["runFinishedAt"]
    assert loaded["runtimeSeconds"] == 2.5
    assert loaded["inputFiles"][0]["rowCount"] == 1
    assert loaded["outputFiles"]
    assert loaded["totalPredictionRows"] == 12
    assert loaded["qcReviewRows"] == 1
    assert supervisor_file.exists()
    assert "## Pipeline Run Overview" in markdown
    assert "## AI Model Summary" in markdown
    assert "## QC Review Handoff Summary" in markdown
    assert "## Next Recommended Actions" in markdown


def test_lms_visualisation_output_paths(monkeypatch, tmp_path: Path):
    from lms_ai_pipeline import visualisations

    saved: list[Path] = []
    monkeypatch.setattr(visualisations, "VISUALISATIONS_DIR", tmp_path)
    monkeypatch.setattr(visualisations, "safe_read_csv", lambda path: [] if path == visualisations.AUTOENCODER_HISTORY_FILE else [{"stationId": "LESBUT01", "elementCode": "rain", "finalDecision": "FAILED", "modelAgreementCount": "2"}])
    monkeypatch.setattr(visualisations, "save_bar_chart", lambda counts, title, xlabel, ylabel, path, rotate=False: saved.append(path))

    outputs = visualisations.generate_visualisations()

    assert tmp_path / "model_decision_distribution.png" in outputs
    assert tmp_path / "station_anomaly_counts_top20.png" in outputs
    assert len(saved) == 5


def test_lms_genai_template_fallback(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    monkeypatch.delenv("COPILOT_API_BASE_URL", raising=False)
    monkeypatch.delenv("COPILOT_API_KEY", raising=False)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "microsoft_copilot")
    monkeypatch.setattr(genai, "ENSEMBLE_PREDICTIONS_FILE", tmp_path / "ensemble.csv")
    monkeypatch.setattr(genai, "MODEL_EVALUATION_SUMMARY_JSON", tmp_path / "summary.json")
    monkeypatch.setattr(genai, "GENAI_MODEL_SUMMARY_FILE", tmp_path / "summary.md")
    monkeypatch.setattr(genai, "GENAI_REVIEWER_EXPLANATIONS_FILE", tmp_path / "explanations.csv")
    (tmp_path / "ensemble.csv").write_text("stationId,observationDatetime,elementCode,finalDecision,outcome,severity,confidence,modelAgreementCount,anomalyScore,explanation\nLESBUT01,2020-01-01,rain,SUSPECT,SUSPECT,MEDIUM,0.7,1,2,review\n", encoding="utf-8")
    (tmp_path / "summary.json").write_text("{}", encoding="utf-8")

    provider = genai.generate_genai_outputs()

    assert provider.name == "template"
    assert "provider=template" in (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "template" in (tmp_path / "explanations.csv").read_text(encoding="utf-8")


def write_genai_fixture(tmp_path: Path, count: int = 1) -> None:
    rows = [
        "stationId,observationDatetime,elementCode,finalDecision,outcome,severity,confidence,modelAgreementCount,anomalyScore,explanation"
    ]
    for index in range(count):
        rows.append(
            f"LES{index:05d},2020-01-{(index % 28) + 1:02d},rain,SUSPECT,SUSPECT,MEDIUM,0.7,1,{100 - index},template explanation {index}"
        )
    (tmp_path / "ensemble.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    (tmp_path / "summary.json").write_text('{"totalNormalizedRows": 1000, "anomalyRows": 25}', encoding="utf-8")


def patch_genai_paths(genai, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(genai, "ENSEMBLE_PREDICTIONS_FILE", tmp_path / "ensemble.csv")
    monkeypatch.setattr(genai, "MODEL_EVALUATION_SUMMARY_JSON", tmp_path / "summary.json")
    monkeypatch.setattr(genai, "GENAI_MODEL_SUMMARY_FILE", tmp_path / "summary.md")
    monkeypatch.setattr(genai, "GENAI_REVIEWER_EXPLANATIONS_FILE", tmp_path / "explanations.csv")


def clear_genai_keys(monkeypatch) -> None:
    for key in ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"]:
        monkeypatch.delenv(key, raising=False)


def test_lms_genai_gemini_missing_key_falls_back_to_groq(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "gemini")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path)

    def fake_post_json(url, headers, payload, timeout=30):
        assert url == genai.GROQ_CHAT_COMPLETIONS_URL
        return {"choices": [{"message": {"content": "groq generated text"}}]}

    monkeypatch.setattr(genai, "_post_json", fake_post_json)

    provider = genai.generate_genai_outputs()

    assert provider.name == "groq"
    assert "provider=groq" in (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "groq,LES00000" in (tmp_path / "explanations.csv").read_text(encoding="utf-8")


def test_lms_genai_gemini_missing_keys_falls_back_to_template(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "gemini")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path)

    provider = genai.generate_genai_outputs()

    assert provider.name == "template"
    assert "provider=template" in (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "template,LES00000" in (tmp_path / "explanations.csv").read_text(encoding="utf-8")


def test_lms_genai_gemini_api_failure_falls_back_safely(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path)
    monkeypatch.setattr(genai, "_post_json", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("failed")))

    provider = genai.generate_genai_outputs()

    assert provider.name == "gemini"
    assert "provider=template" in (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "template,LES00000" in (tmp_path / "explanations.csv").read_text(encoding="utf-8")


def test_lms_genai_gemini_empty_candidates_falls_back_safely(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path)
    monkeypatch.setattr(genai, "_post_json", lambda *args, **kwargs: {"promptFeedback": {"blockReason": "SAFETY"}})

    provider = genai.generate_genai_outputs()

    assert provider.name == "gemini"
    assert "provider=template" in (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "template,LES00000" in (tmp_path / "explanations.csv").read_text(encoding="utf-8")


def test_lms_genai_groq_api_failure_falls_back_safely(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path)
    monkeypatch.setattr(genai, "_post_json", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("failed")))

    provider = genai.generate_genai_outputs()

    assert provider.name == "groq"
    assert "provider=template" in (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "template,LES00000" in (tmp_path / "explanations.csv").read_text(encoding="utf-8")


def test_lms_genai_external_provider_limits_reviewer_rows(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path, count=25)
    calls = []

    def fake_post_json(url, headers, payload, timeout=30):
        calls.append(payload)
        return {"choices": [{"message": {"content": f"external text {len(calls)}"}}]}

    monkeypatch.setattr(genai, "_post_json", fake_post_json)

    genai.generate_genai_outputs()

    with (tmp_path / "explanations.csv").open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(calls) == genai.EXTERNAL_REVIEWER_EXPLANATION_LIMIT + 1
    assert sum(row["provider"] == "groq" for row in rows) == genai.EXTERNAL_REVIEWER_EXPLANATION_LIMIT
    assert sum(row["provider"] == "template" for row in rows) == 5


def test_lms_genai_template_provider_uses_no_network(tmp_path: Path, monkeypatch):
    from lms_ai_pipeline import genai

    clear_genai_keys(monkeypatch)
    monkeypatch.setenv("LMS_GENAI_PROVIDER", "template")
    patch_genai_paths(genai, tmp_path, monkeypatch)
    write_genai_fixture(tmp_path)
    monkeypatch.setattr(genai, "_post_json", lambda *args, **kwargs: pytest.fail("template provider must not call network"))

    provider = genai.generate_genai_outputs()

    assert provider.name == "template"
    assert "provider=template" in (tmp_path / "summary.md").read_text(encoding="utf-8")


def test_lms_ensemble_includes_autoencoder_when_available():
    base = feature_row(1)
    model_rows = [
        build_prediction(base, "Z-score", 0.1, "NORMAL", "LOW", "0.50", "ok"),
        build_prediction(base, "Isolation Forest", 0.1, "NORMAL", "LOW", "0.50", "ok"),
        build_prediction(base, "Autoencoder", 4.2, "FAILED", "HIGH", "0.95", "reconstruction high"),
    ]

    rows = ensemble_predictions(model_rows)

    assert rows[0]["modelAgreementCount"] == 1
    assert "Autoencoder" in rows[0]["contributingModels"]
    assert rows[0]["agreeingModels"] == "Autoencoder"
