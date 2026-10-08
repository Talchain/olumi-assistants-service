import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { boundedLinkEffectText, hasLinkEffectRange } from '../../agent-lane/link-effect-figures.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type ApplyLinkEffectEditParams } from '../link-effect-edit.js';
import { prepareLinkEffectUnitReadings, type LinkEffectClarificationReading } from '../link-effect-unit-reading.js';

const graph = {
  goal_node_id: 'profit',
  nodes: [
    { id: 'profit', kind: 'goal', label: 'Daily profit' },
    { id: 'price', kind: 'factor', label: 'Café price',
      observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: '£', source: 'user_override' } },
    { id: 'margin', kind: 'factor', label: 'Gross margin',
      observed_state: { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'user_override' } },
  ],
  edges: [{ from: 'price', to: 'margin', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9,
    effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
};
const quote = 'Raising the café price by £1 will increase gross margin by 5%.';
const effect = { amount: 5, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£' };
const clarification = { node_id: 'margin', quote, answer: 'percentage points' };
const params = (marker: LinkEffectClarificationReading | null = clarification): ApplyLinkEffectEditParams => {
  const reading = { persistedGraph: graph, from: 'price', to: 'margin', effect, quote,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, 'price', 'margin')! },
    ...(marker !== null ? { clarification: marker } : {}),
  };
  return { ...reading, reading_token: linkEffectReadingToken(reading) };
};

describe('same-endpoint points answer bound into canonical approval', () => {
  it('settles the stored sentence without changing its literal figure or verbatim quote', () => {
    expect(prepareLinkEffectUnitReadings(graph, 'price', 'margin', effect, quote, { clarification })).toEqual({
      unit_readings: [], points_at_zero: ['margin'],
    });
    const result = applyLinkEffectEdit(params());
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const held = result.mutatedGraph as { edges: { provenance: { source_quote: string; natural_effect: { amount: number; amount_unit: string } } }[] };
    expect(held.edges[0]!.provenance.source_quote).toBe(quote);
    expect(held.edges[0]!.provenance.natural_effect.amount).toBe(5);
    expect(held.edges[0]!.provenance.natural_effect.amount_unit).toBe('percentage points');
  });

  it('the existing bare-percent question and refusal remain unchanged without an answer marker', () => {
    const reading = prepareLinkEffectUnitReadings(graph, 'price', 'margin', effect, quote);
    expect(reading.ask).toContain('5-point rise');
    expect(reading.ask).toContain('5% of today');
    expect(applyLinkEffectEdit(params(null))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it.each([
    { ...clarification, node_id: 'price' },
    { ...clarification, node_id: 'another-link-target' },
    { ...clarification, quote: 'Invented replacement words.' },
    { ...clarification, answer: 'relative' },
    { ...clarification, answer: 'perhaps percentage points' },
    { ...clarification, answer: 'one percentage point' },
  ])('refuses an answer that does not settle this endpoint and original literal figure: %j', marker => {
    expect(applyLinkEffectEdit(params(marker))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a matching stated magnitude may clarify points; neither a changed answer nor an omitted marker can use its token', () => {
    expect(applyLinkEffectEdit(params({ ...clarification, answer: 'five percentage points' })).kind).toBe('mutated');
    const approved = params();
    expect(applyLinkEffectEdit({ ...approved, clarification: { ...clarification, answer: 'relative' } })).toMatchObject({
      kind: 'refused', reason: 'reading_not_confirmed',
    });
    expect(applyLinkEffectEdit({ ...approved, clarification: undefined })).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
  });

  it.each(['at least', 'at least +', 'no less than', 'more than', 'at most'])('the %s bound stays refused even after an explicit points answer', bound => {
    const boundedQuote = `Raising the café price by £1 will increase gross margin by ${bound} 5%.`;
    const approved = { ...params(), quote: boundedQuote, clarification: { ...clarification, quote: boundedQuote } };
    const reading = { ...approved, reading_token: linkEffectReadingToken(approved) };
    expect(applyLinkEffectEdit(reading)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a bounded current level does not refuse a separate definite effect and its explicit points answer', () => {
    const baselineQuote = 'Current gross margin is at least 30%, and raising the café price by £1 will increase gross margin by 5%.';
    const approved = { ...params(), quote: baselineQuote, clarification: { ...clarification, quote: baselineQuote } };
    expect(applyLinkEffectEdit({ ...approved, reading_token: linkEffectReadingToken(approved) }).kind).toBe('mutated');
  });

  it.each(['higher', 'lower', 'extra'])('recognizes the %s comparative as a change bound rather than a current level', comparative => {
    const boundedQuote = comparative === 'extra'
      ? 'Raising the café price by £1 leaves gross margin with at least 5 extra percentage points.'
      : `Raising the café price by £1 leaves gross margin at least 5 percentage points ${comparative}.`;
    expect(boundedLinkEffectText(boundedQuote)).toBe('at least 5');
    expect(hasLinkEffectRange(boundedQuote)).toBe(true);
  });

  it.each(['higher', 'lower', 'extra'])('a %s comparative bound cannot become a canonical size after choosing points', comparative => {
    const boundedQuote = `Raising the café price by £1 leaves gross margin at least 5% ${comparative}.`;
    const approved = { ...params(), quote: boundedQuote,
      clarification: { ...clarification, quote: boundedQuote },
      ...(comparative === 'lower' ? { effect: { ...effect, amount: -5 }, reversal: { from: 'positive' as const, to: 'negative' as const } } : {}),
    };
    const result = applyLinkEffectEdit({ ...approved, reading_token: linkEffectReadingToken(approved) });
    expect(result).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
});
