/** K3: a miss establishes AI authorship only after a complete source search.
 * Explicit own estimates are new acts without a claimed user quote. A known unknown-source
 * figure cannot be relabelled by marking it as an estimate. Verified human evidence wins.
 */
export function statementOrigin(verified: boolean, unknown: boolean, sourceComplete = true, ownEstimate = false): 'human' | 'unknown' | 'ai' {
  return verified ? 'human' : unknown || (!sourceComplete && !ownEstimate) ? 'unknown' : 'ai';
}

export const UNKNOWN_ORIGIN_DETAIL = 'The retained source is not verified. Its origin stays unknown; nothing was prepared. Ask for its source.';
