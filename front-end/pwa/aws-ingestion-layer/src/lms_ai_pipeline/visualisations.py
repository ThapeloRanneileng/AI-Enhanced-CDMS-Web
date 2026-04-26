from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Sequence

from .config import (
    AUTOENCODER_HISTORY_FILE,
    ENSEMBLE_PREDICTIONS_FILE,
    TEST_SPLIT_FILE,
    TRAIN_SPLIT_FILE,
    VISUALISATIONS_DIR,
)
from .io import read_csv


def safe_read_csv(path: Path) -> List[Dict[str, str]]:
    return read_csv(path) if path.exists() else []


def save_bar_chart(counts: Dict[str, int], title: str, xlabel: str, ylabel: str, path: Path, rotate: bool = False) -> None:
    import matplotlib.pyplot as plt

    path.parent.mkdir(parents=True, exist_ok=True)
    labels = list(counts.keys())
    values = list(counts.values())
    fig, ax = plt.subplots(figsize=(max(8, min(16, len(labels) * 0.7)), 5))
    ax.bar(labels, values)
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    if rotate:
        ax.tick_params(axis="x", labelrotation=45)
        for label in ax.get_xticklabels():
            label.set_horizontalalignment("right")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def decision_field(rows: Sequence[Dict[str, str]]) -> str:
    return "finalDecision" if rows and "finalDecision" in rows[0] else "outcome"


def anomaly_rows(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    field = decision_field(rows)
    return [row for row in rows if row.get(field) in {"SUSPECT", "FAILED"}]


def top_counts(rows: Sequence[Dict[str, str]], field: str, limit: int = 20) -> Dict[str, int]:
    return dict(Counter(row.get(field, "") for row in rows).most_common(limit))


def station_train_test_counts(train_rows: Sequence[Dict[str, str]], test_rows: Sequence[Dict[str, str]]) -> Dict[str, int]:
    counts: Dict[str, int] = defaultdict(int)
    for row in list(train_rows) + list(test_rows):
        counts[row.get("stationId", "")] += 1
    return dict(Counter(counts).most_common(20))


def generate_autoencoder_loss_curve(history_rows: Sequence[Dict[str, str]], output_path: Path) -> None:
    if not history_rows:
        return
    import matplotlib.pyplot as plt

    epochs = [int(row["epoch"]) for row in history_rows]
    loss = [float(row["loss"]) for row in history_rows if row.get("loss") != ""]
    val_loss = [float(row["validationLoss"]) for row in history_rows if row.get("validationLoss") != ""]
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(epochs[: len(loss)], loss, label="loss")
    if val_loss:
        ax.plot(epochs[: len(val_loss)], val_loss, label="validation loss")
    ax.set_title("Autoencoder Loss Curve")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Mean Squared Error")
    ax.legend()
    fig.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path)
    plt.close(fig)


def generate_visualisations() -> List[Path]:
    ensemble = safe_read_csv(ENSEMBLE_PREDICTIONS_FILE)
    train_rows = safe_read_csv(TRAIN_SPLIT_FILE)
    test_rows = safe_read_csv(TEST_SPLIT_FILE)
    history_rows = safe_read_csv(AUTOENCODER_HISTORY_FILE)
    anomalies = anomaly_rows(ensemble)
    field = decision_field(ensemble)

    outputs = [
        VISUALISATIONS_DIR / "model_decision_distribution.png",
        VISUALISATIONS_DIR / "station_anomaly_counts_top20.png",
        VISUALISATIONS_DIR / "element_anomaly_counts.png",
        VISUALISATIONS_DIR / "model_agreement_distribution.png",
        VISUALISATIONS_DIR / "train_test_rows_by_station_top20.png",
    ]
    save_bar_chart(Counter(row.get(field, "") for row in ensemble), "Model Decision Distribution", "Decision", "Rows", outputs[0])
    save_bar_chart(top_counts(anomalies, "stationId", 20), "Station Anomaly Counts - Top 20", "Station", "Anomalies", outputs[1], rotate=True)
    save_bar_chart(top_counts(anomalies, "elementCode", 20), "Element Anomaly Counts", "Element", "Anomalies", outputs[2])
    save_bar_chart(Counter(row.get("modelAgreementCount", "") for row in ensemble), "Model Agreement Distribution", "Agreement Count", "Rows", outputs[3])
    save_bar_chart(station_train_test_counts(train_rows, test_rows), "Train/Test Rows by Station - Top 20", "Station", "Rows", outputs[4], rotate=True)
    if history_rows:
        loss_path = VISUALISATIONS_DIR / "autoencoder_loss_curve.png"
        generate_autoencoder_loss_curve(history_rows, loss_path)
        outputs.append(loss_path)
    return outputs
