# CEE Recipes (Usage Patterns)

This doc collects a few canonical ways to use CEE v1 in real applications.

The goal is to help backend and Sandbox/Scenario engineers go from "I have a
brief and a graph" to a safe, metadata-only decision review in a few steps.

It is **not** a protocol spec. For request/response schemas, see:

- `v1.md` – CEE endpoints, error envelopes, and judgement policy.
- `openapi.yaml` – full schema reference.

All recipes:

- Use the existing CEE v1 endpoints (`/assist/v1/*`).
- Stay strictly metadata-only on the helper side (no briefs, graphs, or LLM text).
- Are compatible with the TypeScript SDK helpers:
  - `createCEEClient`
  - `buildDecisionStorySummary`
  - `buildCeeJourneySummary`
  - `buildCeeUiFlags`
  - `buildCeeDecisionReviewPayload`
  - `isRetryableCEEError`

For a concrete, metadata-only example of a `CeeDecisionReviewPayload` plus
engine/trace metadata, see the golden fixture and example in the SDK:

- `sdk/typescript/src/examples/cee-decision-review.v1.example.json`
- `sdk/typescript/src/examples/ceeDecisionReviewFixtureExample.ts`

These are illustrative only; real integrations must continue to follow
OpenAPI + `v1.md` + the published SDK types as the live contract.

During development you can also inspect the same review payloads via the
dev-only CLI helper in this repo:

- `scripts/cee-review-cli.ts` (wired as `pnpm cee:review`).

This script is for local debugging only and does not change the live CEE
contract.

---

## 1. Recipe: Draft-only decision review

**When to use:**

- You want a very small integration surface to start with.
- You only call **Draft My Model** and still want a basic CEE summary.

**Endpoints:**

- `POST /assist/v1/draft-graph` → `CEEDraftGraphResponseV1`

**Helpers:**

- `buildDecisionStorySummary({ draft })`
- `buildCeeJourneySummary({ draft })`
- `buildCeeUiFlags(journey)`
- (Optionally) `buildCeeDecisionReviewPayload({ draft })`

**Behaviour:**

- Journey will be **incomplete**:
  - `journey.is_complete === false`
  - `journey.missing_envelopes` includes `"options"`, `"evidence"`, `"bias"`,
    `"sensitivity"`, `"team"`, and possibly `"explain"`.
- UI flags will focus on draft-level health only (quality, truncation, validation).

**Recommended shape:**

- For a minimal product API you can expose something like:

  - `cee.story` – human-readable but metadata-only summary.
  - `cee.health` – `journey.health`.
  - `cee.uiFlags` – from `buildCeeUiFlags`.
  - `cee.missing_envelopes` – from `journey.missing_envelopes`.

This keeps your own API stable while allowing you to add more CEE envelopes
later without breaking clients.

---

## 2. Recipe: Draft + Options (simple scenario)

**When to use:**

- You want a slightly richer view than draft-only, but without wiring all CEE
  tools.
- Typical for sandbox flows where users explore possible options for a decision.

**Endpoints:**

1. `POST /assist/v1/draft-graph` → `draft`.
2. `POST /assist/v1/options` with `graph` + `archetype` from the draft → `options`.

**Helpers:**

- `buildDecisionStorySummary({ draft, options })`
- `buildCeeJourneySummary({ draft, options })`
- `buildCeeUiFlags(journey)`
- `buildCeeDecisionReviewPayload({ draft, options })`

**Behaviour:**

- Journey remains **incomplete**:
  - `journey.missing_envelopes` will include `"evidence"`, `"bias"`,
    `"sensitivity"`, `"team"`, and optionally `"explain"`.
- Health aggregation focuses on draft + options envelopes.
- UI flags can be used to drive chips like:
  - "High-quality draft" (from quality bands).
  - "No critical validation issues".
  - "Partial CEE journey" (from `is_journey_complete`).

**Example references:**

- `sdk/typescript/src/examples/ceeJourneyExample.ts` – calls multiple endpoints
  and builds story/journey/UI flags.

---

## 3. Recipe: Full CEE journey decision review

**When to use:**

- You want the richest possible CEE interpretation for a high-value decision.
- You are comfortable calling multiple CEE endpoints in a backend or Sandbox.

**Endpoints (typical order):**

