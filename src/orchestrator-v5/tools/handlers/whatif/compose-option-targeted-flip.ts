/**
 * M1 (finish-line criterion 7) — ANSWER half of the option-targeted
 * counterfactual: say something true ABOUT the option the user named.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO FIRST-CLASS OUTCOMES, NOT ONE OUTCOME AND AN ERROR PATH.
 *
 *   addressed — at least one tested flip row names the target as the option
 *               that would lead once its factor crosses the tipping point.
 *   refused   — no tested flip row does. This is a REAL ANSWER to the question
 *               asked, composed here with the same care as the positive one. It
 *               is not a failure, not a fallback, and never silence.
 *
 * The refusal is the load-bearing half. "What would make X win?" when nothing
 * in the tested set makes X win is precisely the shape that invites a model to
 * invent a threshold, and a fabricated tipping point under this estate's trust
 * dressing is the guarantee-theatre class at its purest. So the deterministic
 * refusal OWNS that turn: it states exactly what was probed and exactly what was
 * not found, quotes no number, and offers an honest next step.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IDENTITY, NOT LABELS. Row selection is `alternative_winner_id === target.id`,
 * via `resolveAlternativeWinner`, which anchors on the id and refuses to hand
 * back PLoT's id-echo as a display name. The DISPLAY name printed in the prose
 * is the target's own GRAPH label — the words the user matched against — never
 * PLoT's `alternative_winner_label`, which `resolveLabel` echoes the raw option
 * id into when its lookup fails. Match on identity; display from the graph.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO THRESHOLD VALUE IN PROSE — deliberate, and inherited, not invented here.
 * `composeWhatWouldFlipFallback` already states the rule: the scale-safe
 * "Test X at N" number is surfaced by the flip-proposal chip, which honours the
 * PLoT `value_scale` contract (`Docs/v5/cee-plot-flip-value-scale-contract.md`)
 * and FAILS CLOSED on an ambiguous scale. Printing `flip_value` as prose here
 * would re-implement that inversion without its fail-closed branch and risk
 * misprinting a model-scale number as a user-scale one. We name the factor and
 * the direction of travel — both scale-free — and leave the number to the seam
 * that can render it safely.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WITHHELD-RUN SAFETY IS STRUCTURAL, NOT INCIDENTAL. Every string below is free
 * of the shared leader vocabulary (`compose/leading-option-egress-guard.ts`
 * `LEADER_CLAIM_PATTERNS`), and the module-load probe at the foot of this file
 * FAILS THE PROCESS if that ever stops being true — the same self-check
 * `withheld-explanation-answer.ts` and `constraint-gap-disclosure.ts` carry.
 *
 * That is not decoration. On a withheld run, `projectExplanationAnswerForWithheldClaim`
 * REPLACES the whole answer wholesale when it trips that vocabulary. The
 * existing generic flip prose opens "'…' currently leads, with a probability of
 * …" and therefore IS replaced on every withheld run — measured, not supposed.
 * A targeted answer that named the current leader would be destroyed the same
 * way and the user would never see the option they asked about. Naming the
 * COUNTERFACTUAL winner is explicitly permitted (the guard's key patterns are
 * `^`-anchored precisely so `alternative_winner_*` survives); naming or implying
 * the CURRENT leader is not. So these composers never read
 * `projection.leading_option` at all — they cannot make that claim, rather than
 * merely not making it today.
 */

import {
  resolveAlternativeWinner,
  type FlipEntry,
  type FlipSummary,
} from '../../../compose/flip-proposal.js';
import { textAssertsLeadingOption } from '../../../compose/leading-option-egress-guard.js';
import type { TargetOption } from './resolve-target-option.js';

/** Why the analysis cannot say what would put the result in the target's favour. */
export type OptionTargetedFlipRefusalReason =
  /** Real tipping points exist, but every one of them names a different option. */
  | 'no_flip_to_target'
  /** No single factor reached a tipping point at all within the tested ranges. */
  | 'no_practical_flip'
  /** Flip rows exist but isolate no tipping point, so there is no verdict. */
  | 'indeterminate';

/** Why the answer declines to place the target at all. */
export type PositionUnstatedReason =
  /** This turn's verdict withholds the leading option, so position is unsayable. */
  | 'withheld'
  /** The run recorded no unambiguous leader id, so we do not know. */
  | 'leader_unknown';

