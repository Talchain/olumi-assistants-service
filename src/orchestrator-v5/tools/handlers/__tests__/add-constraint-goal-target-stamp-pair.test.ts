/**
 * ⛔ EVERY CEE WRITER OF THE GOAL TARGET WRITES THE PAIR (#1921 post-merge CHANGES_REQUIRED, #69 5834364983).
 *
 * #1921 made CEE's NodeV3 keep the UI's goal stamp — `threshold_source: 'user'` + `success_threshold` — through
 * every turn-path write. The UI reads a stated target from that stamp first (UI `store.ts` ~:2407). The ONE
 * sanctioned CEE writer of an existing goal's target, `add_constraint`'s goal-join (`field-safety.ts` ~:82),
 * rewrote `goal_threshold_raw` and left the stamp at the old figure: a Model-tab 20 %, then "make the target
 * at least 30 %" in chat, showed 30 % in the receipt and 20 % again after a reload and in the Run.
 *
 * The goal-join's own row is `provenance: 'explicit'` (the user stated it), so it writes the pair as the user's:
 * `success_threshold` = the new raw target, `threshold_source: 'user'`.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function invocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-goal', stage: 'frame', request_id: 'req-goal', prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message', scenario_id: 'scn-goal', turn_id: 'turn-goal', stage: 'frame',
      message: 'Make the target at least 30%',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-goal',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function goalTarget(constraintType: 'at_least' | 'at_most', value: number): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: { id: 'g-revenue', kind: 'goal', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [
      { name: 'constraint_type', value: constraintType, source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
      { name: 'unit', value: '%', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

type Goal = { kind: string; goal_threshold_raw?: unknown; success_threshold?: unknown; threshold_source?: unknown };

/** The fixture graph with its goal carrying the UI's Model-tab stamp (a stated 20 %), as the register writes it. */
function stamped(value: number | null = 20): GraphV3T {
  const g = buildD1Fixture() as unknown as { nodes: Goal[] };
  g.nodes = g.nodes.map((n) => (n.kind === 'goal'
    ? { ...n, goal_threshold_raw: 20, goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: 0.2, threshold_source: 'user', success_threshold: value }
    : n));
  // Through the schema, exactly as the turn path hands a persisted graph to a handler.
  const parsed = GraphV3.safeParse(g);
  if (!parsed.success) throw new Error('fixture must parse');
  return parsed.data;
}

const goalOf = (graph: unknown): Goal => (graph as { nodes: Goal[] }).nodes.find((n) => n.kind === 'goal')!;

describe('the goal-join writes the target and its stamp as one pair', () => {
  it('the precondition: the stamped fixture reaches the handler with its stamp (else this proves nothing)', () => {
    expect(goalOf(stamped())).toMatchObject({ threshold_source: 'user', success_threshold: 20, goal_threshold_raw: 20 });
  });

  it('RED: Model-tab 20 % → chat "at least 30 %" → the canonical pair is 30 / user, never a stale 20', async () => {
    const out = await createAddConstraintHandler()(invocation(stamped(), goalTarget('at_least', 30)));
    const goal = goalOf(out.mutated_graph);
    expect(goal.goal_threshold_raw, 'the control: the join still writes the raw target').toBe(30);
    expect(goal.success_threshold).toBe(30);
    expect(goal.threshold_source).toBe('user');
  });

  it('RED: the pair survives the persistence re-parse the next turn applies', async () => {
    const out = await createAddConstraintHandler()(invocation(stamped(), goalTarget('at_least', 30)));
    const reparsed = GraphV3.safeParse(out.mutated_graph);
    expect(reparsed.success).toBe(true);
    expect(goalOf((reparsed as { data: unknown }).data)).toMatchObject({ goal_threshold_raw: 30, success_threshold: 30, threshold_source: 'user' });
  });

  it('RED: a goal with no stamp gets the pair too — every writer of the target writes both', async () => {
    const out = await createAddConstraintHandler()(invocation(buildD1Fixture(), goalTarget('at_least', 15)));
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 15, success_threshold: 15, threshold_source: 'user' });
  });

  it('RED: a cleared UI target (success_threshold null) is replaced by the stated one', async () => {
    const out = await createAddConstraintHandler()(invocation(stamped(null), goalTarget('at_least', 30)));
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 30, success_threshold: 30, threshold_source: 'user' });
  });

  it('CONTRAST: an at_most bound on the goal does not move the target — raw and stamp both stay at 20', async () => {
    const out = await createAddConstraintHandler()(invocation(stamped(), goalTarget('at_most', 30)));
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 20, success_threshold: 20, threshold_source: 'user' });
  });
});

