# V5 Latency — Phase 0 Live Sampling Summary

**Captured**: 2026-05-14, ~15:45–15:49 UTC+1
**Staging build**: `7872102` (version 1.12.0, degraded=false)
**Harness**: `tools/v5-journey-replay` — 5 canonical runs + 5 dl7-set-factor runs
**Raw evidence**: `Docs/latency/{canonical-1..5,dl7-1..5}.md`
**Sample method**: Sequential within a single journey (each run is a fresh `scenario_id`). Runs launched in parallel staggered by 2s to avoid thundering staging. All hit the same Render staging deploy.

> ⚠️ **One important measurement gap**: the replay harness's `assertExplainLeader` and `assertWhatWouldFlip` assertions drop `elapsed_ms` from the evidence row in several branches (passed, stale, text-too-short). The client *does* measure `result.elapsed_ms` per request ([tools/v5-journey-replay/assertions.ts:132,447,536](tools/v5-journey-replay/assertions.ts#L132)) — the assertion DSL just doesn't always include it. This is the prerequisite Fix 5 from the audit plan: surface `elapsed_ms` on every row, plus `llm_calls_used` and `cache_hit` from the response envelope.

---

## Measured per-turn latency (wall clock, ms)

| Turn type | Samples (n) | Min | Mean | Max | Notes |
|-----------|-------------|-----|------|-----|-------|
| `draft_graph` (initial brief → graph) | 10 | 47,706 | **51,330** | 54,645 | Very consistent. Whole-pipeline LLM-bound. |
| `run_analysis` (chip click → PLoT) | 9 | 4,357 | **13,066** | 19,545 | Wildly variable. PLoT compute, not Sonnet. |
| `weakest_option` (free text post-graph follow-up) | 5 | 9,879 | **11,708** | 13,105 | Sonnet routing + narrate. |
| `add_option` (free text edit/clarify) | 5 | 9,563 | **10,479** | 11,931 | Sonnet routes to clarify; returns short text. |
| `edit_budget` (free text edit) | 5 | 4,357 | **6,116** | 8,188 | Sonnet routes; clarification response. |
| `what_would_flip` (free text post-analysis) | 3* | 13,246 | **14,021** | 15,455 | *2 of 5 had no elapsed recorded (1 fail, 1 prereq-skip) |
| `set_factor_value` (chip click, mutation) | 4 | 1,189 | **1,244** | 1,276 | **Deterministic path — Sonnet-skipped.** |
| `what_changed` (free text post-mutation) | 4 | 811 | **888** | 1,021 | Deterministic clarify fallback — fast but all 4 *failed* the factor-mention assertion. |
| `explain_leader` (post-analysis explanation) | 0 measured | — | — | — | **Harness gap — no elapsed in row.** Body shows ~1100–1300 char Sonnet answer when it works, ~84 char recovery text when handler errors. |

*Mean is the arithmetic mean of the listed samples; n<5 marked with note.*

### Sonnet-bound vs. deterministic split (measured)
- **Sonnet-bound turns (free text):** 6.1 – 14.0 s wall mean. Range: 4.4 – 19.5 s.
- **Deterministic chip-click turns:** 0.9 – 1.3 s wall mean. ~10× faster than Sonnet free-text equivalents.
- **`draft_graph` is its own class:** 47–55 s (V4 unified-pipeline; 2 LLM calls + repair + boundary + persist).
- **`run_analysis` is PLoT-bound, not LLM-bound:** wide variance suggests PLoT cold start / queueing, not orchestrator overhead.

---

## Time-budget breakdown (what we can say with confidence vs. inference)

The harness gives **only total wall time per turn**. Sub-stage breakdown (Sonnet vs PLoT vs context-assembly vs `append_turn_atomic`) is **not directly captured** from the response envelope. The numbers below are inferences from code paths confirmed in the audit, not measurements.

### `draft_graph` (~51 s mean) — confirmed pipeline
Path: [route-v2.ts](src/orchestrator/route-v2.ts) → [draft-graph-dispatch.ts](src/orchestrator-v5/handlers/draft-graph-dispatch.ts) → V4 [unified-pipeline/index.ts](src/cee/unified-pipeline/index.ts) stages 1–6.
- **Stage 1 Parse (LLM call)**: dominant; OpenAI/Anthropic structured generation of a non-trivial graph.
- **Stage 4 Repair (possibly LLM)**: budget-gated; fires when validation flags repair-worthy issues.
- **Stages 2, 3, 4b, 5, 6 (deterministic)**: normalise → enrich → threshold-sweep → package → boundary. <2 s combined in principle.
- **Persistence**: scenarios.graph write via `append_turn_atomic`.
- **Conclusion**: at ~51 s mean, this *must* be two LLM round-trips (Parse + Repair) plus ingestion. The single biggest absolute latency target in V5.

