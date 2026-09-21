/**
 * 1.16 item A2 — buildRescaleCapPendingActions: the pending action that
 * carries the rescale chip's structured {value, unit, cap} across the
 * clarify turn, plus the parse round-trip for the new optional `cap`.
 */

import { describe, expect, it } from 'vitest';

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { RESCALE_EXTEND_CAP_CHIP_ID } from '../../compose/validation-failure-responses.js';
import type { ValidationError } from '../../routing/validator.js';
import { parsePendingAction } from '../pending-action.js';
import { buildRescaleCapPendingActions } from '../rescale-cap-pending.js';

const CAP_ERROR: ValidationError = {
  code: 'PARAMETER_INVALID',
  message: "Value £250,000 exceeds the factor's cap of £200,000.",
  details: {
    parameter: 'value',
    rejection_reason: 'value_exceeds_cap',
    issue: "Value £250,000 exceeds the factor's cap of £200,000.",
    handler_id: 'set_factor_value',
    value: 250000,
    unit: '£',
    operator: 'set',
    factor_id: 'fac_migration',
    factor_label: 'Migration Cost',
    suggested_cap: 320000,
  },
};

function responseWithChip(present: boolean): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'honest copy',
    blocks: [],
    suggested_actions: present
      ? [
          {
            id: RESCALE_EXTEND_CAP_CHIP_ID,
            label: 'Set to £250,000 and extend the scale',
            message: 'Extend the scale for Migration Cost and use the new value.',
          },
        ]
      : [],
    insights: [],
    stage_indicator: 'frame',
  };
}

describe('buildRescaleCapPendingActions (item A2, 1.16)', () => {
  it('builds one set_factor_value pending carrying {value, unit, cap} keyed by the chip id', () => {
    const pendings = buildRescaleCapPendingActions({
      error: CAP_ERROR,
      response: responseWithChip(true),
      scenarioId: 'scn-1',
      currentGraphHash: 'hash-abc',
      nowMs: Date.parse('2026-07-10T00:00:00.000Z'),
    });
    expect(pendings.length).toBe(1);
    const pa = pendings[0]!;
    expect(pa.chip_id).toBe(RESCALE_EXTEND_CAP_CHIP_ID);
    expect(pa.action).toMatchObject({
      kind: 'set_factor_value',
      factor_id: 'fac_migration',
      value: 250000,
      unit: '£',
      operator: 'set',
      cap: 320000,
    });
    expect(pa.preconditions.graph_hash).toBe('hash-abc');
    expect(pa.preconditions.target_entity_ids).toEqual(['fac_migration']);
    // Round-trips through the persistence parser with the cap intact.
    const parsed = parsePendingAction(JSON.parse(JSON.stringify(pa)));
    expect(parsed).not.toBeNull();
    expect((parsed!.action as { cap?: number }).cap).toBe(320000);
  });

  it('fail-closed: no pending without the chip on the wire', () => {
    expect(
      buildRescaleCapPendingActions({
        error: CAP_ERROR,
        response: responseWithChip(false),
        scenarioId: 'scn-1',
        currentGraphHash: 'hash-abc',
      }),
    ).toEqual([]);
  });

  it('fail-closed: no pending without a live graph hash (resumer would refuse it anyway)', () => {
    expect(
      buildRescaleCapPendingActions({
        error: CAP_ERROR,
        response: responseWithChip(true),
        scenarioId: 'scn-1',
        currentGraphHash: null,
      }),
    ).toEqual([]);
  });

  it('fail-closed: only value_exceeds_cap with a set operator qualifies', () => {
    const deltaError: ValidationError = {
      ...CAP_ERROR,
      details: { ...CAP_ERROR.details, operator: 'increase' },
    };
    expect(
      buildRescaleCapPendingActions({
        error: deltaError,
        response: responseWithChip(true),
        scenarioId: 'scn-1',
        currentGraphHash: 'hash-abc',
      }),
    ).toEqual([]);
  });

  it('parse refuses a non-finite or non-positive cap', () => {
    const base = buildRescaleCapPendingActions({
      error: CAP_ERROR,
      response: responseWithChip(true),
      scenarioId: 'scn-1',
      currentGraphHash: 'hash-abc',
    })[0]!;
    const bad = JSON.parse(JSON.stringify(base)) as { action: { cap?: unknown } };
    bad.action.cap = -1;
    expect(parsePendingAction(bad)).toBeNull();
    bad.action.cap = 'lots';
    expect(parsePendingAction(bad)).toBeNull();
  });
});
