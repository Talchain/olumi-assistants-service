/**
 * ⭐ RT-6 S4-A PHASE 2 (DL e8, 5 Oct; Science d5 card ruling): the Agent's typed UNIT question about a link the user sized
 * in chat, held by the SERVER on the answer row, so a one-word answer ("Percentage points.") completes it by this
 * question's id — never by re-reading earlier turns.
 *
 * ⛔ The carrier is emitted only when the session reader of EVERY rollback target parses `agent_link_effect_question`
 * (phase 1, `session/pending-action.ts`): a row this build cannot parse would wedge the scenario. Before returning a
 * carrier this module runs that same parser on it and returns nothing when it refuses.
 */
import { randomUUID } from 'node:crypto';

import { parsePendingAction, type PendingAction } from '../session/pending-action.js';

/** The question lives two turns or ten minutes, whichever comes first (DL e8): it answers the very next reply. */
export const LINK_EFFECT_QUESTION_TURN_TTL = 2;
export const LINK_EFFECT_QUESTION_WALL_TTL_MS = 10 * 60 * 1000;

export interface LinkEffectQuestionInput {
  readonly scenario_id: string;
  readonly question: string;
  readonly from: { readonly id: string; readonly label: string };
  readonly to: { readonly id: string; readonly label: string };
  readonly quote: string;
  readonly effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string };
  readonly asked_unit: readonly { readonly end: 'source' | 'target'; readonly node_id: string; readonly value: number }[] | undefined;
  readonly graph_hash: string;
  readonly emitted_at_iso: string;
}

/**
 * The carrier for ONE unit question about ONE end, or nothing. Two ends asked at once, or a question that is not purely
 * a unit question, cannot be completed by a one-word answer, so it carries nothing and stands as asked.
 */
export function linkEffectQuestionCarrier(input: LinkEffectQuestionInput): PendingAction | undefined {
  const asked = input.asked_unit;
  if (asked === undefined || asked.length !== 1) return undefined;
  const only = asked[0]!;
  const end = only.end === 'source' ? input.from : input.to;
  if (only.node_id !== end.id || input.question !== `What unit is the ${Math.abs(only.value)} change in “${end.label}” stated in?`) return undefined;
  const id = `leq_${randomUUID()}`;
  const emitted = Date.parse(input.emitted_at_iso);
  const carrier = {
    id,
    scenario_id: input.scenario_id,
    chip_id: id,
    action: {
      kind: 'agent_link_effect_question' as const,
      question: input.question,
      from_node_id: input.from.id, to_node_id: input.to.id,
      from_label: input.from.label, to_label: input.to.label,
      quote: input.quote,
      effect: { amount: input.effect.amount, amount_unit: input.effect.amount_unit,
        per_source_change: input.effect.per_source_change, per_source_change_unit: input.effect.per_source_change_unit },
      asked_ends: [only.end],
    },
    preconditions: { graph_hash: input.graph_hash },
    expires_at_turn_count: LINK_EFFECT_QUESTION_TURN_TTL,
    expires_at_iso: new Date((Number.isFinite(emitted) ? emitted : Date.now()) + LINK_EFFECT_QUESTION_WALL_TTL_MS).toISOString(),
    emitted_at_iso: input.emitted_at_iso,
  };
  return parsePendingAction(JSON.parse(JSON.stringify(carrier))) === null ? undefined : carrier;
}
