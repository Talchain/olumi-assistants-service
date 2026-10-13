/** The real build route, with Paul's captured graph and narrator words; no provider is contacted. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import { deriveAnswerTextFromShape as _deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { markerForDisclosure as _markerForDisclosure, sentenceMultiset as _sentenceMultiset, type ReplyComposeInput as _ReplyComposeInput } from '../reply/compose-reply.js';
import { CHANCE_FREE_HORIZON_PREFIX as _CHANCE_FREE_HORIZON_PREFIX } from '../decision-input-ask.js';
import { targetTestabilityOf as _targetTestabilityOf } from '../../admission/target-testability.js';
import { actionFactsOf } from '../actions/state.js';
import { deriveOlumiAuthoredValues as _deriveOlumiAuthoredValues } from '../../coaching/inferred-value-disclosure.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { whatChangesFaceLine as _whatChangesFaceLine } from '../../goal-target/goal-chance-range-agent.js';
import { identityCardOfferable, identityPartsWithoutLevel } from '../../system-events/identity-confirm-edit.js';
import { projectCanonicalAnalysisView, type CanonicalAnalysisCell } from '../../../routes/canonical-analysis-view.js';
import { thresholdReasonLine as _thresholdReasonLine } from '../break-even.js';
import { widenedLine as _widenedLine, widenedRiskNote as _widenedRiskNote, widenedRiskMarker as _widenedRiskMarker, type WidenCounts } from '../runtime/widen-draft.js';

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] };
type Body = { assistant_text: string; _answer_shape?: AnswerShape; suggested_actions: Rec[];
  pending_actions?: { action: Rec }[]; action_bar?: { priority: Rec[]; more: Rec[] };
  _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };
const FX = JSON.parse(readFileSync(new URL('./fixtures/one-reply-paul-pricing.json', import.meta.url), 'utf8')) as {
  brief: string; narrator: string; read: Rec & { graph: Graph; graph_hash: string; analysis_result: Rec; analysis_state: Rec };
};
const _B1 = JSON.parse(readFileSync(new URL('./fixtures/r11b-head-b1.json', import.meta.url), 'utf8')) as {
  brief: string; graph: Graph; graph_hash: string; analysis_result: Rec; analysis_state: Rec;
  analysis_ready: Rec; before_shape: AnswerShape; before_text: string;
};
const _B1_WIDENED = JSON.parse(readFileSync(new URL('./fixtures/served-b1-widened-20261008.json', import.meta.url), 'utf8')) as Graph;
// Reuse the captured Run that already licenses numeric goal chances; no chance is invented for this route row.
const T1B = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as {
  j: typeof FX.read & { brief_text: string };
}).j;
let currentRead = FX.read;
let buildBrief = FX.brief;
let buildWidened: WidenCounts | undefined;
let withoutRun = false;
let _lastComposeInput: unknown;
let _withholdDisclosureFor: typeof import('../../../routes/agent-v1-turn.js')['_withholdDisclosureFor'];
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
    _lastComposeInput = structuredClone(input);
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
    return { ok: true, mutated: true, model_version: { version_number: 1 }, graph_hash: currentRead.graph_hash,
      ...(buildWidened === undefined ? {} : { widened: buildWidened }) };
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
const _face = (shape: AnswerShape) => [shape.headline, ...shape.bullets].join('\n');
const _count = (text: string, phrase: string) => text.split(phrase).length - 1;
const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const _withheldCells = (code: string, message: string | null = null): readonly CanonicalAnalysisCell[] => [
  { kind: 'withheld', why: 'Chance not shown yet', face: message ?? 'Why this figure is withheld is not recorded.', reasons: [{ code, message }] },
];

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
          call_id: 'build', arguments: JSON.stringify({ brief: buildBrief }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify(say(narrator)), { status: 200 });
    }));
    const route = await import('../../../routes/agent-v1-turn.js');
    _withholdDisclosureFor = route.withholdDisclosureFor;
    const { agentV1TurnRoute } = route;
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async req => {
      if (saved.nodes.length === 0) {
        const analysis_state = { run_state: { kind: 'never_run' as const } };
        return { graph: saved, graph_hash: 'empty', analysis_state,
          canonical_analysis_view: projectCanonicalAnalysisView({ graph: saved, analysisState: analysis_state as never }) };
      }
      if (withoutRun) {
        const analysis_state = { run_state: { kind: 'never_run' as const } };
        return { graph: saved, graph_hash: currentRead.graph_hash, analysis_state,
          canonical_analysis_view: projectCanonicalAnalysisView({ graph: saved, analysisState: analysis_state as never }) };
      }
      // Reconstruct only the captured successful fact wrapper owned by this test's served graph read.
      const canonical_analysis_view = projectCanonicalAnalysisView({ graph: saved,
        runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
          scenario_id: (req.params as { id: string }).id, run_id: 'fixture-build-run', summary: currentRead.analysis_result.summary,
          leading_option_id: currentRead.analysis_result.leading_option_id, enrichment: currentRead.analysis_result.enrichment,
          graph_hash_at_run: currentRead.graph_hash, computed_at: (currentRead.analysis_state.run_state as Rec).computed_at,
        } } as never,
        analysisState: currentRead.analysis_state as never,
        analysisReady: (currentRead.current_read as Rec)?.analysis_ready,
        currentResult: currentRead.analysis_result as never });
      return { ...currentRead, graph: saved, canonical_analysis_view };
    });
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
    currentRead = FX.read; buildBrief = FX.brief; buildWidened = undefined; withoutRun = false; _lastComposeInput = undefined; info.mockClear(); });
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
    lastBuildPayload = { kind: 'message', scenario_id: randomUUID(), turn_id: turnId, message: buildBrief };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: lastBuildPayload });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
    expect(rows.get(turnId)?.assistant_message).toBe(body.assistant_text);
    return body;
  }
  const expectStoredAndReplayed = async (body: Body, payload: Rec): Promise<void> => {
    expect(body._answer_shape).toBeUndefined();
    const durable = rows.get(String(payload.turn_id));
    expect(durable?.assistant_message, 'PL live: durable answer text equals displayed text').toBe(body.assistant_text);
    const providerCalls = vi.mocked(fetch).mock.calls.length;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body).toBe(200);
    const replay = response.json() as Body;
    expect(replay._agent.replayed).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length, 'PL replay makes no provider call').toBe(providerCalls);
    expect(replay.assistant_text, 'PL replay: durable answer text equals displayed text').toBe(durable?.assistant_message);
    expect(replay.assistant_text, 'PL replay: exact live words').toBe(body.assistant_text);
    expect(replay._answer_shape, 'PL replay: exact live face/detail shape').toEqual(body._answer_shape);
  };

  const _withOlumiAddedRisks = () => {
    const option = currentRead.graph.nodes.find(node => node.kind === 'option')!;
    const factor = currentRead.graph.nodes.find(node => node.kind === 'factor')!;
    const goal = currentRead.graph.nodes.find(node => node.kind === 'goal')!;
    // This is the typed attachment that widenDraft writes and admission retains; the risks have no analysis edges.
    const risks = [1, 2, 3].map(index => ({ id: `olumi_widened_risk_${index}`, ref: `R${10 + index}`, kind: 'risk',
      label: `Olumi concern ${index}`, provenance: 'ai_proposed', proposed_by: 'olumi', analysis_participation: 'retained_excluded',
      draft_widening: { provenance: 'ai_suggested_widen' as const,
        hits: { id: option.id, label: option.label, kind: 'option' },
        through: { id: factor.id, label: factor.label, direction: 'positive' as const },
        affects: { id: goal.id, label: goal.label, direction: 'negative' as const }, mechanism: 'drives',
        relies_on: 'The team still needs to test this condition.', watch_for: 'Watch for evidence that this condition fails.' } }));
    currentRead.graph.nodes.push(...risks);
    currentRead.graph_hash = computeAnalysisAffectingGraphHash(currentRead.graph as never)!.slice(0, 16);
    currentRead.analysis_result.computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).current_analysis_hash = currentRead.graph_hash;
    return risks;
  };
  const _useNumericChanceRead = (): void => {
    currentRead = structuredClone(T1B);
    buildBrief = T1B.brief_text;
    narrator = 'Your results are ready. You can view them now or ask me to explain them.';
  };

  it('R1 producer control, user-ratified count: the identity card owes no second goal-chance explanation', async () => {
    withUserRatifiedSubscribers();
    narrator = FX.narrator;
    const body = await buildTurn();
    expect(body._answer_shape).toBeUndefined();
    expect(body.assistant_text).not.toContain("hasn't been confirmed");
    expect(body.assistant_text).not.toContain('This run doesn’t yet show each option’s chance of reaching £20,000.');
    expect(body.suggested_actions).toContainEqual(expect.objectContaining({ label: "Yes, that's how" }));
    expect(body._answer_shape).toBeUndefined();
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
    expect(saved).toEqual(before);
    expect(FX.read.graph).toEqual(before);
    expect(saved.nodes.find(n => n.id === 'pro_paying_subscribers')!.observed_state).toMatchObject({
      raw_value: 250, value: 0.125, source: 'cee_inference',
    });
    expect(body._answer_shape).toBeUndefined();
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  // R2 N1 (friction audit row N1): "Not shown: some relationships aren't sized yet" + "Olumi's estimates: N, see Check
  // estimates." took the face of ordinary replies (hiring 17/19, marketing 11/12) and hid the answer. CONTRAST: the
  // build/Run turn above ("r13 draft without widened", "R1 Paul") keeps both lines.
  it('R2 N1: an ordinary reply beside the same withheld Run leads with its own answer, with no status or estimates line', async () => {
    withUserRatifiedSubscribers();
    const built = await buildTurn();
    expect(built.assistant_text).not.toContain("Olumi's estimates: ");
    narrator = 'Start with how many subscribers a price change would cost you.';
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: 'What should I look at first?' } });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    expect(body._agent.tool_calls.some(c => c.name === 'run_analysis' || c.name === 'build_model_from_brief')).toBe(false);
    expect(body.assistant_text).not.toContain("Olumi's estimates: ");
    expect(body.assistant_text).not.toMatch(/^Not shown/);
    expect(body._answer_shape?.headline ?? body.assistant_text.split('\n')[0]).toContain(narrator);
  });

  // AI-first Lane 2 N1 (PLAN-AI-FIRST-SUBTRACT): the AI's answer IS the reply on an ordinary turn. A long answer was cut to
  // an 80-word face with the rest under "More detail". CONTRAST: `buildTurn` asserts the build keeps its Draft face.
  it('AI-first N1: a long ordinary answer beside the withheld Run ships whole, in its own order, with no fold', async () => {
    withUserRatifiedSubscribers();
    await buildTurn();
    const paragraphs = [
      'Start with how many subscribers a price change would cost you, because that figure carries most of the uncertainty in this model.',
      '- Ask your support team how many customers mentioned price when they cancelled last quarter.\n- Compare that with the cancellations that gave no reason.\n- Check whether annual-plan customers behave differently from monthly ones.',
      'Once you have even a rough range, enter it on the link from price to subscribers and run the comparison again, so the model reflects your evidence rather than its placeholder.',
      'If the range turns out to be wide, that is useful too: it tells you the decision depends on learning more before committing.',
    ];
    narrator = paragraphs.join('\n\n');
    expect(words(narrator), 'the control: longer than the old 80-word face').toBeGreaterThan(80);
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: 'What should I look at first?' } });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    expect(body._agent.tool_calls.some(c => c.name === 'run_analysis' || c.name === 'build_model_from_brief')).toBe(false);
    expect(body._answer_shape, 'no face/detail sidecar on an ordinary turn').toBeUndefined();
    expect(body.assistant_text.startsWith(narrator), body.assistant_text.slice(0, 300)).toBe(true);
    expect(body.assistant_text).not.toContain("Olumi's estimates: ");
  });
});
