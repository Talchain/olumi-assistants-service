/**
 * Recovery Batch C — a strict comparison reaches the engine and the Run record AS STATED (ruling 16: "preserve strict
 * comparisons"; amendment 5: marketing's conversion is ABOVE 15%, not at least 15%).
 *
 * Before C, the stored row kept `operator: '>='` + `operator_as_stated: '>'`, the PLoT-bound copy dropped the stated
 * comparator, and the Run-input snapshot dropped any `>`/`<` row (schemas 0.82.0 had no strict member). PLoT
 * (recovery/batchC-plot) and ISL (recovery/batchC-isl) now score `>`/`<` exactly, with ties; schemas 0.83.0 records them.
 */
import { describe, expect, it } from 'vitest';

import { buildRunInputSnapshot } from '../run-input-snapshot.js';
import { wireGoalConstraints } from '../run-analysis.js';

type Rec = Record<string, unknown>;

const graph = {
  nodes: [
    { id: 'goal_customers', kind: 'goal', label: 'New customers in the first three months after launch',
      goal_threshold: 0.2, goal_threshold_raw: 20, goal_threshold_unit: 'customers', goal_direction: '>=', goal_threshold_frame: 'level' },
    { id: 'conversion', kind: 'factor', label: 'Conversion rate over the first three months after launch',
      observed_state: { value: 0.1, raw_value: 10, unit: '%', source: 'cee_inference' } },
    { id: 'opt_ai', kind: 'option', label: 'AI planning plus advertising' },
  ],
  edges: [{ from: 'conversion', to: 'goal_customers', strength: { mean: 0.4, std: 0.1 } }],
};

// The PLoT-bound rows for marketing's two targets: conversion ABOVE 15% (strict) AND at least 20 customers.
const sentRows: Rec[] = [
  { constraint_id: 'target:conversion', node_id: 'conversion', operator: '>', value: 15, unit: '%', value_frame: 'level', label: 'Conversion rate' },
  { constraint_id: 'target:goal_customers', node_id: 'goal_customers', operator: '>=', value: 20, unit: 'customers', value_frame: 'level', label: 'New customers' },
  { constraint_id: 'limit:spend', node_id: 'spend', operator: '<', value: 100000, unit: 'GBP', value_frame: 'level', label: 'Annual spend' },
];

const input = (constraints: Rec[]) => ({
  submittedOptions: [{ option_id: 'opt_ai', label: 'AI planning plus advertising' }],
  rawObjectsPerOption: [{}],
  wirePerOption: [{}],
  heldFactorIdsByOptionId: new Map<string, Set<string>>(),
  optionsNotSent: [],
  wireGraph: graph,
  plotPayload: { graph, options: [], goal_node_id: 'goal_customers', request_id: 'req-c', goal_constraints: constraints },
});

describe('Batch C — the Run-input snapshot records a strict target as stated (ruling 16)', () => {
  it('RED before C: "above 15%" and "under £100,000" are recorded with ">" and "<", beside the ">=" row, in sent order', () => {
    const s = buildRunInputSnapshot(input(sentRows));
    expect(s).not.toBeNull();
    expect(s!.constraints.map((c) => [c.constraint_id, c.operator, c.raw, c.frame])).toEqual([
      ['target:conversion', '>', 15, 'level'],
      ['target:goal_customers', '>=', 20, 'level'],
      ['limit:spend', '<', 100000, 'level'],
    ]);
  });

  it('CONTROL: an operator outside the four ASCII comparisons is still not recorded (never coerced)', () => {
    const s = buildRunInputSnapshot(input([{ ...sentRows[0]!, operator: '≥' }, sentRows[1]!]));
    expect(s!.constraints.map((c) => c.constraint_id)).toEqual(['target:goal_customers']);
  });
});

describe('Batch C — the PLoT-bound copy carries the comparator the user stated (ruling 16; PLoT #448)', () => {
  const stored: Rec[] = [
    { constraint_id: 'agent-lane:conversion:>=', node_id: 'conversion', operator: '>=', operator_as_stated: '>', value: 15, unit: '%', value_frame: 'level' },
    { constraint_id: 'agent-lane:churn:<=', node_id: 'churn', operator: '<=', operator_as_stated: '<', value: 4, unit: '%', value_frame: 'level' },
    { constraint_id: 'agent-lane:cost:<=', node_id: 'cost', operator: '<=', value: 200000, unit: 'GBP', value_frame: 'level' },
  ];

  it('RED before C: "above" travels as ">" and "under" as "<", with no operator_as_stated key; an inclusive row is unchanged', () => {
    const wire = wireGoalConstraints(stored) as Rec[];
    expect(wire.map((c) => [c.constraint_id, c.operator])).toEqual([
      ['agent-lane:conversion:>=', '>'],
      ['agent-lane:churn:<=', '<'],
      ['agent-lane:cost:<=', '<='],
    ]);
    for (const row of wire) expect(row).not.toHaveProperty('operator_as_stated');
    expect(wire[2]).toEqual(stored[2]);
  });

  it('the stored rows are never touched (the wire is a copy)', () => {
    const before = JSON.stringify(stored);
    wireGoalConstraints(stored);
    expect(JSON.stringify(stored)).toBe(before);
  });

  it('a stated comparator that disagrees with the held bound is not sent strict (fail closed to the held, inclusive bound)', () => {
    // A ">" beside a "<=" is a malformed pair: the held ceiling is never flipped into a floor.
    const [row] = wireGoalConstraints([{ constraint_id: 'x', node_id: 'n', operator: '<=', operator_as_stated: '>', value: 1 }]) as Rec[];
    expect(row).toEqual({ constraint_id: 'x', node_id: 'n', operator: '<=', value: 1 });
  });

  it('CONTROL: an array with nothing to change is returned as the SAME reference', () => {
    const plain = [stored[2]!];
    expect(wireGoalConstraints(plain)).toBe(plain);
  });
});
