# CEE v1 Developer Guide

This doc gives engineers a fast orientation to the CEE v1 vertical slice.

## 0. Integration overview (Scenario UI & PLoT)

- The canonical integration spec for CEE v1, the PLoT engine, and the Scenario
  UI lives in:
  - `Docs/Olumi - CEE–Scenario–PLoT Integration SSOT v10.md`.
- At a high level, that SSOT establishes that:
  - **Single integration surface (D1):** PLoT and UI integrate with CEE via the
    TypeScript SDK only; they should not consume raw OpenAPI contracts.
  - **Who calls CEE (D2):** Only PLoT calls CEE. The Scenario UI never calls
    CEE directly; it consumes `ceeReview` / `ceeTrace` / `ceeError` from PLoT
    APIs.
  - **Where CEE sits (D3):** CEE is an optional "review" step after PLoT has
    produced a `report.v1` (graph + results). Engine responses must continue to
    work even if CEE is degraded or disabled.
  - **Config & keys (D7):** CEE secrets (API keys, base URL) are server-side
    only. UI code must never embed CEE credentials or talk to CEE endpoints
    directly.

For endpoint-level details, quality policy, and helper semantics, this document
remains the primary reference. For cross-repo integration behaviour, always
defer to the SSOT.

## 1. What CEE v1 Exposes

CEE v1 is a small, deterministic surface area built around the core draft pipeline.

- **Draft My Model**
  - `POST /assist/v1/draft-graph`
  - Product name: **CEE Draft My Model**.
  - **Request**
    - Body shape follows existing `DraftGraphInput` (see `src/schemas/assist.ts`).
    - CEE-specific passthrough fields:
      - `seed?: string`
      - `archetype_hint?: string` (e.g. `"pricing_decision"`).
  - **Response (success)**
    - Schema: `CEEDraftGraphResponseV1` (see `openapi.yaml` + `src/generated/openapi.d.ts`).
    - Extends the existing `DraftGraphOutput` with:
      - `trace: CEETraceMeta`
      - `quality: CEEQualityMeta`
      - `validation_issues?: CEEValidationIssue[]`
      - `archetype: { decision_type: string; match: "fuzzy" | "generic"; confidence: number }`
      - `seed?: string`
      - `response_hash?: string`
      - `response_limits: { ... }` (see below).
      - `guidance?: { summary: string; risks?: string[]; next_actions?: string[]; any_truncated?: boolean }` – a small, heuristic
        guidance block derived from quality, validation_issues, and response_limits. This is meant for UI hints and summaries and
        never includes raw user content.

- **Explain My Model**
  - `POST /assist/v1/explain-graph`
  - Summarises a graph in a CEE-friendly way and exposes deterministic quality + limits.
  - **Request**
    - Body: `CEEExplainGraphRequestV1` – wraps an existing graph (same shape as the draft pipeline emits) plus an `inference` blob
      (`summary`, optional `explain.top_drivers`, optional `model_card`, `seed`, `response_hash`, optional `context_id`).
  - **Response (success)** – `CEEExplainGraphResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `guidance?: CEEGuidanceV1` – shared guidance block derived from quality and any truncation flags.
    - A structured explanation payload (IDs, enums, short codes only).
    - `response_limits?: { items_max, items_truncated }` when the explanation list is capped.

- **Evidence Helper**
  - `POST /assist/v1/evidence-helper`
  - Scores and filters supplied evidence items for a given decision.
  - **Request**
    - Body: `CEEEvidenceHelperRequestV1` – `evidence: CEEEvidenceItemRequestV1[]` (each item has `id`, `type`, optional `source`, `content`).
  - **Response (success)** – `CEEEvidenceHelperResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `items: [...]` – scored evidence items (no free text in telemetry).
    - `response_limits: { items_max, items_truncated }`.
    - `guidance?: CEEGuidanceV1` – shared guidance block for this endpoint.
    - **Note:** v1 intentionally exposes a lean surface (items + limits +
      guidance). Richer per-node/edge coverage structures sketched in earlier
      design docs are deferred until there is a concrete consumer and will be
      added additively.
    - **Optional SDK helper:** `buildCeeEvidenceCoverageSummary` computes a
      metadata-only coverage summary from `items.length`, `response_limits`, and
      an optional caller-provided `requestedCount`. It never inspects evidence
      content.

