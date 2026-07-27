/**
 * T1 claim safety — THE fact-array read. ROADMAP 1.233 (the hoist).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE EXISTS AT ALL: to stop a SECOND read point becoming a
 * second DERIVATION.
 *
 * Before the hoist there was exactly one place in `turn-executor.ts` that
 * answered "may this turn name a leading option" — the post-dispatch
 * claim-safety block. The hoist adds a second read point (turn entry), because
 * every non-execute exit returns before that block runs and was therefore
 * shipping the hardcoded `true` default to the Layer-3 egress guard, making the
 * alarm a licensed no-op on those exits (see the declaration comment at the
 * hoist site for the live evidence).
 *
 * Two read points is fine. Two DERIVATIONS is the defect this whole workstream
 * exists to close: CLAUDE.md trap #12, and the reason
 * `compose/withheld-claim-projection.ts` says "READS it rather than deriving
 * its own — two derivations can see different inputs and produce an internally
 * inconsistent response". So the read is extracted HERE, once, and both points
 * call it. A future third caller gets the same answer by construction rather
 * than by a reviewer noticing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. No I/O, no logging, no mutation.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  readConstraintVerdictStateFromResult,
  readMayNameLeadingOptionFromResult,
} from '../../orchestrator/context/constraint-feasibility.js';
import type { ConstraintVerdictState } from '../../orchestrator/context/constraint-feasibility.js';
import { selectClaimBearingRunAnalysisFact, selectRunAnalysisFact } from './freshness.js';

/**
 * May a turn grounded in THIS fact array name a leading option?
 *
 * ⚠ THIS PARAGRAPH WAS FALSE FROM #730 UNTIL F1, AND THE FALSE VERSION IS WHY
 * THE DEFECT SURVIVED REVIEW. It read: "Selection is CONTENT-based via
 * `selectRunAnalysisFact` — the same canonical selector the freshness
 * derivation and compose's lifecycle resolution use — so the permission and the
 * prose it governs describe the same analysis." #730 changed the selector to
 * {@link selectClaimBearingRunAnalysisFact} and left the sentence standing, so
 * the file asserted the ONE property it had just stopped having (CLAUDE.md trap
 * #14 — an honest label overwritten by a false one, here by omission).
 *
 * WHAT IS TRUE NOW. TWO selectors are consulted, because two different facts
 * can govern one turn and the permission has to answer for BOTH:
 *
 *   - {@link selectClaimBearingRunAnalysisFact} — the ENTITLEMENT fact: the
 *     newest fact that made a claim, whatever its `analysis_status`. #730's
 *     fix; it stops a newer WITHHELD `partial` being invisible.
 *   - {@link selectRunAnalysisFact} — the DISPLAYED fact: the newest
 *     SUCCESSFUL analysis, i.e. the one `buildAnalysisFromPriorFacts` projects
 *     into `contextPack.analysis` and thence into everything the model and the
 *     deterministic composers read.
 *
 * The permission is their CONJUNCTION. So the invariant the old sentence
 * claimed is now true by construction and stated as what it is: **no analysis
 * whose own verdict withheld the leader claim can be named under another
 * analysis's permission.** See {@link readMayNameLeadingOptionVerdict} for the
 * derivation and for why this is not the second-derivation defect.
 *
 * The verdict itself is read by {@link readMayNameLeadingOptionFromResult}
 * (typed `result.constraint_verdict` first, the interim
 * `enrichment.__cee_claim_safety` stamp second); this function never re-derives
 * it from constraints or graph state.
 *
 * TWO DIFFERENT DEFAULTS, deliberately:
 *
 *   - **No selectable `run_analysis` fact ⇒ `true`.** There is no analysis, so
 *     there is no leading option, so there is nothing to withhold and nothing
 *     for the guard to contradict. This is an HONEST true, not a fail-open one:
 *     the guard has no claim to police because no claim can be grounded.
 *   - **A `run_analysis` fact IS selected but carries no verdict ⇒ `false`**,
 *     via the reader's own fail-closed branch. "Unknown" and "verified
 *     feasible" are different claims and only the second licenses naming a
 *     leader; a write path that forgets to stamp is a bug that must not be
 *     silent (see `readMayNameLeadingOptionFromResult`'s docstring for the P0
 *     this default was earned by).
 *
 * The `fact_type` re-check is not defensive noise: {@link selectRunAnalysisFact}
 * is typed to return a `HandlerFact` and narrowing it here is what makes the
 * `.result` read type-safe. A non-`run_analysis` selection would mean the
 * selector changed contract, and the honest answer for a fact that is not an
 * analysis is the same as for no analysis at all.
 *
 * ⚠ THE ARRAY IS NOT THE SCENARIO — and that is why this overload still exists
 * but is no longer what the turn path calls. See
 * {@link readMayNameLeadingOptionVerdict}: the caller's array was a 20-turn
 * WINDOW, so the `selected === null` branch below fired on scenarios that DO
 * have an analysis whose parent turn had simply aged out. The branch is honest
 * about the array it is handed; the CALLER made it lie. Keep this function for
 * genuinely array-scoped questions (and for the tests that pin the two
 * defaults); route every scenario-scoped question through the verdict function.
 *
 * @param facts newest-first-agnostic array; the selector orders by content.
 */
