import type { AdmittedNode } from './admit-model.js';
import type { AdmittedEdge } from './admit-candidate.js';
import { figureTheUserWroteForSpan } from './stated-by-user.js';

/** The ONE figure authority, scoped to this cause→effect pair; the receipt is the brief's own sentence. */
export function naturalSizeReceipt(amount: number, unit: unknown, brief: string | undefined,
  source: string, target: string, quantities: readonly string[]): string | null {
  const span = figureTheUserWroteForSpan(Math.abs(amount), unit, brief, {
    target: [source, target], others: quantities.filter(q => q !== source && q !== target),
  });
  if (span === null || brief === undefined) return null;
  return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(brief)]
    .find(s => s.index <= span.start && s.index + s.segment.length > span.start)?.segment.trim() ?? null;
}

/** Two independently credited operand levels must be written AS a product, never just present somewhere in the brief. */
function briefProduct(nodes: readonly AdmittedNode[], operands: readonly string[], brief: string | undefined): boolean {
  if (brief === undefined) return false;
  const spans = operands.map(id => {
    const n = nodes.find(n => n.id === id), os = n?.observed_state;
    const raw = os?.raw_value ?? os?.value;
    if (n === undefined || typeof raw !== 'number') return null;
    return figureTheUserWroteForSpan(raw, os?.unit, brief, {
      target: [n.label], others: nodes.filter(x => x.id !== id && x.kind !== 'option' && x.kind !== 'decision').map(x => x.label),
      currentLevel: true, strict: true,
    });
  });
  if (spans.some(s => s === null)) return false;
  const [a, b] = spans.sort((a, b) => a!.start - b!.start);
  if (a === null || b === null || a === undefined || b === undefined) return false;
  const between = brief.slice(a.end, b.start);
  // A relation between the two credited figures in one clause: customers paying a rate, or explicit multiplication.
  return !/[.!?;\n]/u.test(between) && /\b(?:pay(?:s|ing)?|at|times|multiplied\s+by)\b|[×*]/iu.test(between);
}

/** Admission's final product carrier owns this marker. Stated cause→effect sizes retain the existing user path. */
export function markIdentityPartials(nodes: readonly AdmittedNode[], edges: AdmittedEdge[], brief: string | undefined,
  statedPairs: ReadonlySet<string>): AdmittedEdge[] {
  return edges.map(e => {
    const outcome = nodes.find(n => n.id === e.to);
    const identity = outcome?.nonlinear_identity;
    if (identity?.operation !== 'product' || identity.factor_ids.length !== 2 || !identity.factor_ids.includes(e.from)
      || statedPairs.has(`${e.from}::${e.to}`)) return e;
    const other = nodes.find(n => n.id === identity.factor_ids.find(id => id !== e.from));
    const otherLevel = other?.observed_state?.raw_value ?? other?.observed_state?.value;
    if (e.provenance?.magnitude === 'user_stated' && e.provenance.natural_effect?.amount !== otherLevel) return e;
    const { magnitude: _magnitude, natural_effect: _storedAmount, olumi_fit_candidate: _fit,
      mean_projected: _projected, basis: _basis, source_quote: _quote, definitional: _definition, ...kept } = e.provenance ?? { source: 'cee_hypothesis' };
    return { ...e, provenance: { ...kept, identity_partial: {
      outcome: e.to, operand_ids: [...identity.factor_ids], authored_by: briefProduct(nodes, identity.factor_ids, brief) ? 'brief' : 'olumi',
    } } };
  });
}
