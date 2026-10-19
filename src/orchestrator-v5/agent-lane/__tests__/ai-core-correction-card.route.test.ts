/**
 * ⭐ PATH-B (VERIFIER K7/K9, 19 Oct 19:56Z–20:13Z, live ed620f64): A CORE CORRECTION SHOWS ITS CARD IN THAT TURN, AND A PRESS ON
 * IT COMMITS ONCE, WITH ITS OWN RECEIPT.
 * Measured: propose_change returned ok and the turn had NO card (K7); after a typed "yes" the card came back as "review" ("prepared
 * before the model changed"), or the approval was refused `superseded` and nothing was committed (K9).
 * Cause (read, one seam): the core proposal's base was the read's graph IDENTITY hash (change-tools.ts proposeChange /
 * proposeCompound / proposeTarget), where every proposer, the card machinery (still-applies.ts `heldCardAppliesAt`, the route's
 * persistence floor) and the approval check read its graph HASH. So the card never applied to the model it was shown on, and an
 * approval read the proposal as made on another model. And a press on a card that never paused had no native path: it reached the
 * full lane's writer.
 * Now: ONE base (the graph hash) for proposal, card and approval; a press approves the SAME change through the SDK's own
 * apply_change (the run's first call names it; this press approves the interruption it raises). CAS and consent are unchanged.
 * Harness: the real route, SDK, card carrier, C5's adapters AND the real door (`commitOptionLevelsInProcess`, the store that
 * `ai-core-proposal-restart.test.ts` serves: the append returns the version receipt); a scripted AI (0 provider calls). SYNTHETIC.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createHash } from 'node:crypto';
import { graph as fixtureGraph } from '../../path-b/tools/__tests__/fixtures.js';

type Json = Record<string, any>;
/** A fresh scenario per row: a proposal's id is its content (scenario, user, base, operations), so rows never share one. */
let SCENARIO = '';
const CORE = { 'x-olumi-ai-mode': 'core' };
const SAID = 'Correction: on a Saturday the queue is about 20 minutes, not 30.';
const CORRECTION = { public_label: 'Correct the queue time', basis: 'The user corrected today\'s figure.',
  ops: [{ op: 'set_factor_value', factor_id: 'queue', value: 20, unit: 'minutes', stance: 'stated_current',
    source: { origin: 'user', quote: 'on a Saturday the queue is about 20 minutes', named_source: null } }] };
const PREPARED_WORDS = 'I have prepared your correction to 20 minutes; press its card to save it.';
const SAVED_WORDS = 'Saved: the queue time is now 20 minutes.';

/** The saved scenario: one stored graph the graph route reads and the door writes, and its versions. */
let persisted: Json;
type Receipt = { version_number: number; version_id: string; mutation_id: string; source_turn_id: string };
const doorRows = new Map<string, { id: string; write: Json; receipt?: Receipt }>();
const turnRows = new Map<string, any>();
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
function stored(): Json {
  const g = fixtureGraph() as { nodes: Json[] };
  const nodes = g.nodes.map((n) => n.id === 'queue' ? { ...n, observed_state: { value: 0.3, raw_value: 30, unit: 'minutes', cap: 100 } } : n);
  return projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes }), options: [] as Json[] }) as Json;
}
const queueRaw = (): unknown => ((persisted.nodes as Json[]).find((n) => n.id === 'queue')?.observed_state as Json | undefined)?.raw_value;

const store = {
  // The core lane's state on the scenario.
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  // The door's store (`ai-core-proposal-restart.test.ts`): a graph write returns its version receipt.
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async () => [...doorRows.values()].reverse().map((r) => ({ id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id,
    turn_class: r.write.turn_class, handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
    llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms, assistant_message: r.write.assistantMessage ?? null, created_at: '2026-10-19T12:00:00.000Z' }))),
  readFactsWithTurnFor: async (ids: readonly string[]) => [...doorRows.values()].flatMap((r) => !ids.includes(r.id) ? []
    : ((r.write.handler_facts ?? []) as unknown[]).map((fact) => ({ turn_id: r.id, fact_created_at: '2026-10-19T12:00:00.000Z', fact }))),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const key = String(write.turn_id);
    if (write.graph === undefined) {
      // The route's own claim and answer rows.
      const prior = turnRows.get(key);
      if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
      const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date().toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
      turnRows.set(key, row);
      return { id: row.id };
    }
    const existing = doorRows.get(key);
    if (existing !== undefined) return { id: existing.id, replayedPriorTurn: true };
    const id = `door-${doorRows.size + 1}`;
    const mv = write.modelVersion as { graph_identity_hash: string; analysis_affecting_hash: string } | undefined;
    const receipt = mv === undefined ? undefined : {
      mutation_id: key, version_id: `dddddddd-dddd-4ddd-8ddd-${String(doorRows.size + 2).padStart(12, '0')}`, version_number: doorRows.size + 2,
      graph_identity_hash: mv.graph_identity_hash, analysis_affecting_hash: mv.analysis_affecting_hash, hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'unknown' as const, authored_by: null, creation_kind: 'committed_mutation' as const, source_version_id: null,
      source_turn_id: key, parent_version_id: null, root_version_id: null, undo_version_id: null,
      graph: JSON.parse(JSON.stringify(write.graph)) as unknown, event_id: `event-${key}`,
    };
    doorRows.set(key, { id, write: JSON.parse(JSON.stringify(write)) as Json, ...(receipt === undefined ? {} : { receipt }) });
    persisted = write.graph as Json;
    return { id, ...(receipt === undefined ? {} : { modelVersionReceipt: receipt }) };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** One scripted Responses API body. */
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

