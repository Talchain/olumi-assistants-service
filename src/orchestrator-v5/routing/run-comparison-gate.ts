/**
 * V5 P0.2 — run-comparison gate (Test 3: "what changed?" / "why did the
 * result change?").
 *
 * Deterministic sibling guard (mirrors `stale-rerun-guard.ts`). It owns
 * the result-sense "what changed?" turn, and is FAIL-CLOSED on freshness
 * (T4 Slice 3): only a confirmed-fresh verdict may ground a comparison.
 *
 *   - freshness === 'fresh' AND >= 2 successful runs: deterministic
 *     prior/current comparison. This is the ONLY verdict that grounds one.
 *   - freshness === 'stale' (the model was edited after the latest run):
 *     lead with re-run guidance. An old comparison is NEVER presented as
 *     the current edited model.
 *   - freshness === 'unknown', or an absent/unavailable authority:
 *     currency cannot be confirmed, so offer an unconfirmed-framed re-run —
 *     WITHOUT asserting the model changed (§1 authority parity of the
 *     merged freshness policy: never claim which state is current).
 *   - freshness === 'none': decline so the downstream guards keep their
 *     behaviour (the state-query guard answers the graph-edit sense of
 *     "what changed?"; the no-analysis guard answers when nothing has run).
 *
 * Policy: Docs/t4/t4-spine-policy-v1.md §1b (unknown ⇒ hold/refuse), §1
 * authority parity, §5 (acknowledge before presenting). The verdict handling
 * is an exhaustive switch with a `never` guard, so fail-closed is structural
 * rather than by convention.
 *
 * PLACEMENT: must run BEFORE the state-query guard, which also matches
 * "what changed?" but answers from `recent_changes` (the graph-edit
 * sense). This gate claims the turn only when a genuine comparison
 * exists (or the model is stale); when it declines, the state-query
 * guard's existing behaviour is unchanged.
 *
 * Pure: no LLM, no DB reads (reuses already-loaded `prior_facts` +
 * `freshness`), no mutation. Copy is British English, plain language, no
 * internal vocab, no raw 0.xx decimals, no IDs.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  classifyAnalyticalIntent,
  hasMutationSignal,
} from './analytical-intent.js';
import {
  compareRuns,
  projectRunFact,
  selectTwoNewestRunAnalysisFacts,
  type LeaderIdentityBasis,
  type RunDelta,
} from '../coaching/compare-runs.js';
import { formatPercentagePoints } from '../format/format-analysis-value.js';
// T1 claim safety (ROADMAP 1.233) — the ALARM's reader, for the module-load
// probe on this file's withheld copy. Imported rather than re-implemented so the
// probe and the alarm cannot drift (CLAUDE.md trap #12).
import { textNamesLeadingOption } from '../compose/leading-option-egress-guard.js';
// PER-RUN claim safety — #730's ONE fact → ONE verdict narrow, applied to each
// of the two facts THIS gate already selected. Imported, never re-implemented,
// and deliberately NOT the scenario selector: see
// `readMayNameLeadingOptionVerdictForFact`'s docstring for why a second
// selection ceremony here is the defect and this is not.
import { readMayNameLeadingOptionVerdictForFact } from '../context/claim-safety-read.js';

export type RunComparisonFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

export type RunComparisonMode =
  | 'stale'
  | 'unconfirmed'
  | 'compared'
  | 'insufficient_runs'
  | 'incomparable';

export interface RunComparisonSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: 'run_analysis';
}

export type RunComparisonUnmatchedReason =
  | 'empty_message'
  | 'mutation_signal'
  | 'not_what_changed'
  | 'no_runs';

export type RunComparisonGuardResult =
  | {
      readonly matched: true;
      readonly mode: RunComparisonMode;
      readonly assistant_text: string;
      readonly suggested_actions: readonly RunComparisonSuggestedAction[];
      /** Null unless a comparison was actually produced. */
      readonly leading_option_changed: boolean | null;
      /**
       * The EVIDENCE behind `leading_option_changed`, forwarded so the
       * `v5.run_comparison_gate` drift ledger can tell an indeterminate-false
       * from a verified-same-leader-false. Without it the two are one byte in
       * telemetry — on exactly the legacy-window turns where the forced-false
       * most needs observing. Null unless a comparison was produced.
       */
      readonly leader_identity_basis: LeaderIdentityBasis | null;
    }
  | {
      readonly matched: false;
      readonly reason: RunComparisonUnmatchedReason;
    };

