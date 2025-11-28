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
      - `previous_graph?: Graph` – when `CEE_REFINEMENT_ENABLED=true`, an existing graph
        to refine instead of drafting from scratch. The server may summarise this
        graph when building the refinement prompt.
      - `refinement_mode?: "auto" | "expand" | "prune" | "clarify"` – optional hint
        for how the draft pipeline should treat the previous graph (add options,
        simplify, clarify labels, etc.).
      - `refinement_instructions?: string` – short natural-language instructions for how
        to refine the existing graph. Treated as part of the prompt and never
        logged or emitted in telemetry.
      - `preserve_nodes?: string[]` – list of node IDs that should be preserved during
        refinement (CEE avoids removing or renaming these nodes when applying
        structural changes).
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
    - `draft_warnings?: CEEStructuralWarningV1[]` – optional structural warnings derived from graph topology only (IDs, enums, counts) when `CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED=true`.
      - Examples include `no_outcome_node`, `orphan_node`, `cycle_detected`, `decision_after_outcome`.
      - Each warning only references node/edge IDs plus a short explanation string; no labels or prompts are logged or surfaced.
    - `confidence_flags?: CEEConfidenceFlagsV1` – optional machine-friendly flags derived from structural diagnostics and response caps:
      - `uncertain_nodes?: string[]` – node IDs that participate in structural warnings.
      - `simplification_applied?: boolean` – true when CEE applied structural simplification (e.g. cycle-breaking, pruning) or list caps.
      - `guidance?: { summary: string; risks?: string[]; next_actions?: string[]; any_truncated?: boolean }` – a small, heuristic
        guidance block derived from quality, validation_issues, and response_limits. This is meant for UI hints and summaries and
        never includes raw user content.

- **Explain My Model**
  - `POST /assist/v1/explain-graph`
  - Summarises a graph in a CEE-friendly way and exposes deterministic quality + limits.
  - **Request**
    - Body: `CEEExplainGraphRequestV1` – wraps an existing graph (same shape as the draft pipeline emits) plus an `inference` blob
      (`summary`, optional `explain.top_drivers`, optional `model_card`, `seed`, `response_hash`, optional `context_id`).
  - **Response (success) **– `CEEExplainGraphResponseV1`
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
      - Optional `seed?: string` field is accepted and used as a deterministic tie-breaker when ordering bias findings.
  - **Response (success)** – `CEEBiasCheckResponseV1`
    - `trace`, `quality`, `validation_issues?`.
    - `bias_findings: [...]` – structured bias findings (codes, severities, node IDs).
      - Findings are ordered deterministically by severity, category, ID, and (optionally) the caller-provided `seed`; given the same input graph and seed, ordering is stable.
      - Each finding includes a canonical `code` and structured `targets` (node IDs only) suitable for UI highlighting.
      - When a finding’s `code` matches the internal bias library (e.g. `CONFIRMATION_BIAS`, `SUNK_COST`, `BASE_RATE_NEGLECT`), CEE populates additional metadata:
        - `mechanism` – short description of the cognitive mechanism.
        - `citation` – canonical reference (authors + venue).
        - `micro_intervention` – small, time-bounded intervention (`steps[]`, `estimated_minutes`).
      - **Structural detectors (v1, optional):** when `CEE_BIAS_STRUCTURAL_ENABLED=true`, CEE enables additional graph-structural detectors that only use node kinds and edges (no free text or prompts), for example:
        - **Structural confirmation bias** when one option has explicit risks/outcomes connected while alternatives have none.
        - **Structural sunk cost bias** when a single option has multiple attached actions consistent with “keep investing in the current path”.
      - These detectors are additive and **opt-in by env flag**; turning them off does not change existing non-structural findings.
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
- **Empty draft graph**
  - Trigger: draft pipeline reports `kind: "success"` but the final graph has zero nodes after validation/repair.
  - HTTP: `400`.
  - `code: "CEE_GRAPH_INVALID"`, `retryable: false`.
  - `details.reason === "empty_graph"` and `details.node_count` / `details.edge_count` are populated for debugging and telemetry.
  - This is a hard invariant: CEE **never** returns a successful `CEEDraftGraphResponseV1` with an empty graph.
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
  buildCeeBiasStructureSnapshot,
  buildCeeCausalValidationStats,
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
// - uiFlags.bias_structure_snapshot → show a "Structural warnings" badge
// - uiFlags.causal_validation_stats → show a "Causal validation" badge

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

