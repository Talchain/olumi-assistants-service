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
  // #1788's add-option proposal: the same typed, zero-call approval as every other proposal.
  propose_new_option: { label: 'Add this option', message: 'Yes, add that option.' },
  // A direct option→risk link the analysis cannot use (remove-direct-risk-link.test.ts).
  propose_remove_risk_link: { label: 'Remove this link', message: 'Yes, remove that link.' },
};

export const AMEND_CHIP: SuggestedAction = {
  id: 'agent-amend-proposal',
  label: 'Change something first',
  message: 'Before you apply it, I want to change some of it.',
};

export function approvalChipsFor(
  toolCalls: readonly { name: string; ok: boolean; mutated: boolean; proposal_id?: string }[],
): SuggestedAction[] {
  /**
   * A turn that authorised something consumes THOSE proposals only: one that approved A and proposed
   * B offers B (measured on served `6dfb56f`: "Yes, make that change" applied a link and proposed its
   * level, and the reply had no chip). If any authorisation's identity is unknown, nothing is offered —
   * never a chip on a guess about which proposal was consumed.
   *
   * ⛔ ORDER DECIDES VALIDITY. A proposal is bound to the revision it was made on, and any call that
   * moved the model after it makes it stale: `ProposalStore.authorise` refuses it as `superseded`
   * (Codex #1806 5807933515: propose B on H0, then approve A → H1, offered a chip that could not
   * commit). So only a proposal made AFTER the turn's last model change is still offerable.
   */
  const authorisations = toolCalls.filter((c) => c.name === 'authorise_change');
  if (authorisations.some((c) => typeof c.proposal_id !== 'string')) return [];
  const consumed = new Set(authorisations.map((c) => c.proposal_id as string));
  const lastChange = toolCalls.map((c) => c.mutated).lastIndexOf(true);
  const offered = new Map<string, string>();
  toolCalls.forEach((c, i) => {
    if (i > lastChange && c.ok && typeof c.proposal_id === 'string' && APPROVE[c.name] !== undefined && !consumed.has(c.proposal_id)) offered.set(c.proposal_id, c.name);
  });
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