export interface RunComparisonGuardInput {
  readonly message: string;
  readonly priorFacts: readonly HandlerFact[];
  readonly freshness: RunComparisonFreshness | null | undefined;
  /**
   * T1 claim safety (ROADMAP 1.233) — may this turn NAME a leading option?
   *
   * READ by the caller off the persisted `run_analysis` verdict and passed
   * down; this gate never re-derives it (CLAUDE.md trap #12: two derivations
   * over different inputs are how one response contradicts itself).
   *
   * REQUIRED, not optional-defaulting-to-true, and deliberately so: the same
   * doctrine as `EgressSanitiseOpts.mayNameLeadingOption`. This gate composes
   * leader prose in code with zero LLM calls, so a call site that forgot the
   * permission would silently re-open the exact leak — an optional field would
   * make that omission compile. Callers that ran no analysis pass `true`, which
   * is the honest statement of "nothing was withheld".
   *
   * ⚠ IT IS THE TURN'S PERMISSION, NOT A RUN'S — and treating the two as one
   * thing was a live leak. This boolean describes the scenario's NEWEST
   * claim-bearing fact; a comparison names TWO runs. The gate therefore uses it
   * as the OUTER conjunct only, and refines it per compared run — see
   * {@link RunComparisonLeaderAuthority}. It remains load-bearing on its own:
   * it is the only input that can see `fail_closed_truncated` (a degraded
   * scenario-scoped read on a provably truncated window), which no per-fact
   * read can detect.
   */
  readonly mayNameLeadingOption: boolean;
  /**
   * Spine A backstop: factor_ids an option intervenes on. Threaded into
   * `compareRuns` so an option-controlled lever is never reported as having
   * gained/lost influence between runs (the comparator diffs raw `top_drivers`,
   * bypassing `projectTopDrivers`). Omitted / empty ⇒ no suppression.
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  /**
   * F2 CHANGE B — the intent is TYPED (a `what_changed` chip_click), so the
   * caller has ALREADY decided this is a comparison turn. Skip the free-text
   * `classifyAnalyticalIntent` regex, which exists only to disambiguate typed
   * CHAT. The empty-message and mutation-signal fail-safes still apply (a typed
   * pill carries fixed, benign copy — never an edit instruction — so neither
   * fires in practice, but keeping them makes the gate total regardless of
   * caller). Default false ⇒ the free-text path is byte-identical to today.
   */
  readonly forceIntent?: boolean;
}

const RERUN_ACTION: RunComparisonSuggestedAction = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

const STALE_TEXT =
  'The model has changed since the last analysis, so the earlier results no longer reflect it. '
  + 'Re-run the analysis to see what has actually changed in the outcome.';

// Unconfirmed-freshness copy (freshness === 'unknown', or an absent authority).
// Currency cannot be confirmed — a legacy fact missing its run-time hash, an
// unhashable current graph, or no verdict at all. Unlike STALE_TEXT it must NOT
// assert the model has changed (we do not know that): §1 authority-parity of the
// merged freshness policy forbids claiming which state is current. Reuses the
// shipped `buildAnalysisUnconfirmedTemplate` lead clause verbatim so the two
// unconfirmed surfaces cannot drift, tailored to the comparison register.
const UNCONFIRMED_TEXT =
  `The last analysis may be out of date because I can't confirm it still `
  + `matches the current model, so I can't reliably compare the runs yet. `
  + `Re-run the analysis to see the current result.`;

const INSUFFICIENT_RUNS_TEXT =
  'There is only one analysis run so far, so there is nothing to compare yet. '
  + 'Run the analysis again after a change and I can show you what moved.';

const INCOMPARABLE_TEXT =
  'I could not line up the last two runs cleanly enough to compare them. '
  + 'Re-running the analysis is the most reliable way to see the current result.';

