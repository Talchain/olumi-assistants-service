/** RC2 reviewer reproduction: an ordinary carried relative percentage is converted from the current model level. */
import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../link-effect-edit.js';
import { prepareLinkEffectUnitReadings, readOrdinaryLinkEffectRelative, type LinkEffectClarificationReading } from '../link-effect-unit-reading.js';

type Rec = Record<string, any>;
const QUOTE = 'Raising prices by £1 will cut daily visits by 5%.';
const effect = (amount: number) => ({ amount, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'GBP' });
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
const clarification = (level: number): LinkEffectClarificationReading => ({ node_id: 'daily_visits', quote: QUOTE, answer: 'relative', from_id: 'prices', to_id: 'daily_visits',
  statement_classification: 'asserted', source_text: QUOTE,
  relative: { percent: -5, current_level: level, current_level_unit: '%', from_id: 'prices', to_id: 'daily_visits' },
} as LinkEffectClarificationReading);
function write(g: Rec, amount: number, reading: LinkEffectClarificationReading) {
  const shown = { from: 'prices', to: 'daily_visits', effect: effect(amount), quote: QUOTE, clarification: reading };
  return applyLinkEffectEdit({ persistedGraph: g, ...shown,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'prices', 'daily_visits')! },
    reading_token: linkEffectReadingToken(shown), frameRefit: true });
}

describe('RC2 ordinary carried relative effect', () => {
  it.each([[100, -5], [80, -4]])('R4 RED: café percentage + relative at current %s%% writes the converted %s points', (level, amount) => {
    const g = graph(level);
    const reading = clarification(level);
    expect(prepareLinkEffectUnitReadings(g, 'prices', 'daily_visits', effect(amount), QUOTE, { clarification: reading }).ask).toBeUndefined();
    const out = write(g, amount, reading);
    expect(out.kind, JSON.stringify(out)).toBe('mutated');
    if (out.kind !== 'mutated') return;
    expect((out.mutatedGraph as Rec).edges[0].provenance.natural_effect).toMatchObject({ amount, amount_unit: 'percentage points' });
  });

  it('R4 RED: relative with an unknown current level asks one current-level question and cannot write', () => {
    const g = graph();
    const reading = { node_id: 'daily_visits', quote: QUOTE, answer: 'relative' };
    const prepared = prepareLinkEffectUnitReadings(g, 'prices', 'daily_visits', effect(-5), QUOTE, { clarification: reading });
    expect(prepared.ask).toMatch(/current level.*Daily visits/i);
    expect(prepared.ask?.match(/\?/g)).toHaveLength(1);
    expect(write(g, -5, reading).kind).toBe('refused');
  });

  it('R4 CONTROL: a stored normalized current level converts in its model frame, without inventing a raw level', () => {
    const g = graph(80);
    delete g.nodes[2].observed_state.raw_value;
    const read = readOrdinaryLinkEffectRelative(g, 'prices', 'daily_visits', effect(-5), QUOTE, 'relative');
    expect(read).toMatchObject({ kind: 'answer', effect: { amount: -4, amount_unit: 'percentage points' },
      clarification: { relative: { current_level: 80, current_level_unit: '%' } } });
  });

  it('R4 CONTROL: a relative change in a counted target converts into that target’s current model units', () => {
    const g = graph(200);
    g.nodes[2].observed_state = { raw_value: 200, value: 0.2, cap: 1000, unit: 'visits per day', source: 'cee_inference' };
    const read = readOrdinaryLinkEffectRelative(g, 'prices', 'daily_visits', effect(-5), QUOTE, 'relative');
    expect(read).toMatchObject({ kind: 'answer', effect: { amount: -10, amount_unit: 'visits per day' },
      clarification: { relative: { current_level: 200, current_level_unit: 'visits per day' } } });
    if (read?.kind !== 'answer') return;
    const shown = { from: 'prices', to: 'daily_visits', effect: read.effect, quote: QUOTE, clarification: read.clarification };
    const out = applyLinkEffectEdit({ persistedGraph: g, ...shown,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'prices', 'daily_visits')! },
      reading_token: linkEffectReadingToken(shown), frameRefit: true });
    expect(out.kind, JSON.stringify(out)).toBe('mutated');
  });

  it('R4 CONTROL: the writer rechecks the current model level and the exact link, refusing forged conversion bases', () => {
    const g = graph(80);
    expect(write(g, -5, clarification(100))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    const wrong = clarification(80) as Rec;
    wrong.relative.to_id = 'margin';
    expect(write(g, -4, wrong as LinkEffectClarificationReading)).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
});
