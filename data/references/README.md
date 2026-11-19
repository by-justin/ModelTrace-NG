# Reference answers collected through OpenRouter

Each file holds answers to the 36-prompt suite (`pipeline/suite.py`), one JSON object per line,
collected with `python -m pipeline.collect run` and copied here with `python -m pipeline.collect slim`.

- Every row records the pinned route (`openrouter_provider_tag`), the model that answered
  (`response_model`), reasoning effort and sampling settings, usage and cost.
- Prompts are not stored: `challenge_id` identifies the prompt and `pipeline.suite` regenerates it.
- Rejected answers keep their metadata and quality reasons but only the first 2,000 characters of text.
- Labels containing `@api`, `@vertex` or `@aistudio` are copies of a model from another route or host,
  kept for comparison; `pipeline/config.json` decides which rows enter the bank.

The two older files in `data/` were collected before this pipeline: `gpt_reference.jsonl` through the
official Codex subscription and `claude_reference.jsonl` through the reseller OAIPro (marked `reseller`
in the bank until checked against an official source).
