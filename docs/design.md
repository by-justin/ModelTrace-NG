# ModelTrace NG: intent and design decisions

This fork exists to keep ModelTrace useful as the model landscape moves: authentic fingerprints
for as many models as we can reach, a public site anyone can use without an account or a key,
an API agents can call, and a crowd channel that tells us where to look next. This document
records what we decided and why, so later changes can be weighed against the original reasons.

## Goals

1. **Answer "which model is really answering?"** for a chat app or API, from three lists of
   "random" integers, with an honest verdict when the model is not in the bank.
2. **Authentic fingerprints.** Reference answers come from the vendor's own route wherever
   possible, and every model states where its answers came from.
3. **Zero-friction public site.** Static, paste-only, works with no server.
4. **Agent-friendly API.** Stateless JSON, a public scoring endpoint, documentation an agent can
   follow on its own.
5. **Crowd data for discovery.** Users and agents can contribute samples; we use them to find
   unknown models, swaps and drift, not to train the bank.
6. **Keep it simple.** Clear boundaries, mature libraries, no defences beyond what the threat
   actually needs.

## Architecture

```text
pipeline/ (Python, offline)  →  data/bank/bank.fb  →  core/trace (Go, one pure function)
   collect · build · golden                              ├─ native  → backend/ (gin API)
                                                          └─ TinyGo  → web/ (static site, WebAssembly)
```

| Part | Decision | Why |
|---|---|---|
| Scorer | One pure Go function, `trace.Categorize(bank, replies)` | A single implementation for the browser and the API. Pure means safe to run on many goroutines and compilable by TinyGo. |
| Browser | TinyGo WebAssembly (`-target=wasm-unknown`), 26 KB | Same code as the server without shipping a JavaScript copy; small enough to load instantly. |
| Bank format | FlatBuffers (`schema/bank.fbs`), float32 | Mature, schema-first, generated readers for Python, Go and TypeScript; 322 KB instead of 1.7 MB of JSON. Parameters are rounded to float32 in Python too, so all implementations see the same numbers. |
| Parity | Python reference scorer + golden cases | `pipeline/scoring.py` stays the reference; Go (native and WebAssembly) must reproduce `core/trace/testdata/golden.json` to 1e-6. CI checks all three. |
| Site | React + Vite + TypeScript, hash routing, paste-only | Static hosting (GitHub Pages), nothing to leak, no CORS failures, works with any chat app. API testing from the browser was dropped on purpose. |
| API | Go + gin, stateless, OpenAPI + `llms.txt`, RFC 9457 errors | Minimal surface; mature router; agents read the contract and the guide. |
| Storage | Postgres (one table) or a JSONL file for development | Only crowd submissions are stored; the API holds no other state. |

The Flask app, its admin pages and browser enrollment were removed: collection is a command-line
job, and nothing in production needs a write path besides submissions.

## Scoring

- **Model probabilities:** the 355-value distribution and position-chunk features, standardized,
  with the top two prompt-setup directions removed, compared with one centroid per model;
  softmax with a temperature calibrated per reply count.
- **Family probabilities:** a logistic-regression vendor classifier averaged 50/50 with the model
  probabilities summed per vendor. The classifier places versions newer than the bank; the
  summed model probabilities are stronger on known models. Together: 99.4% vendor accuracy on
  held-out prompt setups and 76% on models left out entirely (three replies), versus 95.6% / 76.5%
  for the classifier alone.
- **Fit check:** the best unscaled similarity, against a threshold that 1% of genuine held-out
  answers fall below. It started at 5%, which flagged one genuine test in twenty and overrode
  clear results (a two-reply GPT-6 Astra test came back "unknown" at 99.5% / OpenAI 93.6%).
- **Verdict levels:** `match` (top model ≥ 0.80 and a normal fit), `family` (vendor ≥ 0.80),
  `uncertain`, `unknown`. A weak fit never hides a clear vendor: it turns a would-be match into
  `family` (probably an unlisted version of that vendor); only a weak fit with no clear vendor is
  `unknown`, matching "unsure by a wide margin". Anything but `match` asks the user which model
  it was.
