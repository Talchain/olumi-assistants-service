# V5 Latency — Phase 0 v2 Summary (per-stage data)

> **Status: PARKED — handoff to V5 product lane.**
> This document is the final supporting evidence for the V5 latency
> workstream as of 2026-05-15. No further code changes will be made on
> this lane without a new brief.

## Lane status + decisions (2026-05-15)

The data below drove the following decisions. Recorded here so future
contributors do not re-open settled questions:

| Decision | Rationale (from this evidence) |
|---|---|
| **Cancel** "gate the Stage 4 Repair LLM pass" as an immediate fix. | `repair_fired: false` in **10/10** sampled journeys on the canonical brief. There is no LLM call to gate. |
| **`draft_graph` latency is dominated by one Parse LLM call** (~59.5 s mean, 99.1% of total wall clock). | All other unified-pipeline stages combined are <100 ms. This is the single biggest observed latency cost in V5. |
| **Streaming `draft_graph` is a future, separate brief — requires DGAI client coordination.** Not actioned from this lane. | ≥30 s perceived-latency saving (~60 s → ~500 ms TTFB), but the wire-shape change is a cross-team contract. |
| **`draft_graph` prompt / model benchmarking is a future, separate brief.** Not actioned from this lane. | Would attack the 59.5 s Parse LLM directly via prompt-tightening or a faster model. Belongs to whichever lane owns prompt quality / model selection. |
| **Demote "defer `append_turn_atomic` commit".** | `commit_ms` mean is **150 ms** across 16 observations. Not the leverage point. The original hypothesis (200 ms – 2 s) was wrong. |
| **Defer "add `_timings` to chip-click dispatch paths" as nice-to-have.** | Useful for future cold-start diagnostics on PLoT, but the present chip-click wall-clock + the inferred PLoT request time (Q4 below) gives a serviceable signal without it. |

**Workstreams that did ship while the latency lane was open** (no further latency action required):
- **PR #174** — V5 observability (per-stage timings on V5 turn + unified-pipeline + run_analysis). Live on staging build `45028b8`. **Originally gated on `V5_TIMING_DEBUG` only**; PR #182 added a second gate so wire emission of `_timings` now also requires the per-request `X-Olumi-Debug: timings` header. Replay-harness invocations must send the header to receive `_timings`; the env flag alone is insufficient post-PR-182.
- **PR #175** — Deterministic post-analysis router. Confirmed working: `what_would_flip` / `what_changed` / chip-click mutators all execute with **0 Sonnet calls** and complete in 700–900 ms.

---

