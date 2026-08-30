# Stated percentage factor contract

This slice repairs the percentage unit/frame lost when a user first supplies
a value for an already identified factor. The tested 12% edit reaches the
stored model, analysis and presentation in the same units. It does not
establish probability bounds from a factor label or number. General percentage
presentation is **not closed**: the fractional UI counterexample below remains.

## Recovered authority

The banked Graph Truth run completed all six traces and its barrier, despite
the older resume note saying five. It supports a shared semantic-fidelity
failure class, not one universal mechanism. This implementation resumes the
first-time percentage edit failure; it does not revive the banked broad patch.

The semantic question is: **what scalar does the user's stated percentage set
on the selected canonical factor?** CQE `rules.ts` already defines
`unit: 'percentage'` quantities as fractions. The existing proposal adapter
restores the human amount and `%`; `normaliseFactorValue` owns conversion at
the canonical `set_factor_value` mutation. The existing representation is:

```json
{
  "scale_frame": 100,
  "observed_state": {
    "value": 0.12,
    "raw_value": 12,
    "unit": "%",
    "source": "user_override"
  }
}
```

The divisor is not a cap. An existing cap/frame wins; a conflicting frame
cannot fall back to 100. A first-time percentage cannot silently reframe a
recorded baseline or existing interventions. `declared_scale` is preserved,
never inferred; its bounds come from the existing shared contract. In
particular, the current `factor_type: 'probability'` classifier is not an
authority for boundedness. No shared schema or vocabulary is added.

## Executable evidence

`stated-percent.ts` composes the real CQE producer, proposal adapter, mutation
handler, persistence projection, persisted-snapshot loader, run-analysis
handler, PLoT normaliser/translator, ISL validator/sampler/analyser, and the
current UI's full-applied-graph mapping, reload mapping, display and provenance
consumers. The
store is in memory and HTTP transport is observed, not executed. External
source heads and PLoT's own vendored schema are checked before running.

Run from the CEE repository with the pinned external checkouts and a Python
environment containing ISL's dependencies:

```sh
UI_REPO=/absolute/path/to/ui NODE_ENV=test \
  node_modules/.bin/tsx scripts/semantic-contract/stated-percent.ts \
  --plot-dir /absolute/path/to/plot \
  --isl-dir /absolute/path/to/isl \
  --python /absolute/path/to/python \
  --output /absolute/path/to/evidence.json
```

The fixture asserts collection and executes positive spellings, ID-preserving
rename/same-label controls, semantic-loss mutants, and unrelated GREEN
controls. Altering the model value, dropping `%`, or upgrading attribution
fails the same invariant used by the positive arm. Zero survives persistence
and a later edit; a same-seed full ISL analysis changes its outcomes when the
accepted percentage changes. Bare numbers, currency and additive percentage
points retain their separate meanings.

The small surrounding graph is authored around the banked churn example;
this is an adapter test, not a replay of an authenticated user journey.
The fixture supplies an already resolved canonical ID. It does not establish
LLM extraction accuracy or target-resolution correctness.

## Integration boundary

Evidence rung: **TESTED, real adapter composition**. CC owns review and
integration. A separate witness must exercise the deployed current UI, actual
database persistence and reload before claiming deployed closure. This does
not certify uncertainty calibration, ranking correctness, legacy clients
supplying their own graph state, or other mutation handlers.

No `run-analysis.ts`, PLoT, ISL, schema, UI or other active-owner source is
modified. The current UI consumes the full applied graph on accepted V5 edits;
the narrow `graph_patch.after` alone is not the complete transport contract.

The next observed consumer failure is fractional percentage display. On UI
`e8f86b1a02bb9b68bd80f2fdbc813558eee17bfe`, an actual accepted 0.5% edit stores
`value: 0.005`, `raw_value: 0.5`, `%`, `user_override`, `scale_frame: 100`, and
`display_value: "0.5%"`; the UI formatter nevertheless renders **50%**. A 12.5%
edit renders **13%**. The raw-value branch precedes the supplied display string.
This is a CCUX handoff, not authority to reinterpret the scientific value.

```sh
UI_REPO=/absolute/path/to/ui NODE_ENV=test \
  node_modules/.bin/tsx scripts/semantic-contract/stated-percent-ui-loss.ts
```

This command must remain RED until the consumer renders both supplied values
correctly; 0%, 1%, 12% and 110% are its positive controls. CCUX owns the UI
formatter/caller correction and mounted witness. Preserve historical opposite
controls: existing legacy raw percentages cannot all be reclassified. The
canonical frame and coherent raw/model pair can license the intended display,
but the actual `FactorNode` formatter call must carry that evidence too.

After independent closure, select the highest-impact first-failing unowned
Graph Truth contract using then-current evidence. Option-provenance loss is
a candidate, not a preassigned successor; the newer B7 quantity-binding
counterexample may change that priority.
