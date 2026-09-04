/**
 * AN ANALYSIS NOBODY ASKED FOR MAY NOT ASSERT A QUANTIFIED RESULT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED HARM (fresh guest, deployed staging, 2026-09-03)
 *
 * `screens/final-analysis-new-panel.json` in `Talchain/olumi-programme-docs`
 * captures the FIRST screen a prospect sees after pasting a brief, with no
 * click of any kind. Verbatim, from that capture:
 *
 *     Leading option
 *     Continue With Founder-Led Sales
 *     Ahead in 100% of simulated futures
 *     Stable
 *     this result held up under the changes we tested
 *     …
 *     What we checked · Has leading option · Robust
 *
 * and on the canvas beside it, `Ahead 100%`, `Ahead < 1%`, a `Leading option`
 * badge and the rank badges `1` / `2` / `3`.
 *
 * The model those sentences describe was drafted seconds earlier by an LLM,
 * has had no user input at all, and — in the same journey — the product then
 * refused the analysis the user actually requested. That is the whole trust
 * proposition inverted, and it is the single most urgent item in the
 * programme (`DIAGNOSIS-LOCKED-2026-09-03.md`, root cause 1: *model semantic
 * integrity is not a prerequisite for quantified analysis*).
 *
 * ⚠ SCOPE OF THAT EVIDENCE, STATED PRECISELY: n=1 fresh guest. It establishes
 * that the state is REACHABLE on the first turn, not how often it occurs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE DOES **NOT** DO — READ BEFORE PROPOSING A BIGGER CHANGE
 *
 * It does NOT stop the auto-run. `handlers/auto-run-after-draft.ts` exists on
 * the founder's own ratified ruling and its deletion (#1298) was refuted the
 * same day: the first analysis is deliberate, and its purpose is to give the
 * user concrete material to disagree with. **The defect was never that it
 * runs. It is what it is permitted to SAY while it runs.** So this is
 * confinement, not suppression — the run still happens, the science still
 * ships, and only the CLAIMS are withheld.
 *
 * It does NOT invent a claim-permission layer. That is the durable authority
 * being designed elsewhere (`DIAGNOSIS-LOCKED` root cause 2 — computability,
 * credibility and recommendation authority are conflated). This module reads
 * the ONE signal that already exists — `isAutoInitiatedRunAnalysisFact`, the
 * single authority in `context/run-initiator.ts` — and adds no vocabulary of
 * its own. When the durable layer lands, this becomes one of its consumers.
 *
 * It does NOT touch the transport keep-list, the schemas package, or the UI.
 * Everything here is a projection of fields the wire already carries, so it
 * lands at the UI's deployed pin with no train and no deploy-order window.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ TWO QUESTIONS, NAMED APART — NOT ONE PREDICATE (parent CLAUDE.md trap 21)
 *
 * This estate's signature defect is two questions sharing one name, and the
 * temptation here was to widen `mayNameLeadingOptionForFact`. That would have
 * been the defect exactly:
 *
 *   `mayNameLeadingOptionForFact(fact)`   answers
 *       "does this run's PERSISTED CONSTRAINT VERDICT permit a leader claim?"
 *       — a fact about feasibility against the user's stated limits. Read from
 *       `result.constraint_verdict`. UNCHANGED by this module.
 *
 *   {@link wasAnalysisRequestedByUser}    answers
 *       "did anybody ASK for this analysis?"
 *       — a fact about provenance. Read from the run-initiator stamp.
 *
 * They are independent, and either one closing is sufficient reason to
 * withhold a leader claim. So `compose.ts` takes their CONJUNCTION at the
 * point of use, with both terms named on their own lines — a composition, not
 * an alignment. Neither predicate is redefined and neither default is moved.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE EXISTING WITHHELD PROJECTION IS NOT ENOUGH ON ITS OWN — MEASURED
 *
 * Routing an unrequested run through `mayNameLeadingOption = false` reuses all
 * of `compose/withheld-claim-projection.ts` (leader id nulled, `decision_review`
 * dropped whole, `decision_brief` headline/banded/caveat dropped, ordinal ranks
 * dropped and option order neutralised). That is most of the work and it is
 * already measured against live walks — so it is reused rather than rewritten.
 *
 * But it deliberately leaves TWO things standing, and both are on the witnessed
 * screen above:
 *
 *   1. **Per-option `win_probability`, and the block's `win_probabilities`
 *      record.** Kept on a withheld turn by an explicit anti-over-suppression
 *      ruling (2026-07-27) — on a turn where a RECOMMENDATION is withheld, a
 *      per-option probability is content the user is entitled to. That ruling
 *      is about a run the user asked for. It is not evidence about a run
 *      nobody asked for, and this module must not weaken it: the withheld
 *      projection is left exactly as it is and the drop happens HERE, gated on
 *      the other question.
 *
 *   2. **The robustness VERDICT.** `projectRobustnessForWithheldClaim` drops
 *      the leader DESIGNATIONS inside `robustness` and keeps the fragility
 *      science — so `display_verdict`, `display_verdict_reason`, `is_robust`,
 *      `level` and the `confidence` pair survive verbatim. Those are what
 *      render `Stable` · `this result held up under the changes we tested` ·
 *      `Robust`.
 *
 * ⭐ THAT IS WHY THIS IS A SECOND PROJECTION AND NOT A WIDENING OF THE FIRST.
 * Widening would have silently reversed a ratified ruling on the path it was
 * ruled for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ALLOW-LIST FOR `robustness`, DENY-LIST FOR THE OPTION ROWS — DELIBERATE
 *
 * The two kinds of blob have opposite default content, so the fail-closed
 * direction is opposite too:
 *
 *   `robustness` is a VERDICT blob. Everything in it is verdict-shaped by
 *   default and only three members are fragility SCIENCE. So it is projected
 *   by ALLOW-LIST: a verdict field added by a future producer is dropped for
 *   free, with no list for anyone to remember to update (parent CLAUDE.md
 *   trap 12 — a hand-maintained mirror drifts silently, and the drift always
 *   reads as green).
 *
 *   The OPTION-SCOPED rows (`option_comparison[]` and
 *   `decision_brief.options[]`) are MEASUREMENT blobs. Everything in them is
 *   outcome science by default and exactly one member is a claim. So they are
 *   projected by DENY-LIST plus a derived key-family backstop, and an
 *   allow-list there would silently delete every new outcome field the
 *   producer ships.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CLOSED AGAINST AN ENUMERATION, NOT AGAINST THE INSTANCES THAT CAME TO MIND
 *
 * The drop set was derived by walking the 2026-09-03 live capture for EVERY key
 * stating a comparative standing, not by listing the ones on the screenshot.
 * The walk found the same figure in two arrays, which is why
 * `decision_brief.options[]` is projected here at all — an author-authored list
 * would have named `option_comparison` and stopped, and the acceptance test
 * would have passed while the UI's documented fallback source still shipped the
 * number.
 *
 * ⭐⭐ AND THEN THE ENUMERATION ITSELF WAS SHORT BY A WHOLE CLASS. That first
 * walk was for COMPARATIVE STANDING only. Walking the EMITTED block again for
 * ROBUSTNESS VERDICT keys found the verdict living in two more places outside
 * `enrichment.robustness`: `decision_brief.robustness` (a bare `"fragile"`) and
 * `decision_brief.analysis_summary.robustness_band`. Neither has a UI reader
 * today — source-scanned, with a contrast control — so neither was on the
 * witnessed screen; both are dropped anyway, because a verdict token on the
 * wire is a claim waiting for a consumer.
 *
 * **"Closed against the enumeration" is only as strong as the enumeration's
 * CLASSES.** One walk per claim class, each with its own reader
 * ({@link keyStatesComparativeStanding}, {@link keyStatesRobustnessVerdict}),
 * each asserted in the acceptance suite before AND after. A third class arriving
 * later needs a third walk; it will not be caught by widening either of these.
 *
 * ⚠ TWO THINGS THE WALK FOUND AND THIS MODULE DELIBERATELY LEAVES:
 *
 *   `robustness.fragile_edges[].alternative_winner_id` / `_label` — the
 *   COUNTERFACTUAL winner if that edge flips. `keyDesignatesLeadingOption` is
 *   anchored at `^` specifically to spare these (see its docstring): they are
 *   the science a withheld disclosure invites the user to act on, not a
 *   recommendation. Suppressing them here would reverse that ruling by
 *   accident.
 *
 *   `conditional_winners[].{low,high}_bucket.win_probability` — kept by the
 *   2026-07-27 anti-over-suppression ruling once the bucket's option identity
 *   has been dropped (which the withheld projection does first). A bucket
 *   probability with no name attached measures a split; it ranks nobody.
 *
 * Both are stated rather than left to be found, so the next reader can
 * disagree with a decision instead of discovering an omission.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT SURVIVES, AND WHY THAT IS THE POINT
 *
 * `option_comparison[].outcome` and `.downside` (the distributions),
 * `factor_sensitivity` whole (which factors matter, influence, EVPPI, flip
 * risk), `p_win_sensitivity` whole (both are FACTOR-scoped, so their `*_rank`
 * and `p_win_delta` members rank factors and not options),
 * `robustness.fragile_edges` / `robust_edges` / `near_tie` (which relationships
 * are load-bearing), `flip_thresholds`. That is the concrete material the
 * founder's ruling asks this run to produce. What goes is only the verdict: who
 * wins, by how much, and whether to trust it.
 *
 * `critiques` passes through untouched too — but stated separately and
 * precisely, because the 2026-09-03 capture this module was derived against
 * carries NO `critiques` key, so nothing here is EVIDENCE about that blob. It
 * is named only so a reader knows it was considered and deliberately not
 * projected: the withheld projection already sanitises it and strips option
 * identity, and its remaining rows say "this option changes nothing yet",
 * which states no standing.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { isAutoInitiatedRunAnalysisFact } from '../context/run-initiator.js';
import { mayNameLeadingOptionForFact } from './withheld-claim-projection.js';

/**
 * Did a user ask for this analysis?
 *
 * TRUE for every user-initiated run and — deliberately — for every fact this
 * predicate cannot positively identify as server-initiated. The asymmetry is
 * inherited from {@link isAutoInitiatedRunAnalysisFact}, which is the ONE
 * authority on run initiation and already fails in the safe direction: an
 * unstamped or unrecognised fact reads as the user's, so an unknown marker
 * degrades to today's behaviour instead of silently blanking a result a user
 * really did request. Over-suppressing a requested analysis is weighted equally
 * with the leak this module closes.
 *
 * ⚠ NOT "has the user SEEN it" — that is `hasUserSeenRunAnalysisResult`, a
 * DELIVERY question whose answer changes as channels go live. This one is a
 * permanent fact about provenance and never changes for a given fact.
 */
