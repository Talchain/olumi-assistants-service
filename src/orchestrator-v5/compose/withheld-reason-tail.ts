/**
 * ROADMAP 2.104 — the withheld REASON, as an appendable tail.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DIFFERENTIATOR IS ONLY CREDIBLE IF THE PRODUCT CAN SAY WHY IT WITHHELD.
 *
 * Live, 28 Jul (Codex journey): on a withheld run the user asked why no option
 * had been put forward and the turn answered "open the latest recap". The
 * reason existed server-side the whole time — the persisted
 * `constraint_verdict_state` and the ratified conditions it is about — and the
 * turn deflected to a surface that does not contain it either.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THERE WAS A RECOGNISER HERE. IT WAS DELETED, AND THE REASON MUST OUTLIVE IT
 * — DO NOT REBUILD ONE.
 *
 * The first three revisions paired this copy with a regex recogniser for the
 * question "why is there no option?", and short-circuited the turn when it
 * matched. Three adversarial rounds found three INDEPENDENT over-capture axes,
 * and the third is not an axis but a ceiling:
 *
 *   G1 — closure under negation, applied to five known false positives:
 *        10/10 still over-captured.
 *   G2 — append a restrictive modifier ("… to do nothing", "… in my model",
 *        "… called Hold"), applied to the five TRUE POSITIVES:
 *        35/35 over-captured.
 *
 * G2 is the finding that ended the approach. "No X is being put forward" and
 * "no X exists in my graph" HAVE THE SAME SURFACE FORM. "Why is there no
 * option?" and "Why is there no option to do nothing?" differ by four words and
 * are different questions — one about a withheld recommendation, one about a
 * missing node. The distinguishing information is not in the sentence at all;
 * it is in what the user is looking at. No pattern over the message text can
 * recover it, so no recogniser can be made precise, so precision must not be
 * load-bearing.
 *
 * And G1 would never have found G2: the mechanical rule proposed to close the
 * class was itself specific to the axis its author had imagined — the same
 * defect one level up.
 *
 * ⚠ WHAT REPLACED IT — AND THE SCOPE THIS PR ACTUALLY SHIPS, STATED EXACTLY.
 *
 * SHIPPED HERE: this tail is total over the withholding states, and the
 * per-handler gate (`projectExplanationAnswerForWithheldClaim`) consumes it. That
 * closes the defect 2.104 was raised for on the EXPLANATION path:
 * `buildConstraintDisclosureFromState` returns '' for `evaluated_infeasible` by
 * design and gave nothing for an unreadable state, so `disclosure.length > 0`
 * was false, the APPEND branch could not fire, and those turns carried NO REASON
 * AT ALL. Only REPLACE spoke, and only when the answer happened to trip the
 * leader vocabulary.
 *
 * ⚠ NOT SHIPPED, AND ROWED RATHER THAN HALF-BUILT: making every OTHER exit carry
 * the reason. A finaliser hook was built for that and then withdrawn, because an
 * adversarial review showed it was wrong in BOTH directions and neither could be
 * fixed cleanly in the same pass:
 *
 *   OVER-REACH — the finaliser is where all 40 `buildFailureResponse` sites and
 *   every clarify exit land, and the hook's content predicate was "an analysis
 *   exists and is fresh", not "this turn displays it". A CAS failure or a
 *   clarifying question would have shipped "…so no option can be put forward
 *   yet. Relax that limit…". This lane OBSERVED that and re-baselined a
 *   bounded-recovery test to accept it — normalising the defect instead of
 *   reading it. That re-baseline is reverted.
 *
 *   UNDER-REACH — "a finaliser hook cannot miss an emit path" was FALSE at the
 *   bytes. `handlers/chip-click-dispatch.ts` composes and returns its own
 *   response and never enters the turn executor, and
 *   `DETERMINISTIC_CHIP_ACTION_TYPES` contains `run_analysis` — so the UI's
 *   PRIMARY Run-analysis affordance was exactly the path with no tail, on
 *   `evaluated_infeasible`, which is 2.104's own state.
 *   `system-events/factor-value-edit.ts` is a second bypass.
 *
 * The correct shape for that work is the precedent the estate already set for
 * the sibling guard — duplicate it into `chip-click-dispatch.ts` (which already
 * computes `mayNameLeadingOption`) — plus a "this turn DISPLAYS the analysis"
 * predicate and post-handler readiness. That is its own change with its own
 * controls, and it is rowed, not smuggled in here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE BRIEF'S PREMISE FOR `evaluated_infeasible` IS WRONG, AND THE COPY IS
 * WRITTEN AGAINST THE CODE RATHER THAN AGAINST THE BRIEF.
 *
 * The dispatch described this state as "no option satisfies the constraints".
 * `deriveWinnerConstraintInfeasibility` says otherwise, in its own words:
 * "Only the winner is evaluated, so a feasible leader is never flagged because
 * a DIFFERENT option is infeasible". The state means: THE option this result
 * would otherwise have put forward does not stand up against a limit that WAS
 * checked. Other options may satisfy it perfectly well — nothing here tested
 * them. Copy asserting "no option satisfies your condition" would be a false
 * claim about every option the analysis never gated on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE EVIDENCE CEILING, DERIVED FROM WHAT IS PERSISTED — NOT ASSUMED.
 *
 * `PersistedClaimSafety` (constraint-feasibility.ts) stores exactly two fields:
 * `may_name_leading_option` and `constraint_verdict_state`. `constraints` and
 * `leaderInfeasibility` are deliberately NOT persisted ("a second copy of a
 * label is a second thing to drift"). A turn that merely NARRATES an earlier
 * analysis therefore cannot know:
 *
 *   - WHICH ratified condition the result fell short on. So this composer names
 *     a condition ONLY when the user ratified exactly one — where it is the
 *     only candidate and naming it is sound — and otherwise says, in as many
 *     words, that which one is not recorded. That discipline deliberately
 *     DIFFERS from `constraint-gap-disclosure.ts`, which names up to three
 *     labels in its plural form: there, every listed condition genuinely is
 *     unevaluated, so the list is the claim. Here only one of them failed, so a
 *     list would assert something about the others that is not known.
 *
 *   - WHICH CRITERION fired. `WinnerConstraintFeasibility.kind` discriminates
 *     `hard_violation` ("does not satisfy the constraint" is definitionally
 *     supported) from `joint_tension` ("copy must say 'in tension with', never
 *     'does not satisfy'"), and it is not persisted either. The two are
 *     indistinguishable at read-back, so this copy takes the WEAKER claim that
 *     is true under both — "does not stand up against" — and never the binary
 *     satisfaction claim only one of them licenses. A composer that reached for
 *     the stronger sentence would be right about half its turns and asserting a
 *     proven violation on the rest.
 *
 * NOT RE-DERIVED, on purpose. Both facts ARE recoverable by re-running
 * `deriveWinnerConstraintInfeasibility` over the persisted envelope — and doing
 * so would be a second derivation of a meaning that has exactly one owner
 * (CLAUDE.md trap #12), and would require reading the run's leading option id
 * on the one turn shape where reading it is most dangerous. The residual is
 * recorded here rather than closed by a shortcut: if this answer needs to name
 * the failing condition on a multi-condition scenario, the fix is to PERSIST
 * the verdict's `constraintId` and `kind`, at the single stamp site, and read
 * them here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COPY IS REUSED, NOT MINTED, WHEREVER IT EXISTS.
 *
 * `unevaluated` and `identity_unresolved` already have exact, egress-survived
 * copy in `coaching/constraint-gap-disclosure.ts`, whose two voices were got
 * wrong twice before they were got right ("pairing the wrong sentence with the
 * state is the mistake both earlier revisions of this fix made"). This module
 * calls `buildConstraintDisclosureFromState` rather than restating either. A
 * second near-copy of that pairing is precisely the drift the sibling module's
 * docstring exists to prevent.
 *
 * `evaluated_infeasible` has no read-back copy anywhere — the disclosure
 * builder returns `''` for it and says why: its copy "lives in the coach's
 * compact-summary note and the decision-review winner flag ... which can name
 * the constraint and the margin". Neither is available on a narrating turn, and
 * the compact-summary note NAMES THE WINNING OPTION, which this answer may not.
 * So that voice is genuinely new, and it is the only new copy here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO LEADER, EVER — AND NO ORACLE. Not one string below reads, names or implies
 * a leading option, and the module-load probe at the foot of this file fails the
 * process if that stops being true. Two independent reasons, both binding:
 *
 *   1. `projectExplanationAnswerForWithheldClaim` REPLACES a withheld answer
 *      wholesale when it trips the shared vocabulary. Copy that tripped it would
 *      be destroyed on exactly the turns it was written for.
 *   2. The #743 ORACLE lesson. Copy whose SHAPE varies with any option's hidden
 *      position lets a user read the withheld position off the difference. This
 *      answer's shape varies only with the VERDICT STATE and the RATIFIED
 *      CONDITION COUNT — both properties of the scenario, neither a property of
 *      any option — so there is nothing to probe for.
 *
 * PURE. Never throws, never mutates its input.
 */