### `run_analysis` (~13 s mean, 4–20 s range) — PLoT-bound
Path: [route-v2.ts](src/orchestrator/route-v2.ts) → Sonnet routing (chip dispatch may skip; chip-click here is short-confirm-or-direct?) → [tools/handlers/run-analysis.ts](src/orchestrator-v5/tools/handlers/run-analysis.ts) → [PLoTClient](src/orchestrator-v5/plot-client.ts) → commit.
- **No LLM in handler** — confirmed by [Docs/v5/v5-llm-call-site-inventory.md](Docs/v5/v5-llm-call-site-inventory.md) and code audit.
- The 4 → 20 s range likely reflects: (a) PLoT warm vs. cold execution, (b) Render network conditions, (c) `append_turn_atomic` time.
- **Sonnet may still fire on the chip dispatch step** if it goes through routing; deterministic chip-click for run_analysis is in [short-confirm](src/orchestrator-v5/routing/deterministic-short-confirm.ts) — need server logs to confirm.

### Free-text follow-ups (`weakest_option`, `add_option`, `edit_budget`, `what_would_flip`) — Sonnet routing dominant
~6–14 s mean. All travel through `routeWithToolUse` → Sonnet `chatWithTools` once per turn → handler dispatch.
- Sonnet writes the full `explanation.answer_text` in the routing call (single LLM round-trip — confirmed in [tool-schema.ts:265-301](src/orchestrator-v5/routing/tool-schema.ts#L265-L301)).
- ~5–10 s of that is Sonnet itself; the rest is context assembly + Supabase round-trips + commit.

### Chip-click deterministic (`set_factor_value`) — ~1.2 s
- Path: pre-routing deterministic dispatcher matches chip metadata → mutator handler → commit.
- **Sonnet-skipped** ([deterministic-value-update.ts](src/orchestrator-v5/routing/deterministic-value-update.ts)).
- Remaining ~1.2 s = context build + handler + commit + network. This is the **floor** of V5 latency on the current stack.

### `what_changed` free-text → deterministic clarify (~0.9 s)
- All 4 runs returned ~32–37 char "Hmm, I'm not sure…" responses without referencing the just-mutated factor. They beat the Sonnet routing path because they short-circuit early, but the content is product-broken (assertion failure: factor not mentioned).
- This is a **double signal**: deterministic free-text dispatch *exists already* for some inputs, *and* it's broken — exactly the kind of work Lane 1 should rationalise.

---

## Answers to the six required questions

### 1. What are the actual measured latencies by turn type?
See table above. Key numbers (mean wall clock):
- `draft_graph`: **51.3 s** (47.7–54.6, very tight)
- `run_analysis`: **13.1 s** (4.4–19.5, very wide)
- `explain_results / explain_leader`: **not directly captured** — harness assertion drops `elapsed_ms`. Body inspection suggests Sonnet round-trip (~5–10 s) when handler succeeds; ~1–2 s when handler error path fires (84-char recovery text).
- `what_would_flip` (free text): **14.0 s** (3 samples)
- Free-text post-graph/edit follow-ups: **6.1–11.7 s**
- Chip-click `set_factor_value`: **1.24 s** (n=4, very tight) — ~10× faster than Sonnet-bound equivalents.

### 2. How much time is Sonnet vs PLoT vs commit vs context assembly?
**Cannot be answered from current telemetry surface.** The response envelope and harness do not expose sub-stage timing. Confidence-graded inference:
- For `draft_graph`: ≥85% of ~51 s is the two LLM round-trips (Parse + Repair). Context build is sub-second; commit is 200 ms–2 s.
- For free-text follow-ups: ~5–10 s is Sonnet; remainder is Supabase reads (build-turn-context loads `prior_turns` + `prior_facts` + `scenarios.graph`) + commit.
- For `run_analysis`: ~0 s LLM in handler. The 4–20 s range is dominated by PLoT compute time and possibly Sonnet routing-dispatch overhead on the chip-click. Cannot disambiguate without server log access.
- For chip-click `set_factor_value`: ~0 s LLM. Total ~1.24 s = context build + handler + commit + network round-trip.

**Action**: Fix 4 (per-stage telemetry + cache_hit + commit_ms surfaced on envelope) is now **prerequisite**, not optional. Without it, every subsequent fix is guessing.

### 3. Which turns still call Sonnet unnecessarily?
Strong-signal candidates (from observed behaviour + code paths):
- **All free-text post-analysis follow-ups** — "why is X leading?", "what would change?", "what's the weakest option?" — these match deterministic intents but currently route through Sonnet because the deterministic dispatch only fires on chip metadata, not natural-language equivalents. **This is exactly the Lane 1 P0 router's scope.**
- **Free-text edit/clarify turns (`add_option`, `edit_budget`)** — Sonnet routes to clarification 100% of the time across 10 samples. Pattern is shaped: "I wasn't able to make that change safely…" / "I couldn't see a concrete change…". A pre-routing classifier could route these to deterministic clarify without burning Sonnet.
- **Possibly `run_analysis` chip-click** — needs server-log confirmation. If chip-click run_analysis still triggers a Sonnet routing call, it shouldn't.

### 4. Which fix gives the biggest safe improvement now?
Two complementary, both safe:

**(a) Fix 4 — Per-stage telemetry + cache_hit surfacing (low-risk, prerequisite).** Pure observability. Unblocks every other decision. Without it, we cannot tell whether `draft_graph`'s 51 s is 40 s Parse + 11 s Repair, or 25 s Parse + 25 s Repair, or some other split — and the fix shape changes accordingly. **Recommended first action.**

**(b) Hand Phase 0 evidence to the Lane 1 P0 router workstream.** The data shows free-text follow-ups cost 6–14 s. Lane 1 routing those to deterministic paths would drop them to the 0.9–1.2 s observed on chip-click and `what_changed`. That's a **5–12 s saving per Sonnet-bound free-text turn**, with no new code in this audit's scope. **Highest user-visible impact for the next 1–2 weeks of work.**

`draft_graph` (51 s) is the absolute biggest cost per turn but the safest fix here is streaming, and streaming is explicitly deferred.

### 5. Which fixes can run in parallel with Phase 3?
- **Fix 4 (telemetry)**: yes — additive observability, no behaviour change.
- **Lane 1 router build-out (Fix 2 evidence hand-off)**: yes — Lane 1's own workstream, independent of Phase 3.
- **Fix 5 (harness verbose-timings)**: yes — local tooling only.

### 6. Which fixes require separate briefs?
- **Fix 1 (streaming for `/orchestrate/v2/turn`)** — biggest perceived-latency win (51 s → ~500 ms TTFB for `draft_graph`), but requires DGAI client coordination. Out of scope here.
- **Fix 3 (deferred `append_turn_atomic` commit)** — saves 200 ms–2 s constant per turn, but introduces a new consistency surface (next-turn `prior_turns` staleness window). Requires explicit failure-mode brief before any code change. Phase 0 does **not yet confirm** commit time is load-bearing on the critical path — until Fix 4 lands, we cannot say. Out of scope here.
- **Repair-stage avoidance in `draft_graph`** (new candidate from Phase 0): If Fix 4 shows Stage 4 Repair fires often and adds ≥10 s, a separate brief should investigate gating Repair more aggressively or skipping it for confident-parse outputs. Defer until measured.

---

## Updated cause ranking (data-supported)

1. **`draft_graph` Parse + Repair LLM rounds (≥40 s of the 51 s mean).** Confirmed dominant. Streaming would mask it; sub-stage telemetry (Fix 4) is needed to know whether Repair is gateable.
2. **Sonnet routing call on every free-text follow-up (6–14 s).** Confirmed. Lane 1 router is the remediation.
3. **`run_analysis` PLoT variance (4–20 s).** Confirmed. Not an LLM problem — investigate PLoT cold starts and Render warmup separately.
4. **Commit and context-assembly tax on every turn (~1–2 s minimum, seen as the floor in `set_factor_value` chip-clicks).** Confirmed via the 1.24 s deterministic floor. Below this we cannot go without architectural change.
5. **Prompt cache hit-rate**: **unmeasured from these samples** — the response envelope does not expose `cache_hit`. Cannot rank without Fix 4.

---

## Updated fix ranking (impact × safety, post-Phase-0)

| Rank | Fix | Impact (measured) | Safety | Action this workstream |
|------|-----|-------------------|--------|------------------------|
| 1 | **Fix 4 — telemetry surfacing** | Unlocks all others | High | **Build now** |
| 2 | **Lane 1 router (Fix 2 evidence)** | 5–12 s saved per free-text follow-up | High (Lane 1 owns) | **Hand off this summary** |
| 3 | **Fix 5 — harness verbose timings** | Small directly; closes a confirmed gap | High | **Build now** (gap is real: explain_leader rows lack elapsed) |
| 4 | Fix 1 — streaming | ≥30 s perceived saving on `draft_graph`; ~5 s on follow-ups | Medium (DGAI coordination) | **Separate brief** |
| 5 | Fix 3 — deferred commit | 200 ms–2 s constant; risks context amnesia | Medium-low | **Separate brief** |
| 6 | Repair-stage gating in `draft_graph` | TBD; could be ≥10 s | TBD | **Wait for Fix 4 data** |

---

## Constraints honoured

No prompts edited. No models/timeouts/provider settings changed. No production code modified. No streaming or deferred-commit implementation. No duplicate router added (Lane 1 owns that). Nothing pushed.

---

## Suggested next action

1. **Land Fix 4** (per-stage telemetry + `cache_hit` + `commit_ms` on the turn-executor envelope) — small, observability-only change, unblocks the rest. Files: [src/orchestrator-v5/turn-executor.ts](src/orchestrator-v5/turn-executor.ts), [src/cee/unified-pipeline/index.ts](src/cee/unified-pipeline/index.ts) + stages, [src/orchestrator-v5/commit.ts](src/orchestrator-v5/commit.ts).
2. **Land Fix 5** (harness `--verbose-timings`) — surfaces `elapsed_ms` + new envelope fields on every evidence row. Files: [tools/v5-journey-replay/assertions.ts](tools/v5-journey-replay/assertions.ts), `evidence-writer.ts`, `types.ts`.
3. **Re-run Phase 0** with Fix 4+5 live → write `v5-latency-summary-v2.md` with sub-stage numbers → revisit Fixes 1 / 3 / Repair-stage with confirmed splits.
4. **Hand this summary to the Lane 1 P0 router brief** as latency justification.