export function wasAnalysisRequestedByUser(fact: HandlerFact): boolean {
  return !isAutoInitiatedRunAnalysisFact(fact);
}

/**
 * The `analysis_result` member of the wire block union — the exact type
 * `compose.ts`'s builder returns, narrowed from `OlumiResponse['blocks']` by
 * its `type` discriminant so this projection cannot be handed some other block
 * and cannot need a cast to give one back.
 */
type AnalysisResultBlock = Extract<OlumiResponse['blocks'][number], { type: 'analysis_result' }>;

/**
 * ⭐ THE ONE SHARED ADMISSION — may this fact's result present a leading option
 * to the USER?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND IT IS A DEFECT THIS CHANGE CREATED AND THEN CLOSED
 *
 * The first cut of this work took the conjunction inline in `compose.ts` and
 * nowhere else. MEASURED at pristine `origin/staging` (a per-file scan with
 * line comments stripped, so a prose mention is not counted as a call):
 * `mayNameLeadingOptionForFact` had FIVE production call sites across FOUR
 * consumer files — `compose.ts` twice, `compose/phase3-blocks.ts`,
 * `compose/ui-directive.ts` and `routes/scenario-graph-analysis-read.ts` —
 * plus two prose mentions in `turn-executor.ts` and
 * `tools/handlers/run-analysis.ts`. The inline conjunction changed ONE of the
 * five. ⚠ An earlier draft of this paragraph said "seven readers", conflating
 * call sites with mentions; the figure above is the counted one.
 *
 * The site that mattered is on the auto-run's OWN DELIVERY PATH:
 * `routes/scenario-graph-analysis-read.ts` re-derives it and feeds
 * `composeAnalysisStateV1`, whose `leader_claim.permitted` is the UI's
 * ENTITLEMENT GRANT. That route's own comment says, in terms:
 *
 *     "⚠ NOT hardcoded `false`. The entitlement is read from the SELECTED FACT
 *      by the canonical fail-closed reader — the same one
 *      `buildAnalysisResultBlock` uses internally — so the verdict's
 *      `leader_claim` and the block's projections answer the SAME question
 *      about the SAME fact. Two answers here would be trap 21 at a new surface."
 *
 * An inline conjunction would have made that sentence FALSE — the block saying
 * "no leader" while the state beside it granted the UI permission to name one,
 * on exactly the turn this change exists to contain. Aligning the two by
 * copying the conjunction to each site is the mirror this estate keeps paying
 * for; the remedy is ONE shared admission every consumer reads.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO INPUTS, STILL NAMED APART — that is what makes this a composition
 *
 *   `mayNameLeadingOptionForFact` — "does the persisted CONSTRAINT VERDICT
 *       permit a leader claim?" Unchanged, still the sole reader of
 *       `result.constraint_verdict`, still exported and still callable on its
 *       own by anything that genuinely wants only that question answered.
 *   {@link wasAnalysisRequestedByUser} — "did anybody ASK for this analysis?"
 *
 * The two questions keep their own names and their own defaults. What is shared
 * is the ANSWER to the third question the surfaces actually ask, which is
 * neither of them: *may the user be shown a leader?*
 *
 * ⚠ THE TELEMETRY READERS TAKE THIS TOO, DELIBERATELY. `compose.ts`'s
 * lens-companion emit and `phase3-blocks.ts`'s fragile-edge-offer emit both
 * gate on this predicate so their counts match the branch that actually ships
 * blocks. Leaving them on the narrower reader would over-count offers on
 * exactly the turns where they are suppressed — which is the defect their own
 * docstrings say they exist to avoid.
 */
