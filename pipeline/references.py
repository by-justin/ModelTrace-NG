"""Load reference records (data/records, see pipeline.records) into bank rows, following
pipeline/config.json.

Rules, in order:
1. route_filter: for listed labels keep only rows from that OpenRouter provider tag.
2. Validity: a row is valid when no quality reason other than the count ratio applies
   (the count ratio is informational).
3. First valid answer per (label, prompt) wins, so retries cannot cherry-pick.
4. Labels marked comparison-only (e.g. "@vertex") are dropped unless they belong to a merge group.
5. Only complete labels are kept: 36 prompts covering all 12 prompt setups three times each, except
   labels listed under partial_coverage in the config.
6. Merge groups rename their members to the group label.
"""

from __future__ import annotations

import collections
import json
from pathlib import Path

from . import records
from .parsing import count_numbers, parse_numbers

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path(__file__).with_name("config.json")


def load_config(path: Path = CONFIG) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def family_of(label: str, config: dict) -> str:
    stem = label.split("-")[0]
    for family_id, family in config["families"].items():
        if stem in family["prefixes"]:
            return family_id
    raise ValueError(f"no family configured for label {label!r}")


def route_class(row: dict, family_id: str, config: dict) -> str:
    """official | partner | host — where this answer came from."""
    provider = str(row.get("provider") or "").lower()
    route = (row.get("openrouter_provider_tag") or provider).split("/")[0]
    if route in config["families"][family_id]["routes"]:
        return "official"
    if route in config["partner_routes"]:
        return "partner"
    return "host"


def load_rows(config: dict | None = None, root: Path = records.RECORDS) -> tuple[list[dict], dict]:
    config = config or load_config()
    alias = {member: group for group, spec in config["merge"].items() for member in spec["members"]}
    route_filter = {k: v for k, v in config["route_filter"].items() if not k.startswith("_")}
    markers = tuple(config["comparison_only_markers"])
    partial = {k for k in config.get("partial_coverage", {}) if not k.startswith("_")}

    chosen: dict[tuple[str, str], dict] = {}
    for row in records.iterate(root):
        label = row["label"]
        if label in route_filter and row.get("openrouter_provider_tag") != route_filter[label]:
            continue
        if label not in alias and any(marker in label for marker in markers):
            continue
        if records.hard_reasons(row) or (label, row["challenge_id"]) in chosen:
            continue
        chosen[(label, row["challenge_id"])] = row

    per_label = collections.defaultdict(list)
    for (label, _), row in chosen.items():
        per_label[label].append(row)

    rows, dropped = [], {}
    for label, items in per_label.items():
        envs = collections.Counter(r["condition_id"] for r in items)
        complete = len(items) == 36 and len(envs) == 12 and set(envs.values()) == {3}
        if not complete and label not in partial:
            dropped[label] = len(items)
            continue
        family_id = family_of(label, config)
        for row in items:
            numbers = parse_numbers(row["text"])
            rows.append(
                {
                    "source": alias.get(label, label),
                    "member": label,
                    "family_id": family_id,
                    "condition_id": row["condition_id"],
                    "nuisance_condition_id": row.get("nuisance_condition_id", row["condition_id"]),
                    "challenge_id": row["challenge_id"],
                    "requested_count": row.get("requested_count"),
                    "text": row["text"],
                    "numbers": numbers,
                    "counts": count_numbers(numbers),
                    "route_class": route_class(row, family_id, config),
                    "provider": row["provider_name"],
                    "collected_at": str(row.get("collected_at", ""))[:10],
                }
            )
    # a merge group is only kept when every member is complete
    for group, spec in config["merge"].items():
        if any(member in dropped for member in spec["members"] if member in per_label):
            rows = [r for r in rows if r["source"] != group]
            dropped[group] = "incomplete member"
    return rows, dropped
