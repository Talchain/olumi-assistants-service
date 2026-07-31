/**
 * ROADMAP 2.211 — "which lens did the previous analysis turn select?", DERIVED.
 *
 * ── WHY THERE IS NO STORED ANSWER, AND WHY THAT IS THE POINT ─────────────────
 * Nothing in CEE persists an emitted lens, and nothing here adds one. The
 * emitted `blocks[]` of a turn are never written to the store (`SessionTurnWrite`
 * has no `blocks` field; only `assistant_text` prose is kept, and the lens ships
 * as a block, not as prose), so there is no record to read. The alternative —
 * stamping a `lens_id` into the run_analysis fact's enrichment, the way
 * `coaching_signal_id` is stamped — WOULD be new persisted state, and it would
 * be a second authority that can drift from `selectLens`: the hand-maintained
 * mirror class (CLAUDE.md trap 12).
 *
 * So the answer is RE-DERIVED instead. `selectLens` is a pure, total function of
 * `fact.result.enrichment` plus the caller's executor injection; the prior
 * `run_analysis` facts are already loaded for the turn (`prior_facts`, no new DB
 * read) and carry that enrichment verbatim. Replaying the selector over them
 * reproduces the earlier selections by construction — one derivation, applied
 * twice, rather than a value and a copy of it.
 *
 * ── WHY IT IS A REPLAY AND NOT A SINGLE LOOK-BACK ────────────────────────────
 * The rule being fed is itself history-dependent, so "the lens the previous turn
 * SELECTED" is not "the head lens of the previous turn's fact". Worked example
 * on three consecutive both-trigger turns:
 *
 *   turn 1: head = flip-risk, no history      → flip-risk
 *   turn 2: head = flip-risk, prev = flip-risk → DISPLACED to pre-mortem
 *   turn 3: head = flip-risk, prev = pre-mortem → flip-risk
 *
 * A naive one-step look-back would compute turn 2's *head* (flip-risk) as turn
 * 3's history and displace again — emitting pre-mortem twice in a row, which is
 * precisely what the amendment exists to prevent. The replay carries the rule
 * forward through the window so the alternation is real.
 *
 * ── ⭐ THE FACT SET MUST BE THE EMISSION'S FACT SET (ROADMAP 2.211 amendment A2)
 * The replay answers "which lens did the previous analysis turn emit?". It is
 * therefore only as correct as the agreement between the facts IT walks and the
 * facts that can actually EMIT a lens. Wherever the two sets differ, a lens that
 * really shipped is invisible to the next turn's history and repeats.
 *
 * The emission side applies exactly TWO conditions (`compose.ts`, current-turn
 * branch): the fact is a non-noop `run_analysis`, and its `graph_hash_at_run` is
 * a non-empty string. **There is NO status gate** — `selectLens` never reads
 * `analysis_status`, and neither does the compose branch that ships the block.
 *
 * So this walks the ENTITLEMENT ordering
 * (`orderClaimBearingRunAnalysisFactsNewestFirst`), NOT the freshness one. The
 * distinction is `freshness.ts`'s own: FRESHNESS asks "is this analysis good
 * enough to build a result view from?", ENTITLEMENT asks "did this analysis make
 * a claim?". A lens IS a claim this system made, whatever the analysis status —
 * so the entitlement question is the right one, and using the freshness filter
 * here was a real divergence, not a conservative choice.
 *
 * It is REACHABLE, not theoretical: the run_analysis handler accepts `partial`
 * unconditionally, and accepts an UNRECOGNISED status precisely WHEN a finite
 * `option_comparison[].win_probability` is present — the same bytes rule 2c
 * reads. On that arm, acceptance GUARANTEES a lens-bearing signal.
 *
 * The `graph_hash_at_run` condition is applied here too (the field is OPTIONAL
 * in the contract, so a fact can lack it). That one IS a second expression of a
 * condition compose owns, so its agreement is not asserted — it is MEASURED from
 * both sides in `__tests__/lens-history.test.ts` ("both sides measured"): one
 * test drives the real compose path and proves no lens block is emitted, another
 * proves this replay excludes the same fact. If compose's gate ever moves, that
 * pair goes RED rather than drifting silently.
 *
 * ── HONEST SCOPE (two limits) ────────────────────────────────────────────────
 *  1. **SELECTED, not "provably seen".** This returns the lens the previous
 *     analysis fact SELECTS. Whether that lens's block actually reached the wire
 *     additionally depends on the prose/schema gate and the withheld-verdict arm
 *     (`compose.ts`'s permitted branch). Re-testing those conditions here would
 *     be a second copy of the wire gate, so it is deliberately not done. This
 *     imprecision runs in ONE direction only: it can cause one extra turn of
 *     lens DIVERSITY, never a suppressed or invented lens.
 *
 *  2. ⚠ **WINDOW-BOUNDED — AND THE COST IS NOT BOUNDED BY ONE.** `prior_facts`
 *     is read through a bounded window (`SESSION_READ_WINDOW_DEFAULT = 20`
 *     turns, overridable by `SESSION_READ_WINDOW_TURNS` — `session/index.ts:40`,
 *     `:93-96`; absent from both render YAMLs, so the DEPLOYED value is not
 *     derivable from this repo — CLAUDE.md trap 18). Once a scenario has more
 *     analysis facts than the window holds, the replay always starts cold the
 *     same number of steps back, so its answer stops depending on the turn
 *     number and **the emitted lens becomes a CONSTANT — consecutive repeats
 *     are unbounded.** Which constant depends on the PARITY of the in-window
 *     analysis-fact count (odd → the cold replay ends on the head lens, so the
 *     head is displaced every turn; even → the head wins every turn).
 *
 *     An earlier revision of this comment said the window was "worth at most one
 *     repeated lens, never a wrong one". The second half is true and load-bearing
 *     (see below); **the first half was false** and is corrected here — measured,
 *     not argued, in `__tests__/lens-history.test.ts` §5, which pins the exact
 *     sequences (a window of 2 over 10 turns yields `FPFFFFFFFF`). "At most one"
 *     IS true of the OTHER fail-safe mode — an absent history, where the
 *     selection is byte-identical to pre-amendment — which is where the sentence
 *     came from and where it should have stayed.
 *
 *     WHY IT IS NOT ESCALATED HERE: the degradation only costs DIVERSITY. Every
 *     emitted lens is still a genuinely triggered, executor-available lens from
 *     the LOCKED priority order, and `may-recommend-nothing` is unreachable from
 *     this input — both pinned. The durable fix is to stop deriving history from
 *     a windowed read, which means either a scenario-scoped analysis-fact read
 *     or a persisted emitted-lens record; both are larger decisions than this
 *     amendment and neither is improvised here.
 *
 * ── Same-selector family ─────────────────────────────────────────────────────
 * The ordering comes from `orderClaimBearingRunAnalysisFactsNewestFirst`, of
 * which `selectClaimBearingRunAnalysisFact` is the head — so the sort is shared,
 * never copied (`freshness.ts`'s "ONE ORDERING CORE").
 */

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { orderClaimBearingRunAnalysisFactsNewestFirst } from '../context/freshness.js';

