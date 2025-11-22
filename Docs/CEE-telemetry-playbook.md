# CEE Telemetry Playbook

**Purpose:** Help engineers and ops teams build dashboards and alerts from
existing CEE telemetry, without changing any events or payloads.

This document focuses on `cee.*` telemetry events emitted by the CEE v1
endpoints. For the full event definitions and fields, see:

- `Docs/CEE-v1.md` – section **4.2 Telemetry** (CEE-specific events).
- `src/utils/telemetry.ts` – frozen `TelemetryEvents` enum.
- `tests/integration/cee.telemetry.test.ts` – end-to-end shape guards.

CEE telemetry is **privacy-safe** by design:

- No briefs, graphs, or LLM text are included.
- Fields are IDs, counts, booleans, numbers, or short codes/enums.

In addition to these structured events, the service also emits a single
structured **`cee.call` log line** for each CEE v1 request and exposes a
metadata-only `/diagnostics` endpoint backed by an in-memory ring buffer of
recent `cee.call` entries. These are intended for operators and internal
dashboards rather than as primary product telemetry.

---

## 1. CEE event families and key fields

For each CEE endpoint, three events are emitted:

- `*.requested` – input shape and feature toggles (no user text).
- `*.succeeded` – latency, quality, counts, and validation/truncation flags.
- `*.failed` – error code and HTTP status (no free-text message).

### 1.1 Draft My Model (`/assist/v1/draft-graph`)

- `cee.draft_graph.requested`
  - `request_id`, `feature`, `has_seed`, `has_archetype_hint`, `api_key_present`.
- `cee.draft_graph.succeeded`
  - `quality_overall`, `graph_nodes`, `graph_edges`,
    `has_validation_issues`, `any_truncated`, `engine_provider`, `engine_model`.
- `cee.draft_graph.failed`
  - `error_code` (`CEE_*`), `http_status`.

### 1.2 Explain My Model (`/assist/v1/explain-graph`)

- `cee.explain_graph.requested`
  - `has_context_id`, `api_key_present`.
- `cee.explain_graph.succeeded`
  - `quality_overall`, `target_count`, `driver_count`, `has_validation_issues`.
- `cee.explain_graph.failed`
  - `error_code`, `http_status`.

### 1.3 Evidence Helper (`/assist/v1/evidence-helper`)

- `cee.evidence_helper.requested`
  - `evidence_count`, `api_key_present`.
- `cee.evidence_helper.succeeded`
  - `quality_overall`, `evidence_count`, `strong_count`, `any_unsupported_types`,
    `any_truncated`, `has_validation_issues`.
- `cee.evidence_helper.failed`
  - `error_code`, `http_status`.

### 1.4 Bias Check (`/assist/v1/bias-check`)

- `cee.bias_check.requested`
  - `has_archetype`, `api_key_present`.
- `cee.bias_check.succeeded`
  - `quality_overall`, `bias_count`, `any_truncated`, `has_validation_issues`.
- `cee.bias_check.failed`
  - `error_code`, `http_status`.

### 1.5 Options Helper (`/assist/v1/options`)

- `cee.options.requested`
  - `has_archetype`, `api_key_present`.
- `cee.options.succeeded`
  - `quality_overall`, `option_count`, `any_truncated`, `has_validation_issues`.
- `cee.options.failed`
  - `error_code`, `http_status`.

### 1.6 Sensitivity Coach (`/assist/v1/sensitivity-coach`)

- `cee.sensitivity_coach.requested`
  - `has_inference`, `api_key_present`.
- `cee.sensitivity_coach.succeeded`
  - `quality_overall`, `driver_count`, `any_truncated`, `has_validation_issues`.
- `cee.sensitivity_coach.failed`
  - `error_code`, `http_status`.

### 1.7 Team Perspectives (`/assist/v1/team-perspectives`)

- `cee.team_perspectives.requested`
  - `participant_count`, `api_key_present`.
- `cee.team_perspectives.succeeded`
  - `quality_overall`, `participant_count`, `disagreement_score`,
    `has_validation_issues`.
- `cee.team_perspectives.failed`
  - `error_code`, `http_status`.

All `*.failed` events share the same minimal shape:

- `request_id: string`
- `latency_ms: number`
- `error_code: string` (e.g. `CEE_RATE_LIMIT`, `CEE_VALIDATION_FAILED`).
- `http_status: number` (400/429/500, etc.).

---

## 1.1 Structured CEE logs and diagnostics (non-metric)

Alongside the `cee.*` telemetry events, the service writes a structured log
entry for each CEE v1 call:

- Log event: `event: "cee.call"` with fields such as:
  - `request_id`, `capability`, `provider`, `model`.
  - `latency_ms`, `tokens_in`, `tokens_out`, `cost_usd`.
  - `status: "ok" | "degraded" | "timeout" | "limited" | "error"`.
  - `error_code`, `http_status`, `any_truncated`, `has_validation_issues`.