export function mayPresentLeaderClaimForFact(fact: RunAnalysisHandlerFact): boolean {
  return mayNameLeadingOptionForFact(fact) && wasAnalysisRequestedByUser(fact);
}

/**
 * The `analysis_result` block summary for a run nobody asked for.
 *
 * Says the two things that are unambiguously true and are exactly what the
 * witnessed screen never said: a first pass ran on its own, and none of it is
 * confirmed. It names no option, states no probability and passes no verdict,
 * so it cannot itself become the claim this module removes.
 *
 * ⚠ NOT the same sentence as `AUTO_RUN_PROVISIONAL_DISCLOSURE` in
 * `handlers/chip-click-dispatch.ts`, and deliberately not imported from it.
 * That is the CONVERSATION opener — a second-person invitation that reads as
 * the assistant's voice. This is the RESULT BLOCK's own summary, which the
 * report mapper carries onto the results surface. Two surfaces, two registers;
 * sharing one string would put a chat sentence in a panel field. They must
 * stay CONSISTENT, which the acceptance test asserts by claim rather than by
 * byte equality.
 */
export const UNREQUESTED_ANALYSIS_SUMMARY =
  'Olumi ran a first pass on the model it had just drafted. Nothing in it is confirmed yet, ' +
  'so no option is put forward and no result is called reliable. Use it to find what is wrong.';