1. `POST /assist/v1/draft-graph` → `draft`.
2. `POST /assist/v1/options` → `options`.
3. `POST /assist/v1/evidence-helper` → `evidence`.
4. `POST /assist/v1/bias-check` → `bias`.
5. (Optionally) `POST /assist/v1/sensitivity-coach` → `sensitivity`.
6. `POST /assist/v1/team-perspectives` → `team`.

**Helpers:**

- `buildCeeDecisionReviewPayload({ draft, options, evidence, bias, sensitivity, team })`

This single helper call gives you:

- `story` – the high-level narrative.
- `journey` – per-envelope and overall health, completeness, and disagreement.
- `uiFlags` – booleans for high-risk envelopes, truncation, completeness, and
  team disagreement.
- `trace` – minimal `request_id` / `correlation_id` for telemetry correlation.

**Example references:**

- `tests/integration/cee.hero-journey.test.ts` – exercises the full journey
  with fixtures and asserts privacy.
- `sdk/typescript/src/examples/ceeDecisionReviewExample.ts` – builds a
  `ScenarioDecisionReview` object embedding `CeeDecisionReviewPayload` under a
  `cee` key.

---

## 4. Recipe: Deferred tools and partial journeys

**When to use:**

- Your product allows users to start with a light CEE pass and add more tools
  (evidence, bias, team) over time.
- You want your UI to reflect which parts of CEE have run so far.

**Pattern:**

1. Start with `draft` + `options` (as in Recipe 2).
2. Later, after user interaction, call `evidence-helper`, `bias-check`, or
   `team-perspectives` as needed.
3. On each refresh, feed whatever envelopes you have into:

   - `buildCeeDecisionReviewPayload({ draft, options, evidence?, bias?, sensitivity?, team? })`.

**Behaviour:**

- `journey.is_complete` will remain `false` until all known envelopes are
  present.
- `journey.missing_envelopes` gives you a deterministic list of what has not
  run yet.
- `uiFlags.has_high_risk_envelopes` / `has_truncation_somewhere` will light up
  as you add more CEE tools, but never rely on missing envelopes.

**UI ideas:**

- Use `journey.missing_envelopes` to drive a checklist or status chips:
  - "Evidence: not run yet".
  - "Bias Check: ready to run".
  - "Team Perspectives: awaiting input".
- Use `uiFlags.is_journey_complete` to show a simple badge like
  "CEE journey complete" vs "CEE journey in progress".

**Test references:**

- `tests/integration/cee.hero-journey.disagreement.test.ts` – partial journey:
  uses only the team envelope and asserts completeness/metadata behaviour.
- `tests/integration/cee.hero-journey.rate-limit.test.ts` – mid-journey failure:
  ensures the helper still produces a safe partial journey.
- `tests/integration/cee.hero-journey.heavy-truncation.test.ts` – heavy, truncation-
  focused journey that drives caps on evidence and validates journey health and
  UI flags without leaking user content.

---

## 5. Error handling and retries

All recipes should use the same error-handling pattern:

- Wrap CEE calls with `try` / `catch` and classify errors using:
  - `OlumiAPIError`
  - `OlumiNetworkError`
  - `isRetryableCEEError(error)`

For details and examples, see:

- `v1.md` – SDK usage and retry semantics section.
- `scripts/cee-demo-cli.ts` – CLI example handling retries and request IDs.

---

## 6. Recipe: Engine / orchestrator consumer

**When to use:**

- You are building a non-UI service such as an engine, orchestrator, or
  batch job that needs to make coarse-grained decisions based on CEE
  (e.g. warn, auto re-run, tag reports with health bands and trace IDs).

**Pattern:**

1. Call the usual CEE endpoints for a rich journey (see Recipe 3):
   - `draft`, `options`, `evidence`, `bias`, `team` (and optionally
     `sensitivity`).
2. Build a `CeeDecisionReviewPayload` via
   `buildCeeDecisionReviewPayload({ draft, options, evidence, bias, sensitivity, team })`.
3. Optionally compute a compact engine status summary via
   `buildCeeEngineStatus({ draft, options, evidence, bias, sensitivity, team })`.
4. Derive engine-facing actions from that payload using a small helper that
   looks only at:
   - `review.journey.health.overallStatus`
   - `review.journey.health.any_truncated`
   - `review.journey.health.has_validation_issues`
   - `review.uiFlags`
   - `review.trace?.request_id`
   - (Optionally) an engine status object built from `buildCeeEngineStatus`.

Example actions shape:

```ts
type EngineHealthBand = "ok" | "warning" | "risk";

interface EngineCeeActions {
  healthBand: EngineHealthBand;
  shouldWarn: boolean;
  shouldAutoReRun: boolean;
  traceId?: string;
}
```