export type OptionTargetedFlipAnswer =
  | {
      readonly kind: 'addressed';
      readonly text: string;
      readonly target: TargetOption;
      /** Factor labels named in the prose, in the analysis's own order. */
      readonly factor_labels: readonly string[];
    }
  | {
      /**
       * The target IS the option currently leading. Only ever produced when the
       * turn's verdict PERMITS naming a leading option — this string asserts
       * one, deliberately and truthfully.
       */
      readonly kind: 'already_leading';
      readonly text: string;
      readonly target: TargetOption;
    }
  | {
      readonly kind: 'refused';
      readonly text: string;
      readonly target: TargetOption;
      readonly reason: OptionTargetedFlipRefusalReason;
    }
  | {
      /**
       * We may not, or cannot, say where the target stands — so we say neither
       * that it trails nor that it leads.
       */
      readonly kind: 'position_unstated';
      readonly text: string;
      readonly target: TargetOption;
      readonly reason: PositionUnstatedReason;
    };

/** How many levers the prose names. Matches the generic composer's cap. */
const NAMED_FACTOR_CAP = 2;

/**
 * Everything the answer needs to be both addressed AND honest about position.
 *
 * `leadingOptionId` and `mayNameLeadingOption` are threaded from the turn's own
 * derivations, never re-derived here (CLAUDE.md trap #12): the permission is the
 * turn-executor's hoisted `mayNameLeadingOptionForRun`, and the leader id comes
 * off the SAME `run_analysis` fact the flip rows did.
 */
export interface OptionTargetedFlipInput {
  readonly target: TargetOption;
  readonly flipSummary: FlipSummary | null | undefined;
  /** IDENTITY of the option currently leading; `null` ⇒ unknown, NOT "none". */
  readonly leadingOptionId: string | null | undefined;
  /** This turn's verdict. Absent/false ⇒ treated as WITHHOLDING (fail closed). */
  readonly mayNameLeadingOption?: boolean;
}

/**
 * The honest next step, shared by all three refusals. Suggests a direction to
 * explore; asserts nothing about whether it would work. "Two factors together
 * WOULD flip it" is a claim we have no evidence for and do not make.
 */
const REFUSAL_NEXT_STEP =
  ' Testing two or more factors together, or widening the range on one you can influence, would be the next thing to try.';

/**
 * Scale-free direction of travel. PLoT's `direction` vocabulary is not fully
 * pinned by contract (`increase`/`decrease` on the captured staging enrichment,
 * `raise`/`lower` in the what-if card composer), so this maps what it knows and
 * FAILS OPEN to the neutral phrasing on anything else. An unrecognised direction
 * costs one word of colour; guessing it would state the wrong direction of
 * travel, which is a false claim about the model.
 */
function describeFactorMove(entry: FlipEntry): string {
  const raw = typeof entry.direction === 'string' ? entry.direction.trim().toLowerCase() : '';
  if (raw === 'increase' || raw === 'increases' || raw === 'raise' || raw === 'up') {
    return `${entry.factor_label} rises past its tipping point`;
  }
  if (raw === 'decrease' || raw === 'decreases' || raw === 'lower' || raw === 'down') {
    return `${entry.factor_label} falls past its tipping point`;
  }
  return `${entry.factor_label} passes its tipping point`;
}

function composeRefusalText(target: TargetOption, reason: OptionTargetedFlipRefusalReason): string {
  switch (reason) {
    case 'no_flip_to_target':
      return (
        'Within the tested ranges, none of the single-factor changes the analysis probed would ' +
        `change this result in favour of ${target.label}.` +
        REFUSAL_NEXT_STEP
      );
    case 'no_practical_flip':
      return (
        'Within the tested ranges, the analysis found no single-factor tipping point at all, so ' +
        `nothing it probed would change this result in favour of ${target.label}.` +
        REFUSAL_NEXT_STEP
      );
    case 'indeterminate':
      return (
        'The analysis did not isolate a single-factor tipping point on this run, so it cannot say ' +
        `what would change this result in favour of ${target.label}. Running the analysis again, ` +
        'or widening the range on a factor you can influence, would give it more to work with.'
      );
  }
}