/**
 * T1 claim safety (ROADMAP 1.233) — the sentence that replaces the
 * leading-option half of a comparison when the persisted verdict WITHHOLDS.
 *
 * `runComparisonOutcome.assistant_text` was registered `ungated` by #713's
 * drift ledger, and this gate makes ZERO LLM calls: {@link composeComparison}
 * builds "The leading option has changed. X came out ahead before, and Y now
 * leads." and "Its lead has widened by about N percentage points." directly
 * from the two runs' persisted enrichment. Input gating cannot reach a
 * composer with no model in it — this site has to consume the verdict itself.
 *
 * Says only what `mayNameLeadingOption === false` means, without asserting a
 * cause we may not have evidence for on this turn — the same discipline, and
 * deliberately the same register, as
 * `compose/withheld-explanation-answer.ts`'s
 * WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL.
 *
 * ⚠ THE WORDING IS CONSTRAINED BY THE ALARM. The first version of this constant
 * said "…which one is **out in front**…", and `out_in_front`
 * (`/\bout\s+in\s+front\b/i`) is a live pattern in `LEADER_CLAIM_PATTERNS`. On a
 * withheld comparison the guard is armed with `false` and scans `assistant_text`
 * with the raw set, so that copy made EVERY withheld comparison turn emit an
 * error-level `v5.invariant_violation` naming `out_in_front` — a standing red on
 * the exact instrument this workstream exists to make trustworthy, and one that
 * would have taught triage to dismiss `out_in_front` as "the gate's own copy"
 * and so masked a genuine leak (CLAUDE.md trap #7).
 *
 * It is the SAME phrase the sibling input note's probe rejected during
 * development. Two independent authors of withheld copy reached for it, which is
 * why the guard below is now a module-load assertion rather than a review habit.
 */
export const WITHHELD_LEADER_COMPARISON_TEXT =
  'No single option can be put forward on this result yet, so I am not showing '
  + 'the order of the options or how that has moved.';

/**
 * Copy for a withheld comparison in which NOTHING leader-free survived — the
 * two runs differed only in their ordering and margin.
 *
 * A separate constant rather than {@link WITHHELD_LEADER_COMPARISON_TEXT}
 * alone: "here is what else moved" followed by nothing is a worse artefact
 * than a sentence that admits the comparison is empty for this turn. TESTING-
 * DISCIPLINE rule 6 — a stated limit beats a silent one.
 */
export const WITHHELD_NOTHING_ELSE_CHANGED_TEXT =
  WITHHELD_LEADER_COMPARISON_TEXT
  + ' Nothing else about the two runs moved enough to report.';

/**
 * Copy for the MIXED case in which the PRIOR run's verdict withholds and the
 * current run's permits — the Codex scenario, and the commonest shape of it.
 *
 * Written in the register of {@link WITHHELD_LEADER_COMPARISON_TEXT} on
 * purpose, reusing its two load-bearing phrases verbatim ("put forward", "the
 * order of the options"). Two authors of withheld copy in this file have now
 * independently reached for leader vocabulary (see the probe below), so new
 * copy here is composed from the sanctioned phrases rather than freshly worded.
 *
 * The tense is the only real change: `could` and "the earlier result", because
 * the claim being declined is about a run that has already happened.
 */
export const WITHHELD_PRIOR_LEADER_COMPARISON_TEXT =
  'No single option could be put forward on the earlier result, so I am not '
  + 'showing how the order of the options has moved.';

/**
 * The mirror-image mixed case: the CURRENT run's verdict withholds while the
 * prior run's permits.
 *
 * Reachable, but not by the same route as its sibling — see the reachability
 * note on {@link RunComparisonLeaderAuthority}. Given an explicit shape anyway:
 * a case enumerated and left to fall through to a neighbouring branch is how
 * "the comparison degrades honestly" becomes "the comparison degrades however
 * the last `else` happened to be written".
 */
export const WITHHELD_CURRENT_LEADER_COMPARISON_TEXT =
  'No single option can be put forward on the latest result yet, so I am not '
  + 'showing how the order of the options has moved.';

/**
 * ⭐ NOT A WITHHOLD — an UNMATCHED IDENTITY. Both runs' verdicts permit; we
 * simply cannot prove the two runs' leading options are the same option.
 *
 * WHY THIS IS A SEPARATE CONSTANT rather than a reuse of
 * {@link WITHHELD_PRIOR_LEADER_COMPARISON_TEXT}. That sentence states a REASON
 * — "no single option could be put forward on the earlier result" — which is a
 * claim about a constraint verdict. Here the earlier verdict said no such
 * thing; the earlier run simply carried no option ids. Reusing it would ship a
 * true-sounding sentence with a false cause, which is CLAUDE.md trap #14 in the
 * user-facing register: the label that gets remembered is the one that was
 * wrong.
 *
 * ⚠ WHY IT IS NEEDED AT ALL — the amendment this constant exists for.
 * `compareRuns` correctly refuses to assert a leader change when identity is
 * indeterminate, but a bare `leading_option_changed === false` reaching this
 * composer rendered "X still leads." — an AFFIRMATIVE continuity claim. On a
 * legacy id-less run whose leader GENUINELY changed, the mechanism therefore
 * replaced a correct "the leader changed" with a confident, false "nothing
 * changed": the fix landing one hop short of the user, and a worse artefact
 * than the defect it was fixing, because "still leads" is the shape a user
 * stops reading at.
 *
 * Composed from the sanctioned leader-free phrase ("the order of the options")
 * per this file's standing rule, and probed at module load like every other
 * substituted constant here.
 */
