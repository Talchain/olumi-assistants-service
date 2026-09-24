/**
 * ⭐ THE PERMISSIBLE NON-RANKING COACHING CARD.
 *
 * THE GAP, traced by Track B (#63 5811708711) and confirmed here against served
 * `fd312b5d`: on the OpenAI route a constrained run can receive **no coaching card
 * at all**, because every existing card is unavailable in that state —
 *
 *   · `assumption_check`   reads `dr.key_assumptions`        → decision_review, SKIPPED on this route
 *   · `calibration_prompt` reads `dr.decision_quality_prompts` → decision_review, SKIPPED
 *   · `strengthen`         intentionally WITHHELD when leader claims are forbidden
 *
 * So the user finishes a 60-second build and a run, and the panel offers nothing.
 *
 * ⭐ WHAT MAKES THIS ONE PERMISSIBLE WHERE `strengthen` IS NOT. It is built from
 * `robustness.fragile_edges` — the run's own output — and it makes **no ranking
 * claim of any kind**. `selectGroundedCounterCase` deliberately refuses to read
 * `alternative_winner_label`, because naming the option that would take the lead IS
 * a leading-option claim; its copy says "the option in front" precisely so the
 * exercise can be offered when no leader may be named. This card inherits that
 * refusal rather than re-deriving it.
 *
 * ⛔ NO DECISION_REVIEW, NO SECOND MODEL CALL, NO NEW FRAMEWORK. It consumes the
 * output of the Run the user already asked for, through a schema and a renderer the
 * Panel already has (`V5CoachingBlock` renders a real button when, and only when,
 * both `action_label` and `action_prompt` exist).
 */

import { selectGroundedCounterCase } from './grounded-counter-case.js';

/**
 * `CoachingBlockSchema` caps, mirrored so the caller cannot exceed them.
 *
 * ⛔ `BODY_MAX` READ 400 AND THE REAL CAP IS 300 (`PHASE3_BODY_MAX`,
 * `@talchain/schemas` 0.55.0 `boundary/blocks.js:485`, read by
 * `CoachingBlockSchema.body` at `:612`). That was not an edge case: the shared
 * counter-case's FIXED text is 313 characters on one branch and 320 on the other
 * BEFORE a single label, so **every card this producer could emit was over the
 * cap** — and a coaching block that fails the strict union does not degrade the
 * turn, it DELETES it. The client discards the whole response.
 */
const TITLE_MAX = 80;
const BODY_MAX = 300;
const ACTION_LABEL_MAX = 40;
const ACTION_PROMPT_MAX = 200;

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export interface DisconfirmationCard {
  readonly type: 'coaching';
  readonly coaching_kind: 'bias_signal';
  readonly title: string;
  readonly body: string;
  readonly source: 'deterministic_signal';
  readonly target_refs: readonly { readonly id: string; readonly label: string; readonly kind: 'edge' }[];
  readonly priority_rank: number;
  readonly action_intent: 'run_devils_advocacy';
  readonly action_label: string;
  readonly action_prompt: string;
}

/**
 * Build the card from an analysis enrichment, or return `null`.
 *
 * ⚠ `null` IS THE DEFAULT AND MUST STAY CHEAP TO REACH. A card the run does not
 * ground is worse than no card: it would occupy the one slot a user reads with
 * something the analysis cannot support. Every refusal path below returns null
 * silently rather than substituting generic advice.
 */
export function disconfirmationCardFrom(enrichment: unknown): DisconfirmationCard | null {
  let decision: { grounded?: { counterCase?: unknown; fromId?: unknown; toId?: unknown; fromLabel?: unknown; toLabel?: unknown; edgeIdentity?: unknown } | null };
  try {
    decision = selectGroundedCounterCase(enrichment) as never;
  } catch {
    return null;
  }
  const g = decision?.grounded;
  if (g === null || g === undefined) return null;
  const counterCase = typeof g.counterCase === 'string' ? g.counterCase.trim() : '';
  if (counterCase === '') return null;

  const fromLabel = typeof g.fromLabel === 'string' ? g.fromLabel : '';
  const toLabel = typeof g.toLabel === 'string' ? g.toLabel : '';
  const edgeId = typeof g.edgeIdentity === 'string' ? g.edgeIdentity : '';

  return {
    type: 'coaching',
    coaching_kind: 'bias_signal',
    // ⚠ NO OPTION IS NAMED HERE, and that is the whole reason this card may be
    // shown when `strengthen` may not.
    title: truncate('A link worth arguing against', TITLE_MAX),
    /**
     * ⚠ THE CARD AUTHORS ITS OWN BODY RATHER THAN TRUNCATING THE SHARED EXERCISE.
     * `composeGroundedCounterCase`'s text is 313-320 chars and is also used by the
     * DSK exercise block, whose field has no cap. Cutting it here would end the
     * card mid-sentence ("…and note…"); the instruction survives intact in
     * `action_prompt`, which the button dispatches verbatim.
     *
     * ⛔ It still names NO option — the same refusal as the selector it comes from.
     */
    body: truncate(
      fromLabel !== '' && toLabel !== ''
        ? `The robustness check flagged the link from ${fromLabel} to ${toLabel} as a priority to challenge. `
          + 'Assume for a moment it does not hold: what would that change, and what evidence would settle it?'
        : counterCase,
      BODY_MAX,
    ),
    source: 'deterministic_signal',
    // The edge the robustness check actually flagged — so the card points at a real
    // thing in the user's model rather than at the result.
    target_refs: edgeId !== '' && fromLabel !== '' && toLabel !== ''
      ? [{ id: edgeId, label: `${fromLabel} → ${toLabel}`, kind: 'edge' as const }]
      : [],
    // Coaching ranks below review cards, as the existing cards do.
    priority_rank: 120,
    action_intent: 'run_devils_advocacy',
    action_label: truncate('Argue against this link', ACTION_LABEL_MAX),
    /**
     * ⭐ PRODUCER-AUTHORED AND DISPATCHED VERBATIM as the user's next turn. It is
     * imperative and self-contained because the user watches it become their own
     * message — and it asks for THEIR case, never Olumi's.
     */
    action_prompt: truncate(
      'Make the strongest case that this link does not hold, and tell me what evidence would settle it.',
      ACTION_PROMPT_MAX,
    ),
  };
}
