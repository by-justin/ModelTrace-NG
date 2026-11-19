"""Build the fingerprint bank from the reference answers.

    python -m pipeline.build            # writes data/bank/bank.json and data/bank/report.json

What is fitted (everything else is a fixed setting):
- per feature block: mean/scale, the top-2 prompt-setup directions (removed before comparing),
  and one unit-length average ("centroid") per model;
- softmax temperatures (beta) for 1, 2 and 3 replies, by leave-prompts-out cross-validation.
Per-model accuracy is measured by leaving one whole prompt setup out at a time.
"""
from __future__ import annotations

import argparse
import itertools
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .features import ALPHA, hellinger_feature, ordered_block_feature
from .parsing import MIN_NUMBERS, MIN_RATIO, VALUE_MAX
from .references import ROOT, load_config, load_rows
from .scoring import log_loss_beta, reply_scores

ORDERED_WEIGHT = 0.25
NUISANCE_RANK = 2
OUT_DIR = ROOT / "data" / "bank"

BRANDS = {"gpt": "GPT", "claude": "Claude", "gemini": "Gemini", "gemma": "Gemma", "deepseek": "DeepSeek",
          "muse": "Muse", "nemotron": "Nemotron", "ernie": "ERNIE", "north": "North", "lfm": "LFM",
          "ling": "Ling", "particle": "Particle", "flint": "Flint"}


def display_name(label: str, config: dict) -> str:
    if label in config["merge"]:
        return config["merge"][label]["display_name"]
    if label in config.get("display_names", {}):
        return config["display_names"][label]
    if label.startswith("gpt-oss"):
        return label
    parts = label.split("-")
    words: list[str] = []
    for part in parts[1:]:
        if words and words[-1].replace(".", "").isdigit() and part.isdigit():
            words[-1] += "." + part          # claude-opus-4-6 -> 4.6
        else:
            words.append(part)
    words = [w.upper() if re.fullmatch(r"a?\d+(\.\d+)?b", w) else "IT" if w == "it"
             else w if w[0].isdigit() else w.capitalize() for w in words]
    if parts[0] == "gpt" and words:
        return " ".join([f"GPT-{words[0]}"] + words[1:])
    return " ".join([BRANDS.get(parts[0], parts[0].title())] + words)


def _nuisance_basis(standardized: np.ndarray, groups: np.ndarray) -> np.ndarray:
    """Top directions along which the per-setup averages differ."""
    offsets = np.stack([standardized[groups == g].mean(axis=0) for g in np.unique(groups)])
    offsets -= offsets.mean(axis=0, keepdims=True)
    _, singular, right = np.linalg.svd(offsets, full_matrices=False)
    rank = min(NUISANCE_RANK, int(np.sum(singular > singular[0] * 1e-8))) if singular[0] else 0
    return right[:rank]


def _unit_rows(matrix: np.ndarray) -> np.ndarray:
    return matrix / np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)


def _feature(row: dict, key: str) -> np.ndarray:
    """Feature vectors are cached on the row; fitting runs ~100 times during calibration."""
    if key not in row:
        row["_h"] = hellinger_feature(row["counts"])
        row["_o"] = ordered_block_feature(row["numbers"])
    return row[key]


def fit_blocks(rows: list[dict], model_ids: list[str]) -> dict:
    labels = np.asarray([r["source"] for r in rows])
    groups = np.asarray([r["nuisance_condition_id"] for r in rows])
    envs = sorted({r["condition_id"] for r in rows})
    blocks = {}
    for name, raw in (("hellinger", np.stack([_feature(r, "_h") for r in rows])),
                      ("ordered", np.stack([_feature(r, "_o") for r in rows]))):
        mean, scale = raw.mean(axis=0), raw.std(axis=0)
        scale[scale < 1e-12] = 1.0
        standardized = (raw - mean) / scale
        basis = _nuisance_basis(standardized, groups)
        projected = standardized - (standardized @ basis.T) @ basis if basis.size else standardized
        block = {
            "mean": mean, "scale": scale, "basis": basis,
            "centroids": _unit_rows(np.stack([projected[labels == m].mean(axis=0) for m in model_ids])),
        }
        if name == "ordered":   # per-setup centroids without the projection, for the template score
            env_of = np.asarray([r["condition_id"] for r in rows])
            block["env_centroids"] = np.stack([
                _unit_rows(np.stack([standardized[(env_of == e) & (labels == m)].mean(axis=0) for m in model_ids]))
                for e in envs])
        blocks[name] = block
    return blocks


def _scoring_bank(blocks: dict, model_ids: list[str]) -> dict:
    return {"models": model_ids, "ordered_weight": ORDERED_WEIGHT, **blocks}


