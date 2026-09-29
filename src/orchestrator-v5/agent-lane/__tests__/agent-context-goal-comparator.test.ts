/**
 * Canonical row 5 (#72 5881225605): the Agent's context omitted the goal's COMPARATOR. The served goal holds
 * `goal_direction: '>='` beside its £100k target ("reach at least"), yet `get_canonical_state` carried the target's
 * value, unit and frame only — so the Agent could not tell "reach at least £100k" from "stay under £100k" except by
 * guessing from the label. The comparator is read from the persisted field (`readHeldGoalComparator`), never
 * defaulted: absent on the node ⇒ absent in the context.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const served = (JSON.parse(readFileSync(new URL('./fixtures/served-13acc577-linkset-graph.json', import.meta.url), 'utf8')) as { graph: unknown }).graph;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400b1', authenticated_user_id: null, request_id: 'r' };

type N = { id: string; kind: string; goal_direction?: unknown };
const withGoal = (edit: (goal: N) => void): unknown => {
  const g = JSON.parse(JSON.stringify(served)) as { nodes: N[] };
  edit(g.nodes.find((n) => n.kind === 'goal')!);
  return g;
};
const capsOver = (graph: unknown) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
};
type Target = { value?: number; unit?: string; frame?: string; comparator?: string; comparator_in_words?: string };
const targetOf = async (graph: unknown): Promise<Target | undefined> =>
  ((await capsOver(graph).getCanonicalState(ctx)) as { goal?: { target?: Target } }).goal?.target;

describe('row 5: the goal comparator reaches the Agent from the persisted field', () => {
  it('RED: the served goal (MRR ≥ £100k, `goal_direction` ">=") → the target carries ">=" and "at least"', async () => {
    const goal = (served as { nodes: N[] }).nodes.find((n) => n.kind === 'goal')!;
    expect(goal.goal_direction).toBe('>='); // precondition read from the served capture, not constructed
    expect(await targetOf(served)).toEqual(expect.objectContaining({ value: 100000, comparator: '>=', comparator_in_words: 'at least' }));
  });

  it('a held ceiling is said as one — "<" → "less than"', async () => {
    const t = await targetOf(withGoal((g) => { g.goal_direction = '<'; }));
    expect(t).toEqual(expect.objectContaining({ comparator: '<', comparator_in_words: 'less than' }));
  });

  it('CONTRAST: no comparator held → none in the context (never defaulted, never inferred from the label)', async () => {
    const t = await targetOf(withGoal((g) => { delete g.goal_direction; }));
    expect(t).toEqual(expect.objectContaining({ value: 100000 }));
    expect(t).not.toHaveProperty('comparator');
    expect(t).not.toHaveProperty('comparator_in_words');
  });

  it('a value outside the stored four is not a held comparator', async () => {
    const t = await targetOf(withGoal((g) => { g.goal_direction = 'maximise'; }));
    expect(t).not.toHaveProperty('comparator');
  });
});
