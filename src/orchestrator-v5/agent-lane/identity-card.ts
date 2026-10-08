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
  if (typeof message !== 'string' || !message.startsWith(IDENTITY_APPROVE_PREFIX)) return undefined;
  const words = message.slice(IDENTITY_APPROVE_PREFIX.length);
  return words.startsWith('Is “') || (words.startsWith('Olumi reads ‘') && words.endsWith('’. Is that how you work it out?'))
    ? words : undefined;
}

/** The held line when an issued card carries neither words nor a public label (COPY-SHAPE: never "undefined"). */
export const IDENTITY_ISSUED_FALLBACK = 'I’ve prepared that confirmation for you to approve. Nothing changes until you approve it.';
/** The reply text for a bar-issued identity card: its words, else its public label, else the fixed held line. */
export function identityIssuedText(issued: { readonly card?: unknown; readonly public_label?: unknown }): string {
  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  const words = typeof issued.card === 'object' && issued.card !== null ? (issued.card as { words?: unknown }).words : undefined;
  return nonEmpty(words) ? words : nonEmpty(issued.public_label) ? issued.public_label : IDENTITY_ISSUED_FALLBACK;
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

/**
 * ⭐ THE ROUTE ISSUES THE CARD WHEN THE AGENT DID NOT (R3, served CEE `3727537`: 0/3 typed Runs called `propose_identity`
 * after the Run's `identity_card` note, and the Run chip's interpreter runs with `tool_choice: 'none'`, so it never can).
 * True when a Run in this turn says a card is waiting and nothing in the turn proposed one; the route then dispatches the
 * SAME `propose_identity` tool once. It writes nothing: the button, with its stored words, is the only way to a Yes.
 */
export function identityCardToIssue(
  toolCalls: readonly { readonly name: string }[],
  toolResults: readonly unknown[],
): boolean {
  if (toolCalls.some((c) => c.name === 'propose_identity' || c.name === 'authorise_change')) return false;
  // A Run's own result, or a build's automatic first analysis (`first_analysis.identity_card`, the draft turn: R3 run k).
  type Hinted = { identity_card?: { available?: unknown }; first_analysis?: { identity_card?: { available?: unknown } } };
  return toolResults.some((r) => (r as Hinted | null | undefined)?.identity_card?.available === true
    || (r as Hinted | null | undefined)?.first_analysis?.identity_card?.available === true);
}

/**
 * ⛔ NO CARD, NO BUTTON — SO A TURN THAT ASKS FOR THE READING RE-OFFERS IT (R3 H witness 5910559613, served CEE 950177e,
 * 2/2 signed-in): after the draft turn's card, a typed "Run the analysis." got "Is MRR your price × subscribers? … If yes,
 * Olumi will calculate MRR that way" with NO tool call and `suggested_actions: []`. A typed yes cannot write (a reading is
 * the user's only on its displayed card), so the user had nothing to press. `identityCardToIssue` keys on a Run's
 * result, and there was no Run. So the route re-offers the SAME card (the same stored words, the same id: it writes
 * nothing) on any turn that wrote nothing, offered no other proposal, and was not a chip's fast path, while the STORED
 * model still holds an unconfirmed reading its writer can record.
 */
export function identityCardToReoffer(p: {
  readonly toolCalls: readonly { readonly name: string }[];
  readonly mutated: boolean;
  readonly fastPath: string | undefined;
  /** Whether this turn already offers a proposal (`proposalsAwaitingApproval`): one approval carries one change. */
  readonly proposalOffered: boolean;
  /** The STORED model holds an unconfirmed reading its writer can record (`proposeProductIdentity` + writable base). */
  readonly readingWaiting: boolean;
}): boolean {
  if (p.fastPath !== undefined || p.mutated || p.proposalOffered || !p.readingWaiting) return false;
  return !p.toolCalls.some((c) => c.name === 'propose_identity' || c.name === 'authorise_change');
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
