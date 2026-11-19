# backend

Minimal, stateless REST API (Go, gin). It scores replies with the same `core/trace` code the
browser runs, and stores stamped crowd submissions.

```bash
go run ./cmd/api                                   # :8080, bank ../data/bank/bank.fb, submissions.jsonl
go test ./...                                      # + TEST_DATABASE_URL=postgres://… for the Postgres store
docker build -f backend/Dockerfile -t modeltrace-api ..   # from the repo root context
```

| Endpoint | |
|---|---|
| `POST /v1/categorize` | Public, unvalidated scoring; stores nothing. A bounded worker pool runs the pure `trace.Categorize`; when its queue is full the API answers 429 with `Retry-After`. |
| `GET /v1/stamp?h=` | ALTCHA proof-of-work challenge with the body hash `h` inside the signed salt |
| `POST /v1/submissions` | Stores the body if the `Altcha` header solves a challenge issued for exactly these bytes. Records IP, user agent, language, origin, referer and a few client-hint headers. One use per stamp (unique salt). |
| `GET /v1/models`, `/v1/health` | Bank metadata |
| `GET /openapi.yaml`, `/llms.txt` | Contract and a short guide for agents |

Errors are RFC 9457 `application/problem+json`.

## Configuration (environment)

| Variable | Default | |
|---|---|---|
| `ADDR` | `:8080` | |
| `BANK_PATH` | `../data/bank/bank.fb` | `/bank.fb` in the container |
| `STAMP_HMAC_KEY` | random per process | Set it, and share it across instances, in production |
| `STAMP_MAX_NUMBER` | `200000` | Proof-of-work difficulty (~0.1–0.5 s in a browser) |
| `STAMP_TTL` | `10m` | |
| `DATABASE_URL` | — | Postgres; creates its one table on start. Unset: append to `DATA_FILE` |
| `DATA_FILE` | `submissions.jsonl` | Local development only |
| `CORS_ORIGINS` | `*` | Comma-separated origins, e.g. the Pages site |
| `WORKERS` / `QUEUE` | CPU count / `256` | Categorize worker pool |
| `MAX_BODY_BYTES` | `1048576` | |
| `TRUSTED_PROXIES` | none | Proxies whose `X-Forwarded-For` is trusted for the client IP |
| `CLIENT_IP_HEADER` | — | e.g. `CF-Connecting-IP` behind Cloudflare |

Rate limiting belongs at the edge (Cloudflare, Cloud Run); the API itself only sheds load with 429.
