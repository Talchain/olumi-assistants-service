# CEE Decision Review Orchestrator (PLoT)

Last updated: 2025-11-21

This doc captures the "Freeze & Furnish" slice for the CEE Decision Review
path as exercised by the PLoT engine. It should be read together with:

- `Docs/Olumi - CEE–Scenario–PLoT Integration SSOT v10.md` (primary SSOT)
- `Docs/CEE-v1.md` (CEE endpoints & helper semantics)
- `Docs/CEE-sandbox-integration.md` (Scenario-side consumption patterns)

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

For POC v02:

- Changes to Decision Review must be **additive + optional only**:
  - New optional fields on existing objects.
  - New objects referenced only from optional properties.
- **Breaking changes are not allowed** for v1, including:
  - Renaming/removing existing fields.
  - Changing enums or value semantics in a way that would break existing
    consumers.

Any future Decision Review versions should:

- Add a new schema (e.g. `CeeDecisionReviewPayloadV2`).
- Add a parallel TS alias under `src/contracts/cee/`.
- Keep v1 available and documented for as long as PLoT / UI depend on it.
