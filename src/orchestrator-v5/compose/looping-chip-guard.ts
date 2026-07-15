/**
 * V5 looping-chip guard — the no-dead-end invariant.
 *
 * THE INVARIANT
 *   A chip that re-submits the user's own message verbatim must never reach
 *   the wire. Clicking it reproduces the turn that offered it, which
 *   reproduces the chip: a loop the user cannot escape.
 *
 * The degenerate case is a clarifier whose candidate list is a single option
 * identical to what the user just typed — "I wasn't sure which factor you
 * meant. Did you mean Key Talent Attrition?" in answer to "Set Key Talent
 * Attrition to 0.8." That is a tautology, not a question: the only offered
 * answer is the input. Live on staging f31e3852 (scenario 906d6aff…,
 * 2026-07-15), where the chip's replay message was BYTE-IDENTICAL to the
 * message the user had just sent.
 *
 * WHY HERE
 *   This runs at `sanitiseOlumiResponseForEgress` — the single V5 egress
 *   chokepoint that every response from every dispatch path passes through.
 *   The specific defect above is fixed at its own boundary (the value-update
 *   kind gate now emits an honest refusal rather than a bogus clarify), but
 *   the loop SHAPE is not unique to that site: `deterministic-value-update.ts`
 *   documents a second, independently-discovered instance of the same class
 *   (the option-intervention "disambiguator loop the user can never escape",
 *   SkipReason 'option_intervention_edit'). Per-site patching has already
 *   leaked twice, so the guard lives where a NEW clarifier site is covered by
 *   default — its author does not have to know this rule exists.
 *
 * WHY `userMessage` IS REQUIRED, NOT OPTIONAL
 *   Same reasoning as `EgressSanitiseOpts.exitPath`: an optional field is a
 *   field a future caller silently forgets, and a guard that silently
 *   no-ops is the guarantee-theatre defect class. Required means the type
 *   checker enforces threading at every call site. `null` is the honest
 *   value for a turn with no user message (system events), and it disables
 *   the guard explicitly rather than by omission.
 *
 * SCOPE — DELIBERATELY NARROW. Two conditions, both structural:
 *
 *   1. The chip carries NO `action_type`. Such a chip is a PURE TEXT REPLAY:
 *      per the composer contract (`edit-clarify-response.ts`) its click
 *      "re-submits as a fresh user turn and routes normally" — identical text
 *      through identical routing, hence provably the identical turn. A chip
 *      WITH an `action_type` is exempt even when its message matches: it
 *      routes down the chip_click path carrying a pending action, so it does
 *      NOT reproduce the turn and may legitimately echo the user's phrasing
 *      (e.g. user types "Run the analysis", we offer an executable
 *      `run_analysis` chip).
 *   2. The chip's `message` is normalised-equal to the user's message.
 *
 * NOT a semantic similarity check, NOT a prose regex, and it never inspects
 * `label` — only the machine-consequential `message` field, because the
 * message is what a click actually re-submits. Two chips that look alike but
 * replay different text are both kept.
 *
 * Pure. No I/O beyond a structured log on detection.
 */

import { log } from '../../utils/telemetry.js';
import type { SuggestedAction } from './types.js';

/**
 * Normalise a replay message for identity comparison: trim, case-fold,
 * collapse internal whitespace runs, and strip trailing sentence punctuation.
 *
 * The trailing-punctuation strip is what makes this robust rather than
 * literal: a composer that echoes the user's text and adds a full stop
 * ("Set X to 0.8" → "Set X to 0.8.") produces exactly the same loop, and the
 * live defect's chip differed from the user's message in precisely nothing —
 * but the next one might differ by a full stop alone. Nothing here rewrites
 * content or matches fuzzily: two messages that differ by any WORD stay
 * distinct.
 */
function normaliseReplayMessage(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '');
}

/**
 * True when the chip has no `action_type` — a pure text-replay chip whose
 * click re-enters normal routing with its `message` as the user's text.
 *
 * Reads the field directly off the boundary `Action` type (no cast): the
 * schema declares `action_type` as an optional enum, so `undefined` is the
 * text-prompt case by construction.
 */
function isPureTextReplay(chip: SuggestedAction): boolean {
  return chip.action_type === undefined;
}

export interface LoopingChipGuardResult {
  readonly chips: readonly SuggestedAction[];
  /** Ids of chips dropped as looping. Empty when the guard did not fire. */
  readonly dropped_ids: readonly string[];
}

/**
 * Drop every pure-text-replay chip whose message would re-submit
 * `userMessage` verbatim. Returns the input untouched when `userMessage` is
 * null/blank or no chip loops.
 *
 * Firing is a BUG SIGNAL, not routine hygiene: every composer is expected to
 * offer the user something they have not already said. The caller logs the
 * detection loudly for exactly that reason.
 */
export function dropLoopingChips(
  chips: readonly SuggestedAction[],
  userMessage: string | null,
): LoopingChipGuardResult {
  if (typeof userMessage !== 'string') return { chips, dropped_ids: [] };
  const normUser = normaliseReplayMessage(userMessage);
  if (normUser.length === 0) return { chips, dropped_ids: [] };

  const dropped: string[] = [];
  const kept = chips.filter((chip) => {
    if (!isPureTextReplay(chip)) return true;
    if (typeof chip.message !== 'string' || chip.message.length === 0) return true;
    if (normaliseReplayMessage(chip.message) !== normUser) return true;
    dropped.push(chip.id);
    return false;
  });

  if (dropped.length === 0) return { chips, dropped_ids: [] };
  return { chips: kept, dropped_ids: dropped };
}

/**
 * Egress entry point: apply the guard and log an invariant violation when it
 * fires. Separated from the pure `dropLoopingChips` so unit tests can assert
 * the drop logic without asserting on logging.
 *
 * Logged at ERROR with `event: 'v5.invariant_violation'` — the established
 * shape for "a composer produced something that should be unreachable"
 * (cf. `recovery_label_ambiguous_requires_live_graph_hash` in turn-executor).
 * No user copy is logged: chip ids and counts only, matching the egress
 * redaction posture in `output-safety.ts`.
 */
export function guardLoopingChipsAtEgress(
  chips: readonly SuggestedAction[],
  userMessage: string | null,
  opts: { readonly requestId: string; readonly exitPath: string },
): readonly SuggestedAction[] {
  const result = dropLoopingChips(chips, userMessage);
  if (result.dropped_ids.length === 0) return chips;
  log.error(
    {
      event: 'v5.invariant_violation',
      invariant: 'no_chip_replays_the_user_message',
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      dropped_chip_ids: result.dropped_ids,
      dropped_count: result.dropped_ids.length,
      remaining_chip_count: result.chips.length,
    },
    'V5 egress: chip(s) would have re-submitted the user message verbatim — dead-end loop suppressed. ' +
      'Fix the composer that emitted them: offer the user something they have not already said, ' +
      'or say plainly that the request is not supported and name what is.',
  );
  return result.chips;
}