function composeAddressedText(
  target: TargetOption,
  named: readonly FlipEntry[],
  matchedCount: number,
): string {
  const moves = named.map(describeFactorMove);
  const condition = moves.length === 1 ? moves[0]! : `either ${moves[0]!}, or ${moves[1]!}`;

  // COMPLETENESS IS CLAIMED ONLY WHEN IT HOLDS. "the only" / "Those are" assert
  // that the named set is the whole set; the naming cap can truncate it, and an
  // exhaustiveness claim about a truncated set is false. So the quantifier is
  // derived from whether anything was dropped, never fixed by branch.
  const complete = matchedCount === named.length;
  const closing =
    matchedCount === 1
      ? `That is the only single-factor change the analysis found that would put this result in favour of ${target.label}, so it is the clearest one to test.`
      : `${complete ? 'Those are' : 'Those include'} the single-factor changes the analysis found that would put this result in favour of ${target.label}, so they are the clearest ones to test.`;

  return `${target.label} would lead instead if ${condition}. ${closing}`;
}

/**
 * The one string that DOES name a leading option, and may only be emitted when
 * the turn's verdict permits it.
 *
 * Without this branch, "what would make {the current leader} win?" fell through
 * to `no_flip_to_target` — because a flip row's `alternative_winner_id` is BY
 * CONSTRUCTION never the option already leading, so no row can ever name it.
 * The refusal was vacuously true and pragmatically false: it told the user that
 * nothing would put the result in favour of the option that had already won.
 */
function composeAlreadyLeadingText(target: TargetOption): string {
  return (
    `${target.label} is already the leading option on this analysis, so no single-factor change is ` +
    'needed to put it there. Would you like to see what could change that instead?'
  );
}

/**
 * Position-neutral copy: names the target, places it nowhere.
 *
 * ⚠ WHY THIS FIRES FOR EVERY UNMATCHED TARGET ON A WITHHELD RUN, not only when
 * the target happens to be the hidden leader. If the copy differed in that one
 * case, THE COPY ITSELF WOULD BE AN ORACLE: a user could name each option in
 * turn and read the leader off which one produced the different answer. The
 * whole point of the withheld verdict is that the leader is not derivable, so
 * every unmatched target must receive the SAME words. The branch is ambiguous
 * between "the target is the leader" and "nothing tested flips to the target",
 * and that ambiguity is the security property, not a vagueness to tidy up.
 *
 * The factor picture is likewise the GENERIC flip set, never the set filtered to
 * the target — a target-filtered picture is empty exactly when the target leads,
 * which would reintroduce the same oracle through the back door.
 */
function composePositionUnstatedText(
  target: TargetOption,
  reason: PositionUnstatedReason,
  flipSummary: FlipSummary,
): string {
  const opening =
    reason === 'withheld'
      ? // "put forward", never "recommend" / "lead" — the estate's existing
        // leader-free phrasing for exactly this state.
        `This analysis could not put a single option forward, so I cannot say where ${target.label} stands on it.`
      : `I cannot tell from what this run recorded where ${target.label} stands, so I would rather not guess.`;

  return `${opening} ${composeGenericFactorPicture(flipSummary)}`;
}

/** The position-neutral factor picture. Says which factors move, never who wins. */
function composeGenericFactorPicture(flipSummary: FlipSummary): string {
  if (flipSummary.overall_status === 'no_practical_flip') {
    return 'Within the tested ranges, the analysis found no single-factor tipping point at all.';
  }
  if (flipSummary.overall_status === 'insufficient_data') {
    return 'The analysis did not isolate a single-factor tipping point on this run.';
  }
  const named = flipSummary.entries
    .filter((e) => typeof e.flip_value === 'number' && Number.isFinite(e.flip_value))
    .slice(0, NAMED_FACTOR_CAP);
  if (named.length === 0) {
    return 'The analysis did not isolate a single-factor tipping point on this run.';
  }
  const labels = named.map((e) => e.factor_label);
  const list = labels.length === 1 ? labels[0]! : `${labels[0]!} and ${labels[1]!}`;
  return `What it can say is which factors move the result at all: ${list} reached a tipping point within the tested ranges, so those are the clearest ones to test.`;
}

/**
 * Answer the option-targeted counterfactual, or decline to take the turn.
 *
 * Returns `null` — and ONLY null — when there is no flip evidence to reason
 * from at all (`flipSummary` absent, or `overall_status === 'none'`). The caller
 * then leaves the existing behaviour byte-identical. Every other state produces
 * a typed answer, because every other state is one we can say something true
 * about.
 *
 * Pure. Never throws.
 */
