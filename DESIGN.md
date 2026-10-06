# MC: carry a quoted count range before minting a rate × count product

## Existing readings
- `cee/provenance/stated-amounts.ts:findStatedRanges` reads money ranges only;
  it cannot read the T1b subscriber range. `unquantified-factor.ts` reads priors,
  not option-level ranges, and its ignorance prior is never evidence here.
- `cee/context-integrity/not-modelled-manifest.ts:extractStatedLikelyRange`
  reads the literal “between L and H”. Agent-lane `stated-by-user.ts:centreRangeAt`
  uses it for a point followed by its own range in one sentence.
- `stated-size-binding.ts` already binds that reading to a link's source quote.
  `writtenRangeFor` is the separate money range-end reader; reuse neither a
  money range nor an edge's spread as an option count range.

## Smallest writer and mint
- Add a deterministic preparation in `runtime/build-model.ts`, before both
  the dry-run mint and every first/retry/trial `mintOrFold`.
- For an absolute count setting, bind its literal point to the count in one
  user-brief sentence (`figureTheUserWroteForSpan`, strict, named; count-label
  qualifiers required; only count quantities can rival the point's ownership).
- Reuse `centreRangeAt` only for the immediately associated quoted range;
  reject questions, exact counts, other quantities/units and ambiguous receipts.
- Carry raw `{low, high, meaning:'likely_range', source:'brief_extraction',
  source_quote:<user sentence>}` through an internal candidate field, not a
  new drafter schema field. Admission copies only an admitted range beside
  the same raw point into `interventions[countId].range`.
- `withRateCountProducts` requires an admitted likely range on EVERY setting
  of the count. All existing unit, sign, level and user-figure guards remain.
- Must never invent a range, borrow another quantity's range, add a range to
  an exact count, trust a drafter-supplied range, or mint with a bare point.

## Existing readers and transport (no redesign)
- `schemas/cee-v3.ts:InterventionV3` imports schemas-0.66's range shape.
- `normalise-option-interventions.ts` preserves it; persistence projection's
  `refuseInadmissibleInterventionRanges` validates it against the raw point.
- `context/graph-hash.ts` includes it in the analysis revision.
- `runtime/agent-capabilities.ts` compares it for already-set option levels;
  `system-events/option-intervention-edit.ts` validates/replaces/removes it.
- `tools/handlers/run-analysis.ts` reads original cells through
  `wireInterventionRangePlan`: raw numbers plus `intervention_ranges[countId]`
  `{low,high,meaning}`; no author or quote goes to PLoT.
- `run-input-snapshot.ts` records it; `run-input-residual.ts`,
  `coaching/run-input-changes.ts` and `coaching/draw-structure.ts` read that copy.
- Local `plot-4d`: `routes/v2/run.ts` validates/normalises ranges and checks
  sampling receipts; `lib/intervention-normaliser.ts` carries their scale;
  `integrations/isl/translator-v3.ts` forwards them, `isl-draw-structure-key.ts`
  includes them in draw identity.
- Local `isl-4d`: `models/robustness_v2.py` validates `likely_range`;
  `services/robustness_analyzer_v2.py` fits/samples its lognormal quartiles.
  Current source withholds an upstream ranged count's downstream limit as
  `intervention_range_not_propagated`; this is NOT a goal-chance witness.

## Rows and re-pins
- New file: banked point-count shape → persisted 80–250 AND minted product;
  no range, another quantity's range, exact count, invented/ambiguous ranges,
  another unit and a second bare setting → no unsafe mint; real Run wire row.
- Re-pin ONLY the point-count control in `construction-rate-count-product.test.ts`:
  remove its brief's subscriber range so it remains the bare-point Science
  control. Its old ranged brief is precisely the newly authorised positive row.
- DL runs tests/commits. No vitest, sysctl, commits or engine edits in this lane.