Example logic (simplified):

```ts
function computeEngineCeeActions(review: CeeDecisionReviewPayload): EngineCeeActions {
  const { journey, uiFlags, trace } = review;
  const band: EngineHealthBand = journey.health.overallStatus;

  const shouldWarn =
    band !== "ok" || uiFlags.has_truncation_somewhere || uiFlags.has_team_disagreement;

  const shouldAutoReRun =
    band === "risk" &&
    (journey.health.any_truncated || journey.health.has_validation_issues);

  return {
    healthBand: band,
    shouldWarn,
    shouldAutoReRun,
    traceId: trace?.request_id,
  };
}
```

**Example references:**

- `sdk/typescript/src/examples/ceeEngineOrchestratorExample.ts` – shows an
  engine-style integration that calls CEE endpoints, builds a
  `CeeDecisionReviewPayload`, and derives coarse-grained actions without ever
  inspecting prompts or graphs.

---

## 7. Recipe: Portfolio / batch decision health

**When to use:**

- You are building a Sandbox/Scenario or engine experience that shows a list of
  decisions and wants a quick sense of overall CEE posture across them.

**Pattern:**

1. For each decision, build a `CeeDecisionReviewPayload` (see Recipes 2–4).
2. Store these alongside your own decision records.
3. (Optionally) store a compact engine status per decision using
   `buildCeeEngineStatus`.
4. Feed them into a small helper that aggregates:
   - How many decisions are `ok` / `warning` / `risk`.
   - How many have truncation, disagreement, or incomplete journeys.

Example shape:

```ts
interface PortfolioDecisionReviewItem {
  decisionId: string;
  createdAt: string;
  cee: CeeDecisionReviewPayload;
}

interface PortfolioHealthSummary {
  total_decisions: number;
  ok_count: number;
  warning_count: number;
  risk_count: number;
  has_truncation_count: number;
  has_disagreement_count: number;
  incomplete_journeys_count: number;
  degraded_engine_count: number;
}
```

**Example references:**

- `sdk/typescript/src/examples/ceePortfolioHealthExample.ts` – shows how to
  compute a `PortfolioHealthSummary` from a list of
  `CeeDecisionReviewPayload`s (and optionally engine status derived via
  `buildCeeEngineStatus`) without ever inspecting prompts or graphs.

---

## 8. External / IDE consumers

**When to use:**

- You are building an IDE extension, local tool, or other external consumer
  that should never hold CEE API keys or talk to CEE directly.
- An engine/PLoT-like backend already exposes a metadata-only `ceeReview`
  bundle (for example, similar to `CeeIntegrationReviewBundle`).

**Pattern:**

- Backend calls CEE via the SDK and builds a compact bundle combining
  `CeeDecisionReviewPayload`, `CeeTraceSummary`, and (optionally)
  `CeeEngineStatus` and an error view.
- External tools treat that bundle as **read-only input** and project it into
  their own small view models for panels or decorators.
- No prompts, briefs, graphs, or LLM text are ever surfaced to the external
  consumer; it works purely from metadata fields.

**Example references:**

- `sdk/typescript/src/examples/ceeExternalConsumerExample.ts` – shows how an
  IDE-style consumer can accept an engine-provided bundle and build a small
  view model without calling CEE or inspecting prompts/graphs.

---

## 9. Recipe: Applying graph patches client-side

**When to use:**

- You have stored a baseline `GraphV1` and want to apply a series of patches
  client-side (for example, from an engine diff tool or explain-diff endpoint).
- You want a small, deterministic helper that understands the engine-compatible
  `Graph` / `GraphPatch` contracts without reimplementing patch logic.

**Helpers:**

- `applyGraphPatch(base: GraphV1, patch: GraphPatchV1): GraphV1`

**Example:**

```ts
import {
  applyGraphPatch,
  type GraphV1,
  type GraphPatchV1,
} from "@olumi/assistants-sdk";

function applyPatchesSequentially(base: GraphV1, patches: GraphPatchV1[]): GraphV1 {
  return patches.reduce<GraphV1>((current, patch) => applyGraphPatch(current, patch), base);
}

// Given a stored graph and a patch from an engine or tooling context:
const updated: GraphV1 = applyGraphPatch(storedGraph, incomingPatch);

// Notes:
// - `applyGraphPatch` is pure and deterministic (no network calls, no logging).
// - It only manipulates graph structure (nodes/edges) and does not inspect
//   briefs, labels, or other free-text fields.
// - You are still responsible for ensuring the resulting graph respects any
//   engine limits before sending it back to CEE or the engine.
```