- **Bias Check**
  - `POST /assist/v1/bias-check`
  - Analyses a graph for structural / content biases.
  - **Request**
    - Body: `CEEBiasCheckRequestV1` – `graph` plus optional `archetype` metadata from the draft endpoint.
  - **Response (success)** – `CEEBiasCheckResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `bias_findings: [...]` – structured bias findings (codes, severities, node IDs).
    - `response_limits: { bias_findings_max, bias_findings_truncated }`.
    - `guidance?: CEEGuidanceV1` – shared guidance block for this endpoint.

- **Options Helper**
  - `POST /assist/v1/options`
  - Deterministically proposes extra options for a graph, given an archetype.
  - **Request**
    - Body: `CEEOptionsRequestV1` – `graph` plus optional `archetype` from Draft My Model.
  - **Response (success)** – `CEEOptionsResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `options: [...]` – option descriptors (ID + label etc.).
    - `response_limits: { options_max, options_truncated }`.
    - `guidance?: CEEGuidanceV1` – shared guidance block for this endpoint.

- **Sensitivity Coach**
  - `POST /assist/v1/sensitivity-coach`
  - Ranks top drivers and suggests sensitivity checks for a decision model.
  - **Request**
    - Body: `CEESensitivityCoachRequestV1` – `graph` plus an `inference` blob (mirrors `InferenceResultsV1` with
      `summary`, optional `explain.top_drivers`, optional `model_card`, `seed`, `response_hash`, optional `context_id`).
  - **Response (success)** – `CEESensitivityCoachResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `suggestions: [...]` – each suggestion has a driver, a `direction` (e.g. increase/decrease/unclear), and a rank.
    - `response_limits: { sensitivity_suggestions_max, sensitivity_suggestions_truncated }`.
    - `guidance?: CEEGuidanceV1` – shared guidance block for this endpoint.

- **Team Perspectives**
  - `POST /assist/v1/team-perspectives`
  - Aggregates individual stances into a team-level summary.
  - **Request**
    - Body: `CEETeamPerspectivesRequestV1` – `perspectives: CEETeamPerspectiveItemV1[]` (each with stance, optional weight/confidence).
  - **Response (success)** – `CEETeamPerspectivesResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `summary` with:
      - `participant_count`, `for_count`, `against_count`, `neutral_count`.
      - `weighted_for_fraction` (0–1): weighted fraction of "for" stances; neutrals are included in the denominator.
      - `disagreement_score` (0–1): `0` means everyone is aligned on the same stance; higher values indicate a more evenly split team across for/against/neutral.
      - `has_team_disagreement`: boolean convenience flag indicating that disagreement is
        materially present (derived from `disagreement_score` and participant counts).
    - `guidance?: CEEGuidanceV1` – shared guidance block for this endpoint.
    - No `response_limits` today (no list caps are applied here).
   - **Weights semantics**
     - Weights are optional. When provided, only **positive, finite** weights contribute to the weighted fractions.
     - Non-positive or invalid weights (e.g. `0`, negative, `NaN`, `Infinity`) are treated as `0` for weighting purposes (no influence), but still count towards `participant_count`.

- **CEE Errors (all endpoints)**
  - Schema: `CEEErrorResponseV1`.
  - Keys:
    - `schema: "cee.error.v1"`
    - `code: CEEErrorCode` (e.g. `CEE_TIMEOUT`, `CEE_RATE_LIMIT`, `CEE_GRAPH_INVALID`, `CEE_VALIDATION_FAILED`, `CEE_INTERNAL_ERROR`, `CEE_ENGINE_DEGRADED`, `CEE_REPRO_MISMATCH`, `CEE_SERVICE_UNAVAILABLE`).
    - `message: string` (sanitised, no PII).
    - `retryable?: boolean`
    - `trace?: CEETraceMeta`
    - `details?: Record<string, unknown>`

### 1.1 Response caps and `response_limits`