export function composeOptionTargetedFlipAnswer(
  input: OptionTargetedFlipInput,
): OptionTargetedFlipAnswer | null {
  const { target, flipSummary, leadingOptionId } = input;
  // FAIL CLOSED on an unstated permission: a caller that did not populate it is
  // a caller whose verdict we cannot read, and "unknown" must never license copy
  // that presupposes where the target stands.
  const mayNameLeadingOption = input.mayNameLeadingOption === true;

  if (flipSummary == null || flipSummary.overall_status === 'none') return null;

  // ── 1. Does any TESTED row make the target lead? ─────────────────────────
  // Only 'concrete' can produce one. A row with no finite flip_value carries no
  // tipping point to describe, so it is not evidence for an addressed answer.
  const matched =
    flipSummary.overall_status === 'concrete'
      ? flipSummary.entries.filter((e) => {
          if (typeof e.flip_value !== 'number' || !Number.isFinite(e.flip_value)) return false;
          const winner = resolveAlternativeWinner(e);
          return winner !== null && winner.id === target.id;
        })
      : [];

  // ── 2. POSITION IS CHECKED BEFORE THE ROWS, because "has already won"
  //       outranks "would win if". A flip row's `alternative_winner_id` is by
  //       construction never the option already leading, so the two can only
  //       both be true on inconsistent data — and there `leading_option_id`,
  //       which records who actually won, is the authority. Answering "X would
  //       lead instead if …" about an X that already leads would be a new wrong
  //       answer in place of the old one.
  const leaderKnown =
    typeof leadingOptionId === 'string' && leadingOptionId.length > 0;

  if (leaderKnown && leadingOptionId === target.id) {
    // On a withheld run we hold the id but may not act on it in prose — so this
    // falls through to the SAME position-neutral copy every other unmatched
    // target gets. That identity of copy is the anti-oracle property.
    return mayNameLeadingOption
      ? { kind: 'already_leading', text: composeAlreadyLeadingText(target), target }
      : {
          kind: 'position_unstated',
          text: composePositionUnstatedText(target, 'withheld', flipSummary),
          target,
          reason: 'withheld',
        };
  }

  if (matched.length > 0) {
    // Naming the COUNTERFACTUAL winner is explicitly licensed on withheld runs
    // (the egress guard's key patterns are `^`-anchored precisely to preserve
    // `alternative_winner_*`), and a row naming the target proves the target is
    // not the current leader — so this branch is safe under either verdict.
    const named = matched.slice(0, NAMED_FACTOR_CAP);
    return {
      kind: 'addressed',
      text: composeAddressedText(target, named, matched.length),
      target,
      factor_labels: named.map((e) => e.factor_label),
    };
  }

  // ── 3. Nothing tested flips to the target, and the target is not the known
  //       leader. Say so only when we are entitled to place it at all.
  if (!mayNameLeadingOption) {
    // We may not say where anything stands, so we say nothing about it — for
    // EVERY unmatched target, so the copy cannot be read as an oracle for the
    // withheld leader. See composePositionUnstatedText.
    return {
      kind: 'position_unstated',
      text: composePositionUnstatedText(target, 'withheld', flipSummary),
      target,
      reason: 'withheld',
    };
  }

  if (!leaderKnown) {
    // Permitted to name a leader, but the run recorded none we can trust (a tie,
    // or a missing field). We cannot rule out that the target IS the leader, so
    // we decline to place it rather than guess.
    return {
      kind: 'position_unstated',
      text: composePositionUnstatedText(target, 'leader_unknown', flipSummary),
      target,
      reason: 'leader_unknown',
    };
  }

  // ── 4. The target is a real, named, non-leading option that nothing tested
  //       flips to. NOW the refusal is both true and honest.
  if (flipSummary.overall_status === 'no_practical_flip') {
    return {
      kind: 'refused',
      text: composeRefusalText(target, 'no_practical_flip'),
      target,
      reason: 'no_practical_flip',
    };
  }
  if (flipSummary.overall_status === 'insufficient_data') {
    return {
      kind: 'refused',
      text: composeRefusalText(target, 'indeterminate'),
      target,
      reason: 'indeterminate',
    };
  }
  return {
    kind: 'refused',
    text: composeRefusalText(target, 'no_flip_to_target'),
    target,
    reason: 'no_flip_to_target',
  };
}

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress.
 *
 * Drives BOTH composers over their whole branch space with a neutral target
 * label and asserts none of the output trips the shared leader vocabulary. A
 * copy edit that reached for "…would then be the best option" would fail the
 * process at import, in the same PR, rather than shipping an answer the withheld
 * gate silently replaces on every withheld run.
 *
 * SCOPE, STATED HONESTLY: this probes the TEMPLATES with a neutral label. It
 * cannot cover an option whose own LABEL contains leader vocabulary (a graph
 * with an option literally called "The Winner"), because that string is user
 * data, not copy. That exposure is pre-existing and shared with the #717
 * sentence in `explanation-fallback.ts`, which interpolates an option label into
 * prose the same way; it is not introduced here and is not closable at this
 * layer.
 */