---

## 10. Where to go next

- For telemetry/dashboards: `telemetry-playbook.md`.
- For deeper helper semantics and thresholds:
  - `sdk/typescript/src/ceeHelpers.ts`
  - `src/cee/guidance/index.ts`
  - `src/cee/team/index.ts`

These recipes are intentionally minimal; products should extend them with their
own decision IDs, user identities, and domain-specific metadata while keeping
CEE data strictly metadata-only.

---

## 11. Recipe: Refinement loop on Draft My Model

**When to use:**

- You already have a validated `Graph` for a decision and want to iteratively
  improve it instead of drafting from scratch.
- You want to let users ask for targeted changes ("add more risks", "prune
  noise") while keeping CEE caps, validation, and telemetry behaviour
  unchanged.

**Inputs (Draft Graph request):**

- `brief` – as in the standard Draft My Model flow (short description of the
  decision and what a good model looks like).
- `previous_graph` – a prior engine-compatible `Graph` to refine.
- `refinement_mode` – optional enum hint for the refinement strategy:
  - `"auto"` – let CEE choose a reasonable refinement path.
  - `"expand"` – bias toward adding more structure (nodes/edges).
  - `"prune"` – bias toward simplifying or removing low-signal structure.
  - `"clarify"` – focus on cleaning up ambiguous or underspecified parts.
- `refinement_instructions` – optional natural-language instructions for how to
  refine the existing graph (for example, "Add more downside risks and
  outcomes" or "Clarify the causal chain between decision and outcome"). These
  instructions are treated as part of the draft prompt and are never logged or
  emitted in telemetry.
- `preserve_nodes` – optional list of node IDs that should be preserved during
  refinement. CEE will avoid removing or renaming these nodes when applying
  structural changes.

All refinement fields are **optional** and only take effect when
`CEE_REFINEMENT_ENABLED=true` on the server. When the feature flag is disabled,
CEE safely ignores the refinement fields and treats the request as a
"draft-from-scratch" call.

**Pattern:**

1. Start from a canonical graph that already passed engine validation (for
   example, a previously persisted `Graph` coming back from CEE).
2. Let the user express how they want to refine it:
   - Light-touch: set `refinement_mode: "auto"` and skip
     `refinement_instructions` / `preserve_nodes`.
   - Targeted: combine `refinement_mode` with a short
     `refinement_instructions` string.
   - Conservative: add a small `preserve_nodes` list for key nodes that should
     not be removed or renamed.
3. Build a `CEEDraftGraphRequestV1` like:

   ```ts
   const body: CEEDraftGraphRequestV1 = {
     brief: "Refine the existing pricing decision model.",
     previous_graph: existingGraph,
     refinement_mode: "expand",
     refinement_instructions: "Add more downside risks and outcomes.",
     preserve_nodes: ["goal_main", "decision_price_tier"],
   };

   const draft = await cee.draftGraph(body);
   ```

4. Treat the resulting `draft.graph` exactly like a normal Draft My Model
   response:
   - It still passes through the engine validation and repair pipeline.
   - CEE still applies the usual caps and cost guards.
   - You can feed it into the rest of the CEE journey (`options`, `evidence`,
     `bias`, etc.) or persist it as the next canonical graph.

**Behaviour and safety notes:**

- Refinement only changes how the upstream prompt is constructed; it does **not
  bypass** engine validation or CEE finalisation.
- `previous_graph` is used as structured context when building the internal
  refinement prompt. The final `draft.graph` still goes through the same
  `validateGraph` / DAG normalisation and CEE response guards as a
  draft-from-scratch request.
- When `preserve_nodes` is provided, CEE will avoid removing or renaming those
  nodes during refinement, but it may still:
  - Add new nodes/edges around them.
  - Update other parts of the graph that are not preserved.
- You remain responsible for choosing which graph becomes the new canonical
  version in your own product. A common pattern is:
  - Show the refined graph and CEE `DecisionStorySummary` / `CeeJourneySummary`
    to the user.
  - Let them explicitly accept it before persisting as the new baseline.

This refinement pattern keeps the core invariant that **all graphs exposed to
users still pass through the engine validation pipeline** while giving products
a simple, typed way to request iterative improvements.
