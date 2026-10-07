/**
 * ⛔ "HOW STRONGLY" IS SAID FROM WHO SIZED THE COMMITTED LINK, NEVER ASSUMED (served-claim audit MAG-2, #70 5850056041).
 *
 * ⚠ SERVED (`f-20260926T201724Z` steps 06–07, CEE d6b09c0): adding "AI add-on price" replied "…which changes "MRR"; how
 * strongly is Olumi's estimate", while the committed edge carried the flat ±0.5 / 0.125 default (`defaulted`, no
 * `provenance.magnitude`). That is a placeholder, not an estimate: an estimate carries `magnitude: 'olumi_estimate'` and
 * a `natural_effect`. The magnitude contract (D9) already records who sized each link; the sentence now reads it.
 */
type EdgeLike = { readonly provenance?: unknown };
type Who = 'yours' | 'definition' | 'estimate' | 'placeholder';

export function whoSized(edge: EdgeLike): Who {
  const p = (typeof edge.provenance === 'object' && edge.provenance !== null ? edge.provenance : {}) as { source?: unknown; magnitude?: unknown; definitional?: unknown };
  if (p.magnitude === 'user_stated' || (typeof p.source === 'string' && p.source.startsWith('user'))) return 'yours';
  // ⛔ A link that holds BY DEFINITION (a part of a total, #2445; money lost to a risk, #2386) is arithmetic, never
  // anyone's estimate, though it carries `olumi_estimate` (DL #2445 condition 1; CODEX 5930239704).
  if (p.definitional === true) return 'definition';
  if (p.magnitude === 'olumi_estimate') return 'estimate';
  return 'placeholder';
}

const ONLY: Record<Who, string> = {
  yours: 'how strongly is as you stated it.',
  definition: 'how strongly is fixed by definition: one for one.',
  estimate: 'how strongly is Olumi\'s estimate.',
  placeholder: 'how strongly is not known yet: Olumi used a placeholder strength, not an estimate.',
};
const PART: Record<Who, string> = {
  yours: 'as you stated it',
  definition: 'fixed by definition',
  estimate: 'Olumi\'s estimate',
  placeholder: 'a placeholder',
};

/** The clause after "which changes …;" for the links a newly added factor was committed with. */
export function howStronglyWords(edges: readonly EdgeLike[]): string {
  const kinds = (['yours', 'definition', 'estimate', 'placeholder'] as const).filter((k) => edges.some((e) => whoSized(e) === k));
  if (kinds.length === 1) return ONLY[kinds[0]!];
  if (kinds.length === 0) return 'how strongly is partly Olumi\'s estimate and partly a placeholder, not a measurement.';
  const parts = kinds.map((k) => `partly ${PART[k]}`);
  const guessed = kinds.includes('estimate') || kinds.includes('placeholder');
  return `how strongly is ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}${guessed ? ', not a measurement' : ''}.`;
}
