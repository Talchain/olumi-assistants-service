/**
 * Interim stand-in for C's `provenanceOf` (DL 12 Oct: one read side for every reader; contract ADOPTED as origin and role
 * returned separately, "origin 'human' via user_material_unverified, role 'unverified'; never 'ai'"). It reads only the
 * EXISTING stored fields through the existing readers. Replace the import with C's export when it lands.
 */
import { valueAuthorshipOf } from '../../turn-context/guidance-signals.js';
import { isUnverifiedUserMaterial } from '../../../../cee/transforms/provenance-display.js';

export type Provenance = { origin: 'human' | 'ai' | 'unknown'; role: 'verified' | 'unverified' | null };
export function provenanceOf(observed: unknown): Provenance {
  if (isUnverifiedUserMaterial(observed)) return { origin: 'human', role: 'unverified' };
  const a = valueAuthorshipOf(observed);
  if (a === 'yours') return { origin: 'human', role: 'verified' };
  if (a === 'olumi_estimate' || a === 'olumi_accepted') return { origin: 'ai', role: null };
  return { origin: 'unknown', role: null };
}