export function readMayNameLeadingOptionForFacts(
  facts: readonly HandlerFact[],
): boolean {
  return readMayNameLeadingOptionVerdict(facts, ARRAY_ONLY_SCOPE)
    .may_name_leading_option;
}

/**
 * WHERE a `may_name_leading_option` answer came from.
 *
 * Exists because a `true` from "the scenario's newest analysis PERMITTED it"
 * and a `true` from "no analysis was in the array I was handed" were **the
 * same wire byte** — so no acceptance walk could build a valid control, and
 * the walk that tried reached for a turn-shape hypothesis its own data
 * refuted. Additive and diagnostic: nothing branches on it.
 *
 *   - `scenario_fact`        — a `run_analysis` fact was selected (from the
 *                              window or from the scenario-scoped read) and
 *                              its verdict was read. The answer describes a
 *                              real analysis.
 *   - `no_analysis_exists`   — no selectable analysis, and the window was NOT
 *                              provably truncated. The HONEST `true`: nothing
 *                              can be grounded, so nothing can leak.
 *   - `fail_closed_truncated`— no selectable analysis, the scenario-scoped
 *                              read did NOT succeed, and the window is
 *                              provably shorter than the scenario. The "no
 *                              analysis" premise is UNPROVEN, so we withhold.
 */
export type MayNameLeadingOptionProvenance =
  | 'scenario_fact'
  | 'no_analysis_exists'
  | 'fail_closed_truncated'
  /**
   * A claim-bearing fact WAS selected and could not be interpreted as a
   * run_analysis result. Withhold — and say which kind of withhold it is.
   *
   * Added rather than folded into an existing state, deliberately. #726 shipped
   * this discriminator because a `true` from "permitted" and a `true` from
   * "blind" were the same wire byte; overloading `no_analysis_exists` to also
   * mean "a fact existed but I could not read it" would rebuild that exact
   * problem on the `false` side. This state replaces a branch that used to
   * return `true` for an uninterpretable selection.
   */
  | 'fail_closed_uninterpretable'
  /**
   * The ENTITLEMENT fact permitted, but the analysis this turn can actually
   * DISPLAY is a DIFFERENT, older fact whose own verdict WITHHELD. F1.
   *
   * Its own state for the same reason the two above have theirs. "The newest
   * claim withheld" and "the newest claim permitted, but the analysis the user
   * is being shown withheld" are different situations needing different fixes:
   * the first is a constraint problem on the current run, the second means the
   * newest run is non-displayable (`partial` / `degraded` / an unrecognised
   * future PLoT status) and the product is projecting an older one. A triager
   * reading `_diagnostic_trace.claim_safety` must be able to tell them apart,
   * and folding this into `scenario_fact` would make them the same wire byte —
   * which is exactly what #726 and #730 each bought a discriminator to stop.
   */
  | 'fail_closed_projected_analysis';

