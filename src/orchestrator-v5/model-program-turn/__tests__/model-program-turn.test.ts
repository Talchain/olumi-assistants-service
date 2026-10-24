/**
 * Model-program rows (alpha): the model-program turn on the REAL core route (`POST /agent/v1/core-turn`), in process, with in-memory
 * stores in the core-turn route's served shapes (the C2″ harness's), so nothing reaches a database. The provider is stubbed
 * at fetch: the drafting call's answers are canned canonical models of a SYNTHETIC bakery (never a test brief's words), so
 * every row binds the real request the route sends and the real postimage it saves. One row per step, plus the
 * save → readback → cold reopen identity row with its contrast control.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod-v4';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { APPROXIMATE_FIGURE, CanonicalModel, withDeclaredTiming, type CanonicalModelT, type CanonicalQuantityT } from '../../model-program/canonical.js';
import { compile, isStructuralConstant, normalise } from '../../model-program/compile.js';
import { CORE_ALIGNED_INSTRUCTIONS } from '../../core-route/instructions.js';
import { project } from '../../model-program/project.js';
import { simulate } from '../../model-program/simulate/simulate.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX, UPDATE_PREFIX } from '../prompt.js';
import { evaluateCanonical, seedOf, RUN_DRAWS } from '../evaluate.js';
import { programReadOf, reopenProgram, savedProgramOf, sourceTextOf } from '../program-store.js';
import { applyCanvasFigure, applyProgramChange, ProgramChangeParams, proposeProgramChange, readProgramContext, runProgram } from '../program-tools.js';
import { GROUPS, readingOf, validatePostimage } from '../postimage.js';
import { proposalPendingAction } from '../../agent-lane/durable-proposal.js';
import { agentProposalOf, proposalFieldsWire, proposalRecord } from '../../agent-lane/proposal-object/record.js';
import { ProposalChangeSchema, ProposalStore, type ProposalChange } from '../../agent-lane/proposal.js';
import { withNewRun } from '../program-save.js';
import { projectCorePostimageForPersistence } from '../../persisted-graph-projection.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { ENGINE_VERSIONS, revisionDigest, RUN_AGAIN_AFTER_UPDATE, RUN_AGAIN_FOR_CHANCE } from '../run-receipt.js';
import { at, bakery, bakeryWithDefect, BRIEF, club, CLUB_BRIEF, q } from './bakery.fixture.js';

/** A draft captured before a field existed, read in today's format (the saved-model reader's own mapping). */
const savedDraft = (file: string) => { const s = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as { brief: string; canonical: unknown }; return { brief: s.brief, canonical: withDeclaredTiming(s.canonical) as CanonicalModelT }; };

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

let app: FastifyInstance;
/** The route's internal dispatch, into this harness's stores (for the agent's tools, called as the SDK turn calls them). */
const dispatch = async (path: string, body: unknown) => { const r = await app.inject({ method: 'POST', url: path, payload: body as never }); return { status: r.statusCode, json: r.json() as Record<string, unknown> }; };
const turn = (payload: Json, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/agent/v1/core-turn', headers, payload: { kind: 'message', scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', turn_id: randomUUID(), source: 'composer', ...payload } });

/** The drafter's WHOLE updated model for a change: the saved one with `edit` applied (what a faithful update returns). */
const savedWith = (edit: (m: CanonicalModelT) => void): string => { const m = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT; edit(m); return JSON.stringify(m); };
const setQ = (m: CanonicalModelT, id: string, f: Partial<CanonicalQuantityT>) => { m.quantities = m.quantities.map((x) => (x.id === id ? { ...x, ...f } : x)); };
const LOST_BASIS = 'Nobody has said how much baking time a new oven loses while the staff learn it.';
/** Issue 40: the bakery with Olumi's link of unknown size, stated to lower sales, and any more of Olumi's links on the oven. */
const withOlumiLinks = (m: CanonicalModelT, ...more: CanonicalQuantityT[]): CanonicalModelT => {
  const sizes = [q('lost_bake_time', 'loaf/week/oven', { kind: 'coefficient', status: 'unknown', author: 'olumi', direction: 'lowers', basis: LOST_BASIS }), ...more];
  m.quantities.push(...sizes);
  m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, terms: [...r.terms, ...sizes.map((x) => ({ driver: 'ovens_added', coefficient: x.id, author: 'olumi' as const, quote: null, ...at }))] } : r));
  return m;
};

