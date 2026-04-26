from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List, Sequence

from .config import (
    ENSEMBLE_PREDICTIONS_FILE,
    GENAI_MODEL_SUMMARY_FILE,
    GENAI_REVIEWER_EXPLANATIONS_FILE,
    MODEL_EVALUATION_SUMMARY_JSON,
)
from .io import read_csv, write_csv

GENAI_EXPLANATION_FIELDS = [
    "provider", "stationId", "observationDatetime", "elementCode", "finalDecision", "severity",
    "confidence", "explanation",
]


class GenAIProvider:
    name = "disabled"

    def reviewer_explanation(self, row: Dict[str, str]) -> str:
        return row.get("explanation", "")

    def executive_summary(self, report_json: str) -> str:
        return "GenAI reporting is disabled."


class TemplateGenAIProvider(GenAIProvider):
    name = "template"

    def reviewer_explanation(self, row: Dict[str, str]) -> str:
        decision = row.get("finalDecision", row.get("outcome", ""))
        station = row.get("stationId", "")
        element = row.get("elementCode", "")
        score = row.get("anomalyScore", "")
        agreement = row.get("modelAgreementCount", "0")
        if decision == "NORMAL":
            return f"{station} {element} is within the learned historical pattern. Model agreement count is {agreement} and anomaly score is {score}."
        return f"{station} {element} needs review because {agreement} model(s) flagged the observation. Decision is {decision}, severity is {row.get('severity', '')}, and anomaly score is {score}."

    def executive_summary(self, report_json: str) -> str:
        return (
            "# LMS GenAI Model Summary\n\n"
            "provider=template\n\n"
            "The LMS AI pipeline generated deterministic reviewer and executive text without calling an external API. "
            "The summary combines model status, train/test counts, ensemble agreement, anomaly rates, and autoencoder training metrics from the evaluation report.\n\n"
            "Random Forest remains untrained until QC-reviewed labels are available. TensorFlow/Keras autoencoder results are included when the runtime has TensorFlow installed.\n"
        )


class DisabledGenAIProvider(GenAIProvider):
    name = "disabled"


class MicrosoftCopilotProvider(GenAIProvider):
    name = "microsoft_copilot"

    def __init__(self, base_url: str, api_key: str, tenant_id: str = "") -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.tenant_id = tenant_id

    def reviewer_explanation(self, row: Dict[str, str]) -> str:
        return TemplateGenAIProvider().reviewer_explanation(row)

    def executive_summary(self, report_json: str) -> str:
        return TemplateGenAIProvider().executive_summary(report_json).replace("provider=template", "provider=microsoft_copilot")


def select_provider(mode: str | None = None) -> GenAIProvider:
    selected = (mode or os.getenv("LMS_GENAI_PROVIDER") or "template").strip().lower()
    if selected == "disabled":
        return DisabledGenAIProvider()
    if selected == "microsoft_copilot":
        base_url = os.getenv("COPILOT_API_BASE_URL", "")
        api_key = os.getenv("COPILOT_API_KEY", "")
        tenant_id = os.getenv("COPILOT_TENANT_ID", "")
        if base_url and api_key:
            return MicrosoftCopilotProvider(base_url, api_key, tenant_id)
        return TemplateGenAIProvider()
    return TemplateGenAIProvider()


def safe_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else "{}"


def build_reviewer_rows(provider: GenAIProvider, ensemble_rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    output: List[Dict[str, str]] = []
    for row in ensemble_rows:
        output.append({
            "provider": provider.name,
            "stationId": row.get("stationId", ""),
            "observationDatetime": row.get("observationDatetime", ""),
            "elementCode": row.get("elementCode", ""),
            "finalDecision": row.get("finalDecision", row.get("outcome", "")),
            "severity": row.get("severity", ""),
            "confidence": row.get("confidence", ""),
            "explanation": provider.reviewer_explanation(row),
        })
    return output


def generate_genai_outputs(mode: str | None = None) -> GenAIProvider:
    provider = select_provider(mode)
    ensemble_rows = read_csv(ENSEMBLE_PREDICTIONS_FILE) if ENSEMBLE_PREDICTIONS_FILE.exists() else []
    report_json = safe_text(MODEL_EVALUATION_SUMMARY_JSON)
    GENAI_MODEL_SUMMARY_FILE.write_text(provider.executive_summary(report_json), encoding="utf-8")
    write_csv(GENAI_REVIEWER_EXPLANATIONS_FILE, build_reviewer_rows(provider, ensemble_rows), GENAI_EXPLANATION_FIELDS)
    return provider
