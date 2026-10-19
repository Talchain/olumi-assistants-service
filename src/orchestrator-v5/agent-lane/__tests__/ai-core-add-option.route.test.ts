/**
 * ⭐ PATH-B GAP 2, OPTIONS (DL-3 22:12Z): a NEW option the person names, with its settings ("another option: hire two temps"), is
 * prepared on a card in that turn and committed ONCE by the press, with its own receipt.
 * Mapping only: the AI's declaration (`add_option`: the decision, the name, each setting with its figure, unit, stance and source)
 * is carried onto the EXISTING add-option door (its builder `buildAddOptionTransaction`: id, decision, factors and same-settings
 * rules; its confirm apply `executeGmHeldResume`) inside the batch door's ONE commit. Each setting passes today's rules for an
 * option's setting (the ONE source/stance table, a person's words checked, read on the factor's range by the door's plan) and the
 * same who-rule: Olumi's setting is Olumi's estimate; a person's is of unestablished origin (R3). No host reading of words.
 * Harness: `ai-core-add-to-model.route.test.ts` (the real route, SDK, card carrier, path-B adapters and the REAL door; the UI's
 * real press: source `chip` + the issued envelope, no fields); a scripted AI (0 provider calls). SYNTHETIC wording.
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
const SAID = 'Another option: hire two temps, so three people on shift.';
const OPTION = { op: 'add_option', decision_id: 'decision', label: 'Hire two temps',
  settings: [{ factor_id: 'staff', value: 3, unit: 'people', stance: 'stated_current', source: { origin: 'user', quote: 'three people on shift', named_source: null } }] };
const PREPARE = (over: Json = {}, setting: Json = {}) => ({ public_label: 'Add the option "Hire two temps" (3 people on shift)', basis: 'The user named a new option.',
  ops: [{ ...OPTION, ...over, settings: [{ ...OPTION.settings[0], ...setting }] }] });
const PREPARED_WORDS = 'I have prepared the new option; press its card to add it.';
const SAVED_WORDS = 'Added: the option "Hire two temps".';

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
  const nodes = g.nodes.map((n) => n.id === 'staff' ? { ...n, observed_state: { value: 0.1, raw_value: 1, unit: 'people', cap: 10, source: 'brief_extraction', extractionType: 'explicit' } } : n);
  return projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes }), options: [] as Json[] }) as Json;
}

/** A read that no longer shows the option as approved once it is saved (another writer renamed it), for the readback row only. */
let renamedAfterSave = false;
const shown = (): Json => !renamedAfterSave ? persisted
  : { ...persisted, nodes: (persisted.nodes as Json[]).map((n) => n.label === 'Hire two temps' ? { ...n, label: 'Hire two temps (renamed)' } : n) };
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

