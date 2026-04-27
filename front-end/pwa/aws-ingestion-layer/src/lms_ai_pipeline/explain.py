from __future__ import annotations

from typing import Dict


class LMSExplanationProvider:
    """Boundary for future Copilot/OpenAI-compatible explanation providers.

    Prediction stays model-driven. This provider only explains existing model
    outputs for QC reviewers.
    """

    def explain(self, prediction: Dict[str, object]) -> str:
        action = prediction.get("recommendedReviewerAction") or "Review the source CSV and nearby days before approval."
        return (
            f"Model {prediction.get('modelName')} outcome={prediction.get('outcome')} flagged {prediction.get('elementName')} "
            f"at {prediction.get('stationName')} on {prediction.get('observationDatetime')} "
            f"with anomaly score={prediction.get('anomalyScore')}. "
            f"Reason: {prediction.get('explanation', 'model score exceeded its review threshold')}. "
            f"Recommended reviewer action: {action}"
        )


DEFAULT_EXPLANATION_PROVIDER = LMSExplanationProvider()
