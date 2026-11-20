# Reference records

Answers to the 36-prompt suite (`pipeline/suite.py`), one file per model label and collection route:

```text
data/records/<vendor>/<label>/<route>.jsonl
```

- **vendor** — `openai`, `anthropic`, `google`, … (from `pipeline/config.json`).
- **label** — the model as collected. A suffix marks a copy from another route or host kept for
  comparison (`@api…`, `@vertex`, `@aistudio`) or a compressed host (`@fp8`); `pipeline/config.json`
  decides which labels enter the bank and which are merged.
- **route** — how the answers were obtained: `openrouter-<provider tag>` (e.g. `openrouter-openai-flex`,
  `openrouter-google-vertex-global`), `codex-subscription` (official OpenAI Codex subscription) or
  `anthropic-api` (Anthropic's own API, through Message Batches).

Each line is one answer, in collection order, with at least: `label`, `vendor`, `route`,
`provider_name`, `condition_id`, `challenge_id`, `requested_count`, `parsed_count`, `text`,
`quality_reasons` and `collected_at`. OpenRouter rows also record the provider tag, the model that
answered, reasoning effort and sampling settings, usage and cost.

- An answer is valid when `quality_reasons` holds nothing but `count_ratio_*` entries. The first
  valid answer per prompt is the one used.
- Prompts are not stored; `challenge_id` identifies the prompt and `pipeline.suite` regenerates it.
- Rejected answers keep only their first 2,000 characters.
- Rows collected before this pipeline carry `legacy_validity: true` (their validity is the old
  "enough numbers" rule).

Add or refresh records with `python -m pipeline.collect import staging/<file>.jsonl`; files for
the label/route groups in the input are rewritten, others are left alone.