describe('PATH-B gap 2: a new option the person names is prepared on a card in that turn and committed ONCE by the press', () => {
  let app: FastifyInstance;
  let calls: Json[] = [];
  let outputs: Json[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: 'conv_add_option', object: 'conversation' });
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return json(responsesBody(outputs.shift() ?? [{ type: 'message', text: 'Done.' }]));
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: shown(), graph_hash: hashOf(persisted),
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
    SCENARIO = randomUUID(); renamedAfterSave = false; persisted = stored(); doorRows.clear(); turnRows.clear(); conversationIds.clear(); pausedRun = null; calls = []; outputs = []; preparedId = '';
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const commits = () => [...doorRows.values()].filter((r) => r.receipt !== undefined);
  let issuedGraphHash = '';
  const outputOf = (callId: string): Json | undefined => {
    const item = calls.flatMap((b) => (Array.isArray(b.input) ? b.input : [])).find((i: Json) => i.type === 'function_call_output' && i.call_id === callId);
    return item === undefined ? undefined : JSON.parse(String(item.output)) as Json;
  };
  /** Turn 1: the person names the new factor and its figure; the AI prepares it (propose_change, add_to_model) and says so. */
  const prepared = async (args: Json = PREPARE()): Promise<{ j: Json; card: Json; rec: Json; out: Json | undefined }> => {
    calls = []; preparedId = '';
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args }], [{ type: 'message', text: PREPARED_WORDS }]];
    const r = await post({ turn_id: randomUUID(), message: SAID, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    issuedGraphHash = String(j._proposal_fields?.graph_hash ?? '');
    preparedId = String((j._agent.tool_calls as Json[]).find((c) => c.name === 'propose_change' && c.ok)?.proposal_id ?? '');
    const card = (j.suggested_actions as Json[]).find((c) => c.id === `agent-approve-proposal:${preparedId}`);
    const rec = (j._proposal_fields?.proposals as Json[] | undefined)?.find((f) => f.proposal_id === preparedId);
    return { j, card: card!, rec: rec!, out: outputOf('prop_call') };
  };
  /** The UI's ordinary press (`SuggestedChips.tsx`, served bytes in browser K5 21:40Z): source `chip`, the card's own id and words,
   * and the issued record as `proposal_edits` with NO fields. */
  const pressed = (card: Json, rec: Json) => {
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_call' }], [{ type: 'message', text: SAVED_WORDS }]];
    return post({ turn_id: randomUUID(), message: card.message, source: 'chip', chip: { id: card.id },
      proposal_edits: { proposal_id: rec.proposal_id, revision: rec.revision, digest: rec.digest, graph_hash: issuedGraphHash, fields: [] } });
  };

  const optionNodes = (): Json[] => (persisted.nodes as Json[]).filter((n) => n.label === 'Hire two temps');

  it('⭐ RED→GREEN: the new option is prepared on a card in THAT turn; nothing is committed', async () => {
    const { j, card, rec, out } = await prepared();
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.stringMatching(/^prop_/) } });
    expect(card, JSON.stringify(j.suggested_actions)).toBeDefined();
    expect(rec, JSON.stringify(j._proposal_fields)).toBeDefined();
    expect(commits()).toHaveLength(0);
    expect(optionNodes()).toHaveLength(0);
  });

  it('⭐ RED→GREEN: the UI\'s press adds it ONCE: the option, linked from the decision, setting 3 people on shift, its own receipt', async () => {
    const { card, rec } = await prepared();
    expect(card, 'PRECONDITION: the card').toBeDefined();
    const r = await pressed(card, rec);
    expect(r.statusCode, r.body).toBe(200);
    const applied = outputOf('apply_call');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(commits(), 'ONE commit').toHaveLength(1);
    expect(applied?.data?.receipt?.version_id, 'its own receipt').toBe(commits()[0]!.receipt!.version_id);
    const added = optionNodes();
    expect(added, 'ONE new option').toHaveLength(1);
    const option = added[0]!;
    expect(option.kind).toBe('option');
    expect(option.interventions?.staff, 'the setting, on the factor\'s range, of unestablished origin as a person\'s setting is today (R3)')
      .toMatchObject({ value: 0.3, raw_value: 3, unit: 'people', source: 'cee_hypothesis', user_material_unverified: true });
    expect((persisted.edges as Json[]).some((e) => e.from === 'decision' && e.to === option.id), 'linked from the decision').toBe(true);
    expect((persisted.edges as Json[]).some((e) => e.from === option.id && e.to === 'staff'), 'linked to what it sets').toBe(true);
    expect(applied?.data?.written).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'add_option', id: option.id })]));
  });

  it('⭐ Olumi\'s setting is added as Olumi\'s estimate', async () => {
    const { card, rec } = await prepared(PREPARE({}, { stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } }));
    await pressed(card, rec);
    expect(commits()).toHaveLength(1);
    const cell = optionNodes()[0]?.interventions?.staff;
    expect(cell).toMatchObject({ raw_value: 3, source: 'cee_hypothesis' });
    expect(cell?.user_material_unverified).toBeUndefined();
  });

  it('⛔ a target as a setting is BLOCKED, never relabelled: nothing prepared', async () => {
    const { out } = await prepared(PREPARE({}, { stance: 'target' }));
    expect(out).toMatchObject({ status: 'unavailable', reason: 'blocked_schema', write: 'none' });
    expect(preparedId).toBe('');
  });

  it('⛔ a quote the person never wrote is refused: nothing prepared', async () => {
    const { out } = await prepared(PREPARE({}, { source: { origin: 'user', quote: 'ten people on shift', named_source: null } }));
    expect(out).toMatchObject({ status: 'refused', reason: 'quote_not_in_users_words' });
  });

  it('⛔ the door\'s own rules: not a decision, or the same settings as an existing option, is refused', async () => {
    expect((await prepared(PREPARE({ decision_id: 'goal' }))).out).toMatchObject({ status: 'refused', reason: 'add_option_parent_not_decision' });
    expect((await prepared(PREPARE({}, { value: 2 }))).out).toMatchObject({ status: 'refused', reason: 'add_option_same_levels_as_existing_option' });
    expect(commits()).toHaveLength(0);
  });

  it('⛔ never "saved" without the readback: a saved option the model no longer shows as approved is not claimed', async () => {
    const { card, rec } = await prepared();
    renamedAfterSave = true;
    await pressed(card, rec);
    expect(commits(), 'the door wrote once').toHaveLength(1);
    expect(outputOf('apply_call'), 'not claimed as saved').toMatchObject({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
  });

  it('⛔ CAS kept: the model moved after the card → superseded, nothing added', async () => {
    const { card, rec } = await prepared();
    persisted = { ...persisted, nodes: (persisted.nodes as Json[]).map((n) => n.id === 'staff' ? { ...n, label: 'People on the desk' } : n) };
    await pressed(card, rec);
    expect(outputOf('apply_call')).toMatchObject({ status: 'refused', reason: 'superseded' });
    expect(commits()).toHaveLength(0);
  });
});
