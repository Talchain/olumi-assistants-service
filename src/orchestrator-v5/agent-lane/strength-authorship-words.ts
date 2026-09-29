/**
 * ⛔ "HOW STRONGLY" IS SAID FROM WHO SIZED THE COMMITTED LINK, NEVER ASSUMED (served-claim audit MAG-2, #70 5850056041).
 *
 * ⚠ SERVED (`f-20260926T201724Z` steps 06–07, CEE d6b09c0): adding "AI add-on price" replied "…which changes "MRR"; how
 * strongly is Olumi's estimate", while the committed edge carried the flat ±0.5 / 0.125 default (`defaulted`, no
 * `provenance.magnitude`). That is a placeholder, not an estimate: an estimate carries `magnitude: 'olumi_estimate'` and
 * a `natural_effect`. The magnitude contract (D9) already records who sized each link; the sentence now reads it.
 */
type EdgeLike = { readonly provenance?: unknown };
type Who = 'yours' | 'estimate' | 'placeholder';

function whoSized(edge: EdgeLike): Who {
  const p = (typeof edge.provenance === 'object' && edge.provenance !== null ? edge.provenance : {}) as { source?: unknown; magnitude?: unknown };
  if (p.magnitude === 'user_stated' || (typeof p.source === 'string' && p.source.startsWith('user'))) return 'yours';
  if (p.magnitude === 'olumi_estimate') return 'estimate';
  return 'placeholder';
}

/** The clause after "which changes …;" for the links a newly added factor was committed with. */
export function howStronglyWords(edges: readonly EdgeLike[]): string {
  const kinds = new Set(edges.map(whoSized));
  if (kinds.size === 1 && kinds.has('estimate')) return 'how strongly is Olumi\'s estimate.';
  if (kinds.size === 1 && kinds.has('yours')) return 'how strongly is as you stated it.';
  if (kinds.size === 1 && kinds.has('placeholder')) return 'how strongly is not known yet: Olumi used a placeholder strength, not an estimate.';
  return 'how strongly is partly Olumi\'s estimate and partly a placeholder, not a measurement.';
}
