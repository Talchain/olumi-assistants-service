import { unitPhraseFamily } from './unit-conflict.js';
import type { AdmittedNode } from './admit-model.js';
import type { AdmittedEdge } from './admit-candidate.js';
import { figureTheUserWroteFor, figureTheUserWroteForSpan, sentenceNamesOtherQuantity, wordsOf, sameWord } from './stated-by-user.js';

/** The ONE figure authority, scoped to this cause→effect pair; the receipt is the brief's own sentence. */
export function naturalSizeReceipt(amount: number, unit: unknown, brief: string | undefined,
  source: string, target: string, quantities: readonly string[], sourceUnit?: unknown, perSourceChange: number | null | undefined = 1): string | null {
  if (brief === undefined || perSourceChange !== 1 || unitPhraseFamily(sourceUnit) === 'currency') return null;
  const others = quantities.filter(q => q !== source && q !== target);
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(brief)) {
    const sentence = segment.trim();
    const span = figureTheUserWroteForSpan(Math.abs(amount), unit, sentence, {
      target: [source, target], others, strict: true,
    });
    if (span === null) continue;
    // A current count or price is not a coefficient. The same occurrence must
    // follow a per-one source statement, with no intervening quantity/figure.
    const prefix = sentence.slice(0, span.start);
    const perOne = /\b(?:each|every)\s+(?:1(?:\.0+)?\s*%?\s+)?[\p{L} -]+?\s+(?:also\s+)?(?:adds?|costs?|removes?|loses?|enables?)\s*(?:(?:about|around|roughly|approximately|between)\s*)?$/iu.exec(prefix);
    if (perOne === null) continue;
    const sourcePhrase = perOne[0].replace(/\s+(?:also\s+)?(?:adds?|costs?|removes?|loses?|enables?)\s*(?:(?:about|around|roughly|approximately|between)\s*)?$/iu, '');
    const effect = sourcePhrase + ' ' + sentence.slice(span.start, span.end);
    if (!figureTheUserWroteFor(Math.abs(amount), unit, effect, {
      target: [source], others: others.filter(q => q !== target), strict: true, requireNamed: true, rivals: [],
    })) continue;
    if (sentenceNamesOtherQuantity(sourcePhrase, unit, { target: [source], others })) continue;
    const destination = sentence.slice(span.start);
    if (!figureTheUserWroteFor(Math.abs(amount), unit, destination, {
      target: [target], others, strict: true, requireNamed: true, rivals: [],
    })) continue;
    // A general outcome name (e.g. monthly revenue) may name a scoped product's
    // destination. A different quantity with its own qualifier may not.
    const destinationOthers = others.filter(q => !wordsOf(q).every(w => wordsOf(target).some(t => sameWord(t, w))));
    if (sentenceNamesOtherQuantity(destination, unit, { target: [target], others: destinationOthers })) continue;
    return sentence;
  }
  return null;
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
    const source = nodes.find(n => n.id === e.from);
    if (e.provenance?.magnitude === 'user_stated' && e.provenance.natural_effect !== undefined && source !== undefined
      && naturalSizeReceipt(e.provenance.natural_effect.amount, e.provenance.natural_effect.amount_unit, brief,
        source.label, outcome!.label, nodes.filter(n => !['option', 'decision'].includes(n.kind)).map(n => n.label),
        source.observed_state?.unit, e.provenance.natural_effect.per_source_change) !== null) return e;
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
