# CEE Limits and Compute Budgets

> Canonical reference for CEE v1 limits and budgets. This document explains how graph caps, cost caps, response caps, and per-endpoint rate limits are enforced in the service and how they relate to CEE responses.

## Overview

CEE v1 sits on top of the Assistants draft pipeline and inherits its global safety limits (graph shape, cost caps, SSE budgets). On top of that, CEE introduces:

- Per-endpoint rate limits for each `/assist/v1/*` feature.
- Response caps for bias findings, options, evidence suggestions, and sensitivity suggestions.
- A shared cost cap (`COST_MAX_USD`) that is respected both before and after calling the engine.

All limits are:

- Metadata-only
- Deterministic
- Configurable only via environment variables (no per-request overrides)

## Graph shape caps (global)

Graph caps are configured in `src/config/graphCaps.ts` and enforced by `validateGraphCaps` in `src/utils/responseGuards.ts`:

- **Defaults**
  - `GRAPH_MAX_NODES` (or `LIMIT_MAX_NODES`): **50** nodes
  - `GRAPH_MAX_EDGES` (or `LIMIT_MAX_EDGES`): **200** edges
- **Env precedence**
  - `LIMIT_MAX_NODES` / `LIMIT_MAX_EDGES` override
  - `GRAPH_MAX_NODES` / `GRAPH_MAX_EDGES` (legacy) are respected if present
  - If neither is set, defaults are used

Both the JSON and SSE draft handlers (and the CEE finaliser) call `validateResponse(graph, cost_usd, maxCostUsd)`, which delegates to `validateGraphCaps`. Any violation is surfaced as a guard violation and mapped into a CEE error code by the CEE finaliser.

## Cost budgets

### COST_MAX_USD

The global cost cap is configured via `COST_MAX_USD` and defaults to **1.00** USD:

- `src/utils/costGuard.ts`
  - `allowedCostUSD(tokensIn, tokensOut, model)` uses `calculateCost` and compares against `COST_MAX_USD`.
  - Used as a **pre-call guard** to avoid obviously too-expensive drafts.
- `src/utils/responseGuards.ts`
  - `validateCost`, `validateCostCap`, and `validateResponse` form the **post-response guard**.
  - `validateResponse(graph, cost_usd, maxCostUsd)` enforces `cost_usd ≤ COST_MAX_USD`.
- `src/routes/assist.draft-graph.ts` and `src/cee/validation/pipeline.ts`
  - Both use `validateResponse` with `maxCostUsd = COST_MAX_USD` so JSON, SSE, and CEE overlays share the same cap.
- `/v1/status` (`src/routes/v1.status.ts`)
  - Exposes `cost_cap_usd` in the status payload, derived from `COST_MAX_USD`.

**Behaviour:**

- If `allowedCostUSD(...)` returns `false`, the request is rejected before the engine is called.
- If a response comes back with `cost_usd` above the cap, `validateResponse` returns a `CAP_EXCEEDED` guard violation, which the CEE finaliser maps into `CEE_GRAPH_INVALID`.

## CEE response caps

CEE applies additional caps to the **response** payload for certain list fields to keep envelopes small and deterministic. These caps live in `src/cee/config/limits.ts` and are enforced in `src/cee/validation/pipeline.ts`:

- `CEE_BIAS_FINDINGS_MAX = 10`
- `CEE_OPTIONS_MAX = 6`
- `CEE_EVIDENCE_SUGGESTIONS_MAX = 20`
- `CEE_SENSITIVITY_SUGGESTIONS_MAX = 10`

The finaliser uses these constants in `applyResponseCaps(payload)` to:

- Truncate the lists when they exceed the configured maximum.
- Populate the `response_limits` field in `CEEDraftGraphResponseV1` with the following shape:

```jsonc
{
  "bias_findings_max": 10,
  "bias_findings_truncated": true,
  "options_max": 6,
  "options_truncated": true,
  "evidence_suggestions_max": 20,
  "evidence_suggestions_truncated": true,
  "sensitivity_suggestions_max": 10,
  "sensitivity_suggestions_truncated": true
}
```

Notes:

- These limits are **part of the CEE v1 contract** via `response_limits` and are frozen for v1.
- Truncation is deterministic (`slice(0, max)`), preserving ordering from the underlying pipeline.

## Per-endpoint CEE rate limits

Each CEE endpoint has an in-memory per-key rate limit (per API key if present, otherwise per IP) with a 1-minute window. All of them share the same default RPM of **5**, configurable per-feature via env vars.

