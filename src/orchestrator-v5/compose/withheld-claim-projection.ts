/**
 * T1 claim safety — the STRUCTURED half. ROADMAP 1.218.
 *
 * WHAT THIS CLOSES. #708/#709/#710 gated the PROSE. The POST-#710 live walk
 * (staging `227e0aa`, `acceptance-evidence/g-cee-1-constraint-verdict/
 * WALK-2026-07-26-POST-710.md`) then measured what remained: on **5/5** withheld
 * bodies the same HTTP response that said *"no option can be put forward yet"*
 * still shipped, on the `analysis_result` block —
 *
 *   `enrichment.decision_brief.headline`         "… (Status Quo) currently leads, …"
 *   `enrichment.decision_brief.headline_banded`  `{ band: 'slightly_ahead',
 *                                                  leader_option_id: 'opt_status_quo' }`
 *   `enrichment.decision_review.*`               leader prose on 7+ sub-paths
 *   `leading_option_id`                          the leader's id, verbatim
 *
 * The claim was withheld in words and asserted in structure.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS IS NOT WIRE HYGIENE. IT IS RENDERED. The orchestrator's render probe
 * (UI `6d3f4611` / CEE `227e0aa`) photographed a withheld `unevaluated` turn
 * showing **"Standardise on MacBook Pro is slightly ahead."** as the hero
 * headline DIRECTLY BELOW the withheld disclosure, plus a "Leading option"
 * canvas badge — nine distinct leader surfaces, at counts identical to a
 * permitted run.
 *
 * `decision_brief.headline_banded` is the sharpest of the five: its `.text`
 * renders VERBATIM as that hero, and `normalizeHeadlineBanded()` consumes
 * `band` + `leader_option_id` + `robustness_gated` to set
 * `DecisionVerdict.hasLeadingOption` — the single boolean that module's own
 * docstring says every surface must gate on before asserting a leading option.
 * (`robustness_gated` is recorded and gates nothing.) CEE handed the UI the
 * producer-band licence to make the claim CEE had just declined to make.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT DROPPING `headline_banded` DOES AND DOES NOT DO — derived at the
 * deployed UI tip's bytes (`src/lib/decisionVerdict.ts@6d3f4611`), because
 * "it degrades gracefully" is a claim that has to be checked, not assumed:
 *
 *   DOES: `normalizeHeadlineBanded(undefined)` returns `null` at its FIRST
 *     guard (`typeof raw !== 'object'`), so `bandApplies` is false and the
 *     band authority never fires. No crash, no partial read — the same
 *     no-leader shape the panel's own unused `noClearLeader` copy exists for.
 *     And the verbatim hero string is gone with the field that carried it.
 *   DOES NOT: make `hasLeadingOption` false. With no band and no producer
 *     near-tie, the ladder falls to **Authority 3**, which DERIVES separation
 *     from `win_probabilities` alone (`source: 'win_probability'`). On the live
 *     `case1.run` body the gap is 0.567 − 0.221 = 0.346 ⇒ `clear` ⇒
 *     `hasLeadingOption: true`.
 *
 * So this module stops CEE ASSERTING a leader. It does not stop the UI
 * DERIVING one from the simulation's own numbers, and it was never going to:
 * those numbers are computed facts the disclosure explicitly invites the user
 * to act on, and they ship on `win_probabilities` / `option_comparison`
 * regardless. "The UI renders, never derives" is the next slice and belongs in
 * the UI repo. Stating it here so nobody reads a green CEE gate as a quiet
 * screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY DROP AND NOT REWRITE — and why that is *mirroring* #707, not departing
 * from it.
 *
 * The honest withheld copy for this turn ALREADY EXISTS and already reaches the
 * user: `coaching/constraint-gap-disclosure.ts` composes it into the summary,
 * which rides BOTH `assistant_text` AND `blocks[].summary` — the very same
 * block that carries `decision_brief`. Synthesising a second CEE-authored
 * withheld sentence into `decision_brief.headline` would put two different
 * accounts of one fact on one screen, which is precisely the reason
 * `buildConstraintDisclosure` returns `''` on `evaluated_infeasible`
 * ("Emitting a second, blunter sentence here would put two different accounts
 * of the same fact on one screen"). So the #707 convention, applied honestly
 * here, says: say it ONCE, in the slot that owns it, and remove the
 * contradicting artefacts.
 *
 * And a synthesised `headline_banded` would have to invent a band literal
 * (`'withheld'`) that no verified UI reader handles. ABSENCE, by contrast, is a
 * shape this exact field is PROVEN to tolerate on this exact wire: the key was
 * stripped by the safe-transport keep-list for the whole of its life until
 * @talchain/schemas 0.19.0 (see the `decision_brief` entry in
 * `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` — "the UI consumer shipped
 * contract-pinned and has been dark ever since because this one key was
 * stripped"). Dropping returns the field to a shape the consumer already
 * survived; inventing a literal does not.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY `decision_review` GOES WHOLE AND `decision_brief` DOES NOT — derived from
 * the bytes, not chosen. Walking every string in both blobs across all TEN
 * scored bodies of the POST-#710 archive with the egress guard's own pattern
 * set, the leader claims land at:
 *
 *   decision_review . narrative_summary                                (5/5 W)
 *                   . story_headlines.<option_id>                      (2/5 W)
 *                   . robustness_explanation.summary                   (3/5 W)
 *                   . robustness_explanation.fragility_factors[]       (2/5 W)
 *                   . decision_quality_prompts[].applies_because       (3/5 W)
 *                   . evidence_enhancements.<factor_id>.specific_action(1/5 W)
 *                   . scenario_contexts.<edge>.trigger_description     (P only)
 *   decision_brief  . headline                                         (5/5 W)
 *                   . headline_banded.text                             (5/5 W)
 *                   . robustness_caveat.text                           (5/5 W)
 *
 * `decision_review` is LLM-authored prose, end to end, under DYNAMIC keys
 * (option ids, factor ids, edge ids). A field allow-list over it is exactly the
 * hand-maintained mirror CLAUDE.md trap #12 is about — it would drift the first
 * time the prompt grew a field. compose.ts already drops the Phase-3 CARDS
 * built from this blob WHOLE on a withheld turn, for the stated reason that
 * "there is no template to gate and no substitution that can make that prose
 * honest". This is the same decision applied to the same content one layer
 * down.
 *
 * `decision_brief` is PLoT-computed STRUCTURE with three prose members. Its
 * remaining twelve members (`top_drivers`, `key_assumptions`,
 * `what_would_change`, `warnings`, `analysis_summary`, `defaulted_assumptions`,
 * `options`, …) carry no comparative claim and are exactly the content a user
 * needs MOST on the turn where a recommendation is being withheld. Dropping it
 * whole would be over-suppression — the failure the acceptance criteria weight
 * equally with the leak.
 *
 * THE THREE-MEMBER SET IS A MIRROR, AND IT IS GUARDED. Per trap #12 a mirror
 * must fail loud on drift rather than assume-good: a NEW leader-claiming member
 * of `decision_brief` is caught by the egress guard, which (same PR) deep-scans
 * both blobs on withheld turns and raises `v5.invariant_violation` naming the
 * exact path. The alarm is the drift detector; this list is not trusted to stay
 * complete on its own.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ 2026-07-27 — THE ABOVE DERIVATION WAS COMPLETE FOR THE SURFACES IT WALKED
 * AND INCOMPLETE AS COVERAGE, AND THAT DISTINCTION COST THREE WALKS.
 *
 * The POST-#710 walk it rests on scanned every STRING in `decision_review` and
 * `decision_brief` with the egress guard's PROSE pattern set. Two leader
 * designations are invisible to that instrument by construction, because they
 * carry no prose at all:
 *
 *   `decision_brief.analysis_summary.{leading_option, win_probability}`
 *   `robustness.{recommended_option_id, recommended_option_label,
 *                near_tie.top_option_id}`
 *
 * Both are bare labels and ids. The claim is in the KEY. `WALK-2026-07-27-
 * FINAL.md` §8 found them on 10/10 withheld bodies carrying an analysis block
 * and present in BOTH prior archives — pre-existing, not a #716 regression, and
 * missed because S1–S6 is a hand-kept list of five paths with no entry for
 * either container. "S1–S6 all silent" was a true statement and was never the
 * complete claim it read as.
 *
 * Both are now projected HERE, at this same funnel, by a KEY-NAME reader shared
 * with the alarm ({@link keyDesignatesLeadingOption}) rather than by a second
 * list. See {@link WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS} for the full
 * derivation, the complete member manifest behind it, and — stated rather than
 * silently decided — what is deliberately KEPT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ 2026-07-27, LATER THE SAME DAY — THE PARAGRAPH THAT USED TO SIT HERE SAID
 * `decision_brief.options[]` WAS OUT OF SCOPE. IT IS NOW IN SCOPE, AND LEAVING
 * THE OLD TEXT STANDING WOULD BE CLAUDE.md TRAP #14 (an honest label overwritten
 * by a stale one). It read, verbatim:
 *
 *   "NOT IN SCOPE, stated rather than silently decided: `decision_brief.options[]`
 *    keeps its `rank: 1|2|3`. Suppressing an ordering while the same block ships
 *    `win_probabilities` and `option_comparison` (neither flagged by the walk,
 *    both carrying the identical ordering) would be theatre, not a gate."
 *
 * `WALK-2026-07-27-CONFIRM.md` §6 put that channel on an inventory for the first
 * time and measured it live on **7 of 7** withheld analysis-bearing bodies, and
 * the A1 ruling of 2026-07-27 drew the line the old paragraph was missing.
 *
 * THE LINE IS DESIGNATION vs DATA, and it cuts the old argument in half rather
 * than reversing it:
 *
 *   KEPT — `win_probabilities`, `option_comparison`, and every
 *     `options[].win_probability`. They are COMPUTED FACTS the user is entitled
 *     to. The withheld verdict says "given your constraint I cannot put an
 *     option forward"; it does NOT say "I cannot compute win probabilities".
 *     This is the doctrine that made the UI RELABEL rather than gate its
 *     probability readouts (#493/#494): gating would delete data; the CLAIM is
 *     what gets withheld. The old paragraph was right about this half.
 *   GATED — `rank`. `rank == 1` is not a measurement. It is an ORDINAL
 *     DESIGNATION: a claim wearing a number, and the only thing in the whole
 *     withheld envelope that singles out one option by position.
 *   NEUTRALISED — the ORDER of `options[]`. The array ships sorted
 *     win-probability-descending, so `options[0]` IS the leader with no `rank`
 *     field needed. Position-as-designation is the same defect the ContextPack
 *     gate already fixed for the MODEL (`context/withheld-leader-projection.ts`);
 *     this closes it for the USER. On a withheld turn the array is re-ordered by
 *     `option_id`, so its position is a pure function of identities the payload
 *     already shows in full and carries no rank information.
 *
 * ⚠ AND ONE PREMISE OF THE OLD PARAGRAPH IS FALSE AT THE BYTES, which is why
 * "it would be theatre" did not survive contact with the archive. It claimed
 * `win_probabilities` and `option_comparison` both "carry the identical
 * ordering". They do not. On all 7 withheld bodies of
 * `raw-2026-07-27-confirm/`, `option_comparison` ships in GRAPH order
 * (`opt_dell` 0.219, `opt_macbook` 0.181, `opt_status_quo` 0.600) and
 * `win_probabilities` in the same graph key order — the leader is neither first
 * in either, nor is either sorted. They carry the VALUES, from which an ordering
 * is DERIVABLE by argmax; only `decision_brief.options[]` PRESENTS one. Deriving
 * a ranking from published numbers is the user's own arithmetic; presenting a
 * ranking is CEE's claim. That distinction is the whole of this change.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. Never throws, never mutates its input, and returns a new record.
 */

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { readMayNameLeadingOptionFromResult } from '../../orchestrator/context/constraint-feasibility.js';
import { S_BUCKET_REPLACEMENTS } from './sanitise-enrichment.js';
import {
  keyDesignatesLeadingOption,
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from './leading-option-egress-guard.js';

/**
 * Enrichment blobs dropped WHOLE from the wire on a withheld turn: prose
 * authored end-to-end on the premise that a leader may be named, under dynamic
 * keys no allow-list can track. See the module docstring for the derivation.
 */
export const WITHHELD_DROPPED_ENRICHMENT_BLOBS: readonly string[] = Object.freeze([
  'decision_review',
]);

/**
 * The leader-ranking members of `decision_brief`, dropped on a withheld turn
 * while the rest of the brief ships. Derived from a complete walk of all ten
 * POST-#710 bodies (module docstring); drift is caught by the egress guard, not
 * by this list.
 */
export const WITHHELD_DROPPED_DECISION_BRIEF_MEMBERS: readonly string[] = Object.freeze([
  // "Defer and Keep Current Machines (Status Quo) currently leads, …"
  'headline',
  // { band: 'slightly_ahead', leader_option_id, leader_label, runner_up_* } —
  // the UI's leader-entitlement grant.
  'headline_banded',
  // "…small changes to assumptions could change which option leads."
  'robustness_caveat',
]);

/**
 * Members that are leader-designating ONLY BECAUSE OF THE OBJECT THEY SIT IN,
 * and therefore cannot be recognised by {@link keyDesignatesLeadingOption}.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE 2026-07-27 ADDITION (WALK-2026-07-27-FINAL.md §8), AND WHY IT IS SPLIT IN
 * TWO.
 *
 * The walk's derived S7 manifest — which finds the leader by
 * `argmax(option_comparison.win_probability)` and then reports every path
 * carrying THAT identity and no other option's — found four structured paths
 * naming the leading option on **10 of 10** withheld bodies that carried an
 * analysis block:
 *
 *   `decision_brief.analysis_summary.leading_option`   'Standardise on Dell XPS'
 *   `decision_brief.analysis_summary.win_probability`  0.46625
 *   `robustness.recommended_option_label`              'Standardise on Dell XPS'
 *   `robustness.recommended_option_id` / `.near_tie.top_option_id`  'opt_dell'
 *
 * PRE-EXISTING, NOT A #716 REGRESSION: present in both prior archives, and
 * missed by three walks because S1–S6 is a hand-kept list with no entry for
 * either container and because the egress guard did not scan
 * `enrichment.robustness` at all.
 *
 * Three of those four are recognised BY NAME and are dropped by the derived
 * reader — nothing about them needs to be listed, and a fifth key name that
 * does not exist yet is covered the day it ships. The remaining ones are
 * different in kind: the KEY is innocent and the CONTAINER makes the claim.
 *
 *   `analysis_summary.win_probability` — the key says "a win probability". Its
 *     container says "…of the leading option". Dropping `leading_option` while
 *     keeping the number would leave the object asserting exactly the fact the
 *     turn is withholding, one join away from the `win_probabilities` roster
 *     that ships beside it. It is the second half of the same designation and
 *     it goes with the first.
 *   `near_tie.second_option_id` / `.tied_option_ids` — the honest content of
 *     `near_tie` is WHETHER the top of the ranking is a tie (`is_tie`, `gap`,
 *     `threshold`), and that ships unchanged. The IDENTITIES are the ordering
 *     claim: `tied_option_ids` is the leader verbatim whenever it is a
 *     singleton (the walk caught exactly that), and `second_option_id` is the
 *     runner-up half of the pair the model-facing projection already drops
 *     alongside `leading_option` (`context/withheld-leader-projection.ts`).
 *     KEEP THE FACT, DROP THE IDENTITIES — one rule, applied uniformly, so
 *     there is no per-field judgement to drift.
 *
 * ⚠ WHAT IS DELIBERATELY NOT HERE, stated rather than silently decided:
 *
 *   `analysis_summary.goal_fit` / `.robustness_band` — the complete member set
 *     of `analysis_summary`, derived across all five archives (142 bodies, 65
 *     enriched blocks) is exactly {`leading_option`, `win_probability`,
 *     `goal_fit`, `robustness_band`}. Both survivors name no option and rank
 *     nothing, and BOTH are on the explicit KEEP list of the model-facing
 *     projection for the same reason. Same doctrine, same answer.
 *   `robustness.confidence` — numerically equal to the leading option's win
 *     probability, and the walk's manifest flags it for that reason. It is an
 *     unlabelled scalar under a key that designates nobody; suppressing it
 *     while `win_probabilities` and `option_comparison` ship the whole roster
 *     verbatim would be theatre, which is this estate's dominant defect class.
 *
 *     ⚠ 2026-07-27 — THE EQUALITY IS NOT A COINCIDENCE, IT IS AN IDENTITY, AND
 *     IT IS A MISLABELLING DEFECT THAT DOES NOT BELONG TO CEE. Traced producer
 *     → adapter → consumer at the bytes rather than assumed:
 *       ISL `src/services/robustness_analyzer_v2.py@1716f9bb`
 *         :4528  `recommendation_stability = option_wins[winner] / n_samples`
 *         :4590  `confidence = _stability_confidence_figure(stability, n)`
 *         :2739  `del n_samples; return recommendation_stability`  ← identity
 *         :4602  `confidence_basis = "recommendation_stability_uncalibrated"`
 *       PLoT `src/routes/v2/run.ts@dd144f77:2794` forwards it verbatim, while
 *         `src/contracts/isl-to-ui.contract.ts:71` DROPS the honestly-named
 *         twin `robustness.recommendation_stability` as "the leader's
 *         win_probability relabelled, zero independent information".
 *     So `confidence` is the leader's win probability under a name that implies
 *     calibration, which ISL's own field description now denies. BOTH upstream
 *     repos disclose it and PLoT's own comment calls the duplication "a
 *     cross-repo contract question … not settled unilaterally by this lane".
 *     CEE is a pure passthrough here — nothing in this repo READS
 *     `robustness.confidence` (the compose readers take
 *     `factor_sensitivity[].confidence`, a different field). It is therefore
 *     not fixable at this seam and is raised for its own row rather than
 *     smuggled into a claim-safety projection. Under the DESIGNATION vs DATA
 *     ruling it stays: it is a probability VALUE, it names no option, and the
 *     only way to reach the leader through it is to argmax the roster that
 *     ships beside it anyway. The defect is the LABEL, not the value.
 *     (Note it is not even a reliable identity: :4535 scales
 *     `recommendation_stability` by a defaulted-root penalty, so on such a run
 *     `confidence` and the leader's `win_probability` differ.)
 *   `robustness.fragile_edges[].alternative_winner_id` / `_label` — the
 *     COUNTERFACTUAL winner if that edge flips. Not the leader; the opposite of
 *     the leader. It is the substance of a fragility finding, it is exactly
 *     what a user needs on a turn where the recommendation is withheld, and PR
 *     #717 landed a fix to carry it through the flip path days before this. The
 *     `^` anchors on the key patterns exist to keep it.
 *   `decision_brief.options[].win_probability` — KEPT, and the anti-
 *     over-suppression pin in the route test asserts its PRESENCE explicitly.
 *     Only the element's `rank` and the array's ORDER are designations; the
 *     number is a computed fact. See {@link WITHHELD_DROPPED_OPTION_MEMBERS}.
 *
 * ⚠ `decision_brief.options[]` IS NO LONGER "out of scope" — that line was here
 * until 2026-07-27 and the module docstring now carries the ruling that replaced
 * it. Its `rank` is dropped and its order neutralised; its probabilities stay.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exported for the drift test, which asserts each entry really is dropped by the
 * projection — a declared list that the code does not honour is the mirror
 * failure this file's own docstring warns about (CLAUDE.md trap #12).
 */
export const WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS: readonly string[] = Object.freeze([
  'win_probability',
]);

/** See {@link WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS}. */
export const WITHHELD_DROPPED_NEAR_TIE_MEMBERS: readonly string[] = Object.freeze([
  'second_option_id',
  'tied_option_ids',
]);

/**
 * Key names that assert a POSITION IN A RANKING rather than measure anything.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A PATTERN FAMILY AND NOT `['rank']`, AND WHY IT IS SEPARATE FROM
 * {@link keyDesignatesLeadingOption}.
 *
 * A one-element list is the hand-maintained mirror CLAUDE.md trap #12 is about:
 * green today, silent the day PLoT ships `position: 1` beside it. The family
 * gives the property a list has not — an ordinal that has never been observed
 * is covered the day it arrives — and the drift test asserts exactly that.
 *
 * SEPARATE from the leader-designating family for a reason that is load-bearing
 * in both directions:
 *   - `keyDesignatesLeadingOption` is SHARED with the Layer-3 egress alarm, and
 *     the alarm's `scanKey` returns immediately on a non-string
 *     (`leading-option-egress-guard.ts` — `typeof value !== 'string'`). `rank`
 *     is a NUMBER. Adding it to that family would put a name in the alarm's
 *     vocabulary that the alarm can never fire on — a detector in prose only,
 *     which is precisely the guarantee-theatre class this file exists to close.
 *   - the drift test's ANCHOR CONTROL asserts `keyDesignatesLeadingOption('rank')`
 *     is `false`, because that family is also what the alarm reports on. That
 *     control stays true, and this predicate is what carries the ordinal rule.
 *
 * `^`-ANCHORED, and the anchor is doing work: `blocks[].priority_rank` ranks
 * CARDS, not options — 67 instances across the withheld arm of
 * `raw-2026-07-27-confirm/`, not one of them singling out an option. An
 * unanchored `/rank/` would eat the coaching-card ordering.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const ORDINAL_DESIGNATING_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /^rank(?:ing|_index|_position)?$/,
  /^order(?:ing|_index)?$/,
  /^position$/,
  /^ordinal$/,
  /^placement$/,
  /^standing$/,
]);

/**
 * Does this key name assert a position in a ranking?
 *
 * Exported for the drift test, which pins both directions: every ordinal the
 * live archive carried, ordinals never observed, and the anchor control that
 * `priority_rank` / `win_probability` / `option_id` are NOT ordinals.
 */
export function keyDesignatesOrdinalPosition(key: string): boolean {
  return ORDINAL_DESIGNATING_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * The members of a `decision_brief.options[]` element dropped on a withheld
 * turn, listed here for the drift test — the projection reads
 * {@link keyDesignatesOrdinalPosition}, not this constant.
 *
 * Exactly one member is observed in the live archive. **`win_probability` is
 * NOT here and must not be**: the ruling of 2026-07-27 keeps every per-option
 * probability, and the route test asserts its PRESENCE on a withheld turn as
 * the anti-over-suppression pin.
 */
export const WITHHELD_DROPPED_OPTION_MEMBERS: readonly string[] = Object.freeze(['rank']);

/**
 * The `robustness` members recognised by NAME rather than by container, listed
 * here for the drift test ONLY — the projection does not read this constant, it
 * reads {@link keyDesignatesLeadingOption}. The test asserts the shared reader
 * still recognises every one, so a narrowing of the pattern family fails loudly
 * here instead of silently reopening §8.
 */
export const WITHHELD_LEADER_DESIGNATING_KEYS_OBSERVED: readonly string[] = Object.freeze([
  'leading_option',
  'recommended_option_id',
  'recommended_option_label',
  'top_option_id',
]);

/**
 * Drop every leader-designating member of one structured object, keeping the
 * rest verbatim.
 *
 * TWO READERS, ONE FUNNEL. `keyDesignatesLeadingOption` is the shared,
 * pattern-derived vocabulary the Layer-3 alarm scans with — so a key this drops
 * is a key that alarm reports, and neither can drift from the other.
 * `containerScopedMembers` carries the few members whose key name is innocent
 * and whose container makes the claim; it is small and enumerated.
 *
 * ⚠ 2026-07-27 — THE PRECEDING SENTENCE USED TO END "…and the alarm is its
 * drift detector." THAT WAS FALSE AT THE BYTES, and a comment naming a detector
 * that cannot fire is the guarantee-theatre class in prose — the thing this file
 * exists to close, written into the file itself.
 * `WALK-2026-07-27-CONFIRM.md` §12.4 item 4 refuted it: the alarm's `scanKey`
 * (`leading-option-egress-guard.ts`) returns immediately unless
 * `typeof value === 'string' && value.length > 0`, and
 * `analysis_summary.win_probability` is a NUMBER while `near_tie.tied_option_ids`
 * is an ARRAY — so neither can ever reach a pattern test. The third member,
 * `near_tie.second_option_id`, IS a string but matches no pattern in
 * `LEADER_DESIGNATING_KEY_PATTERNS` (the drift test's own anchor control asserts
 * `keyDesignatesLeadingOption('second_option_id') === false`, deliberately, so
 * the runner-up is not read as the leader).
 *
 * THE REAL DETECTOR IS CI, NAMED SO THE NEXT READER RELIES ON SOMETHING THAT
 * EXISTS: `__tests__/withheld-structured-designation.drift.test.ts` —
 * "the withheld projection honours every member it declares" — walks
 * {@link WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS} and
 * {@link WITHHELD_DROPPED_NEAR_TIE_MEMBERS} and asserts each is absent from the
 * projected output. A member added to either list without a matching drop fails
 * THERE. The alarm remains the detector for the KEY-NAME family only.
 *
 * A non-object payload is dropped whole rather than trusted — the same decision
 * {@link projectDecisionBriefForWithheldClaim} already makes, for the same
 * reason: this is an untyped `z.record` passthrough (parent CLAUDE.md hazard 2)
 * and we cannot show what we cannot inspect.
 */
function projectLeaderDesignatingMembers(
  source: unknown,
  containerScopedMembers: readonly string[],
): Record<string, unknown> | undefined {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (keyDesignatesLeadingOption(key)) continue;
    if (containerScopedMembers.includes(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The claim-free sort key of one `decision_brief.options[]` element.
 *
 * IDENTITY ONLY. Every candidate here names WHICH option the element is about
 * and nothing about where it placed — so an order derived from it is a pure
 * function of identities the payload already ships in full, and therefore
 * carries no rank information. `win_probability`, `rank`, `goal_fit` and every
 * other measure are deliberately absent from the chain: sorting by any of them
 * would replace one ordering claim with another.
 *
 * Returns `undefined` when the element offers no identity at all. The caller
 * treats that as "not neutralisable" and drops the array — the same
 * we-cannot-show-what-we-cannot-inspect decision the sibling `decision_brief`
 * and `robustness` branches already make on an uninspectable payload.
 */
function claimFreeOptionSortKey(element: unknown): string | undefined {
  if (element === null || typeof element !== 'object' || Array.isArray(element)) return undefined;
  const record = element as Record<string, unknown>;
  for (const key of ['option_id', 'id', 'label', 'option_label'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return `${key}:${value}`;
  }
  return undefined;
}

/**
 * Project `decision_brief.options[]` for a withheld turn: drop the ORDINAL,
 * neutralise the ORDER, keep every measured value.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CLOSES — `WALK-2026-07-27-CONFIRM.md` §6, live on 7/7 withheld
 * analysis-bearing bodies at build `7508820`, invisible to every instrument
 * that had ever been pointed at this wire:
 *
 *   `options[rank == 1]`  names the leader by label AND carries its probability
 *   `options[0]`          the array is sorted win-probability-DESCENDING, so
 *                         position alone is the same designation with no `rank`
 *
 * S1–S6 has no entry for the path; S7/S8 read KEY NAMES and `rank`, `label`,
 * `win_probability` are all innocent names (matcher-v4's own anchor control
 * requires them to stay innocent, or it would manufacture an over-suppression
 * finding against the deliberately-kept set); every prose tier sees bare labels
 * and numbers; and the FINAL walk's derived manifest normalised `options[0]` →
 * `options[]`, saw all three options at that path, and classified it a symmetric
 * roster — correct about the PATH, wrong about the OBJECT.
 *
 * TWO OF THE THREE THINGS IN AN ELEMENT SURVIVE. `option_id`, `label` and
 * `win_probability` all ship. The ruling of 2026-07-27 is that the probabilities
 * are DATA and gating them would delete what the user is entitled to; the route
 * test asserts their presence on a withheld turn precisely so a later
 * "tighten the gate" cannot quietly take them.
 *
 * WHY RE-ORDER RATHER THAN SHUFFLE OR REVERSE. A random order is not pure and
 * not reproducible; a reversed order still carries the ranking (last is the
 * leader). A canonical order keyed on identity is total, deterministic, and
 * information-free — and it is the same answer the model-facing projection
 * reached for the ContextPack.
 *
 * ⚠ THE ONE RESIDUAL, STATED RATHER THAN LEFT TO BE FOUND: `Array.prototype.sort`
 * is stable, so two elements with the SAME sort key keep their input order and
 * therefore their relative rank. That requires two elements claiming the same
 * option identity — a malformed payload with no claim-free way to tell them
 * apart. It has never been observed; it is written down here rather than
 * discovered by the next walk.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function projectOptionsForWithheldClaim(options: unknown): unknown[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const keyed: Array<{ key: string; element: Record<string, unknown> }> = [];
  for (const element of options) {
    const key = claimFreeOptionSortKey(element);
    // Not neutralisable ⇒ the whole array goes. Keeping an element we cannot
    // re-order would leave the ordering claim standing on the survivors.
    if (key === undefined) return undefined;
    const projected: Record<string, unknown> = {};
    for (const [member, value] of Object.entries(element as Record<string, unknown>)) {
      if (keyDesignatesOrdinalPosition(member)) continue;
      // The leader-designating family too: an `options[].leading_option_id`
      // sibling arriving later is covered the day it ships, exactly as it is on
      // the brief's own keys.
      if (keyDesignatesLeadingOption(member)) continue;
      projected[member] = value;
    }
    keyed.push({ key, element: projected });
  }
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((entry) => entry.element);
}

/**
 * May THIS analysis fact's turn name a leading option?
 *
 * Reads the ONE persisted verdict the run_analysis handler wrote, never
 * re-derives it — two derivations over different inputs are how one HTTP
 * response ends up contradicting itself (CLAUDE.md trap #12). Typed
 * `result.constraint_verdict` first (schemas 0.25.0), the interim
 * `enrichment.__cee_claim_safety` stamp second (facts persisted between #710
 * and that release), FAILS CLOSED on neither — see
 * `readMayNameLeadingOptionFromResult` for why "unknown" must not read as
 * "verified".
 */
export function mayNameLeadingOptionForFact(fact: RunAnalysisHandlerFact): boolean {
  return readMayNameLeadingOptionFromResult(fact.result);
}

/**
 * The `analysis_result` block's summary on a withheld turn whose PERSISTED
 * summary names a leader.
 *
 * States the one thing that is unambiguously true — an analysis exists and was
 * read — and then the withholding, in the register
 * `WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL` already uses. No cause: this
 * substitution fires on facts whose verdict is, by construction, unreadable, so
 * a cause here would be exactly the fabrication F2 removes from the input note.
 *
 * "put forward", never "recommended" — the shared leader vocabulary bans the
 * whole `recommend*` family, and the build-time probe below fails the module if
 * this copy ever trips it.
 */
export const WITHHELD_ANALYSIS_SUMMARY =
  'This analysis has been run. No single option can be put forward on its result yet.';

/**
 * Project one `analysis_result` block summary for a turn whose verdict
 * WITHHOLDS the leading-option claim.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * F1 — THE FIELD THE WITHHELD PROJECTION NEVER TOUCHED, AND THE ONE HISTORIC
 * SHAPE THAT MAKES IT BITE.
 *
 * `buildAnalysisResultBlock` (compose.ts) nulls `leading_option_id`, projects
 * the enrichment through {@link projectTransportEnrichmentForWithheldClaim} and
 * hands the Phase-3 rebuild a permission that drops every leader-presuming
 * block. `summary` shipped VERBATIM on both branches.
 *
 * On a fact this codebase writes today that is harmless: a withheld turn's
 * summary is composed by the gated headline builder and names no leader. The
 * failing input is a fact persisted BEFORE #708's headline gate — no
 * `constraint_verdict`, no `__cee_claim_safety`, so the reader FAILS CLOSED to
 * `false` — carrying a pre-gate summary of the form "The MacBook Pro currently
 * leads by 18 percentage points". There is no data migration (A1 ruling), so
 * those facts are live. Reopen the scenario, click explain, get freshness
 * `fresh`, and compose's prior-fact lifecycle branch rebuilds the block from
 * that fact: the wire then carries gated blocks, `leading_option_id: null`, a
 * projected enrichment, and that sentence — beside an assistant_text saying no
 * option can be put forward.
 *
 * The gate's own fail-closed default MANUFACTURES the contradiction the whole
 * arc exists to close, through the one field the residue meter could not see.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SUBSTITUTION IS CONDITIONAL, AND THAT IS THE ANTI-OVER-SUPPRESSION PROPERTY.
 * A summary that names no leader is kept BYTE-IDENTICAL. Withholding is scoped
 * to the CLAIM, not to the field: on the very turn a recommendation is withheld,
 * an honest summary is content the user is entitled to, and blanking every one
 * of them would be the failure this estate weights equally with the leak.
 *
 * `textAssertsLeadingOption` (the ENFORCER's reader), not
 * `textNamesLeadingOption` (the ALARM's): this function REPLACES user-facing
 * content when it fires, so it takes the reader that blanks the documented
 * false-positive spans first — the same choice
 * `compose/withheld-explanation-answer.ts` makes, for the same reason. A
 * summary reading "higher capacity leads to faster delivery" must survive.
 *
 * PURE. Never throws, never mutates.
 */
export function projectAnalysisSummaryForWithheldClaim(summary: string): string {
  if (typeof summary !== 'string' || summary.length === 0) return summary;
  return textAssertsLeadingOption(summary) ? WITHHELD_ANALYSIS_SUMMARY : summary;
}

/**
 * BUILD-TIME PROBE — the substituted summary must not itself trip the alarm
 * that measures the residue this projection exists to remove.
 *
 * Identical mechanism and rationale to
 * `compose/withheld-explanation-answer.ts`'s `assertSubstitutedCopyIsLeaderFree`
 * and `context/withheld-leader-projection.ts`'s `assertInjectedNoteIsLeaderFree`
 * — and now strictly necessary, because F1 puts `summary` INSIDE
 * `BLOCK_PROSE_FIELDS`. Copy that trips the vocabulary would fire the guard on
 * every withheld turn carrying a historic fact, and the only symptom would be an
 * alarm rate nobody had a reason to look at.
 *
 * `textNamesLeadingOption` (the ALARM's wider reader), not the enforcement one:
 * one doctrine for all copy this workstream authors — there is no reason to hold
 * our own substituted copy to a laxer bar than the instrument that measures it.
 *
 * Runs at module load and throws on drift; this module is imported by the
 * compose seam, so a violation fails the process at startup and every test that
 * touches the seam (CLAUDE.md trap #12: a mirror must fail loud).
 */
function assertWithheldAnalysisSummaryIsLeaderFree(): void {
  if (textNamesLeadingOption(WITHHELD_ANALYSIS_SUMMARY)) {
    throw new Error(
      'withheld-claim-projection: WITHHELD_ANALYSIS_SUMMARY trips the shared leader ' +
        'vocabulary (compose/leading-option-egress-guard.ts LEADER_CLAIM_PATTERNS). The ' +
        'withheld block summary would inject the exact residue the output alarm measures, ' +
        'on every withheld turn built from a historic fact. Reword the copy — do not narrow ' +
        'the pattern set, which is shared with the alarm.',
    );
  }
  // NON-VACUITY, at module load: prove the projection can actually SEE a leader
  // claim. A substitution that never fires is the same theatre as an absence
  // assertion that cannot see a presence (CLAUDE.md trap 13).
  if (
    projectAnalysisSummaryForWithheldClaim('The MacBook Pro currently leads by 18 points.') !==
    WITHHELD_ANALYSIS_SUMMARY
  ) {
    throw new Error(
      'withheld-claim-projection: projectAnalysisSummaryForWithheldClaim did not substitute ' +
        'the live pre-#708 leader-naming summary class. The gate is inert.',
    );
  }
}
assertWithheldAnalysisSummaryIsLeaderFree();

/**
 * Project the ALREADY safe-transport-projected enrichment for a turn whose
 * verdict withholds the leading-option claim.
 *
 * Composed with `toSafeTransportEnrichment` rather than folded into it: that
 * function is the transport keep-list (a cross-repo contract pinned
 * element-for-element against `@talchain/schemas`' `CEE_UI_ENRICHMENT_KEEP_LIST`
 * by `tests/contract/cee-to-ui.contract.test.ts`), and claim-permission is a
 * different axis from transport-cleanliness (`compose/claim-safety-cage.ts`
 * §"Two orthogonal axes"). Keeping them separate means this gate cannot silently
 * shrink the keep-list.
 *
 * Returns `undefined` when nothing survives, so the block omits `enrichment`
 * entirely — the shape it already has on chip-click / autofire-off turns.
 */
export function projectTransportEnrichmentForWithheldClaim(
  transport: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (transport === undefined) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transport)) {
    if (WITHHELD_DROPPED_ENRICHMENT_BLOBS.includes(key)) continue;
    if (key === 'decision_brief') {
      const brief = projectDecisionBriefForWithheldClaim(value);
      if (brief !== undefined) out[key] = brief;
      continue;
    }
    // ROADMAP 1.218 extension (WALK-2026-07-27-FINAL.md §8). Handled HERE, in
    // the one funnel that already owns `decision_brief` and `headline_banded`,
    // rather than in a second suppression path beside it: two owners of one
    // rule is how the estate ends up with two `generateGraphHash` twins.
    if (key === 'robustness') {
      const robustness = projectRobustnessForWithheldClaim(value);
      if (robustness !== undefined) out[key] = robustness;
      continue;
    }
    // schemas 0.31.0 — `critiques` carries OPTION IDENTITY in
    // `affected_option_ids` and in the S-bucket display copy, so unlike the
    // 0.30.0 VOI family it is NOT trivially leading-option-inert and cannot
    // pass through a withheld turn unchanged.
    if (key === 'critiques') {
      const critiques = projectCritiquesForWithheldClaim(value);
      if (critiques !== undefined) out[key] = critiques;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Drop the leader designations from one `enrichment.robustness` blob, keeping
 * the fragility science verbatim.
 *
 * `near_tie` is projected recursively rather than dropped whole: `is_tie`,
 * `gap` and `threshold` are the tie FACT and they are precisely the content a
 * user needs on a withheld turn. Only the identities go.
 */
function projectRobustnessForWithheldClaim(
  robustness: unknown,
): Record<string, unknown> | undefined {
  const projected = projectLeaderDesignatingMembers(robustness, []);
  if (projected === undefined) return undefined;
  if (!('near_tie' in projected)) return projected;

  const nearTie = projectLeaderDesignatingMembers(
    projected.near_tie,
    WITHHELD_DROPPED_NEAR_TIE_MEMBERS,
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(projected)) {
    if (key === 'near_tie') {
      // `undefined` ⇒ nothing survived (or it was not an object) ⇒ omit the
      // key, the shape a blob with no near-tie block already has. Never `{}`,
      // which would positively assert an empty tie analysis.
      if (nearTie !== undefined) out[key] = nearTie;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Drop the leader-ranking members of one `decision_brief`, keeping everything
 * else verbatim. A non-object brief (never seen on the live wire, but this is
 * an untyped `z.record` passthrough — parent CLAUDE.md hazard 2) is dropped
 * whole rather than trusted: we cannot show what we cannot inspect.
 */
function projectDecisionBriefForWithheldClaim(brief: unknown): Record<string, unknown> | undefined {
  if (brief === null || typeof brief !== 'object' || Array.isArray(brief)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(brief as Record<string, unknown>)) {
    if (WITHHELD_DROPPED_DECISION_BRIEF_MEMBERS.includes(key)) continue;
    // The derived reader on the brief's OWN keys, alongside the three-member
    // list above. The three are prose members no key pattern can recognise; this
    // covers a `decision_brief.leading_option` sibling arriving later, which is
    // exactly how `analysis_summary` got here.
    if (keyDesignatesLeadingOption(key)) continue;
    if (key === 'analysis_summary') {
      const summary = projectLeaderDesignatingMembers(
        value,
        WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS,
      );
      if (summary !== undefined) out[key] = summary;
      continue;
    }
    // WALK-2026-07-27-CONFIRM.md §6. The ORDINAL and the ORDER go; every
    // measured value stays. See `projectOptionsForWithheldClaim`.
    if (key === 'options') {
      const projected = projectOptionsForWithheldClaim(value);
      if (projected !== undefined) out[key] = projected;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Remove option identity from already-transport-projected `critiques[]`.
 *
 * Runs AFTER `projectCritiquesForTransport`, which has already dropped the
 * D-bucket, withheld `message`, and rendered `user_message`. The only thing
 * left to do on a withheld turn is stop the rows DESIGNATING an option:
 *
 *   1. `affected_option_ids` is dropped — it is raw option identity.
 *   2. S-bucket `user_message` is RE-RENDERED from the approved catalogue with
 *      no option ids supplied, so `resolveLabelOrFallback` yields the generic
 *      phrase. No withheld-specific copy is invented: the fallback wording is
 *      the same reviewed string the catalogue already uses when an id cannot be
 *      resolved. U-bucket copy is producer prose and is left alone here — the
 *      leading-option egress guard scans it (`ENRICHMENT_CLAIM_BLOBS`).
 *
 * The rows THEMSELVES are kept. The claim being withheld is "which option
 * leads"; "this option changes nothing yet" is a different claim, and dropping
 * it would suppress the most useful thing still true — the same
 * anti-over-suppression ruling that keeps per-option win_probability.
 */
export function projectCritiquesForWithheldClaim(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (row == null || typeof row !== 'object') return row;
    const src = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === 'affected_option_ids') continue;
      out[k] = v;
    }
    const code = typeof src.code === 'string' ? src.code : undefined;
    const replacement = code ? S_BUCKET_REPLACEMENTS[code] : undefined;
    if (replacement !== undefined) {
      // Empty context + no option ids ⇒ the catalogue's generic fallback.
      out.user_message = replacement(
        { graph: null, analysisReady: null, enrichment: null },
        { affected_option_ids: undefined, affected_node_ids: undefined },
      );
    }
    return out;
  });
}