## 4. Troubleshooting empty draft graphs

This section describes how to recognise and investigate the hard invariant that
CEE never returns a successful draft graph with zero nodes.

- **What clients see**
  - `/assist/v1/draft-graph` returns HTTP `400`.
  - Envelope is a CEE error with `code: "CEE_GRAPH_INVALID"` and
    `retryable: false`.
  - `error.details.reason === "empty_graph"`.
  - `error.details.node_count` and `error.details.edge_count` are populated for
    quick inspection in logs and dashboards.
- **Telemetry to inspect**
  - `CeeDraftGraphFailed` event emitted by the finaliser includes
    `graph_nodes`, `graph_edges` and the `empty_graph` context.
  - Legacy `/assist/draft-graph` emits a `GuardViolation` /
    `assist.draft.guard_violation` event with `reason: "empty_graph"` so that
    empty-graph incidents are visible for both legacy and CEE callers.
- **Logs to inspect**
  - `logCeeCall` entries for the request have `status = "error"` and
    `errorCode = "CEE_GRAPH_INVALID"`.
  - Graph node/edge counts are included in the log payload, helping separate
    empty graphs from other validation/guard failures.
- **Typical remediation steps**
  - Inspect upstream LLM adapter prompts/fixtures that produced an empty graph
    and tighten prompts or fixtures as needed.
  - Check external graph validation rules to ensure they are not unexpectedly
    normalising to an empty graph.
  - Confirm that any intermediate repair/stabilisation logic is not dropping
    all nodes/edges due to overly strict filters.

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
- **Bias structure & causal validation helpers**
  - `buildCeeBiasStructureSnapshot`  builds a metadata-only snapshot of draft
    structural warnings and bias findings (counts grouped by severity, category,
    and bias code). Suitable for dashboards and structural health views.
  - `buildCeeCausalValidationStats`  summarises ISL causal validation metadata
    from `CEEBiasCheckResponseV1` (validated vs identifiable biases, average
    causal strength, confidence bands, and evidence strength mix). This helper
    only inspects structured fields such as `causal_validation` and
    `evidence_strength` and never inspects free-text explanations or labels.
  - `buildCeeDecisionHealthSnapshot`  combines the structural bias snapshot
    and causal validation stats into a compact, metadata-only view that is
    convenient for Decision Health dashboards.

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

**CallerContext enrichment:** When requests are authenticated, all telemetry events
automatically include:

- `key_id: string` – API key identifier (derived from CallerContext).
- `correlation_id?: string` – Optional correlation ID for cross-service tracing.

These fields are added via `contextToTelemetry(callerCtx)` spread at the start of each
emit call. Unauthenticated requests fall back to `{ request_id }` only.

