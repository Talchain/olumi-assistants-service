/**
 * V5 replay harness — Branch A DB read-back contract self-tests.
 *
 * Pins the PURE `assertSetFactorValuePersisted` contract against
 * synthetic, normalised `v5_handler_facts` rows. The live wrapper
 * (`runSetFactorValueReadback`) is intentionally NOT exercised here — it
 * needs staging Supabase credentials and is run only on the
 * `--db-readback` staging path. This test proves the contract that the
 * live read-back delegates to: applied fact present, target matches,
 * before≠after, and (when supplied) the persisted value equals the
 * proposed user-scale N.
 */

import { describe, it, expect } from 'vitest';

import {
  assertSetFactorValuePersisted,
  type NormalisedHandlerFact,
} from '../../../tools/v5-journey-replay/db-readback.js';

const appliedFact = (over: Partial<NormalisedHandlerFact['result']> = {}): NormalisedHandlerFact => ({
  action_type: 'set_factor_value',
  noop: false,
  result: {
    status: 'applied',
    target_id: 'fac_budget',
    before: { value: 0.4 },
    after: { value: 0.6 },
    ...over,
  },
});

describe('assertSetFactorValuePersisted — passes', () => {
  it('passes on an applied fact targeting a drafted factor with a changed value', () => {
    const r = assertSetFactorValuePersisted([appliedFact()], {
      validTargetIds: ['fac_budget', 'fac_speed'],
    });
    expect(r.ok).toBe(true);
  });

  it('matches the proposed value against after.raw_value', () => {
    const r = assertSetFactorValuePersisted(
      [appliedFact({ before: { value: 0.4, raw_value: 40000 }, after: { value: 0.3, raw_value: 50000 } })],
      { validTargetIds: ['fac_budget'], displayValue: 50000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evidence).toContain('matched_value=50000');
  });

  it('matches the proposed value against a bare numeric after', () => {
    const r = assertSetFactorValuePersisted(
      [appliedFact({ before: 10, after: 15 })],
      { displayValue: 15 },
    );
    expect(r.ok).toBe(true);
  });

  it('accepts an exact target id match', () => {
    const r = assertSetFactorValuePersisted([appliedFact()], { targetId: 'fac_budget' });
    expect(r.ok).toBe(true);
  });
});

describe('assertSetFactorValuePersisted — fails honestly', () => {
  it('fails when no applied set_factor_value fact exists', () => {
    const r = assertSetFactorValuePersisted([
      { action_type: 'set_factor_value', noop: true, result: { status: 'applied' } },
      { action_type: 'set_factor_value', noop: false, result: { status: 'noop' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('db_readback_no_applied_set_factor_value_fact');
  });

  it('fails on exact target id mismatch', () => {
    const r = assertSetFactorValuePersisted([appliedFact()], { targetId: 'fac_other' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('db_readback_target_id_mismatch');
  });

  it('fails when the target is not one of the drafted factors', () => {
    const r = assertSetFactorValuePersisted([appliedFact()], { validTargetIds: ['fac_speed'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('db_readback_target_not_a_known_factor');
  });

  it('fails when before === after (the value did not change)', () => {
    const r = assertSetFactorValuePersisted(
      [appliedFact({ before: { value: 0.5 }, after: { value: 0.5 } })],
      { validTargetIds: ['fac_budget'] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('db_readback_value_unchanged');
  });

  it('fails when before/after are missing', () => {
    const r = assertSetFactorValuePersisted(
      [{ action_type: 'set_factor_value', noop: false, result: { status: 'applied', target_id: 'fac_budget' } }],
      { validTargetIds: ['fac_budget'] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('db_readback_missing_before_after');
  });

  it('fails when the persisted after value does not match the proposed value', () => {
    const r = assertSetFactorValuePersisted(
      [appliedFact({ before: { value: 0.4, raw_value: 40000 }, after: { value: 0.3, raw_value: 49999 } })],
      { validTargetIds: ['fac_budget'], displayValue: 50000 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('db_readback_after_value_mismatch');
  });
});
