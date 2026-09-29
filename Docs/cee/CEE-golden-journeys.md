# CEE Golden Journeys

This document describes the small, deterministic golden-journey suite for CEE v1.

Golden journeys are **end-to-end, metadata-only flows** that exercise multiple CEE
endpoints together (draft → options → evidence-helper → bias-check → team-
perspectives) using the fixtures LLM provider.

They are intended to catch regressions in:

- Quality banding across a realistic journey.
- Truncation flags and evidence limits.
- Team disagreement heuristics.
- Telemetry coverage for multi-step CEE usage.
- Privacy guarantees for CEE metadata surfaces.

## 1. Location

- **Fixtures**: `tests/fixtures/cee/golden-journeys/`
  - `healthy_product_decision.json` – healthy, high-quality product decision with
    multiple perspectives and adequate evidence; expected to be **untruncated**,
    disagreement-free, and high-band.
  - `under_specified_strategic_decision.json` – under-specified strategic case
    with sparse inputs and low confidence; used to exercise an **incomplete but
    untruncated, disagreement-free** journey. Its quality band is governed by
    the shared CEE quality heuristics and is not treated as a strict invariant
    for this suite (low-band under-spec behaviour is covered by the calibration
    fixtures instead).
  - `evidence_heavy_with_truncation.json` – evidence-heavy journey that exceeds
    evidence-helper limits and exercises truncation flags while remaining in the
    **medium** band.
  - `team_disagreement.json` – journey with strong team disagreement (for /
    against / neutral) to exercise disagreement and team summary heuristics.
  - `long_term_strategic_bet.json` – long-horizon strategic bet with mixed
    evidence and no expected truncation; intended to exercise a medium-risk
    journey without strong team disagreement.
  - `launch_vs_delay_feature.json` – Olumi-flavoured feature-launch decision
    with mixed experiment/UX signals and realistic team perspectives (Eng
    cautious, Product/Design positive); expected to be **medium band**,
    untruncated, with low-level disagreement that may or may not cross the
    `has_team_disagreement` threshold depending on heuristics.
  - `kill_vs_pivot_experiment.json` – Olumi-flavoured growth experiment
    decision (kill vs pivot vs double down) with experiment + analytics-type
    evidence and meaningful stance differences between Growth, Data, and
    Product; expected to be **medium band**, untruncated, and to exercise
    `has_team_disagreement` in the snapshot.
  - `high_band_portfolio_prioritisation.json` – Olumi-flavoured portfolio
    decision between two strong bets for the next quarter, with rich
    experiment/user research/market evidence and broad team alignment;
    expected to be **high band** or at least non-low, untruncated, and
    disagreement-free.
- **Loader/helper**: `tests/utils/cee-golden-journeys.ts`
  - Exposes `CEE_GOLDEN_JOURNEYS` and `loadCeeGoldenJourney(id)`.
  - Fixtures are cached and deep-cloned to keep tests from mutating shared
    state.
- **Integration tests**:
  - `tests/integration/cee.golden-journeys.test.ts` – runs golden journeys
    end-to-end against `/assist/v1/*` using `LLM_PROVIDER=fixtures` and asserts
    snapshot invariants.
  - `tests/integration/cee.golden-journeys.telemetry.test.ts` – runs the
    healthy golden journey and asserts that telemetry events are emitted with
    the expected shapes and **no free-text leakage**.
- **SDK helpers**:
  - `sdk/typescript/src/examples/ceeGoldenJourneyExample.ts`
    - `buildCeeGoldenJourneySnapshot(envelopes)`
    - `runCeeGoldenJourney(client, input)`
    - `buildCeeGoldenJourneyInputFromFixtureInputs(inputs)` – convenience shim that
      takes a fixture-style `inputs` object (with `draft.brief`, optional
      `draft.archetype_hint`, `evidence.items`, and `team.perspectives`) and
      returns a `CeeGoldenJourneyInput` suitable for `runCeeGoldenJourney`.
  - Tests: `sdk/typescript/src/ceeGoldenJourneyExample.test.ts`.

## 2. Fixture shape

Each golden-journey fixture has the following shape:

```jsonc
{
  "kind": "cee_journey",
  "id": "healthy_product_decision",
  "description": "Human-readable description of the journey.",
  "inputs": {
    "draft": {
      "brief": "Synthetic: ...",          // synthetic, non-user brief
      "archetype_hint": "product_decision" // optional hint only
    },
    "evidence": {
      "items": [
        { "id": "e1", "type": "experiment" },
        { "id": "e2", "type": "user_research" }
      ]
    },
    "team": {
      "perspectives": [
        { "id": "p1", "stance": "for", "confidence": 0.8 },
        { "id": "p2", "stance": "against", "confidence": 0.7 },
        { "id": "p3", "stance": "neutral" }
      ]
    }
  },
  "expectations": {
    "expected_quality_band": "high",      // low | medium | high
    "expect_any_truncated": false,
    "expect_has_validation_issues": false,
    "expect_has_team_disagreement": false,
    "expect_is_complete": false            // journeys are partial by design
  }
}
```

