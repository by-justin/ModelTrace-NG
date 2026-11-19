# pipeline

Offline Python: collect reference answers, build the fingerprint bank, export it for the Go core.
Nothing here runs in production; the site and the API only read the files it writes to `data/bank/`.

```bash
python -m pip install -r pipeline/requirements.txt
python -m pipeline.build                      # data/bank/bank.json + report.json
```

| Module | Role |
|---|---|
| `suite.py` | The 36-prompt reference suite and the test-challenge generator |
| `collect.py` | `run`: collect the suite for one model through OpenRouter · `slim`: copy a staging file into `data/references/` |
| `references.py` | Load reference answers into bank rows (validity, first valid answer per prompt, merges, completeness) |
| `parsing.py`, `features.py` | Reply → numbers → feature vectors (mirrored in `core/trace`) |
| `scoring.py` | Reference scorer, the Python twin of the Go core |
| `build.py` | Fit the bank, calibrate it and measure per-model accuracy |
| `config.json` | Sources, families, merge groups, route filters |

## Adding a model

1. Collect all 36 prompts: `python -m pipeline.collect run --model … --provider … --label … --out staging/x.jsonl --budget 1`.
   Run it again until the summary shows nothing left; partial models are left out of the bank.
2. `python -m pipeline.collect slim staging/x.jsonl data/references/x.jsonl` and list the file in `config.json` if it is new.
3. `python -m pipeline.build` and check `data/bank/report.json`.

Two versions that cannot be told apart (pooled affinity around 0.998) go into `config.json` → `merge` as one group.