import { textNamesLeadingOption } from './leading-option-egress-guard.js';
import { buildConstraintDisclosureFromState } from '../coaching/constraint-gap-disclosure.js';
import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
import {
  MAY_NAME_LEADING_OPTION,
  type ConstraintVerdictState,
  type RatifiedConstraint,
} from '../../orchestrator/context/constraint-feasibility.js';

/**
 * Which honest account this answer gives. Bounded — this is the telemetry
 * cardinality, and it maps one-to-one onto the persisted verdict states that
 * withhold, plus the unreadable case.
 */
export type WithheldReasonKind =
  | 'constraint_infeasible'
  | 'constraint_unevaluated'
  | 'constraint_unresolved'
  | 'reason_unrecorded';

export interface WithheldReasonTail {
  readonly kind: WithheldReasonKind;
  /**
   * A LEADING-SPACE-PREFIXED FRAGMENT, so it concatenates onto an existing
   * answer exactly as `buildConstraintDisclosureFromState`'s output does. That
   * shared contract is what lets the two be used interchangeably at the append
   * seam, and what makes the idempotence check (`includes(tail.trim())`) work
   * for both without knowing which produced the bytes.
   */
  readonly text: string;
  /**
   * How many ratified conditions the answer was composed over. Structural only
   * — a count, never a label — so telemetry can show which shape shipped
   * without carrying user content.
   */
  readonly ratified_constraint_count: number;
  /** True when the answer quotes a condition label. Only ever the count === 1 shape. */
  readonly named_constraint: boolean;
}

