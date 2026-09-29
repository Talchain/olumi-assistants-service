# CEE Decision Review Orchestrator (PLoT)

Last updated: 2025-11-21

This doc captures the "Freeze & Furnish" slice for the CEE Decision Review
path as exercised by the PLoT engine. It should be read together with:

- `Docs/Olumi - CEE–Scenario–PLoT Integration SSOT v10.md` (primary SSOT)
- `v1.md` (CEE endpoints & helper semantics)
- `sandbox-integration.md` (Scenario-side consumption patterns)

## 1. Responsibilities (D1–D7, condensed)

From the SSOT (D1–D7) and CEE v1 guide:

- **Single integration surface (D1)**
  - PLoT and UI integrate with CEE via the **TypeScript SDK** only.
  - Downstream clients must not consume raw OpenAPI schemas directly.
- **Who calls CEE (D2)**
  - **Only PLoT calls CEE.**
  - Scenario UI / Sandbox never calls CEE or the Assistants service directly.
  - UI reads `ceeReview` / `ceeTrace` / `ceeError` from PLoT APIs.
- **Where CEE sits (D3)**
  - CEE is an optional "decision review" step on top of an existing
    `report.v1` / engine result.
  - Engine responses must remain valid even if CEE is degraded or disabled.
- **Determinism & stability (D4–D6, v1)**
  - CEE behaviour is deterministic in practice with respect to:
    - decision brief + attachments,
    - graph and inference inputs,
    - CEE configuration (caps, thresholds, provider/model),
    - `seed` values.
  - The v1 Decision Review payload is **frozen** for POC v02:
    - Contract name: `CeeDecisionReviewPayloadV1` (OpenAPI)
    - SDK type: `CeeDecisionReviewPayload`
    - Server alias: `src/contracts/cee/decision-review.ts`
  - Future v1 changes must be additive + optional only.
- **Config & keys (D7)**
  - CEE secrets (API keys, base URL) live on the engine / PLoT side.
  - UI must never hold CEE credentials or talk to CEE endpoints directly.

## 2. Frozen payload: `CeeDecisionReviewPayloadV1`

The canonical v1 Decision Review payload is defined in:

- **OpenAPI schema**: `components.schemas.CeeDecisionReviewPayloadV1`
- **Server type alias**: `src/contracts/cee/decision-review.ts`
- **Doc-only response example**: `components.responses.CeeDecisionReviewPayloadV1Example`
  (used for engine/PLoT documentation; not exposed as a primary product
  surface).

Shape (high level, metadata-only):

- `story: DecisionStorySummaryV1`
  - `headline: string`
  - `key_drivers: string[]`
  - `risks_and_gaps: string[]`
  - `next_actions: string[]`
  - `any_truncated: boolean`
  - `quality_overall?: number (1–10)`
- `journey: CeeJourneySummaryV1`
  - `story: DecisionStorySummaryV1` (mirrors `story` for redundancy)
  - `health: CeeJourneyHealthV1`
    - `perEnvelope: Partial<Record<"draft" | "explain" | "evidence" | "bias" | "options" | "sensitivity" | "team", CeeHealthSummaryV1>>`
    - `overallStatus: "ok" | "warning" | "risk"`
    - `overallTone: "success" | "warning" | "danger"`
    - `any_truncated: boolean`
    - `has_validation_issues: boolean`
  - `is_complete: boolean`
  - `missing_envelopes: ("draft" | "explain" | "evidence" | "bias" | "options" | "sensitivity" | "team")[]`
  - `has_team_disagreement: boolean`
- `uiFlags: CeeUiFlagsV1`
  - `has_high_risk_envelopes: boolean`
  - `has_team_disagreement: boolean`
  - `has_truncation_somewhere: boolean`
  - `is_journey_complete: boolean`
- `trace?: { request_id?: string; correlation_id?: string }`

This mirrors the existing SDK helper surface in
`sdk/typescript/src/ceeHelpers.ts` (`CeeDecisionReviewPayload`) and is
explicitly **metadata-only**:

- No prompts or briefs.
- No graph labels or node/edge text.
- No LLM outputs.

A golden v1 payload fixture exists at:

- `tests/fixtures/cee/cee-decision-review.v1.json`

and is validated by:

- `tests/validation/cee.decision-review.fixture.test.ts`

For OpenAPI discoverability and operator tooling, there is also an **internal,
env-gated** example endpoint:

- `GET /assist/v1/decision-review/example` – returns a static
  `CeeDecisionReviewPayloadV1` object backed by the same canonical example as
  the fixture above. This route is:
  - Protected by the standard API key auth plugin.
  - Only registered when `CEE_DECISION_REVIEW_EXAMPLE_ENABLED="true"` on the
    Assistants service.
  - Intended for documentation/ops and should not be called by PLoT or UI
    directly (PLoT should use the SDK helpers instead).

## 3. Orchestrator flow (PLoT → CEE → PLoT → UI)

### 3.1 High-level sequence

1. PLoT owns the full decision context (graph, report, scenario metadata).
2. When a Decision Review is requested, PLoT calls one or more CEE endpoints
   using the **TypeScript SDK** (`createCEEClient`):
   - `/assist/v1/draft-graph`
   - `/assist/v1/options`
   - `/assist/v1/evidence-helper`
   - `/assist/v1/bias-check`
   - `/assist/v1/team-perspectives`
   - `/assist/v1/sensitivity-coach` (optional)
3. PLoT aggregates the resulting CEE envelopes into a `CeeJourneyEnvelopes`
   structure.
4. PLoT calls `buildCeeDecisionReviewPayload(envelopes)` in the SDK.
5. PLoT attaches the resulting `CeeDecisionReviewPayload` (v1-frozen shape) to
   its own API response as `ceeReview`, along with:
   - `ceeTrace: CeeTraceSummary` (from `buildCeeTraceSummary`),
   - `ceeError: CeeErrorView` (when applicable).
6. Scenario / UI reads only `ceeReview` / `ceeTrace` / `ceeError` from PLoT and
   never talks to CEE directly.

### 3.2 Pseudocode sketch (engine side)

```ts
import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  buildCeeTraceSummary,
  buildCeeErrorView,
  type CeeDecisionReviewPayload,
  type CeeTraceSummary,
  type CeeIntegrationReviewBundle,
  buildCeeIntegrationReviewBundle,
} from "@olumi/assistants-sdk";

interface EngineCeeConfig {
  apiKey: string;        // e.g. process.env.CEE_API_KEY
  baseUrl?: string;      // e.g. process.env.CEE_BASE_URL
  timeoutMs?: number;
}

async function runDecisionReview(config: EngineCeeConfig): Promise<CeeIntegrationReviewBundle> {
  const cee = createCEEClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeoutMs ?? 60_000,
  });

  try {
    const draft = await cee.draftGraph({ brief: "ENGINE_DECISION_BRIEF_DO_NOT_LOG" } as any);
    const options = await cee.options({ graph: draft.graph as any, archetype: draft.archetype } as any);
    const evidence = await cee.evidenceHelper({ evidence: [] } as any);
    const bias = await cee.biasCheck({ graph: draft.graph as any, archetype: draft.archetype } as any);
    const team = await cee.teamPerspectives({ perspectives: [] } as any);

    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft,
      options,
      evidence,
      bias,
      team,
    });

    const trace: CeeTraceSummary | null = buildCeeTraceSummary({
      trace: draft.trace as any,
      engineStatus: undefined,
    });

    return buildCeeIntegrationReviewBundle({ review, trace });
  } catch (error) {
    const ceeError = buildCeeErrorView(error);
    return buildCeeIntegrationReviewBundle({ error: ceeError });
  }
}
```

This is illustrative only; see the concrete examples in:

- `sdk/typescript/src/examples/ceeEngineOrchestratorExample.ts`
- `sdk/typescript/src/examples/ceeScenarioServiceExample.ts`

### 3.3 What the UI sees

A typical PLoT API might expose:

```ts
interface EngineScenarioReview {
  id: string;
  createdAt: string;
  ceeReview: CeeDecisionReviewPayload | null;
  ceeTrace: CeeTraceSummary | null;
  ceeError?: { code?: string; retryable: boolean; traceId?: string };
}
```

- UI components render only `ceeReview` / `ceeTrace` / `ceeError`.
- UI never:
  - calls CEE endpoints,
  - holds CEE API keys,
  - inspects raw prompts, briefs, graphs, or LLM text.

## 4. Versioning and evolution

- v1 contract name: **`CeeDecisionReviewPayloadV1`**.
- Server alias: `CeeDecisionReviewPayloadV1` in
  `src/contracts/cee/decision-review.ts`.
- SDK surface: `CeeDecisionReviewPayload` and helpers in
  `sdk/typescript/src/ceeHelpers.ts`.
- Error surface: `CeeErrorViewModel` in the SDK exposes a
  `suggestedAction` union of **`"retry" | "fix_input" | "fail"`**, which is
  part of the frozen v1 integration surface for this POC.

For POC v02:

- Changes to Decision Review must be **additive + optional only**:
  - New optional fields on existing objects.
  - New objects referenced only from optional properties.
- **Breaking changes are not allowed** for v1, including:
  - Renaming/removing existing fields.
  - Changing enums or value semantics in a way that would break existing
    consumers (including the `CeeErrorViewModel.suggestedAction` union).

Any future Decision Review versions should:

- Add a new schema (e.g. `CeeDecisionReviewPayloadV2`).
- Add a parallel TS alias under `src/contracts/cee/`.
- Keep v1 available and documented for as long as PLoT / UI depend on it.

## 5. Golden journeys as reference scenarios (PLoT-style)

The CEE golden journeys in this repo provide concrete, metadata-only examples
that PLoT can use as reference scenarios when wiring Decision Review.

### 5.1 Healthy product decision (high band, no disagreement)

- Fixture: `tests/fixtures/cee/golden-journeys/healthy_product_decision.json`.
- Description:
  - Strong structure, adequate evidence, no truncation or validation issues.
  - Expectations:
    - `expected_quality_band = "high"`.
    - `expect_any_truncated = false`.
    - `expect_has_validation_issues = false`.
    - `expect_has_team_disagreement = false`.

**Engine/PLoT orchestration sketch:**

1. Build a `CeeGoldenJourneyInput`-style structure from the fixture inputs
   (mirroring `buildCeeGoldenJourneyInputFromFixtureInputs`):

   - `draftBrief = "Synthetic: Decide how to grow product revenue for a single offering."`.
   - `draftArchetypeHint = "product_decision"`.
   - `evidenceItems = [{id: "e1", type: "experiment"}, {id: "e2", type: "user_research"}]`.
   - `teamPerspectives` from the fixture.

2. Call CEE via the SDK using `createCEEClient`:

   - `draft = cee.draftGraph({ brief: draftBrief, seed, archetype_hint: draftArchetypeHint })`.
   - `options = cee.options({ graph: draft.graph, archetype: draft.archetype })`.
   - `evidence = cee.evidenceHelper({ evidence: evidenceItems })`.
   - `bias = cee.biasCheck({ graph: draft.graph, archetype: draft.archetype })`.
   - `team = cee.teamPerspectives({ perspectives: teamPerspectives })`.

3. Build the Decision Review payload and trace bundle:

   - `review = buildCeeDecisionReviewPayload({ draft, options, evidence, bias, team })`.
   - `trace = buildCeeTraceSummary({ trace: draft.trace, engineStatus })`.
   - `bundle = buildCeeIntegrationReviewBundle({ review, trace })`.

4. Expose `bundle.review` as `ceeReview` and `bundle.trace` as `ceeTrace` on the
   PLoT API response for this scenario.

In this journey, PLoT should see:

- `review.journey.health.overallStatus = "ok"` and `overallTone = "success"`.
- `review.journey.health.any_truncated = false`.
- `review.journey.health.has_validation_issues = false`.
- `review.uiFlags.has_high_risk_envelopes = false`.
- `review.uiFlags.has_team_disagreement = false`.

### 5.2 Team disagreement (high disagreement, mixed band)

- Fixture: `tests/fixtures/cee/golden-journeys/team_disagreement.json`.
- Description:
  - Multiple options and materially split team perspectives.
  - Expectations:
    - `expected_quality_band = "medium"`.
    - `expect_any_truncated = false`.
    - `expect_has_validation_issues = false`.
    - `expect_has_team_disagreement = true`.

**Engine/PLoT orchestration sketch:**

1. Build a `CeeGoldenJourneyInput`-style structure from the fixture inputs:

   - `draftBrief = "Synthetic: Decide whether to pivot product strategy."`.
   - `draftArchetypeHint = "product_strategy_decision"`.
   - `teamPerspectives` as given in the fixture.

2. Call CEE via the SDK:

   - `draft = cee.draftGraph({ brief: draftBrief, archetype_hint: draftArchetypeHint })`.
   - `team = cee.teamPerspectives({ perspectives: teamPerspectives })`.
   - (Options/evidence/bias are optional; PLoT may choose to include them depending on cost.)

3. Build the review payload:

   - `review = buildCeeDecisionReviewPayload({ draft, team })`.
   - `trace = buildCeeTraceSummary({ trace: draft.trace, engineStatus })`.
   - Expose `review` / `trace` via `CeeIntegrationReviewBundle` as above.

PloT and UI can then interpret disagreement flags using existing fields:

- `review.journey.has_team_disagreement = true`.
- `review.uiFlags.has_team_disagreement = true`.

UI surfaces disagreement only via these metadata fields; it never inspects the
raw team perspectives or any free-text content.

