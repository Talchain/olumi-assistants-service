# Future Capability — Concurrent LLM `draft_graph` Candidates

**Status:** **Design note only. Not implemented in this PR.** Reserved as a future capability so the observability telemetry added in Fix 4 can support it later without a schema change.

## Motivation

A single LLM draft of a causal graph is high-variance:

- The model picks one framing, one set of factors, one connectivity. A second run on the same brief often differs meaningfully in factor inventory and edge polarities.
- Brief Phase 0 sampling showed `draft_graph` running 47–55 s consistently. Most of that is the Parse LLM call. A second concurrent draft costs the same wall-clock and produces a comparison signal "for free" if reconciled deterministically.

The eventual capability we want:

1. Issue two `draft_graph` LLM calls **in parallel** against the same brief, with two different providers or two different sampling temperatures.
2. Each produces a candidate graph through Stages 2–4 of the unified pipeline.
3. A new deterministic **reconciliation step** runs:
   - Detects agreement on options, factors, edges
   - Highlights divergence (factor only in one candidate, sign mismatch, strength disagreement)
   - Either selects one candidate (highest quality score) or merges them (union of high-confidence elements)
4. The user-visible graph is the reconciled output; the candidates and their disagreement signal feed downstream coaching ("Models agreed on X, disagreed on Y — investigate Y").

## What this PR does for that future capability

**Nothing on the execution side.** Parse and Repair still run once per draft. But the timing schema in [src/orchestrator-v5/telemetry/turn-timings.ts](../../src/orchestrator-v5/telemetry/turn-timings.ts) leaves room for it:

```ts
export interface DraftGraphTimings {
  total_ms?: number;
  parse_ms?: number;
  // …
  candidates?: readonly DraftGraphCandidateTimings[];
}

export interface DraftGraphCandidateTimings {
  candidate_run_id: string;
  provider: string;
  model?: string;
  parse_ms?: number;
  repair_ms?: number;
  graph_quality_score?: number | null;
  option_factor_coverage?: { options: number; factors: number };
  divergence_score?: number | null;
  provenance?: 'single' | 'merged' | 'selected';
}
```

`candidates` is **always absent today**. When concurrent draft lands, the orchestrator will populate the array with one entry per candidate run, and the existing telemetry events (`cee.unified_pipeline.stage_timings`) carry the data without schema churn.

## Constraints when implementing

- **Cost gate.** Two parallel calls double LLM spend per draft. Must be a flag, default OFF.
- **Provider diversity required for value.** Two Anthropic calls at the same temperature usually produce highly correlated outputs — the variance signal is weak. The real win is OpenAI + Anthropic, or two distinct temperature settings, or two distinct prompts.
- **Reconciliation is deterministic.** No third LLM call to "judge" the two candidates — that just adds latency and another opinion. Use structural rules: factor inventory union, edge agreement, strength averaging with disagreement flag.
- **Budget interaction.** Parallelism doesn't reduce wall clock unless both candidates finish; tail-latency dominates. Cap individual candidate budgets at a fraction of the total turn budget (e.g. 0.4× of `LLM_BUDGET_NARRATE_MS`).
- **Repair stage.** Each candidate runs Repair independently OR reconciliation happens before Repair and a single graph goes through Repair. Probably the latter is cleaner; depends on whether Repair behaviour diverges enough to matter.
- **PLoT contract.** Downstream `run_analysis` doesn't know about candidates; it consumes the reconciled graph and runs once. No change to PLoT-side wiring.

## Out of scope for this brief

- Sampling strategy (temperature vs. multi-model vs. multi-prompt)
- Quality-scoring algorithm (which model wins ties; how to weight factor coverage)
- Reconciliation algebra (union, intersection, weighted merge)
- UI exposure (does the user see "model A vs model B"? Or just the merged graph?)
- Cost dashboard (per-candidate spend tracking)

## Telemetry-readiness checklist (what the observability PR delivers)

- [x] `cee.unified_pipeline.stage_timings` event carries `parse_ms`, `repair_ms`, `repair_llm_ms`, `repair_fired` — same shape would extend to per-candidate emission.
- [x] `_timings.draft_graph.candidates` field reserved on the response envelope schema.
- [x] `DraftGraphCandidateTimings` type defined with required fields for future use.
- [ ] Multi-candidate emission paths in `runUnifiedPipeline` — **not implemented** (future PR).
- [ ] Reconciliation step — **not implemented** (future PR).

## Where this lives later

When this capability is built, expect changes in:

- [src/cee/unified-pipeline/index.ts](../../src/cee/unified-pipeline/index.ts) — fork at Stage 1 (Parse) into N candidates; reconcile before or after Stage 4 (Repair).
- [src/orchestrator-v5/handlers/draft-graph-dispatch.ts](../../src/orchestrator-v5/handlers/draft-graph-dispatch.ts) — possibly thread a per-candidate timings array onto the V5 response.
- A new `src/cee/unified-pipeline/reconcile-candidates.ts` module.
- A config flag `CEE_DRAFT_CONCURRENT_CANDIDATES` (default off, integer N≥1).

No changes anticipated to the PLoT client, the V5 routing layer, or the response envelope contract (telemetry surface is already shaped).
