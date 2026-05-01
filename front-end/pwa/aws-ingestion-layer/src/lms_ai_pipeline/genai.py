from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Sequence
from urllib import request
from urllib.error import HTTPError, URLError

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
EXTERNAL_REVIEWER_EXPLANATION_LIMIT = 20
GEMINI_GENERATE_CONTENT_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"


@dataclass
class GenAIProviderMetadata:
    requestedProvider: str
    effectiveProvider: str
    status: str
    fallbackReason: str = ""

    def as_manifest_fields(self) -> Dict[str, str]:
        return {
            "requestedGenaiProvider": self.requestedProvider,
            "effectiveGenaiProvider": self.effectiveProvider,
            "genaiProvider": self.effectiveProvider,
            "genaiProviderStatus": self.status,
            "genaiFallbackReason": self.fallbackReason,
        }


class GenAIProvider:
    name = "disabled"

    def __init__(self, metadata: GenAIProviderMetadata | None = None) -> None:
        self.metadata = metadata or GenAIProviderMetadata(self.name, self.name, "success")

    def reviewer_explanation(self, row: Dict[str, str]) -> str:
        return row.get("explanation", "")

    def executive_summary(self, report_json: str) -> str:
        return "GenAI reporting is disabled."

    def reviewer_rows(self, ensemble_rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
        return build_template_reviewer_rows(self, ensemble_rows)


class TemplateGenAIProvider(GenAIProvider):
    name = "template"

    def __init__(self, metadata: GenAIProviderMetadata | None = None) -> None:
        super().__init__(metadata or GenAIProviderMetadata("template", "template", "success"))

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
        lines = [
            "# LMS GenAI Model Summary\n\n"
            "provider=template\n\n"
        ]
        if self.metadata.status == "fallback" and self.metadata.fallbackReason:
            lines.append(
                f"Requested provider={self.metadata.requestedProvider}; effective provider=template; "
                f"status=fallback; fallback reason={self.metadata.fallbackReason}\n\n"
            )
        lines.append(
            "The LMS AI pipeline generated deterministic reviewer and executive text without calling an external API. "
            "The summary combines model status, train/test counts, ensemble agreement, anomaly rates, and autoencoder training metrics from the evaluation report.\n\n"
            "Random Forest remains untrained until QC-reviewed labels are available. TensorFlow/Keras autoencoder results are included when the runtime has TensorFlow installed.\n"
        )
        return "".join(lines)


class DisabledGenAIProvider(GenAIProvider):
    name = "disabled"


class MicrosoftCopilotProvider(GenAIProvider):
    name = "microsoft_copilot"

    def __init__(self, base_url: str, api_key: str, tenant_id: str = "") -> None:
        super().__init__(GenAIProviderMetadata(self.name, self.name, "success"))
        self.base_url = base_url
        self.api_key = api_key
        self.tenant_id = tenant_id

    def reviewer_explanation(self, row: Dict[str, str]) -> str:
        return TemplateGenAIProvider().reviewer_explanation(row)

    def executive_summary(self, report_json: str) -> str:
        return TemplateGenAIProvider().executive_summary(report_json).replace("provider=template", "provider=microsoft_copilot")


def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 30) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "AI-Enhanced-CDMS-LMS-Pipeline/1.0",
        **headers,
    }
    req = request.Request(url, data=body, headers=request_headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
            return json.loads(response_body or "{}")
    except HTTPError as exc:
        error_body = ""
        try:
            error_body = exc.read().decode("utf-8")[:1000]
        except Exception:
            error_body = ""
        detail = f"GenAI provider request failed: HTTP {exc.code} {exc.reason}"
        if error_body:
            detail = f"{detail}: {error_body}"
        raise RuntimeError(detail) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"GenAI provider request failed: {type(exc).__name__}: {exc}") from exc


def safe_exception_message(exc: BaseException) -> str:
    parts = [f"{type(exc).__name__}: {exc}"]
    cause = getattr(exc, "__cause__", None)
    if cause:
        parts.append(f"caused by {type(cause).__name__}: {cause}")
    message = "; ".join(part for part in parts if part.strip())
    for key_name in ("GEMINI_API_KEY", "GROQ_API_KEY", "COPILOT_API_KEY"):
        secret = os.getenv(key_name, "")
        if secret and len(secret) >= 8:
            message = message.replace(secret, "[redacted]")
    return message[:1000]


def _compact_report_json(report_json: str) -> str:
    try:
        payload = json.loads(report_json or "{}")
    except json.JSONDecodeError:
        return "{}"
    return json.dumps(payload, sort_keys=True)[:12000]


