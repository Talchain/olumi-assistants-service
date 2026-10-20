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
  readRecent: vi.fn(async () => []),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    if (write.graph !== undefined) { graphWrites.push(write); return { id: `graph-${graphWrites.length}` }; }
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
      return json(responsesBody(outputs.shift() ?? [{ type: 'message', text: 'Done.' }]));
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
      registered.push(b);
      persisted = structuredClone(b.graph) as Json;
      return { graph_hash: hashOf(persisted), model_version: { version_number: 100 + registered.length, version_id: `v_reg_${registered.length}`,
        mutation_id: `m_reg_${registered.length}` } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: registered.map((b, i) => ({ version_id: `v_reg_${i + 1}`, sequence: 101 + i,
      creation: { kind: 'committed_mutation', mutation_id: `m_reg_${i + 1}`, source_turn_id: registrationTurnId(SCENARIO, String(b.operation_id)) } })).reverse() }));
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: '', suggested_actions: [], insights: [], blocks: [] }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = stored(); registered.length = 0; graphWrites.length = 0; turnRows.clear(); conversationIds.clear();
    pausedRun = null; calls = []; outputs = []; preparedId = '';
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const outputOf = (callId: string): Json | undefined => {
    const item = calls.flatMap((b) => (Array.isArray(b.input) ? b.input : [])).find((i: Json) => i.type === 'function_call_output' && i.call_id === callId);
    return item === undefined ? undefined : JSON.parse(String(item.output)) as Json;
  };

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
});
