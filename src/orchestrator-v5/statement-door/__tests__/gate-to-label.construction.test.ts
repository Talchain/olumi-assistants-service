/**
 * ⭐ CLAIM RECORD at construction (plan converged step 2; DL-3 lease of construction-source-map.ts:490–494): a relayed claim keeps its
 * owner and its bounds. The drafter's statement read as ANOTHER speaker's (with the party's name) is recorded as that party's range,
 * unit and figures, relayed by the user, never the user's and never flattened to speaker-unknown words. SYNTHETIC words.
 */
import { describe, expect, it } from 'vitest';
import { withConstructionStatements } from '../../agent-lane/construction-source-map.js';
import { claimRecordFor, userStatementFor } from '../statements.js';
import { saidByOf } from '../../agent-lane/user-statements.js';

type Rec = Record<string, any>;
const LINK = { kind: 'link' as const, id: 'pre_order', to_id: 'daily_waste', field: 'effect' as const };
const graph = (): Rec & { nodes: unknown[] } => ({ nodes: [
  { id: 'pre_order', kind: 'factor', label: 'Pre-order system in use' },
  { id: 'daily_waste', kind: 'factor', label: 'Daily food waste', observed_state: { value: 40, raw_value: 40, unit: 'kg' } },
], edges: [{ from: 'pre_order', to: 'daily_waste', strength: { mean: -0.3, std: 0.2 }, exists_probability: 0.8, effect_direction: 'negative' }] });
const REPORTED = 'Our kitchen manager reckons switching on pre-orders would cut daily food waste by between 4 and 6 kg.';
const OWN = 'Switching on pre-orders would cut daily food waste by between 4 and 6 kg.';
const entry = (quote: string, speaker: string, extra: Rec = {}): Rec => ({ quote, speaker, field: 'effect', form: 'range', low: 4, high: 6, unit: 'kg',
  subject: { kind: 'link', label: 'Pre-order system in use', to_label: 'Daily food waste', factor_label: null }, value: null, qualifier: null, conditions: null, ...extra });

describe('construction keeps a relayed claim\'s owner and bounds', () => {
  it('a party\'s range: recorded as theirs (name verbatim, relayed by the user) with its ends and unit; never "you said"', () => {
    const brief = `We want less food waste. ${REPORTED}`;
    const out = withConstructionStatements(graph(), [entry(REPORTED, 'other', { party: 'Our kitchen manager' })], brief, '2026-10-18T16:00:00.000Z');
    const st = claimRecordFor(out, LINK)!.statements[0]!;
    expect(st).toMatchObject({ said_by: 'party', party: 'Our kitchen manager', relayed_by: 'user', form: 'range', low: 4, high: 6, unit: 'kg' });
    expect(st).not.toHaveProperty('speaker');
    expect(userStatementFor(out, LINK)).toBeUndefined();
  });

  it('an unplaced speaker\'s range keeps its ends, unresolved — not flattened to words with no figures', () => {
    const brief = `We want less food waste. ${REPORTED}`;
    const out = withConstructionStatements(graph(), [entry(REPORTED, 'unknown')], brief, '2026-10-18T16:00:00.000Z');
    const st = claimRecordFor(out, LINK)!.statements[0]!;
    expect(saidByOf(st)).toBe('unknown');
    expect(st).toMatchObject({ form: 'range', low: 4, high: 6, unit: 'kg' });
    expect(userStatementFor(out, LINK)).toBeUndefined();
  });

  it('CONTROL: the user\'s own range is recorded as theirs, byte for byte as before', () => {
    const brief = `We want less food waste. ${OWN}`;
    const out = withConstructionStatements(graph(), [entry(OWN, 'user')], brief, '2026-10-18T16:00:00.000Z');
    expect(userStatementFor(out, LINK)!.statements[0]).toMatchObject({ speaker: 'user', low: 4, high: 6, unit: 'kg' });
    expect(userStatementFor(out, LINK)!.statements[0]).not.toHaveProperty('said_by');
  });

  it('NEGATIVE: a figure the reported words do not write is never recorded as that party\'s figure', () => {
    const brief = `We want less food waste. ${REPORTED}`;
    const out = withConstructionStatements(graph(), [entry(REPORTED, 'other', { party: 'Our kitchen manager', low: 5, high: 9 })], brief, '2026-10-18T16:00:00.000Z');
    const held = claimRecordFor(out, LINK);
    expect(held?.statements.some((st) => st.low === 5 || st.high === 9) ?? false).toBe(false);
  });
});
