/**
 * DSK Loader — STUB
 *
 * Returns empty claims, triggers, techniques, and null version hash.
 *
 * // A.9: Replace with DSK bundle loader + session pinning
 */

import type { ClaimReference, DSKTrigger, DSKTechnique } from "../types.js";

export interface DSKBundle {
  claims: ClaimReference[];
  triggers: DSKTrigger[];
  techniques: DSKTechnique[];
  version_hash: string | null;
}

export function loadDSK(): DSKBundle {
  // A.9: Replace with DSK bundle loader + session pinning
  return {
    claims: [] as ClaimReference[],
    triggers: [] as DSKTrigger[],
    techniques: [] as DSKTechnique[],
    version_hash: null,
  };
}
