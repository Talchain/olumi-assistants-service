# V5 Context Reliability Audit

**Status:** read-only static audit · **Date:** 2026-05-30 · **Base:** `origin/staging` @ `27bb71a8` (PR #221)
· **Scope:** `olumi-assistants-service` (`src/orchestrator-v5/**`, `src/orchestrator/context/**`,
`src/config/index.ts`)
· **Update (2026-05-30):** the top-line unknown is now **resolved (admin-verified)** — a Render check
confirmed `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` is **absent on the CEE service**, so it resolves to the
code default **`false`** on staging (§6.4, §6.6, §14; caveat: confirm linked Environment Groups).

**Why this exists.** A prerequisite to the **Coaching Surface Delivery** workstream. A fresh
post-analysis follow-up turn showed `analysis_state_source: fallback`, `phase3_block_context_available:
false`, `has_run_analysis_fact: true`, fresh analysis via `graph_hash_match`, deterministic path
(`llm_calls_used: 0`). The gating question: **is rich Phase 3 / coaching context missing because of a
propagation/retrieval bug (→ fix retrieval), or by design (→ build a reliable fallback from prior
analysis facts/enrichment)?** This audit answers that from source, before any fix is written.

> **No production code, tests, prompts, PMS content, schemas, env, DGAI, PLoT, or ISL were changed.**
> Read-only. The only file written is this report.

**Evidence legend.** `source-verified file:line` (read directly on this base) · `existing-map-confirmed`
(carried from `v5-handler-coverage-map.md`, PR #220) · `runtime-evidence-from-existing-trace` (the trace
quoted above; no new trace was run) · `test-verified` · `admin-verified` (Render/dashboard configuration
confirmed by an operator) · `inferred` · `unknown-needs-runtime-proof`.

---

## 1. Verdict

**V5 context retrieval is sound. No propagation/retrieval bug was found.** Both traced symptoms are
faithful reports of upstream state, and they are **independent of each other**:

- **`phase3_block_context_available: false` is by design under the current default configuration.** The
  richest coaching layer — `decision_review` (the source of the Phase 3 review/coaching/evidence blocks)
  — is implemented and wired, but its production is **disabled by default for latency**
  (`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` defaults to `false`; **confirmed absent → `false` on CEE
  staging**, §6.6). When it is not produced it is not persisted, so a follow-up turn correctly reports it
  absent. This is **not** a retrieval bug, **not** a debug artefact, **not** a fallback-reconstruction
  loss. *(source-verified + admin-verified; §6)*
- **`analysis_state_source: fallback` is an expected, non-degrading reconstruction path** — it fires
  whenever the UI omits `analysis_state` from the request and a prior `run_analysis` fact exists. When the
  persisted enrichment is well-formed (the normal case) the fallback summary is essentially equivalent to
  the request path. It is **not** the coaching-loss path; it is commonly conflated with one. *(source-verified; §7)*

> **Headline correction to the operating model.** The handler-coverage map (§9-5) recorded
> `decision_review` as **"FIXED for blocks."** This audit **qualifies** that finding: `decision_review`
> is **fixed in code but gated OFF by default at runtime** via `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`
> (`default(false)`) — and a **Render check confirms the variable is absent on the CEE service, so it
> resolves to `false` on staging** (admin-verified, §6.6). It is therefore **not reliably present in the
> deployed default experience**. Whether to turn it on is a **pending product/latency decision that this
> audit does not resolve** and that is **explicitly out of scope for the §11 implementation lane.** This
> is a correction to the operating model, not a footnote — every downstream plan that assumed Phase 3
> blocks reach follow-up by default must be re-based on it.

**But "no retrieval bug" does not mean the experience is good enough.** The product gap is real (§10):
on the default deployment the deepest coaching layer is off, and the raw analysis material that *is*
persisted on every fact has **no deterministic follow-up consumer**. The correct fix is therefore a
reliable deterministic coaching path sourced from persisted raw enrichment — **not** a retrieval fix, and
**not** decorative fallback copy.

**Top-line unknown — now RESOLVED for CEE staging (admin-verified).** A Render check (2026-05-30)
confirmed `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` is **not set on the CEE service**, so the deployed value
resolves to the code default **`false`**. The OFF strategy in §6.4 is therefore the **operative reality on
staging**: deterministic enrichment-backed coaching is the primary near-term path, and the flag is **not**
to be enabled or added in this workstream. *Caveat:* if not already visible, linked Render **Environment
Groups** should be confirmed not to override it.

---

## 2. Current context architecture summary

The V5 turn loop is a deterministic-gate-first pipeline (`existing-map-confirmed`, §3/§5 of the handler
map). Per turn, the executor:

1. **Loads context** — `buildTurnContext` returns an `EnrichedTurnContext` with `persistedGraph`,
   `prior_facts` (newest-first), `scenarioBriefText`, pending actions, coaching cache.
   *(source-verified: `build-turn-context.ts`)*
2. **Derives freshness** — `deriveAnalysisFreshness(prior_facts, currentGraphHash)` selects the newest
   successful `run_analysis` fact and compares `graph_hash_at_run` against the current graph hash.
   *(source-verified: `turn-executor.ts:758-761`; `freshness.ts:380-439`)*
3. **Resolves the analysis-state summary** — `request` (UI-echoed `analysis_state`) is preferred; else
   `fallback` reconstruction from prior facts; else `absent`.
   *(source-verified: `turn-executor.ts:768-810`)*
4. **Assembles the ContextPack** — the single input to the fall-through routing prompt
   (`existing-map-confirmed`, §7a).
5. **Derives a context-readiness snapshot** — including `has_run_analysis_fact`, the freshness verdict,
   the graph-hash pair, and `phase3_block_context_available`; emitted as `v5.context_readiness`
   telemetry. *(source-verified: `readiness.ts:63-117`)*
6. **Runs the ORIENT gate ladder** (~10 deterministic gates); the LLM router runs only on fall-through.

The two audited fields live in this assembly layer — the layer the handler map deliberately did not
cover. `analysis_state_source` and `phase3_block_context_available` are **internal telemetry** (privacy
contract: numbers/booleans/hashes only — `readiness.ts:19-23`), not wire fields. They surface on the
`v5.context_readiness`, `ContextPackAssembled`, and analysis-projection telemetry events.

---

## 3. Relationship to the handler-coverage map

This audit **confirms and extends** [`v5-handler-coverage-map.md`](./v5-handler-coverage-map.md) (PR
#220) and [`V5_CURRENT_STATE.md`](./V5_CURRENT_STATE.md); it does not rebuild them. The map established
the gate-first loop, the single ContextPack consumer, the copy-owner surfaces, and the six coaching-field
drop-points. This audit adds the **runtime context-state assembly** (the two telemetry symptoms, the
freshness derivation, and the `decision_review` autofire gate) and the **field-survival trace** to
follow-up surfaces.

One material reconciliation against the map's §9-5 ("`decision_review` — **FIXED for blocks**"): that
verdict is true *in code*, but this audit finds the layer is **off by default** at runtime (§6). The map
described the code path; this audit qualifies its deployed reach. All line numbers here are re-confirmed
on `27bb71a8` (the map's baseline was `d59be1a8`).

---

## 4. Context assembly map

| Source | File:line | Input | Output shape | Consumer | Failure / fallback | Stale/fresh |
|---|---|---|---|---|---|---|
| Persisted graph | `build-turn-context.ts` | session store | `persistedGraph` | all gates + readiness | absent → `graph_present:false` | n/a |
| Prior facts | `build-turn-context.ts` | session store (newest-first) | `prior_facts[]` | freshness, fallback, readiness, advice gate | empty → `none` | source of truth |
| run_analysis fact selection | `freshness.ts:283-318` | `prior_facts` | newest successful fact | freshness, projection, advice gate, readiness — **one shared selector** | none → `freshness:'none'` | explicit |
| Freshness derivation | `freshness.ts:380-439` | selected fact + current hash | `{freshness, reason, hashes}` | gates, telemetry | missing hash → `unknown` | **explicit, strict `===`** |
| Analysis-state summary | `turn-executor.ts:768-810` | `options.analysisState` ∥ `prior_facts` | `AnalysisResponseSummary` + `analysis_state_source` | ContextPack, advice gate | request→fallback→absent ladder | reconstructed (summary) |
| Fallback reconstruction | `analysis-fallback.ts:163-291` | selected fact `result.enrichment` | `AnalysisResponseSummary` | analysis-state summary | enrichment malformed → thin summary | flagged conservatively (§9) |
| ContextPack | `context-pack-assembler.ts` | graph + analysis summary + coaching cache + CQE | `ContextPack` | routing prompt only (`existing-map-confirmed`) | thin projections | carries verdict |
| `decision_review` (Phase 3) | enricher: `decision-review-enricher.ts`; invoke: `cee/decision-review/invoke.ts` | raw enrichment + brief | `enrichment.decision_review` on the fact | phase3-blocks, advice gate, readiness flag | **gated off by default (§6)**; skips `no_brief`/`no_results`/`no_winner` | persisted on fact |
| `phase3_block_context_available` | `readiness.ts:103-117` | selected fact `enrichment.decision_review` | boolean | telemetry | absent → `false` (faithful) | reflects persisted state |
| Coaching cache (draft) | `coaching-cache-reader.ts` | JSONL sidecar | `ContextPack.coaching.draft_coaching` | routing prompt (opaque) | absent → empty | next-turn only |
| Pending actions | `build-turn-context.ts` | session store | `most_recent_pending_actions[]` | short-confirm gate | absent → 0 | n/a |

---

## 5. Context consumer map

| Consumer | File:line | Reads ContextPack? | Reads prior facts? | Reads Phase 3 / `decision_review`? | Reads analysis projection? | Missing-field behaviour |
|---|---|---|---|---|---|---|
| Fall-through routing prompt | `route-with-tool-use.ts:742-768` | **Yes (only reader)** | no | only opaque `coaching.decision_review` slot | yes (thinned) | empty display sections |
| Post-analysis advice gate | `post-analysis-advice-gate.ts`; threaded `turn-executor.ts:3086-3120` | `contextPack.analysis` (thin) | via pickers | **Yes** — `pickLatestDecisionReview(prior_facts)` | yes | **degrades to projection-only when `decision_review` null** *(source-verified: comment :3108-3109; gate composers)* |
| `pickLatestDecisionReview` | `pick-decision-review.ts:45-61` | no | `selectRunAnalysisFact` | reads `enrichment.decision_review` | no | returns `null` when absent/malformed |
| Stale-rerun guard | `stale-rerun-guard.ts` (gate `turn-executor.ts:3013`) | no | freshness verdict | no | no | not-stale → falls through |
| State-query guard | `state-query-guard.ts` (gate `:2907`) | `recent_changes` only | no | no | no | empty → "nothing applied" |
| Fresh-analysis follow-up guard | `fresh-analysis-followup-guard.ts` (gate `:3251`) | no | readiness snapshot | no | no | structural recap constant |
| No-analysis guard | `no-analysis-guard.ts` (gate `:3336`) | no | readiness snapshot | no | no | graph-ready/not-ready copy |
| `run_analysis` handler | `tools/handlers/run-analysis.ts` | no | no | writes the fact (raw enrichment verbatim) | no | deterministic headline |
| `explain_results` / `what_would_flip` / `explain_from_structure` | `tools/handlers/*` | router path only | own thin projection + raw robustness | no (uses raw robustness) | thin | deterministic fallback prose |
| phase3-blocks composer | `compose/phase3-blocks.ts:284-340` | no | reads `enrichment.decision_review` | **Yes** | no | no `decision_review` → no Phase 3 blocks |
| Readiness derivation | `readiness.ts:63-117` | char count only | `selectRunAnalysisFact` | `decision_review` presence | no | absent → flags `false` |

**Traced-turn attribution** *(inferred from a fresh, deterministic, `has_run_analysis_fact:true`
post-analysis follow-up)*: the most plausible producer is **`tryPostAnalysisAdviceGate`** — it gates on
`freshness === 'fresh'` (`turn-executor.ts:3100`), sets `llmCallsUsed = 0` on match (`:3162`), and reads
`decisionReview: pickLatestDecisionReview(...)` which returned `null` (since `phase3_block_context_available:
false`), so it composed from the thin projection only. This is consistent with every traced field.
*(source-verified for the mechanism; exact gate-for-this-turn is `inferred` / `unknown-needs-runtime-proof`.)*

---

## 6. Root cause of `phase3_block_context_available: false`  *(HEADLINE)*

**The richest coaching layer is fixed in code but disabled by default for latency. A Render check
confirms the flag is OFF on CEE staging (§6.4/§6.6, admin-verified), so the deployed default V5 experience
**is** running without the layer the handler map called "fixed for blocks."**

### 6.1 The flag is faithfully read
`derivePhase3BlockContextAvailable(prior_facts)` selects the newest successful `run_analysis` fact and
returns `true` iff its `result.enrichment.decision_review` is present:

```ts
// src/orchestrator-v5/context/readiness.ts:103-117
const selected = selectRunAnalysisFact(priorFacts);
if (selected === null) return false;
// ... read result.enrichment.decision_review ...
return decisionReview !== null && decisionReview !== undefined;
```
*(source-verified: `readiness.ts:103-117`)* — The derivation is **correct**. It uses the same
`selectRunAnalysisFact` as the freshness verdict and the advice gate, so there is no selection drift.

### 6.2 `decision_review` production is gated OFF by default
```ts
// src/config/index.ts:374
runAnalysisAwaitDecisionReview: booleanString.default(false),  // env: V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW
```
*(source-verified: `config/index.ts:373-374,766`)*

- **Free-text `run_analysis`:** when the flag is false the enricher is short-circuited; emits
  `v5.decision_review.skipped` reason `autofire_disabled`; the persisted fact's `decision_review` is
  simply absent. *(source-verified: `turn-executor.ts:4165-4240`)*
- **Chip-click `run_analysis`:** gated on the **same** flag, same `autofire_disabled` skip.
  *(source-verified: `chip-click-dispatch.ts:450-483`)*
- Even with the flag **on**, the enricher still skips on `no_brief` / `no_results` / `no_winner`.
  *(source-verified: `decision-review-enricher.ts:67-124`)* — the `no_brief` leg is the previously-tracked
  BRIEF_MISSING history; brief now sources from `scenarios.brief_text`.
- The only `null` write-back (vs absent) is the defensive escape patch
  `patchRunAnalysisDecisionReviewNull`, which fires only if the enricher throws past its own safety net.
  *(source-verified: `turn-executor.ts:5436-5454`)*

### 6.3 Classification
**(A) expected by design given the current default flag state.** Not (B) retrieval/propagation bug, not
(C) debug artefact, not (D) fallback-reconstruction loss. The follow-up faithfully reports a genuine
upstream absence.

### 6.4 The deployed flag value — confirmed OFF on CEE staging (admin-verified)
A Render check (2026-05-30) confirmed `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` is **not present on the CEE
service**, so it resolves to the code default **`false`** (**admin-verified**; caveat: confirm no linked
Render Environment Group overrides it). The OFF branch below is therefore the **operative staging
reality**, not a hypothesis.
- **OFF (confirmed on staging):** `decision_review` / Phase 3 blocks are not produced or persisted on any
  run_analysis turn, so they are never available on follow-up. **Deterministic, enrichment-backed coaching
  is the primary near-term path** (the raw material is present — §6.5). **Do not enable or add the flag in
  this workstream.**
- **ON (a pending product/latency decision, out of scope for the §11 lane):** the gap would shift to
  **latency** (an extra LLM call + up to 15s on run_analysis turns), **skip reasons**
  (`no_brief`/`no_results`/`no_winner`), and **ensuring `decision_review` reaches follow-up surfaces** (it
  does, via the shared selector — §6.1).
- **Either way:** deterministic, enrichment-backed coaching remains valuable as a fast, reliable fallback
  for turns where the enricher is off, skipped, timed out, or degraded — so the §11 lane is correct
  regardless of any later flag decision.

### 6.5 Why a reliable fallback is feasible
The `run_analysis` handler persists the **full PLoT `V2RunResponseEnvelope` verbatim** in
`result.enrichment` *(existing-map-confirmed §4b; source-verified: `analysis-fallback.ts:18-27,184-186`)*.
So even when `decision_review` is absent, the fact still carries `factor_sensitivity` (→ top_drivers +
directions), `robustness` (→ fragile_edges), `review_cards`, `m1_coaching`, and `decision_brief`. The
data is there; what is missing is a **deterministic follow-up consumer** for it (§8).

### 6.6 Deployed flag value — RESOLVED (admin-verified); skip reason now derivable
A Render check (2026-05-30) confirmed `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` is **absent on the CEE
service**, resolving to the code default **`false`** (**admin-verified**). *Caveat:* confirm no linked
Render **Environment Group** overrides it, if not already visible.

Given the flag is `false`, the run_analysis skip reason is **`autofire_disabled` by code logic** — both
the free-text (`turn-executor.ts:4177`) and chip-click (`chip-click-dispatch.ts:450`) paths short-circuit
*before* the enricher runs, so the enricher-internal skips (`no_brief`/`no_results`/`no_winner`) cannot
fire on staging until the flag is enabled. *(inferred from the admin-verified flag value + source-verified
control flow.)* No local log artefacts exist to grep, and none are needed for this conclusion.

---

## 7. Root cause and trigger pattern of `analysis_state_source: fallback`

```ts
// src/orchestrator-v5/turn-executor.ts:768-810
let analysisStateSource: 'request' | 'fallback' | 'absent' = 'absent';
if (options.analysisState) {
  analysisSummary = compactAnalysis(coerceIngressAnalysis(options.analysisState));
  analysisStateSource = 'request';                      // PREFERRED
} else {
  const fallback = buildAnalysisFromPriorFacts(context.prior_facts, optionLabelSource);
  if (fallback) { analysisSummary = fallback; analysisStateSource = 'fallback'; }
}
```
*(source-verified: `turn-executor.ts:768-810`)*

- **Values:** `request` (UI echoes `analysis_state`) | `fallback` (reconstruct from prior facts) |
  `absent` (neither).
- **Preferred:** `request`. **Trigger for `fallback`:** request omits `analysis_state` **and** a prior
  successful `run_analysis` fact exists.
- **Is fallback a degradation?** When the persisted enrichment is well-formed (normal), **no** — 
  `buildAnalysisFromPriorFacts` reuses `compactAnalysis()` on the verbatim envelope and yields
  top_drivers / robustness_level / fragile_edges / win-probabilities, with a top-level
  `factor_sensitivity[]` reader (`deriveTopDriversFromTopLevel`) to match the staging shape. *(source-verified:
  `analysis-fallback.ts:91-151,184-225`)* Only when enrichment is missing/malformed does it degrade to a
  thin summary (`top_drivers:[]`, `robustness_level:'unknown'`) *(source-verified: `:227-291`)*.
- **Normal or exceptional?** It is a **designed, expected path**, and is plausibly the **common** path for
  conversational follow-ups where the UI does not re-send `analysis_state`. The actual **trigger rate**
  (does the deployed DGAI UI echo `analysis_state`?) is **`unknown-needs-runtime-proof`** (DGAI-side).
- **Does it explain the missing coaching fields?** **No.** Neither the request nor the fallback summary
  carries `decision_review`; the advice gate reads `decision_review` **separately** via
  `pickLatestDecisionReview(prior_facts)` *(source-verified: `turn-executor.ts:3110`; `pick-decision-review.ts:45-61`)*.
  `analysis_state_source` is therefore **decoupled** from `phase3_block_context_available`. Fallback is
  **not** the central coaching-loss path — §6 is.

---

## 8. Field survival table

From analysis output (PLoT enrichment) → persisted `run_analysis` fact → follow-up context → consumer.

| Field | Persisted on fact? | Reaches follow-up context? | Has a deterministic follow-up consumer? | Classification | Evidence |
|---|---|---|---|---|---|
| top_drivers | yes (verbatim `factor_sensitivity`) | yes (fallback/compactAnalysis; ContextPack cap 3) | yes (advice gate, routing projection) | **REACHES-FOLLOW-UP** | source-verified `analysis-fallback.ts:91-151,213-216` |
| factor directions | yes (`direction` enum) | yes; honoured verbatim (PR #221) | yes | **REACHES-FOLLOW-UP (honest)** | source-verified `influence-direction.ts:27-40`; `analysis-fallback.ts:129` |
| fragile_edges | yes (`robustness`) | yes, **thinned** to label-pairs in ContextPack | partial (advice gate / enricher raw) | **REACHES-FOLLOW-UP (thinned)** | existing-map-confirmed §7a/§9-4 |
| evidence gaps | yes (`m1_coaching.evidence_gaps`) | yes (in enrichment) | **only via `decision_review` enricher** | **IN-ENRICHMENT, NOT CONSUMED when autofire off** | source-verified `decision-review-enricher.ts` (m1 normalise); gated §6 |
| review_cards | yes (verbatim) | yes (in enrichment) | yes — `post-analysis-wrapper` reads latest fact for chips | **REACHES-FOLLOW-UP (chips)** | existing-map-confirmed §4b/§7b#12 |
| evidence priority (VoI/EVPI) | yes (`evpi_percentage_points`) | yes (in enrichment) | **only via `decision_review`→phase3 EvidenceBlocks** | **IN-ENRICHMENT, NOT CONSUMED when off** | existing-map-confirmed §9-6; gated §6 |
| m1_coaching | yes (verbatim) | yes (in enrichment) | **only via `decision_review` enricher input** | **IN-ENRICHMENT, NOT CONSUMED when off** | source-verified enricher m1 normalise |
| decision_brief | yes (verbatim) | yes (in enrichment) | **only via enricher / phase3 scenario_context** | **IN-ENRICHMENT, NOT CONSUMED when off** | existing-map-confirmed |
| **decision_review** | **only when autofire ON + brief present** | **only when produced** | yes (phase3-blocks, advice gate `evidence_gap`) | **NOT PRODUCED by default → absent on follow-up** | source-verified §6 |
| widening_log | no (JSONL sidecar) | next-turn only (`coaching.draft_coaching`) | not same-turn | **LOST same-turn / next-turn via sidecar** | existing-map-confirmed §8b |
| strengthen_items | no (sidecar + crosses to post-draft) | same-turn `[0]` only; next-turn sidecar | partial (`[0]` only) | **PARTIAL** | existing-map-confirmed §9-2 |
| bias_signals | no (sidecar + crosses) | same-turn one signal; next-turn sidecar | partial | **PARTIAL** | existing-map-confirmed §9-3 |
| pending actions | yes (session store) | yes | yes (short-confirm gate) | **REACHES-FOLLOW-UP** | existing-map-confirmed §4b |
| suggested chips | no (compose-time) | re-derived each turn (wire) | yes (composers) | **WIRE-ONLY** | existing-map-confirmed §6 |

**Actionable pattern:** the raw analysis material (`factor_sensitivity`, `robustness`, `review_cards`,
`m1_coaching`, `decision_brief`, EVPI) is **all persisted and reaches follow-up context**, but most of it
has **no deterministic follow-up consumer** when `decision_review` is off. The gap is a missing consumer,
not missing data.

---

## 9. Stale/fresh reliability assessment

`deriveAnalysisFreshness` is pure and strict — a `===` hash compare with a hard-invariant enforcer
*(source-verified: `freshness.ts:380-439`)*. Selection is via the single shared `selectRunAnalysisFact`
(newest successful by `computed_at`, stable sort, newest-first loader convention) *(source-verified:
`freshness.ts:283-318`)*.

- **No "changed graph treated as fresh" path found.** match→`fresh`, diverge→`stale`, missing hash→
  `unknown`, no fact→`none`. *(source-verified)*
- **No projection-vs-verdict drift.** The freshness verdict, the analysis projection
  (`buildAnalysisFromPriorFacts`), the advice gate (`pickLatestDecisionReview`), and the readiness flag
  all route through `selectRunAnalysisFact` — a deliberately shared selector that eliminated the
  pre-state-trust drift class. *(source-verified: `freshness.ts:277-282`; `pick-decision-review.ts:1-19`)*
- **Stale-rerun chip cannot be silently skipped.** The stale-rerun guard runs before the advice gate; the
  advice gate itself gates on `freshness === 'fresh'`. *(source-verified: gate order; `turn-executor.ts:3100`)*

**Residual wrinkle (refinement #4) — classified carefully.** The fallback summary's staleness stamp
(`FALLBACK_STALENESS_REASON = 'loaded_from_prior_run_freshness_unknown'`, `analysis-fallback.ts:53`) is
applied by the turn-executor **only when the derived freshness is `stale` or `unknown` — never on
`fresh`** *(source-verified: `turn-executor.ts:779-781,806-808`)*. So the dangerous direction (a "fresh"
turn wrongly carrying an "unknown" stamp) **is already guarded**; the prior P0 bug (every explain turn
stamped) is fixed.

What remains is a **honesty / maintainability risk, not a current hard bug**:
1. **Stale module documentation.** `analysis-fallback.ts:10-16` still states fallback summaries are
   "ALWAYS flagged `loaded_from_prior_run_freshness_unknown`" — contradicting the now-conditional code. A
   maintainer trusting the comment could reintroduce the P0 bug. *(source-verified)*
2. **Dual freshness signals.** Two representations coexist — the conditional `analysisStalenessReason`
   string and the structured `freshness.freshness` enum. Future copy that reads one where it should read
   the other could reintroduce inconsistency. *(inferred)*
3. **Conservative under-claim on `stale` turns.** On a genuinely `stale` turn the prefix constant says
   "freshness_unknown" even though the derivation specifically determined `stale` (graph diverged) —
   imprecise, but conservative (never over-claims freshness). *(source-verified)*

**Cheap follow-up to track** — **not a current hard correctness blocker**, but a real
**reintroduction / maintainability risk**: (i) fix the stale `analysis-fallback.ts` doc so it matches the
now-conditional stamp, and (ii) ensure future copy reads the **structured `freshness` enum** as the single
source of truth rather than the conditional `loaded_from_prior_run_freshness_unknown` staleness string —
the two signals must not be consulted inconsistently. Folds naturally into the unified coaching lane
(§11) since it touches the same copy surfaces; does not warrant its own branch.

---

## 10. Risks to the V5 AI experience

"No reliability blocker" means **no context-retrieval bug** — it does **not** mean the experience is good
enough. The product gap:

1. **Deepest coaching layer off / unavailable by default.** With `decision_review` disabled (or skipped),
   post-analysis follow-ups are **under-coached**: the advice gate composes from the thin projection only
   (§5). *(source-verified mechanism; deployed prevalence `unknown-needs-runtime-proof`.)*
2. **Rich persisted enrichment is unused on follow-up.** `factor_sensitivity` / `robustness` /
   `review_cards` / `m1_coaching` / `decision_brief` / EVPI are all present but have no deterministic
   follow-up consumer when `decision_review` is off (§8). The lift is turning present data into
   user-facing guidance.
3. **Tone risk on stale turns.** Advice composed from the thin projection without a decision_review caveat
   could read confident on a stale analysis; the stale-rerun guard intercepts genuine staleness first, so
   this is a coaching-completeness/tone risk, not a correctness break (§9). `unknown-needs-runtime-proof`
   for tone in practice.
4. **Latent freshness-signal drift + stale doc** (§9) — forward-looking maintainability risk.

---

## 11. Recommended implementation — one unified lane

**There is one next code lane, not several.** This audit is the **justification for a narrowed Coaching
Surface Delivery**, delivered as a **single coherent implementation** — not a set of competing branches
touching the same files. **Must-fix reliability blockers: none** (retrieval is sound; do not build
fallback copy to mask a non-existent bug).

**The unified lane (one branch / coherent change set), all V5-owned and deterministic:**

| # | Component | Why it matters | Likely files |
|---|---|---|---|
| a | **Deterministic, enrichment-backed coaching** — read the raw enrichment already on the fact (`factor_sensitivity`, `robustness`, `review_cards`, `m1_coaching`, `decision_brief`, EVPI) so post-analysis coaching does **not** depend on the flag-gated `decision_review` | turns present-but-unconsumed data (§8) into guidance; reliable regardless of the flag | `routing/post-analysis-advice-gate.ts`, `compose/phase3-blocks.ts` |
| b | **Post-draft coaching improvements** — Tranche A: wire `widening_log`, consume `strengthen_items[1..n]`, surface more `bias_signals` | already cross the V4→V5 boundary; safe quick wins | `coaching/post-draft-narrative.ts`, `handlers/draft-graph-dispatch.ts` |
| c | **Minimal post-analysis fallback/coaching improvements** — degrade-aware composer behaviour when `decision_review` is null | the default-deployment path today | `routing/post-analysis-advice-gate.ts` (shared with (a)) |
| d | **Additive copy-source diagnostics (only if contained)** — e.g. disambiguate which coaching source produced the copy; record the `decision_review` skip reason at the surface | makes the eventual flag decision data-driven without a separate workstream | same surfaces as (a)/(c) |

These components **touch the same files** (`post-analysis-advice-gate.ts`, `phase3-blocks.ts`,
`post-draft-narrative.ts`), so they must ship as **one change set** — **do not spin up parallel branches
on these surfaces.** The §9 freshness-doc/dual-signal cleanup folds in here too (same copy surfaces).
Codex review: **yes.** Runtime proof to *build*: no; for **final acceptance**: **yes** (§14).

**Explicitly NOT part of this lane (do not bundle):**

- **Product/latency decision** on `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` — adds an LLM call + up to 15s
  to run_analysis turns; needs the skip-reason distribution + latency data. **Stop-and-report / product
  decision**, not a code change in this lane.
- **Turn-persisting runtime trace** (prompt-bypass rate, `analysis_state` echo rate) — **Supabase-isolation
  gated**; a separate read-only instrument, distinct from the contained additive diagnostics in (d).
- **Deferred net-new plumbing:** `triggered_plays` / `top_fragile_assumption` (V4-only).

---

## 12. Impact on the Coaching Surface Delivery brief — it **NARROWS**

This audit **is the justification for the narrowed Coaching Surface Delivery** — the §11 unified lane
**is** that workstream, not a competing lane beside it.

- The brief must **not assume** Phase 3 / `decision_review` blocks are available on follow-up — they are
  **disabled by default** (§6).
- It must explicitly choose a source: **(a)** deterministic coaching from the **raw enrichment that is
  reliably persisted** (recommended; no flag flip, no product decision); or **(b)** enable
  `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` (a product/latency decision requiring runtime proof). Either
  way, keep (a) as the degraded-path fallback.
- It must **not** add decorative fallback copy to mask a retrieval bug — there is none.
- **It does not pause** the workstream: the §11 unified lane can begin now. But **final acceptance still
  requires rendered-surface proof** once the Supabase binding is confirmed (§14) — the experience must be
  verified on the actual surface, not only in unit contracts.

**Tracker (process note).** The canonical [`V5_CURRENT_STATE.md`](./V5_CURRENT_STATE.md) is **intentionally
NOT updated in this audit commit** (which is limited to this report). After this report is reviewed /
published, a **separate small docs follow-up** will record in the tracker: *"`decision_review` fixed in
code but gated off by default via `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`; pending product/latency
decision"* — the §1 headline correction to the operating model.

---

## 13. Testing / contract recommendations (none written here)

Contract-first tests for the future implementation: context-assembly; stale/fresh hash-compare;
run_analysis-fact retrieval/selection; post-analysis follow-up context; **Phase 3 block propagation
(incl. flag-off → `decision_review` absent → faithful `phase3_block_context_available:false`)**;
fallback analysis-state (request-vs-fallback parity when enrichment is well-formed); no-stale-confidence;
and field-survival-to-surface (each persisted enrichment field has a deterministic follow-up consumer).
**Do not write tests in this audit.**

---

## 14. Unknowns requiring runtime proof

**Resolved since the first draft (admin-verified):**
- **Deployed `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` value on staging** — a Render check (2026-05-30)
  confirmed it is **absent on the CEE service** → resolves to code default **`false`**; the §6.4 OFF
  strategy is operative. *(admin-verified; caveat: confirm linked Environment Groups if not already
  visible.)*
- **Which `decision_review` skip reason fired** — given the flag is `false`, it is **`autofire_disabled`**
  by code logic (§6.6). *(inferred from the admin-verified flag value + source-verified control flow.)*

**Still open:**
- **`analysis_state` echo rate** from the deployed DGAI UI → the `fallback` trigger rate.
  *(unknown-needs-runtime-proof)*
- **Prompt bypass rate / fall-through vs advice-gate split** — bounds the leverage of any prompt work.
  *(unknown-needs-runtime-proof; carried from handler map §10b)*
- **Whether thin advice without `decision_review` reads as under-coached** on the rendered surface — the
  final-acceptance proof for the §11 unified lane / §12. *(unknown-needs-runtime-proof)*

> Implementation of the §11 unified lane may proceed before this proof; **final acceptance may not** — it requires
> rendered-surface verification once the Supabase binding is confirmed.

---

## Appendix — method & evidence integrity

Built from 3 read-only Explore sweeps (assembly + telemetry symptoms · consumers + finaliser ·
field-survival + stale/fresh), with every load-bearing claim **re-read personally** on `27bb71a8`:
`readiness.ts` (the phase3 flag), `freshness.ts` (selector + verdict), `turn-executor.ts` (analysis-state
block :768-810, advice-gate threading :3086-3120, decision_review autofire :4165-4240, escape patch
:5436-5454), `analysis-fallback.ts` (full), `config/index.ts:373-374`, `chip-click-dispatch.ts:450-483`,
`influence-direction.ts` (full), `pick-decision-review.ts` (full). Runtime claims are never asserted —
they live in §14 as `unknown-needs-runtime-proof`. `inferred` is never promoted to `source-verified`.
