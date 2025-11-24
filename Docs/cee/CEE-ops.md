# CEE Ops Notes (Decision Review / PLoT)

Last updated: 2025-11-21

This doc provides a short reference for DevOps / SRE teams configuring and
monitoring the CEE service as consumed by the PLoT engine.

## 1. Base URL and API key

From the PLoT / engine perspective, the CEE integration should be configured
via two environment variables:

- `CEE_BASE_URL`
  - Base URL for the CEE Assistants service.
  - Example (staging): `https://api.staging.olumi.ai`
  - Example (production): `https://api.olumi.ai`
- `CEE_API_KEY`
  - API key used by PLoT to call CEE via the TypeScript SDK.
  - Must be stored in a secure secret manager and injected into the engine
    runtime only (never into browser/JS bundles).

Recommended usage in the PLoT repo (pseudo-code):

```ts
import { createCEEClient } from "@olumi/assistants-sdk";

const cee = createCEEClient({
  apiKey: process.env.CEE_API_KEY!,
  baseUrl: process.env.CEE_BASE_URL,
  timeout: 60_000,
});
```

Notes:

- These variables are **engine-side only**. UI / Scenario code must never see
  or depend on them.
- For local development, `CEE_BASE_URL` typically points at a developer's
  Assistants service instance (e.g. `http://localhost:3101`).

## 2. Health endpoint

The canonical health endpoint for this service is:

- `GET <CEE_BASE_URL>/healthz`

### 2.1 Expected response shape

As documented in `openapi.yaml` and `v1.md`, `/healthz` returns:

```json
{
  "ok": true,
  "service": "assistants",
  "version": "1.1.0",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "limits_source": "engine",
  "feature_flags": {
    "grounding": true,
    "critique": true,
    "clarifier": true
  },
  "cee": {
    "diagnostics_enabled": false,
    "config": {
      "draft_graph": {
        "feature_version": "draft-model-1.0.0",
        "rate_limit_rpm": 5
      }
      // ... other CEE v1 capabilities (options, evidence-helper, bias-check,
      // sensitivity-coach, team-perspectives, explain-graph)
    }
  }
}
```

Fields:

- `ok: boolean` – overall health flag.
- `service: "assistants"` – static identifier for this service.
- `version: string` – semantic version string for deployments.
- `provider: string` – active LLM provider (`openai`, `anthropic`, `fixtures`).
- `model: string` – active model identifier.
- `limits_source: "engine" | "config"` – whether graph limits are sourced
  from the engine or configuration.
- `feature_flags: { grounding: boolean; critique: boolean; clarifier: boolean }`
  – coarse feature flags.
- `cee.diagnostics_enabled: boolean` – whether the `/diagnostics` endpoint is
  enabled for this deployment.
- `cee.config: object` – per-capability CEE v1 configuration (feature version
  strings and per-endpoint RPM limits). This is metadata-only and mirrors the
  `CEE_*_FEATURE_VERSION` and `CEE_*_RATE_LIMIT_RPM` environment variables.

`/healthz` is intended for:

- Liveness / readiness probes.
- Dashboards showing provider/model drift.
- Rollout safety checks (e.g. verifying provider/model before enabling CEE in
  PLoT).

### 2.2 Timeouts & resilience

The Assistants service applies central, time-boxed limits to both HTTP and
LLM calls. These are configured via environment variables on the service:

- `HTTP_CLIENT_TIMEOUT_MS`
  - End-to-end HTTP timeout for upstream LLM/provider clients.
  - Default: `110000` (110s), clamped between 5s and 5 minutes.
- `ROUTE_TIMEOUT_MS`
  - Fastify `connectionTimeout` / `requestTimeout` for all routes.
  - Default: `115000` (115s), clamped between 5s and 5 minutes.
- `UPSTREAM_RETRY_DELAY_MS`
  - Base delay (in ms) before a single retry on upstream LLM timeouts in the
    draft graph pipeline.
  - Default: `800`. The actual sleep uses ±25% jitter around this value.

For observability, `/healthz` exposes these values in a metadata-only block:

```jsonc
"cee": {
  "diagnostics_enabled": false,
  "config": { /* ... */ },
  "timeouts": {
    "route_ms": 115000,
    "http_client_ms": 110000,
    "retry_delay_ms": 800
  }
}
```

Operator checks should treat these as **configuration hints only**; the
service may clamp or override invalid values while keeping public contracts
unchanged.

## 3. Suggested monitoring