CEE v1 enforces deterministic caps on certain lists and exposes metadata:

```ts
response_limits: {
  bias_findings_max: 10;
  bias_findings_truncated: boolean;
  options_max: 6;
  options_truncated: boolean;
  evidence_suggestions_max: 20;
  evidence_suggestions_truncated: boolean;
  sensitivity_suggestions_max: 10;
  sensitivity_suggestions_truncated: boolean;
}
```

If any underlying list exceeds its cap, CEE slices it and sets the corresponding
`*_truncated` flag to `true`. This is implemented centrally in the CEE finaliser
(see `src/cee/validation/pipeline.ts`) and documented in `openapi.yaml`.


## 2. Validation / Finaliser Pipeline

CEE v1 **must not bypass** the existing draft pipeline. The high-level flow is:

1. **Route** (`/assist/v1/draft-graph`)
   - Auth + per-feature CEE rate limiting.
   - Zod validation using `DraftGraphInput`.
   - Sanitisation via `sanitizeDraftGraphInput` (preserves `seed` and `archetype_hint`).
   - Delegates to `finaliseCeeDraftResponse`.
2. **Draft pipeline** (shared with `/assist/draft-graph`)
   - Runs the core NL→Graph engine.
   - Produces `graph`, `patch`, `rationales`, `confidence`, `issues`, `cost_usd`, etc.
3. **CEE finaliser** (`src/cee/validation/pipeline.ts`)
   - Applies post-response guards via `validateResponse` (graph caps, cost caps).
   - Maps guard violations to `CEE_GRAPH_INVALID` or `CEE_VALIDATION_FAILED` with
     structured `validation_issues`.
   - Builds `trace`, `quality`, `validation_issues`, `archetype`, and `response_limits`.
   - Applies list caps (`bias_findings`, `options`, `evidence_suggestions`,
     `sensitivity_suggestions`).
   - Maps upstream error codes to `CEEErrorResponseV1`.

### 2.1 Quality scoring heuristics

CEE v1 uses a small helper (`src/cee/quality/index.ts`) to convert existing
engine/graph data into a richer `CEEQualityMeta`:

- `overall` (1–10)
  - Derived directly from engine `confidence` (0–1 → 1–10).
- `structure` (1–10)
  - Rewards non-trivial graphs with enough nodes and edges.
  - Penalises tiny or very sparse graphs.
- `coverage` (1–10)
  - Rewards multiple options and the presence of risks/outcomes.
- `safety` (1–10)
  - Starts high and subtracts up to 3 points based on CEE validation issues.
- `causality` (1–10)
  - Currently mirrors `structure` as a coarse proxy for cause/effect richness.

All scores are cheap, deterministic, and based purely on graph shape and
validation metadata; **no extra LLM calls** are made for quality.

### 2.2 CEE judgement policy (bands and risk levels)

CEE v1 applies a small, fixed judgement policy on top of `CEEQualityMeta` and
validation metadata:

- **Quality bands (overall 1–10)**
  - `1–4` → **low** quality.
  - `5–7` → **medium** quality.
  - `8–10` → **high** quality.
- **Health levels (per-envelope)**
  - **risk** when any of the following hold:
    - At least one error-level `validation_issue`.
    - "Heavy" truncation (2 or more `*_truncated` flags on `response_limits`).
    - `quality.overall <= 3`.
  - **warning** when:
    - Any `validation_issues` are present, or
    - Any truncation is present, or
    - `quality.overall < 5`.
  - **ok** otherwise.
- **Team disagreement (Team Perspectives)**
  - `disagreement_score` is always in `[0, 1]`.
  - `has_team_disagreement === true` when both are true:
    - `participant_count >= 3`.
    - `disagreement_score >= 0.4`.

These thresholds are deterministic, shared between server and SDK, and are not
per-tenant configuration. They are intentionally conservative so that UI can
surface "use with caution" or "team is split" states using only metadata.

### 2.3 Error and failure-mode mapping

The finaliser maps key failure modes as follows:

