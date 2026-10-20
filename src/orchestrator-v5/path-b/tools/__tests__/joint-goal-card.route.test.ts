/**
 * ⭐ PATH-B, THE GOAL'S CURRENT LEVEL THROUGH THE REAL TURN ROUTE (VERIFIER first loss 19:33Z + K7/K9, DL-3 22:2xZ): the typed
 * correction of the goal's baseline shows its card in THAT turn; a press on it saves it ONCE, by the goal level's own writer
 * (`applyGoalCurrentLevel`, ONE registration), with THAT registration's own receipt.
 * Harness: the real `/agent/v1/turn` route, SDK, card carrier and C5's adapters, as `ai-core-correction-card.route.test.ts`; a
 * scripted AI (0 provider calls). Only the scenario's graph routes are doubles: the read, the registration (CAS on the graph hash
 * and identity it was prepared on) and the versions list. SYNTHETIC model.
 */
import { randomUUID, createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { targetReadback } from '../goal-target.js';
import { goalTargetsBlockOf } from '../../../goal-target/goal-targets-joint.js';
import { claimRecordsOn, userStatementsOn } from '../../../statement-door/statements.js';

type Json = Record<string, any>;
let SCENARIO = '';
const CORE = { 'x-olumi-ai-mode': 'core' };

let persisted: Json;
let concurrentHold: Json | undefined;
let noReceipt = false;
let loseOperandClaim = false;
const registered: Json[] = [];
const graphWrites: Json[] = [];
const turnRows = new Map<string, any>();
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
/** The goal "Weekly orders" at least 150 a week; today 120, from the brief. */
function stored(): Json {
  const options = [
    { id: 'add_vans', kind: 'option', label: 'Lease two more vans', interventions: { vans: { value: 0.5, source: 'brief_extraction', extractionType: 'explicit' } } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { vans: { value: 0.25, source: 'cee_inference' } }, is_baseline: true },
  ];
  const g = {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Delivery capacity' },
      { id: 'orders', kind: 'goal', label: 'Weekly orders', goal_threshold: 0.8, goal_threshold_raw: 150, goal_threshold_cap: 187.5,
        goal_threshold_unit: 'orders a week', goal_threshold_frame: 'level', goal_direction: 'at_least', goal_threshold_cap_provenance: 'target_derived_headroom',
        observed_state: { value: 0.64, baseline: 0.64, raw_value: 120, unit: 'orders a week', cap: 187.5, source: 'brief_extraction' } },
      { id: 'vans', kind: 'factor', label: 'Vans on the road', category: 'controllable', observed_state: { value: 0.25, raw_value: 2, unit: 'vans', cap: 8 } },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'vans', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'vans', to: 'orders', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'orders',
  };
  return projectGraphForPersistence({ ...GraphV3.parse(g), options: [] as Json[] }) as Json;
}

const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async () => [...turnRows.values()].reverse()),
  readFactsWithTurnFor: async (ids: string[]) => [...turnRows.values()].filter(r => ids.includes(r.id)).flatMap(r =>
    (r.handler_facts ?? []).map((fact: unknown) => ({ turn_id: r.id, fact_created_at: r.created_at, fact }))),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    if (write.graph !== undefined) {
      graphWrites.push(write); persisted = structuredClone(write.graph) as Json;
      const id = `graph-${graphWrites.length}`;
      turnRows.set(String(write.turn_id), { ...write, id, created_at: new Date().toISOString() });
      return { id, modelVersionReceipt: {
        version_id: `dddddddd-dddd-4ddd-8ddd-${String(graphWrites.length).padStart(12, '0')}`, version_number: 200 + graphWrites.length, mutation_id: write.turn_id, source_turn_id: write.turn_id,
        ...write.modelVersion, graph: persisted, created_at: new Date().toISOString(), parent_version_id: null, root_version_id: null,
        undo_version_id: null, event_id: `event-${graphWrites.length}`,
      } };
    }
    const key = String(write.turn_id);
    const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date().toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row);
    return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