export const UNMATCHED_LEADER_IDENTITY_TEXT =
  'I cannot line up the earlier result with this one closely enough to say '
  + 'whether the order of the options has moved.';

/**
 * ⭐ MAY THIS TURN NAME **THIS** RUN'S LEADING OPTION? One answer per compared
 * run, because a comparison makes one claim per run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES. {@link composeComparison} received ONE permission and
 * composed BOTH runs' leaders from it:
 *
 *     `The leading option has changed. ${prior_leading_label} came out ahead
 *      before, and ${current_leading_label} now leads.`
 *
 * The caller supplies the TURN's permission, which #730 reads off the
 * scenario's newest CLAIM-BEARING fact. That fact speaks for the current run
 * and for nothing else. So on any scenario whose PRIOR run withheld its leader
 * and whose CURRENT run permits, "What changed?" named the withheld one — the
 * withhold had an expiry equal to one more analysis. (Cleanup-review F4 is the
 * same defect seen from the other end: "composeComparison re-asserts the prior
 * run's leader on a later permitted turn".)
 *
 * ⭐ ONE-DIRECTIONAL BY CONSTRUCTION. Each field is
 * `turnPermission && thatRunsOwnVerdict`, so every value this type can hold is
 * `≤` the single boolean it replaces. **No input moves `false → true`**: a turn
 * that withheld everything still withholds everything, and the only reachable
 * change is a leader that used to be named no longer being named. That is the
 * same safety argument #726 made for the scenario scope, and it is why the
 * permitted/permitted case is byte-identical rather than merely equivalent.
 *
 * REACHABILITY, stated per field rather than assumed symmetric — the two are
 * NOT equally likely and pretending otherwise would misdescribe the fix:
 *
 *   - `prior === false, current === true` — COMMON, and it has two production
 *     forms. (a) the prior run's verdict is stamped withheld; (b) the prior run
 *     predates the verdict stamp entirely, so `readMayNameLeadingOptionFrom
 *     Result` fail-closes on it. Form (b) makes every legacy run's leader
 *     nameable from a later permitted turn, and it needs no unusual state at
 *     all — just a scenario that has been running since before #710.
 *   - `prior === true, current === false` — RARE, and it needs the turn
 *     permission and the compared current run to come from DIFFERENT facts.
 *     The turn permission is read off the newest claim-bearing fact of any
 *     status; the comparison's current run is the newest SUCCESSFUL one. They
 *     diverge only when a newer non-successful (e.g. `partial`) fact exists and
 *     is stamped permitted, which is exactly the state #730 made visible.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface RunComparisonLeaderAuthority {
  /** May the PRIOR (older) run's leading option be named on this turn? */
  readonly prior: boolean;
  /** May the CURRENT (newer) run's leading option be named on this turn? */
  readonly current: boolean;
}

/**
 * BUILD-TIME PROBE — withheld copy must not trip the alarm that measures the
 * residue it exists to remove.
 *
 * ⚠ THIS IS A CLASS, NOT AN INSTANCE, AND IT WAS EARNED TWICE IN ONE CHANGE.
 * The sibling input note (`context/withheld-leader-projection.ts`) had its first
 * draft rejected by the same kind of probe for saying "out in front"; this file
 * then shipped review-clean with the identical phrase, because nothing was
 * checking it. Substituted copy is written in the register of the thing it is
 * replacing, so the author is reaching for leader vocabulary by construction —
 * a review habit is the wrong control for that, and a module-load assertion is
 * the right one.
 *
 * ⚠ `textNamesLeadingOption`, NOT `textAssertsLeadingOption`. This is
 * RESPONSE-side copy, so the reader that matters is the one the ALARM uses —
 * the wide net with no enforcement carve-outs, which is exactly what
 * `findLeaderClaims` runs over `assistant_text` at egress. Probing with the
 * narrower enforcement reader would let copy through that the alarm then flags
 * on every withheld turn: the failure this probe exists to prevent, dressed as
 * a passing check.
 *
 * Runs at module load and throws on drift, so a violation fails the process at
 * startup and every test importing this gate — loudly, which is the point
 * (CLAUDE.md trap #12: a mirror must fail loud, never assume-good).
 */
