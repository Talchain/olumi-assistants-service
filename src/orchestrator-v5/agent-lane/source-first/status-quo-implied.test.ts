import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { compileSourceMeaning, sourceEntityId } from './compiler.js';
import type { SourceMeaning } from './meaning.js';

const captures: Array<{ case: string; brief: string; meaning: SourceMeaning }> =
  JSON.parse(readFileSync(new URL('./fixtures/repaired-live-source-meaning.json', import.meta.url), 'utf8'));

describe('source-bound implied status quo', () => {
  it.each([
    ['paul-mrr', 'from £49', 'Keep Pro plan price at £49'],
    ['cloud', 'from AWS', 'Stay on AWS'],
    ['support', 'from email', 'Stay on email'],
  ])('replays saved live %s meaning with a separately attributed baseline', (caseId, quote, label) => {
    const captured = captures.find((item) => item.case === caseId)!;
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const graph = GraphV3.parse(JSON.parse(JSON.stringify(result.graph)));
    const implied = graph.nodes.find((node) => node.option_origin === 'status_quo_implied');
    expect(implied).toMatchObject({ kind: 'option', label, is_baseline: true, source_quote: quote, interventions: {} });
    expect(captured.brief.slice(result.source_bindings[`status_quo:o1`].start,
      result.source_bindings[`status_quo:o1`].end)).toBe(quote);
    expect(graph.nodes.filter((node) => node.kind === 'option')).toHaveLength(2);
    expect(graph.nodes.find((node) => node.id === sourceEntityId('o1'))?.option_origin).toBeUndefined();
    if (caseId === 'paul-mrr') {
      expect(implied?.interventions?.[sourceEntityId('f1')]).toMatchObject({
        raw_value: 49, unit: graph.nodes.find((node) => node.id === sourceEntityId('f1'))?.observed_state?.unit,
        source: 'brief_extraction', source_quote: 'from £49',
      });
    }
    const before = GraphV3.parse({ ...graph,
      nodes: graph.nodes.filter((node) => node.id !== implied?.id),
      edges: graph.edges.filter((edge) => edge.from !== implied?.id && edge.to !== implied?.id),
    });
    const beforeCodes = validateGraphStructure(before).violations.map((item) => item.code);
    const afterCodes = validateGraphStructure(graph).violations.map((item) => item.code);
    expect(beforeCodes).toContain('FEWER_THAN_TWO_OPTIONS');
    expect(afterCodes).not.toContain('FEWER_THAN_TWO_OPTIONS');
    // A second option does not authorise a missing scientific relationship.
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
  });

  it('does not manufacture a comparator when today is unstated', () => {
    const brief = 'Should we raise Pro price to £59 a month?';
    const span = (quote: string) => ({ quote, start: null, end: null });
    const meaning: SourceMeaning = {
      entities: [
        { ref: 'decision', kind: 'decision', label: 'Raise Pro price?', source: span(brief) },
        { ref: 'raise', kind: 'option', label: 'Raise Pro price', source: span('raise Pro price to £59 a month') },
        { ref: 'price', kind: 'factor', label: 'Pro price', source: span('raise Pro price to £59 a month') },
      ],
      quantities: [{ ref: 'price_raise', entity_ref: 'price', role: 'proposed_level', frame: 'level', direction: 'none',
        number: { literal: '£59', value: '59', source: span('raise Pro price to £59 a month') },
        unit: { kind: 'currency', currency: 'GBP', period: 'month', counted_object: null, as_stated: '£ a month' },
        comparator: null, horizon_months: null }],
      options: [{ entity_ref: 'raise', is_status_quo: false,
        interventions: [{ entity_ref: 'price', quantity_ref: 'price_raise', source: span('raise Pro price to £59 a month') }] }],
      definitions: [], causal_claims: [], unknowns: [], proposals: [],
    };
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes.filter((node) => node.kind === 'option')).toHaveLength(1);
    expect(result.graph.nodes.some((node) => node.option_origin === 'status_quo_implied')).toBe(false);
    expect(result.proposals).toContainEqual(expect.objectContaining({ kind: 'option', label: 'Keep the current approach' }));

    const fromBrief = 'Should we raise Pro price from £49 to £59 a month?';
    const fromMeaning = structuredClone(meaning);
    fromMeaning.entities[0].source = span(fromBrief);
    fromMeaning.entities[1].source = span('raise Pro price from £49 to £59 a month');
    fromMeaning.entities[2].source = span('raise Pro price from £49 to £59 a month');
    fromMeaning.quantities[0].number.source = span('raise Pro price from £49 to £59 a month');
    fromMeaning.options[0].interventions[0].source = span('raise Pro price from £49 to £59 a month');
    const omittedCurrent = compileSourceMeaning(fromBrief, fromMeaning);
    expect(omittedCurrent.graph.nodes.some((node) => node.option_origin === 'status_quo_implied')).toBe(false);
    expect(omittedCurrent.proposals.some((proposal) => proposal.kind === 'option')).toBe(true);
  });

  it('leaves two explicit hiring alternatives alone', () => {
    const captured = captures.find((item) => item.case === 'E')!;
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.filter((node) => node.kind === 'option')).toHaveLength(2);
    expect(result.graph.nodes.some((node) => node.option_origin === 'status_quo_implied')).toBe(false);
  });
});
