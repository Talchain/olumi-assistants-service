/**
 * ⛔ "HOW STRONGLY" IS SAID FROM WHO SIZED THE COMMITTED LINK, NEVER ASSUMED (served-claim audit MAG-2, #70 5850056041).
 *
 * ⚠ SERVED (`f-20260926T201724Z` steps 06–07, CEE d6b09c0): adding "AI add-on price" replied "…which changes "MRR"; how
 * strongly is Olumi's estimate", while the committed edge carried the flat ±0.5 / 0.125 default (`defaulted`, no
 * `provenance.magnitude`). That is a placeholder, not an estimate: an estimate carries `magnitude: 'olumi_estimate'` and
 * a `natural_effect`. The magnitude contract (D9) already records who sized each link; the sentence now reads it.
 */
import { sayFigure } from './say-figure.js';
import { isIdentityPartialLink, linkSizing } from '../../cee/magnitude/link-sizing.js';

type EdgeLike = { readonly provenance?: unknown; readonly from?: unknown; readonly to?: unknown };
type GraphLike = { readonly nodes?: unknown };
type Who = 'yours' | 'definition' | 'estimate' | 'placeholder' | 'unmarked' | 'identity';

export function whoSized(edge: EdgeLike): Who {
  const p = (typeof edge.provenance === 'object' && edge.provenance !== null ? edge.provenance : {}) as { definitional?: unknown };
  const sizing = linkSizing(edge);
  if (isIdentityPartialLink(edge)) return 'identity';
  if (sizing === 'user') return 'yours';
  // Science 393023 LICENCE ruling 1: a projected mean is unsized even beside an estimate's magnitude or natural effect.
  if (sizing === 'placeholder') return 'placeholder';
  // ⛔ A link that holds BY DEFINITION (a part of a total, #2445; money lost to a risk, #2386) is arithmetic, never
  // anyone's estimate, though it carries `olumi_estimate` (DL #2445 condition 1; CODEX 5930239704).
  if (p.definitional === true) return 'definition';
  if (sizing === 'olumi_estimate' || sizing === 'olumi_accepted') return 'estimate';
  return 'unmarked';
}

export const IDENTITY_ONLY = {
  brief: 'how strongly follows from your two figures: ‘{outcome}’ is ‘{operandA}’ × ‘{operandB}’, at today’s ‘{other operand}’.',
  olumi: 'how strongly is by Olumi’s reading: ‘{outcome}’ = ‘{operandA}’ × ‘{operandB}’. Confirm it.',
} as const;
export const IDENTITY_PART = {
  brief: 'following from your two figures',
  olumi: 'by Olumi’s reading of ‘{outcome}’',
} as const;

function identityWords(edge: EdgeLike, graph: GraphLike | undefined, part: boolean): string {
  const p = edge.provenance as { identity_partial: { outcome: string; operand_ids: string[]; authored_by: string } };
  const i = p.identity_partial;
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : []) as { id: string; label?: string; unit?: string; observed_state?: { raw_value?: number; value?: number; unit?: string } }[];
  const node = (id: string) => nodes.find(n => n.id === id);
  const label = (id: string) => node(id)?.label ?? id;
  const otherId = i.operand_ids.find(id => id !== edge.from) ?? '';
  const other = node(otherId), os = other?.observed_state;
  const amount = os?.raw_value ?? os?.value;
  const values: Record<string, string> = {
    outcome: label(i.outcome), operandA: label(i.operand_ids[0] ?? ''), operandB: label(i.operand_ids[1] ?? ''),
    'other operand': `${label(otherId)}${typeof amount === 'number' ? `: ${sayFigure(amount, os?.unit ?? other?.unit ?? '')}` : ''}`,
  };
  const who = i.authored_by === 'olumi' ? 'olumi' : 'brief';
  return (part ? IDENTITY_PART[who] : IDENTITY_ONLY[who]).replace(/\{([^}]+)\}/gu, (_, key: string) => values[key] ?? key);
}

const ONLY: Record<Who, string> = {
  identity: IDENTITY_ONLY.olumi,
  yours: 'how strongly is as you stated it.',
  definition: 'how strongly is fixed by definition: one for one.',
  estimate: 'how strongly is Olumi\'s estimate.',
  placeholder: 'how strongly is not known yet: Olumi used a placeholder strength, not an estimate.',
  unmarked: 'who set its strength is not recorded.',
};
const PART: Record<Who, string> = {
  identity: IDENTITY_PART.olumi,
  yours: 'as you stated it',
  definition: 'fixed by definition',
  estimate: 'Olumi\'s estimate',
  placeholder: 'a placeholder',
  unmarked: 'without a record of who set the strength',
};

/** The clause after "which changes …;" for the links a newly added factor was committed with. */
export function howStronglyWords(edges: readonly EdgeLike[], graph?: GraphLike): string {
  const kinds = (['yours', 'definition', 'identity', 'estimate', 'placeholder', 'unmarked'] as const).filter((k) => edges.some((e) => whoSized(e) === k));
  if (kinds.length === 1) return kinds[0] === 'identity' ? edges.filter(e => whoSized(e) === 'identity').map(e => identityWords(e, graph, false)).join(' ') : ONLY[kinds[0]!];
  if (kinds.length === 0) return ONLY.unmarked;
  const parts = kinds.flatMap(k => k === 'identity'
    ? [...new Set(edges.filter(e => whoSized(e) === 'identity').map(e => `partly ${identityWords(e, graph, true)}`))]
    : [`partly ${PART[k]}`]);
  const guessed = kinds.includes('estimate') || kinds.includes('placeholder');
  return `how strongly is ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}${guessed ? ', not a measurement' : ''}.`;
}