vi.mock('../../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served = 0;
let preparedId = '';
const responsesBody = (output: Json[]): Json => {
  served += 1;
  return { id: `resp_${served}`, object: 'response', model: 'gpt-scripted', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', name: item.name, call_id: item.call_id ?? `call_${served}_${i}`,
          arguments: JSON.stringify(item.name === 'apply_change' && item.args === undefined ? { proposal_id: preparedId } : item.args ?? {}) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('L12: joint targets through the real route and SDK approval', () => {
  let app: FastifyInstance;
  let calls: Json[] = [];
  let outputs: Json[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: 'conv_level', object: 'conversation' });
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      const output = outputs.shift() ?? [{ type: 'message', text: 'Done.' }];
      if (output[0]?.type === 'provider_failure') return json({ error: { message: 'Scripted continuation failed', type: 'invalid_request_error' } }, 400);
      return json(responsesBody(output));
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: persisted, graph_hash: hashOf(persisted),
      graph_identity_hash: { kind: 'graph_identity', value: identityOf(persisted), algorithm: 'sha256' },
      analysis_ready: { status: 'blocked', options: [], blockers: [] } }));
    // The goal level's own writer: ONE registration, CAS on the graph hash AND identity of the read it was approved on.
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const b = req.body as Json;
      if (b.expected_graph_hash !== hashOf(persisted) || b.expected_graph_identity_hash !== identityOf(persisted)) {
        return reply.code(409).send({ details: { code: 'GRAPH_STALE' } });
      }
      const oldClaims = structuredClone(persisted.nodes.find((n: Json) => n.id === 'current_orders')?.user_statements);
      registered.push(b);
      persisted = structuredClone(b.graph) as Json;
      if (loseOperandClaim) persisted.nodes.find((n: Json) => n.id === 'current_orders').user_statements = oldClaims;
      if (concurrentHold !== undefined) {
        const pending = await store.readMostRecentPendingActions();
        turnRows.set('concurrent-offer', { id: 'row-concurrent', turn_id: 'concurrent-offer', request_hash: 'concurrent',
          pending_actions: [...pending, concurrentHold], created_at: new Date().toISOString() });
      }
      return { graph_hash: hashOf(persisted), graph_identity_hash: { value: identityOf(persisted) }, ...(noReceipt ? {} : { model_version: { version_number: 100 + registered.length, version_id: `v_reg_${registered.length}`,
        mutation_id: `m_reg_${registered.length}` } }) };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: (noReceipt ? [] : registered).map((b, i) => ({ version_id: `v_reg_${i + 1}`, sequence: 101 + i,
      creation: { kind: 'committed_mutation', mutation_id: `m_reg_${i + 1}`, source_turn_id: registrationTurnId(SCENARIO, String(b.operation_id)) } })).reverse() }));
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: '', suggested_actions: [], insights: [], blocks: [] }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = stored(); registered.length = 0; graphWrites.length = 0; turnRows.clear(); conversationIds.clear();
    pausedRun = null; calls = []; outputs = []; preparedId = ''; concurrentHold = undefined; noReceipt = false; loseOperandClaim = false;
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const outputOf = (callId: string): Json | undefined => {
    const item = calls.flatMap((b) => (Array.isArray(b.input) ? b.input : [])).find((i: Json) => i.type === 'function_call_output' && i.call_id === callId);
    return item === undefined ? undefined : JSON.parse(String(item.output)) as Json;
  };


  const source = (quote: string) => ({ origin: 'user' as const, quote, named_source: null });
  const joint = (quote: string) => ({ public_label: 'Record both success conditions within three months', basis: 'Olumi’s reading for approval.',
    ops: [{ op: 'set_goal_target', goal_id: 'orders', conditions: [
      { node_id: 'orders', comparator: '>' as const, value: 150, unit: 'orders a week', quantity: 'Weekly orders', frame: 'level', stance: 'target', source: source(quote) },
      { node_id: 'vans', comparator: '<=' as const, value: 6, unit: 'vans', quantity: 'Vans on the road', frame: 'level', stance: 'target', source: source(quote) },
    ], timing: { months: 3, reference: 'today', period_kind: 'over_period', deadline: null } }] });
  async function prepare(args: Json, words: string) {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args }], [{ type: 'message', text: 'Review both conditions and their period.' }]];
    const res = await post({ turn_id: randomUUID(), message: words, source: 'composer' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    const card = body._proposal_fields?.proposals?.[0];
    return { body, card };
  }
  async function approve(card: Json, body: Json) {
    preparedId = card.proposal_id;
    calls = [];
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: 'Both conditions and their timing are saved.' }]];
    return post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip', chip: { id: card.approve_action.id },
      proposal_edits: { proposal_id: card.proposal_id, revision: card.revision, digest: card.digest, graph_hash: body._proposal_fields.graph_hash, fields: [] } });
  }
  it.each([
    ['Productivity', 'Quality', 'Productivity must rise at least 10% and quality at least 5% from today at three months.'],
    ['Output', 'Reliability', 'Output must rise at least 10% and reliability at least 5% from today at three months. Revenue was 2m as of 2026-09-01.'],
  ])('L21 bank: two declared changes → one approval/save → complete cold readback (%s, %s)', async (first, second, words) => {
    const conditions = [first, second].map((quantity, i) => ({ node_id: i === 0 ? 'change_one' : 'change_two', quantity,
      comparator: '>=' as const, value: i === 0 ? 10 : 5, unit: '%', frame: 'change', target_frame: 'change_abs', quantity_frame: 'change',
      stance: 'target', source: source(words), basis: { reference: 'today', denominator: `today’s ${quantity.toLowerCase()}`,
        period_months: 3, period_kind: 'at_end', effect_unit: null, effects_at_period_end: false, also_required: null, open_question: null } }));
    const timing = { months: 3, reference: 'today', period_kind: 'at_end', deadline: null };
    const { body, card } = await prepare({ public_label: 'Record both changes', basis: 'Olumi’s reading for approval.',
      ops: [{ op: 'set_goal_target', goal_id: 'orders', conditions, timing }] }, words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    expect(body._proposal_fields.proposals).toHaveLength(1);
    expect(card.approve_action.detail).toContain(`${first}`);
    expect(card.approve_action.detail).toContain(`${second}`);
    expect(card.approve_action.detail).toContain('from today');
    expect(registered).toHaveLength(0);
    await approve(card, body);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true, receipt: { version_id: 'v_reg_1' } } });
    expect(registered).toHaveLength(1);
    expect(graphWrites).toHaveLength(0);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(persisted) }) as Json;
    const declared = { goal_id: 'orders', conditions: conditions.map(c => ({ ...c, goal_id: c.node_id, origin: c.source.origin,
      quote: c.source.quote, said_in: words, recorded_at: '' })), timing, new_quantities: conditions.map(c => c.node_id) };
    const reading = declared as unknown as Parameters<typeof targetReadback>[1];
    expect(targetReadback(cold, reading).holds).toBe(true);
    for (const c of conditions) {
      const node = cold.nodes.find((n: Json) => n.id === c.node_id);
      expect(node.observed_state).toBeUndefined();
      expect(node.goal_target_basis).toMatchObject({ quantity_frame: 'change', target_frame: 'change_abs', target_raw: c.value,
        reference: 'today', denominator: c.basis.denominator, period_months: 3, period_kind: 'at_end' });
      expect(cold.goal_constraints.find((r: Json) => r.node_id === c.node_id)).toMatchObject({ value: c.value, value_frame: 'change_abs', role: 'goal_target' });
      // Mutant pair per condition: reference/denominator meaning must be checked, not merely its numeric threshold.
      for (const [field, value] of [['reference', 'launch'], ['denominator', 'an unrelated revenue figure']]) {
        const mutant = structuredClone(cold);
        mutant.nodes.find((n: Json) => n.id === c.node_id).goal_target_basis[field!] = value;
        expect(targetReadback(mutant, reading).holds).toBe(false);
      }
    }
    await approve(card, body);
    expect(registered).toHaveLength(1);
  });

  it('L21 bank: conversion is a LEVEL over the launch window AND new customers accumulate from launch', async () => {
    const words = 'Conversion must be strictly above 15% over the first 3 months after launch AND we need at least 20 new customers in that window.';
    const conditions = [
      { node_id: 'conversion', quantity: 'Conversion rate', comparator: '>', value: 15, unit: '%', frame: 'level', stance: 'target', source: source(words) },
      { node_id: 'new_customers', quantity: 'Cumulative new customers since launch', comparator: '>=', value: 20, unit: 'customers',
        frame: 'change', target_frame: 'change_abs', quantity_frame: 'change', stance: 'target', source: source(words),
        basis: { reference: 'launch', denominator: null, period_months: 3, period_kind: 'over_period', effect_unit: null,
          effects_at_period_end: false, also_required: null, open_question: null } },
    ];
    const timing = { months: 3, reference: 'launch', period_kind: 'over_period', deadline: null };
    const { body, card } = await prepare({ public_label: 'Record both launch conditions', basis: 'Olumi’s at-least reading for approval.',
      ops: [{ op: 'set_goal_target', goal_id: 'orders', conditions, timing }] }, words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    expect(body._proposal_fields.proposals).toHaveLength(1);
    expect(card.approve_action.detail).toContain('Conversion rate above 15%');
    expect(card.approve_action.detail).toContain('after launch');
    expect(card.approve_action.detail).not.toContain('from today');
    await approve(card, body);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true, receipt: { version_id: 'v_reg_1' } } });
    expect(registered).toHaveLength(1);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(persisted) }) as Json;
    expect(cold.goal_constraints.find((r: Json) => r.node_id === 'conversion')).toMatchObject({ value: 15, operator_as_stated: '>', value_frame: 'level' });
    expect(cold.goal_constraints.find((r: Json) => r.node_id === 'new_customers')).toMatchObject({ value: 20, value_frame: 'change_abs' });
    const count = cold.nodes.find((n: Json) => n.id === 'new_customers');
    expect(count.observed_state).toBeUndefined();
    expect(count.goal_target_basis).toMatchObject({ reference: 'launch', period_months: 3, period_kind: 'over_period' });
  });
  it.each([
    'We need over 150 weekly orders AND no more than 6 vans over the next 3 months.',
    'Our regional rollout needs over 150 weekly deliveries AND at most 6 vehicles over the next 3 months.',
    'Revenue was 2m as of 2026-09-01; we need over 150 weekly orders AND at most 6 vans over the next 3 months.',
  ])('RED joint goal → one card → one save/receipt → full cold readback: %s', async (words) => {
    persisted.goal_constraints = [{ constraint_id: 'keep-limit', node_id: 'vans', operator: '>=', value: 1, unit: 'vans', value_frame: 'level', provenance: 'explicit' }];
    const before = structuredClone(persisted);
    const { body, card } = await prepare(joint(words), words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    expect(body._proposal_fields.proposals).toHaveLength(1);
    expect(registered).toHaveLength(0);
    const saved = await approve(card, body);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(outputOf('apply_call'), JSON.stringify(outputOf('apply_call'))).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, receipt: { version_id: 'v_reg_1' } } });
    expect(registered).toHaveLength(1);
    expect(graphWrites).toHaveLength(0);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(structuredClone(persisted)) }) as Json;
    expect(cold.goal_constraints.filter((r: Json) => r.role === 'goal_target')).toEqual([
      expect.objectContaining({ node_id: 'orders', operator: '>=', operator_as_stated: '>', value: 150, unit: 'orders a week', role: 'goal_target' }),
      expect.objectContaining({ node_id: 'vans', operator: '<=', value: 6, unit: 'vans', role: 'goal_target' }),
    ]);
    expect(cold.nodes.find((n: Json) => n.id === 'orders').goal_horizon_months).toBe(3);
    expect(cold.goal_constraints.find((r: Json) => r.constraint_id === 'keep-limit')).toEqual(before.goal_constraints[0]);
    expect(cold.edges).toEqual(before.edges);
    expect(cold.options).toEqual(before.options);
    for (const id of ['orders', 'vans']) {
      const statements = userStatementsOn(cold.nodes.find((n: Json) => n.id === id)).flatMap(r => r.statements);
      expect(statements).toEqual([expect.objectContaining({ speaker: 'user', quote: words, reference: 'today', period: 'over the first three months', stance: 'target', reading: 'olumi' })]);
    }
    const declared = { goal_id: 'orders', conditions: joint(words).ops[0]!.conditions.map(c => ({ ...c, goal_id: c.node_id, origin: c.source.origin as 'user', quote: c.source.quote, said_in: words, recorded_at: '' })), timing: { ...joint(words).ops[0]!.timing, reference: 'today' as const, period_kind: 'over_period' as const } };
    expect(targetReadback(cold, declared).holds).toBe(true);
    for (const mutate of [
      (g: Json) => { g.goal_constraints.find((r: Json) => r.node_id === 'vans' && r.role === 'goal_target').value = 7; },
      (g: Json) => { g.goal_constraints = g.goal_constraints.filter((r: Json) => r.node_id !== 'vans' || r.role !== 'goal_target'); },
      (g: Json) => { delete g.nodes.find((n: Json) => n.id === 'orders').goal_horizon_months; },
      (g: Json) => { g.nodes.find((n: Json) => n.id === 'orders').goal_horizon_months = 4; },
    ]) { const mutant = structuredClone(cold); mutate(mutant); expect(targetReadback(mutant, declared).holds).toBe(false); }
    // The existing Batch C reader sees two targets; no invented joint chance from marginal figures.
    const block = goalTargetsBlockOf({ graph: cold, storedConstraints: cold.goal_constraints, sentConstraints: cold.goal_constraints.map((r: Json) => ({ ...r, operator: r.operator_as_stated ?? r.operator })),
      envelope: {}, optionIds: ['add_vans', 'carry_on'], primaryGoalId: 'orders' } as never);
    expect(block?.conditions.filter(c => c.role === 'target')).toHaveLength(2);
    expect(block?.joint.status).toBe('withheld');
    // Re-press after a cold restart reconciles to this receipt; never another write.
    await approve(card, body);
    expect(registered).toHaveLength(1);
  });
  it('one malformed member: no card and no write, including a valid first member', async () => {
    const words = 'Over 150 orders and at most 6 vans within 3 months. Revenue was 2m as of 2026-09-01.';
    const args = joint(words); args.ops[0]!.conditions[1]!.node_id = 'decision';
    const before = structuredClone(persisted);
    const { card } = await prepare(args, words);
    expect(card).toBeUndefined(); expect(registered).toHaveLength(0); expect(persisted).toEqual(before);
  });
  it('ordinary chat cannot approve; stale card cannot save any member', async () => {
    const words = 'Over 150 orders AND no more than 6 vans over 3 months.';
    const { body, card } = await prepare(joint(words), words);
    expect(card).toBeDefined();
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'unapproved', args: { proposal_id: card.proposal_id } }]];
    await post({ turn_id: randomUUID(), message: 'Tell me more about it.', source: 'composer' });
    expect(registered).toHaveLength(0);
    persisted.nodes.find((n: Json) => n.id === 'orders').label = 'A concurrent goal correction';
    await approve(card, body);
    expect(registered).toHaveLength(0);
  });
  it('an explicit deadline survives cold readback with every condition', async () => {
    const words = 'Over 150 orders AND at most 6 vans by 2027-01-20, over the first three months from today.';
    const args = joint(words) as Json; args.ops[0].timing.deadline = '2027-01-20';
    const { body, card } = await prepare(args, words);
    expect(card).toBeDefined(); await approve(card, body);
    expect(outputOf('apply_call'), JSON.stringify(outputOf('apply_call'))).toMatchObject({ status: 'ok', data: { saved: true } });
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(structuredClone(persisted)) }) as Json;
    expect(cold.nodes.find((n: Json) => n.id === 'orders').goal_horizon).toEqual({ deadline: '2027-01-20' });
    expect(cold.nodes.find((n: Json) => n.id === 'orders').goal_horizon_months).toBe(3);
    expect(registered).toHaveLength(1);
  });
  it('a wrong source quote on the second member prevents the whole card', async () => {
    const words = 'Over 150 orders AND at most 6 vans over 3 months.';
    const args = joint(words); args.ops[0]!.conditions[1]!.source.quote = 'Someone else stated 9 vans';
    const { card } = await prepare(args, words);
    expect(card).toBeUndefined(); expect(registered).toHaveLength(0);
  });

  it.each([
    [true, 'Launch success requires conversion above 15% AND at least 20 customers over the first 3 months after launch.'],
    [false, 'Launch success requires conversion above 15% AND at least 20 customers over the first 3 months after launch.'],
    [false, 'Our service pilot requires conversion above 15% AND at least 20 customers over the first 3 months after launch. Revenue was 2m as of 2026-09-01.'],
  ] as const)('complete joint action; quantities already present=%s; one card/save/cold readback: %s', async (present, words) => {
    if (present) persisted.nodes.push(
      { id: 'conversion', kind: 'factor', label: 'Conversion rate', category: 'observable', observed_state: { value: 0.1, raw_value: 10, unit: '%', cap: 100 } },
      { id: 'customers', kind: 'factor', label: 'New customers', category: 'observable', observed_state: { value: 0.05, raw_value: 5, unit: 'customers', cap: 100 } });
    const args = { public_label: 'Record both launch success conditions', basis: 'Olumi’s reading.', ops: [{ op: 'set_goal_target', goal_id: 'orders',
      conditions: [
        { node_id: 'conversion', comparator: '>' as const, value: 15, unit: '%', quantity: 'Conversion rate', frame: 'level', stance: 'target', source: source(words) },
        { node_id: 'customers', comparator: '>=' as const, value: 20, unit: 'customers', quantity: 'New customers', frame: 'level', stance: 'target', source: source(words) },
      ], timing: { months: 3, reference: 'launch', period_kind: 'over_period', deadline: null },
      links: present ? [] : [{ from: 'conversion', to: 'orders', sign: 'positive' as const }, { from: 'customers', to: 'orders', sign: 'positive' as const }] }] };
    const { body, card } = await prepare(args, words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    expect(body._proposal_fields.proposals).toHaveLength(1);
    expect(card.approve_action.detail).toBe('Olumi’s reading: Conversion rate above 15% AND New customers at least 20 customers; over the first three months after launch.'
      + (present ? '' : ' Olumi’s provisional links: Conversion rate → Weekly orders (positive); New customers → Weekly orders (positive).'));
    expect(registered).toHaveLength(0);
    await approve(card, body);
    expect(outputOf('apply_call'), JSON.stringify(outputOf('apply_call'))).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(registered).toHaveLength(1);
    expect(graphWrites).toHaveLength(0);
    expect(persisted.nodes).toHaveLength(7);
    expect(persisted.edges).toHaveLength(present ? 5 : 7);
    const goal = persisted.nodes.find((n: Json) => n.id === 'orders');
    expect(goal.goal_threshold).toBeUndefined(); expect(goal.goal_threshold_raw).toBeUndefined();
    expect(persisted.goal_constraints.map((r: Json) => [r.node_id, r.value, r.role])).toEqual([['conversion', 15, 'goal_target'], ['customers', 20, 'goal_target']]);
    expect(goal.goal_horizon_months).toBe(3);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(structuredClone(persisted)) }) as Json;
    for (const [id, label, baseline] of [['conversion', 'Conversion rate', 10], ['customers', 'New customers', 5]] as const) {
      const nodes = cold.nodes.filter((n: Json) => n.id === id);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({ kind: 'factor', label });
      expect(nodes[0].observed_state?.raw_value).toBe(present ? baseline : undefined);
      if (!present) {
        expect(nodes[0].observed_state).toBeUndefined();
        expect(cold.edges.filter((e: Json) => e.from === id && e.to === 'orders')).toHaveLength(1);
        expect(nodes[0].provenance).toBe('user_set');
      }
      expect(userStatementsOn(nodes[0]).flatMap(r => r.statements)).toEqual([expect.objectContaining({ speaker: 'user', quote: words,
        subject: { quantity: label, node_id: id }, reference: 'launch', period: 'over the first three months after launch', stance: 'target' })]);
    }
    const declared = { goal_id: 'orders', conditions: args.ops[0]!.conditions.map(c => ({ ...c, goal_id: c.node_id, origin: c.source.origin,
      quote: c.source.quote, said_in: words, recorded_at: '' })), timing: { ...args.ops[0]!.timing, reference: 'launch' as const, period_kind: 'over_period' as const }, new_quantities: present ? [] : ['conversion', 'customers'], links: args.ops[0]!.links };
    expect(targetReadback(cold, declared).holds).toBe(true);
    if (!present) for (const mutate of [
      (g: Json) => { g.nodes = g.nodes.filter((n: Json) => n.id !== 'customers'); },
      (g: Json) => { g.nodes.find((n: Json) => n.id === 'conversion').observed_state = { value: 0.15, raw_value: 15 }; },
      (g: Json) => { g.nodes.find((n: Json) => n.id === 'conversion').provenance = 'ai_inferred'; },
      (g: Json) => { g.edges = g.edges.filter((e: Json) => e.from !== 'customers'); },
      (g: Json) => { g.nodes.find((n: Json) => n.id === 'conversion').user_statements[0].statements[0].speaker = 'unknown'; },
      (g: Json) => { g.nodes.find((n: Json) => n.id === 'conversion').user_statements[0].statements[0].quote = 'The CFO said 2m'; },
    ]) { const mutant = structuredClone(cold); mutate(mutant); expect(targetReadback(mutant, declared).holds).toBe(false); }
    await approve(card, body);
    expect(registered).toHaveLength(1);
  });

  it.each(['third_party', 'olumi', 'unknown'] as const)('new quantities preserve per-condition source; second=%s never borrows the first author', async (origin) => {
    const words = 'We require at least 12 enquiries; the CFO wants at most 4 refunds within 3 months. Revenue was 2m as of 2026-09-01.';
    const args = { public_label: 'Review the pilot targets', basis: 'Olumi’s reading.', ops: [{ op: 'set_goal_target', goal_id: 'orders', conditions: [
      { node_id: 'enquiries', quantity: 'Enquiries', comparator: '>=', value: 12, unit: 'enquiries', frame: 'level', stance: 'target', source: source('We require at least 12 enquiries') },
      { node_id: 'refunds', quantity: 'Refunds', comparator: '<=', value: 4, unit: 'refunds', frame: 'level', stance: 'target',
        source: { origin, quote: origin === 'olumi' ? null : 'the CFO wants at most 4 refunds within 3 months', named_source: origin === 'third_party' ? 'CFO' : null } },
    ], timing: { months: 3, reference: 'today', period_kind: 'over_period', deadline: null } }] };
    const { body, card } = await prepare(args, words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    await approve(card, body);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(registered).toHaveLength(1);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(structuredClone(persisted)) }) as Json;
    const node = cold.nodes.find((n: Json) => n.id === 'refunds');
    expect(node.observed_state).toBeUndefined();
    expect(node.provenance).not.toBe('user_set');
    expect(claimRecordsOn(node).flatMap(r => r.statements)).toEqual([expect.objectContaining({ said_by: origin === 'third_party' ? 'party' : origin,
      ...(origin === 'third_party' ? { party: 'CFO', relayed_by: 'user' } : {}), subject: { quantity: 'Refunds', node_id: 'refunds' },
      quote: origin === 'olumi' ? 'Refunds' : 'the CFO wants at most 4 refunds within 3 months' })]);
  });

  it('a malformed new quantity makes the complete addition/target/timing action write nothing', async () => {
    const words = 'At least 12 enquiries AND at most 4 refunds over three months.';
    const args = joint(words);
    args.ops[0]!.conditions[0]!.node_id = 'enquiries'; args.ops[0]!.conditions[0]!.quantity = 'Enquiries';
    args.ops[0]!.conditions[1]!.node_id = 'not a canonical id';
    const before = structuredClone(persisted);
    const { card } = await prepare(args, words);
    expect(card).toBeUndefined(); expect(registered).toHaveLength(0); expect(persisted).toEqual(before);
  });

  it('the one card visibly shows every condition and the timing', async () => {
    const words = 'We need over 150 weekly orders AND at most 6 vans over the next 3 months.';
    const { card } = await prepare(joint(words), words);
    expect(card).toBeDefined();
    expect(card.approve_action.detail).toBe('Olumi’s reading: Weekly orders above 150 orders a week AND Vans on the road at most 6 vans; over the first three months from today.');
  });

  it.each([false, true])('L12E every added quantity uses the authority (first linked=%s)', async (linked) => {
    const authority = await import('../../../routing/add-factor-transaction.js');
    const build = vi.spyOn(authority, 'buildAddFactorTransaction');
    try {
      const words = 'We need at least 12 enquiries AND at most 4 refunds over three months. Revenue was 2m as of 2026-09-01.';
      const args = joint(words) as Json;
      Object.assign(args.ops[0].conditions[0], { node_id: 'enquiries', quantity: 'Enquiries', value: 12, unit: 'enquiries' });
      Object.assign(args.ops[0].conditions[1], { node_id: 'refunds', quantity: 'Refunds', value: 4, unit: 'refunds' });
      if (linked) args.ops[0].links = [{ from: 'enquiries', to: 'orders', sign: 'negative' }];
      const { body, card } = await prepare(args, words);
      expect(build).toHaveBeenCalledWith({ factors: [
        { id: 'enquiries', label: 'Enquiries', link: linked ? { to_id: 'orders', effect_direction: 'negative' } : null },
        { id: 'refunds', label: 'Refunds', link: null },
      ] }, expect.any(Object));
      expect(card).toBeDefined();
      await approve(card, body);
      expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true } });
      expect(registered).toHaveLength(1);
      expect(persisted.nodes.filter((n: Json) => ['enquiries', 'refunds'].includes(n.id)).map((n: Json) => n.observed_state)).toEqual([undefined, undefined]);
      expect(persisted.edges.filter((e: Json) => ['enquiries', 'refunds'].includes(e.from)).map((e: Json) => [e.from, e.to, e.effect_direction]))
        .toEqual(linked ? [['enquiries', 'orders', 'negative']] : []);
    } finally { build.mockRestore(); }
  });

  it.each([false, true])('L12E any authority refusal stops the whole card (linked=%s)', async (linked) => {
    const authority = await import('../../../routing/add-factor-transaction.js');
    const build = vi.spyOn(authority, 'buildAddFactorTransaction').mockReturnValue({ matched: false, reason: 'factor_id_collision' });
    try {
      const words = 'We need over 150 weekly orders AND at most 6 reserve vans over three months.';
      const args = joint(words) as Json;
      Object.assign(args.ops[0].conditions[1], { node_id: 'reserve_vans', quantity: 'Reserve vans' });
      if (linked) args.ops[0].links = [{ from: 'reserve_vans', to: 'orders', sign: 'positive' }];
      const before = structuredClone(persisted);
      const { card } = await prepare(args, words);
      expect(build).toHaveBeenCalled();
      expect(card).toBeUndefined();
      expect(registered).toHaveLength(0); expect(graphWrites).toHaveLength(0); expect(persisted).toEqual(before);
    } finally { build.mockRestore(); }
  });

  it.each([
    ['vans_duplicate', 'Vans on the road', false, 'We need over 150 weekly orders AND at most 6 vans over three months.'],
    ['vehicles_duplicate', '  VANS   ON THE ROAD  ', false, 'Our depot pilot needs over 150 weekly deliveries AND at most 6 vehicles over three months. Revenue was 2m as of 2026-09-01.'],
    ['vans_duplicate', 'Vans on the road', true, 'We need over 150 weekly orders AND at most 6 vans over three months.'],
  ] as const)('L12D colliding added identity refuses the whole card (%s, %s, linked=%s)', async (id, quantity, linked, words) => {
    const args = joint(words) as Json;
    Object.assign(args.ops[0].conditions[1], { node_id: id, quantity });
    if (linked) args.ops[0].links = [{ from: id, to: 'orders', sign: 'positive' }];
    const before = structuredClone(persisted);
    const { card } = await prepare(args, words);
    expect(card).toBeUndefined();
    expect(registered).toHaveLength(0);
    expect(graphWrites).toHaveLength(0);
    expect(persisted).toEqual(before);
  });

  it.each([false, true])('L12D repeated new quantity names refuse the whole card (linked=%s)', async (linked) => {
    const words = 'The CFO wants at least 12 enquiries AND at most 4 refunds over three months. Revenue was 2m as of 2026-09-01.';
    const args = joint(words) as Json;
    Object.assign(args.ops[0].conditions[0], { node_id: 'enquiries', quantity: 'Enquiries', value: 12, unit: 'enquiries' });
    Object.assign(args.ops[0].conditions[1], { node_id: 'enquiries_duplicate', quantity: '  ENQUIRIES  ', value: 4, unit: 'refunds',
      source: { origin: 'third_party', quote: words, named_source: 'CFO' } });
    if (linked) args.ops[0].links = [{ from: 'enquiries', to: 'orders', sign: 'positive' }];
    const before = structuredClone(persisted);
    const { card } = await prepare(args, words);
    expect(card).toBeUndefined();
    expect(registered).toHaveLength(0);
    expect(graphWrites).toHaveLength(0);
    expect(persisted).toEqual(before);
  });

  it('L12D a distinct new name remains unlinked and unknown without borrowing baseline or authorship', async () => {
    const words = 'The CFO wants over 150 weekly orders AND at most 6 reserve vans over three months. Revenue was 2m as of 2026-09-01.';
    const args = joint(words) as Json;
    Object.assign(args.ops[0].conditions[1], { node_id: 'reserve_vans', quantity: 'Reserve vans on the road',
      source: { origin: 'third_party', quote: words, named_source: 'CFO' } });
    const before = structuredClone(persisted);
    const { body, card } = await prepare(args, words);
    expect(card).toBeDefined();
    await approve(card, body);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(registered).toHaveLength(1);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(persisted) }) as Json;
    const added = cold.nodes.filter((n: Json) => n.id === 'reserve_vans');
    expect(added).toHaveLength(1);
    expect(added[0].observed_state).toBeUndefined();
    expect(added[0].provenance).not.toBe('user_set');
    expect(claimRecordsOn(added[0]).flatMap(r => r.statements)).toEqual([expect.objectContaining({ said_by: 'party', party: 'CFO', relayed_by: 'user' })]);
    expect(cold.nodes.find((n: Json) => n.id === 'vans')).toEqual(before.nodes.find((n: Json) => n.id === 'vans'));
    expect(cold.edges).toEqual(before.edges);
    expect(cold.goal_constraints.find((r: Json) => r.node_id === 'reserve_vans')).toMatchObject({ role: 'goal_target', value: 6, unit: 'vans' });
  });

  it.each([
    ['drivers', 'Drivers on the road', 'drivers'],
    ['marketing_staff', 'Marketing staff', 'people'],
  ])('L12C no declared link: a resource cap saves only its condition (%s)', async (id, quantity, unit) => {
    const words = `We need over 150 weekly orders AND no more than 6 ${unit} over the next 3 months. More ${quantity} increase weekly orders. Revenue was 2m as of 2026-09-01.`;
    const args = joint(words) as Json;
    Object.assign(args.ops[0].conditions[1], { node_id: id, quantity, unit });
    const beforeEdges = structuredClone(persisted.edges);
    const { body, card } = await prepare(args, words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    await approve(card, body);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(registered).toHaveLength(1);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(persisted) }) as Json;
    expect(cold.edges).toEqual(beforeEdges);
    expect(cold.nodes.find((n: Json) => n.id === id).observed_state).toBeUndefined();
    expect(cold.goal_constraints.find((r: Json) => r.node_id === id)).toMatchObject({ role: 'goal_target', operator: '<=', value: 6, unit });
    const declared = { goal_id: 'orders', conditions: args.ops[0].conditions.map((c: Json) => ({ ...c, goal_id: c.node_id, origin: c.source.origin,
      quote: c.source.quote, said_in: words, recorded_at: '' })), timing: args.ops[0].timing, new_quantities: [id] };
    expect(targetReadback(cold, declared).holds).toBe(true);
    for (const sign of ['positive', 'negative']) {
      const mutant = structuredClone(cold);
      mutant.edges.push({ from: id, to: 'orders', effect_direction: sign, strength: { mean: sign === 'positive' ? 0.5 : -0.5, std: 0.1 }, exists_probability: 0.8 });
      expect(targetReadback(mutant, declared).holds).toBe(false);
    }
  });

  it.each([
    ['drivers', 'Drivers on the road', 'drivers', 'positive'],
    ['marketing_staff', 'Marketing staff', 'people', 'positive'],
    ['delays', 'Delivery delays', 'delays', 'negative'],
  ] as const)('L12C declared link: shown, saved and fully read back (%s, %s, %s, %s)', async (id, quantity, unit, sign) => {
    const words = `We need over 150 weekly orders AND no more than 6 ${unit} over the next 3 months. Revenue was 2m as of 2026-09-01.`;
    const args = joint(words) as Json;
    Object.assign(args.ops[0].conditions[1], { node_id: id, quantity, unit });
    args.ops[0].links = [{ from: id, to: 'orders', sign }];
    const { body, card } = await prepare(args, words);
    expect(card, JSON.stringify(body._agent?.tool_calls)).toBeDefined();
    expect(card.approve_action.detail).toBe(`Olumi’s reading: Weekly orders above 150 orders a week AND ${quantity} at most 6 ${unit}; over the first three months from today. Olumi’s provisional links: ${quantity} → Weekly orders (${sign}).`);
    expect(registered).toHaveLength(0);
    await approve(card, body);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(registered).toHaveLength(1);
    const cold = projectGraphForPersistence({ ...structuredClone(persisted), ...GraphV3.parse(persisted) }) as Json;
    const edge = cold.edges.find((e: Json) => e.from === id && e.to === 'orders');
    expect(edge.effect_direction).toBe(sign);
    expect(Math.sign(edge.strength.mean)).toBe(sign === 'positive' ? 1 : -1);
    expect(cold.nodes.find((n: Json) => n.id === id).observed_state).toBeUndefined();
    const declared = { goal_id: 'orders', conditions: args.ops[0].conditions.map((c: Json) => ({ ...c, goal_id: c.node_id, origin: c.source.origin,
      quote: c.source.quote, said_in: words, recorded_at: '' })), timing: args.ops[0].timing, new_quantities: [id], links: args.ops[0].links };
    expect(targetReadback(cold, declared).holds).toBe(true);
    for (const mutate of [
      (g: Json) => { g.edges = g.edges.filter((e: Json) => e.from !== id); },
      (g: Json) => { g.edges.find((e: Json) => e.from === id).effect_direction = sign === 'positive' ? 'negative' : 'positive'; },
      (g: Json) => { g.edges.find((e: Json) => e.from === id).strength.mean *= -1; },
    ]) { const mutant = structuredClone(cold); mutate(mutant); expect(targetReadback(mutant, declared).holds).toBe(false); }
  });

});