- **Upstream timeout**
  - Trigger: draft pipeline throws `UpstreamTimeoutError`.
  - HTTP: `504`.
  - `code: "CEE_TIMEOUT"`, `retryable: true`.
- **Guard violations (caps / cost)**
  - Trigger: `validateResponse` returns `{ ok: false, violation }`.
  - HTTP: `400`.
  - `code: "CEE_GRAPH_INVALID"` for `CAP_EXCEEDED` / `INVALID_COST`,
    else `"CEE_VALIDATION_FAILED"`.
  - `details.guard_violation` plus `details.validation_issues`.
- **Bad input / validation**
  - Underlying `BAD_INPUT` → `CEE_VALIDATION_FAILED` (400, not retryable).
- **Rate limited**
  - Underlying `RATE_LIMITED` → `CEE_RATE_LIMIT` (429, retryable).
- **Service unavailable**
  - `statusCode === 503` → `CEE_SERVICE_UNAVAILABLE` (503, retryable).
- **Internal error**
  - Default mapping when no more specific case applies → `CEE_INTERNAL_ERROR` (500).
- **Engine degraded**
  - If request carries `X-Olumi-Degraded`, finaliser sets
    `trace.engine.degraded = true` and appends a warning `CEEValidationIssue`
    with `code: "ENGINE_DEGRADED"`.
- **Repro mismatch**
  - If pipeline result includes `repro_mismatch: true`, finaliser appends a
    warning `CEEValidationIssue` with `code: "CEE_REPRO_MISMATCH"`.


## 3. Local Usage

### 3.1 Running tests

- Unit tests for the CEE finaliser:
  - `pnpm test tests/unit/cee.draft-pipeline.test.ts`
- Integration tests for the CEE route:
  - `pnpm test tests/integration/cee.draft-graph.test.ts`
- Telemetry behaviour tests:
  - `pnpm test tests/integration/cee.telemetry.test.ts`

These cover:

- Response caps and `response_limits` metadata.
- Error and failure-mode mappings.
- Telemetry events and privacy posture.

### 3.2 Dev-only demo harness

A small CLI harness is available for local experimentation:

```bash
pnpm cee:demo
```

- Implementation: `scripts/cee-demo-cli.ts`.
- Behaviour:
  - Calls `/assist/v1/draft-graph` on the local service with two synthetic briefs:
    - A generic decision model.
    - A pricing decision with `archetype_hint = "pricing_decision"`.
  - Prints a compact summary only:
    - Graph node/edge counts.
    - `response_limits` and `*_truncated` flags.
    - `trace` summary (request ID, engine provider/model, degraded flag).
    - `quality.overall` and validation issue counts/codes.
  - Does **not** print raw briefs or LLM text.
- Safety:
  - Disabled by default in production. To opt in:

    ```bash
    NODE_ENV=production CEE_DEMO_ALLOW_PROD=true pnpm cee:demo
    ```

In addition, two small dev-only CLIs are available for local inspection and
linting. These are examples only and are **not** part of the public SDK
surface:

- `pnpm cee:review` – reads CEE envelopes or a `CeeDecisionReviewPayload` (for
  example the golden Decision Review fixture) and prints a compact,
  metadata-only summary suitable for debugging and wiring Scenario-style UIs.
- `pnpm cee:prompt-lint` – lints local prompt templates provided as JSON and
  flags patterns that might log or persist raw prompts/user text.

### 3.3 SDK usage for CEE

The TypeScript SDK exposes a CEE-specific client and helpers so that Sandbox and
integrations never have to talk to raw REST.

