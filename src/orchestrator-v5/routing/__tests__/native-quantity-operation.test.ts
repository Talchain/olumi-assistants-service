/**
 * The write for a native option quantity. Its whole job is to add two fields
 * without destroying the six already there, and without ever touching the
 * encoded value the engine computes on.
 */
import { describe, expect, it } from 'vitest';

import {
  buildNativeQuantityOperation,
  readExistingIntervention,
} from '../native-quantity-operation.js';

/** A realistic cell: encoded value plus the metadata the draft path writes. */
const CELL = {
  value: 0.7,
  source: 'user_specified',
  target_match: { node_id: '85dd1a1d', match_type: 'exact_id', confidence: 'high' },
  value_confidence: 'medium',
  reasoning: 'from the brief',
  display_value: '0.7',
};

const WRITE = {
  optionId: 'opt_tech_lead',
  optionLabel: 'Hire a Tech Lead',
  factorId: '85dd1a1d',
  factorLabel: 'Hiring Cost',
  nativeValue: 95000,
  unit: 'GBP',
};

const graph = (cell: unknown, optionId = 'opt_tech_lead') => ({
  nodes: [
    { id: '85dd1a1d', kind: 'factor', label: 'Hiring Cost' },
    { id: optionId, kind: 'option', label: 'Hire a Tech Lead', data: { interventions: { '85dd1a1d': cell } } },
  ],
});

describe('buildNativeQuantityOperation — adds two fields, destroys none', () => {
  const op = buildNativeQuantityOperation(WRITE, CELL)!;

  it('⭐ PRESERVES every existing field — the defect the reused builder would cause', () => {
    // `buildOptionEffectRawOperation` emits `value: { value }`, a whole-object
    // replacement that would drop all five of these.
    expect(op.value).toEqual({
      ...CELL,
      raw_value: 95000,
      unit: 'GBP',
    });
  });

  it('⛔ NEVER touches the encoded value the engine computes on', () => {
    // Writing 95000 into `value` would move a [0,1] intervention to 95,000.
    expect((op.value as Record<string, unknown>).value).toBe(0.7);
  });

  it('records the native beside it, not instead of it', () => {
    const v = op.value as Record<string, unknown>;
    expect(v.raw_value).toBe(95000);
    expect(v.unit).toBe('GBP');
  });

  it('targets the exact cell by identity', () => {
    expect(op.path).toBe('/nodes/opt_tech_lead/data/interventions/85dd1a1d');
    expect(op.op).toBe('update_node');
  });

  it('carries a real before-state, not null', () => {
    expect(op.old_value).toEqual(CELL);
  });

  it('replaces a stale native rather than duplicating it', () => {
    const withOld = buildNativeQuantityOperation(WRITE, { ...CELL, raw_value: 1, unit: 'USD' })!;
    const v = withOld.value as Record<string, unknown>;
    expect(v.raw_value).toBe(95000);
    expect(v.unit).toBe('GBP');
  });
});

describe('buildNativeQuantityOperation — refuses rather than minting a half cell', () => {
  it('refuses when the cell does not exist', () => {
    expect(buildNativeQuantityOperation(WRITE, null)).toBeNull();
  });

  it('refuses when there is no encoded value to restate', () => {
    // This records a native restatement OF something. With no encoded value
    // there is nothing to restate and nothing to preserve.
    expect(buildNativeQuantityOperation(WRITE, { source: 'user_specified' })).toBeNull();
  });

  it('refuses a non-finite native figure', () => {
    expect(buildNativeQuantityOperation({ ...WRITE, nativeValue: Number.NaN }, CELL)).toBeNull();
  });
});

describe('readExistingIntervention — binds by identity', () => {
  it('reads the cell under data.interventions', () => {
    expect(readExistingIntervention(graph(CELL), 'opt_tech_lead', '85dd1a1d')).toEqual(CELL);
  });

  it('reads a cell held directly on the node', () => {
    const g = {
      nodes: [{ id: 'opt_a', kind: 'option', interventions: { f1: CELL } }],
    };
    expect(readExistingIntervention(g, 'opt_a', 'f1')).toEqual(CELL);
  });

  it('refuses when the id resolves to a node of the WRONG KIND', () => {
    const g = { nodes: [{ id: 'opt_a', kind: 'factor', interventions: { f1: CELL } }] };
    expect(readExistingIntervention(g, 'opt_a', 'f1')).toBeNull();
  });

  it('refuses a DUPLICATE id — two hits are not a referent', () => {
    const g = {
      nodes: [
        { id: 'opt_a', kind: 'option', interventions: { f1: CELL } },
        { id: 'opt_a', kind: 'option', interventions: { f1: { value: 0.2 } } },
      ],
    };
    expect(readExistingIntervention(g, 'opt_a', 'f1')).toBeNull();
  });

  it('refuses when the factor cell is absent', () => {
    expect(readExistingIntervention(graph(CELL), 'opt_tech_lead', 'other_factor')).toBeNull();
  });
});
