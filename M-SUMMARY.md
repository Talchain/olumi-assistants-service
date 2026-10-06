# MC range carry — edited, awaiting DL validation

## Design decision

`DESIGN.md` was written first (59 lines). Construction now reads the user's own
“about 150 new subscribers, between 80 and 250” sentence before the rate × count
mint. It carries the raw 80–250 range with the option's raw 150, using schemas
0.66's existing `interventions[countId].range` contract. The range's author is
`brief_extraction`, with the user's sentence as `source_quote`; it never inherits
the point's possibly provisional authorship.

The drafter schema and prompt are unchanged. The internal receipt is regenerated
from the original brief on the dry-run mint and every first/retry/trial mint.
It uses the existing scoped figure reader and centre-range reader, rejects a
different count noun/quantity/unit, exact counts, questions, ambiguous receipts,
derived additions and drafter-invented ranges. No prior, scale or default spread
is a range receipt. Every option setting the count must carry an admitted
`likely_range` before an inferred product is minted. All other mint guards remain.

## Files changed

- `DESIGN.md`: design, existing readers, transport and the one re-pin.
- `src/orchestrator-v5/agent-lane/runtime/build-model.ts`:
  `withCountInterventionRanges` writes internal, quote-bound receipts before minting.
- `src/orchestrator-v5/agent-lane/admit-model.ts`: types the internal receipt and
  carries it through `constructedLevel` into the option cell, using
  `admitInterventionRange` to revalidate against the persisted raw point.
- `src/orchestrator-v5/agent-lane/rate-count-product.ts`: replaces the blanket
  point-count refusal with an every-setting admitted-likely-range guard.
- `src/orchestrator-v5/agent-lane/__tests__/construction-count-range-product.test.ts`:
  banked draft-8 shape, registration/persistence/reload assertions, fourteen
  statement controls, invented-range and second-bare-setting controls, real Run wire row.
- `src/orchestrator-v5/agent-lane/__tests__/construction-rate-count-product.test.ts`:
  ONLY re-pin: the named point-count Science control's brief now omits the
  subscriber range. Its old ranged brief is the newly authorised positive case;
  the control continues to assert that a bare point cannot mint a product.
- `M-SUMMARY.md`: this handoff.

## Readers and writers

The new writer lives in build-model; admission stores its admitted receipt.
Existing schemas, option normalisation and persistence retain/validate it, and
the analysis hash includes it. The option-edit writer compares/replaces/removes
it; the agent's already-set comparison reads it.

CEE's existing `run-analysis` calls `wireInterventionRangePlan` with original
cells and final wire numbers. The request sends raw 150 and
`options[].intervention_ranges[countId] = {low:80, high:250, meaning:'likely_range'}`.
Author and quote stay in CEE. Run snapshots retain the authored range; residual,
input-difference and draw-structure readers consume that snapshot. The detailed
file/function inventory, including PLoT/ISL readers, is in DESIGN.md.

## Rows expected RED at base — not executed

1. Banked point-count row: base stores no range and its unconditional point-count
   guard mints no product. The row requires BOTH the persisted 80–250 range and
   the inferred product after the real construction/registration and cold parse.
2. Real CEE→PLoT row: base construction creates no count range, so the captured
   real Run request cannot contain `intervention_ranges[countId]`. Existing wire
   machinery is exercised, rather than asserted through a mocked serializer.

The sixteen refusal controls are expected to stay green at base and after the
change. The re-pinned original control is expected green at both. No test results,
bench uplift or runtime delivery are claimed. No vitest, sysctl, typecheck or
commits were run; the DL owns execution and commits. Static `git diff --check`
passed for tracked edits; the new files were reviewed as text.

## DL / Science cases

- Goal-chance propagation is not proved. Local `isl-4d` source samples likely
  ranges for directly scored root-node level limits and explicitly refuses a
  downstream limit reached from a ranged count (`intervention_range_not_propagated`).
  A request carrying a range and minting a product is not proof that Starter's
  goal chance lies inside (0, 1). DL/Science must rule on the engine follow-up and
  provide that downstream sampling witness before claiming the Science outcome.
- The brief's “about A, between L and H” is carried as `likely_range` as requested.
  The existing engine reads this as lognormal quartiles. Science should confirm
  that reading for count forecasts; explicitly exact, min–max or confidence-
  interval statements are not licensed by this narrow writer.
- This writer deliberately handles the existing centre-range grammar and requires
  the count label's qualifiers in the sentence. Alternate range wording, ranges
  before the point and unmatched paraphrases remain uncarried; no extra retry,
  invented range or engine changes were introduced.
