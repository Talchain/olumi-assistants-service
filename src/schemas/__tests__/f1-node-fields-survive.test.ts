/**
 * ⭐ F1 T1 (MG; F5 I1.1 "goal period/horizon … held byte-equal after reload"): the CEE strict NodeV3 mirror KEEPS every
 * `@talchain/schemas` 0.69.0 semantic field. RED before T1: `NodeV3` strips undeclared keys, so each field written by
 * `goal_target_edit` / `option_status_edit` / construction vanished on the next re-parse.
 */
import { describe, expect, it } from 'vitest';
import { NodeV3 } from '../cee-v3.js';

const FIELDS = {
  goal_period: 'month',
  goal_horizon: { deadline: '2027-03-31' },
  goal_stated_as: [{ value: 100000, unit: 'GBP', period: 'quarter', quote: 'about £100k a quarter today' }],
  option_status: 'removed',
  count_noun: 'deals',
  full_label: 'Number of qualified sales conversations booked per month',
} as const;
const node = { id: 'goal_revenue', kind: 'goal', label: 'Revenue' };

describe('F1 T1: the CEE NodeV3 mirror keeps the 0.69.0 semantic fields', () => {
  it.each(Object.entries(FIELDS))('RED: %s survives a re-parse byte-equal', (key, value) => {
    const parsed = NodeV3.parse({ ...node, [key]: value }) as Record<string, unknown>;
    expect(parsed[key]).toStrictEqual(value);
  });
  it.each([
    ['goal_period', 'fortnight'], ['goal_horizon', { months: 0 }], ['goal_stated_as', []],
    ['option_status', 'maybe'], ['count_noun', '100 conversations'], ['full_label', ''],
  ])('a malformed %s is DROPPED, never a reason to refuse the stored graph', (key, bad) => {
    const parsed = NodeV3.safeParse({ ...node, [key]: bad });
    expect(parsed.success).toBe(true);
    expect(key in (parsed.data as Record<string, unknown>) && (parsed.data as Record<string, unknown>)[key] !== undefined).toBe(false);
  });
  it('CONTROL: a pre-0.69.0 node parses unchanged, nothing fabricated', () => {
    const parsed = NodeV3.parse(node) as Record<string, unknown>;
    for (const key of Object.keys(FIELDS)) expect(parsed[key]).toBeUndefined();
  });
});
