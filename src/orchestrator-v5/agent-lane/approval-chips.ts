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

/**
 * ⭐ EXPORTED so the approval fast path DERIVES the confirmable message set from
 * this map instead of keeping a second copy of the strings. Two lists of the
 * same copy always drift; one cannot. `APPROVE_CHIP_MESSAGES` below is the
 * derived set, and `approval-fast-path.ts` asserts it is non-empty so a rename
 * here cannot silently empty the fast path's allowlist.
 */
export const APPROVE: Readonly<Record<string, { label: string; message: string }>> = {
  propose_starting_point: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_assumptions: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_option_interventions: { label: 'Use as starting option levels', message: 'Yes, use those.' },
  propose_model_change: { label: 'Make this change', message: 'Yes, make that change.' },
};

/**
 * ⛔ THE EXACT STRINGS THIS PRODUCT EMITS AS AN APPROVAL, and why an exact-match
 * set is the safe half of the fast path.
 *
 * MEASURED against the shared free-text recognisers in
 * `routing/deterministic-short-confirm.ts` (both patterns executed verbatim
 * against these strings):
 *   'Yes, use those.'          SHORT_CONFIRM=false  PROPOSAL_CONFIRM=false
 *   'Yes, make that change.'   SHORT_CONFIRM=false  PROPOSAL_CONFIRM=TRUE
 * So the battle-hardened patterns cover ONE of the four chips — and the three
 * they miss include `propose_starting_point`, which is the chip on the measured
 * approve journey. A fast path built on those patterns alone would miss exactly
 * the case it exists for.
 *
 * ⚠ AND THE FIX IS NOT TO LOOSEN THEM. Those patterns are anchored, witnessed
 * live, and shared with the v5 consent path; widening them to hear "use those"
 * would change behaviour on a path this lane does not own. An exact-match set of
 * strings THE PRODUCT ITSELF AUTHORED cannot over-fire: the user did not compose
 * these words, the chip did.
 */
export const APPROVE_CHIP_MESSAGES: ReadonlySet<string> = Object.freeze(
  new Set(Object.values(APPROVE).map((c) => c.message)),
) as ReadonlySet<string>;

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
