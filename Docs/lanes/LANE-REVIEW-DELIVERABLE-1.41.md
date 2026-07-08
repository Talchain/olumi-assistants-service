# Lane: CEE coaching-review deliverability (ROADMAP 1.41)

Branch: `claude-cee/review-deliverable` (worktree `.worktrees/cee-review-deliverable`,
base `origin/staging` @ `665c7d38d`).

Mission: the north-star coaching content the decision_review layer generates is
currently DISCARDED. Live evidence (flag-activation trial,
`acceptance-evidence/flag-activation/`) proved the content is real and good
(bias_findings, 5 key_assumptions, pre_mortem, flip_thresholds narrative;
UNGROUNDED_NUMBER guard fired + auto-corrected correctly) but flipping the
enabling flags today is actively harmful: a spurious CEE↔PLoT timeout+retry
storm (2x LLM calls, ~68s turn) and a structurally uncapped prompt. Three
RED-first fixes, one commit each, make it safe to flip.

## FIX 1 — timeout budget (`db2a566ae`)

**Problem**: with `CEE_SEND_BRIEF_TO_PLOT=true`, PLoT's `/v2/run` handler
synchronously calls back into CEE (`/assist/v1/review` + LLM-backed
`/assist/v1/decision-review`) — ~40.5s wall time for a modest decision. CEE's
`PLOT_RUN_TIMEOUT_MS` (30s) aborts mid-flight; the retry re-fires the entire
expensive callback chain a second time.

**Fix**: `src/config/timeouts.ts` — new `PLOT_RUN_BRIEF_TIMEOUT_MS` (default
75s). `src/orchestrator/plot-client.ts` — `run()` detects a non-empty `brief`
field and uses the extended timeout; a brief-bearing timeout additionally
**skips retry entirely** (`skipRetryOnTimeout`) — retrying a call that likely
already ran (most of) the expensive chain would double LLM spend regardless of
timeout budget. Non-brief runs are byte-identical to before (same 30s budget,
same retry-on-timeout behaviour).

**Investigated and rejected**: making the callback non-blocking (PLoT returns
early, review arrives async) would require redesigning PLoT's `/v2/run`
handler sequencing (`plot-lite-service/src/cee/decision-review-orchestrator.ts`
runs the CEE call synchronously, in-line, before PLoT's own HTTP response) —
out of scope ("without redesigning PLoT"). Raising the CEE-side budget is the
safe, minimal fix.

**Tests**: `tests/unit/orchestrator/plot-client-retry.test.ts` — 3 new cases:
extended window covers a 45s callback (no retry needed); a timeout past even
the extended window does NOT retry (retry-storm structurally impossible, pinned
via `fetchSpy` call count); non-brief runs retry as before (unchanged).

## FIX 2 — prompt cap (`0da762104`, lint fixup `228988868`)

**Problem**: `buildDecisionReviewUserMessage`'s `<GRAPH>`, `<ISL_RESULTS>`,
`<DETERMINISTIC_COACHING>` blocks were raw `JSON.stringify`, zero capping.
Already ~9.9k input tokens for a MODEST decision (flag-activation trial);
nothing prevents linear (or worse) growth with graph/option/factor count.
`model_critiques` had zero allowlist — `filterObjectEntries` forwarded any
object-shaped upstream entry verbatim.

**Fix**:
- `src/cee/decision-review/invoke.ts` — array-length caps on
  `graph.nodes`/`edges` and `isl_results.factor_sensitivity`/`fragile_edges`/
  `option_comparison`. Under the cap: no-op (byte-identical). Over the cap:
  rank by decision-relevance (highest `|elasticity|`, highest
  `switch_probability`, highest `win_probability` respectively) before
  truncating — kept entries are the most useful, dropped tail is disclosed
  via a `[TRUNCATED: ...]` marker, never silent. A hard 8000-char per-section
  byte ceiling backstops pathological single-entry bloat.
- `src/orchestrator-v5/coaching/decision-review-enricher.ts` — `model_critiques`
  gets a real allowlist (`type`/`severity`/`message` required,
  `suggested_action`/`affected_node_ids` optional — matching the prompt's
  documented shape at `src/prompts/defaults.ts:1241`) plus a count cap
  (`MAX_MODEL_CRITIQUES = 10`), mirroring the existing `evidence_gaps`
  4-field allowlist pattern.

**Tests**: `src/cee/decision-review/__tests__/invoke.prompt-cap.test.ts` (new,
9 cases) — oversized fixtures (500 entries) stay bounded (<30k chars, vs.
tens of thousands unbounded); truncation always disclosed; truncation keeps
the highest-relevance entries and drops the lowest; typical/small payloads are
byte-identical (no reordering, no marker). Updated
`decision-review-enricher.adapter-v1.test.ts` fixture #9 (previously used a
`code` field the prompt never reads — not the documented shape) plus 2 new
cases locking the allowlist + count-cap behaviour.