def calibrate(rows: list[dict], model_ids: list[str]) -> list[dict]:
    """beta per reply count, fitted on prompts held out of the bank fit."""
    out = []
    for query_count in (1, 2, 3):
        records = []
        for condition in sorted({r["condition_id"] for r in rows}):
            ids = sorted({r["challenge_id"] for r in rows if r["condition_id"] == condition})
            for held in itertools.combinations(ids, query_count):
                held_set = set(held)
                bank = _scoring_bank(fit_blocks([r for r in rows if r["challenge_id"] not in held_set], model_ids), model_ids)
                for truth, model_id in enumerate(model_ids):
                    mine = [r for r in rows if r["source"] == model_id and r["challenge_id"] in held_set]
                    # merged groups have several members per prompt: score one member's answers at a time
                    for member in sorted({r["member"] for r in mine}):
                        replies = [r for r in mine if r["member"] == member]
                        scores = np.mean([reply_scores(r["numbers"], bank)["fused"] for r in replies], axis=0)
                        records.append((scores, truth))
        beta = log_loss_beta(records)
        correct = sum(int(np.argmax(s)) == t for s, t in records)
        out.append({"queries": query_count, "beta": beta, "cv_accuracy": correct / len(records), "samples": len(records)})
        print(f"  calibration q{query_count}: beta {beta:.3f}, cv accuracy {correct / len(records):.3f} ({len(records)} tests)")
    return out


def leave_setup_out(rows: list[dict], model_ids: list[str]) -> dict:
    """Hold out one prompt setup at a time; record per-model hits and raw known-model scores."""
    per_model = {m: {"n1": 0, "h1": 0, "n3": 0, "h3": 0} for m in model_ids}
    known = {1: [], 2: [], 3: []}
    held_out = []   # (condition, model, member, scores) kept for later analyses
    for env in sorted({r["condition_id"] for r in rows}):
        bank = _scoring_bank(fit_blocks([r for r in rows if r["condition_id"] != env], model_ids), model_ids)
        for truth, model_id in enumerate(model_ids):
            mine = [r for r in rows if r["condition_id"] == env and r["source"] == model_id]
            for member in sorted({r["member"] for r in mine}):
                replies = [r for r in mine if r["member"] == member]
                scores = [reply_scores(r["numbers"], bank) for r in replies]
                for s in scores:
                    per_model[model_id]["n1"] += 1
                    per_model[model_id]["h1"] += int(np.argmax(s["fused"])) == truth
                    known[1].append(float(np.max(s["raw"])))
                if len(scores) >= 3:
                    fused = np.mean([s["fused"] for s in scores[:3]], axis=0)
                    per_model[model_id]["n3"] += 1
                    per_model[model_id]["h3"] += int(np.argmax(fused)) == truth
                    known[3].append(float(np.max(np.mean([s["raw"] for s in scores[:3]], axis=0))))
                    known[2].append(float(np.max(np.mean([s["raw"] for s in scores[:2]], axis=0))))
                held_out.append((env, model_id, member, replies))
    return {"per_model": per_model, "known": known, "held_out": held_out}


def build(config: dict | None = None) -> tuple[dict, dict, list, dict]:
    config = config or load_config()
    rows, dropped = load_rows(config)
    model_ids = list(dict.fromkeys(r["source"] for r in rows))
    print(f"{len(rows)} answers, {len(model_ids)} models; left out (incomplete): {dropped}")

    blocks = fit_blocks(rows, model_ids)
    calibration = calibrate(rows, model_ids)
    evaluation = leave_setup_out(rows, model_ids)

    families = [fid for fid in config["families"] if any(r["family_id"] == fid for r in rows)]
    models = []
    for model_id in model_ids:
        mine = [r for r in rows if r["source"] == model_id]
        hits = evaluation["per_model"][model_id]
        classes = sorted({r["route_class"] for r in mine})
        dates = sorted(r["collected_at"] for r in mine if r["collected_at"])
        models.append({
            "id": model_id,
            "display_name": display_name(model_id, config),
            "family": mine[0]["family_id"],
            "members": sorted({r["member"] for r in mine}),
            "source": next(c for c in ("official", "partner", "host", "reseller") if c in classes),
            "providers": sorted({r["provider"] for r in mine}),
            "collected": f"{dates[0]}..{dates[-1]}" if dates else "",
            "responses": len(mine),
            "acc1": hits["h1"] / max(hits["n1"], 1),
            "acc3": hits["h3"] / max(hits["n3"], 1),
        })

    now = datetime.now(timezone.utc)
    bank = {
        "schema": "modeltrace-bank/2",
        "version": now.strftime("%Y.%m.%d"),
        "built_at": now.isoformat(timespec="seconds"),
        "value_max": VALUE_MAX, "min_numbers": MIN_NUMBERS, "min_ratio": MIN_RATIO,
        "alpha": ALPHA, "ordered_weight": ORDERED_WEIGHT,
        "families": [{"id": fid, "name": config["families"][fid]["name"]} for fid in families],
        "models": models,
        "hellinger": blocks["hellinger"],
        "ordered": blocks["ordered"],
        "beta": [c["beta"] for c in calibration],
    }
    total = {k: sum(h[k] for h in evaluation["per_model"].values()) for k in ("n1", "h1", "n3", "h3")}
    report = {
        "models": len(model_ids), "answers": len(rows), "left_out": dropped,
        "calibration": calibration,
        "leave_setup_out": {"single": total["h1"] / total["n1"], "three": total["h3"] / total["n3"]},
    }
    return bank, report, rows, evaluation


def to_jsonable(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args()
    bank, report, _, _ = build()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "bank.json").write_text(json.dumps(to_jsonable(bank), ensure_ascii=False) + "\n", encoding="utf-8")
    (args.out / "report.json").write_text(json.dumps(to_jsonable(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(to_jsonable(report["leave_setup_out"])), "->", args.out)


if __name__ == "__main__":
    main()
