"""Family (vendor) classifier: multinomial logistic regression over both feature blocks.

It is trained on families, not models, so it also places versions that are not in the bank,
which the model-level scorer can only map to the nearest known model. The reported family
probability averages it with the model probabilities summed per family (pipeline.scoring).
"""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression

from .features import combined_feature

C = 0.02  # strong regularisation: 36-108 answers per model, 429 features


def feature(row: dict) -> np.ndarray:
    if "_c" not in row:  # cached: evaluation refits the classifier ~70 times
        row["_c"] = combined_feature(row["numbers"], row["counts"])
    return row["_c"]


def _features(rows: list[dict]) -> np.ndarray:
    return np.stack([feature(r) for r in rows])


def fit(rows: list[dict], families: list[str]) -> dict:
    x = _features(rows)
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-12] = 1.0
    y = np.asarray([families.index(r["family_id"]) for r in rows])
    clf = LogisticRegression(C=C, max_iter=5000).fit((x - mean) / scale, y)
    coef = np.zeros((len(families), x.shape[1]))
    intercept = np.full(len(families), -1e3)  # a family absent from training never wins
    for row, cls in enumerate(clf.classes_):
        coef[cls], intercept[cls] = clf.coef_[row], clf.intercept_[row]
    return {"mean": mean, "scale": scale, "coef": coef, "intercept": intercept}


def logits(feature: np.ndarray, model: dict) -> np.ndarray:
    x = (feature - np.asarray(model["mean"])) / np.asarray(model["scale"])
    return np.asarray(model["coef"]) @ x + np.asarray(model["intercept"])