These log entries are:

- Metadata-only (no prompts, briefs, graphs, or LLM text).
- Written via the shared `logCeeCall` helper in `src/cee/logging.ts`.

For convenience, a small ring buffer of recent `cee.call` entries is surfaced
via the `/diagnostics` endpoint when `CEE_DIAGNOSTICS_ENABLED=true`:

- `GET <CEE_BASE_URL>/diagnostics`
- Response includes:
  - `service`, `version`, `timestamp`, `feature_flags`.
  - `cee.config` – per-capability CEE config (feature versions and RPM limits).
  - `cee.recent_errors` – a list of non-`ok` `cee.call` entries.

These diagnostics surfaces are useful for:

- Quickly understanding which CEE capabilities are failing and why
  (status/error codes, HTTP status, high-level config).
- Complementing metric-based dashboards built on top of `cee.*` events.

For operational usage patterns, see `Docs/CEE-ops.md`.

---

## 2. Mapping telemetry to SDK story/health/journey

The same metadata that powers CEE telemetry also underpins the SDK helpers:

- `DecisionStorySummary`
- `CeeHealthSummary`
- `CeeJourneySummary`
- `CeeUiFlags`

### 2.1 Quality and bands

- Telemetry: `quality_overall` on `*.succeeded` events.
- SDK: `quality_overall` feeds the CEE judgement policy bands:
  - `1–4` → low, `5–7` → medium, `8–10` → high.
- Usage:
  - Track distribution of `quality_overall` to understand how often CEE
    surfaces low/medium/high guidance.
  - This approximates the narrative tone in `DecisionStorySummary` and
    journey-level health in `CeeJourneySummary.health.overallStatus`.

### 2.2 Validation and risk posture

- Telemetry: `has_validation_issues` on `*.succeeded` events.
- SDK:
  - `CeeHealthSummary.status` uses validation issues + truncation + quality
    to choose `ok` / `warning` / `risk`.
  - `CeeUiFlags.has_high_risk_envelopes` becomes true when any envelope is in
    the `risk` band.
- Usage:
  - Measure the rate of `has_validation_issues === true` per endpoint; this
    indicates how often CEE guidance is warning/risk-oriented.
  - Approximate the fraction of journeys where `has_high_risk_envelopes`
    would be true by combining validation/truncation rates and low
    `quality_overall` values.

### 2.3 Truncation and list caps

- Telemetry: `any_truncated` on `options`, `bias_check`, `sensitivity_coach`,
  and `evidence_helper`.
- SDK:
  - `CeeHealthSummary.any_truncated` is true when list caps were applied.
  - `DecisionStorySummary.any_truncated` and `risks_and_gaps` surface generic
    "partial view" language.
  - `CeeUiFlags.has_truncation_somewhere` becomes true when any envelope is
    truncated.
- Usage:
  - Track the rate of truncation per endpoint to understand how often users
    see capped lists.
  - Use this to calibrate UI hints like "Partial view (capped)" chips.

### 2.4 Team disagreement

- Telemetry: `disagreement_score` and `participant_count` on
  `cee.team_perspectives.succeeded`.
- SDK:
  - `has_team_disagreement` on `CeeJourneySummary` becomes true when there is
    a materially split team (score and participant threshold).
  - `CeeUiFlags.has_team_disagreement` mirrors this as a UI-ready flag.
- Usage:
  - Track the distribution of `disagreement_score` and count how often it
    exceeds the material-disagreement threshold.
  - This approximates how often the UI would show a "Team is split" badge.
  - For a concrete, fixtures-backed scenario combining high disagreement and
    thin evidence, see `tests/integration/cee.hero-journey.disagreement.test.ts`.

### 2.5 Journey completeness (indirect)

Telemetry today is per-endpoint, not per-journey. You can still approximate
journey completeness by combining events:

- Define a "journey" as a set of `request_id` values that share a common
  upstream draft (e.g. via an application-level correlation ID).
- For a given journey, check which of the following have at least one
  `*.succeeded` event:
  - Draft, options, evidence-helper, bias-check, sensitivity-coach,
    team-perspectives.
- Compare your own view of "envelopes present" with the helper’s
  `CeeJourneySummary.is_complete` / `missing_envelopes` fields.

---

## 3. Example dashboard views

Below are vendor-agnostic ideas; adapt them to your metrics stack.

### 3.1 Quality posture per endpoint

- Metric: distribution of `quality_overall` from `*.succeeded` events.
- Break down by endpoint:
  - Draft, explain, options, evidence-helper, bias-check, sensitivity-coach,
    team-perspectives.
- Interpretation:
  - High share of low-quality drafts might indicate tricky briefs
    or engine regressions.

### 3.2 Validation and truncation heat map

- Metric: rate of `has_validation_issues === true` and `any_truncated === true`
  per endpoint.