## FIX 3 — consume + attach, flag-gated (`723758afe`)

**Finding**: the block-composition path already exists and is already
flag-gated. `compose.ts`'s Phase 3 block rebuild
(`buildReviewCardBlocks`/`buildCoachingBlocks`/`buildEvidenceBlocks`) runs
**unconditionally** whenever `enrichment.decision_review` is present on a
run_analysis fact — no separate attach flag needed. `enrichment.decision_review`
is only populated when `config.cee.runAnalysisAwaitDecisionReview`
(`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`, default **false**) gates
`enrichRunAnalysisWithDecisionReview` (turn-executor.ts / chip-click-dispatch.ts)
to actually run — this IS the attach gate the task asked for, already
registered in config, already tested end-to-end
(`chip-click-decision-review-attachment.integration.test.ts`).

This call path shares `buildDecisionReviewUserMessage` (bounded by FIX 2) but
does **not** go through PLoT's `/v2/run` client — it's a direct CEE→LLM call,
so FIX 1's timeout budget targets a *different* path. Confirmed by search:
PLoT's `m1_review` field (populated via the separate `CEE_SEND_BRIEF_TO_PLOT`
callback the flag-activation trial exercised) has **no CEE-side consumer
anywhere** — that mechanism is orphaned, independent of the V5 autofire path,
and out of scope here (attaching a genuinely dead field would be new
plumbing, not "the already-supported typed blocks").

**What this commit adds** (no redundant new flag — reused
`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` per the task's stated preference):
- Strengthened the config comment on `runAnalysisAwaitDecisionReview`
  documenting it as the attach gate and its relationship to FIX 1/2.
- `src/orchestrator-v5/__tests__/decision-review-wire-attach.fix3.test.ts`
  (new) — proves what was previously only assumed: every block emitted when
  `decision_review` is present validates against the actual wire `BlockSchema`
  (`@talchain/schemas/boundary` — the same package UI's `mapV5Blocks` reads);
  bias_findings/key_assumptions/pre_mortem/flip narrative each land in their
  documented block (`review_card:bias`, `coaching:assumption_check`,
  `review_card:pre_mortem`, `review_card:flip_threshold`); flag OFF
  (`decision_review` absent) is byte-identical to today — single
  `analysis_result` block, no `review_card`/`coaching`/`evidence` blocks, no
  other field changed.

**Schema skew note**: CEE pins `@talchain/schemas@0.14.0`; UI
(`DecisionGuideAI`) pins `0.8.1`. `tests/contract/cee-egress-wire-surface-pin.test.ts`
already documents/pins this skew for the UI-relevant wire surface — worth a
coordinated check before activating this flag in an environment where the UI
is on an older pin than assumed here.

## Gates run (this worktree)

- `pnpm typecheck:src` — clean after every commit.
- `bash scripts/ci/typecheck-ratchet.sh` — 462/462 (baseline unchanged) after
  every commit.
- Targeted `pnpm exec vitest run` on every touched/adjacent test file — all
  green, no regressions (full counts in each commit message).
- Pre-push hook (`scripts/validate-prepush.sh` equivalent, 17 checks incl.
  `lint-changed`, `forbidden-boundary-patterns`, `response-finaliser-contract`)
  — all green on every push.

## Follow-ups (not done here)

1. The `CEE_SEND_BRIEF_TO_PLOT` → PLoT `m1_review` mechanism is confirmed
   orphaned (PLoT computes it, CEE never reads it back). Either wire it up
   properly or remove the dead computation on the PLoT side to stop paying
   for it.
2. Before flipping `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true` on staging:
   coordinate the UI's `@talchain/schemas` pin bump if the review/coaching
   blocks it needs aren't in its current `0.8.1` pin's UI-relevant surface
   (see the egress wire-surface pin test).
3. FIX 1's `PLOT_RUN_BRIEF_TIMEOUT_MS` (75s) is sized off ONE observed trial
   (~40.5s). Re-verify against a live trial once FIX 2's prompt cap is also
   live on PLoT's side of the callback (this lane cannot change PLoT).