The loader parses these fixtures as strongly-typed `CeeGoldenJourneyFixture`
objects and exposes `CEE_GOLDEN_JOURNEYS` for stable IDs.

## 3. SDK helpers and runner

The TypeScript SDK exposes a small example helper for collapsing CEE envelopes
into a compact, metadata-only snapshot:

- File: `sdk/typescript/src/examples/ceeGoldenJourneyExample.ts`
  - `buildCeeGoldenJourneySnapshot(envelopes: CeeJourneyEnvelopes)` →
    `CeeGoldenJourneySnapshot`
    - Computes:
      - `quality_overall` and band (`low` / `medium` / `high`) using the shared
        CEE policy thresholds.
      - `any_truncated` from journey health and UI flags.
      - `has_validation_issues` from aggregated validation issues.
      - `has_team_disagreement` from team summary and UI flags.
      - `is_complete` from the presence of all known v1 envelopes.
  - `runCeeGoldenJourney(client: CEEClient, input: CeeGoldenJourneyInput)` →
    `{ envelopes, snapshot }`
    - Orchestrates:
      - `draft-graph` using `input.draftBrief`.
      - `options` using the returned graph/archetype.
      - `evidence-helper` if `evidenceItems` are provided.
      - `bias-check` on the draft graph.
      - `team-perspectives` if `teamPerspectives` are provided.
    - Returns both raw envelopes and the snapshot.

**Privacy:** both helpers only use structured metadata already present on the
CEE envelopes and never inspect raw briefs, graph labels, or LLM outputs.
Tests in `ceeGoldenJourneyExample.test.ts` enforce that secrets embedded in
labels or briefs do not leak into snapshots.

## 4. Integration tests

### 4.1 Golden journey metadata tests

File: `tests/integration/cee.golden-journeys.test.ts`

- Spins up the Fastify app with:
  - `LLM_PROVIDER=fixtures`
  - CEE v1 feature versions set to test-specific identifiers.
- For each journey (currently a subset of `CEE_GOLDEN_JOURNEYS`):
  1. Calls `/assist/v1/draft-graph` with the synthetic brief/archetype hint.
  2. Calls `/assist/v1/options` with the returned graph + archetype.
  3. Optionally calls `/assist/v1/evidence-helper` and `/assist/v1/team-perspectives`
     if the fixture includes evidence/team inputs.
  4. Calls `/assist/v1/bias-check` on the draft graph.
  5. Builds `CeeJourneyEnvelopes` from these envelopes.
  6. Collapses them into a `CeeGoldenJourneySnapshot` via the SDK helper.
- Asserts that:
  - `any_truncated`, `has_validation_issues`, and `has_team_disagreement` match
    the fixture expectations where specified.
  - High-quality journeys do not fall into the `low` band.
  - No brief text from the fixture leaks into the snapshot.

### 4.2 Telemetry sanity test

File: `tests/integration/cee.golden-journeys.telemetry.test.ts`

- Uses `TelemetrySink` to capture telemetry events while running the
  `HEALTHY_PRODUCT_DECISION` journey through the same endpoints.
- Asserts for each step (draft, options, evidence-helper, bias-check,
  team-perspectives) that:
  - Exactly one `Requested` and one `Succeeded` event are emitted.
  - No corresponding `Failed` event is emitted.
  - Each event payload passes `expectNoBannedSubstrings`, ensuring that no
    obvious secrets (e.g. `x-olumi-assist-key`, `password`, `api_key`) or
    free-text brief fields appear.
  - An injected `SECRET` marker in the brief does **not** appear in any
    telemetry payload when serialized.

## 5. Running the tests

From the repo root:

```bash
# Golden journey metadata tests
pnpm test -- tests/integration/cee.golden-journeys.test.ts

# Golden journey telemetry sanity test
pnpm test -- tests/integration/cee.golden-journeys.telemetry.test.ts

# SDK helpers (including golden journey snapshot/runner)
pnpm --dir sdk/typescript test
```

The golden journey suites run entirely against the fixtures provider and do
**not** require live LLM credentials.

## 6. Extending golden journeys

To add a new golden journey case:

1. Create a new JSON fixture in `tests/fixtures/cee/golden-journeys/` using the
   same shape as the existing fixtures.
2. Add the ID to `CEE_GOLDEN_JOURNEYS` in `tests/utils/cee-golden-journeys.ts`.
3. Update `cee.golden-journeys.test.ts` to exercise the new case and assert the
   relevant metadata invariants (bands, truncation, disagreement, completeness).
4. Optionally, extend `cee.golden-journeys.telemetry.test.ts` if the new journey
   hits a telemetry scenario that is not already covered.
5. Re-run the tests listed above.

When adjusting server-side heuristics in `src/cee/quality/index.ts`,
`src/cee/options/index.ts`, `src/cee/bias/index.ts`, or
`src/cee/team/index.ts`, prefer to update fixtures **deliberately** (with clear
comments) rather than weakening assertions.
