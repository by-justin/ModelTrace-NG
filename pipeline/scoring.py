"""Reference scorer: the Python twin of core/trace (Go), used for calibration and golden tests.

A bank is the dict written by pipeline.build (see data/bank/bank.json).
"""
from __future__ import annotations

import math

import numpy as np

from .features import hellinger_feature, ordered_block_feature
from .parsing import count_numbers, minimum_numbers, parse_numbers


def standardize(values) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    return (values - values.mean()) / max(float(values.std()), 1e-12)


def softmax(values) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    weights = np.exp(values - values.max())
    return weights / weights.sum()


def _project(feature: np.ndarray, block: dict) -> np.ndarray:
    """Standardize, remove the prompt-setup directions, scale to unit length."""
    x = (feature - np.asarray(block["mean"])) / np.asarray(block["scale"])
    basis = np.asarray(block["basis"], dtype=np.float64).reshape(-1, x.size)
    if basis.size:
        x = x - (x @ basis.T) @ basis
    return x / max(float(np.linalg.norm(x)), 1e-12)


def reply_scores(numbers: list[int], bank: dict) -> dict:
    """Per-model scores for one reply.

    fused: z-scored similarity used for the model probabilities.
    raw:   unscaled cosine similarity (0.75 value histogram + 0.25 ordered), used by the known-model check.
    """
    hellinger, ordered = bank["hellinger"], bank["ordered"]
    weight = float(bank["ordered_weight"])
    models = len(bank["models"])

    h_proj = _project(hellinger_feature(count_numbers(numbers)), hellinger)
    h_raw = np.asarray(hellinger["centroids"]).reshape(models, -1) @ h_proj

    o_feature = ordered_block_feature(numbers)
    o_std = (o_feature - np.asarray(ordered["mean"])) / np.asarray(ordered["scale"])
    o_unit = o_std / max(float(np.linalg.norm(o_std)), 1e-12)
    env = np.asarray(ordered["env_centroids"]).reshape(-1, models, o_unit.size)
    template = standardize(np.max(env @ o_unit, axis=0))
    o_proj = _project(o_feature, ordered)
    o_raw = np.asarray(ordered["centroids"]).reshape(models, -1) @ o_proj
    ordered_score = standardize(0.5 * template + 0.5 * standardize(o_raw))

    fused = (1.0 - weight) * standardize(h_raw) + weight * ordered_score
    raw = (1.0 - weight) * h_raw + weight * o_raw
    return {"fused": fused, "raw": raw}


TIERS = ("none", "match", "family", "uncertain", "unknown")


def low_fit(used: int, known: float, bank: dict) -> bool:
    """The closest model fits worse than ~99% of genuine held-out answers."""
    return used > 0 and known < float(bank["unknown_threshold"][min(used, 3) - 1])


def tier(used: int, top_prob: float, family_prob: float, known: float, bank: dict) -> str:
    """Verdict level. Anything but "match" asks the user to say which model it was.

    A weak fit alone never hides a clear vendor: it turns a would-be match into "family"
    (likely an unlisted version of that vendor), and only a weak fit with no clear vendor is
    "unknown" — unsure by a wide margin.
    """
    if used == 0:
        return "none"
    vendor_clear = family_prob >= float(bank["tier_family"])
    if low_fit(used, known, bank):
        return "family" if vendor_clear else "unknown"
    if top_prob >= float(bank["tier_match"]):
        return "match"
    return "family" if vendor_clear else "uncertain"


def bank_family_index(bank: dict, model: dict) -> int:
    return [f["id"] for f in bank["families"]].index(model["family"])


def family_logits(numbers: list[int], bank: dict) -> np.ndarray:
    model = bank["family_model"]
    x = np.concatenate([hellinger_feature(count_numbers(numbers)), ordered_block_feature(numbers)])
    x = (x - np.asarray(model["mean"])) / np.asarray(model["scale"])
    coef = np.asarray(model["coef"]).reshape(len(bank["families"]), -1)
    return coef @ x + np.asarray(model["intercept"])


def analyze(replies: list[dict], bank: dict) -> dict:
    """Score up to three replies ({"text", "expected_count"}) against the bank."""
    diagnostics, accepted, family_scores = [], [], []
    for reply in replies:
        numbers = parse_numbers(str(reply.get("text", "")))
        minimum = minimum_numbers(int(reply.get("expected_count") or 0))
        ok = len(numbers) >= minimum
        diagnostics.append({"parsed": len(numbers), "minimum": minimum, "accepted": ok, "top": -1})
        if ok:
            accepted.append(reply_scores(numbers, bank))
            family_scores.append(family_logits(numbers, bank))
            diagnostics[-1]["top"] = int(np.argmax(accepted[-1]["fused"]))
    if not accepted:
        return {"used": 0, "tier": "none", "diagnostics": diagnostics}

    used = len(accepted)
    probs = softmax(float(bank["beta"][min(used, 3) - 1]) * np.mean([s["fused"] for s in accepted], axis=0))
    family_of = np.asarray([bank_family_index(bank, m) for m in bank["models"]])
    from_models = np.bincount(family_of, weights=probs, minlength=len(bank["families"]))
    family_probs = 0.5 * softmax(np.mean(family_scores, axis=0)) + 0.5 * from_models
    known = float(np.max(np.mean([s["raw"] for s in accepted], axis=0)))
    top, family_top = int(np.argmax(probs)), int(np.argmax(family_probs))
    return {
        "used": used, "probs": probs, "top": top,
        "family_probs": family_probs, "family_top": family_top, "known": known,
        "low_fit": low_fit(used, known, bank),
        "tier": tier(used, float(probs[top]), float(family_probs[family_top]), known, bank),
        "diagnostics": diagnostics,
    }


def log_loss_beta(records: list[tuple[np.ndarray, int]]) -> float:
    """Softmax temperature with the lowest log loss over (scores, truth) records."""
    best_beta, best_loss = 1.0, math.inf
    for step in range(801):
        beta = math.exp(math.log(0.05) + step * (math.log(12.0) - math.log(0.05)) / 800)
        loss = 0.0
        for scores, truth in records:
            scaled = beta * scores
            peak = float(scaled.max())
            loss += peak + math.log(float(np.exp(scaled - peak).sum())) - float(scaled[truth])
        loss /= len(records)
        if loss < best_loss:
            best_beta, best_loss = beta, loss
    return best_beta
