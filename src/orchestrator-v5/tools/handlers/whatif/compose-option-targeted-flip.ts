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

export type OptionTargetedFlipAnswer =
  | {
      readonly kind: 'addressed';
      readonly text: string;
      readonly target: TargetOption;
      /** Factor labels named in the prose, in the analysis's own order. */
      readonly factor_labels: readonly string[];
    }
  | {
      readonly kind: 'refused';
      readonly text: string;
      readonly target: TargetOption;
      readonly reason: OptionTargetedFlipRefusalReason;
    };

/** How many levers the prose names. Matches the generic composer's cap. */
const NAMED_FACTOR_CAP = 2;

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

  // "the only" is a completeness claim, so it is made ONLY when the matched set
  // really is a single row. With more matches than we name, the prose says what
  // it can see and claims no exhaustiveness.
  const closing =
    matchedCount === 1
      ? `That is the only single-factor change the analysis found that would put this result in favour of ${target.label}, so it is the clearest one to test.`
      : `Those are the single-factor changes the analysis found that would put this result in favour of ${target.label}, so they are the clearest ones to test.`;

  return `${target.label} would lead instead if ${condition}. ${closing}`;
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
  target: TargetOption,
  flipSummary: FlipSummary | null | undefined,
): OptionTargetedFlipAnswer | null {
  if (flipSummary == null || flipSummary.overall_status === 'none') return null;

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

  // 'concrete' — real tipping points exist. Select the rows that name THIS
  // target, by IDENTITY. A row with no finite flip_value carries no tipping
  // point to describe, so it is not evidence for an addressed answer.
  const matched = flipSummary.entries.filter((e) => {
    if (typeof e.flip_value !== 'number' || !Number.isFinite(e.flip_value)) return false;
    const winner = resolveAlternativeWinner(e);
    return winner !== null && winner.id === target.id;
  });

  if (matched.length === 0) {
    return {
      kind: 'refused',
      text: composeRefusalText(target, 'no_flip_to_target'),
      target,
      reason: 'no_flip_to_target',
    };
  }

  const named = matched.slice(0, NAMED_FACTOR_CAP);
  return {
    kind: 'addressed',
    text: composeAddressedText(target, named, matched.length),
    target,
    factor_labels: named.map((e) => e.factor_label),
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
}
assertTargetedCopyIsLeaderFree();
