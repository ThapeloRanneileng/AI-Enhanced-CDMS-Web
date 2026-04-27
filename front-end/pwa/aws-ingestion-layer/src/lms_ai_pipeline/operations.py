from __future__ import annotations

import json
import os
import platform as platform_module
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

from .config import (
    AUTOENCODER_HISTORY_FILE,
    AUTOENCODER_PREDICTIONS_FILE,
    AUTOENCODER_STATUS_FILE,
    COMBINED_PREDICTIONS_FILE,
    DUPLICATE_CONFLICTS_FILE,
    ENGINE_VERSION,
    GENAI_MODEL_SUMMARY_FILE,
    GENAI_REVIEWER_EXPLANATIONS_FILE,
    IMPUTATION_SUMMARY_FILE,
    IMPUTED_SUPPORT_FILE,
    INPUT_FILE,
    IQR_OUTLIERS_FILE,
    ISOLATION_FOREST_PREDICTIONS_FILE,
    MISSING_VALUES_FILE,
    MODEL_EVALUATION_SUMMARY_CSV,
    MODEL_EVALUATION_SUMMARY_JSON,
    MODEL_EVALUATION_SUMMARY_MD,
    MODEL_METADATA_FILE,
    NORMALIZED_FILE,
    ONE_CLASS_SVM_PREDICTIONS_FILE,
    PIPELINE_RUN_MANIFEST_FILE,
    QC_HANDOFF_FILE,
    RANDOM_FOREST_STATUS_FILE,
    REJECTED_VALUES_FILE,
    SUPERVISOR_SUMMARY_FILE,
    TEST_SPLIT_FILE,
    TRAIN_SPLIT_FILE,
    TRAIN_TEST_SUMMARY_FILE,
    UNKNOWN_STATIONS_FILE,
    VALIDATION_SUMMARY_FILE,
    VALIDATION_WARNINGS_FILE,
    ZSCORE_PREDICTIONS_FILE,
    ENSEMBLE_PREDICTIONS_FILE,
)
from .io import file_metadata, read_csv

PROVENANCE_FIELDS = ["sourceSystem", "sourceDataset", "sourceFile", "ingestionRunId", "pipelineRunId", "processedAt"]
PIPELINE_NAME = "LMS AI Pipeline"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_run_context() -> Dict[str, object]:
    run_id = f"lms-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    started_at = utc_now_iso()
    return {
        "runId": run_id,
        "runStartedAt": started_at,
        "processedAt": started_at,
        "startedMonotonic": time.monotonic(),
    }


def provenance_values(run_context: Dict[str, object] | None, source_file: Path = INPUT_FILE) -> Dict[str, object]:
    run_context = run_context or {}
    run_id = str(run_context.get("runId") or "manual-run")
    processed_at = str(run_context.get("processedAt") or utc_now_iso())
    return {
        "sourceSystem": "LMS",
        "sourceDataset": "LMS Historical Daily CSV",
        "sourceFile": str(source_file),
        "ingestionRunId": run_id,
        "pipelineRunId": run_id,
        "processedAt": processed_at,
    }


def add_provenance(rows: Iterable[Dict[str, object]], run_context: Dict[str, object] | None, source_file: Path = INPUT_FILE) -> List[Dict[str, object]]:
    values = provenance_values(run_context, source_file)
    return [{**row, **values} for row in rows]


def safe_git_value(args: Sequence[str]) -> str:
    try:
        result = subprocess.run(["git", *args], cwd=Path(__file__).resolve().parents[4], check=True, capture_output=True, text=True)
    except Exception:
        return "unavailable"
    return result.stdout.strip() or "unavailable"


def input_file_paths() -> List[Path]:
    return [INPUT_FILE]


def output_file_paths() -> List[Path]:
    return [
        NORMALIZED_FILE,
        VALIDATION_SUMMARY_FILE,
        VALIDATION_WARNINGS_FILE,
        REJECTED_VALUES_FILE,
        MISSING_VALUES_FILE,
        DUPLICATE_CONFLICTS_FILE,
        UNKNOWN_STATIONS_FILE,
        IQR_OUTLIERS_FILE,
        IMPUTED_SUPPORT_FILE,
        IMPUTATION_SUMMARY_FILE,
        TRAIN_SPLIT_FILE,
        TEST_SPLIT_FILE,
        TRAIN_TEST_SUMMARY_FILE,
        MODEL_METADATA_FILE,
        ZSCORE_PREDICTIONS_FILE,
        ISOLATION_FOREST_PREDICTIONS_FILE,
        ONE_CLASS_SVM_PREDICTIONS_FILE,
        AUTOENCODER_PREDICTIONS_FILE,
        AUTOENCODER_HISTORY_FILE,
        AUTOENCODER_STATUS_FILE,
        RANDOM_FOREST_STATUS_FILE,
        COMBINED_PREDICTIONS_FILE,
        ENSEMBLE_PREDICTIONS_FILE,
        QC_HANDOFF_FILE,
        MODEL_EVALUATION_SUMMARY_CSV,
        MODEL_EVALUATION_SUMMARY_JSON,
        MODEL_EVALUATION_SUMMARY_MD,
        GENAI_MODEL_SUMMARY_FILE,
        GENAI_REVIEWER_EXPLANATIONS_FILE,
        SUPERVISOR_SUMMARY_FILE,
        PIPELINE_RUN_MANIFEST_FILE,
    ]