/**
 * The ONLY members of `enrichment.robustness` that survive on an unrequested
 * run: the fragility science, which measures the model rather than judging it.
 *
 * ALLOW-LIST, so a verdict member added later is dropped without anybody
 * updating a list. See the module header for why this blob takes the opposite
 * treatment to `option_comparison[]`.
 *
 * `near_tie` states THAT two options are close and by how much — a property of
 * the run, not a recommendation — and its own option identities have already
 * been dropped by `projectRobustnessForWithheldClaim`, which runs first.
 */
export const UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS: readonly string[] = Object.freeze([
  'fragile_edges',
  'robust_edges',
  'near_tie',
]);

/**
 * The member of an OPTION-SCOPED row that states the comparative claim,
 * dropped on an unrequested run.
 *
 * ⭐ TWO ARRAYS CARRY IT, AND ONLY ONE OF THEM IS OBVIOUS. Derived by walking
 * the 2026-09-03 live capture for every key that states a comparative standing
 * (`__tests__/fixtures/analysis-result-live-2026-09-03.json`):
 * `enrichment.option_comparison[].win_probability` AND
 * `enrichment.decision_brief.options[].win_probability` — the same number in
 * two places, and the UI reads BOTH (`briefWinProbability` is
 * `mapV5AnalysisToReport`'s documented fallback when `option_comparison` is
 * absent). Dropping only the first would have left the figure on the wire and
 * the acceptance test passing against the array the author happened to look at.
 *
 * ⚠ MEASURED, AND IT IS NOT WHAT BITES. Mutation M3a — deleting the member
 * below — leaves the acceptance suite 15/15 GREEN, because
 * {@link keyStatesComparativeStanding} already matches `win_probability`. So
 * do NOT describe this list as the guard: it is the readable statement of
 * intent, and the thing a reader greps for when asking "what does an
 * unrequested run stop saying?". The derived predicate is the enforcement.
 * Both ship because they answer different questions — a list is what notices a
 * member is WRONG, a derived family is what notices a member is MISSING
 * (parent CLAUDE.md trap 12d) — and the pair is kept honest by M3b, which
 * neuters the predicate and hard-fails the module at load.
 *
 * Exported so the acceptance test asserts against the REAL constant rather
 * than a copy of it.
 */
