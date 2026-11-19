"""Write golden test cases for the Go core: reference-scorer outputs on fixed inputs.

    python -m pipeline.golden     # reads data/bank/bank.json, writes core/trace/testdata/golden.json

The Go tests load data/bank/bank.fb and must reproduce these outputs.
"""
from __future__ import annotations

import json

import numpy as np

from .references import ROOT, load_rows
from .scoring import analyze

OUT = ROOT / "core" / "trace" / "testdata" / "golden.json"


def cases() -> list[dict]:
    rows, _ = load_rows()
    by_model: dict[str, list[dict]] = {}
    for r in rows:
        by_model.setdefault(r["member"], []).append(r)
    out = []
    for i, (label, items) in enumerate(sorted(by_model.items())):
        env = sorted({r["condition_id"] for r in items})[i % 12]
        triple = [r for r in items if r["condition_id"] == env][:3]
        replies = [{"text": r["text"], "expected_count": r["requested_count"]} for r in triple]
        out.append({"name": f"{label} three replies ({env})", "replies": replies})
        out.append({"name": f"{label} one reply", "replies": replies[:1]})
    out += [
        {"name": "empty", "replies": [{"text": "", "expected_count": 300}]},
        {"name": "too short", "replies": [{"text": "12, 45, 300, 7", "expected_count": 300}]},
        {"name": "letters split runs", "replies": [{"text": "Here: " + ", ".join(str((i * 37) % 355 + 1) for i in range(120))
                                                     + " and then 1 2 3", "expected_count": 120}]},
        {"name": "out of range and full-width digits ignored",
         "replies": [{"text": " ".join(str((i * 53) % 400) for i in range(200)) + " １２３", "expected_count": 180}]},
    ]
    return out


def main() -> None:
    bank = json.loads((ROOT / "data" / "bank" / "bank.json").read_text(encoding="utf-8"))
    results = []
    for case in cases():
        result = analyze(case["replies"], bank)
        results.append({**case, "expected": {
            k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in result.items()}})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"bank_version": bank["version"], "cases": results}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(results)} cases -> {OUT}")


if __name__ == "__main__":
    main()