- **Draft My Model** (`/assist/v1/draft-graph`)
  - `cee.draft_graph.requested` (`CeeDraftGraphRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `has_seed`, `has_archetype_hint`, `api_key_present`.
  - `cee.draft_graph.succeeded` (`CeeDraftGraphSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `graph_nodes`, `graph_edges`,
      `has_validation_issues`, `any_truncated`, `engine_provider`, `engine_model`.
  - `cee.draft_graph.failed` (`CeeDraftGraphFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

- **Explain My Model** (`/assist/v1/explain-graph`)
  - `cee.explain_graph.requested` (`CeeExplainGraphRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `has_context_id`, `api_key_present`.
  - `cee.explain_graph.succeeded` (`CeeExplainGraphSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `target_count`, `driver_count`,
      `engine_provider`, `engine_model`, `has_validation_issues`.
  - `cee.explain_graph.failed` (`CeeExplainGraphFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

- **Evidence Helper** (`/assist/v1/evidence-helper`)
  - `cee.evidence_helper.requested` (`CeeEvidenceHelperRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `evidence_count`, `api_key_present`.
  - `cee.evidence_helper.succeeded` (`CeeEvidenceHelperSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `evidence_count`, `strong_count`,
      `any_unsupported_types`, `any_truncated`, `has_validation_issues`.
  - `cee.evidence_helper.failed` (`CeeEvidenceHelperFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

- **Bias Check** (`/assist/v1/bias-check`)
  - `cee.bias_check.requested` (`CeeBiasCheckRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `has_archetype`, `api_key_present`.
  - `cee.bias_check.succeeded` (`CeeBiasCheckSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `bias_count`, `any_truncated`,
      `has_validation_issues`.
  - `cee.bias_check.failed` (`CeeBiasCheckFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

- **Options Helper** (`/assist/v1/options`)
  - `cee.options.requested` (`CeeOptionsRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `has_archetype`, `api_key_present`.
  - `cee.options.succeeded` (`CeeOptionsSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `option_count`, `any_truncated`,
      `has_validation_issues`.
  - `cee.options.failed` (`CeeOptionsFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

- **Sensitivity Coach** (`/assist/v1/sensitivity-coach`)
  - `cee.sensitivity_coach.requested` (`CeeSensitivityCoachRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `has_inference`, `api_key_present`.
  - `cee.sensitivity_coach.succeeded` (`CeeSensitivityCoachSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `driver_count`, `any_truncated`,
      `has_validation_issues`.
  - `cee.sensitivity_coach.failed` (`CeeSensitivityCoachFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

- **Team Perspectives** (`/assist/v1/team-perspectives`)
  - `cee.team_perspectives.requested` (`CeeTeamPerspectivesRequested`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `feature`, `participant_count`, `api_key_present`.
  - `cee.team_perspectives.succeeded` (`CeeTeamPerspectivesSucceeded`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `quality_overall`, `participant_count`,
      `disagreement_score`, `has_validation_issues`.
  - `cee.team_perspectives.failed` (`CeeTeamPerspectivesFailed`)
    - Fields: `request_id`, `key_id?`, `correlation_id?`, `latency_ms`, `error_code`, `http_status`.

All `*.failed` events share the same minimal error shape validated in tests:

- `request_id: string`
- `key_id?: string` (when authenticated)
- `correlation_id?: string` (when provided via CallerContext)
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
- `CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED` – when `true`, enables structural draft warnings (`draft_warnings`) and confidence flags (`confidence_flags`) on `CEEDraftGraphResponseV1`. Default: `false`.
- `CEE_BIAS_STRUCTURAL_ENABLED` – when `true`, enables additional graph-structural bias detectors (e.g. confirmation bias and sunk cost) inside Bias Check. Default: `false`.
- `CEE_PRE_DECISION_CHECKS_ENABLED` – when `true`, includes pre-decision checklist and framing nudges in draft responses. Default: `false`.
- `CEE_BIAS_CONFIDENCE_THRESHOLD` – minimum confidence score (0–1) for bias findings to be reported. Findings below this threshold are filtered out. Default: `0.3`.
- `CEE_CACHE_RESPONSE_ENABLED` – when `true`, enables in-memory caching for draft-graph responses. Default: `false`.
- `CEE_CACHE_RESPONSE_TTL_MS` – cache entry TTL in milliseconds. Default: `300000` (5 minutes).
- `CEE_CACHE_RESPONSE_MAX_SIZE` – maximum number of cache entries. Default: `100`.

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


### 4.4 Enhanced Clarification Flow

The clarification flow (`/assist/clarify-brief`) now includes readiness assessment
to help determine if a brief is ready for drafting. When enabled, clarification
responses include:

- **Readiness factors** – five numeric scores (0–1) for:
  - `length_score` – adequate length for meaningful analysis.
  - `clarity_score` – clear language without excessive ambiguity.
  - `decision_relevance_score` – actually relates to a decision.
  - `specificity_score` – concrete details vs. vague statements.
  - `context_score` – sufficient background information.
- **Readiness level** – derived from the overall score:
  - `ready` (score ≥ 0.7) – proceed to drafting.
  - `needs_clarification` (0.4 ≤ score < 0.7) – ask targeted questions.
  - `not_ready` (score < 0.4) – requires substantial clarification.
- **Weakest factor** – identifies which factor to focus on.
- **Targeted questions** – auto-generated based on weakest factors.

Configuration:

- `CEE_PREFLIGHT_ENABLED` – enables preflight validation. Default: `false`.
- `CEE_PREFLIGHT_STRICT` – reject briefs that fail preflight. Default: `false`.
- `CEE_PREFLIGHT_READINESS_THRESHOLD` – minimum readiness score. Default: `0.4`.

Implementation: `src/cee/validation/readiness.ts`, `src/routes/assist.clarify-brief.ts`.

### 4.5 Pre-Decision Checklist and Framing Nudges

When `CEE_PRE_DECISION_CHECKS_ENABLED=true`, draft responses include contextual
pre-decision checks and framing nudges derived from graph structure:

**Pre-Decision Checks** (max 5):

- Categories: `completeness`, `bias`, `scope`, `stakeholders`, `reversibility`.
- Each check includes:
  - `id` – unique identifier (e.g. `check_options_count`).
  - `question` – the check question.
  - `why_it_matters` – brief rationale.
  - `suggested_action` – optional next step.

**Framing Nudges** (max 3):

- Types: `anchoring_warning`, `scope_prompt`, `alternatives_prompt`, `time_pressure`, `sunk_cost`.
- Each nudge includes:
  - `id` – unique identifier.
  - `type` – nudge category.
  - `message` – the nudge text.
  - `severity` – `info` or `warning`.

Example checks generated:

- Too few options (< 3) → prompts for alternatives.
- No risks identified → suggests identifying risks.
- Unbalanced analysis → warns about confirmation bias.
- Complex graph → suggests scope clarification.

Implementation: `src/cee/validation/pre-decision-checks.ts`.

### 4.6 Bias Confidence Scoring

Bias findings now include confidence scores to reduce false positives.

**How it works:**

- Each bias finding is assigned a `confidence` score (0–1).
- Confidence is calculated from severity and evidence strength.
- Findings below `CEE_BIAS_CONFIDENCE_THRESHOLD` are filtered out.

**Confidence calculation:**

- Severity multiplier: `high` = 0.9, `medium` = 0.7, `low` = 0.5.
- Evidence strength varies by finding type (e.g., more options lacking evidence = higher confidence for confirmation bias).
- Final confidence = `severity_multiplier × evidence_strength`, clamped to [0, 1].

**Filtering:**

```ts
import { filterByConfidence } from "./src/cee/bias/index.js";

const filtered = filterByConfidence(findings, 0.5); // Only findings with confidence ≥ 0.5
```

Implementation: `src/cee/bias/index.ts`.

### 4.7 Response Caching

When `CEE_CACHE_RESPONSE_ENABLED=true`, draft-graph responses are cached in memory
to reduce redundant LLM calls for identical briefs.

**Cache behaviour:**

- Keys are generated from normalized brief text (lowercase, collapsed whitespace).
- Context (if provided) is included in the cache key.
- Cache is TTL-based with LRU eviction when at capacity.

**Configuration:**

- `CEE_CACHE_RESPONSE_ENABLED` – enable/disable caching. Default: `false`.
- `CEE_CACHE_RESPONSE_TTL_MS` – TTL in milliseconds. Default: `300000` (5 min).
- `CEE_CACHE_RESPONSE_MAX_SIZE` – max entries. Default: `100`.

**Usage:**

```ts
import { getOrCompute, isCachingEnabled, resetCache } from "./src/cee/cache/index.js";

const result = await getOrCompute(brief, context, async () => {
  // Expensive computation
  return await generateDraftGraph(brief);
});

if (result.cached) {
  console.log("Cache hit!");
}
```

**Cache stats:**

```ts
import { getDraftGraphCache } from "./src/cee/cache/index.js";

const stats = getDraftGraphCache().getStats();
// { size, hits, misses, evictions, hitRate }
```

Implementation: `src/cee/cache/index.ts`.

## 5. Where to Look in the Codebase

- Endpoint wiring: `src/routes/assist.v1.draft-graph.ts`.
- CEE finaliser and failure-mode mapping: `src/cee/validation/pipeline.ts`.
- OpenAPI contracts: `openapi.yaml` (plus `src/generated/openapi.d.ts`).
- Telemetry events: `src/utils/telemetry.ts`.
- Readiness assessment: `src/cee/validation/readiness.ts`.
- Pre-decision checks: `src/cee/validation/pre-decision-checks.ts`.
- Bias detection: `src/cee/bias/index.ts`.
- Response caching: `src/cee/cache/index.ts`.
- Clarify-brief route: `src/routes/assist.clarify-brief.ts`.
- Tests:
  - `tests/unit/cee.draft-pipeline.test.ts`
  - `tests/integration/cee.draft-graph.test.ts`
  - `tests/integration/cee.telemetry.test.ts`
  - `tests/unit/cee.readiness-assessment.test.ts`
  - `tests/unit/cee.pre-decision-checks.test.ts`
  - `tests/unit/cee.bias.test.ts`
  - `tests/unit/cee.cache.test.ts`

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


## 7. Frozen Contracts

### 7.1 CeeDecisionReviewPayload v1 (Frozen)

**Schema:** `schemas/cee-decision-review.v1.json`
**Status:** Frozen. Additive-only changes permitted.

The `CeeDecisionReviewPayload` contract is **frozen** for PLoT and UI consumption.
This payload provides a structured view of a CEE decision review with recommendations,
bias findings, and structural issues.

**Artifacts:**

- **JSON Schema:** `schemas/cee-decision-review.v1.json`
- **Golden Fixture:** `tests/fixtures/cee-decision-review.v1.golden.json`
- **TypeScript Type:** `CeeDecisionReviewPayloadV1` (from `sdk/typescript/src/types/cee-decision-review.ts`)

**Contract Guarantees:**

- `schema` field always equals `"cee.decision-review.v1"`
- `version` field always equals `"1.0.0"`
- Required fields: `decision_id`, `review.summary`, `review.confidence`, `review.recommendations`
- All other fields optional

**Schema Structure:**

```
CeeDecisionReviewPayload
├── schema: "cee.decision-review.v1" (const, required)
├── version: "1.0.0" (const, required)
├── decision_id: string (required)
├── scenario_id?: string | null
├── review: Review (required)
│   ├── summary: string (required)
│   ├── confidence: number 0-1 (required)
│   ├── quality_band?: "high" | "medium" | "low"
│   ├── recommendations: Recommendation[] (required)
│   │   ├── id: string (required)
│   │   ├── priority: "high" | "medium" | "low" (required)
│   │   ├── message: string (required)
│   │   ├── action?: string
│   │   └── affected_nodes?: string[]
│   ├── bias_findings?: BiasFinding[]
│   │   ├── code: string (required)
│   │   ├── severity: "critical" | "high" | "medium" | "low" (required)
│   │   ├── message: string (required)
│   │   ├── confidence?: number 0-1
│   │   ├── affected_node_ids?: string[]
│   │   └── micro_intervention?: { steps: string[], estimated_minutes: number }
│   ├── structural_issues?: StructuralIssue[]
│   │   ├── code: string (required)
│   │   ├── severity: "error" | "warning" | "info" (required)
│   │   ├── message: string (required)
│   │   └── affected_node_ids?: string[]
│   └── strengths?: string[]
├── trace?: Trace
│   ├── request_id?: string
│   ├── correlation_id?: string
│   ├── latency_ms?: integer
│   └── model_version?: string
└── meta?: Meta
    ├── created_at?: string (ISO 8601)
    ├── graph_hash?: string
    └── seed?: integer
```

**For PLoT Integration:**

- Validate responses against schema before processing
- Handle missing optional fields gracefully
- Use `trace.request_id` for debugging

**For UI Integration:**

- Display `review.summary` as primary feedback
- Render `recommendations` as actionable items
- Show `bias_findings` in Insights tab
- Highlight `affected_node_ids` on canvas

**Evolution Policy:**

- **Additive only:** New optional fields may be added to any schema.
- **No removals:** Required fields and structure cannot be removed in v1.
- **No type changes:** Field types are frozen.
- **Breaking changes:** Require a new major version (v2).

**Validation Tests:**

- `tests/validation/cee.decision-review.schema.test.ts` – validates fixture against JSON Schema


## 8. Model Selection (Tiered Model Routing)

CEE v1 supports intelligent model selection to optimize cost and latency while
maintaining quality for critical tasks. This feature is **disabled by default**
and must be explicitly enabled via feature flag.

### 8.1 Overview

The model selection system routes CEE tasks to different LLM models based on:

1. **Task complexity** – Simple tasks (clarification, preflight) use fast models;
   complex tasks (draft_graph, bias_check) use quality models.
2. **User override** – Power users can request specific models via the
   `X-CEE-Model-Override` header.
3. **Quality gates** – Critical tasks cannot be downgraded even if explicitly
   requested.

### 8.2 Model Tiers

| Tier     | Model         | Use Cases                           | Latency | Cost      |
|----------|---------------|-------------------------------------|---------|-----------|
| fast     | gpt-4o-mini   | clarification, preflight, explainer | ~800ms  | $0.15/1k  |
| quality  | gpt-4o        | draft_graph, bias_check, options    | ~1500ms | $2.50/1k  |
| premium  | claude-sonnet | Reserved for future use             | ~2000ms | $3.00/1k  |

### 8.3 Task-to-Model Defaults

```typescript
const TASK_MODEL_DEFAULTS = {
  clarification: "gpt-4o-mini",    // Fast tier
  preflight: "gpt-4o-mini",        // Fast tier
  draft_graph: "gpt-4o",           // Quality tier (protected)
  bias_check: "gpt-4o",            // Quality tier (protected)
  evidence_helper: "gpt-4o-mini",  // Fast tier
  sensitivity_coach: "gpt-4o",     // Quality tier
  options: "gpt-4o",               // Quality tier
  explainer: "gpt-4o-mini",        // Fast tier
  repair_graph: "gpt-4o",          // Quality tier
  critique_graph: "gpt-4o",        // Quality tier
};
```

### 8.4 User Override via Header

Power users can request a specific model using the `X-CEE-Model-Override` header:

```bash
# Request fast tier for all eligible tasks
curl -X POST /assist/v1/draft-graph \
  -H "X-CEE-Model-Override: _fast" \
  -d '{"brief": "..."}'

# Request specific model
curl -X POST /assist/v1/evidence-helper \
  -H "X-CEE-Model-Override: gpt-4o-mini" \
  -d '{"evidence": [...]}'
```

**Supported override values:**

| Value       | Behaviour                                      |
|-------------|------------------------------------------------|
| `_default`  | Use task default model                         |
| `_fast`     | Use fast tier (gpt-4o-mini) for eligible tasks |
| `_quality`  | Use quality tier (gpt-4o) for all tasks        |
| `gpt-4o`    | Request specific model                         |
| `gpt-4o-mini` | Request specific model                       |

### 8.5 Quality Gates

Certain tasks are **protected** and cannot be downgraded to fast tier via user
override:

- `draft_graph` – Core value delivery, must use quality model
- `bias_check` – Safety-critical, must use quality model

If a user requests `_fast` or `gpt-4o-mini` for these tasks, the system:

1. Ignores the override
2. Uses the quality-tier default
3. Adds a warning to response headers

**Important:** Quality gates apply to **user overrides only** (via
`X-CEE-Model-Override` header). Server-side configuration via `CEE_MODEL_TASK_*`
environment variables is trusted and not gated. Operators should take care when
setting per-task overrides for quality-required tasks.

### 8.6 Response Headers

CEE responses include debugging headers showing model selection:

| Header                      | Description                              |
|-----------------------------|------------------------------------------|
| `X-CEE-Model-Used`          | Actual model used (e.g., `gpt-4o-mini`)  |
| `X-CEE-Model-Tier`          | Model tier (`fast`, `quality`, `premium`)|
| `X-CEE-Model-Source`        | How model was selected                   |
| `X-CEE-Model-Warnings`      | Any warnings (e.g., override rejected)   |
| `X-CEE-Model-Original-Request` | Original request if fallback occurred |

**Source values:**

- `default` – Used task default model
- `override` – User override was accepted
- `env` – Task-specific env var override
- `fallback` – Primary model unavailable, used fallback
- `legacy` – Feature disabled, using legacy behaviour

### 8.7 Configuration

| Environment Variable               | Default | Description                        |
|------------------------------------|---------|------------------------------------|
| `CEE_MODEL_SELECTION_ENABLED`      | `false` | Enable model selection feature     |
| `CEE_MODEL_OVERRIDE_ALLOWED`       | `true`  | Allow user override via header     |
| `CEE_MODEL_FALLBACK_ENABLED`       | `true`  | Enable automatic fallback          |
| `CEE_MODEL_QUALITY_GATE_ENABLED`   | `true`  | Enforce quality gates              |
| `CEE_MODEL_LATENCY_ANOMALY_MS`     | `10000` | Latency anomaly threshold          |

**Per-task overrides (optional):**

```bash
CEE_MODEL_CLARIFICATION=gpt-4o        # Override clarification default
CEE_MODEL_DRAFT_GRAPH=gpt-4o          # Override draft_graph default
CEE_MODEL_BIAS_CHECK=gpt-4o           # Override bias_check default
```

### 8.8 Telemetry Events

Model selection emits structured telemetry events (log-only; no StatsD mapping
yet):

| Event                          | Description                        |
|--------------------------------|------------------------------------|
| `cee.model.selected`           | Model selection completed          |
| `cee.model.override_accepted`  | User override was applied          |
| `cee.model.override_rejected`  | User override was rejected         |
| `cee.model.quality_gate_applied` | Quality gate prevented downgrade |
| `cee.model.fallback_applied`   | Fallback model was used            |
| `cee.llm.call.latency_anomaly` | Latency exceeded threshold         |

These events are useful for debugging model selection decisions. Future work may
add StatsD counters for operational dashboards.

### 8.9 Implementation Details

**Key files:**

- Model registry: `src/config/models.ts`
- Task routing: `src/config/model-routing.ts`
- Selection service: `src/services/model-selector.ts`
- LLM adapter integration: `src/adapters/llm/router.ts`
- Configuration: `src/config/index.ts` (modelSelection section)

**Tests:**

- Unit tests: `tests/unit/model-selector.test.ts` (52 tests)
- Routing tests: `tests/unit/model-routing.test.ts` (29 tests)

### 8.10 Rollout Strategy

Model selection is feature-flagged for safe rollout:

1. **Phase 1:** Disabled by default (`CEE_MODEL_SELECTION_ENABLED=false`)
   - All requests use legacy behaviour (gpt-4o for everything)
   - Response headers show `source: "legacy"`

2. **Phase 2:** Opt-in enablement
   - Enable for specific environments or tenants
   - Monitor latency and quality metrics

3. **Phase 3:** Default enablement
   - Enable for all traffic once validated
   - Keep quality gates enforced