/**
 * Longest condition label this answer will quote. Same bound, and the same
 * reason, as `CONSTRAINT_GAP_LABEL_MAX_CHARS`: an unbounded user label pushes
 * the composed answer past readable length, and `sanitiseLabel` imposes none.
 * A label over the bound degrades to the count-only shape rather than being
 * truncated mid-word or dropped along with the whole answer.
 */
const WHY_LABEL_MAX_CHARS = 60;

/**
 * Shared closing clause. Held in one constant so the voices cannot drift apart
 * on the part that states the CONSEQUENCE, and deliberately the SAME words the
 * sibling disclosure ends on (`constraint-gap-disclosure.ts`
 * `consequenceSentence`): "put forward", never "recommend*", which
 * `LEADER_CLAIM_PATTERNS` bans outright and blunt to negation by design.
 */
const NO_OPTION_YET = 'so no option can be put forward yet';

function quoted(label: string): string {
  return `“${label}”`;
}

/**
 * The ONE label to quote, or `null` when quoting any would assert more than is
 * known.
 *
 * Returns a label only when exactly one condition was ratified. With two or
 * more, which of them the result fell short on is not recorded (see the module
 * docstring's evidence ceiling), and quoting all of them would say each failed.
 */
function soleLabel(constraints: readonly RatifiedConstraint[]): string | null {
  if (constraints.length !== 1) return null;
  const only = constraints[0]!;
  if (only.label === null) return null;
  const clean = sanitiseLabel(only.label, only.constraint_id);
  if (clean === null || clean.length === 0 || clean.length > WHY_LABEL_MAX_CHARS) {
    return null;
  }
  return clean;
}

/**
 * The `evaluated_infeasible` voice — the only new copy in this module.
 *
 * Three shapes, selected by how many conditions the user ratified, because that
 * is the only thing that changes what can honestly be said:
 *
 *   1 ratified   the failing condition is the only candidate, so name it.
 *   N ratified   name none; say which one is not recorded, and say the count.
 *   0 ratified   reachable — `deriveConstraintVerdict` returns this state on
 *                `ratified.length === 0` when the producer's OWN scoring shows
 *                the result breaking a limit. There is no user condition to
 *                name, and copy that invented one would be the fabricated-cause
 *                defect again.
 *
 * "does not stand up against" is chosen over "does not satisfy": see the
 * evidence ceiling — `hard_violation` and `joint_tension` are indistinguishable
 * here and only the first licenses a satisfaction claim.
 */