export interface MayNameLeadingOptionVerdict {
  readonly may_name_leading_option: boolean;
  readonly provenance: MayNameLeadingOptionProvenance;
  /**
   * The verdict STATE read off THE SAME selected fact as the boolean above
   * (F2), and the reason it lives on the verdict rather than behind its own
   * reader.
   *
   * ⚠ IT USED TO HAVE ITS OWN SELECTION. `readConstraintVerdictStateForFacts`
   * called the selector a second time, so this module — whose header says "two
   * read points, never two DERIVATIONS" — contained two derivations of one
   * answer. They agreed only because callers handed both the same array, and
   * that stopped being true when the permission became scenario-scoped and the
   * state did not: on a scenario whose analysis had aged out of the 20-turn
   * window the permission described the scenario fact while the state that
   * EXPLAINS the permission read `null`, and the disclosure degraded to
   * cause-free copy. The P0 above makes this load-bearing rather than tidy:
   * permission, constraint state and disclosure copy must all originate from
   * the ONE selected fact, or the product withholds correctly and then explains
   * the wrong reason.
   *
   * `null` means "not recorded" and is never invented — a STATE has no safe
   * default the way the boolean's `false` does.
   */
  readonly constraint_verdict_state: ConstraintVerdictState | null;
}

/**
 * The SCENARIO-scoped inputs to the permission. All store-derived.
 *
 * ⚠ NOTHING HERE MAY EVER BECOME CLIENT-SUPPLIED. The *content* side already
 * has a client channel — `options.analysisState` populates `display_analysis`
 * from the REQUEST — which is exactly why the *permission* side must not. A
 * client that could hand us `newestAnalysisFact` could hand us a permitted
 * verdict for an analysis that withheld.
 */
export interface ClaimSafetyScenarioScope {
  /**
   * The scenario's newest non-noop `run_analysis` fact, read `WHERE
   * scenario_id = … ORDER BY created_at DESC LIMIT 1` — i.e. past the read
   * window. `null` = the scenario has none, or the read did not run.
   */
  readonly newestAnalysisFact: HandlerFact | null;
  /**
   * Did the scenario-scoped read actually execute and succeed? `false` covers
   * both a thrown read and a store that does not implement it. Only ever used
   * to ARM the fail-closed guard — never to widen the permission.
   */
  readonly readOk: boolean;
  /**
   * Is the loaded turn window PROVABLY shorter than the scenario's real turn
   * count (`prior_turns_total > prior_turns.length`)? When true, "no analysis
   * in the array" is not evidence of "no analysis in the scenario".
   */
  readonly windowTruncated: boolean;
}

/**
 * The array-only scope: no scenario read, so the fail-closed guard can never
 * arm and behaviour is byte-identical to the pre-fix reader.
 */
const ARRAY_ONLY_SCOPE: ClaimSafetyScenarioScope = {
  newestAnalysisFact: null,
  readOk: true,
  windowTruncated: false,
};

