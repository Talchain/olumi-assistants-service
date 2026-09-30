import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileSourceMeaning, sourceEntityId } from './compiler.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { SourceMeaning } from './meaning.js';

const captures = JSON.parse(readFileSync(new URL('./fixtures/repaired-live-source-meaning.json', import.meta.url), 'utf8')) as Array<{ case: string; brief: string; meaning: SourceMeaning }>;
const hiring = () => structuredClone(captures.find((capture) => capture.case === 'E')!);

describe('source-first projection of option-owned quantities', () => {
  it('projects stated hiring counts separately from their options without inventing a baseline or causal model', () => {
    const captured = hiring();
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const options = result.graph.nodes.filter((node) => node.kind === 'option');
    const factors = result.graph.nodes.filter((node) => node.kind === 'factor');
    expect(options).toHaveLength(2);
    expect(factors.map((node) => node.label)).toEqual(['senior engineers to hire', 'junior engineers to hire']);
    expect(factors.every((node) => node.observed_state === undefined)).toBe(true);
    for (const [index, option] of options.entries()) {
      const factor = factors[index];
      expect(option.id).not.toBe(factor.id);
      expect(option.interventions?.[factor.id]).toMatchObject({ raw_value: index === 0 ? 2 : 4,
        unit: index === 0 ? 'senior engineers' : 'junior engineers', source: 'brief_extraction',
        source_quote: index === 0 ? 'hire two senior engineers' : 'four junior engineers' });
      expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: option.id, to: factor.id, origin: 'structural' }));
    }
    expect(result.graph.edges).toHaveLength(4);
    expect(result.graph.edges.filter((edge) => options.some((option) => option.id === edge.from))).toHaveLength(2);
    expect(result.graph.edges.filter((edge) => edge.from === sourceEntityId('d1'))).toHaveLength(2);
    expect(result.graph.nodes.filter((node) => node.kind === 'goal')).toHaveLength(2);
    expect(result.graph.goal_constraints?.[0]).toMatchObject({ value: 400000, operator_as_stated: '<' });
    expect(result.trace.projected_option_quantities).toBe(2);
    expect(result.unresolved.some((finding) => ['intervention_target_unresolved', 'unassigned_change'].includes(finding.code))).toBe(false);
    expect(GraphV3.parse(JSON.parse(JSON.stringify(result.graph)))).toEqual(result.graph);
  });

  it('refuses a counted population that the numeric source does not name', () => {
    const captured = hiring();
    captured.meaning.quantities[0].unit.counted_object = 'sales representatives';
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.some((node) => node.kind === 'factor' && node.label === 'sales representatives')).toBe(false);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))?.interventions).toEqual({});
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'o1', code: 'intervention_target_unresolved' }));
  });

  it('refuses a number borrowed from the competing option', () => {
    const captured = hiring();
    captured.meaning.options[0].interventions[0].quantity_ref = 'q2';
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))?.interventions).toEqual({});
    expect(result.graph.nodes.filter((node) => node.kind === 'factor')).toHaveLength(1);
  });

  it('refuses a target or evidence claim masquerading as an option intervention', () => {
    for (const role of ['target', 'evidence'] as const) {
      const captured = hiring();
      captured.meaning.quantities[0].role = role;
      const result = compileSourceMeaning(captured.brief, captured.meaning);
      expect(result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))?.interventions).toEqual({});
      expect(result.graph.nodes.some((node) => node.kind === 'factor' && node.label === 'senior engineers to hire')).toBe(false);
    }
  });

  it('does not guess a current headcount for a relative hiring change', () => {
    const captured = hiring();
    captured.meaning.quantities[0].role = 'relative_change';
    captured.meaning.quantities[0].frame = 'change_rel';
    captured.meaning.quantities[0].direction = 'increase';
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))?.interventions).toEqual({});
    expect(result.graph.nodes.every((node) => node.observed_state === undefined)).toBe(true);
  });

  it('does not turn existing workforce into new hires even if extraction says proposed level', () => {
    const captured = hiring();
    captured.brief = 'We already have two senior engineers.';
    const source = { quote: 'already have two senior engineers', start: null, end: null };
    captured.meaning.entities = [{ ...captured.meaning.entities.find((entity) => entity.ref === 'o1')!, source }];
    captured.meaning.quantities = [{ ...captured.meaning.quantities[0], number: { ...captured.meaning.quantities[0].number, source } }];
    captured.meaning.options = [{ ...captured.meaning.options[0], interventions: [{ ...captured.meaning.options[0].interventions[0], source }] }];
    captured.meaning.unknowns = [];
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.filter((node) => node.kind === 'factor')).toHaveLength(0);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))?.interventions).toEqual({});
    expect(result.trace.projected_option_quantities).toBe(0);
  });

  it('does not treat a negated hire action as a positive hiring count', () => {
    const captured = hiring();
    captured.brief = captured.brief.replace('Should we hire', 'Should we not hire');
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.filter((node) => node.kind === 'factor')).toHaveLength(0);
    expect(result.trace.projected_option_quantities).toBe(0);
  });

  it('uses stable source references when display labels change', () => {
    const captured = hiring();
    const before = compileSourceMeaning(captured.brief, captured.meaning);
    captured.meaning.entities.find((entity) => entity.ref === 'o1')!.label = 'Staffing route A';
    const after = compileSourceMeaning(captured.brief, captured.meaning);
    expect(after.graph.nodes.filter((node) => node.kind === 'factor').map((node) => node.id))
      .toEqual(before.graph.nodes.filter((node) => node.kind === 'factor').map((node) => node.id));
  });
});
