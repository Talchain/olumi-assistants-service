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
import { createProposal } from '../../../agent-lane/proposal.js';
import { proposalPendingAction } from '../../../agent-lane/durable-proposal.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { valueProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { userStatementOf } from '../../../agent-lane/user-statements.js';
import { claimRecordFor, CONSTRUCTION_ATTEST, userStatementRecord } from '../../../statement-door/statements.js';
import { subjectKey, type DoorSubject } from '../../../statement-door/subject.js';
import { approvalChipIdFor } from '../../../agent-lane/approval-chips.js';

type Json = Record<string, any>;
let SCENARIO = '';
const CORE = { 'x-olumi-ai-mode': 'core' };
const SAID = 'Correction: about 110 a week, not 120.';
const CORRECTION = { public_label: 'Record today’s weekly orders', basis: 'The user corrected the baseline.',
  ops: [{ op: 'set_goal_current_level', goal_id: 'orders', value: 110, unit: 'orders a week', stance: 'stated_current',
    source: { origin: 'user', quote: 'about 110 a week', named_source: null } }] };
const PREPARED_WORDS = 'I have prepared your correction to 110 a week; press its card to save it.';
const SAVED_WORDS = 'Saved: weekly orders are now 110.';

let persisted: Json;
let concurrentHold: Json | undefined;
let noReceipt = false;
let loseOperandClaim = false;
let loseRangeField: string | undefined;
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
const goalRaw = (): unknown => ((persisted.nodes as Json[]).find((n) => n.id === 'orders')?.observed_state as Json | undefined)?.raw_value;

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
      if (loseRangeField !== undefined) for (const node of persisted.nodes) for (const record of node.user_statements ?? [])
        for (const statement of record.statements) if (statement.form === 'range') delete statement[loseRangeField];
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