function composeInfeasibleText(
  constraints: readonly RatifiedConstraint[],
  label: string | null,
): string {
  if (constraints.length === 0) {
    return (
      ` This result was checked against the limits in your model, and the option it would ` +
      `otherwise have put forward does not stand up against one of them, ${NO_OPTION_YET}. ` +
      'Set out the condition you want met, and run the analysis again.'
    );
  }

  if (label !== null) {
    return (
      ` The condition you set was checked on this run: ${quoted(label)}. The option this ` +
      `result would otherwise have put forward does not stand up against it, ${NO_OPTION_YET}. ` +
      'Relax that limit, or bring in an option that can meet it, and run the analysis again.'
    );
  }

  const plural = constraints.length === 1 ? 'condition' : 'conditions';
  const count = constraints.length === 1 ? 'The' : `All ${constraints.length}`;
  return (
    ` ${count} ${plural} you set were checked on this run, and the option this result would ` +
    `otherwise have put forward does not stand up against one of them, ${NO_OPTION_YET}. ` +
    'Which one that is has not been recorded on this result. Relax the limits, or bring in ' +
    'an option that can meet them, and run the analysis again.'
  );
}

/**
 * The `unevaluated` / `identity_unresolved` voices, when the ratified
 * conditions could not be read back at all.
 *
 * Reachable even though `deriveConstraintVerdict` only ever selects these two
 * states with at least one ratified condition: the labels are re-read on THIS
 * turn from the persisted graph, and a condition deleted since the run leaves
 * the state behind with nothing to name. The disclosure builder returns `''`
 * for an empty list, which would leave the opening sentence answering nothing.
 *
 * Says the same thing its labelled sibling says, minus the part it cannot.
 */
function composeUnlabelledStateText(
  state: 'unevaluated' | 'identity_unresolved',
): string {
  if (state === 'unevaluated') {
    // ⚠ ROADMAP 2.653 (I-C) — the SAME two claims withdrawn here as in
    // `coaching/constraint-gap-disclosure.ts`, because this is the second
    // surface that speaks the `unevaluated` voice and a user can reach either
    // one. Fixing only the primary message would have left the identical
    // authorship claim ("a condition you set") and the identical units
    // prescription reachable on the tail — the half-done fix that leaves the
    // defect witnessable on the next walk.
    return (
      ` A limit on your model could not be checked against it on this run, ` +
      `${NO_OPTION_YET}. Tell me the limit you meant in your own words and I will record it; ` +
      'this one stays on the model. Then run the analysis again.'
    );
  }
  return (
    ' The analysis engine returned condition results that could not be matched to the ' +
    `conditions you set, so it cannot be confirmed whether they were checked, and ` +
    `${NO_OPTION_YET}. Re-state the conditions and run the analysis again.`
  );
}

/**
 * The `reason_unrecorded` voice — the fail-closed one.
 *
 * `readMayNameLeadingOptionFromResult` withholds on any fact carrying neither
 * the typed verdict nor the interim stamp, and there is no migration. On those
 * turns the withholding is correct and the CAUSE is genuinely unknown. This
 * says so. It does not reach for the ratified-condition voice, which would tell
 * the user a condition of theirs failed on a scenario that may have ratified
 * none — the exact correctness defect F2 fixed in `withheld-leader-projection.ts`.
 */
const REASON_UNRECORDED_TEXT =
  ` No single option can be put forward on this result yet, and the reason is not ` +
  'recorded on it, so I will not guess at one. Run the analysis again and it will be ' +
  'recorded, and I can tell you then.';

/**
 * Compose the honest answer to "why is there no option?".
 *
 * THE CALLER OWNS THE PERMISSION. This function assumes
 * `may_name_leading_option === false` and does not re-derive it, so the
 * permission and the explanation describe the same analysis (CLAUDE.md trap
 * #12) — the same contract `projectExplanationAnswerForWithheldClaim` states.
 *
 * Returns `null` for the two PERMITTING states. They cannot be reached through
 * a correct caller, and if a future one does reach here the honest response is
 * to decline the turn and leave the existing routing byte-identical — never to
 * explain a withholding that did not happen.
 *
 * @param state       the persisted verdict state, or `null` when unreadable.
 * @param constraints the ratified conditions, read from the same persisted
 *                    `goal_constraints` the original derivation read
 *                    (`readRatifiedConstraints`).
 */