export const UNREQUESTED_OPTION_ROW_DROPPED_MEMBERS: readonly string[] = Object.freeze([
  'win_probability',
]);

/**
 * Key names that state a COMPARATIVE STANDING rather than measure an outcome.
 *
 * A derived backstop for {@link UNREQUESTED_OPTION_ROW_DROPPED_MEMBERS},
 * which is a hand-written list of one. A list is what notices a member is
 * wrong; a derived predicate is what notices a member is MISSING — the two are
 * not redundant and neither supersedes the other (parent CLAUDE.md trap 12d),
 * so both run.
 *
 * Anchored, never a bare substring: `win_probability` and `winner_id` match,
 * `downside` and `unwind_cost` do not.
 */
const COMPARATIVE_STANDING_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /(^|_)win(_|$)/i,
  /(^|_)wins(_|$)/i,
  /(^|_)winner(_|$)/i,
  /(^|_)ahead(_|$)/i,
  /(^|_)lead(s|ing)?(_|$)/i,
  /(^|_)rank(_|$)/i,
  /(^|_)win_probability(_|$)/i,
]);

/** Does this key state a comparative standing? See the pattern list above. */
export function keyStatesComparativeStanding(key: string): boolean {
  return COMPARATIVE_STANDING_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Key names that pass a ROBUSTNESS VERDICT — "should you trust this result?" —
 * as opposed to measuring the fragility that a verdict would be derived from.
 *
 * ⭐ THIS FAMILY EXISTS BECAUSE THE FIRST ENUMERATION MISSED A WHOLE CLASS.
 * The comparative-standing walk found the win probability in two arrays and I
 * stopped there. Walking the emitted block again for VERDICT keys found the
 * robustness verdict living in two more places outside `enrichment.robustness`:
 * `decision_brief.robustness` (a bare `"fragile"`) and
 * `decision_brief.analysis_summary.robustness_band`. Neither has a UI reader
 * today — scanned with a contrast control — so neither was on the witnessed
 * screen; both are dropped anyway, because a verdict token on the wire is a
 * claim waiting for a consumer, and the whole point of this module is that an
 * unrequested run does not pass verdicts.
 *
 * ⚠ ANCHORED, and the anchors are load-bearing. `robust_edges` and
 * `fragile_edges` MEASURE — they are the science that survives — and an
 * unanchored `/robust/` would delete them. `stability.band_*` on
 * `edge_e_values` measures too, so `band` only matches as `robustness_band`.
 */
const ROBUSTNESS_VERDICT_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /^robustness$/i,
  /^robustness_(band|verdict|level|tier|rating|score)$/i,
  /^is_robust$/i,
  /^display_verdict(_reason)?$/i,
]);

