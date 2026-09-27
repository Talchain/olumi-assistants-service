/**
 * PJ-A2 — executable acceptance for a strategic reasoning/work frame.
 *
 * These are deliberately RED on staging. The source briefs are in the adjacent
 * fixture, with reconstruction disclosed. A model call is stubbed; admission,
 * GraphV3 validation, persisted-form projection, JSON storage and a cold read
 * use the product modules. The separate browser row needs a served build.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { getCanonicalState } from '../tools/get-canonical-state.js';
import { SessionBindingRegistry } from '../session-binding.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { createAddConstraintHandler } from '../../tools/handlers/add-constraint.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { ProposalAction } from '../../routing/types.js';

type Case = {
  id: string;
  source: string;
  candidate_origin: string;
  mode: 'decision' | 'sensemaking';
  brief: string;
  framing: string;
  goal: { metric: string; operator: string; value: number | null; unit: string; horizon_months: number | null; baseline_value: number | null } | null;
  constraint: { metric: string; operator: string; value: number; unit: string } | null;
  factor: { label: string; baseline_value: number | null; unit: string; plausible_max: number };
};

const CASES = JSON.parse(readFileSync(new URL('./fixtures/pj-a2-work-frame-cases.json', import.meta.url), 'utf8')) as Case[];
const byId = (id: string): Case => {
  const found = CASES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`missing ${id} fixture`);
  return found;
};
const SCENARIO = '72727272-7272-4727-8727-727272727272';
const SESSION = 'sess_pj_a2';

function candidateFor(c: Case, includeQuestion = false): CandidateModel {
  const optionLabels = c.id === 'pricing-a'
    ? ['Increase the Pro plan price to £59', 'Keep the Pro plan price at £49']
    : c.id === 'midmarket'
      ? ['Build a dedicated mid-market tier', 'Partner with system integrators', 'Acquire a smaller competitor']
      : [];
  return {
    goal: c.goal === null ? null : {
      metric: c.goal.metric, operator: c.goal.operator, target_stated: c.goal.value !== null,
      value: c.goal.value, unit: c.goal.unit, horizon_months: c.goal.horizon_months,
      provenance: 'explicit', baseline_known: c.goal.baseline_value !== null,
      baseline_value: c.goal.baseline_value, baseline_provenance: 'explicit', scope: null,
    },
    constraints: c.constraint === null ? [] : [{ ...c.constraint, provenance: 'explicit', frame: 'level' }],
    options: optionLabels.map((label, index) => ({
      label, provenance: 'explicit', is_status_quo: c.id === 'pricing-a' && index === 1,
      changes: [c.factor.label],
      interventions: [{ factor_label: c.factor.label, value: c.id === 'pricing-a' ? (index === 0 ? 59 : 49) : 20 + index,
        value_kind: 'absolute', unit: c.factor.unit, provenance: 'explicit' }],
    })),
    factors: [{
      label: c.factor.label, role: 'controllable', baseline_known: c.factor.baseline_value !== null,
      baseline_value: c.factor.baseline_value, unit: c.factor.unit, provenance: 'explicit', plausible_max: c.factor.plausible_max,
    }, ...(c.constraint === null ? [] : [{ label: c.constraint.metric, role: 'observable', baseline_known: false,
      baseline_value: null, unit: c.constraint.unit, provenance: 'explicit', plausible_max: 200 }])],
    risks: [], outcomes: [],
    links: c.goal === null ? [] : [{ from: c.factor.label, to: c.goal.metric, direction: 'positive',
      provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    identities: [], unknowns: [],
    ...(includeQuestion ? { decision_question: c.framing } : {}),
  } as unknown as CandidateModel;
}

type Witness = { stored: GraphV3T; cold: GraphV3T; agent: Awaited<ReturnType<typeof getCanonicalState>> };

async function witness(c: Case, includeQuestion = false): Promise<Witness> {
  const candidate = candidateFor(c, includeQuestion);
  let storedBytes: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      const graph = (body as { graph: unknown }).graph;
      const parsed = GraphV3.parse(projectGraphForPersistence(graph));
      storedBytes = JSON.stringify(parsed);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  let response: Record<string, unknown>;
  try {
    response = await buildModelFromBrief(SCENARIO, c.brief, dispatch, call) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${c.id}: real candidate admission rejected the goal-free work fixture: ${String(error)}`);
  }
  expect(response.ok, `${c.id}: construction must reach the canonical write; ${JSON.stringify(response)}`).toBe(true);
  expect(storedBytes, `${c.id}: no registered graph is not acceptance evidence`).toBeDefined();
  const stored = GraphV3.parse(JSON.parse(storedBytes!));
  const cold = GraphV3.parse(JSON.parse(storedBytes!));
  const sessions = new SessionBindingRegistry();
  sessions.bind(SESSION, null, SCENARIO);
  const identity = computeGraphIdentityHash(cold);
  const agent = await getCanonicalState(
    { scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: null },
    { sessions, readScenario: async () => ({ user_id: null, graph: GraphV3.parse(JSON.parse(storedBytes!)),
      brief_text: c.brief, graph_identity_hash: identity?.value ?? null }) },
  );
  expect(agent.ok).toBe(true);
  return { stored, cold, agent };
}

const goalOf = (g: GraphV3T) => {
  const goals = g.nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return goals[0]! as Record<string, unknown>;
};
const typed = (o: Record<string, unknown>, key: string) => o[key];
const frameRevision = (g: GraphV3T) => computeGraphIdentityHash(g)?.value ?? null;
const frameOf = (g: GraphV3T): Record<string, unknown> | undefined => {
  const raw = g as unknown as Record<string, unknown>;
  const frame = raw.reasoning_frame ?? raw.work_frame;
  return frame !== null && typeof frame === 'object' && !Array.isArray(frame)
    ? frame as Record<string, unknown> : undefined;
};
const sameWords = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

describe('PJ-A2: the strategic reasoning/work frame survives canonical admission and reread', () => {
  it('the production candidate contract can express a goal-free reasoning task', () => {
    const schema = buildCandidateSchema() as { required?: string[]; properties?: Record<string, unknown> };
    const goalSchema = schema.properties?.goal as { anyOf?: { type?: string }[]; type?: string | string[] } | undefined;
    const nullable = goalSchema?.anyOf?.some((part) => part.type === 'null') === true
      || (Array.isArray(goalSchema?.type) && goalSchema.type.includes('null'));
    expect(!schema.required?.includes('goal') || nullable,
      'strict model schema requires a goal object for a goal-free work task').toBe(true);
  });

  it.each(['pricing-a', 'midmarket'])('%s: original framing is attested in the shared canonical work frame', async (id) => {
    const c = byId(id); const w = await witness(c);
    const frame = frameOf(w.cold);
    expect(frame, `${id}: no shared typed work frame after canonical reread`).toBeDefined();
    expect(sameWords(JSON.stringify(frame)), `${id}: original framing missing from the work frame`).toContain(sameWords(c.framing));
    expect(JSON.stringify(frame), `${id}: frame source is unattested`).toMatch(/from_brief|brief_extraction/);
  });

  it.each(['pricing-a', 'midmarket'])('%s: a decision-specific question survives as an attested Decision entity', async (id) => {
    const schema = buildCandidateSchema() as { properties?: Record<string, unknown> };
    expect(schema.properties?.decision_question, `${id}: strict model schema cannot emit a decision question`).toBeDefined();
    const c = byId(id); const w = await witness(c, true);
    const nodes = w.cold.nodes.filter((n) => n.kind === 'decision');
    expect(nodes, `${id}: expected one decision-specific frame`).toHaveLength(1);
    expect(sameWords(JSON.stringify(nodes[0])), `${id}: the original framing is missing at the persisted decision entity`)
      .toContain(sameWords(c.framing));
    expect(nodes[0]!.provenance, `${id}: framing's source must remain attested`).toBe('from_brief');
  });

  it.each(['pricing-a', 'midmarket'])('%s: goal direction remains typed after a fresh read', async (id) => {
    const c = byId(id); const w = await witness(c);
    expect(typed(goalOf(w.cold), 'goal_direction'), `${id}: no typed direction on the stored goal`).toBe(c.goal!.operator);
  });

  it.each(['pricing-a', 'midmarket'])('%s: stated horizon remains typed after a fresh read', async (id) => {
    const c = byId(id); const w = await witness(c);
    expect(typed(goalOf(w.cold), 'goal_horizon_months'), `${id}: no typed horizon on the stored goal`).toBe(12);
  });

  it.each(['pricing-a', 'midmarket'])('%s: target and baseline remain distinct after reread', async (id) => {
    const c = byId(id); const w = await witness(c); const goal = goalOf(w.cold);
    expect(goal.goal_threshold_raw, `${id}: stated target`).toBe(c.goal!.value);
    const observed = goal.observed_state as Record<string, unknown> | undefined;
    if (c.goal!.baseline_value === null) expect(observed?.raw_value, `${id}: no baseline was stated`).toBeUndefined();
    else {
      expect(observed?.raw_value, `${id}: held baseline`).toBe(c.goal!.baseline_value);
      expect(observed?.source, `${id}: baseline source`).toBe('brief_extraction');
      expect(observed?.raw_value, `${id}: baseline is not target`).not.toBe(goal.goal_threshold_raw);
    }
  });

  it.each(['pricing-a', 'midmarket'])('%s: target provenance is bound to the target after reread', async (id) => {
    const w = await witness(byId(id));
    expect(goalOf(w.cold).threshold_source, `${id}: target source lost in canonical projection`).toBe('brief_extraction');
  });

  it('Pricing A: under 4% remains a strict bound at the canonical boundary', async () => {
    const w = await witness(byId('pricing-a'));
    const limits = w.cold.goal_constraints ?? [];
    expect(limits).toHaveLength(1);
    expect(limits[0]!.operator, 'exactly 4% must not satisfy “under 4%”').toBe('<');
    expect(limits[0]!.value).toBe(4);
  });

  it('sensemaking: does not synthesize a Decision node', async () => {
    const c = byId('activation-sensemaking'); const w = await witness(c);
    expect(w.cold.nodes.filter((n) => n.kind === 'decision'), 'a non-decision task must not get a fake Decision node').toEqual([]);
  });

  it('sensemaking: retains the original framing as typed canonical truth', async () => {
    const c = byId('activation-sensemaking'); const w = await witness(c);
    const frame = frameOf(w.cold);
    expect(JSON.stringify(frame), 'the work frame must be typed canonical truth, separate from brief_text').toContain(c.framing);
  });

  it('sensemaking: does not invent a target or deadline', async () => {
    const w = await witness(byId('activation-sensemaking'));
    expect(w.cold.nodes.some((n) => n.kind === 'goal'), 'a sensemaking task must not invent a success goal').toBe(false);
    expect(w.cold.nodes.some((n) => (n as Record<string, unknown>).goal_horizon_months !== undefined)).toBe(false);
  });

  it('a horizon-only change moves canonical frame currentness while the numerical analysis hash stays fixed', async () => {
    const w = await witness(byId('pricing-a'));
    const before = w.cold;
    const goal = goalOf(before);
    const changed = GraphV3.parse(projectGraphForPersistence({ ...before,
      nodes: before.nodes.map((n) => n.id === goal.id ? { ...n, goal_horizon_months: 6 } : n),
    }));
    expect(computeAnalysisAffectingGraphHash(changed)).toBe(computeAnalysisAffectingGraphHash(before));
    expect(goalOf(changed).goal_horizon_months, 'the canonical write must retain the changed frame').toBe(6);
    expect(frameRevision(changed), 'reasoning against a new frame requires a new canonical currentness token').not.toBe(frameRevision(before));
  });

  it('a typed retained horizon with atemporal analysis withholds the goal probability', async () => {
    const w = await witness(byId('pricing-a'));
    // Inject the upstream typed contract here so the Agent permission failure is
    // independently visible while Canonical's storage row is still RED.
    const graphWithTypedHorizon = { ...w.cold,
      nodes: w.cold.nodes.map((n) => n.kind === 'goal' ? { ...n, goal_horizon_months: 12 } : n),
    };
    expect((graphWithTypedHorizon.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>).goal_horizon_months)
      .toBe(12);
    const sessions = new SessionBindingRegistry(); sessions.bind(SESSION, null, SCENARIO);
    const result = await getCanonicalState(
      { scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: null },
      { sessions, readScenario: async () => ({ user_id: null, graph: graphWithTypedHorizon, brief_text: byId('pricing-a').brief,
        graph_identity_hash: frameRevision(graphWithTypedHorizon as GraphV3T) }),
      readAnalysis: async () => ({ probability_of_goal: 0.71, model_has_time_axis: false }) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const analysis = result.analysis as Record<string, unknown>;
      expect(analysis.probability_of_goal, 'no atemporal chance may answer a time-bound goal').toBeNull();
      expect(analysis.goal_chance_withheld).toBe('horizon_not_modelled');
    }
  });

  it('a frame-only edit refreshes Agent context and recomputes claim permission on the new revision', async () => {
    const w = await witness(byId('pricing-a'));
    const original = w.cold;
    const goal = goalOf(original);
    const changed = GraphV3.parse(projectGraphForPersistence({ ...original,
      nodes: original.nodes.map((n) => n.id === goal.id ? { ...n, goal_horizon_months: 6 } : n),
    }));
    expect(computeAnalysisAffectingGraphHash(changed), 'horizon-only edit must not fake numerical change')
      .toBe(computeAnalysisAffectingGraphHash(original));
    expect(goalOf(changed).goal_horizon_months, 'new frame must survive serialized canonical write').toBe(6);
    const sessions = new SessionBindingRegistry(); sessions.bind(SESSION, null, SCENARIO);
    const read = async (graph: GraphV3T) => getCanonicalState(
      { scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: null },
      { sessions, readScenario: async () => ({ user_id: null, graph: GraphV3.parse(JSON.parse(JSON.stringify(graph))),
        brief_text: byId('pricing-a').brief, graph_identity_hash: frameRevision(graph) }),
      readAnalysis: async () => ({ probability_of_goal: 0.71, model_has_time_axis: false }) },
    );
    const before = await read(original);
    const after = await read(changed);
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.graph_identity_hash, 'Agent needs a frame revision distinct from the analysis hash')
        .not.toBe(before.graph_identity_hash);
      const currentContext = JSON.stringify({ ...after, brief: null, analysis: null });
      expect(currentContext, 'Agent still reasons against old or untyped frame').toContain('goal_horizon_months');
      expect(currentContext).toContain('6');
      const permission = after.analysis as Record<string, unknown>;
      expect(permission.probability_of_goal, 'old atemporal chance cannot be reused under the new frame').toBeNull();
      expect(permission.goal_chance_withheld).toBe('horizon_not_modelled');
    }
  });

  it('an unrelated edit cannot erase framing, horizon, direction or provenance', async () => {
    const w = await witness(byId('pricing-a'));
    const goal = goalOf(w.cold);
    expect(goal.goal_horizon_months).toBe(12);
    expect(goal.goal_direction).toBe('>=');
    expect(goal.threshold_source).toBe('brief_extraction');
    expect(frameOf(w.cold), 'the canonical work frame must exist before the edit').toBeDefined();
    const unrelated = GraphV3.parse(projectGraphForPersistence({ ...w.cold,
      nodes: w.cold.nodes.map((n) => n.kind === 'factor' ? { ...n, description: 'Unrelated note' } : n),
    }));
    expect(goalOf(unrelated).goal_horizon_months).toBe(goal.goal_horizon_months);
    expect(goalOf(unrelated).goal_direction).toBe(goal.goal_direction);
    expect(goalOf(unrelated).threshold_source).toBe(goal.threshold_source);
    expect(frameOf(unrelated)).toEqual(frameOf(w.cold));
  });

  it('a target edit through the real writer replaces the old brief provenance', async () => {
    const w = await witness(byId('pricing-a'));
    const original = goalOf(w.cold);
    const stamped = GraphV3.parse(projectGraphForPersistence({ ...w.cold,
      nodes: w.cold.nodes.map((n) => n.id === original.id ? { ...n, threshold_source: 'brief_extraction' } : n),
    }));
    const goal = goalOf(stamped);
    expect(goal.threshold_source, 'canonical projection must first support a brief-attested target').toBe('brief_extraction');
    const proposal = {
      handler_id: 'add_constraint',
      entity: { id: goal.id, kind: 'goal', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 110000, source: 'user_explicit' },
        { name: 'unit', value: 'GBP', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    } as unknown as ProposalAction;
    const invocation = {
      context: { session_id: SCENARIO, stage: 'frame', request_id: 'pj-a2-target-edit', prior_turns: [], prior_facts: [],
        scenarioBriefText: byId('pricing-a').brief, persistedGraph: stamped } as unknown as HandlerInvocation['context'],
      payload: { kind: 'message', scenario_id: SCENARIO, turn_id: 'pj-a2-edit', stage: 'frame',
        message: 'Make the MRR target at least £110,000.' } as unknown as HandlerInvocation['payload'],
      requestId: 'pj-a2-target-edit', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: stamped,
    } as HandlerInvocation;
    const edited = await createAddConstraintHandler()(invocation);
    const reread = GraphV3.parse(projectGraphForPersistence(edited.mutated_graph));
    expect(goalOf(reread).goal_threshold_raw).toBe(110000);
    expect(goalOf(reread).threshold_source, 'the revised figure came from the later user edit').toBe('user');
  });

  it('a fresh canonical read gives the Agent the current typed frame, not just the original brief', async () => {
    const c = byId('pricing-a'); const w = await witness(c);
    expect(w.agent.ok).toBe(true);
    if (w.agent.ok) {
      const withoutEcho = { ...w.agent, brief: null, analysis: null } as Record<string, unknown>;
      expect(JSON.stringify(withoutEcho), 'Agent context has no typed horizon').toContain('goal_horizon_months');
      expect(JSON.stringify(withoutEcho), 'Agent context has no original framing').toContain(c.framing);
      expect(w.agent.graph_identity_hash).toBe(frameRevision(w.cold));
    }
  });

  it('serialized cold reload reproduces the same typed work frame and horizon', async () => {
    const w = await witness(byId('pricing-a'));
    expect(w.cold, 'fresh JSON reader must reproduce the registered graph').toEqual(w.stored);
    expect(frameOf(w.cold), 'cold graph lost its original work frame').toEqual(frameOf(w.stored));
    expect(frameOf(w.cold), 'an absent frame cannot satisfy cold-reload parity').toBeDefined();
    expect(goalOf(w.cold).goal_horizon_months).toBe(12);
  });
});

describe('PJ-A2 controls: assertions reject plausible false positives', () => {
  it('a “12 subscribers” brief does not attest twelve months', () => {
    const c = byId('pricing-a');
    const mutated = { ...c, brief: 'We have £75k MRR and aim for £100k MRR. We have 12 subscribers. Should we increase the Pro plan price from £49 to £59?',
      goal: { ...c.goal!, horizon_months: 12 } };
    expect(candidateFor(mutated).goal.horizon_months, 'the bad model candidate really proposes 12 months').toBe(12);
    return witness(mutated).then((w) => {
      expect(goalOf(w.cold).goal_horizon_months, '12 subscribers must not ground a 12-month deadline').toBeUndefined();
    });
  });

  it('a candidate normalised from “over the next year” retains twelve months without a literal 12', async () => {
    const year = byId('pricing-a');
    const yearBrief = year.brief.replace('within 12 months', 'over the next year');
    expect(yearBrief).not.toContain('12 months');
    const w = await witness({ ...year, brief: yearBrief });
    expect(goalOf(w.cold).goal_horizon_months).toBe(12);
  });

  it('“by Q3” without a year remains unresolved, with its wording retained', async () => {
    const q3 = byId('pricing-a');
    const w = await witness({ ...q3, brief: q3.brief.replace('within 12 months', 'by Q3'),
      goal: { ...q3.goal!, horizon_months: null } });
    expect(w.cold.nodes.some((n) => (n as Record<string, unknown>).goal_horizon_months !== undefined),
      'Q3 without a year is not a justified month count').toBe(false);
    const frame = frameOf(w.cold);
    expect(frame, 'unresolved Q3 must remain in typed canonical context').toBeDefined();
    expect(JSON.stringify(frame ?? {})).toContain('Q3');
    expect(JSON.stringify(frame ?? {}), 'the year was not supplied').not.toMatch(/20\d\d/);
  });

  it('a construction loss ledger cannot stand in for a stored horizon', async () => {
    const c = byId('pricing-a'); const w = await witness(c);
    const goal = goalOf(w.cold);
    expect(goal.goal_horizon_months, 'a construction loss ledger is not canonical truth').toBe(12);
  });

  it('a goal label cannot stand in for a typed direction', async () => {
    const w = await witness(byId('pricing-a'));
    const goal = goalOf(w.cold);
    expect(goal.goal_direction, 'a label is not a typed goal operator').toBe('>=');
  });

  it('a frame from another scenario cannot be smuggled into the saved graph', async () => {
    const c = byId('pricing-a'); const w = await witness(c);
    expect(frameOf(w.cold), 'precondition: typed work frame must exist').toBeDefined();
    const wrongScenario = { ...w.cold, reasoning_frame: { scenario_id: 'other-scenario', text: c.framing } };
    const parsed = GraphV3.parse(projectGraphForPersistence(wrongScenario));
    const frame = (parsed as unknown as Record<string, unknown>).reasoning_frame as Record<string, unknown> | undefined;
    expect(frame?.scenario_id, 'a frame from another scenario must never be accepted').not.toBe('other-scenario');
    expect(JSON.stringify(frame ?? {})).not.toContain('other-scenario');
  });
});
