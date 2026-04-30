# V5 State Trust — Phase 0 Diagnostics & Audit

Branch: `claude/v5-state-trust` (off `origin/staging` @ `7a216047`)
Scope: CEE only.

This is the read-only diagnostic and audit report that precedes the Phase 1
implementation of analysis freshness derivation. No code is changed in this
commit. All citations are repo-relative `file:line` references.

## 1. The user-visible bug

Every post-analysis explain turn — even one that fires seconds after a fresh
`run_analysis` — currently emits the staleness prefix
*"These results are from a prior run and may not reflect recent changes…"*.
Users see this on output that is, in fact, fresh. Rerunning analysis does not
clear the prefix. The replay harness reproduces the issue at Step 5 of the
v5 journey replay (post-`run_analysis` explain).

## 2. Where the broken fallback fires

[src/orchestrator-v5/turn-executor.ts:481-508](../src/orchestrator-v5/turn-executor.ts#L481-L508)

When the request lacks `options.analysisState`, the executor calls
`buildAnalysisFromPriorFacts(context.prior_facts, optionLabelSource)` and
unconditionally stamps:

```ts
analysisStalenessReason = FALLBACK_STALENESS_REASON;
analysisStateSource = 'fallback';
```

The constant `FALLBACK_STALENESS_REASON` =
`'loaded_from_prior_run_freshness_unknown'` is defined at
[src/orchestrator-v5/context/analysis-fallback.ts:48](../src/orchestrator-v5/context/analysis-fallback.ts#L48).

The fallback fires whenever the UI does not include `analysis_state` on the
turn payload — which is the *normal* case for explain turns following a
freshly-completed analysis. There is no comparison against the current graph
hash; freshness is *assumed unknown*.

## 3. Selection logic today

[src/orchestrator-v5/context/analysis-fallback.ts:160-281](../src/orchestrator-v5/context/analysis-fallback.ts#L160-L281)

`buildAnalysisFromPriorFacts()` scans `prior_facts` newest-first for the
most recent non-noop `run_analysis` fact. **It does not filter by
`analysis_status`, does not tie-break by row id, and does not compare graph
hashes.** Returns `null` if no fact is found (then `analysisStateSource`
stays `'absent'`).

## 4. Why freshness cannot be derived today

The `run_analysis` fact does not record the graph hash at execution time.
The fact's `result` shape from
[src/orchestrator-v5/tools/handlers/run-analysis.ts:364-384](../src/orchestrator-v5/tools/handlers/run-analysis.ts#L364-L384):

```ts
{
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id, leading_option_id,
    win_probabilities?, summary,
    enrichment: <V2RunResponseEnvelope>,
  },
}
```

There is no `graph_hash_at_run`, no `computed_at` on the fact itself.
The PLoT response inside `enrichment` carries `meta.response_hash` and
`meta.seed_used`, but those identify the analysis call — not the graph
state it was run against.

Conclusion: even with the existing topology hash plus the most recent
`run_analysis` fact, today's code has nothing to compare against.

## 5. Where staleness prefix is applied

Definition: [src/orchestrator-v5/tools/handlers/staleness-prefix.ts:24-25, 63-76](../src/orchestrator-v5/tools/handlers/staleness-prefix.ts#L24-L76)

Call sites (the user-visible touchpoints):

- [src/orchestrator-v5/tools/handlers/explain-results.ts:113-120](../src/orchestrator-v5/tools/handlers/explain-results.ts#L113-L120)
- [src/orchestrator-v5/tools/handlers/what-would-flip.ts:100-107](../src/orchestrator-v5/tools/handlers/what-would-flip.ts#L100-L107)

Both extract `invocation.analysisProjection?.staleness_reason` and prepend
the canonical caveat string when non-null. Idempotency guard at
[staleness-prefix.ts:40-49](../src/orchestrator-v5/tools/handlers/staleness-prefix.ts#L40-L49) recognises three approved openings.

## 6. `computed_at` is restamped at finalisation, not from fact

[src/orchestrator-v5/compose/analysis-ready-emit.ts:26-30](../src/orchestrator-v5/compose/analysis-ready-emit.ts#L26-L30):

```ts
export function attachComputedAt(payload) {
  return { ...payload, computed_at: new Date().toISOString() };
}
```

Confirmed: every wire emission of `analysis_ready` — including pure
read-only explain / direct-answer turns — restamps `computed_at` to the
current wall clock. The UI's ordering guard sees this as a "newer" value
even though the underlying analysis is identical.

## 7. Read-only handlers — confirmed

`explain_results` ([explain-results.ts:122-136](../src/orchestrator-v5/tools/handlers/explain-results.ts#L122-L136))
and `what_would_flip` ([what-would-flip.ts:109-123](../src/orchestrator-v5/tools/handlers/what-would-flip.ts#L109-L123))
both write `noop: true` facts whose `result` payload contains only
telemetry counters (`option_count`, `answer_source`, `fallback_reason`,
`answer_text_length`, `staleness_prefixed`). Neither handler mutates the
graph, produces an analysis fact, or alters analysis state. Safe to
declare read-only — they will be excluded from the freshness invalidation
table.

## 8. Graph hash audit — TOPOLOGY-ONLY (P0 false-fresh risk)

### Current implementation

[src/orchestrator-v5/context/graph-hash.ts:39-61](../src/orchestrator-v5/context/graph-hash.ts#L39-L61) hashes:

```
{ nodes: [{ id }], edges: [{ from, to }] }
```

The module header at [lines 1-16](../src/orchestrator-v5/context/graph-hash.ts#L1-L16) explicitly states:
*"additive fields (observed_state drift, strength refinements) do NOT
change the hash. That is deliberate"*. Correct for routing-log identity
(its original consumer); **wrong for freshness comparison**.

### `edit_graph` substantive ops that escape the current hash

[src/orchestrator/tools/edit-graph.ts:1117-1132](../src/orchestrator/tools/edit-graph.ts#L1117-L1132) defines `isSubstantiveOperation()`:

| Op | Topology change? | Caught by current hash? |
|---|---|---|
| `add_node`, `remove_node` | Yes | Yes |
| `add_edge`, `remove_edge` | Yes | Yes |
| `update_node` (non-label) | **No** | **No → false-fresh** |
| `update_edge` | **No** | **No → false-fresh** |
| `update_node` label-only | No | No (correctly — cosmetic) |

### Analysis-affecting fields the current hash misses

Reading the V3 graph schema at [src/schemas/cee-v3.ts:89-214](../src/schemas/cee-v3.ts#L89-L214) and the GraphStateIngress passthrough at [src/orchestrator-v5/boundary/request-extensions.ts:60-83](../src/orchestrator-v5/boundary/request-extensions.ts#L60-L83):

**Node-level (analysis-affecting, missing from current hash):**

- `kind` (factor / option / goal / outcome / decision / risk / action)
- `category` (controllable / observable / external — drives ISL inference)
- `observed_state.value` (current factor value — directly drives effects)
- `observed_state.baseline` (baseline for delta computation)
- `observed_state.cap` (upper bound)
- `goal_threshold`, `goal_threshold_raw`, `goal_threshold_cap` (drives goal scoring)
- `intercept` (prior mean for ISL root nodes)
- `prior` (distribution range for external-factor Monte Carlo sampling)
- `encoding_map` (categorical encoding — semantic interpretation)
- `interventions` (option intervention bundle — analysis-critical)
- `is_baseline` (which option is status-quo)
- `factor_type`

**Edge-level (analysis-affecting, missing from current hash):**

- `strength.mean` (signed causal coefficient — directly drives effect magnitude)
- `strength.std` (parametric uncertainty)
- `exists_probability` (existence probability — directly drives effect)
- `effect_direction` (positive / negative)
- `edge_type` (directed vs bidirected confounder)

**Top-level (analysis-affecting, missing from current hash):**

- `options[]` (entire array — interventions, status, is_baseline)
- `goal_node_id`
- `goal_constraints[]`

### Cosmetic / provenance / display fields that MUST be excluded

(Otherwise label edits trigger false-stale freshness.)

- Node: `label`, `description`, `display_value`, `provenance`, `provenance_display`
- Node `observed_state`: `unit`, `source`, `raw_value`, `extractionType`
- Edge: `provenance.reasoning`, `provenance_display`, `origin`, `validation`, `defaulted`
- Option: `description`, `unresolved_targets`, `user_questions`, `provenance`, `provenance.brief_quote`
- Intervention: `unit`, `source`, `reasoning`, `value_confidence`, `display_value`, `target_match.match_type`, `target_match.confidence` (only `target_match.node_id` matters)

### Resolution

A new function `computeAnalysisAffectingGraphHash()` will be added in commit
2, alongside the existing `computeDeterministicGraphHash()`. The existing
function stays untouched: its consumer (the routing log) deliberately wants
topology-only identity per its module header. Freshness uses the new hash
exclusively.

## 9. Analysis status reading

`getRunAnalysisStatus()` at [src/orchestrator-v5/tools/handlers/run-analysis.ts:409-417](../src/orchestrator-v5/tools/handlers/run-analysis.ts#L409-L417) reads `analysis_status` from the response envelope. This will be reused by the freshness derivation to filter "successful" facts (excluding `partial`, `blocked`, `degraded`, `failed`).

## 10. Rerun chip already exists — only the gate condition will change

[src/orchestrator-v5/compose/chip-generator.ts:209-241](../src/orchestrator-v5/compose/chip-generator.ts#L209-L241)
already emits a `chip_action_rerun_analysis` chip with
`action_type: 'run_analysis'`, gated today on
`input.analysis?.staleness_reason != null`. Phase 1 retargets the gate to
`turnOutcome.analysis_freshness === 'stale'`. The chip itself is unchanged.

## 11. Schema package constraint

`RunAnalysisHandlerFactSchema` lives in the external `@talchain/schemas`
package and is `strict`. Top-level `result` field additions require a
cross-repo schema bump. The `result.enrichment` field is
`z.record(z.unknown())` — open. Phase 1 stores
`graph_hash_at_run` and `computed_at` inside
`enrichment._cee_meta` as a sentinel-namespaced child to avoid the
cross-repo change. The PLoT response shape inside `enrichment` is unchanged
because `_cee_meta` is a side-channel key.

## 12. What this audit confirms can stay unchanged

- `analysis_ready` wire shape — additive only (freshness fields added,
  nothing removed)
- Existing handler registration / dispatch logic
- PLoT / ISL interface (the PLoT response inside `enrichment` keeps its
  shape; `_cee_meta` is sentinel-keyed)
- `sanitiseUserFacingText` behaviour
- Existing contract test assertions
- Prompt content
- The existing `computeDeterministicGraphHash()` and its routing-log usage

## 13. What must NOT be present after Phase 1

- `loaded_from_prior_run_freshness_unknown` reachable from any new code path
- `as any` / `as unknown` in freshness derivation
- Stale prefix in `assistant_text` (CEE no longer prefixes; UI will own
  display in a separate brief)
- Rerun chip when freshness is `fresh`, `unknown`, or `none`
- `computed_at` restamped on non-analysis turns

## Verification of this report

Every code reference in sections 1–11 was grep- or read-confirmed against
the working tree at `7a216047`. No assertions are based on second-hand
documentation.