import { selectLens, type LensId, type LensSelectorOptions } from './lens-selector.js';

/**
 * The lens the IMMEDIATELY-PRECEDING analysis turn of this scenario selected, or
 * `null` when there is no preceding analysis in the window (or it recommended
 * nothing).
 *
 * `priorFacts` MUST be the turn's PRIOR fact array (`EnrichedTurnContext.
 * prior_facts`) — the facts committed by earlier turns. It must NOT be the
 * unified `[...currentTurnFacts, ...prior_facts]` array that the Phase-3
 * `lifecycle` context carries: that one begins with THIS turn's own
 * run_analysis fact, so the replay would end on the current analysis and report
 * every turn as a repeat of itself. The two arrays are one call site apart and
 * look identical at the type level, which is exactly why this is stated here.
 *
 * `baseOptions` is the caller's executor-availability injection — the SAME
 * object the live selection uses, so a lens that cannot be run today is excluded
 * from the history for the same reason it is excluded from the choice. Any
 * `previousAnalysisLens` on it is ignored: the replay supplies its own.
 */
export function derivePreviousAnalysisLens(
  priorFacts: readonly HandlerFact[],
  baseOptions?: LensSelectorOptions,
): LensId | null {
  // ENTITLEMENT ordering, not freshness — see the fact-set note above. Then the
  // ONE remaining emission precondition: a fact with no `graph_hash_at_run`
  // never reaches the Phase-3 rebuild, so it can never have emitted a lens and
  // must not appear in the history either (agreement measured from both sides
  // in the tests, not asserted here).
  const newestFirst = orderClaimBearingRunAnalysisFactsNewestFirst(priorFacts).filter(
    (view) => view.graph_hash_at_run !== null,
  );
  if (newestFirst.length === 0) return null;

  // Replay oldest → newest so each step sees the selection the step before it
  // would have made. `previousAnalysisLens` is threaded, never accumulated: a
  // turn that recommended NOTHING resets the history to `null`, because "no lens
  // last turn" is not "the lens from two turns ago".
  let previous: LensId | null = null;
  for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
    const fact = newestFirst[i]!.fact;
    if (fact.fact_type !== 'run_analysis') continue;
    const selection = selectLens(fact as RunAnalysisHandlerFact, {
      ...baseOptions,
      previousAnalysisLens: previous,
    });
    previous = selection?.lens ?? null;
  }
  return previous;
}