describe('PATH-B: the goal’s current level, typed as a correction, shows its card in THAT turn; a press saves it ONCE with its own receipt', () => {
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
      return { graph_hash: hashOf(persisted), ...(noReceipt ? {} : { model_version: { version_number: 100 + registered.length, version_id: `v_reg_${registered.length}`,
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
    pausedRun = null; calls = []; outputs = []; preparedId = ''; concurrentHold = undefined; noReceipt = false; loseOperandClaim = false; loseRangeField = undefined;
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const outputOf = (callId: string): Json | undefined => {
    const item = calls.flatMap((b) => (Array.isArray(b.input) ? b.input : [])).find((i: Json) => i.type === 'function_call_output' && i.call_id === callId);
    return item === undefined ? undefined : JSON.parse(String(item.output)) as Json;
  };

  // L19: two independent synthetic briefs, through the strict SDK input and real atomic batch writer.
  it.each<[string, string, string, string | undefined, (string | null)?]>([
    ['set_factor_value', 'Our studio capacity grows 20–30% a month if evening sessions continue.', 'user', undefined],
    ['add_to_model', 'Workshop capacity grows 20–30% a month if evening sessions continue.', 'user', undefined],
    ['set_factor_value', 'Our area lead says capacity grows 20–30% a month if evening sessions continue.', 'third_party', undefined],
    ['set_factor_value', 'Capacity grows 20–30% a month.', 'user', undefined, null],
    ...['high', 'period', 'conditions', 'source', 'said_by'].map((field): [string, string, string, string] =>
      ['set_factor_value', 'Our studio capacity grows 20–30% a month if evening sessions continue.', 'user', field]),
  ])('L19 range-only %s: one card, one save, exact postimage and cold reopen (%s, %s, loss=%s)', async (op, words, origin, lost, conditions = 'if evening sessions continue') => {
    persisted.nodes.push({ id: 'capacity', kind: 'factor', label: 'Capacity growth' });
    persisted.edges.push({ from: 'capacity', to: 'orders', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
    const before = structuredClone(persisted);
    const range = { form: 'range', low: 20, high: 30, period: 'a month', conditions };
    const source = { origin, quote: words, named_source: origin === 'third_party' ? 'area lead' : null };
    const declared = op === 'set_factor_value' ? { op, factor_id: 'capacity', value: range, unit: '%', stance: 'estimate', source }
      : { op, kind: 'factor', label: 'Monthly capacity growth', acts_on: 'orders', direction: 'positive', value: range, unit: '%', stance: 'estimate', source };
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'range_propose', args: {
      public_label: 'Record capacity', basis: 'Keep the person’s range as stated.', ops: [declared] } }], [{ type: 'message', text: 'Review your range.' }]];
    const first = await post({ turn_id: randomUUID(), message: String(words), source: 'composer' });
    expect(first.statusCode, first.body).toBe(200);
    expect(outputOf('range_propose')).toMatchObject({ status: 'ok', data: { public_label: `Record capacity\n20–30% a month${conditions === null ? '' : `; ${conditions}`}` } });
    const t1 = first.json() as Json;
    expect(t1._proposal_fields.proposals).toHaveLength(1);
    const card = t1._proposal_fields.proposals[0];
    expect(t1.suggested_actions.filter((c: Json) => c.id === card.approve_action.id)).toHaveLength(1);
    expect(JSON.stringify(t1.suggested_actions)).toContain('20–30% a month');
    expect(persisted).toEqual(before);
    expect(graphWrites).toHaveLength(0);
    preparedId = card.proposal_id;
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'range_apply' }], [{ type: 'message', text: 'Recorded your range.' }]];
    const press = { turn_id: randomUUID(), message: card.approve_action.message, source: 'chip', chip: { id: card.approve_action.id },
      proposal_edits: { proposal_id: card.proposal_id, revision: card.revision, digest: card.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } };
    loseRangeField = lost;
    const saved = await post(press);
    expect(saved.statusCode, saved.body).toBe(200);
    if (lost !== undefined) {
      expect(outputOf('range_apply')).toEqual({ status: 'unavailable', reason: 'not_confirmed', write: 'unknown' });
      expect(graphWrites).toHaveLength(1);
      return;
    }
    expect(outputOf('range_apply')).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: true,
      receipt: { version_id: 'dddddddd-dddd-4ddd-8ddd-000000000001' } } });
    expect(graphWrites).toHaveLength(1);
    expect(outputOf('range_apply')!.data.receipt.source_turn_id).toBe(graphWrites[0]!.turn_id);
    expect(registered).toHaveLength(0);
    const id = op === 'set_factor_value' ? 'capacity' : persisted.nodes.find((n: Json) => n.label === 'Monthly capacity growth').id;
    const subject: DoorSubject = { kind: 'factor', id, field: 'level' };
    const statement = { said_by: origin === 'third_party' ? 'party' : 'user', ...(origin === 'third_party' ? { party: 'area lead', relayed_by: 'user' } : {}), quote: words, source: words, subject: { quantity: subjectKey(subject), node_id: id },
      form: 'range', low: 20, high: 30, unit: '%', period: 'a month', ...(conditions === null ? {} : { conditions }), reading: 'olumi', stance: 'estimate' };
    const record = claimRecordFor(persisted, subject)!;
    expect(record.statements).toEqual([statement]);
    expect(record.attest).toBeUndefined();
    const after = persisted.nodes.find((n: Json) => n.id === id);
    expect(after.observed_state).toBeUndefined();
    expect(graphWrites[0]!.graph).toEqual(persisted);
    // Normal route replay of the same press cannot duplicate a committed effect.
    const replay = await post(press);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(graphWrites).toHaveLength(1);
    // Cold transport: JSON rehydration, fresh turn, read through the actual canonical-context tool.
    persisted = JSON.parse(JSON.stringify(persisted)) as Json;
    outputs = [[{ type: 'function_call', name: 'read_canonical_context', call_id: 'cold_read' }], [{ type: 'message', text: 'Your recorded range remains available.' }]];
    const cold = await post({ turn_id: randomUUID(), message: 'Reopen the saved scenario.', source: 'composer' });
    expect(cold.statusCode, cold.body).toBe(200);
    const read = outputOf('cold_read')!;
    expect(read.status).toBe('ok');
    const reopened = read.data.nodes.find((n: Json) => n.id === id);
    expect(reopened.statements.flatMap((r: Json) => r.statements)).toEqual([statement]);
    expect(reopened).not.toHaveProperty('value');
    const pointWords = 'I now state 25% for capacity.';
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'later_propose', args: {
      public_label: 'Record the later point', basis: 'A distinct later source.', ops: [{ op: 'set_factor_value', factor_id: id,
        value: 25, unit: '%', stance: 'stated_current', source: { origin: 'user', quote: pointWords, named_source: null } }] } }], [{ type: 'message', text: 'Review the later point.' }]];
    const later = (await post({ turn_id: randomUUID(), message: pointWords, source: 'composer' })).json() as Json;
    const pointCard = later._proposal_fields.proposals[0];
    preparedId = pointCard.proposal_id;
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'later_apply' }], [{ type: 'message', text: 'Recorded the later point.' }]];
    await post({ turn_id: randomUUID(), message: pointCard.approve_action.message, source: 'chip', chip: { id: pointCard.approve_action.id },
      proposal_edits: { proposal_id: pointCard.proposal_id, revision: pointCard.revision, digest: pointCard.digest, graph_hash: later._proposal_fields.graph_hash, fields: [] } });
    expect(outputOf('later_apply'), JSON.stringify(outputOf('later_apply'))).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(graphWrites).toHaveLength(2);
    const laterClaims = claimRecordFor(persisted, subject)!;
    const point = { said_by: 'user', quote: pointWords, source: pointWords,
      subject: statement.subject, form: 'point', low: 25, high: 25, unit: '%', reading: 'olumi', stance: 'stated_current' };
    expect(laterClaims.statements).toEqual(conditions === null ? [point] : [statement, point]);
    expect(laterClaims.history ?? []).toEqual(conditions === null ? [{ ...statement, status: 'superseded' }] : []);
    outputs = [[{ type: 'function_call', name: 'read_canonical_context', call_id: 'later_cold' }], [{ type: 'message', text: 'The sources remain distinct.' }]];
    await post({ turn_id: randomUUID(), message: 'Read the saved sources again.', source: 'composer' });
    const coldRecord = outputOf('later_cold')!.data.nodes.find((n: Json) => n.id === id).statements[0];
    expect(coldRecord.history ?? []).toEqual(conditions === null ? [{ ...statement, status: 'superseded' }] : []);
  });

  it.each([
    ['reversed ends', { form: 'range', low: 30, high: 20, period: 'a month', conditions: null }, '%', 'Capacity is 20–30% a month.', 'statement_malformed'],
    ['missing unit', { form: 'range', low: 20, high: 30, period: 'a month', conditions: null }, null, 'Capacity is 20–30% a month.', 'statement_malformed'],
    ['borrowed endpoint', { form: 'range', low: 20, high: 30, period: 'a month', conditions: null }, '%', 'Capacity is at least 20%.', 'quote_not_in_users_words'],
  ])('L19 malformed/source negative: %s refuses before a card', async (_label, value, unit, quote, reason) => {
    persisted.nodes.push({ id: 'capacity', kind: 'factor', label: 'Capacity growth' });
    const before = JSON.stringify(persisted);
    const words = `${quote} Revenue was 30m as of 2026-09-01.`;
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'bad_range', args: {
      public_label: 'Record capacity', basis: 'Declared range.', ops: [{ op: 'set_factor_value', factor_id: 'capacity', value, unit,
        stance: 'estimate', source: { origin: 'user', quote, named_source: null } }] } }], [{ type: 'message', text: 'The declaration could not be prepared.' }]];
    const response = await post({ turn_id: randomUUID(), message: words, source: 'composer' });
    expect(response.statusCode, response.body).toBe(200);
    expect(outputOf('bad_range')).toEqual({ status: 'refused', reason, data: { op: 0 } });
    const result = response.json() as Json;
    expect(result._proposal_fields?.proposals ?? []).toEqual([]);
    expect(result.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(JSON.stringify(persisted)).toBe(before);
    expect(graphWrites).toHaveLength(0);
  });

  it('L19 point contrast: baseline graph bytes', async () => {
    const words = 'We have 3 vans.';
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'point_propose', args: {
      public_label: 'Record 3 vans', basis: 'The person’s point.', ops: [{ op: 'set_factor_value', factor_id: 'vans', value: 3,
        unit: 'vans', stance: 'stated_current', source: { origin: 'user', quote: words, named_source: null } }] } }], [{ type: 'message', text: 'Review the point.' }]];
    const first = (await post({ turn_id: randomUUID(), message: words, source: 'composer' })).json() as Json;
    const card = first._proposal_fields.proposals[0];
    preparedId = card.proposal_id;
    // Exclude only the volatile record timestamp from the baseline graph comparison.
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'point_apply' }], [{ type: 'message', text: 'Recorded.' }]];
    await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip', chip: { id: card.approve_action.id },
      proposal_edits: { proposal_id: card.proposal_id, revision: card.revision, digest: card.digest, graph_hash: first._proposal_fields.graph_hash, fields: [] } });
    expect(outputOf('point_apply')).toMatchObject({ status: 'ok', data: { saved: true } });
    const graph = structuredClone(persisted);
    for (const node of graph.nodes) for (const record of node.user_statements ?? []) delete record.recorded_at;
    expect(createHash('sha256').update(JSON.stringify(graph)).digest('hex')).toBe('55ee874696fbf1f6eddf32349ccaf3ec06c9895515330b6ef8d3b5e66182ebb2');
  });

  it.each([
    ['We run a studio and could add evening sessions; we have 6 rooms.', 'Weekly sessions', 'sessions a week'],
    ['We run a workshop and could extend opening hours; there are 6 service bays.', 'Weekly repairs', 'repairs a week'],
  ])('L5 draft estimates convert as Olumi’s; the existing card fills an unsized model (%s)', async (brief, metric, unit) => {
    // Scripted drafter output: no estimated number was supplied by the person; the unrelated 6 is never a staffing source.
    const estimates = [
      { label: 'People on shift', unit: 'people', baseline: 3, setting: 4 },
      { label: 'Overtime per week', unit: 'hours a week', baseline: 5, setting: 6 },
      { label: 'Ramp-up time', unit: 'months', baseline: 2, setting: 1 },
    ];
    const pair = { origin: 'olumi', stance: 'estimate', provenance: 'ai_proposed' };
    const draft = {
      goal: { metric, operator: '>=', target_stated: false, value: null, unit, horizon_months: null,
        baseline_known: false, baseline_value: null, provenance: 'inferred', frame: 'level', quantity_frame: 'level' },
      options: [{ label: 'Extend hours', provenance: 'ai_proposed', changes: [], is_status_quo: false, interventions: estimates.map(e => ({
        factor_label: e.label, value: e.setting, value_kind: 'absolute', unit: e.unit, ...pair, stated_evidence: null })) }],
      factors: estimates.map(e => ({ label: e.label, role: 'controllable', baseline_known: false, baseline_value: e.baseline,
        unit: e.unit, plausible_max: null, baseline_evidence: null, ...pair })),
      links: estimates.map(e => ({ from: e.label, to: metric, direction: 'positive', ...pair, effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: false, source_quote: null, basis: 'Illustrative staffing and timing assumptions for review.' })),
      constraints: [], risks: [], outcomes: [], identities: [], statements: [], unknowns: [], unknown_concerns: [], decision_question: null,
    };
    const converted = candidateToGraph(draft, { words: brief, recorded_at: new Date().toISOString() });
    if ('refused' in converted) throw new Error(converted.refused);
    persisted = JSON.parse(JSON.stringify(converted.graph)) as Json;
    const node = (label: string): Json => (persisted.nodes as Json[]).find(n => n.label === label)!;
    const option = node('Extend hours');
    for (const e of estimates) {
      expect(node(e.label).observed_state?.raw_value ?? node(e.label).observed_state?.value).toBe(e.baseline);
      expect(valueProvenanceOf(node(e.label).observed_state).origin).toBe('ai');
      expect(node(e.label).observed_state.unit).toBe(e.unit);
      expect(option.interventions[node(e.label).id].unit).toBe(e.unit);
      expect(option.interventions[node(e.label).id].raw_value ?? option.interventions[node(e.label).id].value).toBe(e.setting);
      expect(valueProvenanceOf(option.interventions[node(e.label).id]).origin).toBe('ai');
      expect(node(e.label).user_statements ?? []).toEqual([]);
    }
    // Independently test the existing approval seam on the same model with the RC4 gaps: no operative levels/settings yet.
    // Re-approving identical operative settings is a no-op; this row proves proposed figures can fill missing inputs by press.
    for (const e of estimates) delete node(e.label).observed_state;
    delete option.interventions;
    const source = { origin: 'olumi', quote: null, named_source: null };
    const ops = estimates.flatMap(e => [
      { op: 'set_factor_value', factor_id: node(e.label).id, value: e.baseline, unit: e.unit, stance: 'estimate', source },
      { op: 'set_option_setting', option_id: option.id, factor_id: node(e.label).id, value: e.setting, unit: e.unit, stance: 'estimate', source },
    ]);
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: {
      public_label: 'Approve Olumi’s starting estimates', basis: 'Illustrative staffing and timing assumptions for review.', ops } }],
      [{ type: 'message', text: 'These are Olumi’s provisional estimates; review their units and periods before approving.' }]];
    const first = await post({ turn_id: randomUUID(), message: brief, source: 'composer' });
    expect(first.statusCode, first.body).toBe(200);
    const t1 = first.json() as Json;
    const rec = t1._proposal_fields?.proposals?.[0];
    expect(rec, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    expect(graphWrites).toHaveLength(0);
    expect(rec.fields.map((f: Json) => f.current)).toEqual(estimates.map(e => ({ value: e.baseline, unit: e.unit, source: 'estimate' })));
    preparedId = rec.proposal_id;
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: 'Saved as Olumi’s estimates.' }]];
    const second = await post({ turn_id: randomUUID(), message: rec.approve_action.message, source: 'chip', chip: { id: rec.approve_action.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } });
    expect(second.statusCode, second.body).toBe(200);
    expect(outputOf('apply_call'), JSON.stringify(outputOf('apply_call'))).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, receipt: { version_id: 'dddddddd-dddd-4ddd-8ddd-000000000001' } } });
    expect(graphWrites).toHaveLength(1);
    expect(registered).toHaveLength(0);
    for (const e of estimates) {
      expect(node(e.label).observed_state.raw_value ?? node(e.label).observed_state.value).toBe(e.baseline);
      expect(node('Extend hours').interventions[node(e.label).id].raw_value).toBe(e.setting);
      expect(valueProvenanceOf(node(e.label).observed_state)).toMatchObject({ origin: 'ai', accepted: true });
      expect(node(e.label).observed_state.unit).toBe(e.unit);
      expect(node('Extend hours').interventions[node(e.label).id].unit).toBe(e.unit);
      expect(valueProvenanceOf(node('Extend hours').interventions[node(e.label).id]).origin).toBe('ai');
      expect(node(e.label).user_statements ?? []).toEqual([]);
    }
  });

  it('⭐ RED→GREEN: "about 110 a week, not 120" → its card in THAT turn → the press → ONE registration, its own receipt, the goal holds 110', async () => {
    // Turn 1: the typed correction; the AI prepares it (propose_change) and says so. Nothing is written.
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: CORRECTION }], [{ type: 'message', text: PREPARED_WORDS }]];
    const first = await post({ turn_id: randomUUID(), message: SAID, source: 'composer' });
    expect(first.statusCode, first.body).toBe(200);
    const t1 = first.json() as Json;
    preparedId = String((t1._agent.tool_calls as Json[]).find((c) => c.name === 'propose_change' && c.ok)?.proposal_id ?? '');
    expect(preparedId, `PRECONDITION: the AI prepared the change ${JSON.stringify(t1._agent.tool_calls)}`).toMatch(/^prop_/);
    const card = (t1.suggested_actions as Json[]).find((c) => c.id === `agent-approve-proposal:${preparedId}`);
    const rec = (t1._proposal_fields?.proposals as Json[] | undefined)?.find((f) => f.proposal_id === preparedId);
    expect(card, `the card is in THAT turn: ${JSON.stringify(t1.suggested_actions)}`).toBeDefined();
    expect(rec, JSON.stringify(t1._proposal_fields)).toBeDefined();
    expect(registered).toHaveLength(0);
    expect(goalRaw()).toBe(120);

    // Turn 2: the press on that card. The AI's first call is apply_change (the press approves it); then it narrates.
    calls = [];
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: SAVED_WORDS }]];
    const second = await post({ turn_id: randomUUID(), message: card!.message, source: 'chip_click', chip: { id: card!.id },
      displayed_proposals: [{ proposal_id: rec!.proposal_id, revision: rec!.revision }] });
    expect(second.statusCode, second.body).toBe(200);
    const t2 = second.json() as Json;
    expect(calls[0]?.tool_choice, 'the press is the approval of that change’s own apply_change').toMatchObject({ type: 'function', name: 'apply_change' });
    expect((t2._agent.tool_calls as Json[]).map((c) => c.name), 'never the full lane’s writer').not.toContain('authorise_change');
    const applied = outputOf('apply_call');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(registered, 'ONE registration').toHaveLength(1);
    expect(graphWrites, 'no other writer').toHaveLength(0);
    expect(applied?.data?.receipt?.version_id, 'THAT registration’s own receipt').toBe('v_reg_1');
    expect(goalRaw()).toBe(110);
    expect(pausedRun, 'nothing is left paused').toBeNull();
  });

  it('⭐ RED→GREEN (P0, served efa5c543 K5-LOOP turn-03): the UI\'s normal press, with the issued card\'s envelope and NO fields, saves ONCE', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: CORRECTION }], [{ type: 'message', text: PREPARED_WORDS }]];
    const t1 = (await post({ turn_id: randomUUID(), message: SAID, source: 'composer' })).json() as Json;
    preparedId = String((t1._agent.tool_calls as Json[]).find((c) => c.name === 'propose_change' && c.ok)?.proposal_id ?? '');
    const rec = (t1._proposal_fields?.proposals as Json[] | undefined)?.find((f) => f.proposal_id === preparedId);
    expect(rec, `PRECONDITION: the issued card ${JSON.stringify(t1._proposal_fields)}`).toBeDefined();
    // The served request body, byte for byte in shape (redteam/core-accept/runs/20261019T213721Z/K5-LOOP/turn-03.json): source
    // `chip`, the card's own id and words, and `proposal_edits` carrying the issued id, revision, digest and graph hash, fields [].
    calls = [];
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: SAVED_WORDS }]];
    const second = await post({ turn_id: randomUUID(), message: rec!.approve_action.message, source: 'chip', chip: { id: rec!.approve_action.id },
      proposal_edits: { proposal_id: rec!.proposal_id, revision: rec!.revision, digest: rec!.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } });
    expect(second.statusCode, second.body).toBe(200);
    const t2 = second.json() as Json;
    expect(t2.assistant_text, 'never "Those values could not be applied"').toBe(SAVED_WORDS);
    expect(outputOf('apply_call'), JSON.stringify(t2._agent.tool_calls)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(registered, 'ONE registration').toHaveLength(1);
    expect(goalRaw()).toBe(110);
  });

  it.each([
    ['a minus before the figure', 'Correction: net, we sit at -110 a week now, not 120.', '-110 a week', 'figure_not_in_quote'],
    ['a quote that is not the typed bytes', 'Correction: about 110  a week, not 120.', 'about 110 a week', 'quote_not_in_users_words'],
  ])('⭐ (Codex #3471 R2, KNOWN GAP 1) on core, %s: the AI\'s +110 is refused in THAT turn; no card, nothing saved, the goal stays 120', async (_, words, quote, reason) => {
    const declared = { ...CORRECTION, ops: [{ ...CORRECTION.ops[0], source: { ...CORRECTION.ops[0].source, quote } }] };
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: declared }], [{ type: 'message', text: 'I could not prepare that.' }]];
    const r = await post({ turn_id: randomUUID(), message: words, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const t = r.json() as Json;
    expect(outputOf('prop_call'), 'the AI is told why, by its code').toMatchObject({ status: 'refused', reason });
    expect((t.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:')), 'no card to press').toEqual([]);
    expect(t._proposal_fields?.proposals ?? [], 'no proposal issued').toEqual([]);
    expect(registered, 'nothing registered').toHaveLength(0);
    expect(goalRaw(), 'the goal keeps its level').toBe(120);
  });

  // THIN CORE FLIP (A1, #3522): off production, `openai` now selects the core lane (pinned in ai-core-lane-mode.test.ts), so
  // the legacy lane's reply and model bytes are pinned on `conventional` alone.
  it.each(['conventional'])('L2c parity: %s keeps its base reply and model bytes', async (mode) => {
    SCENARIO = '5c5c5c5c-0000-4000-8000-000000000039';
    const before = JSON.stringify(persisted);
    outputs = [[{ type: 'message', text: 'The current baseline is 120 a week.' }]];
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': mode },
      payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
        turn_id: '5c5c5c5c-0000-4000-8000-000000000040', message: SAID, source: 'composer' } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as Json;
    expect(JSON.stringify(persisted)).toBe(before);
    expect(registered).toHaveLength(0);
    expect(graphWrites).toHaveLength(0);
    // Captured on a202a4dd: reply bytes and stable protocol fields; volatile telemetry is excluded.
    const bytes = JSON.stringify({ reply: body.assistant_text, actions: body.suggested_actions, graph: body.draft_graph,
      mode: body._agent.mode, tools: body._agent.tool_calls });
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('4c91beefa9681a5ebf3fd09241d48ee567d8c67c71c140cbfb8fa11ab7b1856c');
  });

  it.each([
    [SAID, 110, 'orders a week', 'about 110 a week', false],
    ['Revenue was 2m on 2026-09-01. Our delivery baseline is about 105 a month, not 120; the deadline is June.', 105, 'deliveries a month', 'about 105 a month', false],
    [SAID, 110, 'orders a week', 'about 110 a week', true],
  ] as const)('L2c declared-sum baseline: %s → %s %s (%s), lost operand claim=%s', async (words, value, unit, quote, lostClaim) => {
    const goal = (persisted.nodes as Json[]).find(n => n.id === 'orders')!;
    goal.goal_threshold_unit = unit; goal.observed_state.unit = unit;
    goal.nonlinear_identity = { operation: 'sum', factor_ids: ['current_orders', 'extra_orders'], stated_in_brief: false };
    persisted.nodes.push({ id: 'current_orders', kind: 'factor', label: 'Current weekly orders', observed_state: structuredClone(goal.observed_state) },
      { id: 'extra_orders', kind: 'factor', label: 'Additional weekly orders', observed_state: { value: 0, raw_value: 0, cap: 187.5, unit: 'orders a week' } });
    // A coincident label/number on a different factor must not bind or move with this declared quantity.
    persisted.nodes.push({ id: 'coincidence', kind: 'factor', label: 'Current weekly orders', observed_state: structuredClone(goal.observed_state) });
    const subject = (id: string): DoorSubject => ({ kind: id === 'orders' ? 'goal' : 'factor', id, field: 'level' });
    for (const id of ['orders', 'current_orders', 'coincidence']) {
      const old = userStatementOf({ said_by: 'user', quote: '120', source: 'Our current baseline is 120.',
        subject: { quantity: subjectKey(subject(id)), node_id: id }, form: 'point', low: 120, high: 120, unit,
        reading: 'olumi', stance: 'stated_current', claim_id: `old-${id}` })!;
      const other = { ...old, said_by: 'party' as const, party: 'area lead', relayed_by: 'user' as const, claim_id: `party-${id}` };
      persisted.nodes.find((n: Json) => n.id === id).user_statements = [userStatementRecord(subject(id), [old, other], '2026-10-19T12:00:00.000Z', CONSTRUCTION_ATTEST)];
    }
    const beforeRecords = new Map(['orders', 'current_orders'].map(id => [id, claimRecordFor(persisted, subject(id))!]));
    const untouched = structuredClone(persisted.nodes.filter((n: Json) => n.id !== 'orders' && n.id !== 'current_orders'));
    const declared = { ...CORRECTION.ops[0], value, unit, source: { origin: 'user', quote, named_source: null } };
    const correction = { ...CORRECTION, ops: [declared,
      { ...declared, op: 'set_factor_value', goal_id: undefined, factor_id: 'current_orders' }] };
    delete correction.ops[1]!.goal_id;
    if (value === 105) correction.ops.reverse();
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: correction }], [{ type: 'message', text: PREPARED_WORDS }]];
    const first = await post({ turn_id: randomUUID(), message: words, source: 'composer' });
    expect(first.statusCode, first.body).toBe(200);
    expect(outputOf('prop_call')).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    const t1 = first.json() as Json;
    expect(t1._proposal_fields.proposals).toHaveLength(1);
    const cardWords = `Record today's level of "${goal.label}" and "Current weekly orders" as your figure: ${value} ${unit} in the same save.`;
    expect(outputOf('prop_call')!.data.public_label).toBe(cardWords);
    const rec = t1._proposal_fields.proposals[0];
    const held = (await store.readMostRecentPendingActions()).find((h: Json) => h.chip_id === rec.approve_action.id);
    expect(held.action.inline_patch.agent_proposal.public_label).toBe(cardWords);
    preparedId = rec.proposal_id;
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: SAVED_WORDS }]];
    const saveTurnId = randomUUID();
    loseOperandClaim = lostClaim;
    const saved = await post({ turn_id: saveTurnId, message: rec.approve_action.message, source: 'chip', chip: { id: rec.approve_action.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(registered).toHaveLength(1);
    if (lostClaim) {
      expect(persisted.nodes.filter((n: Json) => n.id === 'orders' || n.id === 'current_orders').map((n: Json) => n.observed_state.raw_value)).toEqual([value, value]);
      expect(claimRecordFor(persisted, subject('current_orders'))).toEqual(beforeRecords.get('current_orders'));
      expect(outputOf('apply_call')).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
      return;
    }
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: true } });
    const operand = (persisted.nodes as Json[]).find(n => n.id === 'current_orders')!;
    const afterGoal = (persisted.nodes as Json[]).find(n => n.id === 'orders')!;
    expect(afterGoal.observed_state.raw_value).toBe(value);
    expect(operand.observed_state).toEqual(afterGoal.observed_state);
    for (const id of ['orders', 'current_orders']) {
      const record = claimRecordFor(persisted, subject(id))!;
      const old = beforeRecords.get(id)!;
      expect(record.statements).toEqual([{ ...old.statements[1], status: 'proposed' }, expect.objectContaining({ said_by: 'user', low: value, high: value,
        quote, source: words, stance: 'stated_current', unit, subject: { quantity: subjectKey(subject(id)), node_id: id }, supersedes: [`old-${id}`] })]);
      expect(record.history).toEqual([{ ...old.statements[0], status: 'superseded' }]);
      expect(registered[0]!.graph.nodes.find((n: Json) => n.id === id).user_statements).toEqual(persisted.nodes.find((n: Json) => n.id === id).user_statements);
    }
    expect(persisted.nodes.filter((n: Json) => n.id !== 'orders' && n.id !== 'current_orders')).toEqual(untouched);
    const applied = outputOf('apply_call')!;
    expect(applied.data.written[0].current_level_operand).toEqual({ factor_id: 'current_orders', observed_state: afterGoal.observed_state, claim: { said_by: 'user' } });
    expect(saved.json()._agent.receipts).toEqual([applied.data.receipt]);
    expect(applied.data.receipt.source_turn_id).toBe(registrationTurnId(SCENARIO, registered[0]!.operation_id));
    const count = calls.length;
    const replay = await post({ turn_id: saveTurnId,
      message: rec.approve_action.message, source: 'chip', chip: { id: rec.approve_action.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(calls).toHaveLength(count);
    expect(registered).toHaveLength(1);
    for (const id of ['orders', 'current_orders']) {
      const reopened = replay.json().draft_graph.nodes.find((n: Json) => n.id === id);
      const savedNode = persisted.nodes.find((n: Json) => n.id === id);
      expect(reopened.observed_state).toEqual(savedNode.observed_state);
      expect(reopened.user_statements).toEqual(savedNode.user_statements);
      expect(claimRecordFor(persisted, subject(id))!.statements).toHaveLength(2);
      expect(claimRecordFor(persisted, subject(id))!.history).toHaveLength(1);
    }
  });

  it.each([
    ['Correction: about 110 a week, not 120.', 110, 'orders a week', 'about 110 a week', 'Weekly orders'],
    ['Revenue was 2m on 2026-09-01. Our delivery baseline is about 105 a month, not 120; the deadline is June.', 105, 'deliveries a month', 'about 105 a month', 'Monthly deliveries'],
  ])('L2 save-outcome: %s → save → failed continuation → immediate same-turn replay, with held cards retained', async (words, value, unit, quote, label) => {
    const goal = (persisted.nodes as Json[]).find(n => n.id === 'orders')!;
    goal.label = label; goal.goal_threshold_unit = unit; goal.observed_state.unit = unit;
    const correction = { ...CORRECTION, ops: [{ ...CORRECTION.ops[0], value, unit,
      source: { origin: 'user', quote, named_source: null } }] };
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: correction }], [{ type: 'message', text: PREPARED_WORDS }]];
    const t1 = (await post({ turn_id: randomUUID(), message: words, source: 'composer' })).json() as Json;
    const rec = t1._proposal_fields?.proposals?.[0];
    expect(rec, JSON.stringify(t1)).toBeDefined();
    preparedId = rec.proposal_id;
    const heldBefore = structuredClone(await store.readMostRecentPendingActions());
    expect(heldBefore.length).toBeGreaterThan(0);
    // An unrelated, still-held card arrives DURING the save, after the route read its initial pending set.
    const other = createProposal({ scenario_id: SCENARIO, user_id: null, base_graph_identity_hash: hashOf(persisted),
      base_model_identity: identityOf(persisted), operations: [{ op: 'update_node', path: 'vans', value: { label: 'Fleet vans' } }],
      provenance: { authored_by: 'model_proposed', basis: 'A clearer label.' }, validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: 'Rename Vans on the road to Fleet vans' });
    concurrentHold = proposalPendingAction(other, { id: approvalChipIdFor(other.proposal_id), label: 'Make this change', message: 'Yes, rename it.' },
      { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() });
    const turnId = randomUUID();
    const payload = { turn_id: turnId, message: rec.approve_action.message, source: 'chip', chip: { id: rec.approve_action.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } };
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'provider_failure' }]];
    const failed = await post(payload);
    expect(failed.statusCode, failed.body).toBe(502);
    expect(failed.json()).toMatchObject({ error: 'UPSTREAM_ERROR', nothing_saved: false, retry_safe: false, save_outcome: 'VERIFIED_SAVED' });
    expect(registered).toHaveLength(1);
    expect(goalRaw()).toBe(value);
    const answer = turnRows.get(turnId);
    expect(answer, 'the catch records the answer BEFORE a retry, avoiding the 151s claim wait').toBeDefined();
    expect(answer.user_message).toBe(payload.message);
    expect(answer.assistant_message).toBe('The saved change is kept, but the reply didn’t arrive. Send a new message to continue.');
    expect(answer.pending_actions, 'the latest durable holds survive the answer append').toEqual([...heldBefore, concurrentHold]);
    const claimedCalls = calls.length;
    const rowCount = turnRows.size;
    const replay = await post(payload);
    expect(replay.statusCode, replay.body).toBe(200);
    const body = replay.json() as Json;
    expect(body.assistant_text).toBe(answer.assistant_message);
    expect(body._agent).toMatchObject({ replayed: true, tool_calls: [] });
    expect(body.graph_hash).toBe(hashOf(persisted));
    expect(body.draft_graph.nodes.find((n: Json) => n.id === 'orders').observed_state.raw_value).toBe(value);
    expect(calls).toHaveLength(claimedCalls);
    expect(turnRows.size).toBe(rowCount);
    expect(registered).toHaveLength(1);
    expect(goalRaw()).toBe(value);
    const claims = (persisted.nodes as Json[]).find(n => n.id === 'orders')!.user_statements.flatMap((r: Json) => r.statements);
    expect(claims.filter((s: Json) => s.quote === quote)).toHaveLength(1);
    expect(claims.find((s: Json) => s.quote === quote)).toMatchObject({ said_by: 'user', low: value, high: value, source: words });
  });

  it('L2 unknown save: dispatched registration without its receipt never becomes verified saved on failure or replay', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: CORRECTION }], [{ type: 'message', text: PREPARED_WORDS }]];
    const t1 = (await post({ turn_id: randomUUID(), message: SAID, source: 'composer' })).json() as Json;
    const rec = t1._proposal_fields.proposals[0]; preparedId = rec.proposal_id;
    noReceipt = true;
    const payload = { turn_id: randomUUID(), message: rec.approve_action.message, source: 'chip', chip: { id: rec.approve_action.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: t1._proposal_fields.graph_hash, fields: [] } };
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'provider_failure' }]];
    const failed = await post(payload);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ save_outcome: 'UNKNOWN', nothing_saved: false, retry_safe: false });
    const answer = turnRows.get(payload.turn_id);
    expect(answer.assistant_message).toBe('The reply didn’t arrive. Any changes already saved are kept. Send a new message to continue.');
    const callsBefore = calls.length;
    const replay = await post(payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assistant_text).toBe(answer.assistant_message);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().draft_graph.nodes.find((n: Json) => n.id === 'orders').observed_state.raw_value).toBe(110);
    expect(calls).toHaveLength(callsBefore);
    expect(registered).toHaveLength(1);
  });

});