| Endpoint                      | Feature                        | Env (RPM)                            | Default | Notes                     |
|------------------------------|--------------------------------|--------------------------------------|---------|---------------------------|
| `/assist/v1/draft-graph`     | CEE Draft My Model             | `CEE_DRAFT_RATE_LIMIT_RPM`          | 5       | Per API key / IP          |
| `/assist/v1/explain-graph`   | CEE Explain Graph              | `CEE_EXPLAIN_RATE_LIMIT_RPM`        | 5       | Per API key / IP          |
| `/assist/v1/evidence-helper` | CEE Evidence Helper            | `CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM`| 5       | Per API key / IP          |
| `/assist/v1/bias-check`      | CEE Bias Check                 | `CEE_BIAS_CHECK_RATE_LIMIT_RPM`     | 5       | Per API key / IP          |
| `/assist/v1/sensitivity-coach`| CEE Sensitivity Coach         | `CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM`| 5    | Per API key / IP          |
| `/assist/v1/options`         | CEE Options                    | `CEE_OPTIONS_RATE_LIMIT_RPM`        | 5       | Per API key / IP          |
| `/assist/v1/team-perspectives`| CEE Team Perspectives         | `CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM`| 5    | Per API key / IP          |

Implementation details:

- Each route maintains an in-memory bucket map keyed by API key ID (or IP) with:
  - `WINDOW_MS = 60_000` ms (1-minute window)
  - `MAX_BUCKETS = 10_000` entries, with aggressive pruning of old keys
- On every request, the route:
  - Increments a per-key counter within the active window.
  - If the limit is exceeded:
    - Returns a `CEEErrorResponseV1` with `code = "CEE_RATE_LIMIT"`, `retryable = true`.
    - Sets `details.retry_after_seconds` with a minimal positive retry-after.
    - Sets `Retry-After` header to the same value.

Tests for these behaviours live in:

- `tests/integration/cee.draft-graph.test.ts`
- `tests/integration/cee.explain-graph.test.ts`
- `tests/integration/cee.options.test.ts`
- `tests/integration/cee.bias-check.test.ts`
- `tests/integration/cee.evidence-helper.test.ts`
- `tests/integration/cee.sensitivity-coach.test.ts`
- `tests/integration/cee.team-perspectives.test.ts`

and in the consolidated telemetry tests:

- `tests/integration/cee.telemetry.test.ts`

which also assert that rate-limited flows emit the correct `cee.*.failed` telemetry with `error_code = "CEE_RATE_LIMIT"` and `http_status = 429`.

## SSE state budgets (draft-graph streaming)

The SSE streaming path for `/assist/draft-graph/stream` uses Redis-backed state and buffering, with its own internal budgets configured in `src/utils/sse-state.ts`:

- `SSE_BUFFER_MAX_EVENTS` (default: 256)
- `SSE_BUFFER_MAX_SIZE_MB` (default: 1.5 MB)
- `SSE_STATE_TTL_SEC` (default: 900 seconds)
- `SSE_SNAPSHOT_TTL_SEC` (default: 900 seconds)

These budgets control:

- How many events can be buffered for resume.
- The maximum total size of buffered events.
- How long state and snapshots are retained for late resume.

When buffers hit hard caps, low-priority events are trimmed first; if only CRITICAL events remain, incoming events may be dropped. Telemetry events such as `assist.sse.buffer_trimmed` and `assist.sse.snapshot_created` capture these behaviours for observability.

These SSE budgets are **not** part of the CEE v1 public contract but are important for operational tuning and incident response.

## Operational guidance

- For most tenants, the defaults (`COST_MAX_USD = 1.00`, 50 nodes / 200 edges, 5 RPM per CEE endpoint) are sufficient.
- To adjust budgets:
  - Use `COST_MAX_USD` to tighten or relax draft cost caps.
  - Use the `CEE_*_RATE_LIMIT_RPM` envs to change per-feature RPM.
  - Use `LIMIT_MAX_NODES` / `LIMIT_MAX_EDGES` for global graph caps.
- After any change to limits, always run the standard verification pipeline:
  - `pnpm fixtures:validate`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm preflight`

For more context, see:

- `v1.md` – end-to-end CEE v1 contract and behaviours.
- `maintainers-guide.md` – maintainer responsibilities and verification checklist.
- `incident-runbook.md` – incident levers and mitigations.
