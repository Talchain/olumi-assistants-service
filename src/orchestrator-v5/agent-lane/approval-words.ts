/**
 * The words a link-effect card's and an identity card's approve button sends, and the reading a card put back after a restart
 * reads from them, on their own so the durable carrier (`durable-proposal.ts`) loads neither card's composer (W5, alpha wall).
 * `approval-chips.ts` and `identity-card.ts` re-export them; nothing changed.
 */

/**
 * ⭐ THE PRESSED CARD CARRIES ITS READING (AIQ 5885290014: "a forged approval without a reading token → the writer
 * refuses"). The card's words ARE its reading, so the approval request carries exactly what the user saw; the durable
 * carrier keeps those words, so a card put back after a restart shows the same reading ({@link readingOfLinkEffectApproval}).
 */
const LINK_EFFECT_APPROVE_PREFIX = 'Yes \u2014 ';
export const linkEffectApproveMessage = (reading: string): string => `${LINK_EFFECT_APPROVE_PREFIX}${reading}`;
/** The reading a link-effect card's words carry, or `undefined` for any other words. */
export function readingOfLinkEffectApproval(message: unknown): string | undefined {
  return typeof message === 'string' && (message.startsWith(`${LINK_EFFECT_APPROVE_PREFIX}Record: `)
    || /^Yes \u2014 REVERSAL: this changes the link from (positive|negative) to (positive|negative)\. Record: /.test(message))
    ? message.slice(LINK_EFFECT_APPROVE_PREFIX.length) : undefined;
}

/**
 * ⭐ THE PRESSED CARD CARRIES ITS WORDS (the link-effect rule, AIQ 5885290014): the approval request carries exactly what
 * the user saw, and the durable carrier keeps it, so a card put back after a restart shows the same reading.
 */
const IDENTITY_APPROVE_PREFIX = 'Yes — ';
export const identityApproveMessage = (words: string): string => `${IDENTITY_APPROVE_PREFIX}${words}`;
/** The card words an identity approval carries, or `undefined` for any other words. */
export function readingOfIdentityApproval(message: unknown): string | undefined {
  if (typeof message !== 'string' || !message.startsWith(IDENTITY_APPROVE_PREFIX) && !message.startsWith('No — ')) return undefined;
  const words = message.slice(message.startsWith('No — ') ? 'No — '.length : IDENTITY_APPROVE_PREFIX.length);
  return words.startsWith('Is “') || (words.startsWith('Olumi reads ‘') && words.endsWith('. Is that how you work it out?'))
    ? words : undefined;
}
