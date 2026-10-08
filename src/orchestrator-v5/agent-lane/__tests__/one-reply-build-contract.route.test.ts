/** The real build route, with Paul's captured graph and narrator words; no provider is contacted. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { markerForDisclosure, sentenceMultiset, type ReplyComposeInput } from '../reply/compose-reply.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { actionFactsOf } from '../actions/state.js';
import { deriveOlumiAuthoredValues } from '../../coaching/inferred-value-disclosure.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { whatChangesFaceLine } from '../../goal-target/goal-chance-range-agent.js';
import { identityCardOfferable, identityPartsWithoutLevel } from '../../system-events/identity-confirm-edit.js';

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] };
type Body = { assistant_text: string; _answer_shape?: AnswerShape; suggested_actions: Rec[];
  pending_actions?: { action: Rec }[]; action_bar?: { priority: Rec[]; more: Rec[] };
  _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };
const FX = JSON.parse(readFileSync(new URL('./fixtures/one-reply-paul-pricing.json', import.meta.url), 'utf8')) as {
  brief: string; narrator: string; read: Rec & { graph: Graph; graph_hash: string; analysis_result: Rec; analysis_state: Rec };
};
let currentRead = FX.read;
let lastComposeInput: unknown;
let withholdDisclosureFor: typeof import('../../../routes/agent-v1-turn.js')['withholdDisclosureFor'];
let lastBuildPayload: Rec;
let saved: Graph = { nodes: [], edges: [] };
let askedToBuild = false;
// COMPLETE retains final prose, not the provider's raw message. Include its captured goal-chance explanation
// so the preservation row can prove it remains in detail. The paired producer row below leaves it to the host.
const GOAL_CHANCE_CAPTURE = "This run doesn’t yet show each option’s chance of reaching £20,000. Olumi reads 'MRR' as 'Pro plan price' × 'Pro paying subscribers', but that hasn't been confirmed, so this run gives no chance of reaching the target for 'MRR'.";
let narrator = `${FX.narrator}\n\n${GOAL_CHANCE_CAPTURE}`;
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  readRecent: vi.fn(async () => []), readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: Rec) => {
    const id = String(w.turn_id);
    rows.set(id, { id, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null,
      user_message: w.userMessage ?? null, pending_actions: w.pending_actions ?? [], llm_calls_used: w.llm_calls_used ?? 0 });
    return { id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../reply/compose-reply.js', async (original) => {
  const actual = await original<typeof import('../reply/compose-reply.js')>();
  return { ...actual, composeReplyShape: (input: Parameters<typeof actual.composeReplyShape>[0]) => {
    lastComposeInput = structuredClone(input);
    return actual.composeReplyShape(input);
  } };
});
// Reuse the event-risk build-route harness. Only construction's external generation/storage is replaced:
// the actual capability, first analysis, identity card, final readback and reply producers still run.
vi.mock('../runtime/build-model.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  buildModelFromBrief: async (scenarioId: string, _brief: unknown,
    dispatch: (path: string, body: unknown) => Promise<unknown>) => {
    await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, { graph: structuredClone(currentRead.graph) });
    return { ok: true, mutated: true, model_version: { version_number: 1 }, graph_hash: currentRead.graph_hash };
  },
}));
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));
vi.mock('../../handlers/chip-click-dispatch.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  dispatchChipClickRunAnalysis: async () => ({ outcome: 'ok', commitPerformed: true, graph: saved, mayNameLeadingOption: false,
    analysisReady: (currentRead.current_read as Rec)?.analysis_ready,
    response: { response_version: 2, assistant_text: 'A provisional first pass cannot put an option forward yet.',
      suggested_actions: [], insights: [], blocks: [currentRead.analysis_result], analysis_state: currentRead.analysis_state } }),
}));
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const face = (shape: AnswerShape) => [shape.headline, ...shape.bullets].join('\n');
const count = (text: string, phrase: string) => text.split(phrase).length - 1;
const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

describe('ONE reply contract through the build route', () => {
  let app: FastifyInstance;
  let info: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    info = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (!String(url).includes('openai')) throw new Error('Unexpected external call');
      if (!askedToBuild) {
        askedToBuild = true;
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'build_model_from_brief',
          call_id: 'build', arguments: JSON.stringify({ brief: FX.brief }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify(say(narrator)), { status: 200 });
    }));
    const route = await import('../../../routes/agent-v1-turn.js');
    withholdDisclosureFor = route.withholdDisclosureFor;
    const { agentV1TurnRoute } = route;
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => saved.nodes.length === 0
      ? { graph: saved, graph_hash: 'empty', analysis_state: { run_state: { kind: 'never_run' } } }
      : { ...currentRead, graph: saved });
    app.post('/assist/v1/scenarios/:id/graph/register', async req => {
      saved = (req.body as { graph: Graph }).graph;
      return { registered: true, graph_hash: currentRead.graph_hash, model_version: { version_number: 1 } };
    });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: currentRead.graph_hash, blocks: [currentRead.analysis_result], analysis_state: currentRead.analysis_state,
      analysis_ready: (currentRead.current_read as Rec)?.analysis_ready }));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  beforeEach(() => { saved = { nodes: [], edges: [] }; rows.clear(); askedToBuild = false;
    narrator = process.env.ONE_REPLY_CAPTURE_BASE === '1' ? FX.narrator : `${FX.narrator}\n\n${GOAL_CHANCE_CAPTURE}`;
    currentRead = FX.read; lastComposeInput = undefined; info.mockClear(); });
  // #2851 supersedes the captured draft's automatic-card premise: Olumi's basis-less 250 is not a user level.
  // Keep the exact positive identity assertions on the same count explicitly ratified by the user; the original
  // capture remains untouched and has its own no-card route control below.
  const withUserRatifiedSubscribers = () => {
    currentRead = structuredClone(FX.read);
    (currentRead.graph.nodes.find(n => n.id === 'pro_paying_subscribers')!.observed_state as Rec).source = 'user_confirmed';
    currentRead.graph_hash = computeAnalysisAffectingGraphHash(currentRead.graph as never)!.slice(0, 16);
    currentRead.analysis_result.computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).current_analysis_hash = currentRead.graph_hash;
    expect(identityCardOfferable(currentRead.graph)).toBe(true);
    expect(identityPartsWithoutLevel(currentRead.graph, ['pro_plan_price', 'pro_paying_subscribers'])).toEqual([]);
  };
  async function buildTurn() {
    const turnId = randomUUID();
    lastBuildPayload = { kind: 'message', scenario_id: randomUUID(), turn_id: turnId, message: FX.brief };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: lastBuildPayload });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
    expect(rows.get(turnId)?.assistant_message).toBe(body.assistant_text);
    return body;
  }
  const expectStoredAndReplayed = async (body: Body, payload: Rec): Promise<void> => {
    expect(body._answer_shape, 'PL live: the displayed contract carries its face/detail shape').toBeDefined();
    const durable = rows.get(String(payload.turn_id));
    expect(durable?.assistant_message, 'PL live: durable answer text equals displayed text').toBe(body.assistant_text);
    expect(body.assistant_text, 'PL live: display is the exact shape derivation').toBe(deriveAnswerTextFromShape(body._answer_shape!));
    const providerCalls = vi.mocked(fetch).mock.calls.length;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body).toBe(200);
    const replay = response.json() as Body;
    expect(replay._agent.replayed).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length, 'PL replay makes no provider call').toBe(providerCalls);
    expect(replay.assistant_text, 'PL replay: durable answer text equals displayed text').toBe(durable?.assistant_message);
    expect(replay.assistant_text, 'PL replay: exact live words').toBe(body.assistant_text);
    expect(replay._answer_shape, 'PL replay: exact live face/detail shape').toEqual(body._answer_shape);
    expect(replay.assistant_text, 'PL replay: display is the exact shape derivation').toBe(deriveAnswerTextFromShape(replay._answer_shape!));
  };

  it.each(['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_PRODUCT_NOT_READ'])(
    'typed %s warning cannot claim that a confirmed identity is unconfirmed', code => {
      const graph = structuredClone(FX.read.graph);
      const goal = graph.nodes.find(n => n.id === 'mrr')!;
      (goal.nonlinear_identity as Rec).stated_in_brief = true;
      const verdict = targetTestabilityOf(graph);
      expect(verdict.kind === 'not_testable' && verdict.failures.some(f => f.code === 'identity_unconfirmed')).toBe(false);
      const note = withholdDisclosureFor(graph, { enrichment: { inference_warnings: [{ code,
        message: 'The identity is not confirmed — deliberately misleading words must not select the cause.' }] } });
      expect(note).toEqual({ kind: 'withhold', cause: 'other', goalLabel: 'MRR' });
      expect(markerForDisclosure(note)).toBe('Not shown yet; why is under More detail');
    });

  it.each(['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_PRODUCT_NOT_READ'])(
    'typed %s warning uses unconfirmed wording only when the graph verdict confirms that cause', code => {
      const verdict = targetTestabilityOf(FX.read.graph);
      expect(verdict.kind === 'not_testable' && verdict.failures.some(f => f.code === 'identity_unconfirmed')).toBe(true);
      const note = withholdDisclosureFor(FX.read.graph, { inference_warnings: [{ code, message: 'A generic read failure.' }] });
      expect(note).toEqual({ kind: 'withhold', cause: 'unconfirmed_identity', goalLabel: 'MRR' });
      expect(markerForDisclosure(note)).toBe("Not shown: how MRR is worked out isn't confirmed");
    });

  it.each([null, 42, { nodes: null }, { nodes: [null, undefined, 12, 'x', {}] },
    { nodes: [{ kind: 'goal', label: 42 }] }, { nodes: [{ kind: 'goal', label: '  ' }] }])(
    'typed withheld marker safely falls back when graph nodes or the goal label are malformed (%j)', graph => {
      const note = withholdDisclosureFor(graph, { inference_warnings: [{ code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE',
        detail: { reason: 'missing_goal_baseline' } }] });
      expect(note).toEqual({ kind: 'withhold', cause: 'missing_current_level' });
      expect(markerForDisclosure(note)).toBe('Not shown yet; why is under More detail');
    });

  it.each(['GOAL_FIGURES_USER_EFFECT_CLAMPED', 'GOAL_FIGURES_OPTIONS_IDENTICAL', 'GOAL_FIGURES_PROBABILITY_UNUSABLE',
    'GOAL_FIGURES_SHARE_APPROXIMATION', 'GOAL_FIGURES_CHANCE_AS_GOAL'])(
    'typed %s cause uses the fallback instead of borrowing a different graph cause', code => {
      const note = withholdDisclosureFor(FX.read.graph, { inference_warnings: [{ code, message: 'A retained exact note.' }] });
      expect(note).toEqual({ kind: 'withhold', cause: 'other', goalLabel: 'MRR' });
      expect(markerForDisclosure(note)).toBe('Not shown yet; why is under More detail');
    });

  it.each(['non_finite_conversion_input', 'future_unmapped_reason'])(
    'typed threshold cause %s cannot be renamed after a latent graph failure', reason => {
      const note = withholdDisclosureFor(FX.read.graph, { inference_warnings: [{ code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE',
        detail: { reason }, message: 'The complete threshold note stays under More detail.' }] });
      expect(note).toEqual({ kind: 'withhold', cause: 'other', goalLabel: 'MRR' });
      expect(markerForDisclosure(note)).toBe('Not shown yet; why is under More detail');
    });

  it('typed marker labels apply the existing proposal-id display reader before the last writer', () => {
    const graph = structuredClone(FX.read.graph);
    graph.nodes.find(n => n.id === 'mrr')!.label = 'MRR prop_deadbeef0123456789';
    const note = withholdDisclosureFor(graph, { inference_warnings: [{ code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE',
      detail: { reason: 'missing_goal_baseline' } }] });
    expect(note).toEqual({ kind: 'withhold', cause: 'missing_current_level', goalLabel: 'MRR this proposal' });
    expect(markerForDisclosure(note)).toBe("Not shown: MRR this proposal's current level is missing");
    expect(markerForDisclosure(note)).not.toContain('prop_deadbeef0123456789');
  });

  it('R1 Paul, user-ratified count: one concise face, typed-card question in detail, RC4 census, plain units', async () => {
    withUserRatifiedSubscribers();
    const body = await buildTurn();
    const shapeLog = info.mock.calls.map((call: unknown[]) => call[0] as Rec).find((e: Rec) => e.event === 'agent_lane.reply_shaped');
    const facts = actionFactsOf({ scenarioId: randomUUID(), graph: currentRead.graph, graphHash: currentRead.graph_hash,
      analysisState: currentRead.analysis_state, analysisResult: currentRead.analysis_result,
      analysisReady: (currentRead.current_read as Rec)?.analysis_ready });
    expect(facts.olumiEstimates).not.toBeNull();
    const wholeGraphAuthoredCount = deriveOlumiAuthoredValues(currentRead.graph).length;
    expect(wholeGraphAuthoredCount, 'M3 control: whole-model authored figures differ from RC4 result census').not.toBe(facts.olumiEstimates!.count);
    if (process.env.ONE_REPLY_CAPTURE_BASE === '1') {
      expect(shapeLog).toMatchObject({ outcome: 'kept_whole', reason: 'proposal' });
      return;
    }
    expect(body._answer_shape, JSON.stringify(shapeLog)).toBeDefined();
    const shown = face(body._answer_shape!);
    expect(shown).toContain(`Olumi's estimates: ${facts.olumiEstimates!.count}, see Check estimates.`);
    expect(words(shown)).toBeLessThanOrEqual(80);
    const identity = "Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-induced churn’. Is that how you work it out?";
    for (const phrase of ['Is that how you work it out?', identity, "hasn't been confirmed", 'current level']) {
      expect(count(shown, phrase), `off face: ${phrase}`).toBe(0);
      expect(count(body.assistant_text, phrase), `said once: ${phrase}`).toBe(1);
    }
    expect(body.assistant_text).toBe(deriveAnswerTextFromShape(body._answer_shape!));
    const sentences = sentenceMultiset(body.assistant_text);
    for (const sentence of new Set(sentences)) expect(sentences.filter(s => s === sentence), sentence).toHaveLength(1);
    expect(body.assistant_text).not.toContain('£/subscriber/month');
    expect(body.assistant_text).not.toContain('£/month');
    expect(count(body.assistant_text, 'The model holds the deadline; no result answers that yet.')).toBe(0);
    expect(count(body.assistant_text, 'within 12 months')).toBeLessThanOrEqual(1);
    expect(count(body.assistant_text, "doesn't project")).toBeLessThanOrEqual(1);
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it('R1 producer control, user-ratified count: the identity card owes no second goal-chance explanation', async () => {
    withUserRatifiedSubscribers();
    narrator = FX.narrator;
    const body = await buildTurn();
    expect(body._answer_shape).toBeDefined();
    expect(body.assistant_text).not.toContain("hasn't been confirmed");
    expect(body.assistant_text).not.toContain('This run doesn’t yet show each option’s chance of reaching £20,000.');
    expect(body.suggested_actions).toContainEqual(expect.objectContaining({ label: "Yes, that's how" }));
    expect(words(face(body._answer_shape!))).toBeLessThanOrEqual(80);
  });

  it('R1 original capture: Olumi’s basis-less 250 offers no identity card or approval', async () => {
    // The provider now narrates the draft without the captured, obsolete "confirm on the button" instruction.
    narrator = FX.narrator.slice(0, FX.narrator.indexOf('\n\n“Olumi reads'));
    const before = structuredClone(FX.read.graph);
    expect(identityPartsWithoutLevel(before, ['pro_plan_price', 'pro_paying_subscribers'])).toEqual([
      { id: 'pro_paying_subscribers', label: 'Pro paying subscribers', kind: 'factor' },
    ]);
    expect(identityCardOfferable(before)).toBe(false);
    const body = await buildTurn();
    const facts = actionFactsOf({ scenarioId: String(lastBuildPayload.scenario_id), graph: saved,
      graphHash: currentRead.graph_hash, analysisState: currentRead.analysis_state, analysisResult: currentRead.analysis_result,
      analysisReady: (currentRead.current_read as Rec)?.analysis_ready });
    expect(facts.identityReading).toBeNull();
    expect(body._agent.tool_calls.some(c => c.name === 'propose_identity')).toBe(false);
    expect(body.suggested_actions).not.toContainEqual(expect.objectContaining({ label: "Yes, that's how" }));
    expect(body.pending_actions ?? []).toEqual([]);
    expect(rows.get(String(lastBuildPayload.turn_id))?.pending_actions).toEqual([]);
    const approvalControls = [...body.suggested_actions, ...(body.pending_actions ?? []).map(p => p.action),
      ...(body.action_bar?.priority ?? []), ...(body.action_bar?.more ?? [])];
    expect(approvalControls.some(a => a.action_id === 'confirm_identity' || a.action_type === 'confirm_identity')).toBe(false);
    expect(approvalControls.some(a => a.action_id === 'confirm_reading' && a.enabled === true)).toBe(false);
    expect(body.assistant_text).not.toContain('Is that how you work it out?');
    expect(body.assistant_text).not.toContain('Please confirm on the button.');
    expect(count(body.assistant_text, GOAL_CHANCE_CAPTURE), 'without a card, the full chance explanation remains owed once').toBe(1);
    expect(saved).toEqual(before);
    expect(FX.read.graph).toEqual(before);
    expect(saved.nodes.find(n => n.id === 'pro_paying_subscribers')!.observed_state).toMatchObject({
      raw_value: 250, value: 0.125, source: 'cee_inference',
    });
    expect(words(face(body._answer_shape!))).toBeLessThanOrEqual(80);
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it('R3 withheld Run: typed current-level marker on the face, full reason in detail, one next step', async () => {
    currentRead = structuredClone(FX.read);
    saved = structuredClone(currentRead.graph);
    const goal = saved.nodes.find(n => n.id === 'mrr')!;
    delete goal.nonlinear_identity;
    currentRead.graph = saved;
    currentRead.graph_hash = computeAnalysisAffectingGraphHash(saved as never)!.slice(0, 16);
    currentRead.analysis_result.computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).current_analysis_hash = currentRead.graph_hash;
    const enrichment = currentRead.analysis_result.enrichment as Rec;
    enrichment.inference_warnings = (enrichment.inference_warnings as Rec[])
      .filter(w => w.code === 'GOAL_THRESHOLD_NOT_CONVERTIBLE');
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
    } });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    expect(body._answer_shape, body.assistant_text).toBeDefined();
    const shown = face(body._answer_shape!);
    const marker = "Not shown: MRR's current level is missing";
    expect(shown, 'typed missing-current-level marker is must-face').toContain(marker);
    const reason = (lastComposeInput as ReplyComposeInput).obligations?.find(o => o.role === 'withheld_reason' && o.lead === true && o.ownsNextStep !== true)?.text;
    expect(reason, 'typed full withheld reason is produced by the route').toBeDefined();
    expect(count(shown, reason!), 'full withheld reason stays off the face').toBe(0);
    expect(count(body._answer_shape!.detail, reason!), 'full withheld reason is verbatim in detail once').toBe(1);
    expect(words(shown)).toBeLessThanOrEqual(80);
    expect(shown).not.toContain('What would change it:');
    expect(whatChangesFaceLine(currentRead.analysis_result, saved)).toBeNull();
    expect((lastComposeInput as { whatChanges?: string }).whatChanges).toBeUndefined();
    expect(count(shown, '?')).toBeLessThanOrEqual(1);
    const currentLevelControl = body.action_bar?.priority.filter(a => a.action_id === 'set_current_level' && a.enabled === true) ?? [];
    expect(count(shown, '?') + currentLevelControl.length, 'one resolving ask or current-level control').toBe(1);
    expect(body.assistant_text).toBe(deriveAnswerTextFromShape(body._answer_shape!));
  });
});
