/**
 * SPIKE S3 rows: the model-program turn on the REAL core route (`POST /agent/v1/core-turn`), in process, with in-memory
 * stores in the core-turn route's served shapes (the C2″ harness's), so nothing reaches a database. The provider is stubbed
 * at fetch: the drafting call's answers are canned canonical models of a SYNTHETIC bakery (never a test brief's words), so
 * every row binds the real request the route sends and the real postimage it saves. One row per step, plus the
 * save → readback → cold reopen identity row with its contrast control.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import type { CanonicalModelT, CanonicalQuantityT } from '../../model-program/canonical.js';
import { compile } from '../../model-program/compile.js';
import { project } from '../../model-program/project.js';
import { simulate } from '../../model-program/simulate/simulate.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX } from '../prompt.js';
import { seedOf, SPIKE_DRAWS } from '../evaluate.js';
import { reopenModelProgram } from '../turn.js';

type Json = Record<string, any>;

// ── in-memory stores (the C2″ harness's served shapes) ────────────────────────────────────────────────────────────────
let SCENARIO = '';
let persisted: Json | null = null;
const registered: Json[] = [];
const turnRows = new Map<string, any>();
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
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
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  releaseTurnClaim: vi.fn(async (_sid: string, id: string, hash: string) => { if (turnRows.get(id)?.request_hash === hash) turnRows.delete(id); }),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const key = String(write.turn_id); const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date(Date.now() + turnRows.size).toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row); return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));

function graphRead(): Json {
  if (persisted === null) return { scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null, content_hash: null };
  return { scenario_id: SCENARIO, graph: persisted, graph_present: true, brief_text: null, graph_hash: hashOf(persisted),
    graph_identity_hash: computeGraphIdentityHash(persisted as never), content_hash: computeGraphIdentityHash(persisted as never)!.value,
    analysis_ready: { status: 'blocked', may_run: false, options: [], blockers: [] },
    analysis_state: { run_state: { kind: 'never_run' }, usable_for_prose: false, usable_for_chips: false, usable_for_followup: false },
    current_read: { run_state: { kind: 'never_run' }, computed_against_hash: null, run_id: null } };
}

// ── the provider, stubbed at fetch: canned Responses streams, every request body kept ────────────────────────────────
const sent: Json[] = [];
let replies: string[] = [];
const sse = (text: string): Response => {
  const response = { id: `resp_${sent.length}`, object: 'response', status: 'completed', model: 'gpt-6.1-sol',
    output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 500, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1500 } };
  const body = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', sequence_number: 1, response })}\n\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

// ── the synthetic bakery ───────────────────────────────────────────────────────────────────────────────────────────────
const BRIEF = 'We bake 300 loaves a week with our one oven and want to reach 380 loaves a week. A second oven adds about 100 loaves a week, or we could keep our one oven. We have £3,000 to spend and don\'t know the oven price yet.';
const at = { party: null, approval: 'proposed' as const, author_id: null };
const q = (id: string, unit: string, f: Partial<CanonicalQuantityT>): CanonicalQuantityT => ({ id, label: id.replace(/_/g, ' '), unit, kind: 'fact', value: null, low: null, high: null,
  range_kind: null, status: 'known', question: null, basis: null, author: 'person', quote: null, ...at, ...f });
function bakery(): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'Should the bakery buy a second oven?', period: 'week',
    quantities: [
      q('base_sales', 'loaf/week', { value: 300, quote: 'We bake 300 loaves a week' }),
      q('ovens_added', 'oven', { value: 0, quote: 'our one oven' }),
      q('one_oven', 'oven', { value: 1, quote: 'A second oven' }),
      q('extra_per_oven', 'loaf/week/oven', { kind: 'coefficient', value: 100, quote: 'adds about 100 loaves a week' }),
      q('sell_through', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.7, low: 0.5, high: 0.9, range_kind: 'plausible', basis: 'New capacity sells only as far as demand grows.' }),
      q('sold_per_oven', 'loaf/week/oven', { kind: 'coefficient', status: 'derived', author: 'olumi' }),
      q('sales', 'loaf/week', { status: 'derived', author: 'olumi' }),
      q('sales_target', 'loaf/week', { value: 380, quote: 'reach 380 loaves a week' }),
      q('budget', 'GBP', { value: 3000, quote: 'We have £3,000 to spend' }),
      q('oven_price', 'GBP/oven', { status: 'asked', question: 'What would the second oven cost?' }),
      q('spend', 'GBP', { status: 'derived', author: 'olumi' }),
    ],
    relations: [
      { form: 'definition', id: 'sold_rel', defines: 'sold_per_oven', op: 'product', parts: [{ id: 'extra_per_oven', power: 1 }, { id: 'sell_through', power: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'effect', id: 'sales_rel', defines: 'sales', base: 'base_sales', terms: [{ driver: 'ovens_added', coefficient: 'sold_per_oven', author: 'person', quote: 'A second oven adds about 100 loaves a week', ...at }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'spend_rel', defines: 'spend', op: 'product', parts: [{ id: 'oven_price', power: 1 }, { id: 'ovens_added', power: 1 }], author: 'olumi', quote: null, ...at },
    ],
    goals: [{ id: 'more_loaves', label: 'Reach 380 loaves a week', measure: { quantity: 'sales', per: null, cmp: '>=', target: 'sales_target', frame: 'level', reference: null, aggregation: 'end',
      window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'want to reach 380 loaves a week', ...at }],
    limits: [{ id: 'within_budget', label: 'Within the £3,000', measure: { quantity: 'spend', per: null, cmp: '<=', bound: 'budget', aggregation: 'end', window: null },
      question: null, author: 'person', quote: 'We have £3,000 to spend', ...at }],
    preferences: [],
    options: [
      { id: 'second_oven', label: 'A second oven', sets: [{ quantity: 'ovens_added', to: 'one_oven', value: null, low: null, high: null, range_kind: null, question: null, from_period: 0, author: 'person', quote: 'A second oven' }],
        status: 'live', developed_from: null, author: 'person', quote: 'A second oven', ...at },
      { id: 'keep_one', label: 'Keep our one oven', sets: [], status: 'live', developed_from: null, author: 'person', quote: 'keep our one oven', ...at },
    ],
    risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
  };
}
/** The same bakery with one draft defect the compiler names: Olumi's estimate given without its range. */
function bakeryWithDefect(): CanonicalModelT {
  const m = bakery();
  m.quantities = m.quantities.map((x) => (x.id === 'sell_through' ? { ...x, low: null, high: null, range_kind: null } : x));
  return m;
}

