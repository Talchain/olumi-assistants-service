import { describe, expect, it } from 'vitest';
import { RunDeltaInputChangeSchema } from '@talchain/schemas/boundary';
import type { NodeV3T, InterventionV3T } from '../../../schemas/cee-v3.js';
import { buildInterventionDetail } from '../../../cee/transforms/analysis-ready.js';
import { buildRunInputSnapshot } from '../../tools/handlers/run-input-snapshot.js';
import { diffRunInputSnapshots } from '../run-input-changes.js';

const factor = (over: Partial<NodeV3T> = {}): NodeV3T => ({
  id: 'price', kind: 'factor', label: 'Pro price',
  scale_frame: 200,
  observed_state: { value: 0.245, raw_value: 49, unit: '£' },
  ...over,
});

function cell(value: number, raw: number | undefined, unit?: string): InterventionV3T {
  return {
    value,
    ...(raw !== undefined ? { raw_value: raw } : {}),
    ...(unit !== undefined ? { unit } : {}),
    source: 'user_specified',
    target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' },
  };
}

function snapshot(node: NodeV3T, intervention: InterventionV3T, target = 55000, mean = 0.1) {
  const wireGraph = {
    nodes: [node, {
      id: 'goal', kind: 'goal', label: 'MRR',
      goal_threshold_raw: target, goal_threshold_unit: '£/month', goal_direction: '>=',
    }],
    edges: [{ from: node.id, to: 'goal', strength: { mean, std: 0.1 } }],
  };
  const plotPayload = { graph: wireGraph, goal_node_id: 'goal' };
  const result = buildRunInputSnapshot({
    submittedOptions: [{ option_id: 'raise', label: 'Raise price' }],
    rawObjectsPerOption: [{ [node.id]: intervention }],
    wirePerOption: [{ [node.id]: intervention.value }],
    heldFactorIdsByOptionId: new Map(), optionsNotSent: [], wireGraph, plotPayload,
  });
  expect(result).not.toBeNull();
  return result!;
}

function optionRow(node: NodeV3T, before: InterventionV3T, after: InterventionV3T) {
  const rows = diffRunInputSnapshots(snapshot(node, before), snapshot(node, after));
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row).toMatchObject({ entity_kind: 'option_setting', field: 'value', entity_id: node.id, option_id: 'raise' });
  expect(RunDeltaInputChangeSchema.safeParse(row).success).toBe(true);
  expect(Object.keys(row.before!).sort()).toEqual(['raw', 'unit']);
  expect(Object.keys(row.after!).sort()).toEqual(['raw', 'unit']);
  return row;
}

function receipt(node: NodeV3T, intervention: InterventionV3T, carried = intervention.raw_value) {
  const detail = buildInterventionDetail(node.id, intervention.value, node, intervention, carried, false);
  return { raw: detail.raw_value, unit: detail.unit };
}

describe('run_delta option-setting rows use the canonical user frame', () => {
  it('J1-shape: cap 100, 0.10 → 0.12 carries 10% → 12% and equals each canonical receipt', () => {
    const node = factor({
      id: 'existing_customer_price_change', label: 'Existing customer price change', scale_frame: undefined,
      observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%' },
    });
    const before = cell(0.10, 10, '%');
    const after = cell(0.12, 12, '%');
    const row = optionRow(node, before, after);
    expect(row.before).toEqual({ raw: 10, unit: '%' });
    expect(row.after).toEqual({ raw: 12, unit: '%' });
    expect(row.before).toEqual(receipt(node, before));
    expect(row.after).toEqual(receipt(node, after));
  });

  it.each(['£', undefined])('no-range: scale_frame 200 with cell unit %s carries £49 → £59, never the model level', (unit) => {
    const node = factor();
    expect(node.observed_state).not.toHaveProperty('cap');
    const before = cell(0.245, 0.245, unit);
    const after = cell(0.295, 0.295, unit);
    const row = optionRow(node, before, after);
    expect(row.before).toEqual({ raw: 49, unit: '£' });
    expect(row.after).toEqual({ raw: 59, unit: '£' });
    // raw_value === value is an unframed model carrier; ask the canonical reader to derive the amount.
    expect(row.before).toEqual(receipt(node, { ...before, raw_value: undefined }));
    expect(row.after).toEqual(receipt(node, { ...after, raw_value: undefined }));
    expect(snapshot(node, before).options[0]!.settings[0]!.encoded).toBe(0.245);
    expect(snapshot(node, after).options[0]!.settings[0]!.encoded).toBe(0.295);
  });

  it('a missing raw carrier also derives the amount from the canonical factor frame', () => {
    const node = factor();
    const before = cell(0.245, undefined, '£');
    const after = cell(0.295, undefined, '£');
    const row = optionRow(node, before, after);
    expect(row.before).toEqual(receipt(node, before));
    expect(row.after).toEqual(receipt(node, after));
    expect(row.after).toEqual({ raw: 59, unit: '£' });
  });

  it('preserves a genuine option-native amount, including zero, ahead of the factor frame', () => {
    const node = factor();
    const before = cell(0.245, 0, '£');
    const after = cell(0.295, 75, '£');
    const row = optionRow(node, before, after);
    expect(row.before).toEqual({ raw: 0, unit: '£' });
    expect(row.after).toEqual({ raw: 75, unit: '£' });
    expect(row.before).toEqual(receipt(node, before));
    expect(row.after).toEqual(receipt(node, after));
  });

  it('preserves an unframed authored quantity when no factor frame can derive one', () => {
    const node = factor({ scale_frame: undefined, observed_state: undefined });
    const row = optionRow(node, cell(49, 49, '£'), cell(59, 59, '£'));
    expect(row.before).toEqual({ raw: 49, unit: '£' });
    expect(row.after).toEqual({ raw: 59, unit: '£' });
  });

  it('contrast: goal and link rows remain byte-for-byte identical when option user-frame values move', () => {
    const node = factor();
    const before = cell(0.245, 0.245, '£');
    const after = cell(0.295, 0.295, '£');
    const contrast = diffRunInputSnapshots(snapshot(node, before, 55000, 0.1), snapshot(node, before, 60000, 0.55));
    const changed = diffRunInputSnapshots(snapshot(node, before, 55000, 0.1), snapshot(node, after, 60000, 0.55));
    const nonOption = changed.filter((row) => row.entity_kind !== 'option_setting');
    expect(contrast.map((row) => row.entity_kind)).toEqual(['goal', 'link']);
    expect(changed.filter((row) => row.entity_kind === 'option_setting')).toHaveLength(1);
    expect(JSON.stringify(nonOption)).toBe(JSON.stringify(contrast));
    expect(contrast.map((row) => [row.field, row.before, row.after])).toEqual([
      ['target', { raw: 55000, unit: '£/month' }, { raw: 60000, unit: '£/month' }],
      ['strength', { raw: 'slight' }, { raw: 'strong' }],
    ]);
  });
});
