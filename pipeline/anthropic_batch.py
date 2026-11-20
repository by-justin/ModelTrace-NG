"""Collect the 36-prompt suite from Anthropic's own API with the Message Batches API (half price).

    ANTHROPIC_KEY_FILE=~/.anthropic-key uv run python -m pipeline.anthropic_batch \\
        --models claude-opus-4-6,claude-haiku-5-5 --out staging/anthropic.jsonl

One batch holds every prompt still missing a valid answer for every requested model. When it ends,
the answers are appended to the staging file (same row format as pipeline.collect) and prompts
whose answer is not valid go into the next round, up to --rounds rounds; the first valid answer
per prompt is the one used. Settings stay at the API's defaults (no temperature, no extended
thinking); max_tokens only caps runaway answers. Import afterwards with `mt import`.
The key is read from the file named by ANTHROPIC_KEY_FILE and never logged or stored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from . import records
from .collect import quality_reasons
from .parsing import parse_numbers
from .suite import fingerprint_suite

API = "https://api.anthropic.com/v1/messages/batches"
ROUTE = "anthropic-api"
PROVIDER_NAME = "Anthropic API (Message Batches)"
# USD per million tokens (input, output) at list price; batches are billed at half.
PRICES = {
    "claude-fable-5": (10, 50),
    "claude-fable-5-1": (10, 50),
    "claude-fable-5-2": (8, 40),
    "claude-opus-5-5": (4, 20),
    "claude-sonnet-4-6": (3, 15),
    "claude-sonnet-5": (2, 10),
    "claude-sonnet-5-5": (2, 10),
    "claude-haiku-4-5-20251001": (1, 5),
    "claude-haiku-5-5": (0.1, 0.5),
}
DEFAULT_PRICE = (5, 25)  # the Opus 4.x / 5 line


def _request(method: str, url: str, body: dict | None = None) -> bytes:
    key = Path(os.environ["ANTHROPIC_KEY_FILE"]).expanduser().read_text().strip()
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        return response.read()


def _cost(model: str, usage: dict) -> float:
    price_in, price_out = PRICES.get(model, DEFAULT_PRICE)
    tokens_in = usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
    return 0.5 * (tokens_in * price_in + usage.get("output_tokens", 0) * price_out) / 1e6


def _done(out: Path) -> set[tuple[str, str]]:
    if not out.exists():
        return set()
    return {
        (row["source"], row["challenge_id"])
        for row in records.read_jsonl(out)
        if row.get("route") == ROUTE and not records.hard_reasons(row)
    }


def _attempts(out: Path) -> dict[tuple[str, str], int]:
    counts: dict[tuple[str, str], int] = {}
    if out.exists():
        for row in records.read_jsonl(out):
            if row.get("route") == ROUTE:
                key = (row["source"], row["challenge_id"])
                counts[key] = counts.get(key, 0) + 1
    return counts


def _params(model: str, task: dict, max_tokens: int) -> dict:
    prompt = f"{task['user_prefix']}\n\nFinal task:\n{task['prompt']}" if task["user_prefix"] else task["prompt"]
    params = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
    if task["system"]:
        params["system"] = task["system"]
    return params


def _row(model: str, task: dict, message: dict, batch_id: str, custom_id: str, attempt: int, max_tokens: int) -> dict:
    text = "".join(block.get("text", "") for block in message.get("content", []) if block.get("type") == "text")
    numbers = parse_numbers(text)
    stop = message.get("stop_reason")
    finish = {"end_turn": "stop", "stop_sequence": "stop", "max_tokens": "length"}.get(stop, stop)
    quality = quality_reasons(numbers, task["expected_count"], finish)
    usage = message.get("usage") or {}
    return {
        "row_id": f"{task['condition']}-{secrets.token_hex(8)}",
        "source": model,
        "condition_id": task["condition"],
        "nuisance_condition_id": task["condition"],
        "challenge_id": task["challenge_id"],
        "wrapper_transport": task["transport"],
        "requested_count": task["expected_count"],
        "parsed_count": len(numbers),
        "provider": "anthropic",
        "route": ROUTE,
        "provider_name": PROVIDER_NAME,
        "requested_model": model,
        "response_model": message.get("model"),
        "batch_id": batch_id,
        "custom_id": custom_id,
        "reasoning_effort": "provider_default",
        "temperature": "provider_default",
        "max_tokens": max_tokens,
        "finish_reason": finish,
        "usage": {**usage, "cost": round(_cost(model, usage), 6)},
        "attempt": attempt,
        "count_ratio": len(numbers) / task["expected_count"],
        "quality_reasons": quality,
        "reference_valid": not [q for q in quality if not q.startswith("count_ratio")],
        "output_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "collected_at": datetime.now(UTC).isoformat(),
        "text": text,
    }


def run_round(
    models: list[str], out: Path, max_tokens: int, poll: int, only: set[str] | None = None
) -> tuple[int, int, float]:
    """Submit one batch for every missing (model, prompt); returns (requested, valid, cost)."""
    suite = {t["challenge_id"]: t for t in fingerprint_suite() if only is None or t["challenge_id"] in only}
    done, attempts = _done(out), _attempts(out)
    requests, meta = [], {}
    for model in models:
        for challenge_id, task in suite.items():
            if (model, challenge_id) in done:
                continue
            attempt = attempts.get((model, challenge_id), 0) + 1
            custom_id = f"{model}--{challenge_id}--a{attempt}"[:64]
            requests.append({"custom_id": custom_id, "params": _params(model, task, max_tokens)})
            meta[custom_id] = (model, task, attempt)
    if not requests:
        return 0, 0, 0.0
    batch = json.loads(_request("POST", API, {"requests": requests}))
    print(f"batch {batch['id']}: {len(requests)} requests submitted", flush=True)
    while batch.get("processing_status") != "ended":
        time.sleep(poll)
        batch = json.loads(_request("GET", f"{API}/{batch['id']}"))
        print(f"  {batch['processing_status']}: {batch.get('request_counts')}", flush=True)
    valid, cost, errors = 0, 0.0, {}
    with out.open("a", encoding="utf-8") as handle:
        for line in _request("GET", batch["results_url"]).decode().splitlines():
            item = json.loads(line)
            model, task, attempt = meta[item["custom_id"]]
            result = item["result"]
            if result["type"] != "succeeded":
                errors[result["type"]] = errors.get(result["type"], 0) + 1
                continue
            row = _row(model, task, result["message"], batch["id"], item["custom_id"], attempt, max_tokens)
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            valid += row["reference_valid"]
            cost += row["usage"]["cost"]
    print(f"batch {batch['id']} done: {valid}/{len(requests)} valid, ${cost:.2f}, not succeeded: {errors}", flush=True)
    return len(requests), valid, cost


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect the suite through Anthropic's Message Batches API.")
    parser.add_argument("--models", required=True, help="comma-separated Anthropic model ids")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=3, help="retry rounds for prompts without a valid answer")
    parser.add_argument("--max-tokens", type=int, default=8192)
    parser.add_argument("--poll", type=int, default=60, help="seconds between status checks")
    parser.add_argument("--tasks", default="all", help="'all' or comma-separated challenge ids (for a trial run)")
    args = parser.parse_args()
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    only = None if args.tasks == "all" else set(args.tasks.split(","))
    total = 0.0
    for round_number in range(1, args.rounds + 1):
        requested, valid, cost = run_round(models, args.out, args.max_tokens, args.poll, only)
        total += cost
        if not requested:
            break
        print(f"round {round_number}: {valid}/{requested} valid", flush=True)
    print(json.dumps({"models": len(models), "spend_usd": round(total, 2), "out": str(args.out)}))


if __name__ == "__main__":
    main()