- **Merge groups:** versions that cannot be told apart are one bank entry, reported together.
  Threshold in practice: pooled affinity around 0.998, the same as one model collected twice.
  Current groups: GPT-6 Astra + GPT-6.1 Sol; Gemini 3.7 Flash + 3.8 Flash.

We evaluated logistic regression, LDA and naive Bayes against the existing nearest-centroid
model scorer; none beat it on known models, so the core stayed and only the vendor classifier
and the known-model check were added.

## Reference data

- **Routes:** each model is pinned to one provider with no fallback. Official first (OpenAI,
  Anthropic, Google AI Studio or Vertex, NVIDIA, Baidu…), then the vendor's licensed cloud
  (partner), then a host running full-precision open weights. Compressed copies are labelled
  (`@fp8`). OpenAI "flex" is accepted: same model, lower price.
- **Provenance tiers** shown on the site: official, partner, third-party host, reseller.
- **Reseller data is untrusted.** The 10 original Claude models came from a reseller. They stay
  in the bank marked "reseller · unverified" until checked against an official route; matching
  sets are merged (72 answers), otherwise only the official set is kept. Claude on Vertex is not
  available to us, so the official route is Anthropic's own API.
- **Settings:** reasoning effort and sampling stay at the route's defaults (that is how users
  test), except where a model produces nothing at its default (lfm-3 runs at low effort).
  Open-weight models use the vendor's recommended sampling.
- **Completeness:** a model enters the bank only with all 36 suite prompts, covering the 12
  prompt setups three times each. Partial models degrade the prompt-setup correction for every
  model.
- **Validity:** an answer counts when it has at least max(80, 55% of the requested) numbers,
  finished normally and shows no counting pattern. The count ratio is recorded but never rejects:
  filtering a model's natural over- or under-production biases its fingerprint. Only the first
  valid answer per prompt is kept, so retries cannot cherry-pick.
- **Route checks done:** the Codex-collected and API-collected GPT-6 Astra are indistinguishable;
  GPT-6 Luna shifts measurably between Codex and the API but is still identified correctly;
  reasoning effort (low vs default) does not change the fingerprint.

## Crowd submissions

- `POST /v1/categorize` is public and unvalidated: scoring is cheap and nothing is stored.
- `POST /v1/submissions` stores a sample only with an **ALTCHA proof-of-work stamp bound to the
  exact request body**: the client hashes the body, asks `/v1/stamp?h=<sha256>`, solves the
  challenge in web workers and sends the same bytes. The hash sits inside the signed challenge,
  so a stamp is valid for one body; a unique salt makes it single use; it expires after 10
  minutes. The site solves it in the background without the user noticing.
- Stored with each sample: the body as sent (challenges, replies, verdict, optional user
  identification, a FingerprintJS browser fingerprint) plus the IP address, user agent and a few
  request headers recorded by the server.
- Failures never reach the user: no API configured, network errors or a busy server mean nothing
  is sent and nothing is shown.
- **Crowd data never trains the bank.** It shows where to look (unknown clusters, suspected swaps,
  drift); conclusions come from collecting the model through an official route ourselves.
- **Not over-defended on purpose:** no CAPTCHA, accounts or API keys. Proof of work makes bulk
  fakes cost something; edge rate limits and 429 load shedding protect the open endpoint.
  Anubis was considered and rejected: it gates whole sites with a visible interstitial, blocks
  agents and cannot sit in front of GitHub Pages.

## Known gaps and next steps

- **No held-out test set yet.** All accuracy figures are cross-validation over the 36-prompt
  suite; nothing was collected with the site's own test prompts. Planned: gather real-prompt
  answers per model, probably through crowd submissions verified against official collection,
  and use them as the release check.
- Re-check the reseller Claude models against Anthropic's API.
- Finish the models still collecting, rebuild the bank, regenerate golden cases.
- Possible later: the "where your answers land" map (needs a 2D projection stored in the bank),
  additional probe types alongside the number task, versioned banks with scheduled re-collection.
- The Codex plugin (ModelTrace Guard) was removed with its frozen bank and legacy JavaScript
  scorer; a future plugin should call the API or embed the Go core.