describe('PATH-B: a core correction shows its card in THAT turn; a press on it commits ONCE through the SDK\'s own apply_change', () => {
  let app: FastifyInstance;
  let calls: Json[] = [];
  let outputs: Json[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: 'conv_card', object: 'conversation' });
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return json(responsesBody(outputs.shift() ?? [{ type: 'message', text: 'Done.' }]));
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: persisted, graph_hash: hashOf(persisted),
      graph_identity_hash: { kind: 'graph_identity', value: identityOf(persisted), algorithm: 'sha256' },
      analysis_ready: { status: 'blocked', options: [], blockers: [] } }));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [...doorRows.values()].filter((r) => r.receipt !== undefined).reverse().map((r) => ({
      version_id: r.receipt!.version_id, sequence: r.receipt!.version_number,
      creation: { kind: 'committed_mutation', mutation_id: r.receipt!.mutation_id, source_turn_id: r.receipt!.source_turn_id } })) }));
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: '', suggested_actions: [], insights: [], blocks: [] }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = stored(); doorRows.clear(); turnRows.clear(); conversationIds.clear(); pausedRun = null; calls = []; outputs = []; preparedId = '';
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const commits = () => [...doorRows.values()].filter((r) => r.receipt !== undefined);
  /** Turn 1: the typed correction; the AI prepares it (propose_change) and says so. */
  const corrected = async (): Promise<{ j: Json; card: Json; rec: Json }> => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: CORRECTION }], [{ type: 'message', text: PREPARED_WORDS }]];
    const r = await post({ turn_id: randomUUID(), message: SAID, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    preparedId = String((j._agent.tool_calls as Json[]).find((c) => c.name === 'propose_change' && c.ok)?.proposal_id ?? '');
    expect(preparedId, `PRECONDITION: the AI prepared the change ${JSON.stringify(j._agent.tool_calls)}`).toMatch(/^prop_/);
    const card = (j.suggested_actions as Json[]).find((c) => c.id === `agent-approve-proposal:${preparedId}`);
    const rec = (j._proposal_fields?.proposals as Json[] | undefined)?.find((f) => f.proposal_id === preparedId);
    return { j, card: card!, rec: rec! };
  };
  /** Turn 2: the press on that card (or the typed button words). The AI's first call is apply_change; then it narrates. */
  const pressed = (card: Json, rec: Json, how: 'chip' | 'typed' = 'chip', extra: Json = {}) => {
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: SAVED_WORDS }]];
    return post({ turn_id: randomUUID(), message: card.message, source: how === 'chip' ? 'chip_click' : 'composer',
      ...(how === 'chip' ? { chip: { id: card.id } } : {}), displayed_proposals: [{ proposal_id: rec.proposal_id, revision: rec.revision }], ...extra });
  };
  const outputOf = (callId: string): Json | undefined => {
    const item = calls.flatMap((b) => (Array.isArray(b.input) ? b.input : [])).find((i: Json) => i.type === 'function_call_output' && i.call_id === callId);
    return item === undefined ? undefined : JSON.parse(String(item.output)) as Json;
  };

  it('⭐ RED→GREEN: the correction turn itself carries the approve card and its proposal fields; nothing is committed', async () => {
    const { j, card, rec } = await corrected();
    expect(card, JSON.stringify(j.suggested_actions)).toBeDefined();
    expect(rec, JSON.stringify(j._proposal_fields)).toBeDefined();
    expect(j.assistant_text).toBe(PREPARED_WORDS);
    expect(commits()).toHaveLength(0);
    expect(queueRaw()).toBe(30);
  });

  it('⭐ RED→GREEN: the press commits ONCE through the SDK\'s own apply_change, with ITS receipt; the model holds 20', async () => {
    const { card, rec } = await corrected();
    expect(card, 'PRECONDITION: the card').toBeDefined();
    calls = [];
    const r = await pressed(card, rec);
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(calls[0]?.tool_choice, 'the press is the approval of that change\'s own apply_change').toMatchObject({ type: 'function', name: 'apply_change' });
    expect((j._agent.tool_calls as Json[]).map((c) => c.name), 'never the full lane\'s writer').not.toContain('authorise_change');
    const applied = outputOf('apply_call');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(commits(), 'ONE commit').toHaveLength(1);
    expect(applied?.data?.receipt?.version_id, 'its own receipt').toBe(commits()[0]!.receipt!.version_id);
    expect(queueRaw()).toBe(20);
    expect(j.assistant_text).toBe(SAVED_WORDS);
    expect(pausedRun, 'nothing is left paused').toBeNull();
  });

  it('⭐ RED→GREEN (K9): the typed button words approve it the same way: ONE commit, never "superseded"', async () => {
    const { card, rec } = await corrected();
    const r = await pressed(card, rec, 'typed');
    expect(r.statusCode, r.body).toBe(200);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', mutated: true });
    expect(commits()).toHaveLength(1);
    expect(queueRaw()).toBe(20);
  });

  it('⭐ RED→GREEN (K9 as measured): a plain "yes" pauses the change on its card with no "Model changed" line on the unchanged model; the press commits ONCE', async () => {
    await corrected();
    // The person types a plain "yes" (not the button's words): the AI calls apply_change, which pauses for approval.
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }]];
    const yes = await post({ turn_id: randomUUID(), message: 'yes', source: 'composer' });
    expect(yes.statusCode, yes.body).toBe(200);
    const y = yes.json() as Json;
    expect(pausedRun?.proposal_id, 'paused on that change').toBe(preparedId);
    expect(String(y.assistant_text), 'the model did not change: no review line').not.toMatch(/Model changed|prepared before the model changed/);
    const card = (y.suggested_actions as Json[]).find((c) => c.id === `agent-approve-proposal:${preparedId}`);
    const rec = (y._proposal_fields?.proposals as Json[] | undefined)?.find((f) => f.proposal_id === preparedId);
    expect(card, JSON.stringify(y.suggested_actions)).toBeDefined();
    expect(rec, JSON.stringify(y._proposal_fields)).toBeDefined();
    expect(commits()).toHaveLength(0);
    // The press resumes THAT paused call, approved: apply_change runs once, never authorise_change, never "superseded".
    outputs = [[{ type: 'message', text: SAVED_WORDS }]];
    const r = await post({ turn_id: randomUUID(), message: card!.message, source: 'chip_click', chip: { id: card!.id },
      displayed_proposals: [{ proposal_id: rec!.proposal_id, revision: rec!.revision }] });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect((j._agent.tool_calls as Json[]).map((c) => c.name)).not.toContain('authorise_change');
    expect(outputOf('apply_call'), 'the resumed call\'s own outcome').toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(commits(), 'ONE commit').toHaveLength(1);
    expect(outputOf('apply_call')?.data?.receipt?.version_id).toBe(commits()[0]!.receipt!.version_id);
    expect(queueRaw()).toBe(20);
    expect(pausedRun).toBeNull();
  });

  it('⭐ a second press on the same card commits nothing more', async () => {
    const { card, rec } = await corrected();
    await pressed(card, rec);
    expect(commits()).toHaveLength(1);
    calls = [];
    const again = await pressed(card, rec);
    expect(again.statusCode, again.body).toBe(200);
    expect(commits(), 'still ONE commit').toHaveLength(1);
    expect(queueRaw()).toBe(20);
    expect(outputOf('apply_call'), 'said as the earlier save, with that save\'s own receipt').toMatchObject({ status: 'ok', mutated: false,
      data: { already_saved: true, receipt: { version_id: commits()[0]!.receipt!.version_id } } });
  });

  it('⛔ CAS kept: a model moved by someone else after the card → superseded, nothing committed', async () => {
    const { card, rec } = await corrected();
    persisted = { ...persisted, nodes: (persisted.nodes as Json[]).map((n) => n.id === 'staff' ? { ...n, observed_state: { ...(n.observed_state as Json), value: 0.3, raw_value: 3 } } : n) };
    await pressed(card, rec);
    expect(outputOf('apply_call'), 'the CAS refuses it: never bypassed').toMatchObject({ status: 'refused', reason: 'superseded' });
    expect(commits()).toHaveLength(0);
    expect(queueRaw()).toBe(30);
  });

  it('⛔ CAS kept (Codex #3472 R1): the card\'s own factor RENAMED after the card (graph hash unchanged) → superseded, nothing committed', async () => {
    const { card, rec } = await corrected();
    const identityBefore = identityOf(persisted), hashBefore = hashOf(persisted);
    persisted = { ...persisted, nodes: (persisted.nodes as Json[]).map((n) => n.id === 'queue' ? { ...n, label: 'Time to resolve a complaint' } : n) };
    expect(identityOf(persisted), 'PRECONDITION: the model\'s identity moved').not.toBe(identityBefore);
    expect(hashOf(persisted), 'PRECONDITION: a rename the graph hash cannot see').toBe(hashBefore);
    await pressed(card, rec);
    expect(outputOf('apply_call'), 'the identity CAS refuses it').toMatchObject({ status: 'refused', reason: 'superseded' });
    expect(commits()).toHaveLength(0);
    expect(queueRaw()).toBe(30);
  });

  /** The UI's ordinary press, as served (browser K5-LOOP 21:40Z ROWS.json): source `chip`, the card's own id and words, and
   * `proposal_edits` carrying the issued id, revision, digest and graph hash with NO fields. */
  const servedPress = (rec: Json, graphHash: string, over: Json = {}) => {
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: SAVED_WORDS }]];
    return post({ turn_id: randomUUID(), message: rec.approve_action.message, source: 'chip', chip: { id: rec.approve_action.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: graphHash, fields: [], ...over } });
  };

  it('⭐ RED→GREEN (P0, served efa5c543 browser K5): the UI\'s normal press with the issued envelope and NO fields saves ONCE', async () => {
    const { j, rec } = await corrected();
    calls = [];
    const r = await servedPress(rec, j._proposal_fields.graph_hash);
    expect(r.statusCode, r.body).toBe(200);
    const t2 = r.json() as Json;
    expect(t2.assistant_text, 'never "Those values could not be applied"').toBe(SAVED_WORDS);
    expect(outputOf('apply_call')).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(commits(), 'ONE commit').toHaveLength(1);
    expect(queueRaw()).toBe(20);
    // VERIFIER 22:26Z (3): the press turn carries THAT commit's own receipt on the wire, not only the readback.
    expect(t2._agent.receipts, 'the commit\'s own receipt rides the reply').toEqual([expect.objectContaining({ version_id: commits()[0]!.receipt!.version_id,
      version: commits()[0]!.receipt!.version_number })]);
  });

  it('⛔ (P0 negatives) an envelope that is not THIS card as issued is still refused before anything runs: nothing is committed', async () => {
    const { j, rec } = await corrected();
    for (const over of [{ digest: 'not-the-issued-digest' }, { revision: 'not-the-issued-revision' }, { fields: [{ field_id: `factor_value:queue`, value: 25 }] }]) {
      calls = [];
      const r = await servedPress(rec, j._proposal_fields.graph_hash, over);
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json() as Json).assistant_text, JSON.stringify(over)).toMatch(/could not be applied/);
      expect(calls.length, `no model call: ${JSON.stringify(over)}`).toBe(0);
    }
    expect(commits()).toHaveLength(0);
    expect(queueRaw()).toBe(30);
  });

  it('⛔ a press carrying edits is refused before anything runs; nothing is committed', async () => {
    const { card, rec } = await corrected();
    calls = [];
    const r = await pressed(card, rec, 'chip', { proposal_edits: { proposal_id: rec.proposal_id, digest: 'wrong', fields: 'malformed' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(commits()).toHaveLength(0);
    expect(calls.length, 'no model call').toBe(0);
  });

  it('⛔ the first call naming ANOTHER proposal is not approved by this press: nothing is committed', async () => {
    const { card, rec } = await corrected();
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call', args: { proposal_id: 'prop_00000000000000000000000000000000' } }],
      [{ type: 'message', text: 'Nothing was applied.' }]];
    const r = await post({ turn_id: randomUUID(), message: card.message, source: 'chip_click', chip: { id: card.id },
      displayed_proposals: [{ proposal_id: rec.proposal_id, revision: rec.revision }] });
    expect(r.statusCode, r.body).toBe(200);
    expect(outputOf('apply_call'), 'that call never ran').toBeUndefined();
    expect(commits()).toHaveLength(0);
  });
});
