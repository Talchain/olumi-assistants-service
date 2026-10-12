/**
 * C's `provenanceOf` (recovery Batch C, `cee/provenance/provenance-of.ts`: the one read side for every reader), asked of a
 * starting value and read through this file's contract: origin and role returned separately, `n/a` as null (DL 12 Oct).
 */
import { provenanceOf as one } from '../../../../cee/provenance/provenance-of.js';

export type Provenance = { origin: 'human' | 'ai' | 'unknown'; role: 'verified' | 'unverified' | null };
export function provenanceOf(observed: unknown): Provenance {
  const { origin, role } = one({ value: observed });
  return { origin, role: role === 'n/a' ? null : role };
}
