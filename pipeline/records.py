"""Reference records on disk: one JSONL file per model label and collection route.

    data/records/<vendor>/<label>/<route>.jsonl

Every line is one answer to one prompt of the 36-prompt suite, in collection order. Rows from
every source share these fields (others are kept as collected):

    label, vendor, route, provider_name, condition_id, nuisance_condition_id, challenge_id,
    requested_count, parsed_count, text, quality_reasons, collected_at

`quality_reasons` lists why an answer is not valid; reasons starting with "count_ratio" are
informational. Prompts are not stored (pipeline.suite regenerates them from challenge_id), and
rejected answers keep only their first characters.
"""

from __future__ import annotations

import collections
import json
from collections.abc import Iterable, Iterator
from pathlib import Path

from .parsing import minimum_numbers, parse_numbers

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ROOT / "data" / "records"
REJECTED_TEXT_CHARS = 2000
_DROP = ("prompt", "base_prompt", "system_prompt", "user_prefix", "source", "_provider")
_LEGACY = {  # providers of the two collections made before this pipeline
    "codex": ("codex-subscription", "Codex subscription"),
    "oaipro": ("oaipro-reseller", "OAIPro (reseller)"),
}


def hard_reasons(row: dict) -> list[str]:
    return [q for q in row.get("quality_reasons", []) if not q.startswith("count_ratio")]


def route_of(row: dict) -> tuple[str, str]:
    """(route slug, human-readable provider) for a collected row."""
    if row.get("route"):
        return row["route"], row.get("provider_name", row["route"])
    tag = row.get("openrouter_provider_tag")
    if tag:
        return "openrouter-" + tag.replace("/", "-"), "OpenRouter → " + str(row["provider"]).split(":", 1)[-1]
    provider = str(row.get("provider", "")).lower()
    if provider in _LEGACY:
        return _LEGACY[provider]
    raise ValueError(f"cannot tell the route of row {row.get('row_id')}")


def normalize(row: dict, vendor: str) -> dict:
    """Bring a collected row (any source) into the shared record format."""
    out = {k: v for k, v in row.items() if k not in _DROP}
    route, provider_name = route_of(row)
    numbers = parse_numbers(str(row.get("text", "")))
    if "quality_reasons" not in row:  # pre-pipeline rows: validity was strict_valid only
        out["quality_reasons"] = [] if row.get("strict_valid") else ["too_few_numbers"]
        out["legacy_validity"] = True
    out.update(
        {
            "label": row.get("label", row.get("source")),
            "vendor": vendor,
            "route": route,
            "provider_name": provider_name,
            "nuisance_condition_id": row.get("nuisance_condition_id", row["condition_id"]),
            "parsed_count": len(numbers),
            "minimum_numbers": minimum_numbers(int(row.get("requested_count") or 0)),
        }
    )
    if hard_reasons(out) and len(out.get("text", "")) > REJECTED_TEXT_CHARS:
        out["text"] = out["text"][:REJECTED_TEXT_CHARS]
        out["text_truncated"] = True
    return out


def path_of(record: dict, root: Path = RECORDS) -> Path:
    return root / record["vendor"] / record["label"] / f"{record['route']}.jsonl"


def write(records: Iterable[dict], root: Path = RECORDS) -> dict[Path, int]:
    """Write records grouped by file. Each file present in `records` is replaced entirely."""
    groups: dict[Path, list[dict]] = collections.defaultdict(list)
    for record in records:
        groups[path_of(record, root)].append(record)
    for path, items in groups.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
    return {path: len(items) for path, items in groups.items()}


def read_jsonl(path: Path) -> Iterator[dict]:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue  # a partially written line in a staging file


def iterate(root: Path = RECORDS) -> Iterator[dict]:
    """All records, file by file in path order, lines in collection order."""
    for path in sorted(root.glob("*/*/*.jsonl")):
        yield from read_jsonl(path)