function assertWithheldCopyIsLeaderFree(): void {
  const probes: ReadonlyArray<readonly [string, string]> = [
    ['WITHHELD_LEADER_COMPARISON_TEXT', WITHHELD_LEADER_COMPARISON_TEXT],
    ['WITHHELD_NOTHING_ELSE_CHANGED_TEXT', WITHHELD_NOTHING_ELSE_CHANGED_TEXT],
    // The two MIXED-case substitutions. They ship on turns that ALSO name the
    // other run's leader, so the alarm is not armed on them today — but the
    // hazard the probe exists for is authorial, not situational: both were
    // written in the register of the sentence they replace, which is what makes
    // an author reach for leader vocabulary.
    // `__tests__/run-comparison-per-run-authorization.test.ts` pins that this
    // list stays complete by reflecting over the module's exports ('DERIVED:
    // every exported WITHHELD_* constant is covered by the module-load probe'),
    // so a third constant cannot be added and left unprobed (CLAUDE.md #12).
    // ⚠ FILE NAME CORRECTED 2026-07-27: this line named
    // `run-comparison-gate.test.ts`, which contains no reflection at all. The
    // pin was real and working; only the pointer was wrong — trap #14 (a label
    // that does not match its mechanism) inside the module whose whole subject
    // is that a mechanism's label must be true. A reader following it found
    // nothing, and could have concluded the guarantee was absent or deleted the
    // real pin as a duplicate.
    ['WITHHELD_PRIOR_LEADER_COMPARISON_TEXT', WITHHELD_PRIOR_LEADER_COMPARISON_TEXT],
    ['WITHHELD_CURRENT_LEADER_COMPARISON_TEXT', WITHHELD_CURRENT_LEADER_COMPARISON_TEXT],
    // The leader-free branches too: they ship on withheld turns as well, so a
    // copy edit to any of them carries the same hazard.
    ['STALE_TEXT', STALE_TEXT],
    ['UNMATCHED_LEADER_IDENTITY_TEXT', UNMATCHED_LEADER_IDENTITY_TEXT],
    ['UNCONFIRMED_TEXT', UNCONFIRMED_TEXT],
    ['INSUFFICIENT_RUNS_TEXT', INSUFFICIENT_RUNS_TEXT],
    ['INCOMPARABLE_TEXT', INCOMPARABLE_TEXT],
  ];
  for (const [name, copy] of probes) {
    if (textNamesLeadingOption(copy)) {
      throw new Error(
        `run-comparison-gate: ${name} trips the shared leader vocabulary ` +
          '(compose/leading-option-egress-guard.ts LEADER_CLAIM_PATTERNS). On a ' +
          'withheld comparison the egress alarm is armed with `false`, so this ' +
          'copy would raise an error-level v5.invariant_violation on EVERY such ' +
          'turn — a standing red that trains triage to ignore the one instrument ' +
          'that can see a real leak. Reword the copy — do not narrow the pattern ' +
          'set, which is shared with the alarm.',
      );
    }
  }
}
assertWithheldCopyIsLeaderFree();

/**
 * Plain-language robustness band phrasing. Re-derived locally rather than
 * imported from `coaching/robustness-honesty.ts` to keep this gate
 * decoupled; band-map consolidation is a tracked follow-up. Aligned with
 * the routing-prompt TERMINOLOGY_MAP wording (no "robustness" token).
 */
function bandPhrase(level: string): string | null {
  switch (level) {
    case 'fragile':
      return 'sensitive to your assumptions';
    case 'moderate':
      return 'moderately stable';
    case 'stable':
      return 'stable';
    case 'highly_stable':
      return 'very stable';
    default:
      return null;
  }
}