/**
 * ⛔ "ALREADY" MUST MEAN WHAT THE USER SEES (#1924 post-merge CHANGES_REQUIRED, #69 5834662051).
 *
 * The UI writes the stamp WITHOUT the raw target on every stamp-only surface (`setGoalThresholdAndUpdateNode`:
 * DefineSuccessModal, HeroSection, OutputsDock, PreAnalysisPanel, GoalThresholdEditor, SuccessTargetLine), and
 * reads the stamp first. The goal-join called a restatement "unchanged" by comparing the RAW target alone, so a
 * draft 30 % with a UI-set 20 %, then "at least 30 %" in chat, answered "already at least 30 % — no need to
 * change it" and left 20 % on screen, on reload and in the Run.
 */
function diverged(raw: number, stamp: number | null): GraphV3T {
  const g = buildD1Fixture() as unknown as { nodes: Goal[] };
  g.nodes = g.nodes.map((n) => (n.kind === 'goal'
    ? { ...n, goal_threshold_raw: raw, goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: raw / 100, threshold_source: 'user', success_threshold: stamp }
    : n));
  const parsed = GraphV3.safeParse(g);
  if (!parsed.success) throw new Error('fixture must parse');
  return parsed.data;
}
type Out = { mutated_graph: unknown; handler_facts: Array<{ noop?: boolean }>; assistant_text?: string; blocks?: unknown };

describe('a restatement is "unchanged" only when the target the user reads agrees', () => {
  it('RED: raw 30 %, stamp 20 % → chat "at least 30 %" writes 30 / user and is NOT a no-op', async () => {
    const out = (await createAddConstraintHandler()(invocation(diverged(30, 20), goalTarget('at_least', 30)))) as unknown as Out;
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 30, success_threshold: 30, threshold_source: 'user' });
    expect(out.handler_facts[0]?.noop).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/no need to change it/i);
  });

  it('CONTROL (the reviewer\'s): raw 30 %, stamp 20 % → "at least 35 %" writes 35 / 35 / user', async () => {
    const out = (await createAddConstraintHandler()(invocation(diverged(30, 20), goalTarget('at_least', 35)))) as unknown as Out;
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 35, success_threshold: 35, threshold_source: 'user' });
  });

  it('RED: an earlier chat 30 % ROW, then the UI sets 20 % locally, then "at least 30 %" again → 30 / user, not a no-op', async () => {
    const first = (await createAddConstraintHandler()(invocation(buildD1Fixture(), goalTarget('at_least', 30)))) as unknown as Out;
    const g = GraphV3.safeParse(first.mutated_graph);
    if (!g.success) throw new Error('first write must parse');
    expect(g.data.goal_constraints?.some((c) => c.node_id === 'g-revenue' && c.value === 30), 'the precondition: the chat row exists').toBe(true);
    // The UI's stamp-only surface: the stamp moves to 20, raw and the row stay at 30.
    const local = { ...g.data, nodes: g.data.nodes.map((n) => (n.kind === 'goal' ? { ...n, success_threshold: 20, threshold_source: 'user' } : n)) } as GraphV3T;
    const out = (await createAddConstraintHandler()(invocation(local, goalTarget('at_least', 30)))) as unknown as Out;
    expect(out.handler_facts[0]?.noop).toBe(false);
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 30, success_threshold: 30, threshold_source: 'user' });
  });

  it('CONTRAST: raw 30 %, stamp 30 % → "at least 30 %" stays an honest no-op (F9: nothing the user reads moved)', async () => {
    const out = (await createAddConstraintHandler()(invocation(diverged(30, 30), goalTarget('at_least', 30)))) as unknown as Out;
    expect(out.handler_facts[0]?.noop).toBe(true);
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 30, success_threshold: 30 });
  });

  it('CONTRAST: raw 30 %, stamp cleared (null) → "at least 30 %" stays a no-op — the UI reads raw then', async () => {
    const out = (await createAddConstraintHandler()(invocation(diverged(30, null), goalTarget('at_least', 30)))) as unknown as Out;
    expect(out.handler_facts[0]?.noop).toBe(true);
  });
});
