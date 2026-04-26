from __future__ import annotations

from typing import Dict


class LMSExplanationProvider:
    """Boundary for future Copilot/OpenAI-compatible explanation providers.

    Prediction stays model-driven. This provider only explains existing model
    outputs for QC reviewers.
    """

    def explain(self, prediction: Dict[str, object]) -> str:
        return (
            f"{prediction.get('modelName')} flagged {prediction.get('elementName')} "
            f"at {prediction.get('stationName')} on {prediction.get('observationDatetime')} "
            f"with outcome {prediction.get('outcome')}. Review the source CSV and nearby days."
        )


DEFAULT_EXPLANATION_PROVIDER = LMSExplanationProvider()