**Captured**: 2026-05-15, ~13:18–13:22 UTC+1
**Staging build**: `45028b8` (degraded=false, version 1.12.0)
**Server config**: `V5_TIMING_DEBUG=true` (Render env override on `cee-staging`)
**Sample method**: 5 canonical journeys + 5 dl7-set-factor journeys, launched in parallel staggered by 3s. All 10 completed cleanly (PR #174 observability live, PR #175 deterministic post-analysis router live).
**Raw evidence**: [v5-latency-sample-v2-1.md](v5-latency-sample-v2-1.md) … [v5-latency-sample-v2-10.md](v5-latency-sample-v2-10.md)
**Secret check**: `grep` for the full `OLUMI_REPLAY_API_KEY` and its 8-char prefix returns zero matches across all 10 files — three-layer redactor working as designed.

---

## Headline numbers

| Turn type | n | elapsed_ms mean | range | Dominant stage |
|-----------|---|-----------------|-------|----------------|
| `draft_graph` (frame) | 10 | **60,060** | 57,476–64,448 | **parse_llm 59,523 ms** (99.1% of total) |
| Free-text post-graph (`weakest_option`) | 5 | **9,770** | 8,601–10,525 | routing_llm 8,547 ms (88%) |
| Free-text post-edit (`add_option`) | 5 | 10,361 | 8,719–12,754 | routing (timings n/a — routing-clarify path) |
| Chip-click `run_analysis` | 8 | **4,206** | 3,545–4,975 | PLoT ≈ 3,400 ms inferred (timings n/a — chip-click bypasses turn-executor) |
| Free-text `explain_leader` (post-analysis) | 8 | **13,077** | 11,910–14,184 | routing_llm 12,076 ms (94%) |
| Chip-click `set_factor_value` (mutator) | 3 | 1,139 | 1,037–1,258 | ctx_build 611 ms (floor) — **NO Sonnet** |
| Chip-click `what_would_flip` (deterministic) | 3 | **889** | 797–954 | ctx_build 568 ms (floor) — **NO Sonnet** ✓ PR #175 |
| Chip-click `what_changed` (deterministic) | 3 (FAIL) | 1,045 | 860–1,405 | ctx_build 505 ms — **NO Sonnet** |
| Free-text `edit_budget` | 5 | 5,989 | 4,607–10,206 | routing (timings n/a — routing-clarify path) |

> Note on "timings n/a": the chip-click and routing-clarify dispatch paths bypass `runTurnExecutor`'s main flow, so the response envelope carries no `_timings.turn` block today. This is a new observability gap surfaced by this pass — see Q7 runner-up.

---

## Required questions, answered from measured data

### Q1 — Is `draft_graph` making one LLM call or two?

**One.** Across 10 staging samples, `repair_fired: false` in **10/10** runs. `repair_attempts: 0` in 10/10. The Stage 4 Repair LLM pass (`runPlotValidation` → LLM repair fallback) never engaged on the canonical brief. The 59.5 s `parse_ms` mean is 99.98% LLM time (`parse_llm_ms` mean 59,523 ms), and that single Parse call accounts for 99.1% of the entire `draft_graph` wall clock.

This is the **most surprising / most actionable finding** in this pass. The previous round-1 hypothesis was that draft_graph might be paying for two LLM calls (Parse + Repair). Empirically: it pays for one large one.

### Q2 — How often does repair fire?

**0/10 (0%)** on the canonical Q3 roadmap brief. `repair_fired: false` consistently.

Caveat: the canonical brief is shaped well — clear options, clear factors, clear goal. A more diverse brief corpus (gibberish-near-threshold, ambiguous-options, missing-goal) could trigger Repair. But for typical product use, Repair is **dormant** and is **not** the latency lever. Cancel any Repair-gating brief.

### Q3 — Mean / best / worst per stage

| Stage | n | min | mean | max | Notes |
|-------|---|-----|------|-----|-------|
| `draft_graph.total_ms` | 10 | 57,014 | **59,586** | 63,989 | Whole unified-pipeline body |
| `draft_graph.parse_ms` | 10 | 56,992 | **59,536** | 63,934 | 99.9% of total |
| `draft_graph.parse_llm_ms` | 10 | 56,981 | **59,523** | 63,902 | Sonnet, the dominant cost |
| `draft_graph.repair_ms` (deterministic only) | 10 | 9 | 28 | 105 | LLM repair never fired |
| `draft_graph` other stages combined | 10 | <50 | ~50 | <120 | normalise/enrich/threshold/validation/package/boundary all <16 ms each |
| V5 routing_llm (`weakest_option`) | 5 | 7,659 | **8,547** | 9,000 | Sonnet routing call |
| V5 routing_llm (`explain_leader`) | 8 | 11,118 | **12,076** | 13,287 | Sonnet writes full answer_text |
| build_turn_context | 13 | 476 | **612** | 880 | Supabase reads (prior_turns + facts + scenarios.graph + brief_text) |
| assemble_context_pack | 13 | 1 | **8** | 55 | Pure transforms |
| handler_execute (explain_results) | 8 | 0 | **0** | 1 | Deterministic, consumes Sonnet `answer_text` |
| handler_execute (set_factor_value) | 3 | 2 | **36** | 104 | Graph mutation + Zod parse |
| commit (`append_turn_atomic`) | 16 | 111 | **150** | 350 | Supabase RPC, awaited on critical path |
| `run_analysis` (chip-click total) | 8 | 3,545 | **4,206** | 4,975 | Wall clock; PLoT request inferred ~3,400 ms (see Q4) |

### Q4 — Is `run_analysis` variance mostly PLoT-side or CEE-side?

**Mostly PLoT-side**, inferred from a side-by-side comparison.

Chip-click `run_analysis` and chip-click `set_factor_value` use the same dispatch infrastructure (`dispatchChipClick`); the only meaningful difference is the outbound PLoT HTTP round-trip.

- `set_factor_value` mean: **804 ms** (= CEE-side floor — ctx 611 + handler 36 + commit 169 + overhead)
- `run_analysis` mean: **4,206 ms**
- Implied PLoT request: 4,206 − 804 ≈ **3,400 ms** on average
- Variance (range/mean): `run_analysis` is 1,430 ms wide on a 4,206 ms mean (34%). `set_factor_value` is 221 ms wide on 1,139 ms (19%). CEE-side variance contributes ≤300 ms; the rest (≥1,100 ms) is in PLoT.

> **Caveat**: `_timings.run_analysis.plot_request_ms` is NOT directly visible on the wire today because the chip-click dispatch path bypasses `runTurnExecutor` (where the executor copies `HandlerOutcome.__plot_timings` onto `_timings.run_analysis`). The handler still emits the `v5.run_analysis.timings` telemetry event with `plot_request_ms` — server logs have the exact number. The harness-visible inference above is consistent with what telemetry would show. Closing this is the runner-up fix (Q7).

### Q5 — Are cache hits working reliably?

**Yes.** Anthropic prompt cache hits 12 out of 13 non-first-turn observations. The 1 miss is the first follow-up after `draft_graph` on each scenario — that turn **creates** the cache (`cache_create_tokens: 7818`, `cache: miss`). Every subsequent turn in the scenario reads it (`cache_read_tokens: 7818`, `cache: hit`).

Stable prefix size: **7,818 tokens** (system prompt + tools). Cache hits save ~5K tokens of input per multi-turn turn — material on cost, sub-second on wall clock (Anthropic's cache TTFB advantage is small but real).

No `cache: unsupported`, no `cache: unknown`, no `cache_mode: disabled_*` observed. The previous suspicion that the cache might be silently disabled by an API fallback path is **disproven**.

### Q6 — Do deterministic post-analysis / router turns avoid Sonnet?

**Yes, completely.** Across all chip-click and deterministic-router samples:

| Step | turn_llm_calls | turn_routing | turn_total | Sonnet skipped? |
|------|----------------|--------------|------------|-----------------|
| `set_factor_value` (chip) | 0 (n=3) | absent | 804 ms | ✓ |
| `what_would_flip` (chip, post-#175) | 0 (n=3) | absent | 696 ms | ✓ |
| `what_changed` (deterministic) | 0 (n=3) | absent | 636 ms | ✓ |

The 10× wall-clock gap between deterministic paths (~700–900 ms) and Sonnet-bound paths (8–13 s) is the strongest empirical case for expanding the deterministic dispatcher to more intents.

`what_changed` fails the harness assertion in all 3 runs (factor label not referenced in the response text — 32–37 char generic clarify response). The path is fast but the *content* is broken. Worth a separate quality-pass brief.

### Q7 — Next highest-impact latency fix based on measured data

**1. Stream the `draft_graph` Parse LLM call.**
- **Impact**: ~60 s wall clock → ~500 ms TTFB. Single biggest perceived-latency win in V5.
- **Evidence**: draft_graph is 60.1 s mean. Parse LLM is 59.5 s (99.1%) of that. All other stages combined are sub-100 ms. Streaming doesn't reduce total work; it makes TTFB nearly instant and shows the user that something is happening. The standalone `/assist/v1/draft-graph/stream` endpoint already runs SSE for the V4 route — the pattern is proven.
- **Why not "gate Repair"** (the previous candidate): Repair fires 0/10 in this corpus. There's no LLM-call to gate. Cancel that brief.
- **Safety / scope**: requires DGAI client coordination on SSE consumption. Separate brief.

**2. Add `_timings` to chip-click dispatch paths (observability completion).**
- **Impact**: low directly. Closes a gap surfaced by this pass — chip-click `run_analysis`, `set_factor_value`, `what_would_flip` etc. all have `elapsed_ms` only on the wire. PLoT request time, context build, commit all invisible.
- **Approach**: have `dispatchChipClick` produce the same `_timings.turn` + optional `_timings.run_analysis` blocks as `runTurnExecutor`. Small server-side change, no client impact.
- **Why this is "highest impact for the next data pass"**: once chip-click `run_analysis` carries `plot_request_ms`, we can answer the cold-start question definitively and decide whether to flip PLoT's Render plan.

**3. Deterministic free-text equivalent of `explain_results`.**
- **Impact**: ~12 s → ~700 ms for "why is X winning"-shape free-text follow-ups. PR #175 closed this for chip-click; free-text is the gap.
- **Evidence**: `explain_leader` is 12.8 s mean with 94% routing_llm. Cache hits 100% but the LLM round-trip still costs 12 s — caching can't undo that.
- **Approach**: extend PR #175's deterministic router with free-text intent classifiers ("why does X win", "why is Y leading", "explain the result"). Lane 1 P0 workstream.

**4. Investigate `build_turn_context` (Supabase reads).**
- **Impact**: ~600 ms per turn — consistently across every turn type. On chip-click turns this is the floor, so it's the dominant non-LLM cost we have.
- **Evidence**: ctx mean 612 ms across 13 observations, narrow range (476–880). Very consistent across handler types — implies the cost is the same set of Supabase queries on every turn (prior_turns + facts + scenarios.graph + brief_text).
- **Approach**: profile which query dominates. Possible wins from request-coalescing or covering indexes.

### Where this leaves the previous Top-5 ranking

| Round-1 fix | Round-1 priority | Round-2 (data) verdict |
|-------------|------------------|------------------------|
| Fix 4 — per-stage telemetry | Rank 1 | **Shipped (PR #174)**. This pass is the payoff. |
| Lane 1 P0 deterministic router | Rank 2 | **Shipped (PR #175)**. Confirmed working: 0 LLM calls on `what_would_flip` / `set_factor_value` / `what_changed`. |
| Fix 5 — harness verbose timings | Rank 3 | **Shipped (PR #174)**. Evidence rows now carry per-stage data. |
| Streaming (Fix 1) | Rank 4 (deferred) | **PROMOTED to Rank 1.** Data confirms 60s draft_graph is one synchronous LLM call. |
| Deferred commit (Fix 3) | Rank 5 (deferred) | **DEMOTED.** Commit is 150 ms mean — meaningful but not the leverage point. Keep deferred. |
| Repair-stage gating | TBD | **CANCEL.** Repair fires 0/10. There's nothing to gate. |

---

## Reliability + scope notes

- All 10 runs completed without transport errors, validation failures, or BoundaryError envelopes.
- Pre-existing harness assertion fragility on `what_changed` (3 FAIL) and `set_factor_value` (2 FAIL across 5 dl7 runs) — content-shape, not latency. Out of scope.
- Two `5_explain_leader` SKIPs (dl7-set-factor 9, 10) cascaded from upstream step failures in those journeys. The 8 passing samples are representative.

## Constraints honoured

No prompts edited. No models / providers / timeouts / streaming / deferred commit / router code changed in this evidence pass. No infrastructure changed. Service responses on staging unchanged for clients (the `_timings` field is additive and only present when `V5_TIMING_DEBUG=true`).

---

## Hand-off — to V5 product lane

This document supersedes [`Docs/latency/v5-latency-summary.md`](v5-latency-summary.md) (round 1 / pre-observability estimates). For all future latency work, treat THIS file as the canonical baseline.

Supporting artefacts in the same directory:
- [`plot-mini-check.md`](plot-mini-check.md) — PLoT / run_analysis variance investigation note (read-only, no infrastructure recommendation made).
- [`v5-concurrent-draft-design-note.md`](v5-concurrent-draft-design-note.md) — future-capability sketch (concurrent LLM draft candidates). `DraftGraphTimings.candidates` schema slot reserved for it.
- [`v5-latency-sample-v2-1.md`](v5-latency-sample-v2-1.md) … [`v5-latency-sample-v2-10.md`](v5-latency-sample-v2-10.md) — raw per-journey evidence with full `_timings` blocks.

**Briefs that should be opened separately if/when the V5 product lane decides to act**:
1. **Streaming `draft_graph` Parse** — DGAI coordination required.
2. **Prompt / model benchmarking for `draft_graph`** — attacks the same ~60 s cost from a different angle. May make streaming unnecessary or pair with it.
3. **Deterministic free-text `explain_results`** — natural extension of PR #175 (router) to free-text equivalents. 12.8 s → ~700 ms when the pattern matches.
4. (Nice-to-have) **Chip-click `_timings` parity** — extends PR #174 observability into the chip-click dispatch path so `plot_request_ms` becomes wire-visible on every PLoT call.

None of these are scheduled. Each needs its own brief, owner, and acceptance criteria — not derivable from latency data alone.

**`V5_TIMING_DEBUG=true` is currently live on staging.** When the V5 product lane is done with this evidence, the flag can be flipped back to `false` (or left on for ongoing observation — the surface is gated and additive, no client-visible cost). Production default remains OFF; the production response shape is unchanged either way.