/**
 * @param authority ONE permission PER COMPARED RUN — see
 *   {@link RunComparisonLeaderAuthority}. Both fields are read by the caller
 *   and by this gate's own per-run read; neither is re-derived from constraints
 *   or graph state here (CLAUDE.md trap #12).
 *
 * ⚠ THE SUPPRESSION IS DELIBERATELY PARTIAL, and that is the anti-
 * over-suppression property. Only the two leader-designating groups go: which
 * option is ahead, and by how much its LEAD moved. The robustness-band shift
 * and the driver-influence mover are statements about the RESULT'S STABILITY
 * and about FACTORS, not about which option wins — they rank nothing, and they
 * are the substance of the user's actual question ("what changed?"). Dropping
 * the whole comparison would trade a leak for the failure the acceptance
 * criteria weight equally with it. That property is now preserved in all FOUR
 * permission combinations, not just the two the single boolean could express.
 *
 * ⚠ THE MIXED CASES MUST NOT LEAK BY IMPLICATION, and this is the subtle part.
 * Two sentences that name no forbidden option can still designate one between
 * them:
 *
 *   - `"${current} still leads."` — "still" ASSERTS the prior run's leader was
 *     the same option. It is a designation of the prior leader by identity, in
 *     a sentence whose only proper noun is the current one. It is therefore
 *     restricted to the both-permitted branch, not merely reworded.
 *   - `"The leading option has changed."` + a named prior leader would let a
 *     two-option model determine the current leader by elimination. So the
 *     change claim is confined to both-permitted as well, and the mixed
 *     branches make no cross-run claim at all.
 *   - The MARGIN sentences describe a shift between the two runs' leads, so
 *     they presuppose BOTH leaders and require BOTH permissions.
 */