Minimal checks for staging / production:

- **HTTP health**
  - `GET /healthz` returns `200` within an acceptable latency budget.
  - `ok === true`.
- **Provider / model expectations**
  - Alert if `provider` or `model` drift from the expected values for a given
    environment (e.g. staging vs prod).
- **Version tracking**
  - Surface `version` in deployment dashboards to correlate CEE changes with
    engine behaviour.

### 2.2 Diagnostics endpoint

For deeper, metadata-only diagnostics, the service exposes an **optional**
endpoint:

- `GET <CEE_BASE_URL>/diagnostics`

Notes:

- The route is only registered when `CEE_DIAGNOSTICS_ENABLED=true` on the
  service.
- It is protected by the same API key auth plugin as other CEE routes and
  should only be called from trusted operator tooling.
  - By default, any authenticated API key may call this route.
  - To further restrict access to specific operator keys, set
    `CEE_DIAGNOSTICS_KEY_IDS` to a comma-separated list of **key IDs** (the
    hashed identifiers surfaced in `/v1/limits` and auth telemetry). When this
    variable is non-empty, only requests whose authenticated key ID is in the
    allowlist will receive diagnostics; all other keys receive a standard
    `error.v1` `FORBIDDEN` response.

High-level response shape:

```json
{
  "service": "assistants",
  "version": "1.1.0",
  "timestamp": "2025-11-21T23:59:59.000Z",
  "feature_flags": { "grounding": true, "critique": true, "clarifier": true },
  "cee": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "config": {
      "draft_graph": { "feature_version": "draft-model-1.0.0", "rate_limit_rpm": 5 }
      // ... other CEE capabilities
    },
    "recent_errors": [
      {
        "request_id": "cee-req-id",
        "capability": "cee_draft_graph",
        "status": "error",
        "error_code": "CEE_INTERNAL_ERROR",
        "http_status": 500,
        "latency_ms": 123,
        "any_truncated": false,
        "has_validation_issues": false,
        "timestamp": "2025-11-21T23:59:00.000Z"
      }
    ]
  }
}
```

`recent_errors` is sourced from an in-memory ring buffer of structured
`cee.call` log entries. These entries are:

- Metadata-only (IDs, booleans, counts, numeric latencies, error codes).
- Explicitly **exclude** prompts, briefs, graph labels, LLM text, and API keys.

Operators can use `/diagnostics` for:

- Quick inspection of which CEE capabilities are failing and with which codes.
- Verifying that rate limits and feature versions are configured as expected.

## 4. Internal diagnostics and examples

In addition to `/healthz`, the service exposes two operator-only surfaces that
are disabled by default in production environments:

- `/diagnostics` – metadata-only diagnostics (see above), controlled by
  `CEE_DIAGNOSTICS_ENABLED=true`.
- `/assist/v1/decision-review/example` – an **internal example endpoint** that
  serves a static `CeeDecisionReviewPayloadV1` object for documentation and
  regression testing. It is controlled by `CEE_DECISION_REVIEW_EXAMPLE_ENABLED`:
  - When `CEE_DECISION_REVIEW_EXAMPLE_ENABLED="true"`, the route is
    registered and protected by the standard API key auth plugin.
  - Otherwise, the route is not registered and requests receive a normal `404`.

Both endpoints are intended for staging/ops usage and should not be exposed to
untrusted callers. They remain strictly metadata-only: no prompts, briefs,
graphs, or LLM text are ever included.

For day-to-day operations, we recommend using the `cee:diagnostics` CLI as the
entrypoint for inspecting `/healthz` + `/diagnostics` together. See
`runbook.md` for a concrete triage flow, example commands, and exit
code semantics, and `Docs/runbooks/cee-llm-outage-or-spike.md` for a focused
incident playbook covering LLM provider outages or sudden CEE error spikes.

## 5. Security and privacy

- Never expose `CEE_API_KEY` or any CEE headers in client-side code or logs.
- `/healthz` and `/diagnostics` intentionally expose only high-level
  configuration and error metadata; they do not include prompts, graphs, or
  user data.
- Structured `cee.call` logs and the corresponding `recent_errors` payloads are
  restricted to metadata fields (IDs, booleans, counts, numeric latencies,
  error codes, and status enums).
- Decision Review payloads (`CeeDecisionReviewPayloadV1`) are metadata-only and
  safe to log on the engine side, but product teams should still avoid logging
  them at high volume unless necessary for debugging.
