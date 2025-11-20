# CEE Sandbox / Scenario Integration Brief

This document describes how a downstream UI or Scenario/Sandbox app (for
example, the `DecisionGuideAI` repo) can work with CEE v1 envelopes and SDK
helpers.

The **canonical integration spec** between CEE, PLoT, and the Scenario UI is:

- `Docs/Olumi - CEE–Scenario–PLoT Integration SSOT v10.md`.

That SSOT defines that, in production:

- Only PLoT calls CEE using the TypeScript SDK.
- The Scenario UI never calls CEE directly; it reads `ceeReview` / `ceeTrace` /
  `ceeError` from PLoT APIs.

This brief should be treated as a **reference** for how to consume CEE
envelopes and helpers, not as a deployment pattern for UI code to call CEE
directly.

All examples here are **metadata-only**:

- They never log or inspect prompts, graphs, or LLM outputs.
- They rely only on structured metadata (error codes, trace IDs, counts,
  booleans) and the SDK helpers documented in `Docs/CEE-v1.md`.

---

## 1. Recommended consumer types (service layer)

Downstream apps should define a small CEE integration service module, e.g.
`src/services/ceeService.ts`, based on the following types.

```ts
import type { CeeDecisionReviewPayload } from "@olumi/assistants-sdk";

export interface ScenarioCeeConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface ScenarioDecision {
  id: string;
  title: string;
  createdAt: string;
}

export interface ScenarioCeeDecisionReview {
  decisionId: string;
  createdAt: string;
  cee: CeeDecisionReviewPayload | null;
  retryable: boolean;
  errorCode?: string;
  traceId?: string;
}

export interface ScenarioCeeError {
  code?: string;
  retryable: boolean;
  traceId?: string;
}
```

These types intentionally keep CEE metadata under a single `cee` key and expose
only safe identifiers and error/trace metadata to the rest of the app.

---

## 2. Service-layer API (in the UI / Scenario repo)

In the downstream app, we recommend a single service function along the lines
of:

```ts
import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  isRetryableCEEError,
  type CeeDecisionReviewPayload,
} from "@olumi/assistants-sdk";

export async function buildScenarioCeeDecisionReview(
  decision: ScenarioDecision,
  config: ScenarioCeeConfig,
): Promise<ScenarioCeeDecisionReview> {
  const client = createCEEClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeoutMs ?? 60_000,
  });

  try {
    // 1) Draft My Model – decision-specific brief (do not log this).
    const draft = await client.draftGraph({
      brief: decision.title, // or another decision-specific prompt
    } as any);

    // 2) Options Helper.
    const options = await client.options({
      graph: draft.graph as any,
      archetype: draft.archetype,
    } as any);

    // 3) Evidence Helper (optional but recommended).
    const evidence = await client.evidenceHelper({
      evidence: [], // app-specific evidence items
    } as any);

    // 4) Bias Check (optional but recommended).
    const bias = await client.biasCheck({
      graph: draft.graph as any,
      archetype: draft.archetype,
    } as any);

    // 5) Team Perspectives (optional, if the product has team data).
    const team = await client.teamPerspectives({
      perspectives: [],
    } as any);

    const cee: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft,
      options,
      evidence,
      bias,
      team,
    });

    // Optional: compute a coarse evidence coverage summary for UX hints.
    // This helper uses only counts and response_limits; it never inspects
    // evidence content.
    const evidenceCoverage = buildCeeEvidenceCoverageSummary({
      evidence,
      requestedCount:  scenarioEvidenceItems.length,
    });

    return {
      decisionId: decision.id,
      createdAt: decision.createdAt,
      cee,
      retryable: false,
      errorCode: undefined,
      traceId: cee.trace?.request_id,
    };
  } catch (error) {
    const retryable = isRetryableCEEError(error);

    // Optionally inspect OlumiAPIError + ErrorResponse to lift CEE error code
    // and trace IDs into a simple app-level error object. See
    // `sdk/typescript/src/examples/ceeScenarioServiceExample.ts` for a
    // concrete reference implementation.

    return {
      decisionId: decision.id,
      createdAt: decision.createdAt,
      cee: null,
      retryable,
      errorCode: undefined, // populate from structured error metadata if needed
      traceId: undefined,   // populate from structured error metadata if needed
    };
  }
}
```