- Interpretation:
  - Spikes suggest tighter caps or schema issues; they roughly track where
    `CeeUiFlags.has_high_risk_envelopes` and
    `CeeUiFlags.has_truncation_somewhere` would light up.

### 3.3 Team alignment vs disagreement

- Metric: histogram of `disagreement_score` and `participant_count` from
  `cee.team_perspectives.succeeded`.
- Derived metric: proportion of events where disagreement is in the
  "material" band (same thresholds as `has_team_disagreement`).
- Interpretation:
  - Shows where product teams are genuinely split vs broadly aligned.

### 3.4 Rate-limit and validation failures

- Metric: count of `*.failed` events grouped by `error_code` and `http_status`.
- Focus on:
  - `CEE_RATE_LIMIT` (operational capacity / client behaviour).
  - `CEE_VALIDATION_FAILED` (schema / integration issues).
- Interpretation:
  - Useful for tracking whether integrators are misusing the API or hitting
    configured rate caps.

---

## 4. Example alerts

These are conceptual; implement them using your monitoring platform.

### 4.1 CEE rate-limit surge

- Condition: `CEE_RATE_LIMIT` failures for any CEE endpoint exceed a chosen
  threshold (e.g. >5% of total CEE calls over 10 minutes).
- Response:
  - Check client-side retry policies (e.g. use `isRetryableCEEError`).
  - Review rate-limit configuration per endpoint.

### 4.2 High validation failure rate

- Condition: `CEE_VALIDATION_FAILED` failures spike for a specific endpoint.
- Response:
  - Investigate schema changes, SDK mismatches, or new client rollouts.
  - Cross-reference with `CeeHealthSummary`-driven UI to ensure users are
    seeing clear guidance.

### 4.3 Increasing truncation frequency

- Condition: `any_truncated === true` grows beyond a chosen baseline.
- Response:
  - Evaluate whether list caps are too tight for typical usage.
  - Consider UI improvements to better communicate partial views.

---

## 5. Privacy and alignment with SDK

- Telemetry is intentionally limited to metadata:
  - No briefs, graphs, or LLM text.
  - Only IDs, numbers, booleans, and short enums/codes.
- The same signals drive both:
  - Observability (via `cee.*` events), and
  - Client-facing story/health/journey/flags (via SDK helpers).

This means you can:

- Build dashboards that mirror what users see in the UI without logging
  additional payloads.
- Reason about system health, truncation, and disagreement using the same
  semantics documented in `Docs/CEE-v1.md` and implemented in:
  - `sdk/typescript/src/ceeHelpers.ts`
  - `src/cee/guidance/index.ts`
  - `src/cee/team/index.ts`

For concrete steps to take during incidents (rate-limit spikes, validation
failures, upstream outages), see `Docs/CEE-incident-runbook.md`.

---

## 6. CEE Datadog metrics (metadata-only)

CEE v1 `cee.*` telemetry events are exported to Datadog via the shared
`emit()` helper in `src/utils/telemetry.ts`. Metrics are intentionally
simple and **reuse the frozen event names**:

- **Draft My Model**
  - Counter: `cee.draft_graph.requested`
  - Counter: `cee.draft_graph.succeeded`
  - Counter: `cee.draft_graph.failed` (tagged by `error_code` / `http_status`)

- **Explain My Model**
  - Counter: `cee.explain_graph.requested`
  - Counter: `cee.explain_graph.succeeded`
  - Counter: `cee.explain_graph.failed` (tagged by `error_code` / `http_status`)

- **Evidence Helper**
  - Counter: `cee.evidence_helper.requested`
  - Counter: `cee.evidence_helper.succeeded`
  - Counter: `cee.evidence_helper.failed` (tagged by `error_code` / `http_status`)

- **Bias Check**
  - Counter: `cee.bias_check.requested`
  - Counter: `cee.bias_check.succeeded`
  - Counter: `cee.bias_check.failed` (tagged by `error_code` / `http_status`)

- **Options Helper**
  - Counter: `cee.options.requested`
  - Counter: `cee.options.succeeded`
  - Counter: `cee.options.failed` (tagged by `error_code` / `http_status`)

- **Sensitivity Coach**
  - Counter: `cee.sensitivity_coach.requested`
  - Counter: `cee.sensitivity_coach.succeeded`
  - Counter: `cee.sensitivity_coach.failed` (tagged by `error_code` / `http_status`)

- **Team Perspectives**
  - Counter: `cee.team_perspectives.requested`
  - Counter: `cee.team_perspectives.succeeded`
  - Counter: `cee.team_perspectives.failed` (tagged by `error_code` / `http_status`)

These metrics are **metadata-only** and use the same event payloads that are
already validated in `tests/integration/cee.telemetry.test.ts`. No new events
or fields are introduced; dashboards should continue to treat the
`cee.*` family as structured, non-textual signals aligned with
`Docs/CEE-v1.md`.

