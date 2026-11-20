"""Write golden test cases for the Go core: reference-scorer outputs on fixed inputs.

    python -m pipeline.golden          # reads data/bank/bank.json, writes core/trace/testdata/golden.json
    python -m pipeline.golden --check  # verify the committed file still matches the bank (used in CI)

The Go tests load data/bank/bank.fb and must reproduce these outputs. --check compares discrete
results exactly and numbers within TOLERANCE, because numpy's last digits differ between platforms.
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np

from .references import ROOT, load_rows
from .scoring import analyze

OUT = ROOT / "core" / "trace" / "testdata" / "golden.json"
TOLERANCE = 1e-9


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
        {
            "name": "letters split runs",
            "replies": [
                {
                    "text": "Here: " + ", ".join(str((i * 37) % 355 + 1) for i in range(120)) + " and then 1 2 3",
                    "expected_count": 120,
                }
            ],
        },
        {
            "name": "out of range and full-width digits ignored",
            "replies": [{"text": " ".join(str((i * 53) % 400) for i in range(200)) + " １２３", "expected_count": 180}],
        },
    ]
    return out


def compute() -> dict:
    bank = json.loads((ROOT / "data" / "bank" / "bank.json").read_text(encoding="utf-8"))
    results = []
    for case in cases():
        result = analyze(case["replies"], bank)
        results.append(
            {**case, "expected": {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in result.items()}}
        )
    return {"bank_version": bank["version"], "cases": results}


def _differences(want, got, path: str = "") -> list[str]:
    if isinstance(want, float) or isinstance(got, float):
        ok = (
            isinstance(want, int | float)
            and isinstance(got, int | float)
            and math.isclose(want, got, rel_tol=TOLERANCE, abs_tol=TOLERANCE)
        )
        return [] if ok else [f"{path}: {want!r} != {got!r}"]
    if isinstance(want, dict) and isinstance(got, dict):
        if want.keys() != got.keys():
            return [f"{path}: keys differ"]
        return [d for k in want for d in _differences(want[k], got[k], f"{path}.{k}")]
    if isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            return [f"{path}: length {len(want)} != {len(got)}"]
        return [d for i, (a, b) in enumerate(zip(want, got, strict=True)) for d in _differences(a, b, f"{path}[{i}]")]
    return [] if want == got else [f"{path}: {want!r} != {got!r}"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare with the committed file instead of writing it")
    fresh = compute()
    if parser.parse_args().check:
        differences = _differences(json.loads(OUT.read_text(encoding="utf-8")), fresh)
        for line in differences[:20]:
            print(line)
        if differences:
            sys.exit(f"{len(differences)} differences: rerun python -m pipeline.golden and commit the result")
        print(f"{len(fresh['cases'])} golden cases match the bank")
        return
    results = fresh["cases"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fresh, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(results)} cases -> {OUT}")


if __name__ == "__main__":
    main()
