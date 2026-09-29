/**
 * ⭐ THE CONFIRM CARD FOR A PRODUCT THE MINT COULD NOT PROVE — Runtime's issue point (DL 5888399097 / 5888631168).
 *
 * R3's detector (`proposeProductIdentity`, #2296) reads the STORED graph and returns the reading for the user to confirm:
 * "Is “MRR” your “Pro plan price” × “Paying subscribers”? £49 × 1,500 = £73,500, close to your £75,000. If yes, …".
 * Runtime turns it into ONE proposal whose button shows exactly those words; pressing it writes the identity through
 * Canonical's approved-card door (#2292, `commitOptionLevels` → `identity_confirm`), one append, alone.
 *
 *   - The words are R3's, verbatim: never recomputed, rounded or reworded here (AIQ 5888571809).
 *   - The token is Canonical's `identityConfirmReadingToken` over the EXACT words the button showed, recomputed from the
 *     stored proposal at approval — never taken from the request.
 *   - "Yes" runs nothing (Paul's ruling, #63 5812069638; DL 5888631168 (b)): the approval reply offers the Run.
 *   - "No" writes nothing; #2272's honest sentence stays.
 *   - Offered once per stored graph revision: the proposal's id is its content (revision + reading), so a Run on the same
 *     revision does not offer it again (`identityCardHintFor`).
 */
import type { IdentityProposal } from './identity-proposal.js';
import type { StructuredProposal } from './proposal.js';

/** The proposal operation that carries a reading to confirm. `path` is the goal's id. */
export const CONFIRM_IDENTITY_OP = 'confirm_identity' as const;

/** The stored reading a `confirm_identity` proposal carries, or `undefined` for any other proposal. */
export function identityReadingOf(proposal: StructuredProposal): IdentityProposal | undefined {
  const op = proposal.operations.length === 1 && proposal.operations[0]!.op === CONFIRM_IDENTITY_OP ? proposal.operations[0]! : undefined;
  const v = (op?.value ?? {}) as { outcome_id?: unknown; operation?: unknown; factor_ids?: unknown; words?: unknown };
  if (op === undefined || typeof v.outcome_id !== 'string' || v.outcome_id !== op.path || v.operation !== 'product'
    || !Array.isArray(v.factor_ids) || v.factor_ids.length !== 2 || !v.factor_ids.every((f) => typeof f === 'string' && f !== '')
    || typeof v.words !== 'string' || v.words.trim() === '') return undefined;
  return { outcome_id: v.outcome_id, operation: 'product', factor_ids: [v.factor_ids[0] as string, v.factor_ids[1] as string], words: v.words };
}

/**
 * ⭐ THE PRESSED CARD CARRIES ITS WORDS (the link-effect rule, AIQ 5885290014): the approval request carries exactly what
 * the user saw, and the durable carrier keeps it, so a card put back after a restart shows the same reading.
 */
const IDENTITY_APPROVE_PREFIX = 'Yes — ';
export const identityApproveMessage = (words: string): string => `${IDENTITY_APPROVE_PREFIX}${words}`;
/** The card words an identity approval carries, or `undefined` for any other words. */
export function readingOfIdentityApproval(message: unknown): string | undefined {
  return typeof message === 'string' && message.startsWith(`${IDENTITY_APPROVE_PREFIX}Is “`)
    ? message.slice(IDENTITY_APPROVE_PREFIX.length) : undefined;
}

/** What the Agent is told when a Run's stored model holds a reading to confirm. */
export const IDENTITY_CARD_NOTE =
  'Olumi has a reading of the goal for the user to confirm. Call propose_identity (no arguments), then ask the user its '
  + '`words` exactly as returned, and tell them to confirm on the button. Never state the reading as fact, never change its '
  + 'figures, and never run the analysis again yourself.';

/**
 * The card's hint for a Run's result: present only when the stored model holds a reading AND that exact card (this
 * revision, these words) has not been offered already.
 */
export function identityCardHintFor(card: IdentityProposal | null, alreadyOffered: boolean):
  { readonly available: true; readonly note: string } | undefined {
  return card === null || alreadyOffered ? undefined : { available: true, note: IDENTITY_CARD_NOTE };
}

type IdentityRefusalCode = 'reading_not_confirmed' | 'superseded' | 'not_admissible' | 'carrier_conflict' | 'already_carried' | string;

/** Plain words for a door refusal (`identity_<code>`, Canonical 5888513620). Never the code itself. */
export function identityRefusalWords(code: IdentityRefusalCode, goalLabel: string): string {
  switch (code) {
    case 'already_carried':
      return `Nothing new was recorded: "${goalLabel}" is already calculated that way.`;
    case 'carrier_conflict':
      return `Nothing was recorded: "${goalLabel}" already has a different calculation in the model, so this one cannot be added. Tell the user exactly that.`;
    case 'superseded':
      return 'Nothing was recorded: the model changed after this was offered. Read it again; offer the reading afresh only if it still applies.';
    case 'not_admissible':
      return `Nothing was recorded: "${goalLabel}" cannot be calculated that way in this model, because those two figures do not both feed it directly. Tell the user exactly that.`;
    case 'reading_not_confirmed':
      return 'Nothing was recorded: the button pressed did not carry this exact reading, so the user has not confirmed it. Show them the reading again and let them confirm it on its button.';
    default:
      return 'Nothing was recorded: Olumi could not record this reading. Tell the user exactly that.';
  }
}