describe('the model-program turn on the real core route', () => {
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
    const r = await turn({ message: BRIEF });
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

  it('no header, no flag: a scenario with no saved model is drafted by the canonical drafter and nothing else', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    expect(sent.map((b) => b.text?.format?.name ?? b.model)).toEqual(['canonical_model']);
    expect(persisted!.living_model.model_program).toBe('v1');
  });

  it('step 2, compile + repair: the compiler\'s own sentence goes back to the SAME conversation; at most 2 repairs', async () => {
    const bad = JSON.stringify(bakeryWithDefect());
    replies = [bad, JSON.stringify(bakery())];
    const r = await turn({ message: BRIEF });
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
    const r3 = await turn({ message: BRIEF });
    expect(sent).toHaveLength(3);
    expect(persisted).toBeNull();
    expect(r3.json().model_program.saved).toBe(false);
    expect(r3.json()._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'does_not_compile' }]);
  });

  it('step 3, simulate + present: the view is the simulator\'s result on the scenario\'s seed; the display graph is S1\'s projection', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const x = compile(bakery(), { sourceText: BRIEF }).executable!;
    const sim = simulate(x, { seed: seedOf(SCENARIO), draws: RUN_DRAWS });
    const stored = persisted!.living_model.runs[0].result as Json;
    expect(persisted!.living_model.seed).toBe(seedOf(SCENARIO));
    expect(stored.chances).toEqual(JSON.parse(JSON.stringify(sim.options.map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint,
      within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))));
    const oven = sim.options.find((o) => o.option_id === 'second_oven')!.per_goal[0] as { chance: number };
    expect(oven.chance).toBeGreaterThan(0.12); // 1 − Φ(0.1 / 0.1155) ≈ 0.19 on the ruled range law
    expect(oven.chance).toBeLessThan(0.27);
    expect((sim.options.find((o) => o.option_id === 'keep_one')!.per_goal[0] as { chance: number }).chance).toBe(0);
    const view = r.canonical_analysis_view;
    expect(view.schema).toBe('canonical_analysis_view.v1');
    expect(view.options.map((o: Json) => [o.option_id, o.cell.kind])).toEqual([['second_oven', 'figure'], ['keep_one', 'figure']]);
    // The budget limit waits on the oven price: it is never folded silently into the chance.
    expect(stored.compile.within_limits.status).toBe('asks');
    expect(r.model_program.blockers.map((b: Json) => [b.id, b.code])).toEqual([['oven_price', 'asked']]);
    expect(view.options.every((o: Json) => o.cell.face.includes('Not yet checked: ‘Within the £3,000’'))).toBe(true);
    const { living_model: _lm, ...display } = persisted!;
    expect(display).toEqual(JSON.parse(JSON.stringify(project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph)));
  });

  it('step 4, save → readback → cold reopen: the canonical model and its stored Run come back byte-identical; the reopen SHOWS that Run', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.model_program.write).toBe('saved');
    expect(r.model_program.readback).toMatchObject({ read: true, version: 'canonical.v1', seed_identical: true, runs_identical: true, canonical_identical: true });
    expect(persisted!.living_model.canonical).toEqual(bakery());
    const runs = persisted!.living_model.runs as Json[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.run_id).toBe(r.model_program.run.run_id);
    expect(runs[0]!.receipt).toEqual({ revision_digest: revisionDigest(bakery(), [BRIEF]), versions: { ...ENGINE_VERSIONS }, seed: seedOf(SCENARIO), draws: RUN_DRAWS });
    expect(stableStringify(runs[0]!.result.canonical_analysis_view)).toBe(stableStringify(r.canonical_analysis_view));
    // Cold: the stored JSON alone, in a fresh module instance, shows the STORED Run: current, today's engine.
    vi.resetModules();
    const fresh = await import('../program-store.js');
    const cold = fresh.reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect(stableStringify(cold.view)).toBe(stableStringify(r.canonical_analysis_view));
    expect([cold.run!.run_id, cold.current, cold.engine_current]).toEqual([r.model_program.run.run_id, true, true]);
    // Contrast: a NEW evaluation on another seed gives other numbers, so what the reopen shows is the stored Run, not a recompute.
    const other = fresh.savedProgramOf(JSON.parse(JSON.stringify(persisted)))!;
    const recomputed = withNewRun({ ...other, seed: other.seed + 1 }).evaluation;
    expect(stableStringify(recomputed.view)).not.toBe(stableStringify(cold.view));
  });

  it('step 4b, an engine-version bump: the reopen still shows the ORIGINAL stored result, said as from before an update (S4: the person\'s model did not move)', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const bumped = { ...ENGINE_VERSIONS, engine: `${ENGINE_VERSIONS.engine}-bumped` };
    const cold = reopenProgram(JSON.parse(JSON.stringify(persisted)), bumped)!;
    const { staleness, face_when_stale, ...result } = cold.view as Json;
    const { staleness: was, ...stored } = r.canonical_analysis_view as Json;
    expect(stableStringify(result)).toBe(stableStringify(stored));
    expect([was.stale, staleness.stale, staleness.reason, face_when_stale]).toEqual([false, true, 'engine_or_format_updated', RUN_AGAIN_AFTER_UPDATE]);
    expect(RUN_AGAIN_AFTER_UPDATE).toBe('This result is from before an update. Run again to see the chance.');
    expect([cold.run!.run_id, cold.current, cold.engine_current]).toEqual([r.model_program.run.run_id, true, false]);
    expect(cold.run!.receipt.versions).toEqual({ ...ENGINE_VERSIONS });
    // What it shows is the stored bytes: a marker written into the stored Run is what comes back (a recompute would lose it).
    const marked = JSON.parse(JSON.stringify(persisted));
    marked.living_model.runs[0].result.canonical_analysis_view.options[0].cell.display = 'STORED-RUN-MARKER';
    expect((reopenProgram(marked, bumped)!.view as Json).options[0].cell.display).toBe('STORED-RUN-MARKER');
  });

  it('step 4c, the core postimage persistence projection the register applies keeps the model program byte for byte', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const postimage = registered[0]!.graph as Json;
    const stored = projectCorePostimageForPersistence(JSON.parse(JSON.stringify(postimage))) as Json;
    expect(JSON.stringify(stored.living_model)).toBe(JSON.stringify(postimage.living_model));
    expect(savedProgramOf(stored)!.runs).toHaveLength(1);
  });

  // ── STEP 2, "Check what I understood" (DL 24 Oct; the UI half is DGAI #2960, 128bd2db) ──────────────────────────────────
  const hostFieldsOf = (x: unknown) => new Set(JSON.stringify(x).match(/"(approval|author_id)":("[^"]*"|null)/g));
  const withoutHostFields = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/"(approval|author_id)":("[^"]*"|null)/g, '"$1":"host"'));

  it('step 2 "Check what I understood" (1): a first draft is saved as Olumi\'s reading, every record proposed and approved by no one, whatever the drafter wrote; who authored it and in whose words are untouched', async () => {
    const m = bakery();
    // The drafter claims approvals it cannot give: on a goal, a figure, a relation and a link inside it.
    m.goals = m.goals.map((g) => ({ ...g, approval: 'approved' as const, author_id: 'someone-else' }));
    m.quantities = m.quantities.map((x) => (x.id === 'base_sales' ? { ...x, approval: 'approved' as const, author_id: 'someone-else' } : x));
    m.relations = m.relations.map((r) => (r.form === 'effect'
      ? { ...r, approval: 'approved' as const, terms: r.terms.map((x) => ({ ...x, approval: 'approved' as const, author_id: 'someone-else' })) } : r));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(hostFieldsOf(saved)).toEqual(new Set(['"approval":"proposed"', '"author_id":null']));
    // Positive control: the probe sees every record's host fields (the bakery's 18 records and its one link).
    expect(JSON.stringify(saved).match(/"approval":/g)).toHaveLength(19);
    // Contrast: everything else, who authored each item and in whose words included, is the drafter's, untouched.
    expect(withoutHostFields(saved)).toEqual(withoutHostFields(m));
  });

  it('verbatim (DL 24 Oct, 6 refused reading cards in the combined measure): an empty unknown slot of theirs states nothing, like an asked one, so the reading card issues; a known figure in words not theirs is still refused; a quote differing only in case or a curly quote is theirs, as compile reads it', async () => {
    // The measured class: their figure with no figure, no question and no words, not known yet.
    const m = bakery();
    m.quantities.push(q('other_costs', 'GBP', { status: 'unknown', basis: 'Nobody has said what else the oven costs to run.', quote: null }));
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].reading).toBe(true);
    expect(r.cards[0].changes.find((c: Json) => c.id === 'other_costs')).toMatchObject({ action: 'add', author: 'person' });
    const read = (edit: (d: CanonicalModelT) => void) => { const d = bakery(); edit(d); return readingOf(d, { words: [BRIEF], approver: null }); };
    // Still refused: a KNOWN figure of theirs in words they did not write, one with no words, and an unknown slot holding a figure.
    expect(read((d) => setQ(d, 'base_sales', { quote: 'We bake about 300 loaves' }))).toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['base_sales'] });
    expect(read((d) => setQ(d, 'base_sales', { quote: null }))).toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['base_sales'] });
    expect(read((d) => { d.quantities.push(q('other_costs', 'GBP', { status: 'unknown', value: 50, basis: 'Synthetic.', quote: null })); }))
      .toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['other_costs'] });
    // One form with compile: a quote differing only in case, or in a curly quote for their straight one, is theirs, on the card
    // as in compile.
    const folded = bakery();
    setQ(folded, 'base_sales', { quote: 'WE BAKE 300 LOAVES A WEEK' });
    setQ(folded, 'budget', { quote: 'We have £3,000 to spend and don’t know' });
    expect(compile(folded, { sourceText: BRIEF }).unverified).toEqual([]);
    expect(readingOf(folded, { words: [BRIEF], approver: null }).ok).toBe(true);
    expect(read((d) => setQ(d, 'base_sales', { quote: 'We bake 300 loaves a week’' })).ok).toBe(false); // contrast: an extra mark is not theirs
  });

  it('DL 24 Oct (#3728): on the reading card a pure-number unit reads plainly ("1/oven" is "per oven"); a real unit is unchanged', () => {
    const d = bakery();
    setQ(d, 'sell_through', { unit: '1/oven' });
    const v = readingOf(d, { words: [BRIEF], approver: null }) as Json;
    expect(v.ok).toBe(true);
    const after = (id: string): string => v.changes.find((c: Json) => c.id === id).after;
    expect(after('sell_through')).toContain('from 0.5 to 0.9 per oven, most likely 0.7');
    expect(after('sell_through')).not.toContain('1/oven');
    expect(after('base_sales')).toContain('300 loaf/week');
    expect(after('budget')).toContain('3,000 GBP');
  });

  it('issue 40: a first draft with an Olumi link of unknown size and a stated direction shows its reading card, the direction said as an arrow and words on what it moves', async () => {
    const m = withOlumiLinks(bakery());
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].reading).toBe(true);
    expect(r.cards[0].changes.find((c: Json) => c.id === 'lost_bake_time')).toMatchObject({ action: 'add', author: 'olumi',
      after: `no figure yet (in loaf/week/oven), ↓ lowers sales, a rate, not known yet, based on "${LOST_BASIS}"` });
    // Contrast: the same link stated as raising reads so; with no direction, nothing about one is said.
    const said = (d: CanonicalQuantityT['direction']) => { const x = JSON.parse(JSON.stringify(m)) as CanonicalModelT; setQ(x, 'lost_bake_time', { direction: d });
      const v = readingOf(x, { words: [BRIEF], approver: null }); return v.ok ? v.changes.find((c) => c.id === 'lost_bake_time')!.after : v.code; };
    expect(said('raises')).toBe(`no figure yet (in loaf/week/oven), ↑ raises sales, a rate, not known yet, based on "${LOST_BASIS}"`);
    expect(said(null)).toBe(`no figure yet (in loaf/week/oven), a rate, not known yet, based on "${LOST_BASIS}"`);
  });

  it('issue 40 (Codex #3742): a direction on a per-unit rate written as a two-part product (one size times one driver) is kept and worded, unknown or across zero, as on an effect\'s link; times another size it is no link, and its direction is cleared', () => {
    const BASIS = 'Nobody has said how many loaves a new oven loses.';
    /** The draft path (read as `normalise` reads it, then the reading card): the rate's direction kept, and its card words. */
    const rated = (f: Partial<CanonicalQuantityT>, driver = 'ovens_added') => {
      const m = bakery();
      m.quantities.push(q('loss_per_oven', 'loaf/week/oven', { kind: 'coefficient', author: 'olumi', ...f }), q('extra_loss', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
      m.relations.push({ form: 'definition', id: 'loss_rel', defines: 'extra_loss', op: 'product', parts: [{ id: driver, power: 1 }, { id: 'loss_per_oven', power: 1 }], author: 'olumi', quote: null, ...at });
      const read = normalise(m);
      const v = readingOf(read, { words: [BRIEF], approver: null });
      return { direction: read.quantities.find((x) => x.id === 'loss_per_oven')!.direction, after: v.ok ? v.changes.find((c) => c.id === 'loss_per_oven')!.after : v.code };
    };
    expect(rated({ status: 'unknown', basis: BASIS, direction: 'lowers' }))
      .toEqual({ direction: 'lowers', after: `no figure yet (in loaf/week/oven), ↓ lowers extra loss, a rate, not known yet, based on "${BASIS}"` });
    expect(rated({ status: 'estimated', low: -20, high: 10, range_kind: 'plausible', basis: BASIS, direction: 'raises' }))
      .toEqual({ direction: 'raises', after: `from -20 to 10 loaf/week/oven (a plausible range), ↑ raises extra loss, a rate, an estimate, based on "${BASIS}"` });
    // Contrast: times another size ("sell through", a coefficient) it is no per-unit rate and no link: cleared, never worded.
    expect(rated({ status: 'unknown', basis: BASIS, direction: 'lowers' }, 'sell_through'))
      .toEqual({ direction: null, after: `no figure yet (in loaf/week/oven), a rate, not known yet, based on "${BASIS}"` });
  });

  it('issue 40: a direction the host clears (on a sized link, or on a figure no link has) never shows as a change nor refuses one: a saved program holding them takes an unrelated update; the AI\'s change to a direction the model uses still shows', async () => {
    const m = withOlumiLinks(bakery(), q('oven_delay', 'loaf/week/oven', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: -10, low: -20, high: -5, range_kind: 'plausible',
      basis: 'A new oven takes a few weeks to bed in.' }));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    // As a program saved before the host cleared them holds them: a direction on a sized link, and one on a figure no link has.
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    setQ(saved, 'oven_delay', { direction: 'raises' });
    setQ(saved, 'oven_price', { direction: 'lowers' });
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We now bake 320 loaves a week, our baker says.';
    const propose = async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        { public_label: 'Base sales', basis: 'their words', request: 'Base sales are now 320 a week.', remove: [] }) as Json;
    };
    const sales = (d: CanonicalModelT) => setQ(d, 'base_sales', { value: 320, quote: 'We now bake 320 loaves a week' });
    const p = await propose(sales);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes).toEqual([{ id: 'base_sales', kind: 'quantity', action: 'change', label: 'base sales', before: '300 loaf/week, in your words "We bake 300 loaves a week"',
      after: '320 loaf/week, in your words "We now bake 320 loaves a week"', author: 'person' }]);
    // Contrast: the AI's own change to a direction the model uses (a linked size with no figure) is on the card.
    const flipped = await propose((d) => { sales(d); setQ(d, 'lost_bake_time', { direction: 'raises' }); });
    expect(flipped.status, JSON.stringify(flipped)).toBe('ok');
    expect(flipped.data.changes.map((c: Json) => c.id)).toEqual(['base_sales', 'lost_bake_time']);
    expect(flipped.data.changes[1]).toMatchObject({ action: 'change', before: 'no figure yet (in loaf/week/oven), ↓ lowers sales', after: 'no figure yet (in loaf/week/oven), ↑ raises sales' });
  });

  it('issue 40: a figure typed on the canvas is theirs: the direction stated for the size it replaces is not kept, and the card shows it go', async () => {
    replies = [JSON.stringify(withOlumiLinks(bakery()))];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    // A saved program's stray direction (on a figure no link has) is the host's to clear, on both sides: never on this card.
    setQ(persisted!.living_model.canonical as CanonicalModelT, 'oven_price', { direction: 'lowers' });
    // A range across zero with no most likely figure: the one figure a stated direction would still decide, so only the edit clears it.
    const r = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'lost_bake_time' }, value: null, low: -5, high: 10, operation_key: randomUUID() });
    expect(r.status, JSON.stringify(r)).toBe('saved');
    expect(r.changes!.map((c) => c.id)).toEqual(['lost_bake_time']);
    const change = r.changes!.find((c) => c.id === 'lost_bake_time')!;
    expect(change.before).toContain('no figure yet (in loaf/week/oven), ↓ lowers sales');
    expect(change.after).toMatch(/^from -5 to 10 loaf\/week\/oven/);
    expect(change.after).not.toMatch(/[↑↓]/u);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'lost_bake_time')).toMatchObject({ low: -5, high: 10, author: 'person', direction: null });
  });

  it('issue 40 (the system): every field of the model and of every canonical record family is said on the card, or is a named exemption; a new field with neither fails here', () => {
    /** The fields the card never compares, each with why. */
    const EXEMPT: Record<string, string> = {
      id: 'the change\'s own id: the card entry is keyed by it (postimage `bare`)',
      approval: 'host-owned, at any depth (postimage HOST_FIELDS)',
      author_id: 'host-owned, at any depth (postimage HOST_FIELDS)',
    };
    const exemptAs = (path: string) => (path === 'id' ? 'id' : ['approval', 'author_id'].find((k) => path === k || path.endsWith(`.${k}`)));
    const defOf = (s: z.ZodType) => s._zod.def as Record<string, any>;
    /** Every field of a schema, as the card's diff names it: records key by key, a list's entries as `*`. */
    const fields = (s: z.ZodType, path = ''): string[] => {
      const def = defOf(s);
      const at = (k: string) => (path === '' ? k : `${path}.${k}`);
      switch (def.type) {
        case 'object': return Object.entries(def.shape as Record<string, z.ZodType>).flatMap(([k, v]) => fields(v, at(k)));
        case 'array': return fields(def.element, at('*'));
        case 'nullable': case 'optional': case 'default': return fields(def.innerType, path);
        case 'union': return [...new Set((def.options as z.ZodType[]).flatMap((o) => fields(o, path)))];
        case 'string': case 'number': case 'boolean': case 'enum': case 'literal': case 'null': return [path];
        default: throw new Error(`the field walker does not know a ${String(def.type)} at ${path || 'the top'}`);
      }
    };
    const shape = CanonicalModel.shape as Record<string, z.ZodType>;
    const families = Object.keys(shape).filter((k) => defOf(shape[k]!).type === 'array' && k !== 'history');
    expect(families.sort()).toEqual(Object.keys(GROUPS).sort());
    const unsaid = (family: string, schema: z.ZodType) => fields(schema).filter((p) => GROUPS[family as keyof typeof GROUPS][p] === undefined && exemptAs(p) === undefined);
    const element = (family: string): z.ZodType => defOf(shape[family]!).element;
    expect(families.flatMap((f) => unsaid(f, element(f)).map((p) => `${f}.${p}`))).toEqual([]);
    // Positive controls: the walker sees nested and listed fields, at magnitude, and every exemption is used.
    const all = families.flatMap((f) => fields(element(f)).map((p) => `${f}.${p}`));
    expect(all.length).toBeGreaterThan(150);
    expect(all).toEqual(expect.arrayContaining(['quantities.direction', 'relations.terms.*.coefficient', 'relations.terms.*.approval', 'goals.measure.window.origin_offset', 'options.sets.*.starts_after_periods', 'claims.concerns.*']));
    expect(Object.keys(EXEMPT).filter((k) => !all.some((p) => exemptAs(p.slice(p.indexOf('.') + 1)) === k))).toEqual([]);
    // Contrast: a field the card has no words for is caught.
    expect(unsaid('quantities', (element('quantities') as z.ZodObject).extend({ new_field: z.string() }))).toEqual(['new_field']);
    // The model's own fields (Codex #3742): each is a record family above, one the card says as its own entry, or exempt.
    const ROOT_SAID = ['question', 'period'];
    const ROOT_EXEMPT: Record<string, string> = { version: 'one fixed value: the format allows no other', history: 'host-owned: appended by the host, never compared' };
    const unsaidRoot = (keys: readonly string[]) => keys.filter((k) => !families.includes(k) && !ROOT_SAID.includes(k) && ROOT_EXEMPT[k] === undefined);
    expect(unsaidRoot(Object.keys(shape))).toEqual([]);
    expect(Object.keys(ROOT_EXEMPT).filter((k) => !(k in shape))).toEqual([]);
    // Each one the card says is said: changed alone, it is the card's one entry.
    for (const [k, v] of [['question', 'Should the bakery buy two more ovens?'], ['period', 'month']] as const) {
      const r = validatePostimage(bakery(), { ...bakery(), [k]: v }, { removals: [], words: [BRIEF], fresh: [] });
      expect(r.ok ? r.changes.map((c) => [c.id, c.after]) : r.code).toEqual([[k, v]]);
    }
    // Contrast: a field of the model's own with neither is caught.
    expect(unsaidRoot(Object.keys(CanonicalModel.extend({ new_unlisted_field: z.string() }).shape))).toEqual(['new_unlisted_field']);
  });

  it('step 2 "Check what I understood" (2–5): after the first save ONE held card reads the draft back, every item an add, goals first and figures last, a left-out item by its why; its approve is "Yes, that’s what I meant"; its model is the draft accepted, with a new Run of the same numbers; it is carried on reload and saved by its approve', async () => {
    const m = bakery();
    m.left_out.push({ id: 'staff_morale', text: 'Staff morale while the second oven beds in', why: 'It has no measure in this model.', question: null, concerns: [], author: 'olumi', quote: null, ...at },
      { id: 'longer_shifts', text: 'Longer shifts for the staff', why: 'It is not measured in this model', question: 'How will staff feel?', concerns: ['more_loaves', 'second_oven'],
        author: 'person', quote: 'Our staff may not like longer shifts', ...at },
      { id: 'delivery_days', text: 'Which days flour is delivered', why: 'Nobody has said how it changes sales', question: null, concerns: [],
        author: 'person', ...at, party: 'Our supplier', quote: 'deliveries only on weekdays' });
    replies = [JSON.stringify(m)];
    const drafted = await turn({ message: `${BRIEF} Our staff may not like longer shifts. Our supplier says deliveries only on weekdays.` });
    expect(drafted.statusCode, drafted.body).toBe(200);
    const r = drafted.json();
    expect(r.model_program.saved).toBe(true);
    expect(sent).toHaveLength(1); // the card is the host's: no further AI call
    expect(registered).toHaveLength(1); // the card saves nothing
    expect(r.cards).toHaveLength(1);
    const card = r.cards[0];
    // (4) CEE's own flag, the literal true; (5) the approve in the person's voice, and every card's "Not now".
    expect(card.reading).toBe(true);
    expect(card.approve_action).toMatchObject({ label: 'Yes, that’s what I meant', message: 'Yes, that’s what I meant.' });
    expect(card.decline_action).toMatchObject({ label: 'Not now', message: 'Not now.' });
    // (2) Every record an add, in the reading order: goals, limits, options, what is left out, relations, then the figures.
    expect(card.changes.map((c: Json) => [c.kind, c.id, c.action, c.before])).toEqual([
      ['goal', 'more_loaves', 'add', null], ['record', 'within_budget', 'add', null], ['option', 'second_oven', 'add', null], ['option', 'keep_one', 'add', null],
      ['left_out', 'staff_morale', 'add', null], ['left_out', 'longer_shifts', 'add', null], ['left_out', 'delivery_days', 'add', null], ['relation', 'sold_rel', 'add', null], ['relation', 'sales_rel', 'add', null], ['relation', 'spend_rel', 'add', null],
      ['quantity', 'base_sales', 'add', null], ['quantity', 'ovens_added', 'add', null], ['quantity', 'one_oven', 'add', null], ['quantity', 'extra_per_oven', 'add', null],
      ['quantity', 'sell_through', 'add', null], ['quantity', 'sold_per_oven', 'add', null], ['quantity', 'sales', 'add', null], ['quantity', 'sales_target', 'add', null],
      ['quantity', 'budget', 'add', null], ['quantity', 'oven_price', 'add', null], ['quantity', 'spend', 'add', null]]);
    // (6) The kinds the card reads, spelled as DGAI's proposalChangeSchema has them at 128bd2db (left_out added there first).
    expect(ProposalChangeSchema.shape.kind.options).toEqual(['quantity', 'relation', 'goal', 'option', 'risk', 'record', 'left_out']);
    // (3) A left-out item: its words are the label, and `after` is its substance in plain words, its why first (the card
    // reads "Leaves out ‘…’ (after)"); every part it has is said, and none it lacks.
    expect(card.changes[5]).toEqual({ id: 'longer_shifts', kind: 'left_out', action: 'add', label: 'Longer shifts for the staff', before: null,
      after: 'It is not measured in this model. Olumi asks: “How will staff feel?”. It concerns Reach 380 loaves a week and A second oven. Your words: “Our staff may not like longer shifts”',
      author: 'person' });
    // Words the person reports from someone else are that someone's, by name, never "Your words".
    expect(card.changes[6]).toEqual({ id: 'delivery_days', kind: 'left_out', action: 'add', label: 'Which days flour is delivered', before: null,
      after: 'Nobody has said how it changes sales. Our supplier’s words: “deliveries only on weekdays”', author: 'person' });
    // Contrast: a left-out item with only its why says only its why, as written.
    expect(card.changes[4]).toEqual({ id: 'staff_morale', kind: 'left_out', action: 'add', label: 'Staff morale while the second oven beds in', before: null,
      after: 'It has no measure in this model.', author: 'olumi' });
    expect(card.changes[0]).toEqual({ id: 'more_loaves', kind: 'goal', action: 'add', label: 'Reach 380 loaves a week', before: null, after: '"sales" at least "sales target" 380 loaf/week, no deadline set, the measure you named, in your words "want to reach 380 loaves a week"', author: 'person' });
    // The held card's model: the saved draft accepted by its approver (a guest here), authorship and words untouched; a new Run.
    const held = agentProposalOf([...turnRows.values()].at(-1).pending_actions[0])!;
    expect(held.proposal_id).toBe(card.proposal_id);
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    const confirmed = savedProgramOf({ living_model: held.living_model })!;
    expect(hostFieldsOf(confirmed.canonical)).toEqual(new Set(['"approval":"approved"', '"author_id":null']));
    expect(withoutHostFields(confirmed.canonical)).toEqual(withoutHostFields(saved));
    expect(confirmed.runs).toHaveLength(2);
    expect(confirmed.runs[0]).toEqual(persisted!.living_model.runs[0]);
    // Approval is in the Run's digest, so it is a new revision; on the same seed its numbers are the draft Run's exactly.
    expect(confirmed.runs[1]!.receipt.revision_digest).not.toBe(confirmed.runs[0]!.receipt.revision_digest);
    expect(confirmed.runs[1]!.result.chances).toEqual(confirmed.runs[0]!.result.chances);
    expect(JSON.stringify(confirmed.runs[0]!.result.chances)).toMatch(/[0-9]/);
    // Carried on reload: a later turn (a Run press, no AI call) still offers the same card, flagged.
    const later = (await turn({ message: 'Run the analysis', chip: { id: 'run', action_type: 'run_analysis', label: 'Run' } })).json();
    expect(later.cards.map((c: Json) => [c.proposal_id, c.reading, c.approve_action.label])).toEqual([[card.proposal_id, true, 'Yes, that’s what I meant']]);
    expect(later.cards[0].changes).toEqual(card.changes);
    expect(sent).toHaveLength(1);
    // Its approve saves exactly that model and Run (the existing approve path), and the card is no longer waiting.
    const deps = { dispatch, proposals: new ProposalStore() };
    deps.proposals.put(held);
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, held.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(held.living_model));
  });

  // ── The card in plain words (DL 24 Oct, after the staging reading card): one phrase per item, no keys or codes ─────────
  /** Text outside quoted words (their words and labels may hold anything). */
  const outsideQuotes = (x: string) => x.replace(/"[^"]*"/g, '"…"').replace(/“[^”]*”/g, '“…”');
  /** Every way the card used to read as a form: "key: value", a raw operator or code, or a "whose:" line. */
  const formLike = (x: string): string[] => {
    const o = outsideQuotes(x).replace(/Olumi asks: “…”/g, '').replace(/words: “…”/g, '');
    return [...(o.includes(':') ? ['a key: value pair'] : []), ...(/>=|<=|(^|\s)[<>](\s|$)/.test(o) ? ['a raw operator'] : []), ...(/whose/i.test(o) ? ['whose'] : []),
      ...(/\b[a-z]+_[a-z_]+\b/.test(o) ? ['a code'] : []), ...(o.includes(';') ? ['a semicolon'] : [])];
  };

  it('the card in plain words (DL 24 Oct): every item of four drafts (the served capacity reading among them) reads as one phrase, with no key: value pair, raw operator, code or "whose", and its author only as the card\'s mark', () => {
    const saved = (file: string) => savedDraft(file);
    const hiring = saved('./hiring-alpha3.saved.json');
    // The capacity draft exactly as the served reading-card run saved it (scenario fc9ab632, CEE 1fd6f8cb): its 14 entries.
    const capacity = saved('./capacity-s4.saved.json');
    const drafts: [string, CanonicalModelT, string][] = [['bakery', bakery(), BRIEF], ['club', club(), CLUB_BRIEF], ['hiring', hiring.canonical, hiring.brief],
      ['capacity', capacity.canonical, capacity.brief]];
    let entries = 0;
    for (const [name, model, brief] of drafts) {
      const v = readingOf(model, { words: [brief], approver: null });
      // Every field of every item has its words: the reading is refused otherwise (no field is hidden to read plainly).
      expect(v.ok, `${name}: ${JSON.stringify(v)}`).toBe(true);
      if (!v.ok) continue;
      for (const c of v.changes) {
        entries += 1;
        expect(formLike(c.after ?? ''), `${name} ${c.id}: ${c.after}`).toEqual([]);
        // Theirs or Olumi's is the card's mark (changes[].author), never said again as a part of the phrase.
        expect((c.after ?? '').split(', ').filter((p) => p === 'yours' || p === 'Olumi’s'), `${name} ${c.id}`).toEqual([]);
      }
    }
    expect(entries).toBe(80); // positive control: 19 bakery + 18 club + 29 hiring + 14 capacity items read
    // The words, spelled, for one item of each kind the bakery has.
    const reading = readingOf(bakery(), { words: [BRIEF], approver: null });
    const said = new Map((reading.ok ? reading.changes : []).map((c) => [c.id, c.after] as const));
    expect(Object.fromEntries(['more_loaves', 'within_budget', 'second_oven', 'keep_one', 'sold_rel', 'sales_rel', 'spend_rel', 'sell_through', 'oven_price', 'sales'].map((id) => [id, said.get(id)])))
      .toEqual({
        more_loaves: '"sales" at least "sales target" 380 loaf/week, no deadline set, the measure you named, in your words "want to reach 380 loaves a week"',
        within_budget: '"spend" at most "budget" 3,000 GBP, no deadline set, in your words "We have £3,000 to spend"',
        second_oven: 'compared, sets "ovens added" 0 oven to "one oven" 1 oven from the start, in your words "A second oven"',
        keep_one: 'carries on as now, compared, in your words "keep our one oven"',
        sold_rel: '"sold per oven" is "extra per oven" 100 loaf/week/oven multiplied by "sell through" 0.5–0.9',
        sales_rel: 'an effect on "sales", starting from "base sales" 300 loaf/week, changes by "sold per oven" for each "ovens added" 0 oven, link 1 is yours, in your words "A second oven adds about 100 loaves a week"',
        spend_rel: '"spend" is "oven price" (still to be given) multiplied by "ovens added" 0 oven',
        sell_through: 'from 0.5 to 0.9, most likely 0.7 (a plausible range), a rate, an estimate, based on "New capacity sells only as far as demand grows."',
        oven_price: 'no figure yet (in GBP/oven), a fact, still to be given, Olumi asks "What would the second oven cost?"',
        sales: 'in loaf/week, a result, worked out from the model',
      });
  });

  it('the card in plain words (DL 24 Oct): a change to any one field of any item is said, before and after, in words (every group covered); a field that cannot change the words is refused', () => {
    const base = bakery();
    base.preferences.push({ id: 'fewer_hours', quantity: 'spend', direction: 'lower', author: 'olumi', quote: null, ...at });
    base.risks.push({ id: 'breakdown', label: 'The oven breaks down', occurrence: 'sell_through', severity: 'extra_per_oven', effect_on: 'sales', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...at });
    base.claims.push({ id: 'demand_grows', text: 'Demand grows in spring.', concerns: ['more_loaves'], author: 'olumi', quote: null, ...at });
    base.evidence.push({ id: 'last_spring', text: 'Sales rose last spring.', source: null, bears: 'supports', concerns: ['more_loaves'], author: 'olumi', quote: null, ...at });
    base.assumptions.push({ id: 'oven_lasts', text: 'The oven lasts five years.', applied: false, concerns: [], author: 'olumi', quote: null, ...at });
    base.dissent.push({ id: 'sam_doubts', holder: 'Sam', position: 'It will not sell.', concerns: ['second_oven'], author: 'olumi', quote: null, ...at });
    base.conditions.push({ id: 'landlord', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: [], author: 'olumi', quote: null, ...at });
    base.left_out.push({ id: 'morale', text: 'Staff morale', why: 'It has no measure.', question: null, concerns: [], author: 'olumi', quote: null, ...at });
    const words = [BRIEF];
    type M = CanonicalModelT;
    const qty = (id: string, f: Partial<CanonicalQuantityT>) => (m: M) => setQ(m, id, f);
    const goal = (f: (g: any) => void) => (m: M) => { f(m.goals[0]!); };
    const rel = (id: string, f: (r: any) => void) => (m: M) => { f(m.relations.find((r) => r.id === id)!); };
    const one = (family: keyof M, f: (r: any) => void) => (m: M) => { f((m[family] as any[])[0]); };
    const windowed = (m: M) => { m.goals[0]!.measure!.window = { origin_event: null, origin_offset: null, start: 0, periods: 'one_oven' }; };
    const edits: [string, (m: M) => void][] = [
      ['quantity label', qty('sell_through', { label: 'sell-through rate' })], ['quantity unit', qty('sell_through', { unit: '%' })], ['quantity kind', qty('sell_through', { kind: 'fact' })],
      ['quantity status', qty('sell_through', { status: 'unknown' })], ['quantity question', qty('sell_through', { question: 'How much sells?' })],
      ['quantity value', qty('sell_through', { value: 0.6 })], ['quantity low', qty('sell_through', { low: 0.4 })], ['quantity high', qty('sell_through', { high: 0.95 })],
      ['quantity range reading', qty('sell_through', { range_kind: 'bounds' })], ['quantity basis', qty('sell_through', { basis: 'A guess.' })],
      ['quantity author', qty('sell_through', { author: 'structure' })], ['quantity party', qty('budget', { party: 'our accountant' })], ['quantity words', qty('sell_through', { quote: 'We bake 300 loaves a week' })],
      ['relation base', rel('sales_rel', (r) => { r.base = 'budget'; })], ['link driver', rel('sales_rel', (r) => { r.terms[0].driver = 'one_oven'; })],
      ['link size', rel('sales_rel', (r) => { r.terms[0].coefficient = 'extra_per_oven'; })], ['link author', rel('sales_rel', (r) => { r.terms[0].author = 'olumi'; r.terms[0].quote = null; })],
      ['link party', rel('sales_rel', (r) => { r.terms[0].party = 'our baker'; })], ['part power', rel('sold_rel', (r) => { r.parts[0].power = -1; })], ['part id', rel('sold_rel', (r) => { r.parts[1].id = 'one_oven'; })],
      ['relation author', rel('spend_rel', (r) => { r.author = 'person'; r.quote = 'We have £3,000 to spend'; })],
      ['goal name', goal((g) => { g.label = 'Sell 380'; })], ['goal comparison', goal((g) => { g.measure.cmp = '>'; })], ['goal target', goal((g) => { g.measure.target = 'budget'; })],
      ['goal per', goal((g) => { g.measure.per = 'one_oven'; })], ['goal frame', goal((g) => { g.measure.frame = 'change_abs'; g.measure.reference = { kind: 'now', option: null, quantity: null }; })],
      ['goal aggregation', goal((g) => { g.measure.aggregation = 'mean'; })], ['goal window', windowed], ['goal measure by', goal((g) => { g.measure.measure_by = 'olumi'; })],
      ['goal rests on', goal((g) => { g.measure.assumptions = ['oven_lasts']; })], ['goal leaves out', goal((g) => { g.measure.exclusions = ['morale']; })], ['goal question', goal((g) => { g.question = 'By when?'; })],
      ['limit comparison', one('limits', (l) => { l.measure.cmp = '<'; })], ['limit bound', one('limits', (l) => { l.measure.bound = 'sales_target'; })], ['limit question', one('limits', (l) => { l.question = 'Is that firm?'; })],
      ['preference direction', one('preferences', (p) => { p.direction = 'higher'; })], ['preference figure', one('preferences', (p) => { p.quantity = 'budget'; })],
      ['option status', one('options', (o) => { o.status = 'ruled_out'; })], ['option variant', one('options', (o) => { o.developed_from = 'keep_one'; })],
      ['setting to', one('options', (o) => { o.sets[0].to = null; o.sets[0].value = 1; })], ['setting start', one('options', (o) => { o.sets[0].starts_after_periods = 2; })],
      ['setting question', one('options', (o) => { o.sets[0].question = 'From when?'; })], ['setting author', one('options', (o) => { o.sets[0].author = 'structure'; })],
      ['risk chance', one('risks', (k) => { k.occurrence = 'budget'; })], ['risk size', one('risks', (k) => { k.severity = 'budget'; })], ['risk affects', one('risks', (k) => { k.effect_on = 'spend'; })],
      ['risk how', one('risks', (k) => { k.mode = 'multiply'; })], ['risk start', one('risks', (k) => { k.starts_after_periods = 1; })],
      ['claim words', one('claims', (c) => { c.text = 'Demand grows in summer.'; })], ['claim about', one('claims', (c) => { c.concerns = ['second_oven']; })],
      ['evidence source', one('evidence', (e) => { e.source = 'the till'; })], ['evidence bears', one('evidence', (e) => { e.bears = 'challenges'; })],
      ['assumption applied', one('assumptions', (a) => { a.applied = true; })], ['dissent holder', one('dissent', (d) => { d.holder = 'Alex'; })], ['dissent view', one('dissent', (d) => { d.position = 'It might sell.'; })],
      ['condition kind', one('conditions', (c) => { c.kind = 'challenge'; })], ['left out why', one('left_out', (x) => { x.why = 'Nobody measures it.'; })], ['left out question', one('left_out', (x) => { x.question = 'How is morale?'; })],
    ];
    const v0 = validatePostimage(bakery(), base, { removals: [], words, fresh: words });
    expect(v0.ok, JSON.stringify(v0)).toBe(true);
    const saved = (v0 as { model: CanonicalModelT }).model;
    for (const [what, edit] of edits) {
      const m = JSON.parse(JSON.stringify(saved)) as M;
      edit(m);
      const v = validatePostimage(saved, m, { removals: [], words, fresh: words });
      expect(v.ok, `${what}: ${JSON.stringify(v)}`).toBe(true);
      if (!v.ok) continue;
      expect(v.changes.length, what).toBeGreaterThan(0);
      for (const c of v.changes) {
        expect(c.before, what).not.toBe(c.after);
        expect([...formLike(c.before ?? ''), ...formLike(c.after ?? '')], `${what}: ${c.before} → ${c.after}`).toEqual([]);
      }
    }
    // A window's own fields, on a goal that has one.
    const timed = JSON.parse(JSON.stringify(saved)) as M; windowed(timed);
    const v1 = validatePostimage(saved, timed, { removals: [], words, fresh: words }) as { ok: boolean; model: M };
    for (const [what, f] of [['window start', (w: any) => { w.start = 1; }], ['window length', (w: any) => { w.periods = 'sales_target'; }], ['window event', (w: any) => { w.origin_event = 'the opening'; w.origin_offset = 'one_oven'; }]] as const) {
      const m = JSON.parse(JSON.stringify(v1.model)) as M; f(m.goals[0]!.measure!.window!);
      const v = validatePostimage(v1.model, m, { removals: [], words, fresh: words });
      expect(v.ok, `${what}: ${JSON.stringify(v)}`).toBe(true);
    }
    // The stock relation's own fields (the club).
    const c0 = club();
    for (const [what, f] of [['stock start', (r: any) => { r.start = 'base_joins'; }], ['stock inflow', (r: any) => { r.inflows = [...r.inflows, 'base_joins']; }]] as const) {
      const m = JSON.parse(JSON.stringify(c0)) as M; f(m.relations.find((r) => r.form === 'stock')!);
      const v = validatePostimage(c0, m, { removals: [], words: [CLUB_BRIEF], fresh: [CLUB_BRIEF] });
      expect(v.ok, `${what}: ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it('step 5, an answer in chat (the agent\'s own tools: propose, then the person approves): Olumi\'s drafter writes the WHOLE updated model; ONE figure changes, in their words, on the card; a new Run', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    const firstRun = JSON.stringify(persisted!.living_model.runs[0]);
    sent.length = 0;
    const words = 'The oven would cost about £2,500.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    const args = { public_label: 'Oven price £2,500', basis: 'their answer', request: 'The oven price is their answer: about £2,500.', remove: [] };
    const answer = (quote: string) => savedWith((m) => setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote, basis: APPROXIMATE_FIGURE }));
    // Contrast first: a figure of theirs whose words are not theirs, verbatim, is refused, and nothing is proposed.
    replies = [answer('about £2,500 I think')];
    expect(await proposeProgramChange(deps, ctx, args)).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['oven_price'], check: 'their_words' } });
    replies = [answer(words)];
    const proposed = await proposeProgramChange(deps, ctx, args) as Json;
    expect(proposed.status, JSON.stringify(proposed)).toBe('ok');
    // One drafter call per proposal: the person's words, the saved model and the change.
    expect(sent).toHaveLength(2);
    expect(sent[1]!.input.map((m: Json) => m.role)).toEqual(['user', 'assistant', 'user']);
    // The update's request is prompt.ts's text, then the change (DL 24 Oct: the update text is prompt code).
    expect(sent[1]!.input[2].content).toBe(`${UPDATE_PREFIX}\nThe change: The oven price is their answer: about £2,500.\nRemove: nothing`);
    // The card shows the change's substance, before and after, and whose it is.
    expect(proposed.data.changes).toEqual([{ id: 'oven_price', kind: 'quantity', action: 'change', label: 'oven price', before: 'no figure yet (in GBP/oven), still to be given, Olumi asks "What would the second oven cost?", no basis given, not in your words',
      after: `2,500 GBP/oven, known, no question, based on "${APPROXIMATE_FIGURE}", in your words "The oven would cost about £2,500."`, author: 'person' }]);
    expect(deps.proposals.get(proposed.data.proposal_id)!.changes).toEqual(proposed.data.changes);
    expect(registered).toHaveLength(1); // proposing saves nothing
    const applied = await applyProgramChange(deps, ctx, proposed.data.proposal_id) as Json;
    expect(applied).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(sent).toHaveLength(2);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ status: 'known', value: 2500, low: null, high: null, author: 'person', quote: words, approval: 'approved', question: null });
    expect(after.quantities.filter((x) => x.id !== 'oven_price')).toEqual(before.quantities.filter((x) => x.id !== 'oven_price'));
    expect({ ...after, quantities: [], history: [] }).toEqual({ ...before, quantities: [], history: [] });
    expect(after.history).toEqual([...before.history, { id: 'oven_price', change: 'superseded', old: JSON.stringify(before.quantities.find((x) => x.id === 'oven_price')), quote: words, author_id: null }]);
    expect(persisted!.living_model.person_words).toEqual([BRIEF, words]);
    // The approved card's frozen program is what was written: model and Run.
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(deps.proposals.get(proposed.data.proposal_id)!.living_model));
    const runs = persisted!.living_model.runs as Json[];
    expect(runs).toHaveLength(2);
    expect(JSON.stringify(runs[0])).toBe(firstRun);
    expect(runs[1]!.receipt.revision_digest).toBe(revisionDigest(after, [BRIEF, words]));
    const x = compile(after, { sourceText: `${BRIEF}\n${words}` }).executable!;
    expect(runs[1]!.result.chances).toEqual(JSON.parse(JSON.stringify(simulate(x, { seed: seedOf(SCENARIO), draws: RUN_DRAWS }).options
      .map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))));
    // The same approval again: its own earlier save is found, never written twice.
    const saves = registered.length;
    expect(await applyProgramChange(deps, ctx, proposed.data.proposal_id)).toMatchObject({ status: 'ok', data: { already_saved: true } });
    expect(registered.length).toBe(saves);
  });

  it('DoD-G marketing r2–r5 (DL 24 Oct): a date the drafter records is whole periods from today in code, Olumi\'s labelled reading, on the saved model and the reading card; a cold reopen and an update a month later keep it; new date words, and a date answered, are read against that day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
      // The drafter counts from a planning date itself (r2/r3) and records the words; the code's count replaces its figure.
      const m = club();
      m.quantities.push(q('reopen_offset', 'month', { label: 'Months from now until the reopening', status: 'known', author: 'olumi', value: 5, basis: 'Counted from the planning date.',
        stated_date: '6 months from 9 October' }));
      m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: 'the reopening', origin_offset: 'reopen_offset', start: 0, periods: 'months' } } }));
      const brief = `${CLUB_BRIEF} We reopen 6 months from 9 October.`;
      const deps = { dispatch, proposals: new ProposalStore() };
      replies = [JSON.stringify(m)];
      const r = (await turn({ message: brief })).json();
      expect(r.model_program.saved).toBe(true);
      const BASIS = 'Olumi\'s reading of the date: 9 April 2027 is 6 months from today, 24 October 2026, to the nearest whole month.';
      const offset = () => (persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'reopen_offset')!;
      expect(offset()).toMatchObject({ kind: 'fact', status: 'known', author: 'olumi', value: 6, low: null, high: null, quote: null, question: null, stated_date: '6 months from 9 October', basis: BASIS });
      expect(compile(persisted!.living_model.canonical as CanonicalModelT).executable!.goals[0]!.window).toEqual({ start_period: 6, periods: 3 });
      expect(r.cards[0].changes.find((c: Json) => c.id === 'reopen_offset')).toMatchObject({ action: 'add', author: 'olumi',
        after: `6 month, for the date "6 months from 9 October", a fact, known, based on "${BASIS}"` });
      // A month later: the cold reopen shows the stored reading and its Run, current.
      vi.setSystemTime(new Date('2026-11-30T09:00:00Z'));
      const cold = reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
      expect(cold.program.canonical.quantities.find((x) => x.id === 'reopen_offset')).toMatchObject({ value: 6, basis: BASIS });
      expect(cold.current).toBe(true);
      // An update that re-emits the date with its own count changes only what it was asked: the reading stands.
      const words = 'We now get 22 new members a month.';
      const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
      const update = (f: Partial<CanonicalQuantityT>) => savedWith((d) => { setQ(d, 'base_joins', { value: 22, quote: 'We now get 22 new members a month' }); setQ(d, 'reopen_offset', f); });
      replies = [update({ value: 4, basis: 'Recounted.' })];
      const kept = await proposeProgramChange(deps, ctx(), ProgramChangeParams.parse({ public_label: 'Joins', basis: 'their words', request: 'Joins are now 22 a month.', remove: [] })) as Json;
      expect(kept.status, JSON.stringify(kept)).toBe('ok');
      expect(kept.data.changes.map((c: Json) => c.id)).toEqual(['base_joins']);
      // New date words are read against that day (9 May 2027 from 30 November: 5).
      replies = [update({ stated_date: '7 months from 9 October' })];
      const moved = await proposeProgramChange(deps, ctx(), ProgramChangeParams.parse({ public_label: 'Joins', basis: 'their words', request: 'Joins are now 22 a month.', remove: [] })) as Json;
      expect(moved.status, JSON.stringify(moved)).toBe('ok');
      expect(moved.data.changes.find((c: Json) => c.id === 'reopen_offset')).toMatchObject({ action: 'change',
        after: '5 month, for the date "7 months from 9 October", based on "Olumi\'s reading of the date: 9 May 2027 is 5 months from today, 30 November 2026, to the nearest whole month."' });
      // A date answered to a listed question: their date words, read in code; the figure the AI wrote is not kept.
      const said = 'We reopen on 9 June 2027.';
      const answered = await proposeProgramChange(deps, { ...ctx(), verified_user_messages: [said], user_turn_text: said }, ProgramChangeParams.parse({ public_label: 'Reopening', basis: 'their answer',
        request: '', remove: [], answers: [{ id: 'reopen_offset', status: 'known', author: 'person', value: 7, low: null, high: null, range_kind: null, party: null, quote: 'on 9 June 2027', basis: null,
          stated_date: '9 June 2027' }] })) as Json;
      expect(answered.status, JSON.stringify(answered)).toBe('ok');
      const held = savedProgramOf({ living_model: deps.proposals.get(answered.data.proposal_id)!.living_model })!.canonical;
      expect(held.quantities.find((x) => x.id === 'reopen_offset')).toMatchObject({ status: 'known', author: 'olumi', value: 6, stated_date: '9 June 2027',
        basis: 'Olumi\'s reading of the date: 9 June 2027 is 6 months from today, 30 November 2026, to the nearest whole month.' });
      // A figure typed on the canvas is theirs: the date words and any direction go with the reading, and the card says so.
      const typed = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'reopen_offset' }, value: 7, operation_key: randomUUID() });
      expect(typed.status, JSON.stringify(typed)).toBe('saved');
      expect(offset()).toMatchObject({ value: 7, author: 'person', status: 'known', stated_date: null, direction: null, basis: null });
      const edit = typed.changes!.find((c) => c.id === 'reopen_offset')!;
      expect(edit.before).toContain('6 month, for the date "6 months from 9 October"');
      expect(edit.after).toMatch(/^7 month, /);
      expect(edit.after).not.toContain('for the date');
    } finally { vi.useRealTimers(); }
  });

  it('THE WITNESS: a stock, a limit and one Olumi estimate, with known answers, through draft, an in-card change, a chat correction, Runs and cold reopens', async () => {
    replies = [JSON.stringify(club())];
    const drafted = (await turn({ message: CLUB_BRIEF })).json();
    expect(drafted.model_program.saved, JSON.stringify(drafted.model_program.compile?.errors ?? drafted.model_program.draft)).toBe(true);
    expect(drafted.model_program).toMatchObject({ readback: { read: true, canonical_identical: true, runs_identical: true, seed_identical: true } });
    const goalOf = (run: Json, option: string) => (run.result.chances as Json[]).find((o) => o.option_id === option)!.per_goal[0];
    const run1 = persisted!.living_model.runs[0] as Json;
    // Known answers, DETERMINISTIC: each stored Run is exactly its stored model simulated on the scenario's seed, and the known
    // answers are read off that same stored model on seed 1 (GOLD-4's documented seed), 10,000 draws. The scenario's own seed is
    // fresh per run (a random scenario id), so the fixed bounds are never read on it (#3712 CI: on correct code they failed in
    // 1 and 5 of 300 random seeds).
    const chancesOf = (seed: number) => {
      const lm = persisted!.living_model;
      return JSON.parse(JSON.stringify(simulate(compile(lm.canonical, { sourceText: sourceTextOf(lm.person_words) }).executable!, { seed, draws: RUN_DRAWS }).options
        .map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))) as Json[];
    };
    const atSeed1 = (option: string) => chancesOf(1).find((o) => o.option_id === option)!.per_goal[0];
    // Carry on exactly 0 (330 < 340); the promotion Φ(1.4434) = 0.92554 (Wilson half-width 0.0051).
    expect(run1.result.chances).toEqual(chancesOf(seedOf(SCENARIO)));
    expect([goalOf(run1, 'carry_on').chance, goalOf(run1, 'carry_on').precision_95]).toEqual([0, [0, 0]]);
    expect(Math.abs(atSeed1('promotion').chance - 0.92554)).toBeLessThan(0.0075);
    expect((run1.result.chances as Json[]).map((o) => [o.option_id, (o.within_limits as Json).chance])).toEqual([['promotion', 1], ['carry_on', 1]]);

    // Change ONE input on its card: leavers 10 → 12. The promotion now needs an effect of 16/3: 1 − Φ(0.2887) = 0.38641.
    const card = await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'leavers', value: 12 } });
    expect(card.statusCode, card.body).toBe(200);
    const m2 = persisted!.living_model.canonical as CanonicalModelT;
    expect(m2.quantities.find((x) => x.id === 'leavers')).toMatchObject({ value: 12, author: 'person', status: 'known' });
    // The canonical revision and the projected value agree, and the Run is the new revision's.
    expect((persisted!.nodes as Json[]).find((n) => n.id === 'leavers')!.observed_state).toMatchObject({ value: 12, source: 'user_override' });
    const run2 = persisted!.living_model.runs[1] as Json;
    expect(run2.receipt.revision_digest).toBe(revisionDigest(m2, persisted!.living_model.person_words));
    expect(goalOf(run2, 'carry_on').chance).toBe(0);
    expect(run2.result.chances).toEqual(chancesOf(seedOf(SCENARIO)));
    expect(Math.abs(atSeed1('promotion').chance - 0.38641)).toBeLessThan(0.012);
    expect(card.json().canonical_analysis_view.run.run_id).toBe(run2.run_id);

    // Cold reopen: the SAME stored result, Run id and digest, from the stored JSON alone in a fresh module.
    vi.resetModules();
    const fresh = await import('../program-store.js');
    const cold = fresh.reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect([cold.run!.run_id, cold.run!.receipt.revision_digest, cold.current]).toEqual([run2.run_id, run2.receipt.revision_digest, true]);
    expect(stableStringify(cold.view)).toBe(stableStringify(card.json().canonical_analysis_view));

    // Correct Olumi's estimate in chat (the person's words, approved): ONLY that figure becomes theirs; the mechanism (the
    // link and its relation) stays Olumi's. 300 + 3 × (20 + 6 − 12) = 342 ≥ 340: exactly 1. A new revision, a new Run.
    const words = 'From experience a promotion brings 6 more a month.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    replies = [savedWith((m) => setQ(m, 'promo_effect', { value: 6, low: null, high: null, range_kind: null, status: 'known', author: 'person', basis: null, quote: 'a promotion brings 6 more a month' }))];
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Promotion effect 6 a month', basis: 'their experience', request: 'The promotion brings 6 more a month, in their words.', remove: [] }) as Json;
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.before, c.after])).toEqual([['promo_effect', 'change',
      'from 3 to 7 member/month/promotion, most likely 5 (a plausible range), an estimate, based on "Promotions at clubs this size bring a few extra joins a month.", Olumi’s, not in your words',
      '6 member/month/promotion, known, no basis given, yours, in your words "a promotion brings 6 more a month"']]);
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const m3 = persisted!.living_model.canonical as CanonicalModelT;
    expect(m3.quantities.find((x) => x.id === 'promo_effect')).toMatchObject({ value: 6, low: null, high: null, author: 'person', quote: 'a promotion brings 6 more a month' });
    expect(m3.relations).toEqual(club().relations);
    const runs = persisted!.living_model.runs as Json[];
    expect(runs.map((r) => r.run_id)).toEqual([run1.run_id, run2.run_id, runs[2]!.run_id]);
    expect(stableStringify(runs.slice(0, 2))).toBe(stableStringify([run1, run2]));
    expect(new Set(runs.map((r) => r.receipt.revision_digest)).size).toBe(3);
    expect([goalOf(runs[2]!, 'promotion'), goalOf(runs[2]!, 'carry_on')].map((g) => [g.chance, g.precision_95])).toEqual([[1, [1, 1]], [0, [0, 0]]]);
    const reopened = reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect([reopened.run!.run_id, reopened.current]).toEqual([runs[2]!.run_id, true]);

    // Contrast (stale CAS): a chat card made on the model BEFORE another change is superseded, and writes nothing.
    const later = 'Actually we can only spend £450.';
    const ctx2 = { ...ctx, verified_user_messages: [later], user_turn_text: later };
    replies = [savedWith((m) => setQ(m, 'budget', { value: 450, quote: 'we can only spend £450' }))];
    const stale = await proposeProgramChange(deps, ctx2, { public_label: 'Budget £450', basis: 'they said so', request: 'The budget is £450.', remove: [] }) as Json;
    expect(stale.status, JSON.stringify(stale)).toBe('ok');
    await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'leavers', value: 11 } });
    const saves = registered.length;
    expect(await applyProgramChange(deps, ctx2, stale.data.proposal_id)).toMatchObject({ status: 'refused' });
    expect(registered.length).toBe(saves);
  });

  it('class 13: a program saved under the old from_period is read ONCE as starts_after_periods, the same count and the same executable; its stored Run is not called current for the changed form', async () => {
    replies = [JSON.stringify(club())];
    await turn({ message: CLUB_BRIEF });
    const lm = persisted!.living_model;
    const stored = JSON.parse(JSON.stringify(lm.canonical).replaceAll('"starts_after_periods":', '"from_period":'));
    expect(JSON.stringify(stored)).not.toContain('starts_after_periods');
    // As saved before the rename: the model under the old name, and its Run's digest over that stored form.
    const oldRun = { ...lm.runs[0], receipt: { ...lm.runs[0].receipt, revision_digest: revisionDigest(stored, lm.person_words) } };
    const before = { ...persisted!, living_model: { ...lm, canonical: stored, runs: [oldRun] } };
    const read = programReadOf(before);
    expect(read.kind).toBe('program');
    const program = (read as Extract<typeof read, { kind: 'program' }>).program;
    expect(stableStringify(program.canonical)).toBe(stableStringify(lm.canonical));
    const words = sourceTextOf(lm.person_words);
    expect(stableStringify(compile(program.canonical, { sourceText: words }).executable)).toBe(stableStringify(compile(lm.canonical as CanonicalModelT, { sourceText: words }).executable));
    // Its stored Run was made on the old form, so it is not called current for the read one: a Run again shows the chance.
    expect([reopenProgram(before)!.run!.run_id, reopenProgram(before)!.current]).toEqual([lm.runs[0].run_id, false]);
    expect(reopenProgram(persisted)!.current).toBe(true); // contrast: a Run made on the new form
    // S4: the person's model did not move (only how it is read), so the stale result says it is from before an update.
    const old = reopenProgram(before)!.view as Json;
    expect([old.staleness.stale, old.staleness.reason, old.face_when_stale]).toEqual([true, 'engine_or_format_updated', RUN_AGAIN_AFTER_UPDATE]);
    // Contrast: the old-form model moved too (a word of theirs added): the model-change words, never "an update".
    const movedOld = JSON.parse(JSON.stringify(before)); movedOld.living_model.person_words.push('and one more thing');
    const moved = reopenProgram(movedOld)!.view as Json;
    expect([moved.staleness.reason, moved.face_when_stale]).toEqual(['graph_hash_diverged', RUN_AGAIN_FOR_CHANCE]);
    // Both names on one setting is not mapped: the schema judges it, and the program is unreadable.
    const both = JSON.parse(JSON.stringify(lm.canonical).replace('"starts_after_periods":0', '"starts_after_periods":0,"from_period":0'));
    expect(programReadOf({ ...persisted!, living_model: { ...lm, canonical: both } }).kind).toBe('unreadable');
  });

  it('simplify v1 (A1, A2): the ONE validator: an omitted record is refused; a removal only when listed, on the card and in history, its id never used again; every add, change and remove on the card and its wire', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'Drop keeping our one oven: the oven is £2,000, and our landlord must agree first.';
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    const args = (remove: string[]) => ({ public_label: 'Your changes', basis: 'they said so', request: 'Remove keeping one oven; the oven costs £2,000; the landlord must agree first.', remove });
    const edited = (drop: boolean) => savedWith((d) => {
      if (drop) d.options = d.options.filter((o) => o.id !== 'keep_one');
      setQ(d, 'oven_price', { status: 'known', value: 2000, question: null, quote: 'the oven is £2,000' });
      d.conditions.push({ id: 'landlord_agrees', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: ['second_oven'], author: 'person', party: null, quote: 'our landlord must agree first', approval: 'proposed', author_id: null });
    });
    // Left out with no listed removal: refused, and nothing is proposed.
    replies = [edited(true)];
    expect(await proposeProgramChange(deps, ctx(), args([]))).toMatchObject({ status: 'refused', reason: 'omitted_record', data: { ids: ['keep_one'] } });
    // Listed but still there; listed but no such record.
    replies = [edited(false)];
    expect(await proposeProgramChange(deps, ctx(), args(['keep_one']))).toMatchObject({ status: 'refused', reason: 'removal_not_applied', data: { ids: ['keep_one'] } });
    replies = [edited(true)];
    expect(await proposeProgramChange(deps, ctx(), args(['keep_one', 'no_such_record']))).toMatchObject({ status: 'refused', reason: 'unknown_removal', data: { ids: ['no_such_record'] } });
    expect(registered).toHaveLength(1);
    // Listed: the card holds EVERY change, each with its substance before and after, and whose it is.
    replies = [edited(true)];
    const c = ctx();
    const p = await proposeProgramChange(deps, c, args(['keep_one'])) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const changes: ProposalChange[] = [
      { id: 'oven_price', kind: 'quantity', action: 'change', label: 'oven price', before: 'no figure yet (in GBP/oven), still to be given, Olumi asks "What would the second oven cost?", not in your words',
        after: '2,000 GBP/oven, known, no question, in your words "the oven is £2,000"', author: 'person' },
      { id: 'keep_one', kind: 'option', action: 'remove', label: 'Keep our one oven', before: 'carries on as now, compared, in your words "keep our one oven"', after: null, author: 'person' },
      { id: 'landlord_agrees', kind: 'record', action: 'add', label: 'Only once the landlord agrees.', before: null,
        after: 'a prerequisite, about "A second oven", in your words "our landlord must agree first"', author: 'person' },
    ];
    expect(p.data.changes).toEqual(changes);
    // The card the UI reads carries the same changes, on the held proposal's own projection (and in its digest).
    const proposal = deps.proposals.get(p.data.proposal_id)!;
    const hold = proposalPendingAction(proposal, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Approve', message: 'Approve.' } as never, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() });
    const record = proposalRecord(hold, persisted)!;
    expect(proposalFieldsWire([record], record.base_graph_hash)!.proposals[0]!.changes).toEqual(changes);
    expect(proposalRecord(proposalPendingAction({ ...proposal, changes: changes.slice(1) }, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Approve', message: 'Approve.' } as never,
      { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() }), persisted)).toBeUndefined(); // a card whose changes were edited is not this proposal
    expect(await applyProgramChange(deps, c, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.options.map((o) => o.id)).toEqual(['second_oven']);
    expect(after.conditions.map((x) => [x.id, x.author, x.approval])).toEqual([['landlord_agrees', 'person', 'approved']]);
    expect(after.history.slice(-2).map((h) => [h.id, h.change])).toEqual([['oven_price', 'superseded'], ['keep_one', 'withdrawn']]);
    expect(JSON.parse(after.history.at(-1)!.old)).toEqual(bakery().options[1]);
    // Its id is never used again: a new item under it is refused.
    replies = [savedWith((d) => { d.options.push({ ...bakery().options[1]!, label: 'Keep one oven after all' }); })];
    expect(await proposeProgramChange(deps, ctx(), { ...args([]), request: 'Bring back keeping one oven.' })).toMatchObject({ status: 'refused', reason: 'recycled_id', data: { ids: ['keep_one'] } });
  });

  it('simplify v1 (buddy 21:16Z): preserve by (family, id); the card shows EVERY changed field or nothing is proposed; approval and author_id are the host\'s, never the drafter\'s', async () => {
    const m = bakery();
    m.quantities.push(q('opening_in', 'week', { value: 2, quote: 'We open in 2 weeks' }), q('opening_twin', 'week', { label: 'opening in', value: 2, quote: 'We open in 2 weeks' }),
      q('opening_later', 'week', { value: 3, quote: 'or in 3 weeks' }), q('four_weeks', 'week', { value: 4, quote: 'within 4 weeks of opening' }));
    m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: 'the opening', origin_offset: 'opening_in', start: 0, periods: 'four_weeks' } } }));
    m.conditions.push({ id: 'landlord_agrees', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: [], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: `${BRIEF} We open in 2 weeks, or in 3 weeks, and want it within 4 weeks of opening.` })).json().model_program.saved).toBe(true);
    const saved = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make it 3 weeks to the opening.'], user_turn_text: 'Make it 3 weeks to the opening.' });
    const propose = async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, ctx(), { public_label: 'The opening', basis: 'they said so', request: 'The opening is in 3 weeks.', remove: [] }) as Json;
    };
    const timing = (offset: string) => (d: CanonicalModelT) => { d.goals = d.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { ...g.measure!.window!, origin_offset: offset } } })); };
    // (a) An existing id never moves to another family; an id is never used twice, in one family or across two.
    expect(await propose((d) => { const c = d.conditions.pop()!; d.evidence.push({ id: c.id, text: c.text, source: null, bears: 'informs', concerns: [], author: 'olumi', quote: null, ...at }); }))
      .toMatchObject({ status: 'refused', reason: 'moved_record', data: { ids: ['landlord_agrees'] } });
    expect(await propose((d) => { d.quantities.push({ ...d.quantities[0]! }); })).toMatchObject({ status: 'refused', reason: 'duplicate_id', data: { ids: ['base_sales'] } });
    expect(await propose((d) => { d.claims.push({ id: 'twin', text: 'Bread sells.', concerns: [], author: 'olumi', quote: null, ...at });
      d.dissent.push({ id: 'twin', holder: 'Sam', position: 'It will not.', concerns: [], author: 'olumi', quote: null, ...at }); }))
      .toMatchObject({ status: 'refused', reason: 'duplicate_id', data: { ids: ['twin'] } });
    // (b) Every changed field is on the card: the event's timing, moved between two figures already in the model, shows both.
    const shown = await propose(timing('opening_later'));
    expect(shown.status, JSON.stringify(shown)).toBe('ok');
    expect(shown.data.changes).toEqual([{ id: 'more_loaves', kind: 'goal', action: 'change', label: 'Reach 380 loaves a week', before: 'by the end of "four weeks" 4 week, counted from "the opening", which is "opening in" 2 week from now',
      after: 'by the end of "four weeks" 4 week, counted from "the opening", which is "opening later" 3 week from now', author: 'person' }]);
    // Words that would read the same on both sides (two timings named and sized alike): not proposed.
    expect(await propose(timing('opening_twin'))).toMatchObject({ status: 'refused', reason: 'unshown_change', data: { ids: ['more_loaves (measure.window.origin_offset)'] } });
    // (c) The drafter's approval and author_id are never taken: on an untouched item they change nothing; a changed item is
    // accepted by the approving person (the host), its author unchanged.
    const host = await propose((d) => { timing('opening_later')(d);
      d.conditions = d.conditions.map((c) => ({ ...c, approval: 'approved', author_id: 'someone-else' })); d.goals = d.goals.map((g) => ({ ...g, author_id: 'someone-else' })); });
    expect(host.status, JSON.stringify(host)).toBe('ok');
    expect(host.data.changes.map((c: Json) => c.id)).toEqual(['more_loaves']);
    const card = savedProgramOf({ living_model: deps.proposals.get(host.data.proposal_id)!.living_model })!.canonical;
    expect(card.conditions).toEqual(saved.conditions);
    expect(card.goals[0]).toMatchObject({ author: 'person', approval: 'approved', author_id: null });
  });

  it('simplify v1 (Codex r1 P1): the card is driven by the field-level diff: every changed field of an item is said, saved and proposed; a field that would read the same on both sides is refused by name, whatever else changes', async () => {
    const m = bakery();
    // Two figures named and sized alike: "sold per oven", each worked out from the same two figures.
    m.quantities.push(q('sold_twin', 'loaf/week/oven', { label: 'sold per oven', kind: 'coefficient', status: 'derived', author: 'olumi' }));
    m.relations.push({ form: 'definition', id: 'twin_rel', defines: 'sold_twin', op: 'product', parts: [{ id: 'extra_per_oven', power: 1 }, { id: 'sell_through', power: 1 }], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We now bake 320 loaves a week, our baker says.';
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    const propose = async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, ctx(), { public_label: 'Base sales', basis: 'their words', request: 'Base sales are now 320 a week.', remove: [] }) as Json;
    };
    // (1) Two fields of one item change (its figure, and the question it carries): both are on the card, each saved → proposed.
    const both = await propose((d) => setQ(d, 'base_sales', { value: 320, question: 'Is that every week of the year?', quote: 'We now bake 320 loaves a week' }));
    expect(both.status, JSON.stringify(both)).toBe('ok');
    expect(both.data.changes).toEqual([{ id: 'base_sales', kind: 'quantity', action: 'change', label: 'base sales',
      before: '300 loaf/week, no question, in your words "We bake 300 loaves a week"',
      after: '320 loaf/week, Olumi asks "Is that every week of the year?", in your words "We now bake 320 loaves a week"', author: 'person' }]);
    // (2) A link's size moved to the figure named and sized alike, while who it is from also changes: refused, naming the
    // field that would read the same; the other change does not carry it through.
    const swap = (to: string) => (d: CanonicalModelT) => {
      d.relations = d.relations.map((r) => (r.form === 'effect' ? { ...r, terms: r.terms.map((x) => ({ ...x, coefficient: to, party: 'our baker' })) } : r));
    };
    expect(await propose(swap('sold_twin'))).toMatchObject({ status: 'refused', reason: 'unshown_change', data: { ids: ['sales_rel (terms.0.coefficient)'] } });
    // Contrast: moved to a figure with its own name, both changes are on the card.
    const named = await propose(swap('extra_per_oven'));
    expect(named.status, JSON.stringify(named)).toBe('ok');
    expect(named.data.changes).toEqual([{ id: 'sales_rel', kind: 'relation', action: 'change', label: 'sales',
      before: 'an effect on "sales", starting from "base sales" 300 loaf/week, changes by "sold per oven" for each "ovens added" 0 oven, link 1 is yours, in your words "A second oven adds about 100 loaves a week"',
      after: 'an effect on "sales", starting from "base sales" 300 loaf/week, changes by "extra per oven" 100 loaf/week/oven for each "ovens added" 0 oven, link 1 is yours, '
        + 'in our baker’s words "A second oven adds about 100 loaves a week"', author: 'olumi' }]);
  });

  it('simplify v1 (buddy 22:47Z): a list of another length is compared entry by entry: a link moved to another figure of the same name is said with both figures while a link is added in full; moved to one named and sized alike, refused', async () => {
    const m = bakery();
    const brief = `${BRIEF} Each oven has an impact of 1 loaf, or 9 loaves.`;
    // Three figures named "impact": 1, 9, and a twin of the 1; and Olumi's estimate of another effect.
    m.quantities.push(q('impact_1', 'loaf/week/oven', { label: 'impact', kind: 'coefficient', value: 1, quote: 'an impact of 1 loaf' }),
      q('impact_9', 'loaf/week/oven', { label: 'impact', kind: 'coefficient', value: 9, quote: 'or 9 loaves' }),
      q('impact_twin', 'loaf/week/oven', { label: 'impact', kind: 'coefficient', value: 1, quote: 'an impact of 1 loaf' }),
      q('other', 'loaf/week/oven', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 3, low: 2, high: 4, range_kind: 'plausible', basis: 'Another oven effect, for the row.' }));
    m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, terms: [{ driver: 'ovens_added', coefficient: 'impact_1', author: 'olumi' as const, quote: null, ...at }] } : r));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make the impact 9, and add the other effect.'], user_turn_text: 'Make the impact 9, and add the other effect.' });
    const relink = (to: string) => async () => {
      replies = [savedWith((d) => {
        d.relations = d.relations.map((r) => (r.form === 'effect'
          ? { ...r, terms: [{ ...r.terms[0]!, coefficient: to }, { driver: 'one_oven', coefficient: 'other', author: 'olumi' as const, quote: null, ...at }] } : r));
      })];
      return await proposeProgramChange(deps, ctx(), { public_label: 'The impact', basis: 'their words', request: 'The impact is 9, with the other effect added.', remove: [] }) as Json;
    };
    // Link 1's size moves from the 1 to the 9 (both "impact") while link 2 is added: both figures, and the new link in full.
    const shown = await relink('impact_9')();
    expect(shown.status, JSON.stringify(shown)).toBe('ok');
    expect(shown.data.changes).toEqual([{ id: 'sales_rel', kind: 'relation', action: 'change', label: 'sales',
      before: 'an effect on "sales", starting from "base sales" 300 loaf/week, changes by "impact" 1 loaf/week/oven for each "ovens added" 0 oven, no link 2',
      after: 'an effect on "sales", starting from "base sales" 300 loaf/week, changes by "impact" 9 loaf/week/oven for each "ovens added" 0 oven, '
        + 'changes by "other" 2–4 loaf/week/oven for each "one oven" 1 oven', author: 'olumi' }]);
    // Moved to the twin (named and sized alike) while link 2 is added: refused, naming the field that would read the same.
    expect(await relink('impact_twin')()).toMatchObject({ status: 'refused', reason: 'unshown_change', data: { ids: ['sales_rel (terms.0.coefficient)'] } });
  });

  it('the card in plain words (Codex r1 #3718): a figure given where there was none is said or refused, never carried beside another change; a deadline or a setting taken away is said; a link reads "changes by" its own signed figure', () => {
    const words = [CLUB_BRIEF];
    const check = (base: CanonicalModelT, edit: (m: CanonicalModelT) => void, said = words) => {
      const m = JSON.parse(JSON.stringify(base)) as CanonicalModelT;
      edit(m);
      return validatePostimage(base, m, { removals: [], words: said, fresh: said });
    };
    const unshown = (ids: string[]) => ({ ok: false, code: 'unshown_change', ids });
    // Codex's case: a figure set on a switch (which reads its "one promo", never the figure) beside a timing change: refused by name.
    expect(check(club(), (m) => { m.options[0]!.sets[0]!.starts_after_periods = 2; m.options[0]!.sets[0]!.value = 99; })).toMatchObject(unshown(['promotion (sets.0.value)']));
    // Contrast: the timing alone is on the card, before and after.
    const timing = check(club(), (m) => { m.options[0]!.sets[0]!.starts_after_periods = 2; });
    expect(timing.ok ? timing.changes : timing).toEqual([{ id: 'promotion', kind: 'option', action: 'change', label: 'Run a promotion',
      before: 'sets "promo on" 0 promotion to "one promo" 1 promotion from the start', after: 'sets "promo on" 0 promotion to "one promo" 1 promotion after 2 months', author: 'person' }]);
    // The same figure on a setting that arrives with its own entry, or with a whole new option: refused too.
    expect(check(club(), (m) => { m.options[0]!.sets.push({ ...m.options[0]!.sets[0]!, value: 99 }); })).toMatchObject(unshown(['promotion (sets.2.value)']));
    expect(check(club(), (m) => { m.options.push({ ...m.options[0]!, id: 'promo_twice', label: 'Run two promotions', author: 'olumi', quote: null, sets: [{ ...m.options[0]!.sets[0]!, value: 99, author: 'olumi', quote: null }] }); }))
      .toMatchObject(unshown(['promo_twice (sets.0.value)']));
    // A deadline taken away, and a setting taken away, are each said (nothing is left to set back alone).
    const timed = check(bakery(), (m) => { m.goals[0]!.measure!.window = { origin_event: null, origin_offset: null, start: 0, periods: 'one_oven' }; }, [BRIEF]) as { ok: true; model: CanonicalModelT };
    const untimed = check(timed.model, (m) => { m.goals[0]!.measure!.window = null; }, [BRIEF]);
    expect(untimed.ok ? untimed.changes.map((c) => [c.before, c.after]) : untimed).toEqual([['by the end of "one oven" 1 oven', 'no deadline set']]);
    const fewer = check(club(), (m) => { m.options[0]!.sets.pop(); });
    expect(fewer.ok ? fewer.changes.map((c) => [c.before, c.after]) : fewer).toEqual([['sets "spend" 0 GBP to "promo cost" 500 GBP from the start, in your words "The promotion costs £500"', 'without this setting']]);
    // A link whose size is a fall of 3 to 7 (compiler-valid) reads "changes by" its own signed figure, never "raised by".
    const falls = club();
    setQ(falls, 'promo_effect', { value: -5, low: -7, high: -3 });
    expect(compile(falls, { sourceText: CLUB_BRIEF }).errors).toEqual([]);
    const read = readingOf(falls, { words, approver: null });
    expect(read.ok ? read.changes.find((c) => c.id === 'joins_rel')?.after : read)
      .toBe('an effect on "joins", starting from "base joins" 20 member/month, changes by "promo effect" -7–-3 member/month/promotion for each "promo on" 0 promotion');
  });
  it('simplify v1 (buddy 21:46Z): an item the card could not name is never proposed: an empty-label risk is refused by the card\'s own contract and by the compiler; so is a note with no words', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['The oven could break down.'], user_turn_text: 'The oven could break down.' });
    const estimate = (id: string, unit: string, low: number, high: number, value: number | null) => q(id, unit, { kind: 'coefficient', status: 'estimated', author: 'olumi', value, low, high, range_kind: 'plausible', basis: 'Synthetic.' });
    const risky = (label: string) => savedWith((d) => {
      d.quantities.push(estimate('breakdown_chance', '1', 0.05, 0.2, null), estimate('lost_loaves', 'loaf/week', -150, -50, -100));
      d.risks.push({ id: 'breakdown', label, occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...at });
    });
    const propose = async (body: string) => {
      replies = [body];
      return await proposeProgramChange(deps, ctx(), { public_label: 'A risk', basis: 'they said so', request: 'Add the oven breaking down as a risk.', remove: [] }) as Json;
    };
    expect(await propose(risky(''))).toMatchObject({ status: 'refused', reason: 'invalid_change_entry', data: { ids: ['breakdown'] } });
    // The compiler refuses it on its own too (one form per meaning: every record's label is a name).
    expect(compile(JSON.parse(risky('')) as CanonicalModelT, { sourceText: BRIEF }).errors.map((e) => [e.code, e.items])).toContainEqual(['label', ['breakdown']]);
    // A note with no words: the card's contract refuses it (it has no label for the compiler to check).
    expect(await propose(savedWith((d) => { d.claims.push({ id: 'blank', text: '', concerns: [], author: 'olumi', quote: null, ...at }); })))
      .toMatchObject({ status: 'refused', reason: 'invalid_change_entry', data: { ids: ['blank'] } });
    expect(registered).toHaveLength(1);
    // Contrast: the same risk with its name is proposed, and on the card.
    const named = await propose(risky('The oven breaks down'));
    expect(named.status, JSON.stringify(named)).toBe('ok');
    expect(named.data.changes.find((c: Json) => c.id === 'breakdown')).toEqual({ id: 'breakdown', kind: 'risk', action: 'add', label: 'The oven breaks down', before: null,
      after: 'with a chance of "breakdown chance" 0.05–0.2, adding "lost loaves" -150–-50 loaf/week to "sales", from the start', author: 'olumi' });
  });

  it('simplify v1 (A3): a typed card edit builds its postimage from its exact target and value with NO AI call, through the same validator: the change on its reply and in history', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    sent.length = 0;
    const before = persisted!.living_model.canonical as CanonicalModelT;
    const r = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'base_sales' }, value: 320, operation_key: randomUUID() });
    expect(r).toMatchObject({ status: 'saved' });
    expect(sent).toHaveLength(0);
    expect(r.changes).toEqual([{ id: 'base_sales', kind: 'quantity', action: 'change', label: 'base sales', before: '300 loaf/week, in your words "We bake 300 loaves a week"',
      after: '320 loaf/week, in your words "base sales: 320 loaf/week"', author: 'person' }]);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.history.at(-1)).toEqual({ id: 'base_sales', change: 'superseded', old: JSON.stringify(before.quantities.find((x) => x.id === 'base_sales')), quote: 'base sales: 320 loaf/week', author_id: null });
    expect(after.quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: 320, author: 'person', quote: 'base sales: 320 loaf/week', approval: 'approved', status: 'known' });
    // Through the route, a goal's target typed on its card: saved, still no AI call.
    const t = await turn({ kind: 'system_event', event: { kind: 'goal_target_edit', goal_node_id: 'more_loaves', constraint_type: 'at_least', raw_value: 400, unit: 'loaf/week', base_graph_hash: hashOf(persisted) } });
    expect(t.statusCode, t.body).toBe(200);
    expect(sent).toHaveLength(0);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'sales_target')).toMatchObject({ value: 400, author: 'person' });
  });

  it('an UNREADABLE program (it claims model_program but is not v1) is refused with its way on: never run as legacy or as no model', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    persisted = { ...persisted!, living_model: { ...persisted!.living_model, model_program: 'v9' } };
    const saves = registered.length;
    sent.length = 0;
    const r = await turn({ message: 'What is the chance now?' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'MODEL_PROGRAM_UNREADABLE', nothing_saved: true });
    expect(r.json().error.message).toContain('Nothing was changed. You can start a new scenario from your brief');
    const edit = await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'base_sales', value: 320 } });
    expect([edit.statusCode, edit.json().error.code]).toEqual([409, 'MODEL_PROGRAM_UNREADABLE']);
    expect([sent.length, registered.length]).toEqual([0, saves]);
    // The store reads it as unreadable, never as a program and never as none.
    expect(programReadOf(persisted).kind).toBe('unreadable');
    expect(programReadOf({ ...persisted, living_model: { ...persisted!.living_model, model_program: 'v1', canonical: { version: 'canonical.v1' } } }).kind).toBe('unreadable');
    expect(programReadOf({ nodes: [], edges: [], living_model: { aims: [] } }).kind).toBe('none'); // contrast: a legacy living model
  });

  it('an approximate answer ("about £2,500") is the person\'s figure, used for now: the words say so and the AI asks for its range (no code question); their own range is their range', () => {
    const words = 'It would cost about £2,500.';
    const answered = (f: Partial<CanonicalQuantityT>) => { const m = bakery(); setQ(m, 'oven_price', { status: 'known', question: null, approval: 'approved', ...f }); return m; };
    const approx = answered({ value: 2500, quote: words, basis: APPROXIMATE_FIGURE });
    const r = compile(approx, { sourceText: `${BRIEF}\n${words}` });
    // S1 A4: no question of the code's, and nothing waits on it; the AI asks for the range (the program instructions say so).
    expect(r.blockers.some((b) => b.id === 'oven_price')).toBe(false);
    expect(JSON.stringify(r)).not.toContain('What range would you put on it');
    expect(CORE_ALIGNED_INSTRUCTIONS).toContain('If that figure feeds a goal or a limit, ask what range they would put on it.');
    expect(r.within_limits.status).toBe('calculable'); // the range asked for holds nothing back
    expect(r.conversions.some((c) => c.quantity === 'oven_price')).toBe(false);
    const view = evaluateCanonical(approx, { sourceText: `${BRIEF}\n${words}`, seed: 7 }).view as Json;
    expect(JSON.stringify(view)).toContain('using £2,500 / oven for ‘oven price’ for now — you said ‘It would cost about £2,500.’');
    expect(JSON.stringify(view)).not.toContain('your range');
    expect(JSON.stringify(view)).not.toContain('as you stated it');
    // Contrast: the ends in their own words are their range, read as theirs, and no range is asked for.
    const ranged = answered({ value: null, low: 2250, high: 2750, range_kind: 'bounds', quote: 'between £2,250 and £2,750' });
    expect(compile(ranged, { sourceText: `${BRIEF}\nbetween £2,250 and £2,750` }).blockers.some((b) => b.id === 'oven_price')).toBe(false);
  });

  it('the agent\'s context after a cold reopen is the model AS AUTHORED: relations, coefficient basis and range kind, goal windows, option timing, the qualitative records, and the Run\'s goal_chance unchanged', async () => {
    const brief = `${CLUB_BRIEF} Sam thinks promotions never last.`;
    const m = club();
    m.dissent = [{ id: 'sam_doubts', holder: 'Sam', position: 'Promotions never last.', concerns: ['promotion'], author: 'person', party: null, quote: 'Sam thinks promotions never last', approval: 'proposed', author_id: null }];
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    vi.resetModules();
    const tools = await import('../program-tools.js');
    const read = await tools.readProgramContext({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null }) as Json;
    expect(read.status).toBe('ok');
    const model = read.data.model as Json;
    expect(model.relations).toEqual(JSON.parse(JSON.stringify(m.relations, (_k, v) => (v === null ? undefined : v))));
    expect(model.relations[0].terms[0]).toEqual({ driver: 'promo_on', coefficient: 'promo_effect', author: 'olumi', approval: 'proposed' });
    expect(model.quantities.find((x: Json) => x.id === 'promo_effect')).toMatchObject({ kind: 'coefficient', author: 'olumi', low: 3, high: 7, range_kind: 'plausible',
      basis: 'Promotions at clubs this size bring a few extra joins a month.' });
    expect(model.goals[0].measure).toMatchObject({ frame: 'level', aggregation: 'end', window: { start: 0, periods: 'months' } });
    expect(model.options[0].sets.map((x: Json) => x.starts_after_periods)).toEqual([0, 0]);
    expect(model.dissent).toEqual([{ id: 'sam_doubts', holder: 'Sam', position: 'Promotions never last.', concerns: ['promotion'], author: 'person', quote: 'Sam thinks promotions never last', approval: 'proposed' }]);
    expect(JSON.stringify(model)).not.toContain(':null');
    // The Run's goal_chance block, as stored.
    const stored = persisted!.living_model.runs[0].result.canonical_analysis_view as Json;
    expect(stableStringify(read.data.run.goal_chance)).toBe(stableStringify(stored.goal_chance));
  });

  it('buddy #3709 r7: a first draft is saved, receipted and read back AS THE COMPILER READ IT — a structure figure no one stated is their question, never known/structure/12', async () => {
    const m = bakery();
    m.quantities.push(q('current_output', 'loaf/week', { author: 'structure', value: 12 }), q('extra', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
    m.relations.push({ form: 'definition', id: 'extra_rel', defines: 'extra', op: 'sum', parts: [{ id: 'current_output', sign: 1 }], author: 'olumi', quote: null, ...at });
    // AIE §5 AMEND (DL 24 Oct): read as theirs, it waits on them with no question, so a FIRST draft is refused and repaired:
    // the AI gives the question. The code still writes no question of its own, and never keeps 12 as known or structure.
    const repaired = JSON.parse(JSON.stringify(m)) as CanonicalModelT;
    setQ(repaired, 'current_output', { author: 'person', status: 'asked', value: null, basis: null, quote: null, question: 'How many loaves a week does the oven make now?' });
    replies = [JSON.stringify(m), JSON.stringify(repaired)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    const first = r.model_program.draft.attempts[0].errors as Json[];
    expect(first.map((e) => [e.code, e.items])).toEqual([['asked_no_question', ['current_output']]]);
    expect(String(sent[1]!.input.at(-1).content)).toContain('"current output" (current_output) waits on the person but has no question.');
    const asked = { author: 'person', status: 'asked', value: null, question: 'How many loaves a week does the oven make now?', basis: null };
    expect(persisted!.living_model.canonical.quantities.find((x: Json) => x.id === 'current_output')).toMatchObject(asked);
    vi.resetModules();
    const tools = await import('../program-tools.js');
    const read = await tools.readProgramContext({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null }) as Json;
    expect((read.data.model as Json).quantities.find((x: Json) => x.id === 'current_output')).toMatchObject({ author: 'person', status: 'asked', question: 'How many loaves a week does the oven make now?' });
    expect((read.data.blockers as Json[]).find((b) => b.id === 'current_output')).toMatchObject({ code: 'asked' });
    expect(JSON.stringify(read.data)).not.toContain('What is "current output"?');
    expect(JSON.stringify(read.data.model)).not.toMatch(/"id":"current_output"[^}]*"author":"structure"/);
  });

  it('issue 40 (marketing-r1): a first draft whose repairs keep a structural 0 as a limit\'s floor is saved on the last attempt, the floor their ask, never refused whole', async () => {
    const m = bakery();
    m.quantities.push(q('spend_floor', 'GBP', { author: 'structure', value: 0, basis: 'Nothing spent yet.' }));
    m.limits.push({ ...m.limits[0]!, id: 'floor', label: 'Spend no less than the floor', measure: { ...m.limits[0]!.measure!, cmp: '>=', bound: 'spend_floor' } });
    // The drafter follows each repair's hint (structure, known, one exact figure), so every attempt returns the same draft.
    replies = [JSON.stringify(m), JSON.stringify(m), JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    const attempts = (r.model_program.draft.attempts as Json[]).map((a) => (a.errors as Json[]).map((e) => [e.code, e.items]));
    // The earlier attempts still need its question; the last falls back to the base behaviour (an ask is a typed blocker).
    expect(attempts).toEqual([[['asked_no_question', ['spend_floor']]], [['asked_no_question', ['spend_floor']]], []]);
    expect(sent).toHaveLength(3);
    expect(r.model_program.saved).toBe(true);
    expect(persisted!.living_model.canonical.quantities.find((x: Json) => x.id === 'spend_floor')).toMatchObject({ author: 'person', status: 'asked', value: null, question: null });
  });

  it('several goals: each goal\'s own chance and the joint ride the Run\'s goal_chance unchanged through read, propose, apply and run', async () => {
    const brief = `${CLUB_BRIEF} And keep at least 320 members.`;
    const m = club();
    m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members' }));
    m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    const goalChance = () => (persisted!.living_model.runs.at(-1).result.canonical_analysis_view as Json).goal_chance;
    expect(goalChance().targets.per_target).toHaveLength(2);
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make it 11 leaving each month.'], user_turn_text: 'Make it 11 leaving each month.' };
    const read = await readProgramContext(deps, ctx) as Json;
    expect(stableStringify(read.data.run.goal_chance)).toBe(stableStringify(goalChance()));
    replies = [savedWith((m) => setQ(m, 'leavers', { value: 11, quote: '11 leaving each month' }))];
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Leavers 11', basis: 'they said so', request: 'Leavers are 11 a month.', remove: [] }) as Json;
    const frozen = (deps.proposals.get(p.data.proposal_id)!.living_model as Json).runs.at(-1).result.canonical_analysis_view.goal_chance;
    expect(stableStringify(p.data.would_show.goal_chance)).toBe(stableStringify(frozen));
    const a = await applyProgramChange(deps, ctx, p.data.proposal_id) as Json;
    expect(stableStringify(a.data.run.goal_chance)).toBe(stableStringify(goalChance()));
    const run = await runProgram(deps, ctx) as Json;
    expect([run.data.stored, stableStringify(run.data.run.goal_chance)]).toEqual([true, stableStringify(goalChance())]);
  });

  it('an open question on how to read a range is answered through the same update path: only its reading changes; its ends, words and author stay; their answer is kept', async () => {
    const brief = `${BRIEF} Each extra oven brings between 80 and 120 loaves a week.`;
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, value: null, low: 80, high: 120, range_kind: null, quote: 'between 80 and 120 loaves a week' } : x));
    replies = [JSON.stringify(m)];
    const drafted = (await turn({ message: brief })).json();
    expect(drafted.model_program.blockers.find((x: Json) => x.id === 'extra_per_oven')).toMatchObject({ code: 'range_kind' });
    const words = 'Those are firm ends: never fewer than 80, never more than 120.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    replies = [savedWith((d) => setQ(d, 'extra_per_oven', { range_kind: 'bounds' }))];
    // The args as the agent's tool schema admits them (the SDK parses every call with it).
    const p = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Read 80–120 as firm', basis: 'their answer', request: 'Their 80 to 120 are firm ends.', remove: [] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes).toEqual([{ id: 'extra_per_oven', kind: 'quantity', action: 'change', label: 'extra per oven', before: 'from 80 to 120 loaf/week/oven',
      after: 'from 80 to 120 loaf/week/oven (firm ends)', author: 'person' }]);
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = (persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'extra_per_oven')!;
    expect(after).toMatchObject({ low: 80, high: 120, range_kind: 'bounds', author: 'person', quote: 'between 80 and 120 loaves a week' });
    expect((persisted!.living_model.canonical as CanonicalModelT).history.at(-1)).toMatchObject({ id: 'extra_per_oven', change: 'superseded' });
    expect(persisted!.living_model.person_words.at(-1)).toBe(words);
    const blockers = (persisted!.living_model.runs.at(-1).result.compile as Json).blockers as Json[];
    expect(blockers.some((x) => x.id === 'extra_per_oven')).toBe(false);
  });

  it('Codex r1 #3709 (2): the PRESENTED Run never says "on your figures" for a figure said to be theirs whose words were not found', () => {
    // The club with the promotion's effect given as the person's own figure (5 a month): on their words it is theirs; with
    // words that are not in what they wrote it is listed as not found, in the Run's own sentence, never "on your figures".
    const m = club();
    m.quantities = m.quantities.map((x) => (x.id === 'promo_effect' ? { ...x, status: 'known', author: 'person', low: null, high: null, range_kind: null, basis: null, quote: 'five extra joins a month' } : x));
    // The joins relation and its term are the person's too, so every other input is theirs.
    m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, author: 'person', quote: '20 join each month', terms: r.terms.map((t) => ({ ...t, author: 'person', quote: 'Run a promotion' })) } : r));
    const face = (sourceText: string) => ((evaluateCanonical(m, { sourceText, seed: 7 }).view as Json).options as Json[]).find((o) => o.option_id === 'promotion')!.cell.face as string;
    expect(face(`${CLUB_BRIEF} The promotion brings five extra joins a month.`)).toContain(', in this model, on your figures');
    const unverified = face(CLUB_BRIEF);
    expect(unverified).not.toContain('on your figures');
    expect(unverified).toContain('‘promo effect’ is 5 member / month / promotion (not found in your words)');
  });

  it('DL 23 Oct (batch 1 + batch 4) + S4 class 5: an aim with no window says how it is read (with each option in effect), never a missing deadline the compiler does not list; a % target is said in %', () => {
    const goalWords = (m: CanonicalModelT, text: string) => String(((evaluateCanonical(m, { sourceText: text, seed: 7 }).view as Json).goal_chance as Json).chance_words);
    // The bakery's aim states no window: read once with every option in effect, and said so.
    const noDeadline = goalWords(bakery(), BRIEF);
    expect(noDeadline).toContain('‘sales’ being at least 380 loaf / week with each option in effect');
    expect(noDeadline).not.toMatch(/deadline/);
    // The compiler lists no deadline for it (a static level), so nothing on the result says one is missing.
    expect(evaluateCanonical(bakery(), { sourceText: BRIEF, seed: 7 }).compiled.blockers.filter((b) => b.code === 'deadline')).toEqual([]);
    expect(JSON.stringify(((evaluateCanonical(bakery(), { sourceText: BRIEF, seed: 7 }).view as Json).goal_chance as Json).notes)).not.toContain('is there one?');
    expect(noDeadline).not.toMatch(/from now/);
    // Contrast: the club's aim states three months, and says it.
    expect(goalWords(club(), CLUB_BRIEF)).toContain('at 3 months from now');
    // "Grow sales by 10%": the target is said as 10%, never as the compiler's 0.1.
    const rel = bakery();
    rel.quantities.push(q('growth', '%', { value: 10, quote: 'grow sales by 10%' }));
    rel.goals = [{ ...rel.goals[0]!, measure: { ...rel.goals[0]!.measure!, target: 'growth', frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } }];
    const pct = goalWords(rel, `${BRIEF} We want to grow sales by 10%.`);
    expect(pct).toContain('at least 10%');
    expect(pct).not.toMatch(/\b0\.1\b/);
  });

  it('an aim with no measure gets the one the person states, through the same update path: its target and window in their words, on the card; the chance appears', async () => {
    const m = bakery();
    m.goals = [{ ...m.goals[0]!, measure: null, question: 'How would you know the bakery is doing well enough?' }];
    replies = [JSON.stringify(m)];
    const drafted = (await turn({ message: BRIEF })).json();
    expect(drafted.model_program.saved).toBe(true);
    expect((persisted!.living_model.runs.at(-1).result.compile as Json).blockers).toContainEqual({ id: 'more_loaves', code: 'measure', scope: ['more_loaves'] });
    const words = 'Success means selling at least 380 loaves a week within 4 weeks.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    const measured = (targetQuote: string) => savedWith((d) => {
      d.quantities.push(q('more_loaves_target', 'loaf/week', { value: 380, quote: targetQuote }), q('more_loaves_window', 'week', { value: 4, quote: words }));
      d.goals = d.goals.map((g) => (g.id === 'more_loaves' ? { ...g, question: null, measure: { quantity: 'sales', per: null, cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null,
        aggregation: 'end', window: { origin_event: null, origin_offset: null, start: 0, periods: 'more_loaves_window' }, measure_by: 'person', assumptions: [], exclusions: [] } } : g));
    });
    const propose = (c = ctx()) => proposeProgramChange(deps, c, ProgramChangeParams.parse({ public_label: 'Measure the aim', basis: 'their answer',
      request: 'The aim is measured by sales: at least 380 loaves a week, within 4 weeks.', remove: [] })) as Promise<Json>;
    // Negative first: a figure of theirs under words they did not write is refused, and nothing is proposed.
    replies = [measured('at least 400 loaves a week')];
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['more_loaves_target'] } });
    replies = [measured(words)];
    const c = ctx();
    const p = await propose(c);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes.map((x: Json) => [x.id, x.kind, x.action, x.before, x.after, x.author])).toEqual([
      ['more_loaves_target', 'quantity', 'add', null, `380 loaf/week, a fact, known, in your words "${words}"`, 'person'],
      ['more_loaves_window', 'quantity', 'add', null, `4 week, a fact, known, in your words "${words}"`, 'person'],
      ['more_loaves', 'goal', 'change', 'no measure yet, Olumi asks "How would you know the bakery is doing well enough?"',
        '"sales" at least "more loaves target" 380 loaf/week, by the end of "more loaves window" 4 week, the measure you named, no question', 'person'],
    ]);
    expect(await applyProgramChange(deps, c, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.goals[0]).toMatchObject({ measure: { quantity: 'sales', cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null,
      window: { start: 0, periods: 'more_loaves_window' }, measure_by: 'person' }, question: null, approval: 'approved' });
    expect(after.history.at(-1)).toMatchObject({ id: 'more_loaves', change: 'superseded' });
    // The new Run can now work out the aim: each option's chance of it is shown, and the measure question is gone.
    const run = persisted!.living_model.runs.at(-1).result as Json;
    expect((run.canonical_analysis_view as Json).options.map((o: Json) => o.cell.kind)).toEqual(['figure', 'figure']);
    expect(((run.compile as Json).blockers as Json[]).filter((x) => x.code === 'measure')).toEqual([]);
    // The compiler's own reading of a measure with an unstated target, or one nothing works out yet (built exactly).
    const asked = JSON.parse(measured(words)) as CanonicalModelT;
    setQ(asked, 'more_loaves_target', { status: 'asked', value: null, quote: null, question: 'What figure for "sales" would count as "Reach 380 loaves a week"?' });
    expect(compile(asked, { sourceText: `${BRIEF}\n${words}` }).blockers.map((x) => x.id)).toContain('more_loaves_target');
    const named = JSON.parse(measured(words)) as CanonicalModelT;
    named.quantities.push(q('repeat_customers', 'customer/week', { status: 'unknown', quote: 'at least 50 repeat customers a week', label: 'Repeat customers' }));
    named.goals = named.goals.map((g) => ({ ...g, measure: { ...g.measure!, quantity: 'repeat_customers' } }));
    setQ(named, 'more_loaves_target', { unit: 'customer/week', value: 50, quote: 'at least 50 repeat customers a week' });
    expect(compile(named, { sourceText: `${BRIEF}\nat least 50 repeat customers a week` }).perGoal[0]).toMatchObject({ status: 'withheld' });
  });

  it('DL 23 Oct (batch 4 marketing-r2): what a measure leaves out is kept in their words and named; the chance says what it covers and what it leaves out, never that it covers everything', () => {
    const words = 'Success means selling at least 380 loaves a week and 50 new regulars within 4 weeks.';
    // The measured aim exactly as an approved update writes it: their target and window, and the parts it leaves out.
    const measured = (leaves: string[], window: boolean, quote = words): CanonicalModelT => {
      const m = bakery();
      m.quantities.push(q('more_loaves_target', 'loaf/week', { value: 380, quote }), ...(window ? [q('more_loaves_window', 'week', { value: 4, quote })] : []));
      const notes = leaves.map((w, i) => ({ id: `more_loaves_leaves_out${i === 0 ? '' : `_${i + 1}`}`, text: w, why: 'It is part of the aim they stated, but it has no measure yet, so the chance does not cover it.',
        question: `How would you measure "${w}"?`, concerns: ['more_loaves'], author: 'person' as const, party: null, quote: w, approval: 'approved' as const, author_id: null }));
      m.left_out.push(...notes);
      m.goals = [{ ...m.goals[0]!, question: null, measure: { quantity: 'sales', per: null, cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null, aggregation: 'end',
        window: window ? { origin_event: null, origin_offset: null, start: 0, periods: 'more_loaves_window' } : null, measure_by: 'person', assumptions: [], exclusions: notes.map((n) => n.id) } }];
      return m;
    };
    const goalChance = (model: CanonicalModelT, text = words) => (evaluateCanonical(model, { sourceText: `${BRIEF}\n${text}`, seed: 7 }).view as Json).goal_chance as Json;
    expect((goalChance(measured(['50 new regulars'], true)).notes as string[]).some((n) => /^Covers: ‘sales’ being at least 380 loaf \/ week .* · Leaves out: ‘50 new regulars’$/.test(n))).toBe(true);
    // A deadline they stated that the model cannot hold yet is named as left out, and never asked for again.
    const ln = goalChance(measured(['50 new regulars', 'within 4 weeks'], false)).notes as string[];
    expect(ln.some((n) => n.endsWith('Leaves out: ‘50 new regulars’ and ‘within 4 weeks’'))).toBe(true);
    expect(ln.some((n) => n.includes('is there one?'))).toBe(false);
    // Codex r7: an equal figure is never read as covered. "380 new regulars" beside a 380 target is not claimed: the chance
    // names only the measured target it uses, and says nothing about what it does not hold.
    const same = 'Success means selling at least 380 loaves a week and 380 new regulars within 4 weeks.';
    const gc = goalChance(measured([], true, same), same);
    expect(JSON.stringify(gc)).not.toContain('regulars');
    expect((gc.notes as string[]).some((n) => n.startsWith('Covers:'))).toBe(false);
  });

  it('targeted answers (DL 24 Oct): an answer to a listed question is set on the existing item it answers, exactly, with no redraft: one item changes and every other record is byte-identical; "all" is read as 100% with Olumi\'s reading shown; "I don\'t know" is theirs and never asked again; a structural change still uses the redraft', async () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    replies = [JSON.stringify(saved.canonical)];
    expect((await turn({ message: saved.brief })).json().model_program.saved).toBe(true);
    // The saved model as the tools read it (a read parses it, so its keys are in the schema's order on every path).
    const read = programReadOf(persisted!);
    const before = (read.kind === 'program' ? read.program.canonical : null)!;
    const deps = { dispatch, proposals: new ProposalStore() };
    const ask = (words: string, answers: Json[], extra: Partial<{ request: string; remove: string[] }> = {}) => {
      sent.length = 0;
      return proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request: '', remove: [], answers, ...extra })) as Promise<Json>;
    };
    const answer = (f: Json) => ({ value: null, low: null, high: null, range_kind: null, party: null, quote: null, basis: null, author: 'person', ...f });
    // The held program exactly as the card will write it (its raw bytes; a parse would reorder keys).
    const heldOf = (p: Json) => deps.proposals.get(p.data.proposal_id)!.living_model as { canonical: CanonicalModelT; runs: Json[] };
    // Every record but the answered one, each as its own bytes (the model's top-level key order is not a record's).
    const others = (m: CanonicalModelT, id: string) => (['quantities', 'relations', 'goals', 'limits', 'preferences', 'options', 'risks', 'claims', 'evidence', 'assumptions',
      'dissent', 'conditions', 'left_out'] as const).flatMap((f) => (m[f] as readonly { id: string }[]).filter((r) => r.id !== id).map((r) => `${f}:${JSON.stringify(r)}`));
    // (1) The hiring cost answer: ONE item changes, as theirs in their words; every other record is the saved one, byte for
    // byte (positive control: the records compared); no drafter call.
    const cost = await ask('About £45,000 per developer, all in.', [answer({ id: 'developer_hiring_cost', status: 'known', value: 45000, quote: 'About £45,000 per developer, all in.' })]);
    expect(cost.status, JSON.stringify(cost)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(cost.data.changes.map((c: Json) => [c.id, c.action, c.author])).toEqual([['developer_hiring_cost', 'change', 'person']]);
    const held = heldOf(cost).canonical;
    expect(others(held, 'developer_hiring_cost')).toEqual(others(before, 'developer_hiring_cost'));
    expect(others(before, 'developer_hiring_cost').length).toBeGreaterThan(20);
    expect(held.quantities.find((x) => x.id === 'developer_hiring_cost')).toMatchObject({ status: 'known', value: 45000, low: null, high: null, author: 'person',
      quote: 'About £45,000 per developer, all in.', question: null, unit: 'GBP/developer' });
    // (2) "I don't know": theirs, quoted, not known, with what would size it; never asked again as a number.
    const dunno = await ask('I don\'t know what a Tech lead would cost yet.', [answer({ id: 'tech_lead_hiring_cost', status: 'unknown', value: 99,
      quote: 'I don\'t know what a Tech lead would cost yet.', basis: 'A recruiter\'s quote for a Tech lead would size it.' })]);
    expect(dunno.status, JSON.stringify(dunno)).toBe('ok');
    expect(sent).toHaveLength(0);
    const unknown = heldOf(dunno);
    expect(unknown.canonical.quantities.find((x) => x.id === 'tech_lead_hiring_cost')).toMatchObject({ status: 'unknown', value: null, author: 'person',
      quote: 'I don\'t know what a Tech lead would cost yet.', basis: 'A recruiter\'s quote for a Tech lead would size it.', question: null });
    expect(((unknown.runs.at(-1)!.result as Json).compile.blockers as Json[]).filter((b) => b.id === 'tech_lead_hiring_cost' && b.code === 'asked')).toEqual([]);
    expect(dunno.data.changes[0].after).toContain('in your words "I don\'t know what a Tech lead would cost yet."');
    // Their "I don't know" is theirs only in THIS turn's words (buddy 24 Oct): quoting their brief instead is refused, by id.
    expect(await ask('No idea yet.', [answer({ id: 'tech_lead_hiring_cost', status: 'unknown', quote: saved.brief.slice(0, 40), basis: 'A recruiter\'s quote would size it.' })]))
      .toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['tech_lead_hiring_cost'] } });
    // A range's reading is theirs to give (buddy 24 Oct): one their words declare is kept exactly; one they do not stays null,
    // honestly unresolved, and the Run asks how to read it.
    const firm = await ask('Firmly between £40,000 and £50,000.', [answer({ id: 'developer_hiring_cost', status: 'known', low: 40000, high: 50000, range_kind: 'bounds', quote: 'Firmly between £40,000 and £50,000.' })]);
    expect(heldOf(firm).canonical.quantities.find((x) => x.id === 'developer_hiring_cost')).toMatchObject({ low: 40000, high: 50000, range_kind: 'bounds' });
    const open = await ask('Between £40,000 and £50,000.', [answer({ id: 'developer_hiring_cost', status: 'known', low: 40000, high: 50000, quote: 'Between £40,000 and £50,000.' })]);
    expect(open.status, JSON.stringify(open)).toBe('ok');
    expect(heldOf(open).canonical.quantities.find((x) => x.id === 'developer_hiring_cost')).toMatchObject({ low: 40000, high: 50000, range_kind: null });
    expect(((heldOf(open).runs.at(-1)!.result as Json).compile.blockers as Json[]).filter((b) => b.id === 'developer_hiring_cost').map((b) => b.code)).toEqual(['range_kind']);
    // Codex r1 #3727: THIS turn's words only. An earlier message of theirs (verified, but not this turn's) is refused, and so is
    // an answer that changes only its basis while quoting their brief.
    const earlier = 'About £45,000 per developer, all in.';
    expect(await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [earlier, 'Yes, go ahead.'],
      user_turn_text: 'Yes, go ahead.' }, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request: '', remove: [],
      answers: [answer({ id: 'developer_hiring_cost', status: 'known', value: 45000, quote: earlier })] }))).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['developer_hiring_cost'] } });
    // Basis-only: their "I don't know" saved first, so the next answer changes nothing but its basis (and quotes their brief).
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, dunno.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'tech_lead_hiring_cost')).toMatchObject({ status: 'unknown', value: null, low: null, high: null });
    expect(await ask('Still no idea.', [answer({ id: 'tech_lead_hiring_cost', status: 'unknown', quote: saved.brief.slice(0, 40), basis: 'Another basis.' })]))
      .toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['tech_lead_hiring_cost'] } });
    // Refused, by construction: an answer to an item the model does not hold (it never creates one); no drafter call.
    expect(await ask('Unassigned costs are £10,000.', [answer({ id: 'unassigned_first_year_cost', status: 'known', value: 10000, quote: 'Unassigned costs are £10,000.' })]))
      .toMatchObject({ status: 'refused', reason: 'not_an_answer' });
    expect(sent).toHaveLength(0);
    // On the redraft path too (buddy 24 Oct): a person's figure whose status the drafter changes needs their words this turn.
    replies = [savedWith((d) => setQ(d, 'developer_hiring_cost', { status: 'unknown', question: null, quote: saved.brief.slice(0, 40), basis: 'They do not know it yet.' }))];
    expect(await ask('They do not know it.', [], { request: 'Mark the developer cost as not known yet.' })).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['developer_hiring_cost'] } });
    expect(sent).toHaveLength(1);
    // A structural change still goes to Olumi's drafter: one call, the whole model.
    replies = [savedWith((d) => { d.options.push({ ...d.options[0]!, id: 'contractor', label: 'Hire a contractor', sets: [], quote: 'a contractor option' }); })];
    const structural = await ask('Also add a contractor option.', [], { request: 'Add a contractor option.' });
    expect(structural.status, JSON.stringify(structural)).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  it('targeted answers: "all" of a share is read as 100%, their words kept as theirs and Olumi\'s reading shown on the card before anything is saved', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    sent.length = 0;
    const words = 'All of the new loaves sell.';
    const p = await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'Sell-through 100%', basis: 'their answer', request: '', remove: [], answers: [{ id: 'sell_through', status: 'known', value: 1,
        low: null, high: null, range_kind: null, party: null, quote: 'All of the new loaves sell', basis: 'Olumi reads “all” as 100%.', author: 'person' }] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(p.data.changes).toEqual([{ id: 'sell_through', kind: 'quantity', action: 'change', label: 'sell through', before: 'from 0.5 to 0.9, most likely 0.7 (a plausible range), an estimate, based on "New capacity sells only as far as demand grows.", Olumi’s, not in your words',
      after: '1, known, based on "Olumi reads “all” as 100%.", yours, in your words "All of the new loaves sell"', author: 'person' }]);
  });

  it('targeted answers with a structural change in ONE call (DoD 24 Oct, marketing: refusing the pair dropped their goals): ONE card holds the answers, set exactly, and Olumi\'s drafter writes the change on the model that holds them', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'The oven costs £2,500. We also want to reach 400 loaves a week.';
    const price = { status: 'known', value: 2500, question: null, author: 'person', quote: 'The oven costs £2,500' } as const;
    // The drafter's reply: the model it was given (the answer in it), with the new goal and its target.
    replies = [savedWith((d) => {
      setQ(d, 'oven_price', price);
      d.quantities.push(q('stretch_target', 'loaf/week', { value: 400, quote: 'reach 400 loaves a week' }));
      d.goals.push({ ...d.goals[0]!, id: 'stretch', label: 'Reach 400 loaves a week', measure: { ...d.goals[0]!.measure!, target: 'stretch_target' }, quote: 'reach 400 loaves a week' });
    })];
    sent.length = 0;
    const p = await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'Oven price and a second goal', basis: 'their answer and their goal', request: 'Add a second goal: reach 400 loaves a week.', remove: [],
        answers: [{ id: 'oven_price', status: 'known', author: 'person', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven costs £2,500', basis: null }] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    // ONE drafter call, given the model WITH the answer set exactly: nothing they said is lost to the redraft.
    expect(sent).toHaveLength(1);
    const given = JSON.parse(String((sent[0]!.input as Json[])[1]!.content)) as CanonicalModelT;
    expect(given.quantities.find((x) => x.id === 'oven_price')).toMatchObject(price);
    // ONE card with every change: their figure, the new target and the new goal.
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.author]).sort()).toEqual([['oven_price', 'change', 'person'], ['stretch', 'add', 'person'], ['stretch_target', 'add', 'person']]);
    const held = (deps.proposals.get(p.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical;
    expect(held.quantities.find((x) => x.id === 'oven_price')).toMatchObject(price);
    expect(held.goals.map((g) => g.id)).toEqual(['more_loaves', 'stretch']);
    // The answers win by construction, not by the drafter keeping them (buddy 24 Oct). A drafter that writes another figure on
    // the item they answered: the card holds THEIR figure, words and authorship.
    const mixed = (reply: string) => {
      replies = [reply]; sent.length = 0;
      return proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        ProgramChangeParams.parse({ public_label: 'Oven price and a second goal', basis: 'their answer and their goal', request: 'Add a second goal: reach 400 loaves a week.', remove: [],
          answers: [{ id: 'oven_price', status: 'known', author: 'person', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven costs £2,500', basis: null }] })) as Promise<Json>;
    };
    // Codex r1 #3729, the adverse drafter: it returns the saved (unanswered) oven figure plus the new goal.
    const dropped = await mixed(savedWith((d) => {
      d.quantities.push(q('stretch_target', 'loaf/week', { value: 400, quote: 'reach 400 loaves a week' }));
      d.goals.push({ ...d.goals[0]!, id: 'stretch', label: 'Reach 400 loaves a week', measure: { ...d.goals[0]!.measure!, target: 'stretch_target' }, quote: 'reach 400 loaves a week' });
    }));
    expect(dropped.status, JSON.stringify(dropped)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect((deps.proposals.get(dropped.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical.quantities.find((x) => x.id === 'oven_price'))
      .toMatchObject({ ...price, low: null, high: null, range_kind: null });
    expect(dropped.data.changes.map((c: Json) => [c.id, c.action, c.author]).sort()).toEqual([['oven_price', 'change', 'person'], ['stretch', 'add', 'person'], ['stretch_target', 'add', 'person']]);
    // And one that writes another figure on the item they answered.
    const overwritten = await mixed(savedWith((d) => {
      setQ(d, 'oven_price', { ...price, value: 3000 });
      d.quantities.push(q('stretch_target', 'loaf/week', { value: 400, quote: 'reach 400 loaves a week' }));
      d.goals.push({ ...d.goals[0]!, id: 'stretch', label: 'Reach 400 loaves a week', measure: { ...d.goals[0]!.measure!, target: 'stretch_target' }, quote: 'reach 400 loaves a week' });
    }));
    expect(overwritten.status, JSON.stringify(overwritten)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect((deps.proposals.get(overwritten.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical.quantities.find((x) => x.id === 'oven_price'))
      .toMatchObject({ ...price, low: null, high: null, range_kind: null });
    expect(overwritten.data.changes.find((c: Json) => c.id === 'oven_price')).toMatchObject({ action: 'change', author: 'person' });
    // A drafter that removes the item they answered: refused, the item named; their answer is never dropped silently.
    const removed = await mixed(savedWith((d) => {
      d.quantities = d.quantities.filter((x) => x.id !== 'oven_price');
      d.relations = d.relations.filter((r) => r.id !== 'spend_rel');
    }));
    expect(removed).toMatchObject({ status: 'refused', reason: 'not_an_answer', detail: '"oven price" (oven_price): the change removed what you answered, so nothing changed.', data: { ids: ['oven_price'] } });
  });

  it('issue 37 (marketing at 485ee1af, 3 of 5 runs): a figure of theirs said EXACTLY in another calendar unit (their 1 year as 12 month, the time step moved to month for a 3-month goal) is the same figure, so the goals are saved; any other change of its amount still needs their words this turn, and the refusal names the check and the id', async () => {
    const brief = `${BRIEF} The £3,000 is for 1 year.`;
    const m = bakery();
    m.period = 'year';
    m.quantities.push(q('budget_window', 'year', { value: 1, quote: 'The £3,000 is for 1 year' }));
    m.limits = m.limits.map((l) => ({ ...l, measure: { ...l.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'budget_window' } } }));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We want 340 loaves a week within the first 3 months.';
    // The drafter's whole updated model: their new goal with its 3-month window, so the time step is a month and their budget
    // window is said in months.
    const early = (window: Partial<CanonicalQuantityT>) => savedWith((d) => {
      d.period = 'month';
      setQ(d, 'budget_window', window);
      d.quantities.push(q('early_target', 'loaf/week', { value: 340, quote: 'We want 340 loaves a week' }), q('early_months', 'month', { value: 3, quote: 'within the first 3 months' }));
      d.goals.push({ ...d.goals[0]!, id: 'early_loaves', label: '340 loaves a week within 3 months', quote: words.slice(0, -1),
        measure: { ...d.goals[0]!.measure!, target: 'early_target', window: { origin_event: null, origin_offset: null, start: 0, periods: 'early_months' } } });
    });
    const propose = (reply: string) => { replies = [reply]; return proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words],
      user_turn_text: words }, ProgramChangeParams.parse({ public_label: 'An early goal', basis: 'their goal', request: 'Add their goal: 340 loaves a week within the first 3 months.', remove: [] })) as Promise<Json>; };
    // Refused, by check and id: their 1 year said as 1 month (only the unit changes, so the amount does), as 13 months, or as
    // 52 weeks (weeks in a year is an average, not exact); and their figure turned into a question.
    for (const moved of [{ unit: 'month' }, { unit: 'month', value: 13 }, { unit: 'week', value: 52 }, { unit: 'month', status: 'asked' as const, value: null, quote: null }]) {
      expect(await propose(early(moved)), JSON.stringify(moved)).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['budget_window'], check: 'this_turn' } });
    }
    // The same figure, said exactly in months: the card goes ahead and shows it, still theirs in their words.
    const p = await propose(early({ unit: 'month', value: 12 }));
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.author])).toEqual([['budget_window', 'change', 'person'], ['early_target', 'add', 'person'], ['early_months', 'add', 'person'],
      ['early_loaves', 'add', 'person'], ['period', 'change', 'olumi']]);
    expect(p.data.changes.find((c: Json) => c.id === 'budget_window')).toMatchObject({ before: '1 year', after: '12 month' });
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(saved.goals.map((g) => g.id)).toEqual(['more_loaves', 'early_loaves']);
    expect(saved.period).toBe('month');
    expect(saved.quantities.find((x) => x.id === 'budget_window')).toMatchObject({ unit: 'month', value: 12, low: null, high: null, status: 'known', author: 'person', quote: 'The £3,000 is for 1 year' });
    // The one validator, unit by unit: 1 week said as 7 day is the same figure; 13 weeks as 3 months is an average (weeks in a
    // month), so it is a change that needs their words this turn.
    const said = (from: Partial<CanonicalQuantityT>, to: Partial<CanonicalQuantityT>) => {
      const was = JSON.parse(JSON.stringify(saved)) as CanonicalModelT; setQ(was, 'budget_window', from);
      const now = JSON.parse(JSON.stringify(was)) as CanonicalModelT; setQ(now, 'budget_window', to);
      return validatePostimage(was, now, { removals: [], words: [brief, words], fresh: [words] });
    };
    expect(said({ unit: 'week', value: 1 }, { unit: 'day', value: 7 })).toMatchObject({ ok: true, changes: [{ id: 'budget_window', action: 'change', before: '1 week', after: '7 day' }] });
    expect(said({ unit: 'week', value: 13 }, { unit: 'month', value: 3 })).toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['budget_window'], check: 'this_turn' });
    // A range converts end by end: every one of value, low and high exactly, or it is a change (Codex BLOCK on #3739).
    const range = { unit: 'year', value: 1, low: 1, high: 2 };
    expect(said(range, { unit: 'month', value: 12, low: 12, high: 24 }).ok).toBe(true);
    expect(said({ ...range, value: null }, { unit: 'month', value: null, low: 12, high: 24 }).ok).toBe(true);
    for (const to of [{ value: 12, low: 12, high: 25 }, { value: 12, low: 11, high: 24 }, { value: 13, low: 12, high: 24 }, { value: 12, low: null, high: null }]) {
      expect(said(range, { unit: 'month', ...to }), JSON.stringify(to)).toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['budget_window'], check: 'this_turn' });
    }
    // Exact is the float product in the conversion's direction, nothing looser (Codex BLOCK ×2 on #3739): 1 year as 12 month and
    // 6 month as 0.5 year are the same figure; 10^15 years as 12×10^15 + 8 or + 100 months is not, as a value or as either end of
    // a range. Nor is 0.1 year as 1.2 month (0.1 × 12 is not 1.2 in binary): refusing it is the safe base behaviour, their
    // words this turn asked for as for any change of their figure.
    expect(said({ unit: 'year', value: 1 }, { unit: 'month', value: 12 }).ok).toBe(true);
    expect(said({ unit: 'month', value: 6 }, { unit: 'year', value: 0.5 }).ok).toBe(true);
    expect(0.1 * 12).not.toBe(1.2);
    expect(said({ unit: 'year', value: 0.1 }, { unit: 'month', value: 1.2 })).toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['budget_window'], check: 'this_turn' });
    for (const plus of [8, 100]) {
      for (const [from, to] of [[{ value: 1e15 }, { value: 12e15 + plus }], [{ value: null, low: 1e15, high: 2e15 }, { value: null, low: 12e15 + plus, high: 24e15 }],
        [{ value: null, low: 1e15, high: 2e15 }, { value: null, low: 12e15, high: 24e15 + plus }]] as const) {
        expect(said({ unit: 'year', ...from }, { unit: 'month', ...to }), JSON.stringify(to)).toMatchObject({ ok: false, code: 'unverified_person_words', ids: ['budget_window'], check: 'this_turn' });
        expect(said({ unit: 'year', ...from }, { unit: 'month', ...Object.fromEntries(Object.entries(from).map(([k, v]) => [k, v === null ? null : v * 12])) }).ok, `${JSON.stringify(from)} ×12`).toBe(true);
      }
    }
  });

  it('targeted answers: whose an answer is comes from what the AI declares, checked literally (Codex r1 #3727): Olumi\'s estimate stays Olumi\'s, ranged, never in their words; a mismatch is refused, never re-authored', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    sent.length = 0;
    const ask = (words: string, a: Json) => proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'An answer', basis: 'their question', request: '', remove: [], answers: [{ id: 'sell_through', value: null, party: null, quote: null, ...a }] })) as Promise<Json>;
    const estimate = { status: 'estimated', author: 'olumi', low: 0.6, high: 0.95, range_kind: 'plausible', basis: 'A busy high street sells most of what is baked.' };
    const p = await ask('Could you estimate how much of it would sell?', estimate);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(p.data.changes.map((c: Json) => [c.id, c.author])).toEqual([['sell_through', 'olumi']]);
    expect((deps.proposals.get(p.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical.quantities.find((x) => x.id === 'sell_through')).toMatchObject({ status: 'estimated', author: 'olumi',
      low: 0.6, high: 0.95, range_kind: 'plausible', quote: null, party: null, basis: 'A busy high street sells most of what is baked.' });
    // Refused, by id, and never re-authored: Olumi's estimate in their words, or without its range or basis; their answer
    // declared as an estimate; Olumi's declared as known.
    for (const bad of [{ ...estimate, quote: 'Could you estimate' }, { ...estimate, high: null }, { ...estimate, basis: ' ' },
      { ...estimate, author: 'person', quote: 'Could you estimate' }, { ...estimate, status: 'known' }]) {
      expect(await ask('Could you estimate how much of it would sell?', bad), JSON.stringify(bad)).toMatchObject({ status: 'refused', reason: 'not_an_answer', data: { ids: ['sell_through'] } });
    }
    expect(sent).toHaveLength(0);
  });

  it('the alpha3 hiring read, through the same update path: the measure they name gets Olumi\'s mechanism on ONE card that shows every change; a figure only they know is ASKED, then the chance appears', async () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    replies = [JSON.stringify(saved.canonical)];
    expect((await turn({ message: saved.brief })).json().model_program.saved).toBe(true);
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    expect(before.goals.find((g) => g.id === 'increase_productivity')!.measure).toBeNull(); // costs-only: the aim has no measure
    const words = 'We measure productivity by the features we ship each month.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    // Each attempt is its own turn (a turn shows one card).
    const propose = () => proposeProgramChange(deps, { ...ctx, turn_id: randomUUID() }, ProgramChangeParams.parse({ public_label: 'Measure productivity', basis: 'their answer',
      request: 'Productivity is measured by the features shipped each month; work that out from the hires.', remove: [] })) as Promise<Json>;
    // The drafter's whole updated model: their measure on the aim, and what works it out (synthetic Olumi figures, never a test sheet's).
    const completed = (edit: (m: CanonicalModelT) => void = () => undefined): string => {
      const m = JSON.parse(JSON.stringify(before)) as CanonicalModelT;
      m.quantities.push(q('features_shipped_per_month', 'feature/month', { label: 'Features shipped per month', kind: 'derived', status: 'derived', quote: words }),
        q('features_now', 'feature/month', { status: 'asked', question: 'How many features does the team ship in a month now?' }),
        q('lead_effect', 'feature/month/tech_lead', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 2, low: 0, high: 4, range_kind: 'plausible', basis: 'A lead mostly unblocks others; the size varies widely.' }),
        q('developer_effect', 'feature/month/developer', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 1, low: 0.3, high: 1.5, range_kind: 'plausible', basis: 'A new developer adds less than an experienced one at first.' }));
      m.goals = m.goals.map((g) => (g.id === 'increase_productivity' ? { ...g, question: null, measure: { quantity: 'features_shipped_per_month', per: null, cmp: '>=', target: 'productivity_increase_target',
        frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null }, aggregation: 'end', window: { origin_event: null, origin_offset: null, start: 0, periods: 'launch_horizon' },
        measure_by: 'person', assumptions: [], exclusions: [] } } : g));
      m.relations.push({ form: 'effect', id: 'features_rel', defines: 'features_shipped_per_month', base: 'features_now', author: 'olumi', quote: null, ...at,
        terms: [{ driver: 'tech_leads_hired', coefficient: 'lead_effect', author: 'olumi', quote: null, ...at }, { driver: 'developers_hired', coefficient: 'developer_effect', author: 'olumi', quote: null, ...at }] });
      m.claims.push({ id: 'leads_unblock', text: 'A lead mostly raises output by unblocking the others.', concerns: ['lead_effect'], author: 'olumi', quote: null, ...at },
        { id: 'lead_needs_scope', text: 'A lead helps most once the launch scope is clear.', concerns: ['features_rel'], author: 'olumi', quote: null, ...at });
      m.assumptions.push({ id: 'hires_productive_in_window', text: 'New hires are productive within the launch window.', applied: true, concerns: ['features_rel', 'leads_unblock'], author: 'olumi', quote: null, ...at });
      m.conditions.push({ id: 'scope_agreed_first', text: 'Only once the launch scope is agreed.', kind: 'prerequisite', concerns: ['lead_needs_scope'], author: 'olumi', quote: null, ...at });
      edit(m);
      return JSON.stringify(m);
    };
    const cardModel = (r: Json) => savedProgramOf({ living_model: deps.proposals.get(r.data.proposal_id)!.living_model })!.canonical;

    // Codex r4 #3709: the update is read as a first draft is. A figure labelled structure that is no structural constant
    // ("current output = 12", stated by no one) comes back as the person's question; a calendar conversion stays structural.
    replies = [completed((d) => { d.quantities.push(q('current_output', 'feature/month', { author: 'structure', value: 12 }), q('months_per_year', 'month/year', { author: 'structure', value: 12 }));
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'current_output'; })];
    const structured = await propose();
    expect(structured.status, JSON.stringify(structured)).toBe('ok');
    const sm = cardModel(structured);
    expect(sm.quantities.find((x) => x.id === 'current_output')).toMatchObject({ author: 'person', status: 'asked', value: null, quote: null, question: null, basis: null });
    expect(sm.quantities.find((x) => x.id === 'months_per_year')).toMatchObject({ author: 'structure', status: 'known', value: 12 });
    expect(compile(sm, { sourceText: `${saved.brief}\n${words}` }).perGoal.find((g) => g.goal_id === 'increase_productivity')!.asks).toContain('current_output');
    // Codex r5: 1 in unit "1" is no unit scale, so an unstated "current utilisation = 1" is not structural; 0/1 is, only as a
    // live option's switch; 100 % (a unit's scale) still is.
    const base = JSON.parse(completed()) as CanonicalModelT;
    expect(isStructuralConstant(base, q('current_utilisation', '1', { author: 'structure', value: 1 }))).toBe(false);
    expect(isStructuralConstant(base, q('tech_leads_hired', 'tech_lead', { author: 'structure', value: 1 }))).toBe(true);
    expect(isStructuralConstant(base, q('percent_scale', '%', { author: 'structure', value: 100 }))).toBe(true);
    const read = (edit: (d: CanonicalModelT) => void) => normalise(JSON.parse(completed(edit)) as CanonicalModelT);
    expect(read((d) => { d.quantities.push(q('current_utilisation', '1', { author: 'structure', value: 1 })); }).quantities.find((x) => x.id === 'current_utilisation'))
      .toMatchObject({ status: 'asked', author: 'person', value: null });
    // Codex r6/r7: a 1 as the effect's base ("current features = 1") is their question, even with their words beside it; a × 1 factor stays Olumi's constant.
    const onBase = (quote: string | null, value: number) => (d: CanonicalModelT) => { d.quantities.push(q('current_features', 'feature/month', { author: 'structure', value, quote }));
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'current_features'; };
    expect(read(onBase(null, 1)).quantities.find((x) => x.id === 'current_features')).toMatchObject({ status: 'asked', author: 'person', value: null });
    expect(read(onBase('We ship 4 features a month', 4)).quantities.find((x) => x.id === 'current_features')).toMatchObject({ status: 'asked', author: 'person', value: null, quote: null });
    expect(read((d) => {
      d.quantities.push(q('features_scale', '1', { author: 'structure', value: 1 }), q('features_base', 'feature/month', { kind: 'derived', status: 'derived', author: 'olumi' }));
      d.relations.push({ form: 'definition', id: 'features_base_rel', defines: 'features_base', op: 'product', parts: [{ id: 'features_now', power: 1 }, { id: 'features_scale', power: 1 }], author: 'olumi', quote: null, ...at });
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'features_base';
    }).quantities.find((x) => x.id === 'features_scale')).toMatchObject({ author: 'structure', status: 'known', value: 1 });
    // Codex #3710: a new index base 1 whose effect's coefficient is itself new (unit 1/tech_lead) stays structure.
    expect(read((d) => {
      d.quantities.push(q('features_index_now', '1', { author: 'structure', value: 1 }), q('features_index', '1', { kind: 'derived', status: 'derived', author: 'olumi' }),
        q('index_per_lead', '1/tech_lead', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.1, low: 0, high: 0.2, range_kind: 'plausible', basis: 'Synthetic.' }));
      d.relations.push({ form: 'effect', id: 'features_index_rel', defines: 'features_index', base: 'features_index_now',
        terms: [{ driver: 'tech_leads_hired', coefficient: 'index_per_lead', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at });
    }).quantities.find((x) => x.id === 'features_index_now')).toMatchObject({ author: 'structure', status: 'known', value: 1 });

    // Refused: a note naming a record that is not there, after the drafter's two repairs (its sentence goes back each time).
    replies = Array.from({ length: 3 }, () => completed((d) => { d.assumptions[d.assumptions.length - 1]!.concerns.push('no_such_record'); }));
    sent.length = 0;
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'does_not_compile' });
    expect(sent).toHaveLength(3);
    // Refused: a figure only they know, INVENTED as theirs (words they never wrote).
    replies = [completed((d) => setQ(d, 'features_now', { status: 'known', value: 12, question: null, quote: 'about 12 a month' }))];
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: ['features_now'] } });
    // Refused: one of their figures rewritten under their EARLIER words (their budget, quoted from the brief).
    const budget = before.quantities.find((x) => x.author === 'person' && x.value !== null && x.kind === 'fact')!;
    replies = [completed((d) => setQ(d, budget.id, { value: budget.value! + 1 }))];
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'unverified_person_words', data: { ids: [budget.id], check: 'this_turn' } });
    // Refused: a record left out without a listed removal; nothing is removed unless the person asks.
    const dropped = before.options[0]!.id;
    replies = [completed((d) => { d.options = d.options.filter((o) => o.id !== dropped); })];
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'omitted_record', data: { ids: [dropped] } });
    // A change the drafter makes beyond the request is never hidden: an option it renames is on the card, before and after.
    replies = [completed((d) => { d.options = d.options.map((o) => ({ ...o, label: `${o.label} (Olumi)` })); })];
    const renamed = await propose();
    expect(renamed.status, JSON.stringify(renamed)).toBe('ok');
    expect(renamed.data.changes.filter((c: Json) => c.kind === 'option').map((c: Json) => [c.id, c.action, c.label])).toEqual(before.options.map((o) => [o.id, 'change', `${o.label} (Olumi)`]));

    // The completion: one drafter call; every change on the card, Olumi's visibly Olumi's and provisional, with a basis; the
    // person's figure it needs is a question; their 10% and their three months are the aim's target and window again.
    replies = [completed()];
    sent.length = 0;
    const card = await propose();
    expect(card.status, JSON.stringify(card)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(card.data.changes.map((c: Json) => [c.id, c.kind, c.action, c.author])).toEqual([
      ['features_shipped_per_month', 'quantity', 'add', 'person'], ['features_now', 'quantity', 'add', 'person'], ['lead_effect', 'quantity', 'add', 'olumi'], ['developer_effect', 'quantity', 'add', 'olumi'],
      ['features_rel', 'relation', 'add', 'olumi'], ['increase_productivity', 'goal', 'change', 'person'], ['leads_unblock', 'record', 'add', 'olumi'], ['lead_needs_scope', 'record', 'add', 'olumi'],
      ['hires_productive_in_window', 'record', 'add', 'olumi'], ['scope_agreed_first', 'record', 'add', 'olumi']]);
    expect(card.data.changes.find((c: Json) => c.id === 'features_rel').after).toBe('an effect on "Features shipped per month", starting from "features now" (still to be given), '
      + 'changes by "lead effect" 0–4 feature/month/tech lead for each "Tech leads hired" 0 tech lead, '
      + 'changes by "developer effect" 0.3–1.5 feature/month/developer for each "Additional developers hired" 0 developer');
    expect(registered).toHaveLength(1); // proposing saves nothing
    expect(await applyProgramChange(deps, ctx, card.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(deps.proposals.get(card.data.proposal_id)!.living_model));
    expect(after.goals.find((g) => g.id === 'increase_productivity')!.measure).toMatchObject({ quantity: 'features_shipped_per_month', target: 'productivity_increase_target', frame: 'change_rel',
      window: { start: 0, periods: 'launch_horizon' }, measure_by: 'person' });
    expect(after.quantities.find((x) => x.id === 'features_shipped_per_month')).toMatchObject({ kind: 'derived', status: 'derived', author: 'person', quote: words });
    expect(after.quantities.find((x) => x.id === 'features_now')).toMatchObject({ status: 'asked', value: null, author: 'person', quote: null });
    // Approving the card records acceptance of Olumi's parts; their author stays Olumi (host-owned, never the AI's).
    for (const id of ['lead_effect', 'developer_effect']) expect(after.quantities.find((x) => x.id === id)).toMatchObject({ author: 'olumi', status: 'estimated', approval: 'approved', author_id: null, basis: expect.any(String) });
    expect(after.relations.find((r) => r.id === 'features_rel')).toMatchObject({ author: 'olumi', approval: 'approved', terms: [{ author: 'olumi', approval: 'approved' }, { author: 'olumi', approval: 'approved' }] });
    // Everything they had stays as it was, by id: every earlier record, its author and words; the history gains the one change.
    for (const family of ['quantities', 'relations', 'limits', 'options', 'risks', 'claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const) {
      for (const r of before[family] as { id: string }[]) expect((after[family] as { id: string }[]).find((x) => x.id === r.id), `${family}:${r.id}`).toEqual(r);
    }
    expect(after.history).toEqual([...before.history, expect.objectContaining({ id: 'increase_productivity', change: 'superseded' })]);
    // An option → outcome path now: the aim waits on exactly the one figure only they know, never on a guess.
    const waiting = compile(after, { sourceText: persisted!.living_model.person_words.join('\n') });
    expect(waiting.errors).toEqual([]);
    expect(waiting.perGoal.find((g) => g.goal_id === 'increase_productivity')).toMatchObject({ status: 'asks', asks: ['features_now'] });

    // Their answer to that question, through the same path: each option's chance of the aim appears.
    const now = 'We ship about 12 features a month now.';
    const ctx2 = { ...ctx, turn_id: randomUUID(), verified_user_messages: [now], user_turn_text: now };
    replies = [savedWith((d) => setQ(d, 'features_now', { status: 'known', value: 12, question: null, quote: now, basis: APPROXIMATE_FIGURE }))];
    const fill = await proposeProgramChange(deps, ctx2, { public_label: 'Features now', basis: 'their answer', request: 'They ship about 12 features a month now.', remove: [] }) as Json;
    expect(fill.status, JSON.stringify(fill)).toBe('ok');
    expect(await applyProgramChange(deps, ctx2, fill.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const view = (persisted!.living_model.runs.at(-1).result as Json).canonical_analysis_view as Json;
    // (The launch aim still has no measure, so the joint chance waits for it and says so; this aim's own chance is shown.)
    const aim = (view.goal_chance as Json).targets.per_target.find((t: Json) => t.constraint_id === 'increase_productivity');
    expect(aim.options.map((o: Json) => o.option_id)).toEqual(['hire_tech_lead', 'hire_two_developers']);
    for (const o of aim.options) expect(o.display).toMatch(/^about \d+%$/);
    expect(aim.words).toMatch(/Olumi’s assumed relationship/);
    for (const c of persisted!.living_model.runs.at(-1).result.chances as Json[]) expect(c.per_goal).toEqual([expect.objectContaining({ goal_id: 'increase_productivity', chance: expect.any(Number) })]);
  });

  it('display fit (Lenses 23 Oct): every link its own id and sign; the goal target, each figure\'s source and every editable id on the fields the canvas reads', () => {
    // A part used twice (a difference of one quantity with itself) is two links, each with its own sign.
    const twice = bakery();
    twice.quantities.push(q('net_zero', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
    twice.relations.push({ form: 'definition', id: 'zero_rel', defines: 'net_zero', op: 'sum', parts: [{ id: 'base_sales', sign: 1 }, { id: 'base_sales', sign: -1 }], author: 'olumi', quote: null, ...at });
    const tg = project(twice, compile(twice, { sourceText: BRIEF })).graph;
    const zero = tg.edges.filter((e) => e.to === 'net_zero').map((e) => [e.id, (e.strength as Json).mean, e.effect_direction]);
    expect(zero).toEqual([['base_sales__net_zero', 1, 'positive'], ['base_sales__net_zero__2', -1, 'negative']]);
    expect(new Set(tg.edges.map((e) => e.id)).size).toBe(tg.edges.length);

    // A later answer of the person's is theirs as entered, never "from your brief".
    const words = 'The oven would cost about £2,500.';
    const answered = bakery();
    answered.quantities = answered.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: words } : x));
    const g = project(answered, compile(answered, { sourceText: `${BRIEF}\n${words}` }), { brief: BRIEF }).graph;
    const node = (id: string) => g.nodes.find((n) => n.id === id) as Json;
    expect(node('more_loaves')).toMatchObject({ goal_threshold_raw: 380, goal_threshold_cap: 475, goal_threshold: 0.8, goal_threshold_cap_provenance: 'target_derived_headroom',
      goal_threshold_frame: 'level', goal_threshold_unit: 'loaf/week', threshold_source: 'brief_extraction' });
    expect(node('base_sales').observed_state).toEqual({ value: 300, raw_value: 300, unit: 'loaf/week', source: 'brief_extraction', extractionType: 'explicit' });
    expect(node('sell_through').observed_state).toEqual({ value: 0.7, raw_value: 0.7, unit: '1', source: 'cee_inference', extractionType: 'inferred', range: { low: 0.5, high: 0.9 } });
    expect(node('oven_price').observed_state).toEqual({ value: 2500, raw_value: 2500, unit: 'GBP/oven', source: 'user_override' });
    // A derived figure has none drawn (it is worked out); the coefficient's id rides its link, so an edit maps back to it.
    expect(node('sales').observed_state).toBeUndefined();
    expect(g.edges.find((e) => e.id === 'ovens_added__sales')).toMatchObject({ coefficient_id: 'sold_per_oven' });
    // The canvas's goal target on a reload: the canonical readiness builder reads it off this graph.
    expect(buildCanonicalAnalysisReadyFromGraph({ ...g, living_model: {} })).toMatchObject({ goal_node_id: 'more_loaves', goal_threshold_raw: 380 });
  });

  it('DL 23 Oct (alpha3 fit): a per-unit rate is drawn ONE way however the draft wrote it, on its driver\'s link with its coefficient_id, never as its own card with a second link', () => {
    const words = 'A second oven adds about 100 loaves a week';
    const of = (form: 'effect' | 'product'): CanonicalModelT => {
      const m = bakery();
      m.quantities = [...m.quantities.filter((x) => !['extra_per_oven', 'sell_through', 'sold_per_oven'].includes(x.id)),
        q('per_oven', 'loaf/week/oven', { kind: 'coefficient', value: 100, low: 80, high: 120, range_kind: 'plausible', quote: words }),
        q('extra_sales', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }),
        ...(form === 'effect' ? [q('no_extra', 'loaf/week', { value: 0, author: 'structure' })] : [])];
      const rate: CanonicalModelT['relations'][number] = form === 'effect'
        ? { form: 'effect', id: 'extra_rel', defines: 'extra_sales', base: 'no_extra', terms: [{ driver: 'ovens_added', coefficient: 'per_oven', author: 'person', quote: words, ...at }], author: 'person', quote: words, ...at }
        : { form: 'definition', id: 'extra_rel', defines: 'extra_sales', op: 'product', parts: [{ id: 'ovens_added', power: 1 }, { id: 'per_oven', power: 1 }], author: 'person', quote: words, ...at };
      m.relations = [rate, { form: 'definition', id: 'sales_rel', defines: 'sales', op: 'sum', parts: [{ id: 'base_sales', sign: 1 }, { id: 'extra_sales', sign: 1 }], author: 'olumi', quote: null, ...at },
        m.relations.find((r) => r.id === 'spend_rel')!];
      return m;
    };
    const shown = (form: 'effect' | 'product') => { const m = of(form); return project(m, compile(m, { sourceText: `${BRIEF}\n${words}` })); };
    const effect = shown('effect');
    const product = shown('product');
    const rateLinks = (p: ReturnType<typeof project>) => p.graph.edges.filter((e) => e.to === 'extra_sales' && e.from !== 'no_extra');
    // ONE link carries the rate in both forms: its id for the link editor, its size in natural units, its sign, whose it is.
    expect(rateLinks(product)).toEqual(rateLinks(effect));
    expect(rateLinks(product)).toEqual([expect.objectContaining({ id: 'ovens_added__extra_sales', coefficient_id: 'per_oven', effect_direction: 'positive', origin: 'model_program:calculation',
      provenance: expect.objectContaining({ source: 'brief_extraction', magnitude: 'user_stated', natural_effect: expect.objectContaining({ amount: 100, amount_unit: 'loaf/week', per_source_change_unit: 'oven' }) }) })]);
    for (const p of [effect, product]) {
      expect(p.graph.nodes.find((n) => n.id === 'per_oven')).toBeUndefined();
      expect(p.graph.edges.filter((e) => e.from === 'per_oven')).toEqual([]);
      expect(p.items.find((i) => i.record_id === 'per_oven')?.shown_as).toEqual({ on_edge: 'ovens_added__extra_sales' });
    }
    // Codex r4 #3709: a % rate's link figure is what the compiler uses, per ONE of the driver's unit (40 % → 0.4 loaf/week per
    // loaf/week), and it times the driver gives the compiled value; the card says it as the person gave it, 40 %.
    const pct = bakery();
    pct.quantities.push(q('sold_share', '%', { kind: 'coefficient', value: 40, quote: words }), q('sold', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
    pct.relations.push({ form: 'definition', id: 'sold_rel2', defines: 'sold', op: 'product', parts: [{ id: 'base_sales', power: 1 }, { id: 'sold_share', power: 1 }], author: 'olumi', quote: null, ...at });
    pct.goals = [{ ...pct.goals[0]!, measure: { ...pct.goals[0]!.measure!, quantity: 'sold' } }]; // in the calculation
    const pc = compile(pct, { sourceText: `${BRIEF}\n${words}` });
    const pl = project(pct, pc).graph.edges.find((e) => e.id === 'base_sales__sold') as Json;
    const fixedOf = (id: string) => ((pc.executable?.quantities ?? []) as Json[]).find((x) => x.id === id)?.dist?.value as number | undefined;
    expect(pl).toMatchObject({ coefficient_id: 'sold_share', provenance: { natural_effect: { amount_unit: 'loaf/week', per_source_change_unit: 'loaf/week' } } });
    expect(pl.provenance.natural_effect.amount).toBeCloseTo(0.4, 12);
    expect(pl.provenance.natural_effect.amount).toBeCloseTo(fixedOf('sold_share')!, 12);
    expect(pl.provenance.natural_effect.amount * 300).toBeCloseTo(120, 9);
    expect(pl.provenance.reasoning).toMatch(/^40 % per loaf\/week/);
    // Contrast: a product of two coefficients has no one driver, so both parts stay cards with their own links, no coefficient_id.
    const pb = project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph;
    const sold = pb.edges.filter((e) => e.to === 'sold_per_oven');
    expect(sold.map((e) => e.id)).toEqual(['extra_per_oven__sold_per_oven', 'sell_through__sold_per_oven']);
    expect(sold.some((e) => 'coefficient_id' in e)).toBe(false);
    expect(pb.nodes.filter((n) => n.id === 'extra_per_oven' || n.id === 'sell_through')).toHaveLength(2);
  });

  it('Lenses fit 2 (DL 23 Oct): a relative target is a fraction; what waits on an answer is in the analysis; each setting and worked-out figure says whose it is', () => {
    const nodeOf = (g: { nodes: Json[] }) => (id: string) => g.nodes.find((n) => n.id === id) as Json;
    // (1) "Grow sales by 10%" is change_rel 0.1 beside the measured quantity's unit (the canvas says "up 10% from today"),
    // never 10 (read as 1000%) and never on a cap scale; the same target written as the fraction 0.1 ("1") is the same.
    const relative = (target: Partial<CanonicalModelT['quantities'][number]>, unit: string) => {
      const m = bakery();
      m.quantities.push(q('growth', unit, { quote: 'grow sales by 10%', ...target }));
      m.goals = [{ ...m.goals[0]!, measure: { ...m.goals[0]!.measure!, target: 'growth', frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } }];
      return nodeOf(project(m, compile(m)).graph)('more_loaves');
    };
    for (const goal of [relative({ value: 10 }, '%'), relative({ value: 0.1 }, '1')]) {
      expect(goal).toMatchObject({ goal_threshold_frame: 'change_rel', quantity_frame: 'level', goal_threshold_raw: 0.1, goal_threshold_unit: 'loaf/week', threshold_source: 'brief_extraction' });
      expect(goal).not.toHaveProperty('goal_threshold_cap');
      expect(goal).not.toHaveProperty('goal_threshold');
    }

    // (5) The bakery's limit waits on the oven's price: the price, the spend and the limit's inputs are IN the analysis,
    // waiting for the answer; with the extra per oven asked as well nothing can be worked out yet, and still only what is
    // genuinely out (a note, an aim with no measure) is excluded.
    const waiting = nodeOf(project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph);
    expect(waiting('oven_price')).toMatchObject({ analysis_participation: 'included', display_value: 'Waiting for your answer',
      value_basis: { kind: 'waiting_for_answer', words: 'Waiting for your answer', question: 'What would the second oven cost?' } });
    expect(waiting('spend').analysis_participation).toBe('included');
    const none = bakery();
    none.quantities = none.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, status: 'asked', value: null, quote: null, question: 'How many more loaves would a second oven bake?' } : x));
    none.goals.push({ id: 'regulars', label: 'Keep the regulars happy', measure: null, question: 'How would you know the regulars are happy?', author: 'person', quote: 'keep our one oven', ...at });
    none.claims.push({ id: 'busy', text: 'Saturdays are the busy day.', concerns: ['sales'], author: 'olumi', quote: null, ...at });
    const compiledNone = compile(none, { sourceText: BRIEF });
    expect([compiledNone.errors, compiledNone.executable]).toEqual([[], null]);
    const out = nodeOf(project(none, compiledNone).graph);
    for (const id of ['base_sales', 'ovens_added', 'extra_per_oven', 'sales', 'oven_price', 'spend', 'more_loaves', 'second_oven', 'keep_one']) {
      expect([id, out(id).analysis_participation]).toEqual([id, 'included']);
    }
    for (const id of ['regulars', 'busy']) expect([id, out(id).analysis_participation]).toEqual([id, 'retained_excluded']);

    // (4) An option's setting says whose it is in the canvas's intervention vocabulary; a structural switch (on or off) is the
    // option's own. A worked-out figure says what it is worked out from; a structural constant says it is fixed by the model.
    const bake = nodeOf(project(bakery(), compile(bakery(), { sourceText: BRIEF }), { brief: BRIEF }).graph);
    expect(bake('second_oven').interventions.ovens_added).toMatchObject({ source: 'brief_extraction', source_words: 'Set by ‘A second oven’, from your brief' });
    expect(bake('sales')).toMatchObject({ display_value: 'Worked out from base sales and ovens added',
      value_basis: { kind: 'worked_out', from: ['base_sales', 'ovens_added'], words: 'Worked out from base sales and ovens added' } });
    const clubbed = nodeOf(project(club(), compile(club(), { sourceText: CLUB_BRIEF }), { brief: CLUB_BRIEF }).graph);
    expect(clubbed('promotion').interventions).toMatchObject({
      promo_on: { source: 'brief_extraction', source_words: 'Set by ‘Run a promotion’, from your brief' },
      spend: { source: 'brief_extraction', source_words: 'Set by ‘Run a promotion’, from your brief' } });
    expect(clubbed('promo_on').value_basis).toEqual({ kind: 'structure', words: 'Fixed by how the model is built' });
    expect(clubbed('members').value_basis).toMatchObject({ kind: 'worked_out', from: ['members_now', 'joins', 'leavers'] });

    // Codex r1 #3709 (1): a % range with no point is projected in the unit it is labelled with: 50–90 % sits at 70 %, never
    // the compiler's fraction 0.7 beside "%".
    const pct = bakery();
    pct.quantities = pct.quantities.map((x) => (x.id === 'sell_through' ? { ...x, unit: '%', value: null, low: 50, high: 90 } : x));
    const pctNode = nodeOf(project(pct, compile(pct, { sourceText: BRIEF })).graph)('sell_through');
    expect(pctNode.observed_state).toMatchObject({ value: 70, raw_value: 70, unit: '%', range: { low: 50, high: 90 } });
    expect(pctNode.display_value).toMatch(/^50–90 %, Olumi's estimate; Olumi reads it as a spread around 70 \(sd 11\.55\)/);

    // DL 24 Oct (board 3de98183): a bare range of theirs IS the level. The centre the card draws is Olumi's reading, labelled
    // Olumi's; the range and their words stay theirs. A figure they state keeps their source.
    const costBrief = `${BRIEF} The oven is $40,000 to $50,000, and delivery is $10,000.`;
    const costs = bakery();
    costs.quantities = costs.quantities.map((x) => (x.id === 'oven_price' ? { ...x, unit: 'USD/oven', status: 'known', value: null, low: 40000, high: 50000, range_kind: 'bounds',
      question: null, quote: '$40,000 to $50,000' } : x));
    costs.quantities.push(q('delivery', 'USD', { value: 10000, quote: '$10,000' }));
    const costNode = nodeOf(project(costs, compile(costs, { sourceText: costBrief }), { brief: costBrief }).graph);
    expect(costNode('oven_price').observed_state).toEqual({ value: 45000, raw_value: 45000, unit: 'USD/oven', source: 'cee_inference', extractionType: 'inferred',
      range: { low: 40000, high: 50000 } });
    expect(costNode('oven_price')).toMatchObject({ provenance: 'from_brief', source_quote: '$40,000 to $50,000' });
    expect(costNode('delivery').observed_state).toEqual({ value: 10000, raw_value: 10000, unit: 'USD', source: 'brief_extraction', extractionType: 'explicit' });

    // Codex r1 #3709 (5): "yours" (user_override) only for words found in what the person wrote. The same later answer,
    // compiled against the brief alone, is unverified and carries no source at all.
    const words = 'The oven would cost about £2,500.';
    const answered = bakery();
    answered.quantities = answered.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: words } : x));
    const sourceOf = (text: string) => nodeOf(project(answered, compile(answered, { sourceText: text }), { brief: BRIEF }).graph)('oven_price').observed_state;
    expect(sourceOf(`${BRIEF}\n${words}`)).toMatchObject({ source: 'user_override' });
    expect(sourceOf(BRIEF)).not.toHaveProperty('source');
  });

  it('the stored Run names itself: run id, the analysis hash of the graph it was computed with, its time; stale once the model moves', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const run = persisted!.living_model.runs[0] as Json;
    const view = r.canonical_analysis_view;
    expect(view.run).toEqual({ run_id: run.run_id, graph_hash_at_run: hashOf(persisted), computed_at: run.computed_at });
    expect([view.staleness.stale, view.staleness.reason, view.face_when_stale]).toEqual([false, 'graph_hash_match', undefined]);
    expect(stableStringify(reopenProgram(persisted)!.view)).toBe(stableStringify(view));
    // Contrast: the model moved with no new Run (a word of the person's added): the SAME stored result, now said stale.
    const moved = JSON.parse(JSON.stringify(persisted));
    moved.living_model.person_words.push('and one more thing');
    const shown = reopenProgram(moved)! as { view: Json; current: boolean };
    expect([shown.current, shown.view.staleness.stale, shown.view.staleness.reason, shown.view.run.graph_hash_at_run]).toEqual([false, true, 'graph_hash_diverged', view.run.graph_hash_at_run]);
    expect(shown.view.face_when_stale).toBe(RUN_AGAIN_FOR_CHANCE);
    expect(stableStringify(shown.view.options)).toBe(stableStringify(view.options));
  });

  it('canvas edits on a program: a card figure and a goal target each set ONE figure as the person\'s, with a new Run; a link edit and a resend change nothing', async () => {
    replies = [JSON.stringify(bakery())];
    const drafted = await turn({ message: BRIEF });
    // DL 23 Oct (served capacity, stale card): a reply whose turn stored a Run names it in \`run\`, so the UI reads it after the write.
    expect(drafted.json().run).toMatchObject({ run_id: persisted!.living_model.runs[0].run_id, run_key: persisted!.living_model.runs[0].run_id, state: { kind: 'complete_current' } });
    sent.length = 0;
    const edit = (event: Json, turn_id = randomUUID()) => turn({ kind: 'system_event', turn_id, event });
    const figure = { kind: 'factor_value_edit', target_id: 'base_sales', value: 320 };
    const id = randomUUID();
    const r = await edit(figure, id);
    expect(r.statusCode, r.body).toBe(200);
    expect(sent).toHaveLength(0);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: 320, author: 'person', quote: 'base sales: 320 loaf/week' });
    expect(persisted!.living_model.runs).toHaveLength(2);
    // The applied graph the canvas checks the edit against carries the typed figure, as the person's.
    const drawn = (r.json().model.graph.nodes as Json[]).find((n) => n.id === 'base_sales')!;
    expect(drawn.observed_state).toMatchObject({ value: 320, source: 'user_override' });
    expect(r.json().canonical_analysis_view.run.run_id).toBe(persisted!.living_model.runs[1].run_id);
    expect(r.json().run).toMatchObject({ run_id: persisted!.living_model.runs[1].run_id, state: { kind: 'complete_current', computed_at: persisted!.living_model.runs[1].computed_at } });
    expect(r.json().run.run_id).not.toBe(drafted.json().run.run_id);
    // The same edit resent: answered from what is saved, never applied twice; it stored no Run, so it names none.
    const saves = registered.length;
    const again = await edit(figure, id);
    expect([again.statusCode, again.json().durability, registered.length]).toEqual([200, 'replayed', saves]);
    expect(again.json().run).toBeNull();

    const target = await edit({ kind: 'goal_target_edit', goal_node_id: 'more_loaves', constraint_type: 'at_least', raw_value: 400, unit: 'loaf/week', base_graph_hash: hashOf(persisted) });
    expect(target.statusCode, target.body).toBe(200);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'sales_target')).toMatchObject({ value: 400, author: 'person' });
    expect((persisted!.nodes as Json[]).find((n) => n.id === 'more_loaves')).toMatchObject({ goal_threshold_raw: 400, threshold_source: 'user', success_threshold: 400 });

    const saved = registered.length;
    const link = await edit({ kind: 'edge_strength_edit', from: 'ovens_added', to: 'sales', magnitude: 0.5, direction_intent: 'preserve', expected: { mean: 1, effect_direction: 'positive' }, intent: 'set' });
    expect(link.statusCode).toBe(409);
    expect(link.json().error).toMatchObject({ code: 'CANVAS_EDIT_REFUSED', nothing_saved: true });
    expect(link.json().error.message).toContain('change it in the chat');
    expect(registered.length).toBe(saved);
    expect(link.json().run).toBeNull();
  });

  it('DL 23 Oct (in-card range edit): a figure typed inside the person\'s own range moves its centre and keeps the range, and the chance moves; outside it, nothing is saved and they are asked', async () => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, low: 80, high: 120, range_kind: 'plausible' } : x));
    replies = [JSON.stringify(m)];
    await turn({ message: BRIEF });
    sent.length = 0;
    const edit = (value: number) => turn({ kind: 'system_event', turn_id: randomUUID(), event: { kind: 'factor_value_edit', target_id: 'extra_per_oven', value } });
    const chance = () => ((persisted!.living_model.runs.at(-1).result.chances as Json[]).find((c) => c.option_id === 'second_oven')!.per_goal[0].chance as number);
    const first = chance();
    // Outside the range: refused with its reason (no question), nothing saved, no new Run.
    const saves = registered.length;
    const out = await edit(60);
    expect(out.statusCode).toBe(409);
    expect(out.json().error).toMatchObject({ code: 'CANVAS_EDIT_REFUSED', nothing_saved: true, message: '60 is outside your range of 80–120, so nothing was saved: change the range with it.' });
    expect(registered.length).toBe(saves);
    expect(persisted!.living_model.runs).toHaveLength(1);
    // Inside it: their new most likely figure, the range and its reading kept, and the second oven's chance goes UP.
    const inside = await edit(110);
    expect(inside.statusCode, inside.body).toBe(200);
    expect(sent).toHaveLength(0);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'extra_per_oven'))
      .toMatchObject({ value: 110, low: 80, high: 120, range_kind: 'plausible', author: 'person', status: 'known' });
    expect(chance()).toBeGreaterThan(first);
  });

  it('Codex r4–r8 + buddy #3709: ONE structural admission on the first draft — 0 is the only additive identity; 1 only in unit "1", by exact unit algebra; any other is their question', () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    const m = JSON.parse(JSON.stringify(saved.canonical)) as CanonicalModelT;
    const derived = (id: string, unit: string) => q(id, unit, { kind: 'derived', status: 'derived', author: 'olumi' });
    const product = (id: string, defines: string, parts: [string, 1 | -1][]) => ({ form: 'definition' as const, id, defines, op: 'product' as const, parts: parts.map(([pid, power]) => ({ id: pid, power })), author: 'olumi' as const, quote: null, ...at });
    m.quantities.push(q('current_output', 'feature/month', { author: 'structure', value: 12 }), q('months_per_year', 'month/year', { author: 'structure', value: 12 }),
      q('current_utilisation', '1', { author: 'structure', value: 1 }), q('no_extra_output', 'feature/month', { author: 'structure', value: 0 }), derived('extra_output', 'feature/month'),
      // Codex r6: an unstated "current customers = 1" added in a sum is the person's figure, not an identity.
      q('current_customers', 'customer', { author: 'structure', value: 1 }), q('new_customers', 'customer', { author: 'structure', value: 0 }), derived('customers', 'customer'),
      // A 1 WITH a unit in a product (× 1 output unit per developer, ÷ 1 customer) is a level only the person gives (buddy, r8).
      q('output_per_developer', 'feature/month/developer', { author: 'structure', value: 1 }), derived('team_output', 'feature/month'),
      q('one_customer', 'customer', { author: 'structure', value: 1 }), derived('output_per_customer', 'feature/month/customer'),
      // The unit-free 1: × 1, "1 + growth", and the base of a dimensionless index ("current productivity, indexed").
      q('output_scale', '1', { author: 'structure', value: 1 }), derived('scaled_output', 'feature/month'),
      // Codex #3710: "1" exactly, never another dimensionless unit: a structural 1 % product factor is a figure to ask for.
      q('one_percent', '%', { author: 'structure', value: 1 }), derived('scaled_percent', 'feature/month'),
      q('productivity_indexed', '1', { author: 'structure', value: 1 }), derived('productivity_index', '1'),
      q('index_per_developer', '1/developer', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.1, low: 0, high: 0.2, range_kind: 'plausible', basis: 'Synthetic.' }),
      q('one', '1', { author: 'structure', value: 1 }), q('growth', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.1, low: 0, high: 0.2, range_kind: 'plausible', basis: 'Synthetic.' }), derived('growth_factor', '1'));
    m.relations.push({ form: 'definition', id: 'extra_output_rel', defines: 'extra_output', op: 'sum', parts: [{ id: 'no_extra_output', sign: 1 }, { id: 'current_output', sign: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'customers_rel', defines: 'customers', op: 'sum', parts: [{ id: 'current_customers', sign: 1 }, { id: 'new_customers', sign: 1 }], author: 'olumi', quote: null, ...at },
      product('team_output_rel', 'team_output', [['current_developers', 1], ['output_per_developer', 1]]),
      product('per_customer_rel', 'output_per_customer', [['extra_output', 1], ['one_customer', -1]]),
      product('scaled_output_rel', 'scaled_output', [['extra_output', 1], ['output_scale', 1]]),
      product('scaled_percent_rel', 'scaled_percent', [['extra_output', 1], ['one_percent', 1]]),
      { form: 'effect', id: 'index_rel', defines: 'productivity_index', base: 'productivity_indexed', terms: [{ driver: 'developers_hired', coefficient: 'index_per_developer', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'growth_rel', defines: 'growth_factor', op: 'sum', parts: [{ id: 'one', sign: 1 }, { id: 'growth', sign: 1 }], author: 'olumi', quote: null, ...at });
    const n = new Map(normalise(m).quantities.map((x) => [x.id, x] as const));
    // Asked: an integer no one stated, an unused 1 in unit "1", a 1 with a unit added in a sum, and a 1 with a unit in a product.
    for (const id of ['current_output', 'current_utilisation', 'current_customers', 'output_per_developer', 'one_customer', 'one_percent']) expect(n.get(id), id).toMatchObject({ author: 'person', status: 'asked', value: null, question: null, basis: null });
    // Kept: an option's switch (0 hires until an option sets one), a calendar conversion, 0 as a sum's part, and the unit-free 1.
    for (const id of ['developers_hired', 'tech_leads_hired', 'months_per_year', 'no_extra_output', 'new_customers', 'output_scale', 'productivity_indexed', 'one']) expect(n.get(id), id).toMatchObject({ author: 'structure', status: 'known' });
    // The compiler reads the question as one: what rests on it waits for the person, and no error asks the drafter to repair it.
    const c = compile(m, { sourceText: saved.brief });
    expect(c.errors).toEqual([]);
    expect(c.blockers.map((b) => b.id)).not.toContain('months_per_year');
    expect(c.blockers.filter((b) => b.code === 'asked').map((b) => b.id)).toEqual(expect.arrayContaining(['current_output']));
    // Exact unit algebra: a unit-free 1 beside a term with a unit (a sum with loaves, an effect adding loaves) is no identity.
    const mixed = bakery();
    mixed.quantities.push(q('base_one', '1', { author: 'structure', value: 1 }), derived('mixed_sum', 'loaf/week'), derived('mixed_effect', 'loaf/week'));
    mixed.relations.push({ form: 'definition', id: 'mixed_sum_rel', defines: 'mixed_sum', op: 'sum', parts: [{ id: 'base_one', sign: 1 }, { id: 'sales', sign: 1 }], author: 'olumi', quote: null, ...at });
    expect(isStructuralConstant(mixed, mixed.quantities.find((x) => x.id === 'base_one')!)).toBe(false);
    mixed.relations = [...mixed.relations.filter((r) => r.id !== 'mixed_sum_rel'), { form: 'effect', id: 'mixed_effect_rel', defines: 'mixed_effect', base: 'base_one', terms: [{ driver: 'ovens_added', coefficient: 'sold_per_oven', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at }];
    expect(isStructuralConstant(mixed, mixed.quantities.find((x) => x.id === 'base_one')!)).toBe(false);
    // The capacity shape: a zero base of an effect stays structural; a 1 as an effect's base is the person's figure.
    const cap = bakery();
    cap.quantities.push(q('no_extra', 'loaf/week', { author: 'structure', value: 0 }), derived('extra_sales', 'loaf/week'),
      q('sales_index', 'loaf/week', { author: 'structure', value: 1 }), derived('indexed_sales', 'loaf/week'));
    cap.relations.push({ form: 'effect', id: 'extra_rel', defines: 'extra_sales', base: 'no_extra', terms: [{ driver: 'ovens_added', coefficient: 'sold_per_oven', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at },
      { form: 'effect', id: 'indexed_rel', defines: 'indexed_sales', base: 'sales_index', terms: [{ driver: 'ovens_added', coefficient: 'sold_per_oven', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at });
    expect(normalise(cap).quantities.find((x) => x.id === 'no_extra')).toMatchObject({ author: 'structure', status: 'known', value: 0 });
    expect(normalise(cap).quantities.find((x) => x.id === 'sales_index')).toMatchObject({ author: 'person', status: 'asked', value: null });
    // Codex r7: a figure labelled structure is never read as theirs, even where their words write it: always their question.
    cap.quantities.push(q('weekly_bake', 'loaf/week', { author: 'structure', value: 300, quote: 'We bake 300 loaves a week' }));
    expect(normalise(cap).quantities.find((x) => x.id === 'weekly_bake')).toMatchObject({ author: 'person', status: 'asked', value: null, quote: null });
  });

  it('S4 class 7 (one reason): with no aim in the chance, the result says what it waits on from the typed blockers (an aim\'s measure, or the result they want), never "checks the limits only"', () => {
    const why = (m: CanonicalModelT) => {
      const e = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 });
      return [e.compiled.executable === null ? 'waiting' : 'run', ...new Set(((e.view as Json).options as Json[]).map((o) => `${o.cell.face} | ${o.cell.why}`))];
    };
    // The aim has no measure; the limit can be checked (its oven price is theirs): a run of the limits alone.
    const aimNoMeasure = bakery();
    aimNoMeasure.goals = aimNoMeasure.goals.map((g) => ({ ...g, measure: null, question: 'How would you know the bakery is doing well enough?' }));
    aimNoMeasure.quantities = aimNoMeasure.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: 'We have £3,000 to spend' } : x));
    // What the run DID check is its own result, said apart from the reason (Codex r1 #3719): each limit on its own.
    expect(why(aimNoMeasure)).toEqual(['run', 'Not shown yet: needs your answer | The chance waits on a measure for ‘Reach 380 loaves a week’. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.']);
    // The same with no limit: nothing calculates, and the waiting view says the same, from the same blockers.
    const noLimit = JSON.parse(JSON.stringify(aimNoMeasure)) as CanonicalModelT; noLimit.limits = [];
    expect(why(noLimit)).toEqual(['waiting', 'Not shown yet: needs your answer | The chance waits on a measure for ‘Reach 380 loaves a week’.']);
    // No aim at all: the result they want.
    const noAim = JSON.parse(JSON.stringify(aimNoMeasure)) as CanonicalModelT; noAim.goals = [];
    expect(why(noAim)).toEqual(['run', 'Not shown yet: needs your answer | The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.']);
    for (const m of [aimNoMeasure, noLimit, noAim]) expect(JSON.stringify(evaluateCanonical(m, { sourceText: BRIEF, seed: 7 }).view)).not.toMatch(/limits only|No aim has a measure/);
    // Codex r2 #3719: an option that moves the bound (the budget to £2,000 with a second oven) is said by what each limit
    // measures and its result only, never a bound figure, so the base model's £3,000 cannot be said for it.
    const moved = JSON.parse(JSON.stringify(noAim)) as CanonicalModelT;
    moved.quantities.push(q('reduced_budget', 'GBP', { value: 2000, quote: 'our budget is £2,000' }));
    moved.options[0]!.sets.push({ ...moved.options[0]!.sets[0]!, quantity: 'budget', to: 'reduced_budget', quote: 'With a second oven our budget is £2,000' });
    const e = evaluateCanonical(moved, { sourceText: `${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000.`, seed: 7 });
    expect(e.compiled.errors).toEqual([]);
    expect(e.sim!.options.find((o) => o.option_id === 'second_oven')!.per_limit[0]).toMatchObject({ chance: 0 });
    const cellOf = (id: string) => ((e.view as Json).options as Json[]).find((o) => o.option_id === id)!.cell;
    expect(cellOf('second_oven').why).toBe('The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 0%.');
    expect(cellOf('keep_one').why).toBe('The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.');
    for (const id of ['second_oven', 'keep_one']) expect(cellOf(id).why).not.toMatch(/£3,000|£2,000/);
    // Contrast: a measured aim waiting on a figure only they can give names that figure, as before.
    expect(why(bakery())[1]).not.toContain('measure for');
    // With nothing to run (the aim's target is asked), the waiting view's note for that aim is the blockers' words too, never
    // the compiler's joined reasons ("is not in the chance yet: needs …"); the waiting view has no run, so no limit line.
    const asked = bakery();
    setQ(asked, 'sales_target', { status: 'asked', value: null, quote: null, question: 'What is the target?' });
    const waitingView = evaluateCanonical(asked, { sourceText: BRIEF, seed: 7 });
    expect(waitingView.compiled.executable).toBeNull();
    expect(((waitingView.view as Json).goal_chance as Json).notes[0]).toBe('‘Reach 380 loaves a week’ waits on ‘sales target’.');
    expect(why(asked)).toEqual(['waiting', 'Not shown yet: needs your answer | The chance waits on ‘sales target’.']);
  });

  it('batch 4 hiring-r1: a measured aim whose options wait on their own figures says what it waits on, never "No aim has a measure yet"', () => {
    const m = bakery();
    // The aim is measured and calculable; the one option waits on its own setting (how many ovens it adds), as hiring-r1's
    // options waited on their start times.
    m.options = m.options.filter((o) => o.id === 'second_oven');
    m.quantities = m.quantities.map((x) => (x.id === 'one_oven' ? { ...x, status: 'asked', value: null, quote: null, question: 'How many ovens would you add?' } : x));
    const e = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 });
    expect(e.compiled.perGoal[0]).toMatchObject({ status: 'calculable', needs_measure: false });
    expect(e.compiled.executable).toBeNull();
    const cell = (id: string) => ((e.view as Json).options as Json[]).find((o) => o.option_id === id)!.cell;
    expect(cell('second_oven').why).toBe('The chance waits on ‘one oven’.');
    expect(cell('second_oven').face).toBe('Not shown yet: needs your answer');
    expect(cell('second_oven').why).not.toContain('No aim has a measure yet');
  });

  it('DoD-G marketing r2/r5: a run with no aim says no "chance of …" sentence (it said "chance of , while …"); what it did check is still said', () => {
    const m = bakery();
    setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    m.goals = [];
    const src = `${BRIEF} The second oven costs £2,500.`;
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    expect(e.compiled.executable).not.toBeNull();
    const gc = (e.view as Json).goal_chance as Json;
    expect(gc.chance_words).toBeUndefined();
    expect(JSON.stringify(e.view)).not.toContain('chance of ,');
    // The limit on its own, and each option's cell saying what the chance waits on, as before.
    expect(gc.limits).toEqual([{ constraint_id: 'within_budget', words: '‘spend’ is at most £3,000 with each option in effect',
      options: [{ option_id: 'second_oven', display: '100%' }, { option_id: 'keep_one', display: '100%' }] }]);
    expect(((e.view as Json).options as Json[]).map((o) => o.cell.why))
      .toEqual(Array(2).fill('The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.'));
    // Contrast: with its aim, the same model says the chance in full.
    m.goals = bakery().goals;
    expect(((evaluateCanonical(m, { sourceText: src, seed: 7 }).view as Json).goal_chance as Json).chance_words)
      .toBe('chance of ‘sales’ being at least 380 loaf / week with each option in effect, while ‘spend’ is at most £3,000 with each option in effect');
  });

  it('DoD-G hiring: a change from today on a quantity already named "… relative to today" never says "today today", and says its assumed relationship once', () => {
    const rel = (label: string) => {
      const m = bakery();
      setQ(m, 'sales', { label });
      m.quantities.push(q('growth', '%', { value: 10, quote: 'grow sales by 10%' }));
      m.goals = [{ ...m.goals[0]!, measure: { ...m.goals[0]!.measure!, target: 'growth', frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } }];
      const e = evaluateCanonical(m, { sourceText: `${BRIEF} We want to grow sales by 10%.`, seed: 7 });
      return { e, face: ((e.view as Json).options as Json[]).find((o) => o.option_id === 'second_oven')!.cell.face as string };
    };
    const today = rel('sales relative to today');
    expect(today.e.compiled.executable!.quantities.find((x) => x.id === 'sales__today')!.label).toBe('sales relative to today');
    expect(today.face).toBe('‘A second oven’: more than 99% chance of ‘Relative change in sales relative to today’ being at least 10% with each option in effect, in this model, '
      + 'if ‘sell through’ follows Olumi’s provisional conversion of Olumi’s own estimated range, 0.5 to 0.9, into a bell-shaped spread and ‘sales relative to today’ follows Olumi’s assumed relationship. '
      + 'Not yet checked: ‘Within the £3,000’ — needs "oven price".');
    expect(JSON.stringify(today.e.view)).not.toContain('today today');
    // Contrast: a quantity not already said "today" keeps its shadow's "today", listed as before.
    const plain = rel('sales');
    expect(plain.e.compiled.executable!.quantities.find((x) => x.id === 'sales__today')!.label).toBe('sales today');
    expect(plain.face).toContain(', ‘sales’ follows Olumi’s assumed relationship and ‘sales today’ follows Olumi’s assumed relationship.');
  });

  it('a bound an option moves is never said as the base figure (Codex r2 #3719 case on the figure cell): a second oven takes the budget from £3,000 to £2,000; every chance line names the budget instead', () => {
    const m = bakery();
    setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    m.quantities.push(q('reduced_budget', 'GBP', { value: 2000, quote: 'our budget is £2,000' }));
    m.options[0]!.sets.push({ ...m.options[0]!.sets[0]!, quantity: 'budget', to: 'reduced_budget', quote: 'With a second oven our budget is £2,000' });
    const e = evaluateCanonical(m, { sourceText: `${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000.`, seed: 7 });
    expect(e.compiled.errors).toEqual([]);
    // The run is right: spending £2,500 misses the second oven's £2,000 and keeps within keeping one oven's £3,000.
    expect(e.sim!.options.map((o) => [o.option_id, o.per_limit[0]])).toMatchObject([['second_oven', { chance: 0 }], ['keep_one', { chance: 1 }]]);
    const view = e.view as Json;
    const face = (id: string) => (view.options as Json[]).find((o) => o.option_id === id)!.cell.face as string;
    // Every line that states the bound: each option's chance and its limit on its own, and the shared chance words.
    for (const words of [face('second_oven'), face('keep_one'), view.goal_chance.chance_words, view.goal_chance.limits[0].words]) {
      expect(words, words).not.toMatch(/£3,000|£2,000/);
      expect(words, words).toContain('‘spend’ is at most ‘budget’');
    }
    expect(face('second_oven')).toMatch(/Each limit on its own: ‘spend’ is at most ‘budget’[^:;]*: 0%\./);
    // The exact line too: with the sell-through theirs and fixed, the second oven misses both in every draw, and its why names
    // the budget it misses, never the base £3,000.
    const exact = JSON.parse(JSON.stringify(m)) as CanonicalModelT;
    setQ(exact, 'sell_through', { author: 'person', status: 'known', kind: 'fact', low: null, high: null, range_kind: null, basis: null, quote: 'seven in ten sell' });
    const x = evaluateCanonical(exact, { sourceText: `${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000. Seven in ten sell.`, seed: 7 }).view as Json;
    const exactFace = (x.options as Json[]).find((o) => o.option_id === 'second_oven')!.cell.face as string;
    expect(exactFace).toContain('in every simulated draw');
    expect(exactFace).toContain('‘spend’ is £2,500, above ‘budget’');
    expect(exactFace).not.toMatch(/£3,000|£2,000/);
    // Contrast: with no option moving it, the budget is said as its figure, as before.
    const fixed = bakery();
    setQ(fixed, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    const f = evaluateCanonical(fixed, { sourceText: `${BRIEF} The second oven costs £2,500.`, seed: 7 }).view as Json;
    expect(f.goal_chance.chance_words).toContain('‘spend’ is at most £3,000');

    // The card says it the same way (Codex r1 #3722): the reading card and a change list name a moved bound or target; its
    // figure stays on its own item and in the option's own setting. Unmoved, the card keeps the figure.
    const said = (v: ReturnType<typeof readingOf>, id: string) => (v.ok ? v.changes.find((c) => c.id === id)?.after ?? '' : JSON.stringify(v));
    const changeOf = (base: CanonicalModelT, edit: (d: CanonicalModelT) => void, w: string[]) => {
      const d = JSON.parse(JSON.stringify(base)) as CanonicalModelT; edit(d);
      const v = validatePostimage(base, d, { removals: [], words: w, fresh: w });
      return v.ok ? v.changes.map((c) => [c.id, c.before, c.after]) : v;
    };
    const budgetWords = [`${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000.`];
    const read = readingOf(m, { words: budgetWords, approver: null });
    expect(said(read, 'within_budget')).toContain('"spend" at most "budget",');
    expect(said(read, 'within_budget')).not.toMatch(/"budget" [0-9]|GBP/); // their own words ("We have £3,000 to spend") stay
    expect(said(read, 'budget')).toContain('3,000 GBP');
    expect(said(read, 'second_oven')).toContain('sets "budget" 3,000 GBP to "reduced budget" 2,000 GBP');
    expect(changeOf(m, (d) => { d.limits[0]!.measure!.cmp = '<'; }, budgetWords)).toEqual([['within_budget', '"spend" at most "budget"', '"spend" less than "budget"']]);
    expect(said(readingOf(fixed, { words: [`${BRIEF} The second oven costs £2,500.`], approver: null }), 'within_budget')).toContain('"spend" at most "budget" 3,000 GBP');
    // A goal's target an option moves (keeping one oven aims for 350, not 380): the results and the card name it.
    const target = bakery();
    setQ(target, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    target.quantities.push(q('lower_target', 'loaf/week', { value: 350, quote: 'With one oven we aim for 350' }));
    target.options[1]!.sets.push({ ...target.options[0]!.sets[0]!, quantity: 'sales_target', to: 'lower_target', quote: 'With one oven we aim for 350' });
    const targetWords = [`${BRIEF} The second oven costs £2,500. With one oven we aim for 350.`];
    const t = evaluateCanonical(target, { sourceText: targetWords[0], seed: 7 });
    expect(t.compiled.errors).toEqual([]);
    for (const o of (t.view as Json).options as Json[]) {
      expect(o.cell.face, o.cell.face).toContain('‘sales’ being at least ‘sales target’');
      expect(o.cell.face, o.cell.face).not.toMatch(/380 loaf|350 loaf/);
    }
    const targetRead = readingOf(target, { words: targetWords, approver: null });
    expect(said(targetRead, 'more_loaves')).toContain('"sales" at least "sales target",');
    expect(said(targetRead, 'more_loaves')).not.toContain('"sales target" 380');
    expect(said(targetRead, 'sales_target')).toContain('380 loaf/week');
    expect(changeOf(target, (d) => { d.goals[0]!.measure!.cmp = '>'; }, targetWords)).toEqual([['more_loaves', '"sales" at least "sales target"', '"sales" more than "sales target"']]);
  });

  it('DL 23 Oct (units on cards): every card that can hold a figure carries its quantity\'s own unit, a question\'s too; a worked-out card none', () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    const node = (g: { nodes: Json[] }, id: string) => g.nodes.find((n) => n.id === id) as Json;
    const hiring = project(saved.canonical, compile(saved.canonical, { sourceText: saved.brief })).graph;
    expect(node(hiring, 'developer_hiring_cost').observed_state).toEqual({ unit: 'GBP/developer' });
    expect(node(hiring, 'current_developers').observed_state).toMatchObject({ value: 6, unit: 'developer' });
    expect(node(hiring, 'total_hiring_spend').observed_state).toBeUndefined();
    const share = bakery();
    share.quantities.push(q('online_share', '%', { status: 'asked', question: 'What share of your sales is online?' }), q('wholesale_share', '%', { value: 40, quote: 'We bake 300 loaves a week' }));
    const g = project(share, compile(share, { sourceText: BRIEF })).graph;
    expect(node(g, 'online_share').observed_state).toEqual({ unit: '%' });
    expect(node(g, 'wholesale_share').observed_state).toMatchObject({ value: 40, unit: '%' });
  });

  it('S1 (Codex r1 #3716): a Run stored before blockers, reused while current, still has its waits read from the model, never a pile', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const run = persisted!.living_model.runs[0].result.compile as Json;
    delete run.blockers; run.asks = [{ quantity_id: 'oven_price', question: 'What would the second oven cost?' }]; run.coaching = [];
    const r = await turn({ message: 'Run the analysis', chip: { id: 'run', action_type: 'run_analysis', label: 'Run' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().assistant_text).toContain('1. What would the second oven cost?');
    expect(r.json().assistant_text).not.toContain('To work out what is still missing');
  });

  it('a Run press on a program needs no model call: the stored Run when current; a NEW Run, stored, when the model moved since', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    sent.length = 0;
    const saves = registered.length;
    const press = () => turn({ message: 'Run the analysis', chip: { id: 'run', action_type: 'run_analysis', label: 'Run' } });
    const r = await press();
    expect(r.statusCode, r.body).toBe(200);
    expect([sent.length, registered.length]).toEqual([0, saves]);
    expect(r.json().model_program).toMatchObject({ turn: 'run', stored: true });
    expect(r.json().canonical_analysis_view.run.run_id).toBe(persisted!.living_model.runs[0].run_id);
    // The model moved (a word of the person's added) with no Run: the press evaluates a NEW Run and stores it.
    persisted = JSON.parse(JSON.stringify(persisted));
    persisted!.living_model.person_words.push('We open six days a week.');
    const moved = await press();
    expect(moved.statusCode, moved.body).toBe(200);
    expect([sent.length, registered.length, persisted!.living_model.runs.length]).toEqual([0, saves + 1, 2]);
    expect(moved.json().canonical_analysis_view.run.run_id).toBe(persisted!.living_model.runs[1].run_id);
  });

  it('S1 one question channel (A4): the first reply prints at most three of the AI\'s OWN questions, in the model\'s order, then counts the rest; the result lists every blocker by label with its answer box', async () => {
    const m = bakery();
    m.goals.push({ id: 'regulars', label: 'Keep the regulars happy', measure: null, question: 'How would you tell the regulars are happy?', author: 'person', quote: 'want to reach 380 loaves a week', ...at },
      { id: 'staff_happy', label: 'Keep the staff happy', measure: null, question: 'How would you tell the staff are happy?', author: 'person', quote: 'want to reach 380 loaves a week', ...at });
    m.limits.push({ id: 'friendly', label: 'Keep it friendly', measure: null, question: 'How would you tell it stays friendly?', author: 'person', quote: 'We have £3,000 to spend', ...at });
    // AIE §5 AMEND (DL 24 Oct): a first draft's every ask carries the AI's question (an ask with none is refused at compile).
    setQ(m, 'base_sales', { status: 'asked', value: null, quote: null, question: 'How many loaves do you sell a week now?' });
    setQ(m, 'extra_per_oven', { value: null, low: 80, high: 120 }); // their range, its kind unread: a blocker with no question
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    // The AI's three, in the model's order (goals, limits, then quantities): the oven price's question is the fourth, counted.
    expect(r.assistant_text).toBe(['I\'ve drafted a first model of: Should the bakery buy a second oven?',
      '1. How would you tell the regulars are happy?\n2. How would you tell the staff are happy?\n3. How would you tell it stays friendly?',
      'The chance also waits on 3 other things, listed with the result.'].join('\n\n'));
    // The result lists every one of them, by label, with the figure its answer box fills; no question of the code's anywhere.
    const waits = r.canonical_analysis_view.goal_chance.waits_on as Json[];
    expect(waits).toEqual([
      { id: 'regulars', code: 'measure', label: 'Keep the regulars happy', scope: ['regulars'], answer: null },
      { id: 'staff_happy', code: 'measure', label: 'Keep the staff happy', scope: ['staff_happy'], answer: null },
      { id: 'friendly', code: 'measure', label: 'Keep it friendly', scope: ['friendly'], answer: null },
      { id: 'base_sales', code: 'asked', label: 'base sales', scope: ['more_loaves'], answer: { quantity_id: 'base_sales' } },
      { id: 'extra_per_oven', code: 'range_kind', label: 'extra per oven', scope: ['more_loaves'], answer: { quantity_id: 'extra_per_oven' } },
      { id: 'oven_price', code: 'asked', label: 'oven price', scope: ['within_budget'], answer: { quantity_id: 'oven_price' } },
    ]);
    expect(waits.every((w) => typeof w.label === 'string' && w.label.trim() !== '')).toBe(true);
    const view = JSON.stringify(r.canonical_analysis_view);
    expect(view).not.toContain('?');
    expect(JSON.stringify((persisted!.living_model.runs.at(-1).result as Json).compile)).not.toContain('?');
    // Contrast: the AI's own question for the fourth is on its record, so the probe sees questions where they are.
    expect(JSON.stringify(persisted!.living_model.canonical)).toContain('What would the second oven cost?');
  });

  it('S1 follow-up (served funding dead end): every figure the chance rests on with none in hand is listed; an unknown is no one\'s to answer (no box, its own basis), an asked one keeps its box; an unknown nothing rests on is not listed', async () => {
    const m = bakery();
    // What they expect anyway (their fact) and the option's added effect (a link), both unknown with no figure and no question.
    const none = { value: null, low: null, high: null, range_kind: null, question: null };
    setQ(m, 'base_sales', { ...none, status: 'unknown', quote: null, basis: 'Not given yet.' });
    setQ(m, 'sell_through', { ...none, status: 'unknown', basis: 'Cannot yet be sized.' });
    m.quantities.push(q('weather', '1', { status: 'unknown', author: 'olumi', basis: 'Nothing here uses it.' })); // contrast: nothing rests on it
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    const waits = r.canonical_analysis_view.goal_chance.waits_on as Json[];
    expect(waits).toEqual([
      { id: 'base_sales', code: 'unknown', label: 'base sales', scope: ['more_loaves'], answer: null, basis: 'Not given yet.' },
      { id: 'sell_through', code: 'unknown', label: 'sell through', scope: ['more_loaves'], answer: null, basis: 'Cannot yet be sized.' },
      { id: 'oven_price', code: 'asked', label: 'oven price', scope: ['within_budget'], answer: { quantity_id: 'oven_price' } },
    ]);
    // The goal waits only on what no one can size yet: never the needs-your-answer face; the why is their own basis, said once.
    for (const o of r.canonical_analysis_view.options as Json[]) {
      expect(o.cell.face, o.option_id).toBe('Chance not shown yet');
      expect(o.cell.why, o.option_id).toContain('‘base sales’, which no one can size yet (Not given yet) and ‘sell through’, which no one can size yet (Cannot yet be sized)');
    }
    // The AI sees the same list, typed, on its read context; the stored Run keeps it.
    expect(r.model_program.blockers).toEqual(waits.map((w) => ({ id: w.id, code: w.code, scope: w.scope })));
    expect((persisted!.living_model.runs.at(-1).result as Json).compile.blockers).toEqual(r.model_program.blockers);
    // The two unknowns have no question of the AI's, so the first reply counts them; the code writes none.
    expect(r.assistant_text).toContain('1. What would the second oven cost?');
    expect(r.assistant_text).toContain('The chance also waits on 2 other things, listed with the result.');
  });

  it('S1 follow-up: when the run computes, a chance held up only by an unknown is not "needs your answer" either (the run\'s own cells)', async () => {
    const none = { value: null, low: null, high: null, range_kind: null, question: null };
    // (a) The guardrail is calculable, the one goal waits on an unknown link: the run has no goal of its own (no-aim cell).
    const a = bakery();
    setQ(a, 'oven_price', { status: 'known', value: 2000, quote: 'The oven would cost £2,000', question: null });
    setQ(a, 'sell_through', { ...none, status: 'unknown', basis: 'Cannot yet be sized.' });
    replies = [JSON.stringify(a)];
    const ra = (await turn({ message: `${BRIEF} The oven would cost £2,000.` })).json();
    expect(ra.model_program.saved).toBe(true);
    expect(ra.canonical_analysis_view.goal_chance.waits_on).toEqual([{ id: 'sell_through', code: 'unknown', label: 'sell through', scope: ['more_loaves'], answer: null, basis: 'Cannot yet be sized.' }]);
    for (const o of ra.canonical_analysis_view.options as Json[]) expect([o.option_id, o.cell.face]).toEqual([o.option_id, 'Chance not shown yet']);
  });

  it('S1 follow-up: one goal computes while another waits on an unknown: the withheld cell is not "needs your answer"', async () => {
    const b = bakery();
    setQ(b, 'oven_price', { status: 'known', value: 2000, quote: 'The oven would cost £2,000', question: null });
    b.quantities.push(q('regulars', 'person', { status: 'unknown', author: 'olumi', basis: 'Not counted yet.' }), q('regulars_target', 'person', { value: 50, quote: 'want to reach 380 loaves a week' }));
    b.goals.push({ id: 'keep_regulars', label: 'Keep 50 regulars', measure: { quantity: 'regulars', per: null, cmp: '>=', target: 'regulars_target', frame: 'level', reference: null, aggregation: 'end',
      window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'want to reach 380 loaves a week', ...at });
    replies = [JSON.stringify(b)];
    const rb = (await turn({ message: `${BRIEF} The oven would cost £2,000.` })).json();
    expect(rb.model_program.saved).toBe(true);
    expect(rb.canonical_analysis_view.goal_chance.waits_on).toEqual([{ id: 'regulars', code: 'unknown', label: 'regulars', scope: ['keep_regulars'], answer: null, basis: 'Not counted yet.' }]);
    for (const o of rb.canonical_analysis_view.options as Json[]) expect([o.option_id, o.cell.face]).toEqual([o.option_id, 'Chance not shown yet']);
  });

  it('S1 follow-up contrast: a goal waiting on an asked figure of theirs keeps the needs-your-answer face and its answer box', async () => {
    const m = bakery();
    setQ(m, 'base_sales', { value: null, low: null, high: null, range_kind: null, status: 'asked', quote: null, question: 'How many loaves do you bake a week now?' });
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect((r.canonical_analysis_view.goal_chance.waits_on as Json[])[0]).toEqual({ id: 'base_sales', code: 'asked', label: 'base sales', scope: ['more_loaves'], answer: { quantity_id: 'base_sales' } });
    for (const o of r.canonical_analysis_view.options as Json[]) expect(o.cell.face, o.option_id).toBe('Not shown yet: needs your answer');
  });

  it('S1 follow-up (Codex on #3723): a window\'s own unknown figure is listed too, though it withholds through the window, not the closure', async () => {
    const m = club();
    setQ(m, 'months', { value: null, low: null, high: null, range_kind: null, question: null, status: 'unknown', quote: null, basis: 'Not given yet.' });
    m.limits[0]!.measure!.window = { origin_event: null, origin_offset: null, start: 0, periods: 'months' }; // a guardrail's window too
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: CLUB_BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.canonical_analysis_view.goal_chance.waits_on).toEqual([
      { id: 'months', code: 'unknown', label: 'months', scope: ['reach_340', 'within_budget'], answer: null, basis: 'Not given yet.' },
    ]);
    expect(r.model_program.blockers).toEqual([{ id: 'months', code: 'unknown', scope: ['reach_340', 'within_budget'] }]);
  });

  it('S1 (A4): with no aim at all, the first reply asks the AI\'s own question from its note on the situation, and no code question', async () => {
    const m = bakery();
    m.goals = [];
    // Codex r1 #3716: another note on the situation as a whole, with a question, is never taken for it; only the declared `aim`.
    m.left_out.push({ id: 'supplier', text: 'The flour supplier is not in the model.', why: 'Not given.', question: 'Who is your supplier?', concerns: [], author: 'olumi', quote: null, ...at },
      { id: 'aim', text: 'What a good result would be is not stated.', why: 'No aim was given.', question: 'What result would make this worth it for you?',
        concerns: [], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.assistant_text).toBe(['I\'ve drafted a first model of: Should the bakery buy a second oven?',
      '1. What result would make this worth it for you?\n2. What would the second oven cost?'].join('\n\n'));
    expect(r.model_program.blockers.map((b: Json) => [b.id, b.code])).toEqual([['(model)', 'no_goal'], ['oven_price', 'asked']]);
    expect(r.assistant_text).not.toContain('Who is your supplier?');
    // Contrast: without the AI's note the no-goal blocker has no words of anyone's, so it is counted, never worded by the code.
    const bare = bakery(); bare.goals = [];
    beforeEachReset();
    replies = [JSON.stringify(bare)];
    const b = (await turn({ message: BRIEF })).json();
    expect(b.assistant_text).toBe(['I\'ve drafted a first model of: Should the bakery buy a second oven?', '1. What would the second oven cost?',
      'The chance also waits on 1 other thing, listed with the result.'].join('\n\n'));
  });
});

function beforeEachReset() { SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); conversationIds.clear(); pausedRun = null; sent.length = 0; replies = []; }
