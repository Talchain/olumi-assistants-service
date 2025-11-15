# Scripts

Operational helper scripts for olumi-assistants-service.

## New in v1.11.0

### scripts/smoke-prod.sh

One-shot smoke test against **production** for v1.11.0.

Environment variables:

- `BASE_PROD` – Production base URL, e.g. `https://olumi-assistants-service.onrender.com`.
- `KEY_PROD` – Production API key (Bearer token).

Checks performed:

1. `GET /health` – prints `{version, perf}` and asserts version starts with `v1.11.0`.
2. `GET /v1/limits` – prints a summary including `max_nodes`, `max_edges`, `quota_backend`, and verifies `50/200` caps.
3. `POST /assist/draft-graph` (JSON) – prints `{schema, diagnostics}` (no payload body).
4. `POST /assist/draft-graph/stream` (SSE) – prints the `X-Request-Id` header and the final `COMPLETE` event block containing diagnostics.
5. `POST /assist/draft-graph/resume` – if a resume token is observed, prints the `complete` event from the resume stream. Operator should verify `diagnostics.resumes >= 1` and `recovered_events >= 0`.

The script writes transient logs under `$TMPDIR` (default `./.tmp`). No secrets are printed.

### scripts/smoke-staging-degraded.sh

Quick staging check for degraded Redis mode.

Environment variables:

- `BASE_STAGING` – Staging base URL.
- `KEY_PROD` – API key (same as production keyspace).

Checks performed:

1. `POST /assist/draft-graph/stream` on staging and prints the first 40 lines of the response (status + headers + early body).
2. Searches for `X-Olumi-Degraded: redis` in the captured output and prints a clear note:
   - "X-Olumi-Degraded: redis header observed" or
   - "DEGRADED NOT OBSERVED".

Run this only when Redis is intentionally unavailable on staging, then restore `REDIS_URL` and redeploy.

## Other scripts

Existing scripts such as `quick-prod-val.sh`, `validate-staging.sh`, and `wait-for-deploy.sh` remain unchanged and can be used alongside these new v1.11.0 checks.
