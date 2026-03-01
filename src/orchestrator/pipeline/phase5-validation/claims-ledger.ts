/**
 * Claims Ledger — STUB
 *
 * Returns empty claims and techniques arrays.
 *
 * // A.12: Replace with annotation-based extraction.
 */

import type { ClaimReference, TechniqueReference } from "../types.js";

export interface ClaimsLedgerResult {
  claims: ClaimReference[];
  techniques: TechniqueReference[];
}

/**
 * Extract claims and techniques from annotations.
 * Currently a stub — returns empty arrays.
 */
export function extractClaims(): ClaimsLedgerResult {
  // A.12: Replace with annotation-based extraction.
  return {
    claims: [],
    techniques: [],
  };
}
