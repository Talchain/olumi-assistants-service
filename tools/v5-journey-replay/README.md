# V5 Journey Replay

Harness for the six-step V5 golden-path regression against `/orchestrate/v2/turn`. Produces [Docs/v5/v5-golden-path-evidence-cee.md](../../Docs/v5/v5-golden-path-evidence-cee.md) with per-step rows, outcome class, and an executive summary.

## Usage

### Local

```bash
# terminal 1
pnpm start

# terminal 2
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url http://localhost:3000 \
  --out Docs/v5/v5-golden-path-evidence-cee.md
```

No API key required for localhost.

### Staging

```bash
export OLUMI_REPLAY_API_KEY='[your-staging-key]'

pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging
```

#### Strict-mode SHA check

For "I just pushed X, confirm staging is on X" workflows, opt into strict mode by passing the expected short SHA:

```bash
DEPLOYED_SHA=$(git rev-parse --short HEAD)

pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --expected-build "$DEPLOYED_SHA" \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging
```

The CLI flag takes precedence over the `OLUMI_REPLAY_EXPECTED_BUILD` env var. When neither is set the gate runs in default mode: it confirms `/healthz` returned a well-formed `build` field but does not compare against any reference SHA.

The key is sent as `X-Olumi-Assist-Key` (the existing service contract — see [src/plugins/auth.ts](../../src/plugins/auth.ts)). The service-side env var is `ASSIST_API_KEY` (or `ASSIST_API_KEYS` for a comma-separated list). The harness-side env var is deliberately named differently (`OLUMI_REPLAY_API_KEY`) so rotating one does not silently affect the other.

**The key is env-var only — no CLI flag.** This keeps the secret out of shell history, `ps auxww`, and process-tree telemetry.

## Auth contract

| Surface | Detail |
|---|---|
| Harness env var | `OLUMI_REPLAY_API_KEY` |
| Service env var | `ASSIST_API_KEY` (single) / `ASSIST_API_KEYS` (comma list) |
| HTTP header | `X-Olumi-Assist-Key: <key>` |
| 401 body | `{ schema: "error.v1", code: "UNAUTHENTICATED", message: "Missing API key. Provide X-Olumi-Assist-Key header." }` |
| 403 body | `{ schema: "error.v1", code: "FORBIDDEN", message: "Invalid API key." }` |

## Behaviour

The harness runs two preflight probes before burning the six-step replay:

1. `GET /healthz` (public, no auth) — confirms the service is reachable and records `build`, `version`, `degraded`, and `degraded_reasons` in the evidence pack. Used for Phase 2 deploy confirmation.
2. `POST /orchestrate/v2/turn` with a minimal body `{}` (authenticated) — confirms the auth header is accepted. The expected outcome is 400 or 422 (auth OK, body rejected). A 401 or 403 halts the run with exit code 3 before any canonical step is attempted.

### Deploy gate

Between healthz and preflight, the harness halts with exit code 3 if any of the following hold (and the URL is not localhost):

- `/healthz` is unreachable or returns no body
- `build` is missing or not a well-formed short SHA (7+ hex chars)
- `--expected-build` (or `OLUMI_REPLAY_EXPECTED_BUILD`) is set and `build` does not match
- `degraded === true`

The gate has two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| Default | neither `--expected-build` nor `OLUMI_REPLAY_EXPECTED_BUILD` set | Confirms `/healthz` returned a well-formed `build` field. No SHA comparison. |
| Strict | `--expected-build SHA` (CLI; preferred) or `OLUMI_REPLAY_EXPECTED_BUILD=SHA` (env) | Additionally halts when `build !== SHA`. Use for post-deploy verification and formal evidence packs. |

To bypass any halt (well-formed failure, strict mismatch, degraded, unreachable):

```bash
export OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true   # also accepts "1" or "yes"
```

Localhost runs always skip this gate (local builds use arbitrary SHAs).

### Outcome classes (per row)

- `v5-runtime` — the orchestrator actually ran. Includes success (200), genuine 500, and 200 with an error envelope (`schema: "error.v1"` or BoundaryError shape — both are runtime failures, not successes).
- `harness-auth-blocker` — pre-orchestrator: 401, 403, network errors, aborts, harness exceptions.
- `skipped` — a prerequisite step failed; this step was not attempted.

### Localhost detection

Only the following hostnames are treated as local:

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `::1`

Not local (key required):

- `host.docker.internal` — container ergonomics; letting it pass means a misconfigured Docker environment could silently hit remote staging.
- `*.nip.io`, `*.localtest.me`, `*.xip.io` — wildcard DNS; can resolve to any public IP.
- `/etc/hosts` entries — not reproducible in CI.

If you find yourself wanting to widen this set, halt and ask.

### Secret redaction

A three-layer redactor (see [redact.ts](redact.ts)) ensures the API key never appears in:

- Console output (`console.log`, `console.error`)
- The evidence pack markdown (`row.evidence`, `failing_contract`, header fields)
- `Error.message` / `Error.stack` (via `sanitiseError` in `postTurn`)
- Diagnostic serialisations of request/response objects

Regression coverage: see [tests/unit/v5-journey-replay/redact.test.ts](../../tests/unit/v5-journey-replay/redact.test.ts) and [tests/unit/v5-journey-replay/auth-redaction.test.ts](../../tests/unit/v5-journey-replay/auth-redaction.test.ts) — the sentinel `SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123` must not appear in any observable surface.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All six canonical steps passed |
| 1 | One or more steps failed (replay ran; some rows failed). **Mid-replay transport errors classify as `failed`, not `skipped`** — exit 1 fires if a network blip prevents any step from completing. |
| 2 | Fatal harness error (uncaught exception outside the step loop) |
| 3 | Auth / preflight blocker, or deploy gate halted (build mismatch / degraded / healthz unreachable). Halts before any canonical step is attempted. |

## Files

| File | Purpose |
|---|---|
| [index.ts](index.ts) | CLI entry + six-step orchestration + preflight + fail-fast gate |
| [client.ts](client.ts) | `postTurn`, `getHealthz`, `preflightAuth` — all HTTP |
| [redact.ts](redact.ts) | `createRedactor`, `redactString`, `sanitiseError` |
| [localhost.ts](localhost.ts) | `isLocalHost` — exact-match hostname detection |
| [classify-outcome.ts](classify-outcome.ts) | `classifyResponse`, `hasErrorEnvelope`, `isTransportError` |
| [steps.ts](steps.ts) | Six canonical journey steps |
| [assertions.ts](assertions.ts) | Per-step product-shape assertions |
| [forbidden-terms.ts](forbidden-terms.ts) | Internal-term leak patterns |
| [evidence-writer.ts](evidence-writer.ts) | Markdown output + executive summary |
| [types.ts](types.ts) | Shared types |