## 6. Using Decision Review from the Engine (PLoT)

For POC v02, PLoT is the **orchestrator** for Decision Review. It:

- Calls individual CEE v1 endpoints via the TypeScript SDK.
- Collapses their metadata into a `CeeDecisionReviewPayload` using
  `buildCeeDecisionReviewPayload`.
- Attaches the resulting review/trace/error to its own APIs as
  `ceeReview` / `ceeTrace` / `ceeError`.

There is **no separate Decision Review HTTP endpoint**; the orchestration
lives entirely on the engine side.

### 6.1 Engine-side client creation

PloT should create a dedicated CEE client using engine-only env vars:

```ts
import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  buildCeeTraceSummary,
  buildCeeErrorView,
  buildCeeIntegrationReviewBundle,
  type CeeDecisionReviewPayload,
  type CeeTraceSummary,
  type CeeIntegrationReviewBundle,
} from "@olumi/assistants-sdk";

const cee = createCEEClient({
  apiKey: process.env.CEE_API_KEY!,
  baseUrl: process.env.CEE_BASE_URL,
  // Best-effort: a single, time-boxed attempt per Decision Review run.
  timeout: Number(process.env.CEE_TIMEOUT_MS ?? "10000"),
});
```

Environment variables are documented in `Docs/CEE-ops.md`:

- `CEE_BASE_URL` – base URL for the Assistants service used for CEE.
- `CEE_API_KEY` – engine-side API key, never exposed to UI.
- `CEE_TIMEOUT_MS` – optional engine-level timeout in milliseconds; for POC
  v02 a **~10s** client timeout with a **single attempt** is recommended.

### 6.2 Orchestrating CEE and building the payload

A typical engine-side flow for a Decision Review run is:

```ts
async function runDecisionReviewForScenario(
  scenarioId: string,
  requestId: string,
): Promise<CeeIntegrationReviewBundle> {
  try {
    // 1) Call core CEE v1 endpoints via the SDK (brief/graph never logged).
    const draft = await cee.draftGraph({
      brief: "ENGINE_SCENARIO_DO_NOT_LOG",
    } as any);

    const options = await cee.options({
      graph: draft.graph as any,
      archetype: draft.archetype,
    } as any);

    const evidence = await cee.evidenceHelper({
      evidence: [], // engine-specific evidence IDs/types live here.
    } as any);

    const bias = await cee.biasCheck({
      graph: draft.graph as any,
      archetype: draft.archetype,
    } as any);

    const team = await cee.teamPerspectives({
      perspectives: [],
    } as any);

    // 2) Collapse envelopes into a metadata-only Decision Review payload.
    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft,
      options,
      evidence,
      bias,
      team,
    });

    // 3) Build a compact trace summary (metadata-only).
    const trace: CeeTraceSummary | null = buildCeeTraceSummary({
      trace: draft.trace as any,
      engineStatus: undefined,
      timestamp: new Date().toISOString(),
    });

    return buildCeeIntegrationReviewBundle({ review, trace });
  } catch (error) {
    // 4) Map any error into a CeeErrorViewModel; no prompts/graphs are logged.
    const ceeError = buildCeeErrorView(error);
    return buildCeeIntegrationReviewBundle({ error: ceeError });
  }
}
```

Engine/PloT responses can then expose Decision Review metadata additively:

```ts
interface EngineScenarioReview {
  id: string;
  createdAt: string;
  // Existing engine fields...
  ceeReview: CeeDecisionReviewPayload | null;
  ceeTrace: CeeTraceSummary | null;
  ceeError?: {
    code?: string;
    retryable: boolean;
    traceId?: string;
    suggestedAction: "retry" | "fix_input" | "fail";
  };
}

async function buildEngineScenarioReview(
  scenarioId: string,
  requestId: string,
): Promise<EngineScenarioReview> {
  const bundle = await runDecisionReviewForScenario(scenarioId, requestId);

  return {
    id: scenarioId,
    createdAt: new Date().toISOString(),
    ceeReview: bundle.review,
    ceeTrace: bundle.trace,
    ceeError: bundle.error,
  };
}
```

Key semantics for POC v02:

- Decision Review is **best-effort and optional**. Failures or degraded traces
  must **not** block `/v1/run` or equivalent engine APIs.
- Engines should:
  - Use a single, time-boxed attempt (~10s client timeout).
  - Treat `ceeReview` / `ceeTrace` / `ceeError` as **advisory metadata** on
    top of an already-valid report.
  - Never log or persist prompts, graphs, or LLM text when wiring CEE.
