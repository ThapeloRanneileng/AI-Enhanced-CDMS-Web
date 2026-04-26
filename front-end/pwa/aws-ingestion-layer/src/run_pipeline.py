"""Run the full AWS anomaly engine from ingestion to review queue."""

from __future__ import annotations

from pathlib import Path

try:
    from . import aws_anomaly_detection, aws_ingestion, aws_qc_handoff
except ImportError:
    import aws_anomaly_detection
    import aws_ingestion
    import aws_qc_handoff


BASE_DIR = Path(__file__).resolve().parents[1]
REVIEW_QUEUE_FILE = BASE_DIR / "outputs" / "aws_review_queue.csv"


def run_pipeline() -> int:
    """Run ingestion, QC handoff, anomaly detection, and final review output."""
    aws_ingestion.ingest_aws_data()
    aws_qc_handoff.prepare_qc_handoff()
    return aws_anomaly_detection.detect_anomalies(output_path=REVIEW_QUEUE_FILE)


def main() -> None:
    row_count = run_pipeline()
    print(f"Saved review-ready output to: {REVIEW_QUEUE_FILE}")
    print(f"Wrote {row_count} rows.")


if __name__ == "__main__":
    main()
