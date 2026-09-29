import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileSourceMeaning, sourceEntityId } from './compiler.js';
import { readNumber } from './source-binding.js';
import type { SourceMeaning } from './meaning.js';
const captures = JSON.parse(readFileSync(new URL('./fixtures/repaired-live-source-meaning.json', import.meta.url), 'utf8')) as Array<{ case: string; brief: string; meaning: SourceMeaning }>;
const source = (quote: string) => ({ quote, start: null, end: null });

describe('captured numeric spellings', () => {
  it.each([['two', '2'], ['four', '4'], ['2 weeks', '2'], ['about 400', '400']])('decodes exact %s without discarding its source', (literal, value) => {
    const quote = `Stated ${literal}.`;
    expect(readNumber(quote, { literal, value, source: source(quote) })).toMatchObject({ value: Number(value), source: { quote } });
  });
  it('refuses a different claimed value or an unspecified range', () => {
    expect(readNumber('We need two.', { literal: 'two', value: '4', source: source('We need two.') })).toBeNull();
    expect(readNumber('We need two to four.', { literal: 'two to four', value: '3', source: source('We need two to four.') })).toBeNull();
  });
  it('keeps annual salary limit without converting annual units into a deadline', () => {
    const captured = captures.find((item) => item.case === 'E')!;
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.goal_constraints?.[0]).toMatchObject({ value: 400000, unit: 'GBP per year', operator_as_stated: '<' });
    expect(result.graph.nodes.every((node) => node.goal_horizon_months === undefined)).toBe(true);
    expect(result.graph.nodes.filter((node) => node.kind === 'factor')).toHaveLength(2);
    expect(result.graph.nodes.filter((node) => node.kind === 'factor').every((node) => node.observed_state === undefined)).toBe(true);
  });
  it('retains approximate support volume and its exact qualifying quote', () => {
    const captured = captures.find((item) => item.case === 'support')!;
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('f3'))?.observed_state).toMatchObject({ raw_value: 400, source_quote: '3 agents handling about 400 tickets a week' });
  });
  it('keeps a two-week duration as weeks rather than a fabricated weeks-per-week rate', () => {
    const captured = captures.find((item) => item.case === 'cloud')!;
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.goal_constraints?.[0]).toMatchObject({ value: 2, unit: 'weeks', source_quote: 'without more than 2 weeks of migration downtime risk.' });
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'q2', code: 'unassigned_change' }));
  });
});