```ts
import {
  createCEEClient,
  getCEETrace,
  getCEEQualityOverall,
  getCEEValidationIssues,
  ceeAnyTruncated,
  isRetryableCEEError,
  buildDecisionStorySummary,
  buildCeeHealthSummary,
  mapCeeHealthStatusToTone,
  buildCeeJourneySummary,
  buildCeeUiFlags,
  buildCeeEngineStatus,
  type CEEDraftGraphRequestV1,
  type CEEOptionsRequestV1,
  type CEESensitivityCoachRequestV1,
  type CeeHealthSummary,
  type CeeJourneySummary,
  type CeeUiFlags,
  type CeeEngineStatus,
} from "@olumi/assistants-sdk";

const cee = createCEEClient({
  apiKey: process.env.OLUMI_API_KEY!,
  baseUrl: process.env.OLUMI_BASE_URL, // optional, defaults to production
});

// Example: draft → options → sensitivity
const draftBody: CEEDraftGraphRequestV1 = {
  brief: "Draft a simple pricing decision model for a new SaaS feature.",
};

const draft = await cee.draftGraph(draftBody);

const optionsBody: CEEOptionsRequestV1 = {
  graph: draft.graph as any,
  archetype: draft.archetype,
};

const options = await cee.options(optionsBody);

const sensitivityBody: CEESensitivityCoachRequestV1 = {
  graph: draft.graph as any,
  archetype: draft.archetype,
};

const sensitivity = await cee.sensitivityCoach(sensitivityBody);

// Common helper usage
const trace = getCEETrace(sensitivity);
const overall = getCEEQualityOverall(sensitivity);
const issues = getCEEValidationIssues(sensitivity);
const anyTruncated = ceeAnyTruncated(sensitivity);

// Build a single "decision story" summary across multiple CEE tools
const story = buildDecisionStorySummary({
  draft,
  options,
  sensitivity,
});

// Build a per-envelope health summary suitable for UI chips / banners
const health: CeeHealthSummary = buildCeeHealthSummary("options", options);

// Optionally map health status to a simple tone for UI components
const tone = mapCeeHealthStatusToTone(health.status);

// Or build a combined journey summary with per-envelope health and an overall tone
const journey: CeeJourneySummary = buildCeeJourneySummary({ draft, options, sensitivity });

// Optionally derive a small set of UI-ready flags from the journey
const uiFlags: CeeUiFlags = buildCeeUiFlags(journey);

// Optionally summarise engine status (provider/model/degraded) across envelopes
const engineStatus: CeeEngineStatus | undefined = buildCeeEngineStatus({
  draft,
  options,
  sensitivity,
});

// Example usage in UI layer (conceptual):
// - story.headline / key_drivers → high-level decision story copy
// - health.status → semantic status (ok/warning/risk)
// - tone / journey.health.overallTone → generic visual variant (e.g. success/warning/danger)
// - health.reasons → show short, generic messages (no user content)
// - health.any_truncated → highlight when CEE applied list caps
// - journey.is_complete / journey.missing_envelopes → whether all CEE tools have been run
//   and which have not (e.g. ["evidence", "team"])
// - uiFlags.has_high_risk_envelopes → drive a "Use with caution" banner
// - uiFlags.has_team_disagreement → show a "Team is split" badge
// - uiFlags.has_truncation_somewhere → show a "Partial view (capped)" chip
// - uiFlags.is_journey_complete → show/hide a "Journey incomplete" warning
```

For a slightly more complete, copy-pastable example that wires the TypeScript
SDK against a running service, see `sdk/typescript/src/examples/ceeJourneyExample.ts`
in this repository.

For canonical CEE usage patterns ("draft-only", "draft + options", full
journey, and deferred tools across multiple envelopes), see
`recipes.md`.

For an illustrative, metadata-only **golden Decision Review** bundle and a
CLI-style summary formatter (useful as a reference when wiring PLoT  UI), see:
- `sdk/typescript/src/examples/cee-decision-review.v1.example.json`
- `sdk/typescript/src/examples/ceeDecisionReviewFixtureExample.ts`

The JSON fixture models a small, self-contained bundle combining
`CeeDecisionReviewPayload`, `CeeTraceSummary`, `CeeEngineStatus`, and an
optional `CeeErrorView`. It is safe to copy/clone into engine or UI repos as a
starting point when sketching a `ceeReview`-style contract.

These fixtures are examples only; the live contract remains the combination of
OpenAPI, the CEE v1 guide, and the TypeScript SDK types.

For backoff and retry policies, you can centralise logic on
`isRetryableCEEError(error)` which understands:

- `OlumiNetworkError` (always retryable).
- `OlumiAPIError` when:
  - HTTP status is `429`.
  - CEE error `code === "CEE_RATE_LIMIT"`.
  - The server marks a CEE error as retryable via `retryable` / `cee_retryable`.
    - In practice this covers cases such as `CEE_TIMEOUT` and
      `CEE_SERVICE_UNAVAILABLE` where the finaliser sets `retryable: true`.

### 3.4 How to interpret CEE at a glance

When wiring CEE into a product UI, most decisions can be guided by a small set
of metadata from the SDK helpers:

- **Story (`DecisionStorySummary`)**
  - `headline` / `key_drivers` → high-level narrative about the decision.
  - `risks_and_gaps` / `next_actions` → generic prompts on what to check next.
- **Per-envelope health (`CeeHealthSummary`)**
  - `status` → `ok` / `warning` / `risk` per CEE tool.
  - `reasons` → short, content-free explanations (e.g. truncation, missing evidence).
- **Journey summary (`CeeJourneySummary`)**
  - `health.overallStatus` / `health.overallTone` → a single top-level signal for the journey.
  - `is_complete` / `missing_envelopes` → whether all CEE tools have been run and which are still missing.
  - `has_team_disagreement` → whether Team Perspectives reports material disagreement.
- **UI flags (`CeeUiFlags`)**
  - `has_high_risk_envelopes` → show a "Use with caution" or "Investigate issues" banner.
  - `has_team_disagreement` → show a "Team is split" indicator and encourage a conversation.
  - `has_truncation_somewhere` → highlight that the view is partial (lists were capped).
  - `is_journey_complete` → drive "Journey incomplete" reminders or disabled actions.

These fields are all derived from quality scores, validation metadata, counts, and
truncation flags. They never require inspecting user text or LLM outputs, and they
mirror the same signals that appear in CEE telemetry events.

### 3.5 Helper performance and bench harness

CEE helpers are designed to be **lightweight and linear** in the amount of
metadata they process:

- Story, health, journey, and decision-review helpers all run in-memory over
  existing CEE envelopes (draft, options, evidence, bias, sensitivity, team,
  explain) without making any network or LLM calls.
- Complexity is roughly proportional to the number of envelopes and list
  items (options, evidence items, bias findings, sensitivity suggestions,
  team perspectives) provided.

For maintainers who change helper logic and want to sanity-check performance,
a small **dev-only micro-benchmark** is available in this repo:

- Script: `scripts/cee-bench-helpers.ts` (not wired into production or CI).
- Usage (from repo root):

  ```bash
  pnpm tsx scripts/cee-bench-helpers.ts
  # optionally, control iterations (default 2000):
  CEE_BENCH_ITERS=5000 pnpm tsx scripts/cee-bench-helpers.ts
  ```

On a typical developer laptop, thousands of "heavy" journeys (with hundreds
of options and evidence items plus team metadata) can be summarised in well
under a second, so helper overhead is usually negligible compared to network
latency and upstream engine time. The bench harness exists primarily as a
guard rail for future changes.


## 4. Operational Notes

### 4.1 Rate limiting

- Per-feature, in-memory rate limiting for CEE Draft My Model:
  - Env: `CEE_DRAFT_RATE_LIMIT_RPM` (default `5`).
  - Keyed by API key ID (when present) or client IP.
- On 429 responses:
  - HTTP: `429`.
  - Body: `CEEErrorResponseV1` with `code: "CEE_RATE_LIMIT"`, `retryable: true`.
  - Headers and details:
    - `Retry-After` header (seconds).
    - `details.retry_after_seconds` in the body.

### 4.2 Telemetry

CEE v1 emits structured, privacy-safe telemetry events for each CEE endpoint (see
`src/utils/telemetry.ts` and `tests/integration/cee.telemetry.test.ts`). Event names are
frozen in `TelemetryEvents` and enforced by tests.