function assertTargetedCopyIsLeaderFree(): void {
  const target: TargetOption = { id: 'opt_probe', label: 'Option B' };
  const entry = (direction: string | null): FlipEntry => ({
    factor_id: 'fac_probe',
    factor_label: 'Probe Factor',
    flip_value: 0.5,
    direction,
    unit: null,
    value_scale: 'model',
    flip_reason: null,
    margin_supports_flip: true,
    alternative_winner_id: 'opt_probe',
    alternative_winner_label: 'Option B',
  });

  const probes: Array<readonly [string, string]> = [];
  for (const reason of ['no_flip_to_target', 'no_practical_flip', 'indeterminate'] as const) {
    probes.push([`refusal:${reason}`, composeRefusalText(target, reason)]);
  }
  for (const direction of ['increase', 'decrease', 'sideways', null]) {
    const one = [entry(direction)];
    const two = [entry(direction), entry(direction)];
    probes.push([`addressed:one:${direction}`, composeAddressedText(target, one, 1)]);
    probes.push([`addressed:one-of-many:${direction}`, composeAddressedText(target, one, 3)]);
    probes.push([`addressed:two:${direction}`, composeAddressedText(target, two, 2)]);
    probes.push([`addressed:two-of-many:${direction}`, composeAddressedText(target, two, 5)]);
  }
  // The position-unstated family is what a WITHHELD run actually ships, so it is
  // the branch this probe most needs to cover.
  for (const status of ['concrete', 'no_practical_flip', 'insufficient_data'] as const) {
    const summary: FlipSummary = {
      overall_status: status,
      margin_supports_flip: true,
      entries: [entry('increase'), entry('decrease')],
    };
    for (const reason of ['withheld', 'leader_unknown'] as const) {
      probes.push([
        `position_unstated:${reason}:${status}`,
        composePositionUnstatedText(target, reason, summary),
      ]);
    }
  }

  for (const [name, copy] of probes) {
    if (textAssertsLeadingOption(copy)) {
      throw new Error(
        `compose-option-targeted-flip: copy ${name} trips the shared leader vocabulary ` +
          '(compose/leading-option-egress-guard.ts LEADER_CLAIM_PATTERNS). On a withheld ' +
          'run projectExplanationAnswerForWithheldClaim would REPLACE this answer wholesale ' +
          'and the user would never see the option they asked about. Reword the copy — do ' +
          'not narrow the pattern set, which is shared with the alarm.',
      );
    }
  }

  // ── THE INVERSE PROBE, and it is a safety property rather than a style one.
  //
  // `already_leading` is the one string here that DOES assert a leading option.
  // That is correct: it is only reachable when the turn's verdict permits it. If
  // it were ever emitted on a withheld run, the withheld gate is the backstop
  // that replaces it — but only if the gate can SEE it. A reword that made this
  // sentence invisible to the vocabulary ("X is out in front already") would
  // remove the backstop silently, which is the `performs best` hole exactly.
  const leaderCopy = composeAlreadyLeadingText(target);
  if (!textAssertsLeadingOption(leaderCopy)) {
    throw new Error(
      'compose-option-targeted-flip: the already_leading copy no longer trips the shared ' +
        'leader vocabulary. That copy names a leading option by design and is licensed only ' +
        'by a PERMITTING verdict; the withheld gate is its backstop, and a string the gate ' +
        'cannot see has no backstop. Keep the claim explicit — do not make it invisible.',
    );
  }
}
assertTargetedCopyIsLeaderFree();
