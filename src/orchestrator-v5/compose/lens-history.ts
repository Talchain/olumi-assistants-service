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
 * ── HONEST SCOPE (three limits, all fail-safe) ───────────────────────────────
 *  1. **SELECTED, not "provably seen".** This returns the lens the previous
 *     analysis fact SELECTS. Whether that lens's block actually reached the wire
 *     additionally depends on the prose/schema gate and the withheld-verdict arm
 *     (`compose.ts`'s permitted branch). Re-testing those conditions here would
 *     be a second copy of the wire gate — the mirror we are avoiding — so it is
 *     deliberately not done. The imprecision runs in ONE direction only: it can
 *     cause one extra turn of lens DIVERSITY, never a suppressed or invented
 *     lens.
 *  2. **Window-bounded.** `prior_facts` is a bounded recent-turn window. An
 *     analysis older than the window is invisible, so the replay starts cold at
 *     the window edge — worth at most one repeated lens, never a wrong one. The
 *     scenario-scoped `newest_analysis_fact` channel is contractually reserved
 *     to the claim-safety verdict reader and is deliberately NOT used here.
 *  3. **Same-selector family.** The ordering comes from
 *     `orderSuccessfulRunAnalysisFactsNewestFirst`, of which
 *     `selectRunAnalysisFact` is the head — so "the newest fact in this replay"
 *     and "the fact every other compose consumer calls the prior analysis" are
 *     the same fact by construction, not by agreement between two sorts.
 */

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { orderSuccessfulRunAnalysisFactsNewestFirst } from '../context/freshness.js';

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
  const newestFirst = orderSuccessfulRunAnalysisFactsNewestFirst(priorFacts);
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