/** Does this key pass a robustness verdict? See the pattern list above. */
export function keyStatesRobustnessVerdict(key: string): boolean {
  return ROBUSTNESS_VERDICT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * NON-VACUITY, AT MODULE LOAD. A projection that can never fire is the same
 * theatre as an absence assertion that cannot see a presence (parent CLAUDE.md
 * trap 13). This module is imported by the compose seam, so a violation fails
 * the process at startup and every test that touches the seam.
 *
 * The positive case is the exact key from the 2026-09-03 live capture; the
 * negative cases are real sibling members of the same blob that MUST survive,
 * so the probe proves discrimination rather than mere sensitivity.
 */
function assertComparativeStandingReaderDiscriminates(): void {
  if (!keyStatesComparativeStanding('win_probability')) {
    throw new Error(
      'unrequested-analysis-confinement: keyStatesComparativeStanding does not match ' +
        '`win_probability`, the live key this projection exists to drop. The backstop is inert.',
    );
  }
  for (const survivor of ['outcome', 'downside', 'status', 'option_label', 'option_id']) {
    if (keyStatesComparativeStanding(survivor)) {
      throw new Error(
        `unrequested-analysis-confinement: keyStatesComparativeStanding matches \`${survivor}\`, ` +
          'a measurement member that must survive. The pattern set is over-broad and would ' +
          'delete outcome science from every unrequested run.',
      );
    }
  }
  // The verdict family, same shape: it must SEE the two live carriers and must
  // NOT see the fragility science sitting beside them.
  for (const verdictKey of ['robustness', 'robustness_band', 'is_robust', 'display_verdict']) {
    if (!keyStatesRobustnessVerdict(verdictKey)) {
      throw new Error(
        `unrequested-analysis-confinement: keyStatesRobustnessVerdict does not match ` +
          `\`${verdictKey}\`, a live verdict carrier. The family is inert.`,
      );
    }
  }
  for (const survivor of ['robust_edges', 'fragile_edges', 'near_tie', 'stability', 'band_min']) {
    if (keyStatesRobustnessVerdict(survivor)) {
      throw new Error(
        `unrequested-analysis-confinement: keyStatesRobustnessVerdict matches \`${survivor}\`, ` +
          'which MEASURES fragility rather than judging it. The pattern set is over-broad.',
      );
    }
  }
  // ⭐ THE TWO GUARDS MUST AGREE ABOUT THE SAME BLOB. Every member the
  // robustness allow-list keeps must be one the verdict family does NOT match —
  // otherwise the allow-list is quietly readmitting a verdict the family was
  // written to stop, and each guard would look correct on its own.
  for (const kept of UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS) {
    if (keyStatesRobustnessVerdict(kept)) {
      throw new Error(
        `unrequested-analysis-confinement: UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS keeps ` +
          `\`${kept}\`, which the verdict family classifies as a verdict. The allow-list and ` +
          'the family disagree about the same blob; one of them is wrong.',
      );
    }
  }
}
assertComparativeStandingReaderDiscriminates();

/**
 * Project one `enrichment.robustness` blob for an unrequested run: keep the
 * fragility science, drop the verdict.
 *
 * A non-object blob is dropped WHOLE rather than trusted — `enrichment` is an
 * untyped `z.record` passthrough (parent CLAUDE.md hazard 2), and we cannot
 * withhold what we cannot inspect.
 *
 * Returns `undefined` when nothing survives, so the caller omits the key
 * entirely. Never `{}`, which would positively assert an empty robustness
 * analysis.
 */
function projectRobustnessForUnrequestedRun(
  robustness: unknown,
): Record<string, unknown> | undefined {
  if (robustness === null || typeof robustness !== 'object' || Array.isArray(robustness)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(robustness as Record<string, unknown>)) {
    if (!UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS.includes(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Project an OPTION-SCOPED array (`option_comparison[]`,
 * `decision_brief.options[]`) for an unrequested run: drop the comparative
 * claim from every row, keep every measurement.
 *
 * ⚠ OPTION-SCOPED, DELIBERATELY — this must NOT be pointed at
 * `factor_sensitivity[]` or `p_win_sensitivity[]`. Those rows are FACTOR-scoped
 * and their `influence_rank` / `importance_rank` / `rank_flip_rate` /
 * `p_win_delta` members rank FACTORS, not options: they are the "what matters
 * most" science this confinement exists to preserve. The predicate below is
 * about a key name; the CONTAINER is what makes the key a claim about an
 * option, and that decision is made at the one call site.
 *
 * A non-array value is returned untouched (the shape the transport already
 * tolerates); a non-object row is likewise passed through, because a row we
 * cannot inspect carries no member we can name.
 */
function projectOptionScopedRowsForUnrequestedRun(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(row as Record<string, unknown>)) {
      if (UNREQUESTED_OPTION_ROW_DROPPED_MEMBERS.includes(key)) continue;
      // The derived backstop. See COMPARATIVE_STANDING_KEY_PATTERNS for why a
      // list and a predicate both run over the same object.
      if (keyStatesComparativeStanding(key)) continue;
      out[key] = member;
    }
    return out;
  });
}

/**
 * Project `enrichment.decision_brief` for an unrequested run.
 *
 * ONE MEMBER, ONE REASON: `options[]` is the brief's own option-scoped array
 * and carries the SAME comparative claim as `option_comparison[]`. Everything
 * else in the brief is either untouched here or has already been dropped by
 * `projectDecisionBriefForWithheldClaim`, which runs first on this path
 * (`headline`, `headline_banded`, `robustness_caveat`,
 * `analysis_summary.leading_option`, `analysis_summary.win_probability`, and
 * every `options[]` ordinal).
 *
 * A non-object brief is dropped WHOLE rather than trusted — the same
 * we-cannot-show-what-we-cannot-inspect decision the sibling branches make.
 */
function projectDecisionBriefForUnrequestedRun(
  brief: unknown,
): Record<string, unknown> | undefined {
  if (brief === null || typeof brief !== 'object' || Array.isArray(brief)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(brief as Record<string, unknown>)) {
    if (key === 'options') {
      out[key] = projectOptionScopedRowsForUnrequestedRun(value);
      continue;
    }
    // The brief's OWN copy of the verdict — a bare `"fragile"` at
    // `decision_brief.robustness` on the 2026-09-03 capture.
    if (keyStatesRobustnessVerdict(key)) continue;
    if (key === 'analysis_summary') {
      const summary = projectClaimKeysFromRecord(value);
      if (summary !== undefined) out[key] = summary;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Drop every comparative-standing and robustness-verdict member from one flat
 * record, keeping the rest verbatim.
 *
 * Used for `decision_brief.analysis_summary`, which carries
 * `robustness_band` beside members the withheld projection has already
 * trimmed. A non-object payload is dropped whole; `undefined` when nothing
 * survives, so the key is omitted rather than emitted as `{}`.
 */
function projectClaimKeysFromRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (keyStatesComparativeStanding(key)) continue;
    if (keyStatesRobustnessVerdict(key)) continue;
    out[key] = member;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Project an already-transport-projected enrichment for a run nobody asked
 * for. Pure; never throws; never mutates its input.
 *
 * Composed AFTER `toSafeTransportEnrichment` and after the withheld-claim
 * projection, never folded into either: transport-cleanliness, claim
 * permission and run provenance are three different axes, and folding them
 * would mean one of them could silently shrink another's rule set.
 */
export function projectTransportEnrichmentForUnrequestedRun(
  transport: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (transport === undefined) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transport)) {
    if (key === 'robustness') {
      const robustness = projectRobustnessForUnrequestedRun(value);
      if (robustness !== undefined) out[key] = robustness;
      continue;
    }
    if (key === 'option_comparison') {
      out[key] = projectOptionScopedRowsForUnrequestedRun(value);
      continue;
    }
    if (key === 'decision_brief') {
      const brief = projectDecisionBriefForUnrequestedRun(value);
      if (brief !== undefined) out[key] = brief;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}


/**
 * Confine an `analysis_result` block for a run nobody asked for.
 *
 * ⭐ IDENTITY ON EVERY USER-INITIATED RUN. The returned object is the input
 * object itself — not a clone, not a rebuild — whenever
 * {@link wasAnalysisRequestedByUser} is true. That is the whole safety
 * argument for putting this at the single block builder: the requested path,
 * which is every analysis a user has ever clicked for, cannot change shape by
 * one byte. The acceptance suite asserts reference identity, so a refactor
 * that starts cloning fails loudly rather than drifting.
 *
 * On an unrequested run three things change and nothing else:
 *   1. `summary` becomes {@link UNREQUESTED_ANALYSIS_SUMMARY};
 *   2. `win_probabilities` is omitted;
 *   3. `enrichment` is projected by
 *      {@link projectTransportEnrichmentForUnrequestedRun}.
 *
 * `leading_option_id` is NOT touched here — `compose.ts` already nulls it via
 * the withheld projection, which this run also routes through. One owner per
 * field; a second nulling here would be the twin-authority defect.
 *
 * ⚠ THE SUMMARY SUBSTITUTION IS UNCONDITIONAL ON THIS PATH, AND THAT IS A
 * DELIBERATE DEPARTURE from `projectAnalysisSummaryForWithheldClaim`, which
 * substitutes only when the text asserts a leader. The reasoning: that
 * projection protects an analysis the user asked for, where an honest summary
 * is content they are entitled to and blanking it would be over-suppression.
 * Here the whole class is the problem — the summary describes a model with no
 * user input, and the live capture's own summary carried its quantified claim
 * in prose ("came out ahead in 51% of runs of this model"). Substituting
 * conditionally would leave every non-leader quantified sentence standing
 * ("the ordering holds in about 51% of variations") and miss the acceptance
 * criterion. The original text is not lost: it stays on the persisted fact,
 * which is what freshness, decision records and the Phase-3 rebuild read.
 */
export function confineUnrequestedAnalysisBlock(
  block: AnalysisResultBlock,
  fact: RunAnalysisHandlerFact,
): AnalysisResultBlock {
  if (wasAnalysisRequestedByUser(fact)) return block;

  const { win_probabilities: _dropped, ...rest } = block;
  const enrichment = projectTransportEnrichmentForUnrequestedRun(
    block.enrichment as Record<string, unknown> | undefined,
  );

  return {
    ...rest,
    summary: UNREQUESTED_ANALYSIS_SUMMARY,
    ...(enrichment !== undefined
      ? { enrichment: enrichment as AnalysisResultBlock['enrichment'] }
      : {}),
  };
}
