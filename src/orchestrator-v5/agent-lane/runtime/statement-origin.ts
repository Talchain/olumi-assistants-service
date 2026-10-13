/** K3: an unclaimed proposal is a new AI act, including with incomplete source.
 * A claimed user quote needs verification. A known unknown-source
 * figure cannot be relabelled by marking it as an estimate. Verified human evidence wins.
 */
export function statementOrigin(verified: boolean, unknown: boolean, sourceComplete = true, ownEstimate = false): 'human' | 'unknown' | 'ai' {
  return verified ? 'human' : unknown || (!sourceComplete && !ownEstimate) ? 'unknown' : 'ai';
}

/** Claims made on the proposal itself, never inferred from missing history.
 * `revise` already means the user named the replacement figure in the tool contract.
 * Quoted basis text and explicit attribution cannot turn into a new estimate on a miss.
 */
export function claimsUserAuthorship(proposal: { user_stated?: boolean; revise?: boolean; quote?: unknown; basis?: string }): boolean {
  return proposal.user_stated === true || proposal.revise === true
    || (typeof proposal.quote === 'string' && proposal.quote.trim() !== '')
    || /[“”"]|‘[^’]+’|(?:^|\s)'[^']+'|\b(?:you|the user|user)\s+(?:(?:have|had)\s+)?(?:said|stated|gave|provided|wrote|specified|supplied|reported|named)\b|\buser[- ](?:stated|provided|supplied)\b/i.test(proposal.basis ?? '');
}

export const UNKNOWN_ORIGIN_DETAIL = 'The retained source is not verified. Its origin stays unknown; nothing was prepared. Ask for its source.';