- **Draft My Model** (`/assist/v1/draft-graph`)
  - `cee.draft_graph.requested` (`CeeDraftGraphRequested`)
    - Fields: `request_id`, `feature`, `has_seed`, `has_archetype_hint`, `api_key_present`.
  - `cee.draft_graph.succeeded` (`CeeDraftGraphSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `graph_nodes`, `graph_edges`,
      `has_validation_issues`, `any_truncated`, `engine_provider`, `engine_model`.
  - `cee.draft_graph.failed` (`CeeDraftGraphFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

- **Explain My Model** (`/assist/v1/explain-graph`)
  - `cee.explain_graph.requested` (`CeeExplainGraphRequested`)
    - Fields: `request_id`, `feature`, `has_context_id`, `api_key_present`.
  - `cee.explain_graph.succeeded` (`CeeExplainGraphSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `target_count`, `driver_count`,
      `engine_provider`, `engine_model`, `has_validation_issues`.
  - `cee.explain_graph.failed` (`CeeExplainGraphFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

- **Evidence Helper** (`/assist/v1/evidence-helper`)
  - `cee.evidence_helper.requested` (`CeeEvidenceHelperRequested`)
    - Fields: `request_id`, `feature`, `evidence_count`, `api_key_present`.
  - `cee.evidence_helper.succeeded` (`CeeEvidenceHelperSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `evidence_count`, `strong_count`,
      `any_unsupported_types`, `any_truncated`, `has_validation_issues`.
  - `cee.evidence_helper.failed` (`CeeEvidenceHelperFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

- **Bias Check** (`/assist/v1/bias-check`)
  - `cee.bias_check.requested` (`CeeBiasCheckRequested`)
    - Fields: `request_id`, `feature`, `has_archetype`, `api_key_present`.
  - `cee.bias_check.succeeded` (`CeeBiasCheckSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `bias_count`, `any_truncated`,
      `has_validation_issues`.
  - `cee.bias_check.failed` (`CeeBiasCheckFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

- **Options Helper** (`/assist/v1/options`)
  - `cee.options.requested` (`CeeOptionsRequested`)
    - Fields: `request_id`, `feature`, `has_archetype`, `api_key_present`.
  - `cee.options.succeeded` (`CeeOptionsSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `option_count`, `any_truncated`,
      `has_validation_issues`.
  - `cee.options.failed` (`CeeOptionsFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

- **Sensitivity Coach** (`/assist/v1/sensitivity-coach`)
  - `cee.sensitivity_coach.requested` (`CeeSensitivityCoachRequested`)
    - Fields: `request_id`, `feature`, `has_inference`, `api_key_present`.
  - `cee.sensitivity_coach.succeeded` (`CeeSensitivityCoachSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `driver_count`, `any_truncated`,
      `has_validation_issues`.
  - `cee.sensitivity_coach.failed` (`CeeSensitivityCoachFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

- **Team Perspectives** (`/assist/v1/team-perspectives`)
  - `cee.team_perspectives.requested` (`CeeTeamPerspectivesRequested`)
    - Fields: `request_id`, `feature`, `participant_count`, `api_key_present`.
  - `cee.team_perspectives.succeeded` (`CeeTeamPerspectivesSucceeded`)
    - Fields: `request_id`, `latency_ms`, `quality_overall`, `participant_count`,
      `disagreement_score`, `has_validation_issues`.
  - `cee.team_perspectives.failed` (`CeeTeamPerspectivesFailed`)
    - Fields: `request_id`, `latency_ms`, `error_code`, `http_status`.

All `*.failed` events share the same minimal error shape validated in tests:

- `request_id: string`
- `latency_ms: number`
- `error_code: string` (CEE error code, e.g. `CEE_RATE_LIMIT`, `CEE_VALIDATION_FAILED`).
- `http_status: number` (400/429/500 etc.).

In addition to these events, the service writes a single structured
`cee.call` log entry for each CEE v1 request via `src/cee/logging.ts` and
maintains a small in-memory ring buffer of recent calls. This buffer is exposed
in a metadata-only form via the optional `/diagnostics` endpoint when
`CEE_DIAGNOSTICS_ENABLED=true`. Both the log entries and diagnostics payloads:

- Remain metadata-only (IDs, booleans, counts, numeric latencies, error codes).
- Never include briefs, graphs, prompts, or LLM text.

**Operational notes for CEE telemetry**:

- CEE `cee.*` events are **debug-only** today: they have **no Datadog metric mappings** yet,
  but their names and payload keys are frozen and enforced by tests.
- All fields are IDs, booleans, numbers, or short codes/enums.

In practice, the core CEE telemetry fields line up directly with the metadata used by
`CEEGuidanceV1`, `DecisionStorySummary`, and `CeeHealthSummary` in the SDK:

- `quality_overall` → feeds quality bands (low/medium/high) in guidance and story/health
  summaries.
- `has_validation_issues` → mirrors whether `validation_issues` are present and drives
  warning/risk language.
- `any_truncated` and list counts (e.g. `option_count`, `bias_count`, `participant_count`)
  → indicate when CEE applied deterministic caps and how "rich" each envelope is.

This means dashboards built on top of existing `cee.*.succeeded` events can approximate the
same health/guidance posture that clients see via the SDK, without adding new telemetry
events or logging any user content.

For a more operations-focused walkthrough of how to turn these events into
dashboards and alerts, see `telemetry-playbook.md`.

For incident response checklists (triage, mitigation levers, and when to
escalate), see `incident-runbook.md`.

### 4.3 Feature flags and configuration

Key environment variables relevant to CEE v1:

- `LLM_PROVIDER` – selects underlying LLM adapter (e.g. `fixtures` for tests).
- `CEE_DRAFT_FEATURE_VERSION` – version string surfaced in `X-CEE-Feature-Version` header.
- `CEE_DRAFT_RATE_LIMIT_RPM` – per-feature CEE rate limit per key/IP.
- `COST_MAX_USD` – maximum allowed cost per draft response (shared guard).

### 4.2 CEE response headers

CEE v1 endpoints return a small, consistent set of headers alongside the JSON
envelopes. These mirror the fields that appear in CEE trace metadata and help
downstream systems correlate calls:

- `X-CEE-API-Version`
  - Currently always `v1`.
  - Allows future additive evolution (e.g. `v2`) without breaking existing
    clients.
- `X-CEE-Feature-Version`
  - Per-endpoint feature/version string (e.g. `draft-model-1.0.0`,
    `bias-check-test`).
  - Backed by `CEE_*_FEATURE_VERSION` environment variables for each CEE
    endpoint.
- `X-CEE-Request-ID`
  - Stable request identifier for this CEE call.
  - Matches `trace.request_id` on the response body; tests assert that these
    remain in sync.

Consumers should:

- Prefer `trace.request_id` inside the envelope for UI and SDK-level logic.
- Use the headers when integrating with proxies, observability tooling, or
  systems that primarily see HTTP metadata.


## 5. Where to Look in the Codebase

- Endpoint wiring: `src/routes/assist.v1.draft-graph.ts`.
- CEE finaliser and failure-mode mapping: `src/cee/validation/pipeline.ts`.
- OpenAPI contracts: `openapi.yaml` (plus `src/generated/openapi.d.ts`).
- Telemetry events: `src/utils/telemetry.ts`.
- Tests:
  - `tests/unit/cee.draft-pipeline.test.ts`
  - `tests/integration/cee.draft-graph.test.ts`
  - `tests/integration/cee.telemetry.test.ts`

For guidance on evolving CEE safely (invariants, key surfaces, tests, and
common pitfalls), see `maintainers-guide.md`.

For a reference downstream consumer (Sandbox/Scenario-style service layer and
UI contract), see `sandbox-integration.md`.

## 6. Streaming for CEE v1

CEE v1 is **JSON-only**: there is no CEE-specific streaming route such as
`/assist/v1/draft-graph/stream`.

The existing streaming surface (`/assist/draft-graph/stream`) remains the
source of truth for SSE and resume tokens. CEE wrappers intentionally sit on
top of the synchronous draft pipeline so that:

- The CEE finaliser has full visibility of the completed graph.
- `quality` and `validation_issues` are computed once, deterministically.
- CEE remains easy to reason about and test.

If and when CEE streaming is introduced, it will be specified explicitly in
OpenAPI (new path + event schema) and wired through the same CEE finaliser.
For v1, the decision to stay JSON-only is recorded in
`Docs/ADR-CEE-streaming-v1.md`.