/**
 * ⭐ THE ONE FACT → ONE VERDICT NARROW. Read both claim-safety answers off a
 * fact that has ALREADY been chosen, by whatever chose it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS EXTRACTED, AND WHY A SECOND CALLER IS NOT A SECOND DERIVATION.
 *
 * This is the body of {@link readMayNameLeadingOptionVerdict}'s
 * `selected !== null` branch, lifted verbatim. That function still calls it, so
 * there is exactly ONE place in the estate that narrows a `HandlerFact` and
 * reads the pair (permission, state) off its `result` — the property #730's
 * "ONE typed object" note rests on.
 *
 * SELECTION IS NOT PART OF IT, and that separation is the whole point. The
 * question "WHICH fact governs this turn?" is scenario-scoped and is answered
 * once, by {@link readMayNameLeadingOptionVerdict} via
 * `selectClaimBearingRunAnalysisFact`. The question "what did THIS fact's
 * verdict say?" is fact-scoped, and a caller that has already selected its own
 * facts for its own reason must not run the scenario selection a second time to
 * ask it — that WOULD be the second derivation (CLAUDE.md trap #12), and a
 * second selection ceremony in the run-comparison gate is precisely what #726
 * nearly shipped.
 *
 * THE SECOND CALLER, and why it needs a fact-scoped read at all:
 * `routing/run-comparison-gate.ts` composes prose about TWO runs, which the
 * turn-level verdict cannot speak for — it describes the newest claim-bearing
 * fact and nothing else, so a PREVIOUS run's withheld leader was being named
 * under the CURRENT run's permission. The gate selects its own pair
 * (`selectTwoNewestRunAnalysisFacts`, which it has always owned) and asks this
 * function what each of those two facts said. It never re-asks the turn
 * question.
 *
 * `provenance` carries the same meaning it always had — `scenario_fact` means
 * "a run_analysis fact was selected and its verdict was read; the answer
 * describes a real analysis" — which is true of a per-run read as well. No new
 * state is added: #726 and #730 both bought their discriminators to separate
 * answers that were previously the SAME wire byte, and "which selector picked
 * this fact" is not a distinction any consumer branches on.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function readMayNameLeadingOptionVerdictForFact(
  fact: HandlerFact,
): MayNameLeadingOptionVerdict {
  if (fact.fact_type !== 'run_analysis') {
    // A selection we cannot interpret. This branch used to return `true` —
    // "the honest answer for a fact that is not an analysis is the same as
    // for no analysis at all" — which is exactly the reasoning #730's P0
    // showed to be unsafe: something WAS selected, so "no analysis" is not
    // what happened, and an uninterpretable claim-bearer must not be
    // entitled. Unreachable from the scenario selector (it only returns
    // run_analysis facts), and kept fail-closed so it cannot become reachable
    // and open — including for the per-run caller, whose own selector
    // (`isSuccessfulRunAnalysisFact`) carries the same narrowing today.
    return {
      may_name_leading_option: false,
      constraint_verdict_state: null,
      provenance: 'fail_closed_uninterpretable',
    };
  }
  return {
    // ONE fact, both answers, one narrow. Two `fact_type` checks would be two
    // chances to narrow differently on a single fact.
    may_name_leading_option: readMayNameLeadingOptionFromResult(fact.result),
    constraint_verdict_state: readConstraintVerdictStateFromResult(fact.result),
    provenance: 'scenario_fact',
  };
}

/**
 * ⭐ May a turn on THIS SCENARIO name a leading option, and on what evidence?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES: the permission described the last 20 CONVERSATION
 * TURNS; the channels it gates describe the WHOLE SCENARIO.
 *
 *   permission : readRecent(scenarioId)                  → LIMIT   20
 *   summary    : readRecent(scenarioId, 1000)            → LIMIT 1000
 *   records    : retrieveRecords(scenarioId, {limit: 8}) → SCENARIO-WIDE
 *
 * A `run_analysis` fact whose parent turn had left the 20-turn window was
 * invisible, `selectRunAnalysisFact` returned `null`, and the "honest true"
 * branch shipped an UNGATED rolling summary and decision-record set on a
 * scenario whose newest verdict withheld. Confirmed live: scenario
 * `f63ccb45-…` (31 turns) had its analysis turn at rank 20 at 12:57:02 →
 * `false`, and at rank 21 at 12:58:26 after one more turn committed → `true`,
 * with ZERO store change. A stamped-withheld verdict decayed the same way;
 * the protection had a turn-count expiry nobody wrote down.
 *
 * ⚠ AND THE TWO CONDITIONS ARE POSITIVELY CORRELATED. The rolling summary is
 * injected iff the window holds MORE than 8 turns; eviction needs more than
 * 20. So every turn on which the permission went blind was necessarily a turn
 * on which the richest leader-bearing channel was switched on. Not a
 * coincidence — an implication of the two constants.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ ONE-DIRECTIONALITY, and it is structural rather than empirical. Let `S` be
 * the scenario's newest non-noop `run_analysis` fact. Exactly two cases:
 *
 *   1. S's parent turn is INSIDE the window ⇒ `S ∈ windowFacts` already, so
 *      the union is set-identical to today's array and the selector returns
 *      the same fact. **Byte-identical behaviour.**
 *   2. S's parent turn is OUTSIDE the window ⇒ every windowed turn is NEWER
 *      than S's turn. A `run_analysis` fact on a newer turn would be newer
 *      than S, contradicting S being the newest. Therefore `windowFacts`
 *      contains **no `run_analysis` fact at all**, so today's answer was
 *      `true` unconditionally. The union is `{S}` ⇒ the new answer is `false`
 *      (withheld/unstamped) or `true` (permitted).
 *
 * Case 1 cannot move. Case 2 can only move `true → false`. **No input moves
 * `false → true`**, so every existing assertion of `false` still holds and the
 * only tests at risk are ones asserting `true` on a >20-turn fixture.
 *
 * This also disposes of the eligibility subtlety: the SQL read filters only
 * `noop = false`, so it can surface a fact that `selectRunAnalysisFact` then
 * rejects on `analysis_status` (partial/failed/degraded). Under case 2 the old
 * answer was `true` anyway, so a rejected S degrades to `true` — unchanged,
 * never a regression.
 *
 * @param windowFacts the loaded window's facts (`context.prior_facts`), plus
 *   any facts this turn just produced. Order-agnostic; the selector orders by
 *   content.
 * @param scope store-derived scenario-scoped inputs. Never client-supplied.
 */