export function composeWithheldReasonTail(
  state: ConstraintVerdictState | null,
  constraints: readonly RatifiedConstraint[],
): WithheldReasonTail | null {
  const ratified = Array.isArray(constraints) ? constraints : [];

  if (state === null) {
    return {
      kind: 'reason_unrecorded',
      text: REASON_UNRECORDED_TEXT,
      ratified_constraint_count: ratified.length,
      named_constraint: false,
    };
  }

  switch (state) {
    case 'not_applicable':
    case 'evaluated_feasible':
      // Permitting states. Not our turn — see the docstring.
      return null;

    case 'evaluated_infeasible': {
      const label = soleLabel(ratified);
      return {
        kind: 'constraint_infeasible',
        text: composeInfeasibleText(ratified, label),
        ratified_constraint_count: ratified.length,
        named_constraint: label !== null,
      };
    }

    case 'unevaluated':
    case 'identity_unresolved': {
      // REUSED, not restated — the two voices this estate already got right.
      const disclosure = buildConstraintDisclosureFromState(state, ratified);
      const kind =
        state === 'unevaluated' ? 'constraint_unevaluated' : 'constraint_unresolved';
      if (disclosure.length === 0) {
        return {
          kind,
          text: composeUnlabelledStateText(state),
          ratified_constraint_count: ratified.length,
          named_constraint: false,
        };
      }
      // Shipped VERBATIM. The sibling's fragment is already a leading-space
      // tail with its own consequence clause and repair step, so wrapping it
      // would be a second account of one fact — and re-stating it would be the
      // near-copy drift that module's docstring exists to prevent.
      return {
        kind,
        text: disclosure,
        ratified_constraint_count: ratified.length,
        // The builder quotes labels only when they survive its own egress
        // probe; `includes('“')` reads the shipped bytes rather than
        // re-deriving that decision here.
        named_constraint: disclosure.includes('“'),
      };
    }
  }
}

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress.
 *
 * Drives every voice over its whole branch space and fails the PROCESS if any
 * output trips the shared leader vocabulary. Without it, a copy edit reaching
 * for the natural word ("…the option that leads does not clear it") would ship
 * an answer `projectExplanationAnswerForWithheldClaim` replaces wholesale on
 * every withheld turn, and the only symptom would be a telemetry rate nobody
 * had a reason to look at.
 *
 * `textNamesLeadingOption` (the ALARM's wide reader), never
 * `textAssertsLeadingOption` (the ENFORCER's, which blanks documented
 * false-positive spans first) — the doctrine `withheld-leader-projection.ts`
 * settled: there is no reason to hold our own copy to a laxer bar than the
 * instrument that measures it.
 *
 * ⭐ DERIVED FROM THE CANONICAL STATE MAP, NOT HAND-LISTED — and it says so
 * because it now IS so. ROADMAP 2.579.
 *
 * ⚠ THIS COMMENT USED TO CLAIM THE DERIVATION WHILE THE CODE BELOW HELD A PLAIN
 * ARRAY LITERAL OF SIX HAND-TYPED VALUES, and it named a function
 * (`composeWithheldWhyAnswer`) that does not exist anywhere in the repo. Both
 * halves of its promise were false in the way that matters: the list is typed
 * `ConstraintVerdictState | null`, so a SIXTH state is perfectly assignable and
 * its ABSENCE is not a type error — meaning the loop DID silently skip a new
 * state's voice, the exact opposite of what was written. CLAUDE.md trap 12 (the
 * hand-maintained mirror) wearing trap 14's clothes (an honest label overwritten
 * by a false one), in the same six lines. Its two siblings had already been
 * converted and this one was missed:
 * `withheld-explanation-answer.ts` and `withheld-leader-projection.ts` both
 * drive `Object.keys(MAY_NAME_LEADING_OPTION)`, and the first one's own comment
 * records this drift happening once before — "a hand-list would have left the
 * two NEW voices ... unprobed".
 *
 * WHAT THE DERIVATION BUYS, precisely: driving every state DECLARED IN THE
 * CANONICAL MAP proves the switch is TOTAL **over the states that actually
 * exist**, so a new state arrives as a compile error at the switch and — failing
 * that, e.g. a state reaching us across the schema boundary — as a LOUD,
 * NAMED import failure rather than an unprobed voice. Note what it still cannot
 * do (CLAUDE.md trap 12d): derivation proves the probe AGREES with the map, never
 * that the map is COMPLETE. That is `MAY_NAME_LEADING_OPTION`'s own problem, and
 * its `Record` key type is what guards it.
 */
