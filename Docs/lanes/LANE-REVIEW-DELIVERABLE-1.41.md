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
fixes, one commit each, make it safe to flip.

**Correction (fix round, C5)**: an earlier version of this doc/PR body
overclaimed "Three RED-first fixes." Precisely: **FIX 1 and FIX 2 are
RED-first-proven** — each pins a failing test against the pre-fix code before
the fix lands (timeout-storm reproduction; unbounded-prompt reproduction).
**FIX 3 is additive / verified-by-inspection, NOT RED-first** — the
investigation found the block-composition/attach path was *already correct
and already flag-gated*; there was no bug to reproduce, so no RED state ever
existed. FIX 3's commit adds a confirmatory test (proving the already-true
behaviour against the real wire `BlockSchema`) plus a strengthened config
comment — genuinely useful, but "verified existing correctness," not
"test-first fix." See the **Fix round (2026-07-08, post-review)** section
below for the same distinction applied to FIX A/B/C.

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

**Dark-ship framing (corrected, fix round) — THREE flags, not two.**
`buildDecisionReviewUserMessage` (FIX 2's caps) is also called by the
pre-existing HTTP route `src/routes/assist.v1.decision-review.ts`, gated by
its own flag `CEE_DECISION_REVIEW_ENABLED` (default **false**, see
`src/config/index.ts`). So this lane's changes ship dark behind
`CEE_SEND_BRIEF_TO_PLOT` (FIX 1's timeout path) +
`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` (FIX 3's attach path); the prompt
caps (FIX 2/A) additionally activate wherever `CEE_DECISION_REVIEW_ENABLED`
is on — that is intended, the caps ARE the fix for that route too. All three
flags default `false` today; none is flipped by this PR.

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

**Schema skew note (corrected, fix round)**: an earlier version of this doc
claimed the UI pins `@talchain/schemas@0.8.1`. **This is false**, verified
directly against `DecisionGuideAI` `origin/staging`: UI `package.json` pins
`file:./vendor/talchain-schemas-0.13.1.tgz` (tarball + sha256 committed;
re-vendored in commit `8172a027`, merged via UI PR #232 on 2026-07-06 — that
commit's "(draft, do-not-merge)" message is a fossil, the merge is real and
live). The real skew is **CEE `0.14.0` vs UI `0.13.1`**, and the vendored
`0.13.1` already contains all four block kinds
(`review_card`/`coaching`/`evidence`/`exercise`). `tests/contract/cee-egress-wire-surface-pin.test.ts`
still documents/pins the UI-relevant wire surface. Given 0.13.1 should accept
these blocks natively, this is not a pin-coordination project — see the
corrected activation gate #2 below.

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

**Correction (fix round, C4)**: the adversarial review claimed the UI
"renders only the top-1 `review_card` and deliberately does NOT render
coaching or evidence blocks," and listed a UI renderer build as a follow-up.
**This is FALSE, verified against `DecisionGuideAI` `origin/staging`**:
`src/canvas/conversation/InlineBlocks.tsx` renders ALL FOUR block types —
`case 'v5_review_card'` → `V5ReviewCardBlock`, `'v5_coaching'` →
`V5CoachingBlock`, `'v5_evidence'` → `V5EvidenceBlock`, `'v5_exercise'` →
`V5ExerciseBlock` (lines ~306-318) — and
`src/v5/blocks/mapV5Blocks.ts` maps `review_card`/`coaching`/`evidence` with
**no top-1 cap**. The renderers are already merged and wired on staging;
**zero UI build is needed to activate this lane's content**. The genuine
activation gates are:

1. **The CEE emission flag flip** — `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`
   (default `false`, unchanged by this PR) must be flipped `true` for
   `enrichRunAnalysisWithDecisionReview` to actually run and populate
   `enrichment.decision_review`, which is what makes `compose.ts`'s Phase 3
   block rebuild (FIX 3) emit `review_card`/`coaching`/`evidence` blocks at
   all.
2. **One-emission live check of the schema seam at flip time** (corrected,
   fix round — this is NOT a pin-coordination project). The real skew is CEE
   `0.14.0` vs UI `0.13.1` (not `0.8.1` — see the Schema skew note in FIX 3
   above), and the vendored UI `0.13.1` already contains all four block
   kinds natively. The tolerated-block sidecar
   (`tests/contract/cee-egress-wire-surface-pin.test.ts`) is belt-and-braces,
   not a required bridge. What remains is a live check: emit one real
   `review_card`/`coaching`/`evidence` payload through the actual wire at
   flip time and confirm the UI renders it as expected, rather than a schema
   pin-bump project.
3. **The orphaned `m1_review` PLoT-callback field** — the
   `CEE_SEND_BRIEF_TO_PLOT` → PLoT `m1_review` mechanism is confirmed
   orphaned (PLoT computes it, CEE never reads it back). Compute-but-never-
   consumed: either wire it up properly or remove the dead computation on
   the PLoT side to stop paying for it.

Additional, non-blocking follow-up:

4. FIX 1's `PLOT_RUN_BRIEF_TIMEOUT_MS` (75s) is sized off ONE observed trial
   (~40.5s). Re-verify against a live trial once FIX 2's prompt cap is also
   live on PLoT's side of the callback (this lane cannot change PLoT).

## Fix round (2026-07-08, post-review)

The adversarial review of the original 3-commit PR returned CONCERNS C1-C5.
Four were valid and closed below; C4 was wrong and is corrected above
(Follow-ups section) rather than "fixed" in code. Distinguishing RED-first
from additive, per the C5 correction at the top of this doc:

- **FIX A (C1) — RED-first.** `FLIP_THRESHOLD_DATA` and `BRIEF` in
  `buildDecisionReviewUserMessage` were still raw uncapped `JSON.stringify`/
  verbatim text after FIX 2 — the "hard ceiling" claim was incomplete. 6 new
  test cases in `invoke.prompt-cap.test.ts` were written and confirmed
  failing (`DECISION_REVIEW_MAX_FLIP_THRESHOLD_ENTRIES` /
  `DECISION_REVIEW_MAX_BRIEF_CHARS` did not exist; sections were unbounded)
  before `boundedTextBlock` + flip-distance ranking were implemented.
- **FIX B (C2) — RED-first.** The brief-bearing retry-skip guard
  (`skipRetryOnTimeout`, now `skipRetryEntirely`) only checked
  `firstError instanceof PLoTTimeoutError` — a 5xx or network error mid-chain
  would still retry and double-fire the expensive LLM chain. 2 new cases
  (brief-bearing 5xx, brief-bearing network error) were written and confirmed
  failing (2 fetch calls instead of 1) before the guard was broadened to
  apply to any already-confirmed-retryable error class.
- **FIX C (C3) — RED-first.** `MAX_MODEL_CRITIQUES`'s doc comment claimed
  "tracked in `_meta` for observability," but `model_critiques_dropped_count`
  / `model_critiques_capped_count` were computed and then dropped when
  building `DecisionReviewMeta`. New assertions on `_meta.model_critiques_*`
  were written and confirmed failing (`undefined`) before the two fields
  were wired into `DecisionReviewMeta` and its assembly. Also fixed a doc
  typo: "(type, factor_label, message)" → "(type, severity, message)"
  (factor_label is an `evidence_gaps` field, not a `model_critiques` field).
  **Scope correction (fix round)**: "observability" here means adapter-internal
  and test-inspectable only — `model_critiques_dropped_count` /
  `model_critiques_capped_count` land in `DecisionReviewMeta` (`_meta`), NOT
  in telemetry or logs. This mirrors the pre-existing
  `evidence_gaps_dropped_count`, which has the same scope (also `_meta`-only,
  never emitted to telemetry/logs). Separately: `FLIP_THRESHOLD_DATA`
  truncation (FIX A) ranks kept entries by ascending distance-to-flip
  (`capArray`'s `rank` sort in `invoke.ts`) whenever the array is over the
  cap — this re-orders the kept entries relative to their original input
  order (the dropped *count* is disclosed via the `[TRUNCATED: ...]` marker,
  but the reordering itself is not separately flagged). Cosmetic for an
  LLM-only prompt, but worth stating plainly.
- **FIX D (C5) — additive/docs-only, not RED-first (a doc claim isn't code
  under test).** Corrected this doc's and the PR body's overclaim of "Three
  RED-first fixes" — see the correction note at the top of this doc.
- **FIX E (C4) — additive/docs-only correction, NOT a code fix.** The
  review's claimed UI renderer gap was verified false against
  `DecisionGuideAI` `origin/staging` (see the Follow-ups section above for
  the evidence and the corrected genuine activation-gate list). No code
  change was needed or made in response to C4 — the fix is entirely to this
  doc's (and the PR body's) prose.

Gates run for FIX A/B/C: `pnpm typecheck:src` clean after every commit;
`bash scripts/ci/typecheck-ratchet.sh` — 462/462 (baseline unchanged) after
every commit; targeted `vitest run` on every touched/adjacent test file —
all green (15/15, 41/41, 60/60 respectively — see each commit message for
the exact count); pre-push hook green on every push.

## Doc-only fix round (2026-07-08, verify-caught)

Three further corrections, doc-and-PR-body-only (no code changed; the
adversarial dormancy proof stays valid):

1. **Schema-pin claim was false.** This doc and the PR body previously
   claimed the UI pins `@talchain/schemas@0.8.1`. Verified false against
   `DecisionGuideAI` `origin/staging`: the UI pins
   `file:./vendor/talchain-schemas-0.13.1.tgz` (re-vendored via UI PR #232,
   merged 2026-07-06). Real skew is CEE `0.14.0` vs UI `0.13.1`; `0.13.1`
   already contains all four block kinds. Activation gate #2 (Follow-ups)
   is rewritten from a pin-coordination project to a one-emission live
   check of the schema seam at flip time. See the Schema skew note under
   FIX 3 and the corrected Follow-ups gate #2.
2. **Dark-ship framing named only two flags.** `buildDecisionReviewUserMessage`
   is also shared by the pre-existing `/assist/v1/decision-review` HTTP
   route, gated by its own `CEE_DECISION_REVIEW_ENABLED` (default false).
   The lane ships dark behind three flags — `CEE_SEND_BRIEF_TO_PLOT` +
   `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`, with the prompt caps
   additionally activating wherever `CEE_DECISION_REVIEW_ENABLED` is on
   (intended — the caps are the fix for that route too). See the Dark-ship
   framing note under FIX 3.
3. **`_meta` observability claim scoped.** `model_critiques_dropped_count` /
   `model_critiques_capped_count` land in `DecisionReviewMeta` (`_meta`)
   only — not telemetry/logs — the same scope as the pre-existing
   `evidence_gaps_dropped_count`. Also documented: `FLIP_THRESHOLD_DATA`
   truncation ranks kept entries by ascending distance-to-flip, re-ordering
   them relative to the original input order (disclosed count, undisclosed
   order — cosmetic for an LLM prompt). See the Scope correction under
   FIX C.
