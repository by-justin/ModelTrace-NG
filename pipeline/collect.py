"""Collect reference answers through OpenRouter with a pinned provider route.

    OPENROUTER_KEY_FILE=~/.openrouter-key python -m pipeline.collect run \\
        --model openai/gpt-6-luna --provider openai/flex --label gpt-6-luna \\
        --out staging/openrouter_gpt.jsonl --budget 0.5 [--effort low] [--temperature 1.0] [--top-p 1.0] [--top-k 64]

    python -m pipeline.collect import staging/openrouter_gpt.jsonl [more staging files…]

Rules (see pipeline/references.py for how rows are used):
- the provider is pinned (no fallbacks), reasoning effort and sampling stay at the route's defaults
  unless given, and every row records the route, the model that answered, usage and cost;
- an answer is valid when it has enough numbers, finished normally and shows no counting pattern;
  the count ratio is recorded but never rejects;
- a prompt counts as done only once it has a valid answer from the same route, so rerunning fills gaps.
The key is read from the file named by OPENROUTER_KEY_FILE and never logged or stored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from . import records
from .parsing import minimum_numbers, parse_numbers
from .references import family_of, load_config
from .suite import fingerprint_suite

URL = "https://openrouter.ai/api/v1/chat/completions"
RATIO_RANGE = (0.8, 1.2)
MAX_ATTEMPTS = 3


def pattern_reasons(numbers: list[int]) -> list[str]:
    reasons = []
    run = best = 1
    for i in range(2, len(numbers)):
        run = run + 1 if numbers[i] - numbers[i - 1] == numbers[i - 1] - numbers[i - 2] else 1
        best = max(best, run)
    if best >= 6:
        reasons.append(f"arithmetic_run_{best + 1}")
    seen = set()
    for i in range(len(numbers) - 19):
        key = tuple(numbers[i : i + 20])
        if key in seen:
            reasons.append("repeated_20gram")
            break
        seen.add(key)
    if numbers and (numbers == sorted(numbers) or numbers == sorted(numbers, reverse=True)):
        reasons.append("sorted")
    return reasons


def _call(body: dict) -> dict:
    key = Path(os.environ["OPENROUTER_KEY_FILE"]).expanduser().read_text().strip()
    request = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        return json.loads(response.read().decode())


def run(args: argparse.Namespace) -> None:
    suite = fingerprint_suite()
    tasks = suite if args.tasks == "all" else [t for t in suite if t["challenge_id"] in set(args.tasks.split(","))]
    done = set()
    if args.out.exists():
        for line in args.out.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (
                row["source"] == args.label
                and row.get("openrouter_provider_tag") == args.provider
                and not records.hard_reasons(row)
            ):
                done.add(row["challenge_id"])
    tasks = [t for t in tasks if t["challenge_id"] not in done]
    lock, spend = threading.Lock(), [0.0]
    stats = {"accepted": 0, "rejected": 0, "errors": 0}

    def one(task: dict) -> None:
        base_prompt = task["prompt"]
        prompt = f"{task['user_prefix']}\n\nFinal task:\n{base_prompt}" if task["user_prefix"] else base_prompt
        body = {
            "model": args.model,
            "messages": ([{"role": "system", "content": task["system"]}] if task["system"] else [])
            + [{"role": "user", "content": prompt}],
            "max_tokens": args.max_tokens,
            "provider": {"order": [args.provider], "allow_fallbacks": False, "require_parameters": True},
            "usage": {"include": True},
        }
        if args.effort:
            body["reasoning"] = {"effort": args.effort}
        for name in ("temperature", "top_p", "top_k"):
            if getattr(args, name) is not None:
                body[name] = getattr(args, name)
        attempt = rate_limited = 0
        while attempt < MAX_ATTEMPTS:
            attempt += 1
            with lock:
                if spend[0] >= args.budget:
                    return
            started = time.time()
            try:
                payload = _call(body)
            except urllib.error.HTTPError as error:
                if error.code == 429 and rate_limited < 10:
                    rate_limited, attempt = rate_limited + 1, attempt - 1
                    time.sleep(min(90, 10 * rate_limited))
                    continue
                print(f"  {task['challenge_id']} attempt {attempt}: HTTP {error.code}", flush=True)
                with lock:
                    stats["errors"] += 1
                if error.code in (400, 401, 402, 403, 404):
                    return
                time.sleep(3 * attempt)
                continue
            except Exception as error:  # network / timeout
                print(f"  {task['challenge_id']} attempt {attempt}: {error}", flush=True)
                time.sleep(3 * attempt)
                continue
            if not payload.get("choices"):
                time.sleep(3 * attempt)
                continue
            choice, usage = payload["choices"][0], payload.get("usage") or {}
            text = choice["message"].get("content") or ""
            numbers = parse_numbers(text)
            ratio = len(numbers) / task["expected_count"]
            finish = choice.get("finish_reason")
            quality = (
                (["too_few_numbers"] if len(numbers) < minimum_numbers(task["expected_count"]) else [])
                + ([] if RATIO_RANGE[0] <= ratio <= RATIO_RANGE[1] else [f"count_ratio_{ratio:.2f}"])
                + ([] if finish in ("stop", None) else [f"finish_{finish}"])
                + pattern_reasons(numbers)
            )
            row = {
                "row_id": f"{task['condition']}-{secrets.token_hex(8)}",
                "source": args.label,
                "condition_id": task["condition"],
                "nuisance_condition_id": task["condition"],
                "challenge_id": task["challenge_id"],
                "wrapper_transport": task["transport"],
                "requested_count": task["expected_count"],
                "parsed_count": len(numbers),
                "provider": f"openrouter:{payload.get('provider', args.provider)}",
                "openrouter_provider_tag": args.provider,
                "requested_model": args.model,
                "response_model": payload.get("model"),
                "generation_id": payload.get("id"),
                "reasoning_effort": args.effort or "provider_default",
                "temperature": args.temperature if args.temperature is not None else "provider_default",
                "top_p": args.top_p if args.top_p is not None else "provider_default",
                "top_k": args.top_k if args.top_k is not None else "provider_default",
                "max_tokens": args.max_tokens,
                "finish_reason": finish,
                "usage": usage,
                "byok": usage.get("is_byok"),
                "request_seconds": round(time.time() - started, 2),
                "attempt": attempt,
                "count_ratio": ratio,
                "quality_reasons": quality,
                "reference_valid": not [q for q in quality if not q.startswith("count_ratio")],
                "output_sha256": hashlib.sha256(text.encode()).hexdigest(),
                "collected_at": datetime.now(UTC).isoformat(),
                "text": text,
            }
            with lock:
                spend[0] += float(usage.get("cost") or 0.0)
                with args.out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                stats["accepted" if row["reference_valid"] else "rejected"] += 1
            print(
                f"  {task['challenge_id']}: {len(numbers)}/{task['expected_count']} "
                f"{'OK' if row['reference_valid'] else 'REJECT ' + ','.join(records.hard_reasons(row))}",
                flush=True,
            )
            if row["reference_valid"]:
                return

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(one, tasks))
    print(json.dumps({"label": args.label, **stats, "spend_usd": round(spend[0], 4), "already_done": len(done)}))


def import_records(paths: list[Path]) -> None:
    """Import staging files (raw collector output) into data/records.

    Rows are grouped by model label and route; each group's file under data/records is replaced
    with the group's rows in collection order (see pipeline.records for the format).
    """
    config = load_config()
    rows = [
        records.normalize(row, family_of(row.get("label", row.get("source")), config))
        for path in paths
        for row in records.read_jsonl(path)
    ]
    for path, count in sorted(records.write(rows).items()):
        print(f"{path.relative_to(records.ROOT)}: {count} rows")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect or import reference answers.")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="collect the 36-prompt suite for one model")
    r.add_argument("--model", required=True)
    r.add_argument("--provider", required=True, help="OpenRouter provider tag, e.g. openai/flex")
    r.add_argument("--label", required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--budget", type=float, required=True, help="stop issuing requests after this spend (USD)")
    r.add_argument("--effort", default=None)
    r.add_argument("--temperature", type=float, default=None)
    r.add_argument("--top-p", dest="top_p", type=float, default=None)
    r.add_argument("--top-k", dest="top_k", type=int, default=None)
    r.add_argument("--max-tokens", type=int, default=32000)
    r.add_argument("--tasks", default="all", help="'all' or comma-separated challenge ids")
    r.add_argument("--workers", type=int, default=4)
    i = sub.add_parser("import", help="import staging files into data/records")
    i.add_argument("paths", type=Path, nargs="+")
    args = parser.parse_args()
    run(args) if args.command == "run" else import_records(args.paths)


if __name__ == "__main__":
    main()
