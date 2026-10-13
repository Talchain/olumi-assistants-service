/** K3: verified human evidence wins; unknown history never becomes an Olumi estimate. */
export function statementOrigin(verified: boolean, unknown: boolean): 'human' | 'unknown' | 'ai' {
  return verified ? 'human' : unknown ? 'unknown' : 'ai';
}

export const UNKNOWN_ORIGIN_DETAIL = 'The retained source is not verified. Its origin stays unknown; nothing was prepared. Ask for its source.';
