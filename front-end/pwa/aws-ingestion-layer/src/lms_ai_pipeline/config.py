from __future__ import annotations

from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[3]
LMS_DIR = ROOT_DIR / "data" / "lms"
INPUT_FILE = LMS_DIR / "observations" / "NULClimsofttext.csv"
OUTPUT_DIR = LMS_DIR / "outputs"
REJECTED_DIR = LMS_DIR / "rejected"

NORMALIZED_FILE = OUTPUT_DIR / "lms_all_station_training_input_normalized.csv"
VALIDATION_SUMMARY_FILE = OUTPUT_DIR / "lms_all_station_validation_summary.csv"
VALIDATION_WARNINGS_FILE = OUTPUT_DIR / "lms_all_station_validation_warnings.csv"
REJECTED_VALUES_FILE = REJECTED_DIR / "lms_all_station_rejected_values.csv"
MISSING_VALUES_FILE = REJECTED_DIR / "lms_all_station_missing_values.csv"
DUPLICATE_CONFLICTS_FILE = REJECTED_DIR / "lms_all_station_duplicate_conflicts.csv"
UNKNOWN_STATIONS_FILE = REJECTED_DIR / "lms_all_station_unknown_stations.csv"
INSPECTION_SUMMARY_FILE = OUTPUT_DIR / "lms_all_station_inspection_summary.csv"
IQR_OUTLIERS_FILE = OUTPUT_DIR / "lms_all_station_iqr_outliers.csv"
IMPUTATION_SUMMARY_FILE = OUTPUT_DIR / "lms_all_station_imputation_summary.csv"
IMPUTED_SUPPORT_FILE = OUTPUT_DIR / "lms_all_station_imputed_support_dataset.csv"

TRAIN_SPLIT_FILE = OUTPUT_DIR / "lms_train_split.csv"
TEST_SPLIT_FILE = OUTPUT_DIR / "lms_test_split.csv"
TRAIN_TEST_SUMMARY_FILE = OUTPUT_DIR / "lms_train_test_summary.csv"
MODEL_METADATA_FILE = OUTPUT_DIR / "lms_model_training_summary.csv"

ZSCORE_PREDICTIONS_FILE = OUTPUT_DIR / "lms_zscore_predictions.csv"
ISOLATION_FOREST_PREDICTIONS_FILE = OUTPUT_DIR / "lms_isolation_forest_predictions.csv"
ONE_CLASS_SVM_PREDICTIONS_FILE = OUTPUT_DIR / "lms_one_class_svm_predictions.csv"
AUTOENCODER_PREDICTIONS_FILE = OUTPUT_DIR / "lms_autoencoder_predictions.csv"
RANDOM_FOREST_STATUS_FILE = OUTPUT_DIR / "lms_random_forest_status.csv"
COMBINED_PREDICTIONS_FILE = OUTPUT_DIR / "lms_anomaly_predictions.csv"
ENSEMBLE_PREDICTIONS_FILE = OUTPUT_DIR / "lms_ensemble_anomaly_predictions.csv"
QC_HANDOFF_FILE = OUTPUT_DIR / "lms_qc_review_handoff.csv"

STATIONS = {
    "LESBER07": {"stationName": "PHUTHIATSANA", "district": "BEREA", "stationType": "CLIMATE"},
    "LESBUT01": {"stationName": "BUTHA-BUTHE", "district": "BUTHA-BUTHE", "stationType": "CLIMATE"},
    "LESBUT02": {"stationName": "OXBOW", "district": "BUTHA-BUTHE", "stationType": "CLIMATE"},
    "LESLER01": {"stationName": "LERIBE", "district": "LERIBE", "stationType": "CLIMATE"},
    "LESLER08": {"stationName": "MAPUTSOE", "district": "LERIBE", "stationType": "NOT_SPECIFIED"},
    "LESMAF01": {"stationName": "MAFETENG", "district": "MAFETENG", "stationType": "CLIMATE"},
    "LESMAF07": {"stationName": "MATELILE", "district": "MAFETENG", "stationType": "RAINFALL"},
    "LESMAS19": {"stationName": "MEJAMETALANA", "district": "MASERU", "stationType": "CLIMATE"},
    "LESMAS27": {"stationName": "MOSHOESHOE-I", "district": "MASERU", "stationType": "SYNOPTIC"},
    "LESMAS29": {"stationName": "MASIANOKENG", "district": "MASERU", "stationType": "CLIMATE"},
    "LESMAS35": {"stationName": "SEISO(METOLONG)", "district": "MASERU", "stationType": "CLIMATE"},
    "LESMOH01": {"stationName": "MOHALE'S-HOEK", "district": "MOHALES HOEK", "stationType": "CLIMATE"},
    "LESMOK01": {"stationName": "MALEFILOANE", "district": "MOKHOTLONG", "stationType": "CLIMATE"},
    "LESMOK02": {"stationName": "MOKHOTLONG", "district": "MOKHOTLONG", "stationType": "SYNOPTIC"},
    "LESMOK08": {"stationName": "ST-MARTINS", "district": "MOKHOTLONG", "stationType": "CLIMATE"},
    "LESMOK10": {"stationName": "ST-JAMES", "district": "MOKHOTLONG", "stationType": "CLIMATE"},
    "LESQAC01": {"stationName": "QACHA'S-NEK", "district": "QACHAS NEK", "stationType": "SYNOPTIC"},
    "LESQAC02": {"stationName": "SEHLABATHEBE", "district": "QACHAS NEK", "stationType": "CLIMATE"},
    "LESQUT01": {"stationName": "QUTHING", "district": "QUTHING", "stationType": "CLIMATE"},
    "LESTHA06": {"stationName": "THABA-TSEKA", "district": "THABA-TSEKA", "stationType": "CLIMATE"},
    "LESTHA10": {"stationName": "SEMONKONG", "district": "THABA-TSEKA", "stationType": "CLIMATE"},
}

ELEMENTS = {
    "rain": {"name": "Rainfall", "unit": "mm"},
    "tmax": {"name": "Maximum Temperature", "unit": "degC"},
    "tmin": {"name": "Minimum Temperature", "unit": "degC"},
}

SOURCE_NAME = "LMS Historical Daily CSV"
DATA_TYPE = "historical"
MODEL_VERSION = "lms-historical-baseline-v1"
ENGINE_VERSION = "lms-ai-pipeline-v1"