For a fully worked example (including error-code and trace extraction), see
`sdk/typescript/src/examples/ceeScenarioServiceExample.ts` in this repo.

---

## 3. Endpoint ordering and journey completeness

A typical v1 integration for a Scenario/Sandbox-style product should:

1. **Always call** `draftGraph`.
2. **Usually call** `options`.
3. **Optionally call** (depending on UX and cost):
   - `evidence-helper`
   - `bias-check`
   - `team-perspectives`
   - `sensitivity-coach` (if sensitivity concerns are a first-class concept).

`buildCeeDecisionReviewPayload` will:

- Compute a `story` (headline, key drivers, risks/gaps, next actions).
- Build a `journey` with per-envelope health and missing envelopes.
- Derive `uiFlags` summarising the overall posture.

This mirrors the behaviour described in `Docs/CEE-v1.md` and exercised in the
hero journey tests under `tests/integration/`.

---

## 3.5 Multi-step / deferred journeys and persistence

Many Sandbox/Scenario flows will collect CEE envelopes over time:

- Draft now, options soon after.
- Evidence and bias checks once more context is available.
- Team perspectives only when collaborators have weighed in.

We recommend storing CEE envelopes on your own decision record and treating
`CeeDecisionReviewPayload` as a **projection** you can rebuild on demand.

Example record shape in the UI repo:

```ts
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1,
  CEESensitivityCoachResponseV1,
  CEETeamPerspectivesResponseV1,
} from "@olumi/assistants-sdk";

interface ScenarioDecisionRecord {
  id: string;
  createdAt: string;
  cee?: {
    draft?: CEEDraftGraphResponseV1;
    options?: CEEOptionsResponseV1;
    evidence?: CEEEvidenceHelperResponseV1;
    bias?: CEEBiasCheckResponseV1;
    sensitivity?: CEESensitivityCoachResponseV1;
    team?: CEETeamPerspectivesResponseV1;
  };
}
```

On each tool run, update only the relevant envelope:

```ts
async function saveCeeEnvelope(
  id: string,
  key: keyof NonNullable<ScenarioDecisionRecord["cee"]>,
  envelope: NonNullable<ScenarioDecisionRecord["cee"]>[typeof key],
) {
  // app-specific persistence; e.g. PATCH /decisions/:id
}
```

When you need a fresh decision review, rebuild it from whatever envelopes are
present:

```ts
import { buildCeeDecisionReviewPayload } from "@olumi/assistants-sdk";

function projectCeeDecisionReview(record: ScenarioDecisionRecord) {
  const cee = record.cee ?? {};

  return buildCeeDecisionReviewPayload({
    draft: cee.draft,
    options: cee.options,
    evidence: cee.evidence,
    bias: cee.bias,
    sensitivity: cee.sensitivity,
    team: cee.team,
  });
}
```

`journey.is_complete` and `journey.missing_envelopes` then give you a
deterministic completeness signal based on which envelopes are persisted so
far; `uiFlags` will safely reflect truncation, disagreement, and high-risk
envelopes at each step.

---

## 4. Interpreting CeeUiFlags in the UI

Downstream UIs should treat CEE as a **set of hints** and avoid over-rotating
on any single flag.

Key flags (returned as `review.cee.uiFlags`):

- `has_high_risk_envelopes`
  - At least one envelope is in `risk` health.
  - Suggested UX: show a prominent "Use with caution" banner.

- `has_truncation_somewhere`
  - At least one envelope hit deterministic caps (e.g. options or evidence
    truncated).
  - Suggested UX: show a "Partial view (capped)" chip near the CEE panel.

- `has_team_disagreement`
  - Team Perspectives reports meaningful disagreement.
  - Suggested UX: "Team is split" badge or similar.