def count_rows(path: Path) -> int:
    metadata = file_metadata(path)
    return int(metadata["rowCount"] or 0)


def build_manifest(run_context: Dict[str, object], config: object | None, total_prediction_rows: int) -> Dict[str, object]:
    finished_at = utc_now_iso()
    autoencoder_status = read_csv(AUTOENCODER_STATUS_FILE) if AUTOENCODER_STATUS_FILE.exists() else []
    autoencoder = autoencoder_status[0] if autoencoder_status else {}
    runtime_seconds = time.monotonic() - float(run_context.get("startedMonotonic", time.monotonic()))
    return {
        "runId": run_context.get("runId", ""),
        "runStartedAt": run_context.get("runStartedAt", ""),
        "runFinishedAt": finished_at,
        "runtimeSeconds": round(runtime_seconds, 3),
        "pipelineName": PIPELINE_NAME,
        "pipelineVersion": ENGINE_VERSION or "local-dev",
        "gitCommit": safe_git_value(["rev-parse", "--short", "HEAD"]),
        "gitBranch": safe_git_value(["rev-parse", "--abbrev-ref", "HEAD"]),
        "pythonVersion": sys.version.replace("\n", " "),
        "platform": platform_module.platform(),
        "commandLine": " ".join(sys.argv),
        "environmentMode": os.environ.get("LMS_ENVIRONMENT_MODE", "local-dev"),
        "genaiProvider": os.environ.get("LMS_GENAI_PROVIDER", "template"),
        "inputFiles": [file_metadata(path) for path in input_file_paths()],
        "outputFiles": [file_metadata(path) for path in output_file_paths()],
        "totalInputRows": count_rows(INPUT_FILE),
        "totalCleanRows": count_rows(NORMALIZED_FILE),
        "totalRejectedRows": count_rows(REJECTED_VALUES_FILE),
        "totalPredictionRows": total_prediction_rows,
        "qcReviewRows": count_rows(QC_HANDOFF_FILE),
        "warningRows": count_rows(VALIDATION_WARNINGS_FILE),
        "autoencoderEnabled": bool(autoencoder) and autoencoder.get("status") == "trained",
        "autoencoderCalibrationMode": autoencoder.get("calibrationMode", getattr(config, "calibration", "")),
        "contamination": getattr(config, "contamination", ""),
        "epochs": getattr(config, "epochs", ""),
        "batchSize": getattr(config, "batch_size", ""),
        "notes": [
            "Generated by the LMS AI pipeline operational readiness step.",
            "Anomaly outputs prioritize rows for human QC review; they are not automatic value corrections.",
        ],
    }


def write_manifest(run_context: Dict[str, object], config: object | None, total_prediction_rows: int) -> Dict[str, object]:
    manifest = build_manifest(run_context, config, total_prediction_rows)
    PIPELINE_RUN_MANIFEST_FILE.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    # Refresh manifest metadata now that the manifest exists.
    manifest["outputFiles"] = [file_metadata(path) for path in output_file_paths()]
    PIPELINE_RUN_MANIFEST_FILE.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def top_rows(rows: Sequence[Dict[str, object]], key: str = "anomalyRate", limit: int = 5) -> List[Dict[str, object]]:
    return sorted(rows, key=lambda row: (float(row.get(key, 0.0)), int(row.get("anomalyCount", 0))), reverse=True)[:limit]


