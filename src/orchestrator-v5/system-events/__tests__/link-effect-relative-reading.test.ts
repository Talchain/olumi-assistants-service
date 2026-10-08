/** RC2a: a carried relative reading is context; conversion from a stored percentage is forbidden. */
import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { linkEffectReadingOf } from '../../agent-lane/approval-chips.js';
import type { StructuredProposal } from '../../agent-lane/proposal.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type LinkEffectStatement } from '../link-effect-edit.js';
import { readLinkEffectClarificationAnswer, type LinkEffectClarificationReading } from '../link-effect-unit-reading.js';

type Rec = Record<string, any>;
const QUOTE = 'Raising prices by £1 will cut daily visits by 5%.';
const effect = (amount: number): LinkEffectStatement => ({ amount, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'GBP' });
function graph(level?: number): Rec {
  return { nodes: [
    { id: 'margin', kind: 'goal', label: 'Gross margin', observed_state: { raw_value: 50, value: 0.5, cap: 100, unit: '%', source: 'brief_extraction' } },
    { id: 'prices', kind: 'factor', label: 'Prices', observed_state: { raw_value: 3, value: 0.3, cap: 10, unit: 'GBP', source: 'brief_extraction' } },
    { id: 'daily_visits', kind: 'factor', label: 'Daily visits', observed_state: { ...(level === undefined ? {} : { raw_value: level, value: level / 100 }), cap: 100, unit: '%', source: 'brief_extraction' } },
  ], edges: [
    { from: 'prices', to: 'daily_visits', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative', provenance: { source: 'cee_hypothesis' } },
    { from: 'daily_visits', to: 'margin', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
  ] };
}
function write(g: Rec, stated: LinkEffectStatement, quote: string, reading: LinkEffectClarificationReading) {
  const shown = { from: 'prices', to: 'daily_visits', effect: stated, quote, clarification: reading };
  return applyLinkEffectEdit({ persistedGraph: g, ...shown,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'prices', 'daily_visits')! },
    reading_token: linkEffectReadingToken(shown), frameRefit: true });
}
function card(stated: LinkEffectStatement, quote: string, reading: LinkEffectClarificationReading) {
  return linkEffectReadingOf({ operations: [{ op: 'set_link_effect', value: { from: 'prices', to: 'daily_visits', effect: stated, quote, clarification: reading } }] } as StructuredProposal,
    { from: 'Prices', to: 'Daily visits' });
}

describe('RC2a relative clarification supplies no stored figure', () => {
  it.each([[100, -5], [80, -4], [undefined, -5]])('stored percentage + relative at current %j cannot write %s points', (level, amount) => {
    const reading: LinkEffectClarificationReading = { node_id: 'daily_visits', quote: QUOTE, answer: 'relative', from_id: 'prices', to_id: 'daily_visits',
      statement_classification: 'asserted', source_text: QUOTE };
    const g = graph(level);
    expect(readLinkEffectClarificationAnswer(reading, effect(amount), QUOTE)).toBe(false);
    expect(card(effect(amount), QUOTE, reading)).toBeUndefined();
    expect(write(g, effect(amount), QUOTE, reading)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it.each([200, 400])('the current model level %s cannot convert a stored percentage into a count', level => {
    const g = graph(level);
    g.nodes[2].observed_state = { raw_value: level, value: level / 1000, cap: 1000, unit: 'visits per day', source: 'cee_inference' };
    const reading: LinkEffectClarificationReading = { node_id: 'daily_visits', quote: QUOTE, answer: 'relative', from_id: 'prices', to_id: 'daily_visits',
      statement_classification: 'asserted', source_text: QUOTE };
    const converted = { ...effect(-level / 20), amount_unit: 'visits per day' };
    expect(card(converted, QUOTE, reading)).toBeUndefined();
    expect(write(g, converted, QUOTE, reading).kind).toBe('refused');
  });

  it('a current count answer states its own size in the link terms, independently of relative context', () => {
    const g = graph(200);
    g.nodes[2].observed_state = { raw_value: 200, value: 0.2, cap: 1000, unit: 'visits per day', source: 'cee_inference' };
    const quote = 'about 4 fewer visits a day';
    const reading: LinkEffectClarificationReading = { node_id: 'daily_visits', quote, answer: quote, source_text: quote,
      current_turn: true, reading: 'relative', from_id: 'prices', to_id: 'daily_visits', statement_classification: 'asserted' };
    const stated = { ...effect(-4), amount_unit: 'visits per day' };
    expect(readLinkEffectClarificationAnswer(reading, stated, quote)).toBe(true);
    expect(card(stated, quote, reading)).toContain('4 visits per day');
    const out = write(g, stated, quote, reading);
    expect(out.kind, JSON.stringify(out)).toBe('mutated');
    if (out.kind !== 'mutated') return;
    expect((out.mutatedGraph as Rec).edges[0].provenance).toMatchObject({ source_quote: quote,
      natural_effect: { amount: -4, amount_unit: 'visits per day', per_source_change: 1 } });
  });

  it('a current relative percent still asks for a figure in the link terms', () => {
    const quote = 'about 5%';
    const reading: LinkEffectClarificationReading = { node_id: 'daily_visits', quote, answer: quote, source_text: quote,
      current_turn: true, reading: 'relative', from_id: 'prices', to_id: 'daily_visits', statement_classification: 'asserted' };
    expect(readLinkEffectClarificationAnswer(reading, effect(-4), quote)).toBe(false);
    expect(card(effect(-4), quote, reading)).toBeUndefined();
    expect(write(graph(80), effect(-4), quote, reading).kind).toBe('refused');
  });
});