- `is_journey_complete`
  - `true` when all known envelopes are present (draft, explain, options,
    evidence, bias, sensitivity, team).
  - If `false`, check `journey.missing_envelopes` for which envelopes are
    absent and surface a subtle completeness indicator.

Downstream UIs should *not* attempt to parse the underlying CEE envelopes
beyond these helpers; instead, rely on `CeeDecisionReviewPayload` and
`CeeUiFlags`.

---

## 5. Error handling semantics

Downstream clients should:

- Use `isRetryableCEEError(error)` and `getCeeErrorMetadata(error)` (or the
  higher-level `buildCeeErrorViewModel(error)`) to decide whether a failed CEE
  call may be retried and what code/trace ID to surface.
- Treat 4xx errors without retry hints as non-retryable and surface a static
  failure state.
- Expose a structured app-level error object:

```ts
import { getCeeErrorMetadata } from "@olumi/assistants-sdk";

interface ScenarioCeeError {
  code?: string;      // from meta.ceeCode, if present
  retryable: boolean; // from meta.retryable
  traceId?: string;   // from meta.traceId, if present
}

function toScenarioCeeError(error: unknown): ScenarioCeeError {
  const meta = getCeeErrorMetadata(error);
  return {
    code: meta.ceeCode,
    retryable: meta.retryable,
    traceId: meta.traceId,
  };
}
```

A recommended pattern is:

- Keep `ScenarioCeeDecisionReview` focused on the happy path (`cee` payload).
- Use a separate `ScenarioCeeError` object in UI props for error states.

---

## 6. Recommended React props and UI wiring

In the UI repo (`DecisionGuideAI`), we recommend a focused component that owns
"Decision Review", for example:

```ts
interface DecisionReviewProps {
  review: ScenarioCeeDecisionReview | null;
  loading: boolean;
  error?: { code?: string; retryable: boolean };
}
```

High-level rendering logic:

- While `loading === true` and `review === null`:
  - Show a skeleton or spinner.
- When `error` is present:
  - If `error.retryable === true`, show a banner plus a "Retry" affordance.
  - Otherwise, show a static failure message and optional guidance.
- When `review?.cee` is present:
  - Render headline and key drivers from `review.cee.story`.
  - Use `review.cee.uiFlags` for banners/chips.
  - Use `review.cee.journey.missing_envelopes` to show completeness.

Example JSX (simplified):

```tsx
function DecisionReviewPanel({ review, loading, error }: DecisionReviewProps) {
  if (loading && !review) return <Spinner />;
  if (error) {
    return (
      <ErrorBanner
        code={error.code}
        retryable={error.retryable}
      />
    );
  }
  if (!review || !review.cee) return null;

  const { story, journey, uiFlags } = review.cee;

  return (
    <section>
      <h2>{story.headline}</h2>
      {/* chips / badges based on uiFlags */}
      {/* completeness indicator based on journey.is_complete and missing_envelopes */}
    </section>
  );
}
```

---

## 7. Related docs

For anyone working on CEE itself (this repo):

- `Docs/CEE-v1.md` – CEE endpoints, judgement policy, and helper semantics.
- `Docs/CEE-recipes.md` – canonical usage patterns and hero journeys.
- `Docs/CEE-telemetry-playbook.md` – telemetry fields and dashboards.
- `Docs/CEE-incident-runbook.md` – incident triage and mitigation.
- `Docs/CEE-maintainers-guide.md` – invariants, key surfaces, and tests.

For downstream UI / Scenario repos:

- Use the SSOT as the primary integration reference for how `ceeReview`,
  `ceeTrace`, and `ceeError` appear on PLoT APIs.
- Treat this document as a secondary reference that explains how to work with
  CEE envelopes and helpers (for local tooling, sandboxes, or understanding
  what PLoT is doing under the hood).
- Use `sdk/typescript/src/examples/ceeScenarioServiceExample.ts` as a concrete
  service-layer reference, but remember that in production the Scenario UI
  should talk to PLoT, not CEE.