let app: FastifyInstance;
const turn = (payload: Json, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/agent/v1/core-turn', headers, payload: { kind: 'message', scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', turn_id: randomUUID(), source: 'composer', ...payload } });
const ARM = { 'x-olumi-draft-arm': 'canonical' };

describe('spike S3: the model-program turn on the real core route', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: any) => {
      const u = String((url as any)?.href ?? (url as any)?.url ?? url);
      if (!u.startsWith('https://api.openai.com/') || !u.endsWith('/responses')) return new Response(JSON.stringify({ error: 'blocked by the spike test' }), { status: 599 });
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      const next = replies.shift();
      if (next === undefined) throw new Error('the test gave no reply for this call');
      return sse(next);
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    process.env.OPENAI_API_KEY ||= 'sk-test-not-sent';
    const route = await import('../../../routes/core-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => graphRead());
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const b = req.body as Json;
      const current = persisted === null ? null : computeGraphIdentityHash(persisted as never)!.value;
      if ((b.expected_graph_identity_hash ?? null) !== current) return reply.code(409).send({ details: { code: 'GRAPH_STALE' } });
      // Stored as JSON, as a database column gives it back: never the caller's object.
      persisted = JSON.parse(JSON.stringify(b.graph)) as Json; registered.push(b);
      const identity = computeGraphIdentityHash(persisted as never)!;
      return { registered: true, graph_identity_hash: identity, graph_hash: hashOf(persisted),
        model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
          creation_kind: registered.length === 1 ? 'initial' : 'committed_mutation', graph_identity_hash: identity.value,
          analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(persisted as never) } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    app.post('/orchestrate/v2/turn', async (_req, reply) => reply.code(500).send({ error: 'no Run in this harness' }));
    await app.register(route.coreTurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); });
  beforeEach(() => { SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); conversationIds.clear(); pausedRun = null; sent.length = 0; replies = []; });

  it('step 1, drafter: the first turn sends ONE strict canonical-schema call at gpt-6.1-sol, effort medium, with the fixed prompt', async () => {
    replies = [JSON.stringify(bakery())];
    const r = await turn({ message: BRIEF }, ARM);
    expect(r.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.instructions).toBe(DRAFTING_INSTRUCTIONS);
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'canonical_model', strict: true });
    expect(stableStringify(body.text.format.schema)).toBe(stableStringify(CANONICAL_JSON_SCHEMA));
    expect(body.input).toEqual([{ role: 'user', content: BRIEF }]);
    expect(body.tools ?? []).toEqual([]);
    // The saved model is the AI's own draft, unedited.
    expect(persisted!.living_model.canonical).toEqual(bakery());
    expect(r.json().model_program.draft.attempts.map((a: Json) => a.errors.length)).toEqual([0]);
  });

  it('contrast: without the canonical arm the same first turn never makes the canonical call', async () => {
    replies = ['{}'];
    await turn({ message: BRIEF }).catch(() => undefined);
    expect(sent.some((b) => b.text?.format?.name === 'canonical_model')).toBe(false);
  });

  it('step 2, compile + repair: the compiler\'s own sentence goes back to the SAME conversation; at most 2 repairs', async () => {
    const bad = JSON.stringify(bakeryWithDefect());
    replies = [bad, JSON.stringify(bakery())];
    const r = await turn({ message: BRIEF }, ARM);
    expect(sent).toHaveLength(2);
    const errors = compile(bakeryWithDefect(), { sourceText: BRIEF }).errors;
    expect(errors.map((e) => e.code)).toEqual(['olumi_no_range']);
    expect(sent[1]!.input).toEqual([{ role: 'user', content: BRIEF }, { role: 'assistant', content: bad },
      { role: 'user', content: `${REPAIR_PREFIX}\n- ${errors[0]!.message}` }]);
    expect(sent[1]!.instructions).toBe(sent[0]!.instructions);
    expect(r.json().model_program.draft.attempts.map((a: Json) => a.errors.length)).toEqual([1, 0]);
    expect(persisted!.living_model.canonical).toEqual(bakery());

    // Three defective drafts: three calls (two repairs), and nothing is saved.
    beforeEachReset();
    replies = [bad, bad, bad];
    const r3 = await turn({ message: BRIEF }, ARM);
    expect(sent).toHaveLength(3);
    expect(persisted).toBeNull();
    expect(r3.json().model_program.saved).toBe(false);
    expect(r3.json()._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'does_not_compile' }]);
  });

  it('step 3, simulate + present: the view is the simulator\'s result on the scenario\'s seed; the display graph is S1\'s projection', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF }, ARM)).json();
    const x = compile(bakery(), { sourceText: BRIEF }).executable!;
    const sim = simulate(x, { seed: seedOf(SCENARIO), draws: SPIKE_DRAWS });
    expect(r.model_program.seed).toBe(seedOf(SCENARIO));
    expect(r.model_program.chances).toEqual(JSON.parse(JSON.stringify(sim.options.map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint,
      within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))));
    const oven = sim.options.find((o) => o.option_id === 'second_oven')!.per_goal[0] as { chance: number };
    expect(oven.chance).toBeGreaterThan(0.12); // 1 − Φ(0.1 / 0.1155) ≈ 0.19 on the ruled range law
    expect(oven.chance).toBeLessThan(0.27);
    expect((sim.options.find((o) => o.option_id === 'keep_one')!.per_goal[0] as { chance: number }).chance).toBe(0);
    const view = r.canonical_analysis_view;
    expect(view.schema).toBe('canonical_analysis_view.v1');
    expect(view.options.map((o: Json) => [o.option_id, o.cell.kind])).toEqual([['second_oven', 'figure'], ['keep_one', 'figure']]);
    // The budget limit waits on the oven price: it is never folded silently into the chance.
    expect(r.model_program.compile.within_limits.status).toBe('asks');
    expect(r.model_program.asks.map((a: Json) => a.quantity_id)).toEqual(['oven_price']);
    expect(view.options.every((o: Json) => o.cell.face.includes('Not yet checked: ‘Within the £3,000’'))).toBe(true);
    const { living_model: _lm, ...display } = persisted!;
    expect(display).toEqual(JSON.parse(JSON.stringify(project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph)));
  });

  it('step 4, save → readback → cold reopen: the canonical model comes back byte-identical, and the reopen reproduces the view', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF }, ARM)).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.model_program.write).toBe('saved');
    expect(r.model_program.readback).toMatchObject({ read: true, version: 'canonical.v1', seed_identical: true, canonical_bytes_identical: true, canonical_stable_identical: true });
    expect(JSON.stringify(persisted!.living_model.canonical)).toBe(JSON.stringify(r.model_program.canonical));
    // Cold: the stored JSON alone, in a fresh module instance.
    vi.resetModules();
    const fresh = await import('../turn.js');
    const cold = fresh.reopenModelProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect(stableStringify(cold.view)).toBe(stableStringify(r.canonical_analysis_view));
    // Contrast: the same model on another seed does not reproduce it, so the identity above is the seed's, not luck.
    const other = JSON.parse(JSON.stringify(persisted));
    other.living_model.seed += 1;
    expect(stableStringify(reopenModelProgram(other)!.sim!.options)).not.toBe(stableStringify(cold.sim!.options));
  });

  it('step 5, an answer fills exactly ONE quantity, as the person\'s words, with no model call; then recompile and re-simulate', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF }, ARM);
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    sent.length = 0;
    const words = 'The oven would cost about £2,500.';
    // The message is the turn's text; the quote is the answer's own words (an ask card's input), never the message.
    const r = await turn({ message: 'Here is the oven price.', model_program_answers: [{ quantity_id: 'oven_price', value: 2500, words }] });
    expect(r.statusCode).toBe(200);
    expect(sent).toHaveLength(0);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    const filled = after.quantities.find((x) => x.id === 'oven_price')!;
    expect(filled).toMatchObject({ status: 'known', value: 2500, low: null, high: null, author: 'person', quote: words, approval: 'approved', question: null });
    expect(after.quantities.filter((x) => x.id !== 'oven_price')).toEqual(before.quantities.filter((x) => x.id !== 'oven_price'));
    expect({ ...after, quantities: [], history: [] }).toEqual({ ...before, quantities: [], history: [] });
    expect(after.history).toEqual([{ id: 'oven_price', change: 'superseded', old: JSON.stringify(before.quantities.find((x) => x.id === 'oven_price')), quote: words, author_id: null }]);
    expect(persisted!.living_model.person_words).toEqual([BRIEF, words]);
    const j = r.json();
    expect(j.model_program.fills).toEqual([{ quantity_id: 'oven_price', words, value: 2500, low: null, high: null, applied: true }]);
    expect(j.model_program.compile.within_limits.status).toBe('calculable');
    expect(j.model_program.compile.unverified).toEqual([]);
    expect(j.model_program.asks).toEqual([]);
    const x = compile(after, { sourceText: `${BRIEF}\n${words}` }).executable!;
    expect(x.limits.map((l) => l.id)).toEqual(['within_budget']);
    expect(j.model_program.chances).toEqual(JSON.parse(JSON.stringify(simulate(x, { seed: seedOf(SCENARIO), draws: SPIKE_DRAWS }).options
      .map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))));
    expect(j.receipts.map((x2: Json) => x2.authorised_by)).toEqual(['person']);
    // Contrast: an answer naming no quantity in the model changes nothing and saves nothing.
    const saves = registered.length;
    const bad = await turn({ message: 'about 3', model_program_answers: [{ quantity_id: 'no_such_figure', value: 3, words: 'about 3' }] });
    expect(bad.json().model_program.fills[0]).toMatchObject({ applied: false });
    expect(registered.length).toBe(saves);
  });
});

function beforeEachReset() { SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); conversationIds.clear(); pausedRun = null; sent.length = 0; replies = []; }