function assertTailCopyIsLeaderFree(): void {
  const one: readonly RatifiedConstraint[] = [
    { constraint_id: 'c1', label: 'Three-Year Total Cost of Ownership' },
  ];
  const unlabelled: readonly RatifiedConstraint[] = [{ constraint_id: 'c1', label: null }];
  const many: readonly RatifiedConstraint[] = [
    { constraint_id: 'c1', label: 'Three-Year Total Cost of Ownership' },
    { constraint_id: 'c2', label: 'Delivery within two quarters' },
  ];
  const states: ReadonlyArray<ConstraintVerdictState | null> = [
    null,
    ...(Object.keys(MAY_NAME_LEADING_OPTION) as ConstraintVerdictState[]),
  ];

  const probes: Array<readonly [string, string]> = [];
  for (const state of states) {
    for (const [shape, constraints] of [
      ['none', [] as readonly RatifiedConstraint[]],
      ['one', one],
      ['one-unlabelled', unlabelled],
      ['many', many],
    ] as const) {
      // ⚠ WIDENED TO INCLUDE `undefined` DELIBERATELY, and the widening is the
      // whole guard. A declared state with NO `case` falls off the end of
      // `composeWithheldReasonTail`'s switch and returns `undefined` — which is
      // NOT `null`, so the `continue` below would not catch it and
      // `answer.text` would throw a bare `TypeError` naming nothing. TypeScript
      // makes this branch unreachable for the states it can see, which is
      // exactly why it must be checked at RUNTIME: the states it cannot see —
      // one arriving across the `@talchain/schemas` boundary, or added to the
      // contract ahead of this switch — are the only ones that can get here.
      const answer: WithheldReasonTail | null | undefined = composeWithheldReasonTail(
        state,
        constraints,
      );
      if (answer === undefined) {
        throw new Error(
          `withheld-reason-tail: the declared constraint verdict state ` +
            `'${String(state)}' has no voice — composeWithheldReasonTail's switch ` +
            `returned undefined for it. Every state in MAY_NAME_LEADING_OPTION must ` +
            `either return null (a PERMITTING state, which needs no tail) or a ` +
            `WithheldReasonTail. Add a case to composeWithheldReasonTail for ` +
            `'${String(state)}'. Do not remove it from the probe: a voice that ships ` +
            `unprobed is one textNamesLeadingOption never sees, and ` +
            `projectExplanationAnswerForWithheldClaim would then replace the whole ` +
            `answer on every withheld turn with no symptom but a telemetry rate.`,
        );
      }
      if (answer === null) continue;
      probes.push([`${state ?? 'null'}:${shape}`, answer.text]);
    }
  }
  // Both unlabelled-state voices are reachable only through a read-back with no
  // constraints, which the loop above covers — but probe them directly too, so
  // deleting that branch's only caller cannot silently un-probe the copy.
  // Every tail must be a LEADING-SPACE fragment — the contract the append seam
  // and the idempotence check both rely on. Checked here rather than in a test
  // so a voice that forgot it fails at import, where it cannot be missed.
  for (const [name, copy] of probes) {
    if (!copy.startsWith(' ')) {
      throw new Error(
        `withheld-reason-tail: voice ${name} is not a leading-space fragment. The append ` +
          'seam concatenates it directly onto an existing answer, so a missing leading ' +
          'space runs it into the previous sentence.',
      );
    }
  }
  probes.push(['unlabelled:unevaluated', composeUnlabelledStateText('unevaluated')]);
  probes.push(['unlabelled:identity_unresolved', composeUnlabelledStateText('identity_unresolved')]);

  for (const [name, copy] of probes) {
    if (textNamesLeadingOption(copy)) {
      throw new Error(
        `withheld-reason-tail: copy ${name} trips the shared leader vocabulary ` +
          '(compose/leading-option-egress-guard.ts LEADER_CLAIM_PATTERNS). This answer ' +
          'ships only on turns whose verdict WITHHOLDS, where ' +
          'projectExplanationAnswerForWithheldClaim would replace it wholesale and the ' +
          'user would be deflected all over again. Reword the copy — do not narrow the ' +
          'pattern set, which is shared with the alarm.',
      );
    }
  }
}
assertTailCopyIsLeaderFree();