def build_supervisor_summary(payload: Dict[str, object], manifest: Dict[str, object]) -> str:
    metrics = dict(payload.get("modelMetrics", {}))
    ensemble_metrics = dict(metrics.get("Ensemble", {}))
    autoencoder_status = payload.get("autoencoderStatus", [])
    autoencoder = autoencoder_status[0] if autoencoder_status else {}
    top_stations = top_rows(payload.get("stationAnomalyRates", []))
    top_elements = top_rows(payload.get("elementAnomalyRates", []))
    top_pairs = payload.get("topStationElementPairs", [])[:5]
    warnings = payload.get("calibrationWarnings", [])

    lines = [
        "# LMS Supervisor Summary",
        "",
        "## Pipeline Run Overview",
        f"- Run ID: {manifest.get('runId', '')}",
        f"- Pipeline: {manifest.get('pipelineName', PIPELINE_NAME)} ({manifest.get('pipelineVersion', 'local-dev')})",
        f"- Started: {manifest.get('runStartedAt', '')}",
        f"- Finished: {manifest.get('runFinishedAt', '')}",
        f"- Runtime seconds: {manifest.get('runtimeSeconds', '')}",
        f"- Git: {manifest.get('gitBranch', 'unavailable')} / {manifest.get('gitCommit', 'unavailable')}",
        "",
        "## Data Ingestion Summary",
        f"- Input rows: {manifest.get('totalInputRows', 0)}",
        f"- Clean normalized observation rows: {manifest.get('totalCleanRows', 0)}",
        f"- Rejected rows: {manifest.get('totalRejectedRows', 0)}",
        f"- Validation warning rows: {manifest.get('warningRows', 0)}",
        "",
        "## AI Model Summary",
        f"- Prediction rows produced: {manifest.get('totalPredictionRows', 0)}",
        f"- Ensemble rows reviewed: {ensemble_metrics.get('totalRows', 0)}",
        f"- Ensemble anomaly review candidates: {ensemble_metrics.get('anomalyCount', 0)}",
        f"- Ensemble anomaly rate: {float(ensemble_metrics.get('anomalyRate', 0.0)):.4f}",
        "- The AI layer prioritizes observations for human quality-control review; it does not automatically mark values as wrong.",
        "",
        "## Autoencoder Calibration Summary",
        f"- Autoencoder enabled: {manifest.get('autoencoderEnabled', False)}",
        f"- Calibration mode: {manifest.get('autoencoderCalibrationMode', autoencoder.get('calibrationMode', ''))}",
        f"- Global suspect threshold: {autoencoder.get('globalSuspectThreshold', '')}",
        f"- Global failed threshold: {autoencoder.get('globalFailedThreshold', '')}",
        f"- Epochs: {manifest.get('epochs', '')}; batch size: {manifest.get('batchSize', '')}; contamination: {manifest.get('contamination', '')}",
        "",
        "## Anomaly Review Summary",
        f"- Normal ensemble rows: {ensemble_metrics.get('normalCount', 0)}",
        f"- Suspect ensemble rows: {ensemble_metrics.get('suspectCount', 0)}",
        f"- Failed ensemble rows: {ensemble_metrics.get('failedCount', 0)}",
        "- Anomalies are not automatically wrong values. They are observations with unusual model or rule signals that should be checked by a reviewer.",
        "",
        "## Highest-Risk Stations and Elements",
        "Top stations:",
    ]
    lines.extend([f"- {row.get('stationId', '')}: {row.get('anomalyCount', 0)} anomalies; rate={float(row.get('anomalyRate', 0.0)):.4f}" for row in top_stations] or ["- None"])
    lines.append("Top elements:")
    lines.extend([f"- {row.get('elementCode', '')}: {row.get('anomalyCount', 0)} anomalies; rate={float(row.get('anomalyRate', 0.0)):.4f}" for row in top_elements] or ["- None"])
    lines.append("Top station-element pairs:")
    lines.extend([f"- {row.get('stationId', '')}/{row.get('elementCode', '')}: {row.get('anomalyCount', 0)} anomalies; rate={float(row.get('anomalyRate', 0.0)):.4f}" for row in top_pairs] or ["- None"])
    lines.extend([
        "",
        "## QC Review Handoff Summary",
        f"- QC review handoff rows: {manifest.get('qcReviewRows', 0)}",
        "- Review rows include source, model agreement, explanation, recommended reviewer action, and review reason metadata.",
        "",
        "## Interpretation Notes",
        "- High anomaly rates indicate threshold or data review is needed, not necessarily model failure.",
        "- The LMS AI pipeline supports the broader AI-Enhanced Climate Data Management System by adding reproducible review prioritization and audit evidence.",
        "- The Random Forest model remains disabled until reviewer-approved labels are available.",
    ])
    if warnings:
        lines.append("- Calibration warnings:")
        lines.extend([f"- {warning}" for warning in warnings])
    lines.extend([
        "",
        "## Next Recommended Actions",
        "- Review the highest-risk station-element pairs first.",
        "- Compare flagged observations with original LMS paper/source records and nearby dates.",
        "- Track reviewer decisions so future supervised models can be trained safely.",
        "- Revisit thresholds when anomaly rates become unusually high for a station, element, or model.",
    ])
    return "\n".join(lines) + "\n"


def write_supervisor_summary(payload: Dict[str, object], manifest: Dict[str, object]) -> str:
    markdown = build_supervisor_summary(payload, manifest)
    SUPERVISOR_SUMMARY_FILE.write_text(markdown, encoding="utf-8")
    return markdown
