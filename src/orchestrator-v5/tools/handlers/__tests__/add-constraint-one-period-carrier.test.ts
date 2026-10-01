/**
 * ⛔ ONE PERIOD CARRIER — THE ONE ENFORCEMENT POINT (DL 380e54 on #2454 round 3; CODEX overflow 5934135126 P1 ×2).
 *
 * Three CODEX rounds found the unit ↔ period class at a different door each time. The guard now lives ONCE, in the shared
 * `add_constraint` writer, and every door reaches it. These rows bind the doors that do NOT go through the
 * `goal_target_edit` event: chat (the LLM's `add_constraint` tool), a typed `add_constraint` chip
 * (`routing/explicit-constraint-edit.ts`), an approved proposed change and a renewal — all of which the turn executor runs
 * through `resolveHandler(registry, 'add_constraint')`. The rows resolve the handler exactly that way, so a door that
 * reached a different function would not be covered by a green here. The event door's rows are in
 * `system-events/__tests__/set-goal-period-horizon.test.ts`; the Agent card's in `agent-lane/__tests__/`.
 *
 * Bound by IDENTITY: the goal is addressed by id; the other goal-adjacent nodes and the analysis-affecting fields are
 * asserted untouched on a refusal (nothing written = the handler threw before any mutated graph existed).
 */
import { describe, expect, it } from 'vitest';

import { getDefaultRegistry, resolveHandler, type HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

type Json = Record<string, any>;
const GOAL = 'g-revenue';

function invocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-period', stage: 'frame', request_id: 'req-period', prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message', scenario_id: 'scn-period', turn_id: 'turn-period', stage: 'frame',
      message: 'We need at least £70,000 a month.',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-period',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function goalTarget(constraintType: 'at_least' | 'at_most', value: number, unit: string): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: { id: GOAL, kind: 'goal', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [
      { name: 'constraint_type', value: constraintType, source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
      { name: 'unit', value: unit, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

/** The D1 fixture with its goal holding a £ figure per quarter, parsed exactly as the turn path hands it on. */
function goalHolding(goal: Json, rows: Json[] = []): GraphV3T {
  const g = buildD1Fixture() as unknown as { nodes: Json[]; goal_constraints?: Json[] };
  g.nodes = g.nodes.map((n) => (n.id === GOAL ? { ...n, label: 'Revenue', ...goal } : n));
  if (rows.length > 0) g.goal_constraints = [...(g.goal_constraints ?? []), ...rows];
  const parsed = GraphV3.safeParse(g);
  if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues[0])}`);
  return parsed.data;
}

/** The function every turn-executor door resolves. */
const theRegistryHandler = () => {
  const fn = resolveHandler(getDefaultRegistry(), 'add_constraint');
  if (fn === null) throw new Error('registry has no add_constraint handler');
  return fn;
};

async function refusal(graph: GraphV3T, proposal: ProposalAction): Promise<HandlerInvocationFailedError> {
  const before = JSON.stringify(graph);
  const err = await theRegistryHandler()(invocation(graph, proposal)).then(
    (out) => { throw new Error(`expected a refusal, got a write: ${JSON.stringify(out).slice(0, 300)}`); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HandlerInvocationFailedError);
  // The handler works on a clone: the graph it was handed is byte-identical after the refusal.
  expect(JSON.stringify(graph)).toBe(before);
  return err as HandlerInvocationFailedError;
}

const goalOf = (g: unknown): Json => (g as { nodes: Json[] }).nodes.find((n) => n.id === GOAL)!;

describe('ONE PERIOD CARRIER at the shared writer — chat, typed chip, approved change (the registry\'s add_constraint)', () => {
  it('RED (CODEX 5934135126 P1 #2): a goal typed per quarter + a chat/chip floor "£ per month" → REFUSED by the writer, nothing written', async () => {
    const err = await refusal(goalHolding({ goal_threshold_unit: '£', goal_period: 'quarter' }), goalTarget('at_least', 70000, '£ per month'));
    expect(err.details).toMatchObject({ reason_code: 'goal_period_conflicts_with_unit', rejection_reason: 'goal_period_conflicts_with_unit', target_id: GOAL });
    expect(String(err.details.specific_issue)).toMatch(/per quarter/);
  });

  it('RED: the same through a CEILING (at most) — the class is judged for both directions', async () => {
    const err = await refusal(goalHolding({ goal_threshold_unit: '£', goal_period: 'quarter' }), goalTarget('at_most', 70000, '£ per month'));
    expect(err.details.reason_code).toBe('goal_period_conflicts_with_unit');
  });

  it('RED: a ceiling that would sit beside a RETAINED floor row naming another period → refused (the other-direction row is a unit the goal keeps)', async () => {
    const g = goalHolding({ goal_period: 'month', goal_threshold_unit: '£' },
      [{ constraint_id: 'gc-floor-quarter', node_id: GOAL, operator: '>=', value: 200000, unit: '£ per quarter', label: 'Revenue floor' }]);
    const err = await refusal(g, goalTarget('at_most', 90000, '£'));
    expect(err.details.reason_code).toBe('goal_period_conflicts_with_unit');
  });

  it.each([
    ['the unit names the goal\'s own period', { goal_threshold_unit: '£', goal_period: 'quarter' }, '£ per quarter', 'quarter'],
    ['the unit names no period (the typed one is kept)', { goal_threshold_unit: '£', goal_period: 'quarter' }, '£', 'quarter'],
    ['a legacy goal with no typed period', { goal_threshold_unit: '£ per quarter' }, '£ per quarter', undefined],
  ])('CONTROL: %s → written through the same handler', async (_n, goal, unit, period) => {
    const out = await theRegistryHandler()(invocation(goalHolding(goal), goalTarget('at_least', 210000, unit)));
    const g = (out as { mutated_graph?: unknown }).mutated_graph;
    expect(g, JSON.stringify(out).slice(0, 300)).toBeDefined();
    expect(goalOf(g)).toMatchObject({ goal_threshold_raw: 210000, goal_threshold_unit: unit });
    expect(goalOf(g).goal_period).toBe(period);
  });

  it('CONTROL: a non-goal target is not judged by the goal\'s period (the guard is the goal\'s)', async () => {
    const g = goalHolding({ goal_threshold_unit: '£', goal_period: 'quarter' });
    const factor = (g.nodes as Json[]).find((n) => n.kind === 'factor')!;
    const proposal = { ...goalTarget('at_most', 50, '£ per month'),
      entity: { id: factor.id, kind: 'factor', resolution_status: 'resolved', resolution_method: 'id_match' } } as unknown as ProposalAction;
    const out = await theRegistryHandler()(invocation(g, proposal)).catch((e: unknown) => e);
    expect((out as HandlerInvocationFailedError).details?.reason_code).not.toBe('goal_period_conflicts_with_unit');
  });
});
