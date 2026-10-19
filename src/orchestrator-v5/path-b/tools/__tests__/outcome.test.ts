/**
 * PATH-B ONE TYPED OUTCOME: the row the runner records is exactly the VERIFIER kit's `_agent.tool_calls` shape
 * (`redteam/core-accept/check-core.mjs`), and an unconfirmed write is never a claimed one. SYNTHETIC values.
 */
import { describe, expect, it } from 'vitest';
import { ToolOutcomeSchema, ok, refused, traceRow, unavailable } from '../outcome.js';

const KIT_ROW_KEYS = ['mutated', 'name', 'ok', 'outcome', 'ran', 'refusal'];

describe('one typed outcome, one kit row', () => {
  it.each([
    ['a read', ok({ x: 1 }), { ok: true, mutated: false, outcome: 'ok', refusal: null, ran: null }],
    ['a write read back', ok({}, { mutated: true }), { ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null }],
    ['a Run on record', ok({}, { ran: true }), { ok: true, mutated: false, outcome: 'ok', refusal: null, ran: true }],
    ['a refusal', refused('superseded'), { ok: false, mutated: false, outcome: 'refused', refusal: 'superseded', ran: null }],
    ['a failed read', unavailable('read_failed'), { ok: false, mutated: false, outcome: 'unavailable', refusal: 'read_failed', ran: null }],
    ['an unconfirmed write', unavailable('not_confirmed', 'unknown'), { ok: false, mutated: null, outcome: 'unavailable', refusal: 'not_confirmed', ran: null }],
  ] as const)('%s', (_name, outcome, row) => {
    expect(ToolOutcomeSchema.parse(outcome)).toEqual(outcome);
    const r = traceRow('a_tool', outcome);
    expect(Object.keys(r).sort()).toEqual(KIT_ROW_KEYS);
    expect(r).toEqual({ name: 'a_tool', ...row });
  });

  it('an unconfirmed write is never a claimed write, and a write without readback is never "ok"', () => {
    expect(traceRow('apply_change', unavailable('not_confirmed', 'unknown')).mutated).toBeNull();
    expect(traceRow('apply_change', unavailable('not_confirmed', 'unknown')).ok).toBe(false);
  });

  it.each(['', 'Not Found', 'read failed', '9lives'])('a reason is a stable code, never words: %j is refused by the schema', (code) => {
    expect(ToolOutcomeSchema.safeParse(refused(code)).success).toBe(false);
  });
});
