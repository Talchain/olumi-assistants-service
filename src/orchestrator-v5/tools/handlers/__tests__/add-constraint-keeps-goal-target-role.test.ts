/**
 * ⛔ AN EDIT OF ONE OF THE GOAL'S TARGETS STAYS A TARGET (SYS1 trace for the DL, 12 Oct; Batch C ruling 15).
 *
 * C stores each of the goal's targets as a `goal_constraints` row marked `role: 'goal_target'` (marketing: conversion
 * above 15% AND at least 20 new customers), and the joint chance reads that marker (`goal-targets-joint.ts`). The chat
 * goal-target writer, `add_constraint`, matches the existing row by node and operator and REBUILDS it from the edit, so
 * the marker it did not restate was dropped: "make it at least 30 customers" turned the goal's own target into a limit,
 * and the joint would then be withheld with a false reason. The rebuilt row now keeps the matched row's `role`.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function invocation(graph: GraphV3T, proposal: ProposalAction, message: string): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-role', stage: 'frame', request_id: 'req-role', prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: { kind: 'message', scenario_id: 'scn-role', turn_id: 'turn-role', stage: 'frame', message } as unknown as HandlerInvocation['payload'],
    requestId: 'req-role',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function edit(nodeId: string, kind: 'goal' | 'factor', constraintType: 'at_least' | 'at_most', value: number, unit: string): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: { id: nodeId, kind, resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [
      { name: 'constraint_type', value: constraintType, source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
      { name: 'unit', value: unit, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

type Row = { constraint_id: string; node_id: string; operator: string; value: number; role?: string; unit?: string };
const GOAL_ROW = 'agent-lane:g-revenue:>=';
const SECOND_TARGET = 'agent-lane:f-quality:>=';
const LIMIT = 'agent-lane:f-budget:<=';

/** The fixture with the goal's two targets and one limit, stored as C stores them, through the graph contract's parse. */
function withTargets(): GraphV3T {
  const g = buildD1Fixture() as unknown as { nodes: Record<string, unknown>[]; goal_constraints?: unknown[] };
  g.nodes = g.nodes.map((n) => (n.kind === 'goal'
    ? { ...n, goal_threshold_raw: 20, goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: 0.2, goal_threshold_frame: 'level' }
    : n));
  g.goal_constraints = [
    { constraint_id: GOAL_ROW, node_id: 'g-revenue', operator: '>=', value: 20, unit: '%', label: 'Revenue', provenance: 'explicit', value_frame: 'level', role: 'goal_target' },
    { constraint_id: SECOND_TARGET, node_id: 'f-quality', operator: '>=', operator_as_stated: '>', value: 15, unit: '%', label: 'Quality', provenance: 'explicit', value_frame: 'level', role: 'goal_target' },
    { constraint_id: LIMIT, node_id: 'f-budget', operator: '<=', value: 100000, unit: 'GBP', label: 'Budget', provenance: 'explicit', value_frame: 'level' },
  ];
  const parsed = GraphV3.safeParse(g);
  if (!parsed.success) throw new Error(`fixture must parse: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
const rowsOf = (graph: unknown): Row[] => ((graph as { goal_constraints?: Row[] }).goal_constraints ?? []);

describe('add_constraint keeps a target row a target when it edits it', () => {
  it('the precondition: the stored fixture carries both targets\' role through the graph contract (else this proves nothing)', () => {
    expect(rowsOf(withTargets()).map((r) => [r.constraint_id, r.role])).toEqual([[GOAL_ROW, 'goal_target'], [SECOND_TARGET, 'goal_target'], [LIMIT, undefined]]);
  });

  it('RED: "at least 30%" on the goal edits its own target row in place and it stays one of the goal\'s targets', async () => {
    const out = await createAddConstraintHandler()(invocation(withTargets(), edit('g-revenue', 'goal', 'at_least', 30, '%'), 'Make the target at least 30%'));
    const rows = rowsOf(out.mutated_graph);
    const goal = rows.find((r) => r.constraint_id === GOAL_ROW);
    expect(goal, 'the control: the edit lands on the same row').toMatchObject({ node_id: 'g-revenue', operator: '>=', value: 30 });
    expect(goal?.role).toBe('goal_target');
    // The other target and the limit are untouched, the limit still a limit.
    expect(rows.find((r) => r.constraint_id === SECOND_TARGET)).toMatchObject({ value: 15, role: 'goal_target' });
    expect(rows.find((r) => r.constraint_id === LIMIT)?.role).toBeUndefined();
    // And it survives the persistence re-parse the next turn applies.
    const reparsed = GraphV3.safeParse(out.mutated_graph);
    expect(reparsed.success).toBe(true);
    expect(rowsOf((reparsed as { data: unknown }).data).find((r) => r.constraint_id === GOAL_ROW)?.role).toBe('goal_target');
  });

  it('CONTRAST: editing a LIMIT never makes it a target', async () => {
    const out = await createAddConstraintHandler()(invocation(withTargets(), edit('f-budget', 'factor', 'at_most', 120000, 'GBP'), 'The budget is now at most £120,000'));
    const limit = rowsOf(out.mutated_graph).find((r) => r.node_id === 'f-budget' && r.operator === '<=');
    expect(limit, 'the control: the limit moved').toMatchObject({ value: 120000 });
    expect(limit?.role).toBeUndefined();
  });
});