export function readMayNameLeadingOptionVerdict(
  windowFacts: readonly HandlerFact[],
  scope: ClaimSafetyScenarioScope,
): MayNameLeadingOptionVerdict {
  // The UNION, not a replacement. Replacing the array with `[S]` would let the
  // eligibility filter drop S and hand back a `true` where the window held an
  // older withheld fact — a `false → true` move, i.e. the exact direction the
  // one-directionality proof above forbids.
  const facts =
    scope.newestAnalysisFact === null
      ? windowFacts
      : [...windowFacts, scope.newestAnalysisFact];

  // ⭐ THE ONE SELECTION, and it is the ENTITLEMENT selector — NOT the
  // freshness one. `selectRunAnalysisFact` filters out `partial`, `degraded`
  // and any status it does not recognise, which is right for "can I build a
  // result view from this?" and a FAIL-OPEN for "did an analysis withhold the
  // leader claim?": the handler accepts and persists a partial analysis and may
  // name a leader from it, so a withheld partial fact was invisible here and
  // this function answered `true` on the "no analysis exists" branch. See
  // `selectClaimBearingRunAnalysisFact` for the full derivation.
  //
  // ⚠ THE SENTENCE THAT USED TO SIT HERE IS NOW WRONG, AND IS REPLACED RATHER
  // THAN QUIETLY DELETED. It said: "There is deliberately no second selector
  // call in this file: a sibling reader with its own selection is the second
  // DERIVATION the header forbids." The rule it states is right and still
  // binding — for a sibling reader answering THE SAME QUESTION, which is what
  // `readConstraintVerdictStateForFacts` used to be and is why it is now a
  // delegate. It is NOT a rule against consulting a second fact when a second
  // fact genuinely governs the turn: that is #730's own "two selectors
  // answering two questions is DESIGN; two copies of one ordering rule is the
  // mirror defect", and the two selectors below share one ordering core
  // (`selectNewestRunAnalysisFact`) precisely so no rule is copied.
  const selected = selectClaimBearingRunAnalysisFact(facts);
  if (selected !== null) {
    const entitlement = readMayNameLeadingOptionVerdictForFact(selected.fact);
    // A withheld entitlement already withholds; nothing below can widen it, and
    // the early return keeps the common path a single selection.
    if (!entitlement.may_name_leading_option) return entitlement;
    return narrowToProjectedAnalysis(facts, selected.fact, entitlement);
  }

  // BELT AND BRACES — and it is a FALLBACK, not the mechanism. It requires
  // `readOk === false`, so when the scenario-scoped read works this branch is
  // UNREACHABLE by construction: a successful read either supplied S (⇒
  // `selected !== null` above, unless S failed eligibility) or proved the
  // scenario has no analysis at all. It exists for the degraded path, where
  // CLAUDE.md's rule applies — where you cannot derive, FAIL LOUD on drift,
  // never assume-good. `prior_turns_total` is already loaded (`countTurns`),
  // so this costs no query.
  //
  // It over-restricts: a scenario that genuinely never ran an analysis but has
  // >20 turns withholds while the store is degraded. That is the safe
  // direction, and it is bounded by the degradation.
  if (!scope.readOk && scope.windowTruncated) {
    return {
      may_name_leading_option: false,
      // No fact was selected, so there is no state to report. `null` is the
      // honest "not recorded" — inventing a cause for a withhold whose whole
      // justification is that we could not look would be a fabricated one.
      constraint_verdict_state: null,
      provenance: 'fail_closed_truncated',
    };
  }

  // The genuinely honest `true`: no analysis can be grounded, so no claim can
  // leak. This must NOT become `false` — a scenario with no analysis has
  // nothing to withhold, and withholding there would convert the fail-closed
  // default's cost from content into correctness.
  return {
    may_name_leading_option: true,
    constraint_verdict_state: null,
    provenance: 'no_analysis_exists',
  };
}

