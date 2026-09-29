# RED-first at pristine — observed_state cap corroboration (2026-08-14)

Base: CEE staging `9ecf19f86c1867876cc06035983540c496cd2230`
Clone: fresh blobless, unique /private/tmp path. Branch `lane/observed-state-raw-value-corroboration`.

## Collect assertion (trap 2b)
`Tests  4 failed | 11 passed (15)` — 15 collected, NON-ZERO, in THIS spec by name.
A suite total is never the evidence; this is the file's own count.

## RED signatures at pristine (source unmodified)
1. `SIGNATURE 1 — transform emits raw_value = value x cap when the model omits it`
   → expected 90000, observed_state.raw_value was `undefined`
2. `SIGNATURE 2 — the emitted pair PROVES the normalised convention to the consumer`
   → `buildFactorScaleMap(...).normalisedConvention` expected true, was `undefined`
3. `SIGNATURE 3 — the factor is usable as HOLD PROVENANCE (no ambiguous_no_evidence)`
   → `AssertionError: expected 'ambiguous_no_evidence' to be 'raw_value_used'`
   THIS IS THE DEFECT ITSELF, measured at the consumer's own function.
4. `the guard reports the TRANSFORM OUTPUT as clean (writer and guard agree end to end)`
   → `expected [ 'fac_annual_cost' ] to deeply equal []`

## GREEN at pristine (correctly — the guard is new and already discriminates)
- guard RED on cap-without-raw_value
- guard RED on INCONSISTENT raw_value (50000 vs 0.6x150000=90000)
- guard GREEN on the consistent pair
- all five honest-absence cases (no cap / value>1 / negative / cap<=1 / NaN cap)

The guard's discriminating triple passes at pristine because the GUARD is not the
defect — the WRITER is. The guard bites on real transform output (signature 4).