def _row_sort_key(row: Dict[str, str]) -> tuple[int, float]:
    decision = row.get("finalDecision", row.get("outcome", ""))
    priority = {"FAILED": 3, "SUSPECT": 2, "NORMAL": 1}.get(decision, 0)
    try:
        score = float(row.get("anomalyScore", "0") or 0)
    except ValueError:
        score = 0.0
    return priority, score


def top_anomaly_rows(ensemble_rows: Sequence[Dict[str, str]], limit: int = EXTERNAL_REVIEWER_EXPLANATION_LIMIT) -> List[Dict[str, str]]:
    candidates = [row for row in ensemble_rows if row.get("finalDecision", row.get("outcome", "")) != "NORMAL"]
    return sorted(candidates, key=_row_sort_key, reverse=True)[:limit]


def build_summary_prompt(report_json: str) -> str:
    return (
        "Write a concise executive LMS AI model evaluation summary for climate data quality reviewers. "
        "Use only the compact JSON report below. Include model readiness, anomaly signals, limitations, "
        "and reviewer next steps. Start with '# LMS GenAI Model Summary' and include no secrets.\n\n"
        f"Compact report JSON:\n{_compact_report_json(report_json)}"
    )


def build_reviewer_prompt(row: Dict[str, str]) -> str:
    compact_row = {
        "stationId": row.get("stationId", ""),
        "observationDatetime": row.get("observationDatetime", ""),
        "elementCode": row.get("elementCode", ""),
        "finalDecision": row.get("finalDecision", row.get("outcome", "")),
        "severity": row.get("severity", ""),
        "confidence": row.get("confidence", ""),
        "modelAgreementCount": row.get("modelAgreementCount", ""),
        "anomalyScore": row.get("anomalyScore", ""),
        "contributingModels": row.get("contributingModels", row.get("agreeingModels", "")),
        "templateExplanation": row.get("explanation", ""),
    }
    return (
        "Write one brief reviewer-facing explanation for this LMS anomaly. "
        "Use only these fields, avoid speculation, and recommend a practical review action.\n\n"
        f"{json.dumps(compact_row, sort_keys=True)}"
    )


class ExternalGenAIProvider(GenAIProvider):
    fallback: GenAIProvider

    def mark_fallback(self, exc: BaseException | str) -> None:
        reason = exc if isinstance(exc, str) else safe_exception_message(exc)
        self.metadata.effectiveProvider = self.fallback.name
        self.metadata.status = "fallback"
        self.metadata.fallbackReason = str(reason)
        self.fallback.metadata = self.metadata

    def using_fallback(self) -> bool:
        return self.metadata.status == "fallback" and self.metadata.effectiveProvider != self.name

    def complete(self, prompt: str, max_tokens: int) -> str:
        raise NotImplementedError

    def executive_summary(self, report_json: str) -> str:
        if self.using_fallback():
            return self.fallback.executive_summary(report_json)
        try:
            summary = self.complete(build_summary_prompt(report_json), max_tokens=900).strip()
            if not summary:
                self.mark_fallback(f"{self.name} returned an empty summary")
                return self.fallback.executive_summary(report_json)
            summary = summary.replace("provider=template", f"provider={self.name}")
            if f"provider={self.name}" not in summary:
                summary = f"{summary}\n\nprovider={self.name}\n"
            return summary
        except Exception as exc:
            self.mark_fallback(exc)
            return self.fallback.executive_summary(report_json)

    def reviewer_rows(self, ensemble_rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
        if self.using_fallback():
            return self.fallback.reviewer_rows(ensemble_rows)
        template_provider = TemplateGenAIProvider()
        rows_by_id = {id(row): row for row in top_anomaly_rows(ensemble_rows)}
        output: List[Dict[str, str]] = []
        external_available = True
        for row in ensemble_rows:
            provider: GenAIProvider = template_provider
            if external_available and id(row) in rows_by_id:
                try:
                    explanation = self.complete(build_reviewer_prompt(row), max_tokens=180).strip()
                    if explanation:
                        provider = self
                        output.append(reviewer_output_row(row, self.name, explanation))
                        continue
                except Exception as exc:
                    self.mark_fallback(exc)
                    external_available = False
                    if isinstance(self.fallback, ExternalGenAIProvider):
                        return self.fallback.reviewer_rows(ensemble_rows)
                    return self.fallback.reviewer_rows(ensemble_rows)
            output.append(reviewer_output_row(row, provider.name, provider.reviewer_explanation(row)))
        return output


class GeminiProvider(ExternalGenAIProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, fallback: GenAIProvider) -> None:
        super().__init__(GenAIProviderMetadata("gemini", "gemini", "success"))
        self.api_key = api_key
        self.model = model
        self.fallback = fallback

    def complete(self, prompt: str, max_tokens: int) -> str:
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens},
        }
        data = _post_json(
            GEMINI_GENERATE_CONTENT_URL.format(model=self.model),
            {"Content-Type": "application/json", "x-goog-api-key": self.api_key},
            payload,
        )
        candidates = data.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no generated content")
        content = candidates[0].get("content") or {}
        parts = content.get("parts") or []
        text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
        if not text:
            raise RuntimeError("Gemini returned no generated content")
        return text


