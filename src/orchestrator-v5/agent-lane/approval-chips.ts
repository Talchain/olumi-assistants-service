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
 * clicking "Use as starting assumptions" is EXACTLY the user typing "Yes, use
 * those." — the consent path is unchanged, and the Agent still resolves it
 * against `awaiting_your_approval` and calls `authorise_change`.
 *
 * Offered only when it cannot be ambiguous: exactly ONE proposal was offered this
 * turn, and nothing was authorised this turn. With two pending, "yes" would make
 * the Agent ask which — a chip must not pretend to have chosen.
 */
import type { SuggestedAction } from '../compose/types.js';

const APPROVE: Readonly<Record<string, { label: string; message: string }>> = {
  propose_starting_point: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_assumptions: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_option_interventions: { label: 'Use as starting option levels', message: 'Yes, use those.' },
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
  const [proposalId, tool] = [...offered.entries()][0]!;
  const approve = APPROVE[tool]!;
  // ⭐ THE CHIP CARRIES THE PROPOSAL'S IDENTITY (fast path 2, RC #63 5803995225). The
  // UI echoes `chip.id` verbatim on the click, so the route applies EXACTLY this
  // proposal with no model call. The id is never rendered (label/message are).
  return [{ id: approvalChipIdFor(proposalId), label: approve.label, message: approve.message }, AMEND_CHIP];
}

const APPROVE_PREFIX = 'agent-approve-proposal:';

/** The approve chip's id for one proposal. */
export const approvalChipIdFor = (proposalId: string): string => `${APPROVE_PREFIX}${proposalId}`;

/**
 * The proposal a request's chip names, when (and only when) it is the typed approve
 * chip. Words alone never approve on this path: "Yes, use those." typed into the
 * composer still goes to the Agent, which resolves it against what it offered.
 */
export function typedApprovalOf(body: unknown): string | undefined {
  const id = (body as { chip?: { id?: unknown } } | null | undefined)?.chip?.id;
  if (typeof id !== 'string' || !id.startsWith(APPROVE_PREFIX)) return undefined;
  const proposalId = id.slice(APPROVE_PREFIX.length);
  return /^prop_[0-9a-f]{6,64}$/.test(proposalId) ? proposalId : undefined;
}
