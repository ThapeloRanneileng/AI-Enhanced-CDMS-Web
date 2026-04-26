from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Sequence, Tuple


ENSEMBLE_FIELDS = [
    "stationId", "stationName", "district", "stationType", "observationDatetime", "elementCode", "elementName", "value", "unit",
    "contributingModels", "modelAgreementCount", "modelAgreementRatio", "agreeingModels", "anomalyScore", "confidence", "severity", "finalDecision", "outcome",
    "explanation", "recommendedReviewerAction",
]


def key_for(row: Dict[str, object]) -> Tuple[str, str, str]:
    return (str(row["stationId"]), str(row["observationDatetime"]), str(row["elementCode"]))


def ensemble_predictions(model_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    grouped: Dict[Tuple[str, str, str], List[Dict[str, object]]] = defaultdict(list)
    for row in model_rows:
        grouped[key_for(row)].append(row)

    output: List[Dict[str, object]] = []
    for rows in grouped.values():
        first = rows[0]
        flagged = [row for row in rows if row["outcome"] in {"SUSPECT", "FAILED"}]
        failed = [row for row in rows if row["outcome"] == "FAILED"]
        agreement_count = len(flagged)
        contributing_models = [str(row["modelName"]) for row in rows]
        agreement_ratio = agreement_count / len(rows) if rows else 0.0
        if agreement_count == 0:
            outcome, severity, confidence = "NORMAL", "LOW", "0.50"
        elif agreement_count == 1:
            outcome = "FAILED" if failed and float(failed[0]["anomalyScore"]) >= 4 else "SUSPECT"
            severity, confidence = ("HIGH", "0.80") if outcome == "FAILED" else ("MEDIUM", "0.65")
        elif agreement_count == 2:
            outcome, severity, confidence = ("FAILED", "HIGH", "0.85") if failed else ("SUSPECT", "MEDIUM", "0.75")
        else:
            outcome, severity, confidence = ("FAILED", "HIGH", "0.95") if failed else ("SUSPECT", "HIGH", "0.90")
        output.append({
            "stationId": first["stationId"],
            "stationName": first["stationName"],
            "district": first["district"],
            "stationType": first["stationType"],
            "observationDatetime": first["observationDatetime"],
            "elementCode": first["elementCode"],
            "elementName": first["elementName"],
            "value": first["value"],
            "unit": first["unit"],
            "contributingModels": ";".join(contributing_models),
            "modelAgreementCount": agreement_count,
            "modelAgreementRatio": f"{agreement_ratio:.6f}",
            "agreeingModels": ";".join(str(row["modelName"]) for row in flagged),
            "anomalyScore": max((float(row["anomalyScore"]) for row in flagged), default=0.0),
            "confidence": confidence,
            "severity": severity,
            "finalDecision": outcome,
            "outcome": outcome,
            "explanation": f"{agreement_count} model(s) flagged this observation; ensemble outcome is {outcome}.",
            "recommendedReviewerAction": "Review LMS source record and nearby daily sequence." if outcome != "NORMAL" else "No reviewer action required.",
        })
    return output
