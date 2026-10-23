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
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { APPROXIMATE_FIGURE, type CanonicalModelT } from '../../model-program/canonical.js';
import { compile, isStructuralConstant, normalise } from '../../model-program/compile.js';
import { addMechanism, defineGoalMeasure, fillQuantity } from '../../model-program/answer.js';
import { project } from '../../model-program/project.js';
import { simulate } from '../../model-program/simulate/simulate.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX } from '../prompt.js';
import { evaluateCanonical, seedOf, RUN_DRAWS } from '../evaluate.js';
import { programReadOf, reopenProgram, savedProgramOf } from '../program-store.js';
import { applyProgramChange, ProgramChangeParams, proposeProgramChange, readProgramContext, runProgram } from '../program-tools.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { withNewRun } from '../program-save.js';
import { projectCorePostimageForPersistence } from '../../persisted-graph-projection.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { ENGINE_VERSIONS, revisionDigest, RUN_AGAIN_FOR_CHANCE } from '../run-receipt.js';
import { at, bakery, bakeryWithDefect, BRIEF, club, CLUB_BRIEF, q } from './bakery.fixture.js';

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
    expect(r.model_program.asks.map((a: Json) => a.quantity_id)).toEqual(['oven_price']);
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

  it('step 4b, an engine-version bump: the reopen still shows the ORIGINAL stored result, said as from an older engine', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const bumped = { ...ENGINE_VERSIONS, engine: `${ENGINE_VERSIONS.engine}-bumped` };
    const cold = reopenProgram(JSON.parse(JSON.stringify(persisted)), bumped)!;
    expect(stableStringify(cold.view)).toBe(stableStringify(r.canonical_analysis_view));
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

  it('step 5, an answer in chat (the agent\'s own tools: propose, then the person approves) fills exactly ONE quantity, in their words; a new Run', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    const firstRun = JSON.stringify(persisted!.living_model.runs[0]);
    sent.length = 0;
    const words = 'The oven would cost about £2,500.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words] };
    const op = { op: 'set_quantity' as const, quantity_id: 'oven_price', value: 2500, low: null, high: null, range_kind: null, quote: words };
    // Contrast first: a quote that is not the person's words is refused, and nothing is proposed.
    expect(await proposeProgramChange(deps, ctx, { public_label: 'Oven price', basis: 'their answer', ops: [{ ...op, quote: 'about £2,500 I think' }] }))
      .toMatchObject({ status: 'refused', reason: 'quote_not_in_their_words' });
    const proposed = await proposeProgramChange(deps, ctx, { public_label: 'Oven price £2,500', basis: 'their answer', ops: [op] }) as Json;
    expect(proposed.status).toBe('ok');
    expect(registered).toHaveLength(1); // proposing saves nothing
    const applied = await applyProgramChange(deps, ctx, proposed.data.proposal_id) as Json;
    expect(applied).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(sent).toHaveLength(0);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ status: 'known', value: 2500, low: null, high: null, author: 'person', quote: words, approval: 'approved', question: null });
    expect(after.quantities.filter((x) => x.id !== 'oven_price')).toEqual(before.quantities.filter((x) => x.id !== 'oven_price'));
    expect({ ...after, quantities: [], history: [] }).toEqual({ ...before, quantities: [], history: [] });
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

  it('THE WITNESS: a stock, a limit and one Olumi estimate, with known answers, through draft, an in-card change, a chat correction, Runs and cold reopens', async () => {
    replies = [JSON.stringify(club())];
    const drafted = (await turn({ message: CLUB_BRIEF })).json();
    expect(drafted.model_program.saved, JSON.stringify(drafted.model_program.compile?.errors ?? drafted.model_program.draft)).toBe(true);
    expect(drafted.model_program).toMatchObject({ readback: { read: true, canonical_identical: true, runs_identical: true, seed_identical: true } });
    const goalOf = (run: Json, option: string) => (run.result.chances as Json[]).find((o) => o.option_id === option)!.per_goal[0];
    const run1 = persisted!.living_model.runs[0] as Json;
    // Known answers on 10,000 draws: carry on exactly 0 (330 < 340); the promotion Φ(1.4434) = 0.92554 (Wilson half-width 0.0051).
    expect([goalOf(run1, 'carry_on').chance, goalOf(run1, 'carry_on').precision_95]).toEqual([0, [0, 0]]);
    expect(Math.abs(goalOf(run1, 'promotion').chance - 0.92554)).toBeLessThan(0.0075);
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
    expect(Math.abs(goalOf(run2, 'promotion').chance - 0.38641)).toBeLessThan(0.012);
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
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words] };
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Promotion effect 6 a month', basis: 'their experience',
      ops: [{ op: 'set_quantity', quantity_id: 'promo_effect', value: 6, low: null, high: null, range_kind: null, quote: 'a promotion brings 6 more a month' }] }) as Json;
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
    const ctx2 = { ...ctx, verified_user_messages: [later] };
    const stale = await proposeProgramChange(deps, ctx2, { public_label: 'Budget £450', basis: 'they said so',
      ops: [{ op: 'set_quantity', quantity_id: 'budget', value: 450, low: null, high: null, range_kind: null, quote: 'we can only spend £450' }] }) as Json;
    await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'leavers', value: 11 } });
    const saves = registered.length;
    expect(await applyProgramChange(deps, ctx2, stale.data.proposal_id)).toMatchObject({ status: 'refused' });
    expect(registered.length).toBe(saves);
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

  it('an approximate answer ("about £2,500") is the person\'s figure, used for now: NO range is read into "about"; a range is asked for, and the words say so', () => {
    const words = 'It would cost about £2,500.';
    const f = fillQuantity(bakery(), 'oven_price', { value: 2500, low: 2250, high: 2750 }, words);
    if (!f.ok) throw new Error(f.reason);
    const oven = f.model.quantities.find((x) => x.id === 'oven_price')!;
    expect(oven).toMatchObject({ value: 2500, low: null, high: null, range_kind: null, author: 'person', quote: words, basis: APPROXIMATE_FIGURE });
    const r = compile(f.model, { sourceText: `${BRIEF}\n${words}` });
    expect(r.asks.find((a) => a.quantity_id === 'oven_price')!.question).toBe('You said "It would cost about £2,500." for "oven price". What range would you put on it? Olumi is using 2500 GBP/oven for now.');
    expect(r.within_limits.status).toBe('calculable'); // the range asked for holds nothing back
    expect(r.conversions.some((c) => c.quantity === 'oven_price')).toBe(false);
    const view = evaluateCanonical(f.model, { sourceText: `${BRIEF}\n${words}`, seed: 7 }).view as Json;
    expect(JSON.stringify(view)).toContain('using £2,500 / oven for ‘oven price’ for now — you said ‘It would cost about £2,500.’');
    expect(JSON.stringify(view)).not.toContain('your range');
    expect(JSON.stringify(view)).not.toContain('as you stated it');
    // Contrast: the ends in their own words are their range, read as theirs.
    const ranged = fillQuantity(bakery(), 'oven_price', { value: null, low: 2250, high: 2750, range_kind: 'bounds' }, 'between £2,250 and £2,750');
    if (!ranged.ok) throw new Error(ranged.reason);
    expect(ranged.model.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ low: 2250, high: 2750, range_kind: 'bounds', basis: null });
    // A range their words do not state, with no figure of theirs, is refused: never Olumi's range presented as their answer.
    expect(fillQuantity(bakery(), 'oven_price', { value: null, low: 2250, high: 2750 }, 'about £2,500')).toMatchObject({ ok: false });
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
    expect(model.options[0].sets.map((x: Json) => x.from_period)).toEqual([0, 0]);
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
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const asked = { author: 'person', status: 'asked', value: null, question: 'What is "current output"?' };
    expect(persisted!.living_model.canonical.quantities.find((x: Json) => x.id === 'current_output')).toMatchObject(asked);
    vi.resetModules();
    const tools = await import('../program-tools.js');
    const read = await tools.readProgramContext({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null }) as Json;
    expect((read.data.model as Json).quantities.find((x: Json) => x.id === 'current_output')).toMatchObject({ author: 'person', status: 'asked', question: 'What is "current output"?' });
    expect(JSON.stringify(read.data.model)).not.toMatch(/"id":"current_output"[^}]*"author":"structure"/);
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
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make it 11 leaving each month.'] };
    const read = await readProgramContext(deps, ctx) as Json;
    expect(stableStringify(read.data.run.goal_chance)).toBe(stableStringify(goalChance()));
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Leavers 11', basis: 'they said so',
      ops: [{ op: 'set_quantity', quantity_id: 'leavers', value: 11, low: null, high: null, range_kind: null, quote: '11 leaving each month' }] }) as Json;
    const frozen = (deps.proposals.get(p.data.proposal_id)!.living_model as Json).runs.at(-1).result.canonical_analysis_view.goal_chance;
    expect(stableStringify(p.data.would_show.goal_chance)).toBe(stableStringify(frozen));
    const a = await applyProgramChange(deps, ctx, p.data.proposal_id) as Json;
    expect(stableStringify(a.data.run.goal_chance)).toBe(stableStringify(goalChance()));
    const run = await runProgram(deps, ctx) as Json;
    expect([run.data.stored, stableStringify(run.data.run.goal_chance)]).toEqual([true, stableStringify(goalChance())]);
  });

  it('an open question on how to read a range (set_range_kind) is answerable by the agent\'s own op: the range, its words and its author stay; the answer is in history', async () => {
    const brief = `${BRIEF} Each extra oven brings between 80 and 120 loaves a week.`;
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, value: null, low: 80, high: 120, range_kind: null, quote: 'between 80 and 120 loaves a week' } : x));
    replies = [JSON.stringify(m)];
    const drafted = (await turn({ message: brief })).json();
    expect(drafted.model_program.asks.find((x: Json) => x.quantity_id === 'extra_per_oven')).toMatchObject({ edit: { op: 'set_range_kind', quantity_id: 'extra_per_oven' } });
    const words = 'Those are firm ends: never fewer than 80, never more than 120.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words] };
    // The args as the agent's tool schema admits them (the SDK parses every call with it).
    const args = ProgramChangeParams.parse({ public_label: 'Read 80–120 as firm', basis: 'their answer',
      ops: [{ op: 'set_range_kind', quantity_id: 'extra_per_oven', range_kind: 'bounds', quote: 'Those are firm ends' }] });
    const p = await proposeProgramChange(deps, ctx, args) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = (persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'extra_per_oven')!;
    expect(after).toMatchObject({ low: 80, high: 120, range_kind: 'bounds', author: 'person', quote: 'between 80 and 120 loaves a week' });
    expect((persisted!.living_model.canonical as CanonicalModelT).history.at(-1)).toMatchObject({ id: 'extra_per_oven', change: 'superseded', quote: 'Those are firm ends' });
    const asks = (persisted!.living_model.runs.at(-1).result.compile as Json).asks as Json[];
    expect(asks.some((x) => x.quantity_id === 'extra_per_oven')).toBe(false);
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

  it('DL 23 Oct (batch 1 + batch 4): an aim with no deadline never states "no deadline" as a fact; it says none is recorded yet and asks; a % target is said in %', () => {
    const goalWords = (m: CanonicalModelT, text: string) => String(((evaluateCanonical(m, { sourceText: text, seed: 7 }).view as Json).goal_chance as Json).chance_words);
    // The bakery's aim states no window: read once with every option in effect, and said so.
    const noDeadline = goalWords(bakery(), BRIEF);
    expect(noDeadline).toContain('‘sales’ being at least 380 loaf / week with no deadline recorded yet');
    expect(((evaluateCanonical(bakery(), { sourceText: BRIEF, seed: 7 }).view as Json).goal_chance as Json).notes).toContain('No deadline is recorded yet for ‘Reach 380 loaves a week’: is there one?');
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

  it('DL 23 Oct: an aim with no measure gets the one the person states (define_goal_measure), in their words; what they did not state stays asked', async () => {
    const m = bakery();
    m.goals = [{ ...m.goals[0]!, measure: null, question: 'How would you know the bakery is doing well enough?' }];
    replies = [JSON.stringify(m)];
    const drafted = (await turn({ message: BRIEF })).json();
    expect(drafted.model_program.saved).toBe(true);
    expect((persisted!.living_model.runs.at(-1).result.compile as Json).coaching).toEqual([expect.objectContaining({ record_id: 'more_loaves', kind: 'measure' })]);
    const words = 'Success means selling at least 380 loaves a week within 4 weeks.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words] };
    const op = { op: 'define_goal_measure', goal_id: 'more_loaves', quantity: 'sales', cmp: '>=', frame: null,
      target: { value: 380, low: null, high: null, range_kind: null }, window: { periods: 4, start: 0 }, leaves_out: [], quote: words };
    const propose = (o: Json) => proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Measure the aim', basis: 'their answer', ops: [o] })) as Promise<Json>;
    // Negatives first: a target or a deadline their words do not state is refused (never inferred), and nothing is proposed.
    // Codex r2 #3709: each figure in its own role: "within 4 weeks" is the deadline, never a target of 4; 380 loaves is never a deadline.
    for (const wrong of [{ ...op, target: { value: 400, low: null, high: null, range_kind: null } }, { ...op, window: { periods: 6, start: 0 } },
      { ...op, target: { value: 4, low: null, high: null, range_kind: null } }, { ...op, window: { periods: 380, start: 0 } }]) {
      const r = await propose(wrong);
      expect(r.status, JSON.stringify(r)).not.toBe('ok');
      expect(JSON.stringify(r)).toMatch(/do not state that (target|deadline)/);
    }
    const p = await propose(op);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.goals[0]).toMatchObject({ measure: { quantity: 'sales', cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null,
      window: { start: 0, periods: 'more_loaves_window' }, measure_by: 'person' }, question: null });
    expect(after.quantities.find((x) => x.id === 'more_loaves_target')).toMatchObject({ value: 380, unit: 'loaf/week', author: 'person', quote: words, status: 'known' });
    expect(after.quantities.find((x) => x.id === 'more_loaves_window')).toMatchObject({ value: 4, unit: 'week', author: 'person', quote: words });
    expect(after.history.at(-1)).toMatchObject({ id: 'more_loaves', change: 'superseded', quote: words });
    // The new Run can now work out the aim: each option's chance of it is shown, and the measure question is gone.
    const run = persisted!.living_model.runs.at(-1).result as Json;
    expect((run.canonical_analysis_view as Json).options.map((o: Json) => o.cell.kind)).toEqual(['figure', 'figure']);
    expect((run.compile as Json).coaching).toEqual([]);

    // Unstated target: it is ASKED, the aim waits for it; a new measure they named is theirs, held until the model works it out.
    const asked = defineGoalMeasure(m, { goal_id: 'more_loaves', quantity: 'sales', cmp: '>=', frame: null, target: null, window: null, quote: 'by how many loaves we sell' });
    expect(asked.ok).toBe(true);
    const askedModel = (asked as { model: CanonicalModelT }).model;
    expect(askedModel.quantities.find((x) => x.id === 'more_loaves_target')).toMatchObject({ status: 'asked', value: null, quote: null });
    expect(compile(askedModel, { sourceText: `${BRIEF}\nby how many loaves we sell` }).asks.map((x) => x.quantity_id)).toContain('more_loaves_target');
    const named = defineGoalMeasure(m, { goal_id: 'more_loaves', quantity: { label: 'Repeat customers', unit: 'customer/week' }, cmp: '>=', frame: null,
      target: { value: 50, low: null, high: null, range_kind: null }, window: null, quote: 'at least 50 repeat customers a week' });
    const namedModel = (named as { model: CanonicalModelT }).model;
    expect(namedModel.quantities.find((x) => x.id === 'repeat_customers')).toMatchObject({ status: 'unknown', author: 'person', quote: 'at least 50 repeat customers a week' });
    expect(compile(namedModel, { sourceText: `${BRIEF}\nat least 50 repeat customers a week` }).perGoal[0]).toMatchObject({ status: 'withheld' });

    // Codex r2 #3709: a figure is theirs only as written for that quantity. A £ amount is bound by its currency prefix; a
    // figure in another unit (60 kg) or another quantity's (4 weeks, 2 months on a weekly model) is refused, never borrowed.
    const define = (quote: string, target: number | null, window: number | null, quantity = 'sales', leaves_out: string[] = []) => defineGoalMeasure(m, { goal_id: 'more_loaves', quantity, cmp: quantity === 'spend' ? '<=' : '>=', frame: null,
      target: target === null ? null : { value: target, low: null, high: null, range_kind: null }, window: window === null ? null : { periods: window, start: 0 }, quote, leaves_out });
    const money = 'Success means spending at most £2,500 within 4 weeks.';
    expect(define(money, 2500, 4, 'spend')).toMatchObject({ ok: true });
    expect(((define(money, 2500, 4, 'spend') as { model: CanonicalModelT }).model.quantities.find((x) => x.id === 'more_loaves_target'))).toMatchObject({ value: 2500, unit: 'GBP', author: 'person' });
    expect(define(money, 4, 4, 'spend')).toMatchObject({ ok: false, reason: expect.stringMatching(/do not state that target/) });
    const mixed = 'At least 380 loaves a week, about 60 kg of bread, within 4 weeks.';
    expect(define(mixed, 380, 4, 'sales', ['about 60 kg of bread'])).toMatchObject({ ok: true });
    expect(define(mixed, 60, 4)).toMatchObject({ ok: false, reason: expect.stringMatching(/do not state that target/) });
    expect(define('At least 380 loaves a week within 2 months.', 380, 2)).toMatchObject({ ok: false, reason: expect.stringMatching(/do not state that deadline in weeks/) });
  });

  it('DL 23 Oct (batch 4 marketing-r2, r7 re-scope): what a measure leaves out is kept in their words and named; the chance says what it covers and what it leaves out, never that it covers everything', () => {
    const m = bakery();
    m.goals = [{ ...m.goals[0]!, measure: null, question: 'What would success look like?' }];
    const words = 'Success means selling at least 380 loaves a week and 50 new regulars within 4 weeks.';
    const op = { goal_id: 'more_loaves', quantity: 'sales', cmp: '>=' as const, frame: null, target: { value: 380, low: null, high: null, range_kind: null }, window: { periods: 4, start: 0 }, quote: words };
    expect(defineGoalMeasure(m, { ...op, leaves_out: ['60 new regulars'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/is not in their words/) });
    const done = defineGoalMeasure(m, { ...op, leaves_out: ['50 new regulars'] });
    expect(done.ok).toBe(true);
    const dm = (done as { model: CanonicalModelT }).model;
    expect(dm.left_out.at(-1)).toMatchObject({ id: 'more_loaves_leaves_out', text: '50 new regulars', author: 'person', quote: '50 new regulars', concerns: ['more_loaves'] });
    expect(dm.goals[0]!.measure!.exclusions).toEqual(['more_loaves_leaves_out']);
    const notes = (model: CanonicalModelT) => (((evaluateCanonical(model, { sourceText: `${BRIEF}\n${words}`, seed: 7 }).view as Json).goal_chance as Json).notes as string[]);
    expect(notes(dm).some((n) => /^Covers: ‘sales’ being at least 380 loaf \/ week .* · Leaves out: ‘50 new regulars’$/.test(n))).toBe(true);
    // A deadline they stated that the model cannot hold yet is named as left out, and never asked for again.
    const late = defineGoalMeasure(m, { ...op, window: null, leaves_out: ['50 new regulars', 'within 4 weeks'] });
    expect(late.ok).toBe(true);
    const ln = notes((late as { model: CanonicalModelT }).model);
    expect(ln.some((n) => n.endsWith('Leaves out: ‘50 new regulars’ and ‘within 4 weeks’'))).toBe(true);
    expect(ln.some((n) => n.includes('is there one?'))).toBe(false);
    // Codex r7: an equal figure is never read as covered. "380 new regulars" beside a 380 target is not claimed: the chance
    // names only the measured target it uses, and says nothing about what it does not hold.
    const same = 'Success means selling at least 380 loaves a week and 380 new regulars within 4 weeks.';
    const coincident = defineGoalMeasure(m, { ...op, quote: same, leaves_out: [] });
    expect(coincident.ok).toBe(true);
    const gc = (evaluateCanonical((coincident as { model: CanonicalModelT }).model, { sourceText: `${BRIEF}\n${same}`, seed: 7 }).view as Json).goal_chance as Json;
    expect(JSON.stringify(gc)).not.toContain('regulars');
    expect((gc.notes as string[]).some((n) => n.startsWith('Covers:'))).toBe(false);
  });

  it('DL 23 Oct (batch 4 hiring 5/5): an edit with no op is left off the card and said on it; the rest is proposed; the approval applies exactly the card', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const words = 'The oven would cost £2,500, and code quality is judged by review comments.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words] });
    const price = { op: 'set_quantity', quantity_id: 'oven_price', value: 2500, low: null, high: null, range_kind: null, quote: 'The oven would cost £2,500' };
    const limitMeasure = { op: 'define_goal_measure', goal_id: 'within_budget', quantity: { label: 'Review comments', unit: 'comment' }, cmp: '<=', frame: null, target: null, window: null, leaves_out: [], quote: 'code quality is judged by review comments' };
    const propose = (ops: Json[], c = ctx()) => proposeProgramChange(deps, c, ProgramChangeParams.parse({ public_label: 'Your answers', basis: 'their answers', ops })) as Promise<Json>;
    // All of it inapplicable: no card, only the words.
    expect(await propose([limitMeasure])).toMatchObject({ status: 'refused', reason: 'edit_not_applicable', detail: 'I can\'t record a measure for a limit yet; it stays a note.' });
    // Mixed: the card holds the price only, and says what it leaves off.
    const c = ctx();
    const card = await propose([price, limitMeasure], c);
    expect(card.status, JSON.stringify(card)).toBe('ok');
    expect(card.data.not_included).toEqual(['I can\'t record a measure for a limit yet; it stays a note.']);
    const p = deps.proposals.get(card.data.proposal_id)!;
    expect(p.public_label).toBe('Your answers (not on this card: I can\'t record a measure for a limit yet; it stays a note.)');
    expect(p.operations.map((o) => o.path)).toEqual(['quantity:oven_price']);
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    expect(await applyProgramChange(deps, c, card.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ value: 2500, author: 'person' });
    expect(after.limits).toEqual(before.limits);
  });

  it('DL 23 Oct (mechanism completion, the alpha3 hiring read): the measure they name gets Olumi\'s mechanism on the same card; their 10% and deadline go back onto the aim; a figure only they know is ASKED, then the chance appears', async () => {
    const saved = JSON.parse(readFileSync(new URL('./hiring-alpha3.saved.json', import.meta.url), 'utf8')) as { brief: string; canonical: CanonicalModelT };
    replies = [JSON.stringify(saved.canonical)];
    expect((await turn({ message: saved.brief })).json().model_program.saved).toBe(true);
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    expect(before.goals.find((g) => g.id === 'increase_productivity')!.measure).toBeNull(); // costs-only: the aim has no measure
    const words = 'We measure productivity by the features we ship each month.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words] };
    const op = { op: 'define_goal_measure', goal_id: 'increase_productivity', quantity: { label: 'Features shipped per month', unit: 'feature/month' }, cmp: '>=', frame: 'change_rel',
      target: 'productivity_increase_target', window: { periods: 'launch_horizon', start: 0 }, leaves_out: [], quote: words };
    // Each attempt is its own turn (a turn shows one card).
    const propose = () => proposeProgramChange(deps, { ...ctx, turn_id: randomUUID() }, ProgramChangeParams.parse({ public_label: 'Measure productivity', basis: 'their answer', ops: [op] })) as Promise<Json>;
    // The drafter's whole model again, plus what works the measure out (synthetic Olumi figures, never a test sheet's).
    const measured = defineGoalMeasure(before, op as never);
    expect(measured.ok).toBe(true);
    const completed = (extra: Partial<CanonicalModelT> = {}): string => {
      const m = JSON.parse(JSON.stringify((measured as { model: CanonicalModelT }).model)) as CanonicalModelT;
      // It also rewrites one of their figures and an option's name: additions only are taken, so both stay as they were.
      m.quantities = m.quantities.map((x) => (x.id === 'features_shipped_per_month' ? { ...x, kind: 'derived', status: 'derived', basis: null } : x.id === 'hiring_budget' ? { ...x, value: 150000 } : x));
      m.options = m.options.map((o) => ({ ...o, label: `${o.label} (Olumi)` }));
      m.quantities.push(
        q('features_now', 'feature/month', { status: 'asked', question: 'How many features does the team ship in a month now?' }),
        q('lead_effect', 'feature/month/tech_lead', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 2, low: 0, high: 4, range_kind: 'plausible', basis: 'A lead mostly unblocks others; the size varies widely.' }),
        q('developer_effect', 'feature/month/developer', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 1, low: 0.3, high: 1.5, range_kind: 'plausible', basis: 'A new developer adds less than an experienced one while ramping up.' }));
      m.relations.push({ form: 'effect', id: 'features_rel', defines: 'features_shipped_per_month', base: 'features_now', author: 'olumi', quote: null, ...at,
        terms: [{ driver: 'tech_leads_hired', coefficient: 'lead_effect', author: 'olumi', quote: null, ...at }, { driver: 'developers_hired', coefficient: 'developer_effect', author: 'olumi', quote: null, ...at }] });
      // Its companion notes on the new link: an assumption, and the claim that assumption names.
      m.claims.push({ id: 'leads_unblock', text: 'A lead mostly raises output by unblocking the others.', concerns: ['lead_effect'], author: 'olumi', quote: null, ...at });
      m.assumptions.push({ id: 'hires_productive_in_window', text: 'New hires are productive within the launch window.', applied: true, concerns: ['features_rel', 'leads_unblock'], author: 'olumi', quote: null, ...at });
      // A chain to closure: a claim about the new link, and a condition about that claim only (R ← K ← C).
      m.claims.push({ id: 'lead_needs_scope', text: 'A lead helps most once the launch scope is clear.', concerns: ['features_rel'], author: 'olumi', quote: null, ...at });
      m.conditions.push({ id: 'scope_agreed_first', text: 'Only once the launch scope is agreed.', kind: 'prerequisite', concerns: ['lead_needs_scope'], author: 'olumi', quote: null, ...at });
      // Unrelated to what is added: never taken.
      m.claims.push({ id: 'office_is_noisy', text: 'The office is noisy.', concerns: [], author: 'olumi', quote: null, ...at });
      return JSON.stringify({ ...m, ...extra });
    };
    const reply = (edit: (m: CanonicalModelT) => void) => { const m = JSON.parse(completed()) as CanonicalModelT; edit(m); return JSON.stringify(m); };
    const noCompletion = async (why: string, body: string, calls = 1) => {
      replies = Array.from({ length: calls }, () => body);
      sent.length = 0;
      const r = await propose();
      expect(r.status, `${why}: ${JSON.stringify(r)}`).toBe('ok');
      expect(sent).toHaveLength(calls);
      expect(r.data.olumi_adds, why).toBeUndefined();
      expect(savedProgramOf({ living_model: deps.proposals.get(r.data.proposal_id)!.living_model })!.canonical.relations, why).toEqual(before.relations);
    };
    // Codex r4 #3709: a figure labelled structure that is no structural constant ("current output = 12", stated by no one)
    // comes back as the person's question, never Olumi's figure; a calendar conversion (12 month/year) stays structural.
    const asStructure = reply((d) => { d.quantities.push(q('current_output', 'feature/month', { author: 'structure', value: 12 }), q('months_per_year', 'month/year', { author: 'structure', value: 12 }));
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'current_output'; });
    const structured = addMechanism((measured as { model: CanonicalModelT }).model, JSON.parse(asStructure) as CanonicalModelT, 'features_shipped_per_month',
      new Set(['features_shipped_per_month']), () => false);
    expect(structured.ok).toBe(true);
    const sm = (structured as { model: CanonicalModelT }).model;
    expect(sm.quantities.find((x) => x.id === 'current_output')).toMatchObject({ author: 'person', status: 'asked', value: null, quote: null, question: 'What is "current output"?' });
    expect(sm.quantities.find((x) => x.id === 'months_per_year')).toMatchObject({ author: 'structure', status: 'known', value: 12 });
    expect(compile(sm, { sourceText: `${saved.brief}\n${words}` }).perGoal.find((g) => g.goal_id === 'increase_productivity')!.asks).toContain('current_output');
    // Codex r5: 1 in unit "1" is no unit scale, so an unstated "current utilisation = 1" is not structural; 0/1 is, only as a
    // live option's switch; 100 % (a unit's scale) still is.
    const base = (measured as { model: CanonicalModelT }).model;
    expect(isStructuralConstant(base, q('current_utilisation', '1', { author: 'structure', value: 1 }))).toBe(false);
    expect(isStructuralConstant(base, q('tech_leads_hired', 'tech_lead', { author: 'structure', value: 1 }))).toBe(true);
    expect(isStructuralConstant(base, q('percent_scale', '%', { author: 'structure', value: 100 }))).toBe(true);
    const util = addMechanism(base, JSON.parse(reply((d) => { d.quantities.push(q('current_utilisation', '1', { author: 'structure', value: 1 })); })) as CanonicalModelT,
      'features_shipped_per_month', new Set(['features_shipped_per_month']), () => false);
    expect((util as { model: CanonicalModelT }).model.quantities.find((x) => x.id === 'current_utilisation')).toMatchObject({ status: 'asked', author: 'person', value: null });
    // Codex r6, the same reading as the first draft: a 1 as the effect's base ("current features = 1") is their question, or
    // their figure where its quote is in their words; a × 1 factor stays Olumi's constant.
    const complete = (edit: (d: CanonicalModelT) => void, isTheirs: (quote: string | null) => boolean = () => false) =>
      addMechanism(base, JSON.parse(reply(edit)) as CanonicalModelT, 'features_shipped_per_month', new Set(['features_shipped_per_month']), isTheirs) as { ok: boolean; model: CanonicalModelT };
    const onBase = (quote: string | null, value: number) => (d: CanonicalModelT) => { d.quantities.push(q('current_features', 'feature/month', { author: 'structure', value, quote }));
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'current_features'; };
    expect(complete(onBase(null, 1)).model.quantities.find((x) => x.id === 'current_features')).toMatchObject({ status: 'asked', author: 'person', value: null });
    // Codex r7: never read as theirs, even with their words beside it: a figure labelled structure is always asked.
    const told = `${words} We ship 4 features a month.`;
    expect(complete(onBase('We ship 4 features a month', 4), (x) => x !== null && told.includes(x)).model.quantities.find((x) => x.id === 'current_features'))
      .toMatchObject({ status: 'asked', author: 'person', value: null, quote: null });
    const times1 = complete((d) => {
      d.quantities.push(q('features_scale', '1', { author: 'structure', value: 1 }), q('features_base', 'feature/month', { kind: 'derived', status: 'derived', author: 'olumi' }));
      d.relations.push({ form: 'definition', id: 'features_base_rel', defines: 'features_base', op: 'product', parts: [{ id: 'features_now', power: 1 }, { id: 'features_scale', power: 1 }], author: 'olumi', quote: null, ...at });
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'features_base';
    });
    expect(times1.ok).toBe(true);
    expect(times1.model.quantities.find((x) => x.id === 'features_scale')).toMatchObject({ author: 'structure', status: 'known', value: 1 });
    // Refused whole: a note naming a record that is not there (its sentence goes back for the drafter's two repairs first).
    await noCompletion('dangling note', reply((m) => { m.assumptions[m.assumptions.length - 1]!.concerns.push('no_such_record'); }), 3);
    // Only the measure this same answer created may be worked out: never a quantity already in the model.
    const existing = { ...(measured as { model: CanonicalModelT }).model };
    expect(addMechanism(existing, JSON.parse(completed()) as CanonicalModelT, 'features_shipped_per_month', new Set(), () => false))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/named in this same answer/) });
    // Nor a figure they stated in this same answer (new, but known): only the blank placeholder of the measure.
    const statedNow = { ...existing, quantities: [...existing.quantities, q('stated_now', 'feature/month', { value: 12, quote: words })] };
    const onStated = reply((d) => { d.quantities.push(q('stated_now', 'feature/month', { value: 12, quote: words })); (d.relations.find((r) => r.id === 'features_rel') as { defines: string }).defines = 'stated_now'; });
    expect(addMechanism(statedNow, JSON.parse(onStated) as CanonicalModelT, 'stated_now', new Set(['stated_now']), () => false))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/named in this same answer/) });

    // Negative: a completion that INVENTS a figure only they know (today's level as theirs) is refused whole; the card holds
    // only their measure, which nothing works out yet, so no chance is claimed.
    const invented = JSON.parse(completed()) as CanonicalModelT;
    invented.quantities = invented.quantities.map((x) => (x.id === 'features_now' ? { ...x, status: 'known', value: 12, question: null, quote: 'about 12 a month' } : x));
    replies = [JSON.stringify(invented)];
    sent.length = 0;
    const refusedCard = await propose();
    expect(refusedCard.status, JSON.stringify(refusedCard)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(refusedCard.data.olumi_adds).toBeUndefined();
    const heldModel = savedProgramOf({ living_model: deps.proposals.get(refusedCard.data.proposal_id)!.living_model })!.canonical;
    expect(heldModel.relations).toEqual(before.relations);
    expect(compile(heldModel, { sourceText: `${saved.brief}\n${words}` }).perGoal.find((g) => g.goal_id === 'increase_productivity')).toMatchObject({ status: 'withheld' });

    // The completion: one drafter call; Olumi's parts are visibly Olumi's and provisional, with a basis; the person's
    // figure it needs is a question; their 10% and their three months are the aim's target and window again.
    replies = [completed()];
    sent.length = 0;
    const card = await propose();
    expect(card.status, JSON.stringify(card)).toBe('ok');
    expect(sent).toHaveLength(1);
    const adds = ['relation:features_rel', 'quantity:features_now', 'quantity:lead_effect', 'quantity:developer_effect', 'assumption:hires_productive_in_window',
      'condition:scope_agreed_first', 'claim:leads_unblock', 'claim:lead_needs_scope'];
    expect(card.data.olumi_adds).toEqual(adds);
    expect(deps.proposals.get(card.data.proposal_id)!.operations.map((o) => o.path)).toEqual(['goal:increase_productivity', ...adds]);
    expect(registered).toHaveLength(1); // proposing saves nothing
    expect(await applyProgramChange(deps, ctx, card.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(deps.proposals.get(card.data.proposal_id)!.living_model));
    expect(after.goals.find((g) => g.id === 'increase_productivity')!.measure).toMatchObject({ quantity: 'features_shipped_per_month', target: 'productivity_increase_target', frame: 'change_rel',
      window: { start: 0, periods: 'launch_horizon' }, measure_by: 'person' });
    expect(after.quantities.find((x) => x.id === 'features_shipped_per_month')).toMatchObject({ kind: 'derived', status: 'derived', author: 'person', quote: words });
    expect(after.quantities.find((x) => x.id === 'features_now')).toMatchObject({ status: 'asked', value: null, author: 'person', quote: null });
    for (const id of ['lead_effect', 'developer_effect']) expect(after.quantities.find((x) => x.id === id)).toMatchObject({ author: 'olumi', status: 'estimated', approval: 'proposed', basis: expect.any(String) });
    expect(after.relations.find((r) => r.id === 'features_rel')).toMatchObject({ author: 'olumi', approval: 'proposed' });
    expect(after.assumptions.at(-1)).toMatchObject({ id: 'hires_productive_in_window', author: 'olumi', approval: 'proposed', concerns: ['features_rel', 'leads_unblock'] });
    expect(after.claims.slice(before.claims.length).map((x) => [x.id, x.author, x.approval])).toEqual([['leads_unblock', 'olumi', 'proposed'], ['lead_needs_scope', 'olumi', 'proposed']]);
    expect(after.conditions.slice(before.conditions.length).map((x) => x.id)).toEqual(['scope_agreed_first']);
    // Everything they had stays as it was: every earlier record, its author and words, and the history (two new entries).
    expect(after.quantities.filter((x) => before.quantities.some((b) => b.id === x.id) && x.id !== 'features_shipped_per_month')).toEqual(before.quantities);
    expect(after.relations.slice(0, before.relations.length)).toEqual(before.relations);
    expect(after.assumptions.slice(0, before.assumptions.length)).toEqual(before.assumptions);
    expect(after.claims.slice(0, before.claims.length)).toEqual(before.claims);
    expect(after.conditions.slice(0, before.conditions.length)).toEqual(before.conditions);
    expect({ ...after, quantities: [], relations: [], goals: [], history: [], assumptions: [], claims: [], conditions: [] }).toEqual({ ...before, quantities: [], relations: [], goals: [], history: [], assumptions: [], claims: [], conditions: [] });
    expect(after.history.slice(0, before.history.length)).toEqual(before.history);
    expect(after.history.slice(before.history.length).map((h) => h.id)).toEqual(['increase_productivity', 'features_shipped_per_month']);
    // An option → outcome path now: the aim waits on exactly the one figure only they know, never on a guess.
    const waiting = compile(after, { sourceText: persisted!.living_model.person_words.join('\n') });
    expect(waiting.errors).toEqual([]);
    expect(waiting.perGoal.find((g) => g.goal_id === 'increase_productivity')).toMatchObject({ status: 'asks', asks: ['features_now'] });
    expect(waiting.asks.map((a) => a.quantity_id)).toContain('features_now');

    // Their answer to that question: each option's chance of the aim appears.
    const now = 'We ship about 12 features a month now.';
    const ctx2 = { ...ctx, turn_id: randomUUID(), verified_user_messages: [now] };
    const fill = await proposeProgramChange(deps, ctx2, { public_label: 'Features now', basis: 'their answer', ops: [{ op: 'set_quantity', quantity_id: 'features_now', value: 12, low: null, high: null, range_kind: null, quote: now }] }) as Json;
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
    await turn({ message: BRIEF });
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
    // The same edit resent: answered from what is saved, never applied twice.
    const saves = registered.length;
    const again = await edit(figure, id);
    expect([again.statusCode, again.json().durability, registered.length]).toEqual([200, 'replayed', saves]);

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
    // Outside the range: refused with the question, nothing saved, no new Run.
    const saves = registered.length;
    const out = await edit(60);
    expect(out.statusCode).toBe(409);
    expect(out.json().error).toMatchObject({ code: 'CANVAS_EDIT_REFUSED', nothing_saved: true, message: '60 is outside your range of 80–120. Change the range as well?' });
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

  it('Codex r4–r6 + buddy #3709: ONE structural admission on the first draft — 0 is the only additive identity, 1 only a product\'s factor or divisor; a figure in their words is theirs; any other is their question', () => {
    const saved = JSON.parse(readFileSync(new URL('./hiring-alpha3.saved.json', import.meta.url), 'utf8')) as { brief: string; canonical: CanonicalModelT };
    const m = JSON.parse(JSON.stringify(saved.canonical)) as CanonicalModelT;
    const derived = (id: string, unit: string) => q(id, unit, { kind: 'derived', status: 'derived', author: 'olumi' });
    const product = (id: string, defines: string, parts: [string, 1 | -1][]) => ({ form: 'definition' as const, id, defines, op: 'product' as const, parts: parts.map(([pid, power]) => ({ id: pid, power })), author: 'olumi' as const, quote: null, ...at });
    m.quantities.push(q('current_output', 'feature/month', { author: 'structure', value: 12 }), q('months_per_year', 'month/year', { author: 'structure', value: 12 }),
      q('current_utilisation', '1', { author: 'structure', value: 1 }), q('no_extra_output', 'feature/month', { author: 'structure', value: 0 }), derived('extra_output', 'feature/month'),
      // Codex r6: an unstated "current customers = 1" added in a sum is the person's figure, not an identity.
      q('current_customers', 'customer', { author: 'structure', value: 1 }), q('new_customers', 'customer', { author: 'structure', value: 0 }), derived('customers', 'customer'),
      // × 1 (the hiring read's declared normalisation: one output unit per developer) and the "per one" a product divides by.
      q('output_per_developer', 'feature/month/developer', { author: 'structure', value: 1 }), derived('team_output', 'feature/month'),
      q('one_customer', 'customer', { author: 'structure', value: 1 }), derived('output_per_customer', 'feature/month/customer'),
      // Codex r7: a 1 added in a sum is never an identity, even unit-free ("1 + growth").
      q('one', '1', { author: 'structure', value: 1 }), q('growth', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.1, low: 0, high: 0.2, range_kind: 'plausible', basis: 'Synthetic.' }), derived('growth_factor', '1'));
    m.relations.push({ form: 'definition', id: 'extra_output_rel', defines: 'extra_output', op: 'sum', parts: [{ id: 'no_extra_output', sign: 1 }, { id: 'current_output', sign: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'customers_rel', defines: 'customers', op: 'sum', parts: [{ id: 'current_customers', sign: 1 }, { id: 'new_customers', sign: 1 }], author: 'olumi', quote: null, ...at },
      product('team_output_rel', 'team_output', [['current_developers', 1], ['output_per_developer', 1]]),
      product('per_customer_rel', 'output_per_customer', [['extra_output', 1], ['one_customer', -1]]),
      { form: 'definition', id: 'growth_rel', defines: 'growth_factor', op: 'sum', parts: [{ id: 'one', sign: 1 }, { id: 'growth', sign: 1 }], author: 'olumi', quote: null, ...at });
    const n = new Map(normalise(m).quantities.map((x) => [x.id, x] as const));
    // Asked: an integer no one stated, the identity 1 in unit "1", and a 1 added in a sum.
    for (const id of ['current_output', 'current_utilisation', 'current_customers', 'one']) expect(n.get(id), id).toMatchObject({ author: 'person', status: 'asked', value: null, question: `What is "${id.replace(/_/g, ' ')}"?` });
    // Kept: an option's switch (0 hires until an option sets one), a calendar conversion, 0 as a sum's part, × 1 and ÷ 1.
    for (const id of ['developers_hired', 'tech_leads_hired', 'months_per_year', 'no_extra_output', 'new_customers', 'output_per_developer', 'one_customer']) expect(n.get(id), id).toMatchObject({ author: 'structure', status: 'known' });
    // The compiler reads the question as one: what rests on it waits for the person, and no error asks the drafter to repair it.
    const c = compile(m, { sourceText: saved.brief });
    expect(c.errors).toEqual([]);
    expect(c.asks.map((a) => a.quantity_id)).not.toContain('months_per_year');
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

  it('batch 4 hiring-r1: a measured aim whose options wait on their own figures says THAT question, never "No aim has a measure yet"', () => {
    const m = bakery();
    // The aim is measured and calculable; the one option waits on its own setting (how many ovens it adds), as hiring-r1's
    // options waited on their start times.
    m.options = m.options.filter((o) => o.id === 'second_oven');
    m.quantities = m.quantities.map((x) => (x.id === 'one_oven' ? { ...x, status: 'asked', value: null, quote: null, question: 'How many ovens would you add?' } : x));
    const e = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 });
    expect(e.compiled.perGoal[0]).toMatchObject({ status: 'calculable', needs_measure: false });
    expect(e.compiled.executable).toBeNull();
    const cell = (id: string) => ((e.view as Json).options as Json[]).find((o) => o.option_id === id)!.cell;
    expect(cell('second_oven').why).toBe('The chance waits for your answer: How many ovens would you add?');
    expect(cell('second_oven').face).toBe('Not shown yet: needs your answer');
    expect(cell('second_oven').why).not.toContain('No aim has a measure yet');
  });

  it('DL 23 Oct (units on cards): every card that can hold a figure carries its quantity\'s own unit, a question\'s too; a worked-out card none', () => {
    const saved = JSON.parse(readFileSync(new URL('./hiring-alpha3.saved.json', import.meta.url), 'utf8')) as { brief: string; canonical: CanonicalModelT };
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
});

function beforeEachReset() { SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); conversationIds.clear(); pausedRun = null; sent.length = 0; replies = []; }