/**
 * ⭐ F1 — THE SECOND CONJUNCT: the analysis this turn can actually DISPLAY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, and why #730's fix is preserved rather than reverted.
 *
 * #730 correctly stopped the ENTITLEMENT question being answered with a QUALITY
 * filter. What it left behind is that the two questions are now answered by
 * DIFFERENT FACTS, and only one of them is the fact the turn shows:
 *
 *   permission : `selectClaimBearingRunAnalysisFact` → newest fact, ANY status
 *   content    : `selectRunAnalysisFact`             → newest SUCCESSFUL fact
 *                (`analysis-fallback.ts:510` — `buildAnalysisFromPriorFacts`
 *                 selects with it, and its output IS `contextPack.analysis`,
 *                 `display_analysis`, and the input to every deterministic
 *                 leader composer)
 *
 * Given A = newest SUCCESSFUL fact, WITHHELD, and B = a NEWER `partial` fact,
 * PERMITTED, the permission read B and said `true` while every content channel
 * carried A. The model-input chokepoint (`turn-executor.ts:2208`) keys on this
 * boolean, so the pack shipped A's withheld leader UNPROJECTED — and the
 * Layer-3 egress alarm was armed with `true`, so the leak did not even count.
 *
 * REACHABLE, not theoretical: `deriveConstraintVerdict` takes the PLoT
 * response, the ratified constraints and the leading option id — NOT
 * `analysis_status` (`tools/handlers/run-analysis.ts:837`). Verdict and status
 * are orthogonal, and the handler accepts and persists a `partial` analysis.
 *
 * WHY THE CONJUNCTION IS THE RIGHT SHAPE, AND NOT A REVERT.
 * Reverting #730's selector would restore the fail-open it closed (a withheld
 * `partial` invisible to the permission). Both questions have to be answered,
 * and the honest permission for a TURN is the AND of them: the turn may name a
 * leader only if the claim it is entitled to make and the analysis it is able
 * to show BOTH permit it. Neither conjunct can move an answer from `false` to
 * `true`, so #726's one-directionality argument survives intact.
 *
 * PROVABLY A NO-OP OFF THE DIVERGENCE PATH. When the newest claim-bearing fact
 * passes the quality filter — every scenario without a `partial` / `degraded` /
 * unrecognised-status fact newer than its newest successful one — both
 * selectors return the SAME fact, the reference check below is `true`, and the
 * function returns the entitlement verdict unchanged, byte for byte.
 *
 * ⚠ THE WINDOW/SCENARIO ASYMMETRY, CHECKED RATHER THAN ASSUMED. This selects
 * over `facts` = windowFacts ∪ {scenario-newest}, while
 * `buildAnalysisFromPriorFacts` selects over the bare window. They could name
 * different facts only if the union's extra member S were successful AND newer
 * than every windowed successful fact — but by the one-directionality proof in
 * {@link readMayNameLeadingOptionVerdict}, S outside the window implies the
 * window holds NO `run_analysis` fact at all, so the projection is `null` and
 * there is no displayed analysis to disagree about. Unreachable by
 * construction, in the safe direction either way.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT DO: gate `buildAnalysisFromPriorFacts`
 * itself. Blanking the winner there would also blank the RAW handler-facing
 * `analysis` slot — chips, telemetry (`leading_option_present`), projection
 * summaries and `chip-generator.ts`'s projection-buildability probe all read
 * it, and the model never sees it. Gating the PERMISSION keeps one chokepoint
 * honest; gating the projection would degrade unrelated surfaces to buy the
 * same thing.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function narrowToProjectedAnalysis(
  facts: readonly HandlerFact[],
  entitlementFact: HandlerFact,
  entitlement: MayNameLeadingOptionVerdict,
): MayNameLeadingOptionVerdict {
  const projected = selectRunAnalysisFact(facts);
  // No displayable analysis (only partials, or nothing at all) ⇒ no second
  // conjunct, and #730's rule governs alone: the newest CLAIM-BEARING fact
  // decides. This is the branch that keeps the fix from degenerating into
  // "withhold always wins".
  if (projected === null) return entitlement;
  // Same fact ⇒ same verdict. The check is redundant arithmetically and kept
  // for the guarantee it makes readable: this function can only ever move an
  // answer on the DIVERGENCE path.
  if (projected.fact === entitlementFact) return entitlement;

  const displayed = readMayNameLeadingOptionVerdictForFact(projected.fact);
  if (displayed.may_name_leading_option) return entitlement;

  return {
    may_name_leading_option: false,
    // THE DISPLAYED FACT'S state, not the entitling fact's. The state is what
    // the withheld-leader note explains the withhold WITH, and the entitling
    // fact's state describes the verdict that did NOT cause it — reporting it
    // here would be #730's own P2 ("withheld correctly and explained the wrong
    // reason") rebuilt at a new address. Permission, state and disclosure copy
    // still originate from ONE fact; F1 only changes WHICH fact that is.
    constraint_verdict_state: displayed.constraint_verdict_state,
    provenance: 'fail_closed_projected_analysis',
  };
}

/**
 * Build the scenario scope from a turn context, in ONE place, so the turn path
 * and the chip-click path cannot arrive at different scopes for the same
 * scenario. Structurally typed — no import of the context module, keeping this
 * file PURE.
 *
 * `windowTruncated` is only ever TRUE on a real number comparison: a `null`
 * / absent `prior_turns_total` means "unknown", and unknown must not arm a
 * guard whose whole justification is that truncation was PROVEN.
 */
