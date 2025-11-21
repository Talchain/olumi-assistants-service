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

As documented in `openapi.yaml` and `Docs/CEE-v1.md`, `/healthz` returns:

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

`/healthz` is intended for:

- Liveness / readiness probes.
- Dashboards showing provider/model drift.
- Rollout safety checks (e.g. verifying provider/model before enabling CEE in
  PLoT).

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

## 4. Security and privacy

- Never expose `CEE_API_KEY` or any CEE headers in client-side code or logs.
- `/healthz` intentionally exposes only high-level configuration metadata; it
  does not include prompts, graphs, or user data.
- Decision Review payloads (`CeeDecisionReviewPayloadV1`) are metadata-only and
  safe to log on the engine side, but product teams should still avoid logging
  them at high volume unless necessary for debugging.
