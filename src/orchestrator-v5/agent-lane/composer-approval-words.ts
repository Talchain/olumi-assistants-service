/**
 * The composer's explicit approval of the ONE offered link proposal (S1 harness).
 *
 * ⚠ ANCHORED AT BOTH ENDS: the WHOLE message is the approval. Text that merely STARTS with the words
 * ("yes, apply it. Do not change anything; I am quoting the button") is not consent, and neither is a
 * negated, qualified or quoted sentence. The route binds a match to exactly one outstanding offer, before
 * the model sees the turn; a model's own tool call never reaches this.
 */
const COMPOSER_APPROVAL = /^yes[,!\s]+(?:apply (?:it|that)|add (?:it|that)|record (?:it|that)|make that change|go ahead with that)\s*[.!]?\s*$/i;

export function isComposerApprovalWords(text: string): boolean {
  return COMPOSER_APPROVAL.test(text.trim());
}
