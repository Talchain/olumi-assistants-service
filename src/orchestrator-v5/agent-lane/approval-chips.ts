/**
 * ⭐ ONE CLICK TO APPROVE THE PROPOSAL THE USER IS LOOKING AT.
 *
 * Measured on served `30a9968` (#63, 08:13): the Agent lane held its proposals
 * for consent, honestly, but returned `suggested_actions: []`, so approval
 * worked only by typing — and the reply told the user to type a 32-hex id.
 *
 * A chip here is ordinary text: the UI sends its `message` on the same Agent
 * route (DecisionGuideAI `buildPayload.ts:199-221` at served `fa84d226`), and a
 * chip without an `action_type` always renders (`SuggestedChips.tsx:256`). So
 * clicking "Use these starting values" is EXACTLY the user typing "Yes, use
 * those." — the consent path is unchanged, and the Agent still resolves it
 * against `awaiting_your_approval` and calls `authorise_change`.
 *
 * Offered only when it cannot be ambiguous: exactly ONE proposal was offered this
 * turn, and nothing was authorised this turn. With two pending, "yes" would make
 * the Agent ask which — a chip must not pretend to have chosen.
 */
import type { SuggestedAction } from '../compose/types.js';

const APPROVE: Readonly<Record<string, { label: string; message: string }>> = {
  propose_starting_point: { label: 'Use these starting values', message: 'Yes, use those.' },
  propose_assumptions: { label: 'Use these starting values', message: 'Yes, use those.' },
  propose_option_interventions: { label: 'Use these option levels', message: 'Yes, use those.' },
  propose_model_change: { label: 'Make this change', message: 'Yes, make that change.' },
};

export const AMEND_CHIP: SuggestedAction = {
  id: 'agent-amend-proposal',
  label: 'Change something first',
  message: 'Before you apply it, I want to change some of it.',
};

export function approvalChipsFor(
  toolCalls: readonly { name: string; ok: boolean; proposal_id?: string }[],
): SuggestedAction[] {
  if (toolCalls.some((c) => c.name === 'authorise_change')) return [];
  const offered = new Map<string, string>();
  for (const c of toolCalls) {
    if (c.ok && typeof c.proposal_id === 'string' && APPROVE[c.name] !== undefined) offered.set(c.proposal_id, c.name);
  }
  if (offered.size !== 1) return [];
  const approve = APPROVE[[...offered.values()][0]!]!;
  return [{ id: 'agent-approve-proposal', label: approve.label, message: approve.message }, AMEND_CHIP];
}