class GroqProvider(ExternalGenAIProvider):
    name = "groq"

    def __init__(self, api_key: str, model: str, fallback: GenAIProvider | None = None, requested_provider: str = "groq") -> None:
        super().__init__(GenAIProviderMetadata(requested_provider, "groq", "success"))
        self.api_key = api_key
        self.model = model
        self.fallback = fallback or TemplateGenAIProvider()

    def complete(self, prompt: str, max_tokens: int) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You write concise, factual LMS climate data quality reporting text."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
        data = _post_json(
            GROQ_CHAT_COMPLETIONS_URL,
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"},
            payload,
        )
        return str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


def select_groq_or_template() -> GenAIProvider:
    api_key = os.getenv("GROQ_API_KEY", "")
    if api_key:
        return GroqProvider(api_key, os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL))
    return TemplateGenAIProvider()


def select_provider(mode: str | None = None) -> GenAIProvider:
    selected = (mode or os.getenv("LMS_GENAI_PROVIDER") or "template").strip().lower()
    if selected == "disabled":
        return DisabledGenAIProvider()
    if selected == "gemini":
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        fallback = select_groq_or_template()
        if gemini_key:
            return GeminiProvider(gemini_key, os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL), fallback)
        fallback.metadata = GenAIProviderMetadata("gemini", fallback.name, "fallback", "GEMINI_API_KEY is not configured")
        return fallback
    if selected == "groq":
        provider = select_groq_or_template()
        if provider.name != "groq":
            provider.metadata = GenAIProviderMetadata("groq", provider.name, "fallback", "GROQ_API_KEY is not configured")
        return provider
    if selected == "microsoft_copilot":
        base_url = os.getenv("COPILOT_API_BASE_URL", "")
        api_key = os.getenv("COPILOT_API_KEY", "")
        tenant_id = os.getenv("COPILOT_TENANT_ID", "")
        if base_url and api_key:
            return MicrosoftCopilotProvider(base_url, api_key, tenant_id)
        return TemplateGenAIProvider(GenAIProviderMetadata("microsoft_copilot", "template", "fallback", "COPILOT_API_BASE_URL or COPILOT_API_KEY is not configured"))
    return TemplateGenAIProvider()


def safe_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else "{}"


def reviewer_output_row(row: Dict[str, str], provider_name: str, explanation: str) -> Dict[str, str]:
    return {
        "provider": provider_name,
        "stationId": row.get("stationId", ""),
        "observationDatetime": row.get("observationDatetime", ""),
        "elementCode": row.get("elementCode", ""),
        "finalDecision": row.get("finalDecision", row.get("outcome", "")),
        "severity": row.get("severity", ""),
        "confidence": row.get("confidence", ""),
        "explanation": explanation,
    }


def build_template_reviewer_rows(provider: GenAIProvider, ensemble_rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    return [reviewer_output_row(row, provider.name, provider.reviewer_explanation(row)) for row in ensemble_rows]


def build_reviewer_rows(provider: GenAIProvider, ensemble_rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    return provider.reviewer_rows(ensemble_rows)


def generate_genai_outputs(mode: str | None = None) -> GenAIProviderMetadata:
    provider = select_provider(mode)
    ensemble_rows = read_csv(ENSEMBLE_PREDICTIONS_FILE) if ENSEMBLE_PREDICTIONS_FILE.exists() else []
    report_json = safe_text(MODEL_EVALUATION_SUMMARY_JSON)
    summary = provider.executive_summary(report_json)
    reviewer_rows = build_reviewer_rows(provider, ensemble_rows)
    if provider.metadata.status == "fallback" and provider.metadata.effectiveProvider != provider.name:
        summary = provider.fallback.executive_summary(report_json) if isinstance(provider, ExternalGenAIProvider) else provider.executive_summary(report_json)
    GENAI_MODEL_SUMMARY_FILE.write_text(summary, encoding="utf-8")
    write_csv(GENAI_REVIEWER_EXPLANATIONS_FILE, reviewer_rows, GENAI_EXPLANATION_FIELDS)
    return provider.metadata