function composeComparison(
  delta: RunDelta,
  authority: RunComparisonLeaderAuthority,
): string {
  const parts: string[] = [];
  const mayNamePrior = authority.prior;
  const mayNameCurrent = authority.current;
  // Both runs' verdicts permit: the only state in which a CROSS-RUN claim
  // (whether the leader changed, and by how much the lead moved) is grounded.
  const mayCompareLeaders = mayNamePrior && mayNameCurrent;

  // ⭐ PERMISSION IS NOT THE ONLY PRECONDITION FOR A CROSS-RUN CLAIM — the two
  // runs' leaders must also be KNOWN TO BE THE SAME OPTION OR NOT.
  //
  // `leading_option_changed` is a single boolean over a THREE-valued question:
  // changed / unchanged / cannot tell. `compareRuns` collapses the third case
  // to `false` (the safe direction there), and a composer that branches only
  // on the boolean silently promotes "cannot tell" to "unchanged" — then says
  // so out loud. On a legacy id-less run whose leader really did change, that
  // is a confident false negative in the one sentence the user reads. The
  // basis is therefore consulted HERE, next to the words.
  const leaderIdentityKnown = delta.leader_identity_basis === 'option_id';
  const mayCompareLeaderIdentity = mayCompareLeaders && leaderIdentityKnown;

  if (mayCompareLeaderIdentity) {
    // Byte-identical to the pre-fix permitted arm.
    if (delta.leading_option_changed) {
      parts.push(
        `The leading option has changed. ${delta.prior_leading_label} came out ahead before, and ${delta.current_leading_label} now leads.`,
      );
    } else {
      parts.push(`${delta.current_leading_label} still leads.`);
    }
  } else if (mayCompareLeaders) {
    // PERMITTED BUT UNMATCHABLE. Both verdicts allow naming, so this run's
    // leader is said plainly — the same first sentence as the mixed branch
    // below, because the user-visible situation is the same: one run's leader
    // is nameable and no relation between the runs is. What differs is the
    // REASON, which is why the second sentence is its own constant.
    parts.push(`${delta.current_leading_label} leads on the latest result.`);
    parts.push(UNMATCHED_LEADER_IDENTITY_TEXT);
  } else if (mayNameCurrent) {
    // MIXED — the prior run withheld. Name what this run's own verdict
    // licenses, say plainly that the other half is unavailable, and make no
    // statement that relates the two.
    parts.push(`${delta.current_leading_label} leads on the latest result.`);
    parts.push(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
  } else if (mayNamePrior) {
    // MIXED, mirrored. "came out ahead in the earlier run" is scoped to that
    // run by construction — no "before", which only means anything relative to
    // a current leader we are declining to name.
    parts.push(`${delta.prior_leading_label} came out ahead in the earlier run.`);
    parts.push(WITHHELD_CURRENT_LEADER_COMPARISON_TEXT);
  } else {
    parts.push(WITHHELD_LEADER_COMPARISON_TEXT);
  }

  // The margin sentences are suppressed with the leader: "its lead has widened"
  // presupposes a lead, the pronoun makes it a claim ABOUT the option we just
  // declined to name, and the SHIFT is a claim about both runs at once — so a
  // single withheld side is enough to suppress it.
  //
  // ⚠ AND AN UNMATCHED IDENTITY SUPPRESSES THEM TOO, for a different reason
  // that lands in the same place. `margin_pp` is the winner's lead over the
  // runner-up WITHIN each run; the SHIFT between them is only a statement
  // about "its lead" if the two runs' winners are the same option. When we
  // cannot show that, "its lead has widened by about 20 percentage points"
  // silently attributes one option's lead to another — and the pronoun makes
  // it a continuity claim in the very branch that just declined to make one.
  if (!mayCompareLeaderIdentity) {
    // no margin sentence
  } else if (delta.margin_direction === 'widened') {
    parts.push(
      `Its lead has widened by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`,
    );
  } else if (delta.margin_direction === 'narrowed') {
    parts.push(
      `Its lead has narrowed by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`,
    );
  } else if (delta.margin_direction === 'unchanged') {
    parts.push('The size of its lead is essentially unchanged.');
  }

  if (delta.robustness_changed) {
    const now = bandPhrase(delta.current_band);
    const before = bandPhrase(delta.prior_band);
    if (now && before) {
      parts.push(`The result is now ${now}, where before it was ${before}.`);
    }
  }

  const mover = delta.driver_rank_changes[0];
  if (mover) {
    const moreInfluential = mover.to_rank < mover.from_rank;
    parts.push(
      `${mover.factor_label} now has ${moreInfluential ? 'more' : 'less'} influence on the outcome than before.`,
    );
  }

  // Fully-withheld turn on which nothing leader-free survived: the two runs
  // differed only in ordering and margin. `parts` is exactly the substituted
  // sentence, so say that outright rather than trailing an empty "here is what
  // else moved" into the follow-up prompt.
  //
  // The condition stays scoped to the BOTH-withheld branch, unchanged. The
  // mixed branches always emit two sentences, so they can never reach
  // `length === 1` — and they need no equivalent: each already states what it
  // could not show, which is the whole job this constant does.
  if (!mayNamePrior && !mayNameCurrent && parts.length === 1) {
    parts[0] = WITHHELD_NOTHING_ELSE_CHANGED_TEXT;
  }

  parts.push('If you want to test this further, ask what would change the result.');
  return parts.join(' ');
}

export function tryRunComparisonGate(
  input: RunComparisonGuardInput,
): RunComparisonGuardResult {
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }
  // Concrete edit instructions are never a comparison question.
  if (hasMutationSignal(message)) {
    return { matched: false, reason: 'mutation_signal' };
  }
  // F2 CHANGE B — a typed `what_changed` pill (`forceIntent`) has already
  // declared the intent; the free-text regex is skipped (it is for typed-chat
  // disambiguation only). The free-text path is unchanged.
  if (!input.forceIntent && classifyAnalyticalIntent(message) !== 'what_changed') {
    return { matched: false, reason: 'not_what_changed' };
  }

  // Freshness gate — FAIL-CLOSED (T4 Slice 3). Only a CONFIRMED-fresh verdict
  // may ground a confident prior/current comparison; every other verdict —
  // including `unknown` and an absent/unavailable authority — leads with a
  // re-run offer instead of comparison prose. Per the merged freshness policy
  // (Docs/t4/t4-spine-policy-v1.md): §1b unknown ⇒ hold/refuse; §1 authority
  // parity — never claim which analysis state is current; §5 acknowledge before
  // presenting. The exhaustive `switch` + `never` guard makes the fail-closed
  // posture structural: a future verdict cannot silently reach the comparison
  // path. An absent verdict (null/undefined) is authority-unavailable and is
  // treated as `unknown` (hold), never as an implicit pass.
  const verdict: RunComparisonFreshness = input.freshness ?? 'unknown';
  switch (verdict) {
    case 'none':
      // No analysis at all → decline so the no-analysis guard owns the turn
      // with its richer "nothing has run yet" guidance.
      return { matched: false, reason: 'no_runs' };
    case 'stale':
      // Hash diverged: the model is KNOWN to have changed after the latest run,
      // so the positive "has changed" claim is honest. Never present an old
      // comparison as the current model — lead with re-run guidance.
      return {
        matched: true,
        mode: 'stale',
        assistant_text: STALE_TEXT,
        suggested_actions: [RERUN_ACTION],
        leading_option_changed: null,
        leader_identity_basis: null,
      };
    case 'unknown':
      // Currency cannot be confirmed (legacy fact missing its run-time hash, an
      // unhashable current graph, or an absent authority). We must NOT assert
      // the model changed — we do not know that (§1 parity) — so offer an
      // unconfirmed-framed re-run rather than a confident comparison.
      return {
        matched: true,
        mode: 'unconfirmed',
        assistant_text: UNCONFIRMED_TEXT,
        suggested_actions: [RERUN_ACTION],
        leading_option_changed: null,
        leader_identity_basis: null,
      };
    case 'fresh':
      break; // confirmed current → the only verdict that may ground a comparison
    default: {
      // Compile-time exhaustiveness: adding a verdict without a branch above
      // fails to type-check here.
      const _exhaustive: never = verdict;
      void _exhaustive;
      // Runtime belt: an out-of-type value still fails closed to unconfirmed.
      return {
        matched: true,
        mode: 'unconfirmed',
        assistant_text: UNCONFIRMED_TEXT,
        suggested_actions: [RERUN_ACTION],
        leading_option_changed: null,
        leader_identity_basis: null,
      };
    }
  }

  // From here the verdict is CONFIRMED fresh.
  const pair = selectTwoNewestRunAnalysisFacts(input.priorFacts);
  if (!pair) {
    // Exactly one successful run — fresh, but nothing to compare yet.
    return {
      matched: true,
      mode: 'insufficient_runs',
      assistant_text: INSUFFICIENT_RUNS_TEXT,
      suggested_actions: [],
      leading_option_changed: null,
      leader_identity_basis: null,
    };
  }

  const prior = projectRunFact(pair.prior);
  const current = projectRunFact(pair.current);
  if (!prior || !current) {
    return {
      matched: true,
      mode: 'incomparable',
      assistant_text: INCOMPARABLE_TEXT,
      suggested_actions: [],
      leading_option_changed: null,
      leader_identity_basis: null,
    };
  }

  const delta = compareRuns(prior, current, input.interventionControlledFactorIds);
  if (!delta.comparable) {
    return {
      matched: true,
      mode: 'incomparable',
      assistant_text: INCOMPARABLE_TEXT,
      suggested_actions: [],
      leading_option_changed: null,
      leader_identity_basis: null,
    };
  }

  // ⭐ PER-RUN AUTHORISATION — the fix. Each compared run's leader is licensed
  // by THAT run's own persisted verdict, conjoined with the turn's.
  //
  // THE FACTS ARE THE ONES ALREADY SELECTED. `pair` came from
  // `selectTwoNewestRunAnalysisFacts` above — this gate's own long-standing
  // selection, which is what `prior`/`current` were projected from a few lines
  // up. Asking the SAME two facts what their verdicts said is a read, not a
  // derivation: there is no second selector call here, and
  // `readMayNameLeadingOptionVerdictForFact` is #730's one fact → one verdict
  // narrow, shared with the scenario-scoped reader (see its docstring for why
  // a second selection ceremony in THIS file is the defect and this is not).
  //
  // THE CONJUNCTION IS ONE-DIRECTIONAL. `input.mayNameLeadingOption` stays the
  // outer gate — it is the only input that can see `fail_closed_truncated`,
  // which no per-fact read can detect — and each per-run verdict can only
  // narrow it further. Every value is `<=` the pre-fix boolean, so a turn that
  // withheld still withholds and no leader becomes newly nameable.
  const authority: RunComparisonLeaderAuthority = {
    prior:
      input.mayNameLeadingOption
      && readMayNameLeadingOptionVerdictForFact(pair.prior).may_name_leading_option,
    current:
      input.mayNameLeadingOption
      && readMayNameLeadingOptionVerdictForFact(pair.current).may_name_leading_option,
  };

  return {
    matched: true,
    mode: 'compared',
    assistant_text: composeComparison(delta, authority),
    suggested_actions: [],
    // Deliberately NOT gated on `authority`. This field has exactly one
    // consumer — the `v5.run_comparison_gate` telemetry event in
    // `turn-executor.ts` — and never reaches the wire or any composer. It is
    // the factual delta between two persisted runs, and nulling it would blind
    // triage on precisely the turns where the withhold most needs observing.
    // The disclosure question is settled in `composeComparison`, which is the
    // only path to user-facing bytes.
    leading_option_changed: delta.leading_option_changed,
    leader_identity_basis: delta.leader_identity_basis,
  };
}
