/**
 * ⭐ R1 S4-core (goal consumers): a goal stated as a CHANGE from today ("cut the cloud bill by 15%") is stored as one —
 * `goal_threshold_frame: 'change_rel'`, `goal_threshold_raw: -0.15` (a fraction) — and every reader must honour that.
 *
 * Two failure classes, one row each per site, each beside a CONTROL that differs ONLY in the frame:
 *   · a DOOR that writes a LEVEL target would silently turn the user's change into a level (the Agent's proposer, the
 *     canvas `goal_target_edit` door, the `add_constraint` success-target write). Each refuses by name,
 *     `goal_is_a_change`, and writes nothing.
 *   · a SAYER that prints "<raw><unit>" would say "-0.15 GBP per month". Each says the change instead:
 *     "down 15% from today" (`sayGoalChange`).
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import { sayGoalChange } from '../limit-frame.js';
import { goalNotCheckedLine } from '../break-even.js';
import { formatGoalTargetNotSavedText } from '../../compose/goal-target-receipt-guard.js';
import { applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { createAddConstraintHandler } from '../../tools/handlers/add-constraint.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { ProposalAction } from '../../routing/types.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440215';
type Frame = 'level' | 'change_rel';
/** The goal as S4-core admission writes "cut the monthly bill by 15%" (change) or "get it to £38,250" (level). */
const goalFields = (frame: Frame) => (frame === 'change_rel'
  ? { goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.15, goal_threshold: -0.15, goal_threshold_unit: 'GBP per month' }
  : { goal_threshold_frame: 'level', goal_threshold_raw: 38250, goal_threshold: 0.85, goal_threshold_unit: 'GBP per month', goal_threshold_cap: 45000 });

describe('S4C sayers: a change goal is said as the change, never as the stored fraction', () => {
  const figure = (v: number, u: string | undefined) => `${v} ${u ?? ''}`.trim();

  it('S4C-1: sayGoalChange — change_rel −0.15 → "down 15% from today"; change_abs 5000 → "up 5000 GBP from today"; a level → undefined', () => {
    expect(sayGoalChange('change_rel', -0.15, 'GBP per month', figure)).toBe('down 15% from today');
    expect(sayGoalChange('change_rel', 0.1, '£', figure)).toBe('up 10% from today');
    expect(sayGoalChange('change_abs', 5000, 'GBP', figure)).toBe('up 5000 GBP from today');
    expect(sayGoalChange('change_abs', -2, 'points', figure)).toBe('down 2 points from today');
    for (const frame of ['level', undefined, 'delta', 'nonsense']) expect(sayGoalChange(frame, -0.15, 'GBP', figure)).toBeUndefined();
  });

  it('S4C-1b (AIQ 5880974047): the HELD comparator is said — "down at least 15%", strict "more than" — never read as exactly 15%', () => {
    expect(sayGoalChange('change_rel', -0.15, '£', figure, '<=')).toBe('down at least 15% from today');
    expect(sayGoalChange('change_rel', -0.15, '£', figure, '<')).toBe('down more than 15% from today');
    expect(sayGoalChange('change_rel', 0.1, '£', figure, '>=')).toBe('up at least 10% from today');
    expect(sayGoalChange('change_rel', 0.1, '£', figure, '>')).toBe('up more than 10% from today');
    expect(sayGoalChange('change_abs', 5000, 'GBP', figure, '>=')).toBe('up at least 5000 GBP from today');
    // A ceiling on a rise / a floor on a fall reads the other way round (the limits' one table, `changeWords`).
    expect(sayGoalChange('change_rel', 0.1, '£', figure, '<=')).toBe('up no more than 10% from today');
    // CONTROL: no held comparator, or a direction word that is not a comparator, says no bound (as before).
    expect(sayGoalChange('change_rel', -0.15, '£', figure)).toBe('down 15% from today');
    expect(sayGoalChange('change_rel', -0.15, '£', figure, 'minimise')).toBe('down 15% from today');
  });

  const graphOf = (frame: Frame) => ({ nodes: [
    { id: 'bill', kind: 'goal', label: 'Cloud bill', ...goalFields(frame) },
  ], edges: [] });
  const NOT_CONVERTIBLE = { enrichment: { decision_brief: { warning_codes: ['GOAL_THRESHOLD_NOT_CONVERTIBLE'] } } };

  it('S4C-2 RED: the unchecked-target line says "(down 15% from today)", never "-0.15"', () => {
    const said = goalNotCheckedLine(graphOf('change_rel'), NOT_CONVERTIBLE);
    expect(said).toBe('Your Cloud bill target (down 15% from today) is not checked yet: the model has no current Cloud bill figure to measure it against.');
    expect(said).not.toMatch(/-0\.15|0\.15/);
  });

  it('S4C-2 CONTROL: the same goal as a LEVEL is said exactly as before ("target of <money>")', () => {
    expect(goalNotCheckedLine(graphOf('level'), NOT_CONVERTIBLE)).toMatch(/^Your Cloud bill target of \S*38,250\S* is not checked yet: /);
  });

  it('S4C-3 RED: the "not saved" receipt names the surviving change as a change', () => {
    const text = formatGoalTargetNotSavedText(graphOf('change_rel'));
    expect(text).toContain('your previous target (down 15% from today) is still registered');
    expect(text).not.toMatch(/-0\.15/);
  });

  it('S4C-2/3 held: with the goal\'s held "<=" both sentences say "down at least 15% from today"', () => {
    const held = { nodes: [{ id: 'bill', kind: 'goal', label: 'Cloud bill', ...goalFields('change_rel'), goal_direction: '<=' }], edges: [] };
    expect(goalNotCheckedLine(held, NOT_CONVERTIBLE)).toContain('Your Cloud bill target (down at least 15% from today) is not checked yet');
    expect(formatGoalTargetNotSavedText(held)).toContain('your previous target (down at least 15% from today) is still registered');
  });

  it('S4C-3 CONTROL: a surviving LEVEL target is said as before', () => {
    expect(formatGoalTargetNotSavedText(graphOf('level'))).toContain('your previous target of 38250GBP per month is still registered');
  });
});