export function claimSafetyScopeFromContext(context: {
  readonly newest_analysis_fact?: HandlerFact | null;
  readonly newest_analysis_fact_read_ok?: boolean;
  readonly prior_turns_total?: number | null;
  readonly prior_turns: readonly unknown[];
}): ClaimSafetyScenarioScope {
  const total = context.prior_turns_total;
  return {
    newestAnalysisFact: context.newest_analysis_fact ?? null,
    readOk: context.newest_analysis_fact_read_ok === true,
    windowTruncated:
      typeof total === 'number' && total > context.prior_turns.length,
  };
}

/**
 * Which verdict STATE did a turn grounded in THIS fact array record? (F2)
 *
 * The sibling of {@link readMayNameLeadingOptionForFacts}, and it exists for the
 * same reason this module does: so the two answers come from the SAME fact,
 * chosen by the SAME content-based selector. A note that described one analysis
 * while the withholding described another would be a second derivation wearing
 * a different hat (CLAUDE.md trap #12) — and the consumer here is copy that
 * makes a factual claim about the user's own scenario, so the cost of the two
 * disagreeing is a false sentence, not a cosmetic one.
 *
 * ONE DEFAULT, and it is `null` throughout — unlike the boolean's two. There is
 * no honest state to invent for "no analysis" or "nothing recorded": every one
 * of the five states makes a positive claim about what happened to the user's
 * condition (see `readConstraintVerdictStateFromResult`, which returns `null`
 * for exactly this reason). `null` means "not recorded", and the one consumer
 * degrades to cause-free copy rather than guessing a voice.
 */
export function readConstraintVerdictStateForFacts(
  facts: readonly HandlerFact[],
): ConstraintVerdictState | null {
  return readMayNameLeadingOptionVerdict(facts, ARRAY_ONLY_SCOPE)
    .constraint_verdict_state;
}