describe('S4C doors: nothing writes a LEVEL target over a goal stated as a change', () => {
  const SAID = 'We need the monthly cloud bill to be at most £38,250.';
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf([], SAID), user_turn_text: SAID };
  const agentGraph = (frame: Frame) => ({
    nodes: [
      { id: 'dec', kind: 'decision', label: 'Cloud decision' },
      { id: 'ri', kind: 'factor', label: 'Reserved instance share', observed_state: { value: 0.2, raw_value: 20, unit: '%', cap: 100 } },
      { id: 'bill', kind: 'goal', label: 'Cloud bill', ...goalFields(frame) },
    ],
    edges: [{ from: 'ri', to: 'bill', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }],
  });
  const worldOf = (frame: Frame) => {
    const sent: unknown[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: agentGraph(frame), graph_hash: 'h1' } };
      sent.push(body);
      return { status: 500, json: {} };
    };
    return { d, sent };
  };
  const propose = (frame: Frame) => {
    const w = worldOf(frame);
    const store = new ProposalStore();
    return createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_most', value: 38250, unit: '£', rationale: 'The user said so.' })
      .then((p) => ({ p, w, store }));
  };

  it('S4C-4 RED: the Agent\'s proposer refuses goal_is_a_change — nothing prepared, nothing sent, and never a level offered', async () => {
    const { p, w, store } = await propose('change_rel');
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'goal_is_a_change' }));
    expect(String(p.detail)).toMatch(/change from today/);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('S4C-4 CONTROL: the same words over the same goal stated as a LEVEL → the target change is prepared', async () => {
    const { p } = await propose('level');
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
  });

  it('S4C-5 RED: the Agent reads a change target in words — `in_words` "down 15% from today" beside the stored fraction', async () => {
    const s = await createAgentCapabilities(worldOf('change_rel').d, new ProposalStore()).getCanonicalState(ctx);
    const goal = (s as unknown as { goals?: { id: string; target?: Record<string, unknown> }[]; goal?: { target?: Record<string, unknown> } });
    const target = goal.goals?.find((g) => g.id === 'bill')?.target ?? goal.goal?.target;
    expect(target, JSON.stringify(s).slice(0, 600)).toEqual(expect.objectContaining({ value: -0.15, frame: 'change_rel', in_words: 'down 15% from today' }));
  });

  it('S4C-5 held: the Agent reads the held bound too — "down at least 15% from today"', async () => {
    const d: InternalDispatch = async (path) => (path.endsWith('/graph')
      ? { status: 200, json: { graph: { ...agentGraph('change_rel'), nodes: agentGraph('change_rel').nodes.map((n) => (n.kind === 'goal' ? { ...n, goal_direction: '<=' } : n)) }, graph_hash: 'h1' } }
      : { status: 500, json: {} });
    const s = await createAgentCapabilities(d, new ProposalStore()).getCanonicalState(ctx);
    const goal = (s as unknown as { goals?: { id: string; target?: Record<string, unknown> }[]; goal?: { target?: Record<string, unknown> } });
    const target = goal.goals?.find((g) => g.id === 'bill')?.target ?? goal.goal?.target;
    expect(target).toEqual(expect.objectContaining({ in_words: 'down at least 15% from today' }));
  });

  it('S4C-5 CONTROL: a LEVEL target carries no `in_words` (its value is already the level)', async () => {
    const s = await createAgentCapabilities(worldOf('level').d, new ProposalStore()).getCanonicalState(ctx);
    const goal = (s as unknown as { goals?: { id: string; target?: Record<string, unknown> }[]; goal?: { target?: Record<string, unknown> } });
    const target = goal.goals?.find((g) => g.id === 'bill')?.target ?? goal.goal?.target;
    expect(target, JSON.stringify(s).slice(0, 600)).toEqual(expect.objectContaining({ value: 38250 }));
    expect(target).not.toHaveProperty('in_words');
  });

  /** The D1 fixture with its goal carrying the frame, through the schema exactly as the turn path hands it on. */
  const d1Graph = (frame: Frame): GraphV3T => {
    const g = buildD1Fixture() as unknown as { nodes: { kind: string }[] };
    g.nodes = g.nodes.map((n) => (n.kind === 'goal' ? { ...n, ...goalFields(frame) } : n));
    const parsed = GraphV3.safeParse(g);
    if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues[0])}`);
    return parsed.data;
  };
  const goalIdOf = (g: GraphV3T) => g.nodes.find((n) => n.kind === 'goal')!.id;

  const editDoor = (frame: Frame) => {
    const graph = d1Graph(frame);
    const event = { kind: 'goal_target_edit', goal_node_id: goalIdOf(graph), constraint_type: 'at_least', raw_value: 30, unit: '%',
      base_graph_hash: computeAnalysisAffectingGraphHash(graph as never) };
    return applyGoalTargetEdit({
      payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: 'turn-s4c', stage: 'frame', event } as never,
      event: event as never, requestId: 'req-s4c', persistedGraph: graph, priorFacts: [],
    });
  };

  it('S4C-6 RED: the canvas goal_target_edit door refuses goal_is_a_change, and writes nothing', async () => {
    expect(goalOf(d1Graph('change_rel')), 'PRECONDITION: the schema keeps the change frame').toMatchObject({ goal_threshold_frame: 'change_rel' });
    expect(await editDoor('change_rel')).toEqual({ kind: 'refused', reason: 'goal_is_a_change' });
  });

  it('S4C-6 CONTROL: the same edit on a LEVEL goal passes the door (it is not refused as a change)', async () => {
    const r = await editDoor('level') as { kind: string; reason?: string };
    expect(r.reason).not.toBe('goal_is_a_change');
    expect(r.kind).not.toBe('base_hash_diverged');
  });

  const goalOf = (graph: unknown) => (graph as { nodes: { kind: string; [k: string]: unknown }[] }).nodes.find((n) => n.kind === 'goal')!;
  const targetWrite = (graph: GraphV3T): HandlerInvocation => ({
    context: { session_id: 'scn-s4c', stage: 'frame', request_id: 'req-s4c', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
    payload: { kind: 'message', scenario_id: 'scn-s4c', turn_id: 'turn-s4c', stage: 'frame', message: 'Make the target at least 30%' } as unknown as HandlerInvocation['payload'],
    requestId: 'req-s4c',
    signal: new AbortController().signal,
    orientationText: '',
    proposal: {
      handler_id: 'add_constraint',
      entity: { id: goalIdOf(graph), kind: 'goal', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 30, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    } as unknown as ProposalAction,
    graphForTurn: graph,
  });

  it('S4C-7 RED: add_constraint\'s success-target write refuses goal_is_a_change, with a sentence the user can read', async () => {
    await expect(createAddConstraintHandler()(targetWrite(d1Graph('change_rel')))).rejects.toMatchObject({
      // The D1 error boundary wraps it; the user's sentence rides as `specific_issue` (`error-boundary.ts`).
      name: 'HandlerInvocationFailedError',
      details: { reason: 'goal_is_a_change', specific_issue: 'This goal is a change from today, so it cannot be set as a level here.' },
    });
  });

  it('S4C-7 CONTROL: the same write on a LEVEL goal lands the level target', async () => {
    const out = await createAddConstraintHandler()(targetWrite(d1Graph('level')));
    expect(goalOf(out.mutated_graph)).toMatchObject({ goal_threshold_raw: 30 });
  });
});
