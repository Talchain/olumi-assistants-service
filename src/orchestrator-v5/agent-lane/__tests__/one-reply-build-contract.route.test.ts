/** The real build route, with Paul's captured graph and narrator words; no provider is contacted. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { markerForDisclosure, sentenceMultiset, type ReplyComposeInput } from '../reply/compose-reply.js';
import { CHANCE_FREE_HORIZON_PREFIX } from '../decision-input-ask.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { actionFactsOf } from '../actions/state.js';
import { deriveOlumiAuthoredValues } from '../../coaching/inferred-value-disclosure.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { whatChangesFaceLine } from '../../goal-target/goal-chance-range-agent.js';
import { identityCardOfferable, identityPartsWithoutLevel } from '../../system-events/identity-confirm-edit.js';
import { projectCanonicalAnalysisView, type CanonicalAnalysisCell } from '../../../routes/canonical-analysis-view.js';
import { thresholdReasonLine } from '../break-even.js';
import { widenedLine, widenedRiskNote, widenedRiskMarker, type WidenCounts } from '../runtime/widen-draft.js';

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] };
type Body = { assistant_text: string; _answer_shape?: AnswerShape; suggested_actions: Rec[];
  pending_actions?: { action: Rec }[]; action_bar?: { priority: Rec[]; more: Rec[] };
  _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };
const FX = JSON.parse(readFileSync(new URL('./fixtures/one-reply-paul-pricing.json', import.meta.url), 'utf8')) as {
  brief: string; narrator: string; read: Rec & { graph: Graph; graph_hash: string; analysis_result: Rec; analysis_state: Rec };
};
const B1 = JSON.parse(readFileSync(new URL('./fixtures/r11b-head-b1.json', import.meta.url), 'utf8')) as {
  brief: string; graph: Graph; graph_hash: string; analysis_result: Rec; analysis_state: Rec;
  analysis_ready: Rec; before_shape: AnswerShape; before_text: string;
};
const B1_WIDENED = JSON.parse(readFileSync(new URL('./fixtures/served-b1-widened-20261008.json', import.meta.url), 'utf8')) as Graph;
// Reuse the captured Run that already licenses numeric goal chances; no chance is invented for this route row.
const T1B = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as {
  j: typeof FX.read & { brief_text: string };
}).j;
let currentRead = FX.read;
let buildBrief = FX.brief;
let buildWidened: WidenCounts | undefined;
let withoutRun = false;
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
const face = (shape: AnswerShape) => [shape.headline, ...shape.bullets].join('\n');
const count = (text: string, phrase: string) => text.split(phrase).length - 1;
const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const withheldCells = (code: string, message: string | null = null): readonly CanonicalAnalysisCell[] => [
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
    withholdDisclosureFor = route.withholdDisclosureFor;
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
    currentRead = FX.read; buildBrief = FX.brief; buildWidened = undefined; withoutRun = false; lastComposeInput = undefined; info.mockClear(); });
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

  const withOlumiAddedRisks = () => {
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
  const useNumericChanceRead = (): void => {
    currentRead = structuredClone(T1B);
    buildBrief = T1B.brief_text;
    narrator = 'Your results are ready. You can view them now or ask me to explain them.';
  };

  it('FU1 withheld widened draft: typed receipt stays after H with no risk chance note or marker; replay identical', async () => {
    currentRead = structuredClone(FX.read);
    buildWidened = { options: 0, risks: 3 };
    narrator = 'Olumi built your pricing model.';
    const body = await buildTurn();
    const line = widenedLine(buildWidened)!;
    const note = widenedRiskNote(buildWidened)!;
    const input = lastComposeInput as ReplyComposeInput;
    expect(input.faceContract).toBe('draft');
    expect(input.widenedLine).toBe(line);
    expect(input.chanceCells?.every(cell => cell.kind === 'withheld')).toBe(true);
    expect(input.widenedRiskNote).toBeUndefined();
    expect(input.widenedRiskMarker).toBeUndefined();
    expect(body._answer_shape, body.assistant_text).toBeDefined();
    expect(body._answer_shape!.bullets[0], 'the exact producer line is immediately after the headline').toBe(line);
    expect(count(body.assistant_text, line)).toBe(1);
    expect(face(body._answer_shape!)).not.toContain(note);
    expect(count(body._answer_shape!.detail, note)).toBe(0);
    expect(count(body.assistant_text, note)).toBe(0);
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it('Q-c build: H>0 with no carrier and no Run owes chance-free A7 exactly once', async () => {
    currentRead = structuredClone(FX.read);
    const goal = currentRead.graph.nodes.find(node => node.kind === 'goal')!;
    goal.goal_horizon_months = 9;
    expect(currentRead.graph.nodes.every(node => (node.nonlinear_identity as Rec | undefined)?.operation !== 'accumulation')).toBe(true);
    withoutRun = true;
    narrator = 'Olumi built your model.';
    const body = await buildTurn();
    expect((lastComposeInput as ReplyComposeInput).chanceCells).toEqual([]);
    expect(count(body.assistant_text, `${CHANCE_FREE_HORIZON_PREFIX} within 9 months.`)).toBe(1);
    expect(rows.get(String(lastBuildPayload.turn_id))?.assistant_message).toBe(body.assistant_text);
    expect(body.assistant_text).toBe(deriveAnswerTextFromShape(body._answer_shape!));
  });

  it('FU1 B1 no-Run draft: served widened risks keep the receipt and relies-on words, without chance copy; replay identical', async () => {
    currentRead = { ...structuredClone(FX.read), graph: structuredClone(B1_WIDENED) };
    currentRead.graph_hash = computeAnalysisAffectingGraphHash(currentRead.graph as never)!.slice(0, 16);
    buildWidened = { options: 0, risks: 3 };
    withoutRun = true;
    narrator = 'Olumi built your pricing model.';
    const body = await buildTurn();
    const input = lastComposeInput as ReplyComposeInput;
    process.stdout.write(`FU1_B1_DRAFT ${JSON.stringify({ text: body.assistant_text, shape: body._answer_shape,
      chanceCells: input.chanceCells, widenedLine: input.widenedLine, widenedRiskNote: input.widenedRiskNote,
      widenedRiskMarker: input.widenedRiskMarker })}\n`);
    expect(input.chanceCells).toEqual([]);
    expect(input.widenedLine).toBe(widenedLine(buildWidened));
    expect(input.widenedRiskNote).toBeUndefined();
    expect(input.widenedRiskMarker).toBeUndefined();
    expect(body._answer_shape!.bullets[0]).toBe(widenedLine(buildWidened));
    expect(count(body.assistant_text, widenedLine(buildWidened)!)).toBe(1);
    expect(body.assistant_text).not.toContain(widenedRiskNote(buildWidened));
    expect(body.assistant_text).not.toContain("Leaves out Olumi's added risks");
    expect(body.assistant_text).not.toContain("and that option's chance doesn't include it yet");
    const risks = currentRead.graph.nodes.filter(node => node.kind === 'risk' && node.draft_widening !== undefined);
    for (const risk of risks) {
      const option = currentRead.graph.nodes.find(node => node.id === ((risk.draft_widening as Rec).hits as Rec).id)!;
      expect(body.assistant_text).toContain(`‘${risk.label}’: ‘${option.label}’ relies on this not happening.`);
      expect(count(body.assistant_text, `‘${risk.label}’`)).toBe(1);
    }
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it('r13 draft without widened: omitted and zero typed counts keep the existing reply byte-identical', async () => {
    narrator = 'Olumi built your pricing model.';
    const body = await buildTurn();
    // The historical capture retains its display grammar, with §(ad)'s retired chance-free horizon clause removed.
    expect(body.assistant_text, 'no widening preserves the existing reply apart from the retired horizon clause').toBe([
      "Not shown: how MRR is worked out isn't confirmed",
      "• Olumi's estimates: 3, see Check estimates.",
      'Olumi built your pricing model.',
      // Q-c (DL 87114): one horizon-limit statement per surface.
      "This model doesn't yet say whether any option gets there within 12 months.",
      "Olumi can't show each option's chance of reaching your MRR target yet: the model doesn't have MRR's current level to measure from. The rest of this Run's results still stand.",
      GOAL_CHANCE_CAPTURE,
    ].join('\n\n'));
    const payload = structuredClone(lastBuildPayload);
    const input = lastComposeInput as ReplyComposeInput;
    expect(input.widenedLine).toBeUndefined();
    expect(input.widenedRiskNote).toBeUndefined();
    expect(input.widenedRiskMarker).toBeUndefined();
    expect(body.assistant_text).not.toContain('Olumi added');
    expect(body.assistant_text).not.toContain("Risks Olumi added aren't in the chance yet");
    expect(body.assistant_text).not.toContain("Leaves out Olumi's added risks");
    await expectStoredAndReplayed(body, payload);
    buildWidened = { options: 0, risks: 0 };
    saved = { nodes: [], edges: [] };
    askedToBuild = false;
    const zeroBody = await buildTurn();
    expect(zeroBody.assistant_text, 'zero counts do not change the unwidened reply by one byte').toBe(body.assistant_text);
    expect(zeroBody._answer_shape).toEqual(body._answer_shape);
    const zeroInput = lastComposeInput as ReplyComposeInput;
    expect(zeroInput.widenedLine).toBeUndefined();
    expect(zeroInput.widenedRiskNote).toBeUndefined();
    expect(zeroInput.widenedRiskMarker).toBeUndefined();
    await expectStoredAndReplayed(zeroBody, lastBuildPayload);
  });

  it('r13 automatic first Run: typed retained risks supply the note and marker on the build turn, with identical replay', async () => {
    useNumericChanceRead();
    buildWidened = { options: 0, risks: 3 };
    const risks = withOlumiAddedRisks();
    const body = await buildTurn();
    const input = lastComposeInput as ReplyComposeInput;
    expect(input.chanceCells?.some(cell => cell.kind === 'figure' || cell.kind === 'range'), 'the build includes its first analysis').toBe(true);
    expect(input.widenedRiskNote).toBe(widenedRiskNote(buildWidened));
    expect(input.widenedRiskMarker).toBe(widenedRiskMarker(risks));
    expect(input.obligations).toContainEqual(expect.objectContaining({ role: 'caveat', text: widenedRiskMarker(risks) }));
    expect(body._answer_shape, body.assistant_text).toBeDefined();
    const units = [body._answer_shape!.headline, ...body._answer_shape!.bullets];
    expect(body._answer_shape!.bullets[0], 'the build receipt still follows its headline').toBe(widenedLine(buildWidened));
    const markerIndex = units.indexOf(widenedRiskMarker(risks)!);
    expect(markerIndex, 'the automatic first Run displays the typed risk marker').toBeGreaterThan(0);
    expect(units.slice(0, markerIndex).some(unit => /\d+%/.test(unit)), 'the marker stays beside this first analysis chance').toBe(true);
    expect(count(face(body._answer_shape!), widenedRiskMarker(risks)!)).toBe(1);
    expect(count(body._answer_shape!.detail, widenedRiskNote(buildWidened)!)).toBe(1);
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it('r13 Run: retained typed Olumi risks keep the marker beside the numeric chance and the note once; replay identical', async () => {
    useNumericChanceRead();
    const risks = withOlumiAddedRisks();
    saved = structuredClone(currentRead.graph);
    const payload = { kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    const input = lastComposeInput as ReplyComposeInput;
    const note = widenedRiskNote({ options: 0, risks: risks.length })!;
    const marker = widenedRiskMarker(risks)!;
    process.stdout.write(`FU1_SHOWN_RUN ${JSON.stringify({ text: body.assistant_text, shape: body._answer_shape,
      chanceCells: input.chanceCells, widenedRiskNote: input.widenedRiskNote, widenedRiskMarker: input.widenedRiskMarker })}\n`);
    expect(input.faceContract).toBe('run');
    expect(input.widenedLine, 'persisted risks owe disclosure, not a fresh draft receipt').toBeUndefined();
    expect(input.widenedRiskNote).toBe(note);
    expect(input.widenedRiskMarker).toBe(marker);
    expect(input.chanceCells?.some(cell => cell.kind === 'figure' || cell.kind === 'range')).toBe(true);
    expect(body._answer_shape, body.assistant_text).toBeDefined();
    const units = [body._answer_shape!.headline, ...body._answer_shape!.bullets];
    const markerIndex = units.indexOf(marker);
    expect(markerIndex, 'marker stays on the face').toBeGreaterThan(0);
    expect(units.slice(0, markerIndex).some(unit => /\d+%/.test(unit)), 'marker follows the numeric chance').toBe(true);
    expect(count(face(body._answer_shape!), marker)).toBe(1);
    expect(face(body._answer_shape!)).not.toContain(note);
    expect(count(body._answer_shape!.detail, note)).toBe(1);
    expect(count(body.assistant_text, note)).toBe(1);
    const riskOption = ((risks[0]!.draft_widening as Rec).hits as Rec).id;
    expect(input.chanceCells).toContainEqual(expect.objectContaining({ kind: 'figure', option_id: riskOption }));
    expect(count(body.assistant_text, "and that option's chance doesn't include it yet")).toBe(risks.length);
    await expectStoredAndReplayed(body, payload);
  });

  it('FU1 mixed Run: another option shows a chance while the risk option is withheld, keeping its relies-on words; replay identical', async () => {
    useNumericChanceRead();
    const risks = withOlumiAddedRisks();
    const riskOption = ((risks[0]!.draft_widening as Rec).hits as Rec).id;
    const enrichment = currentRead.analysis_result.enrichment as Rec;
    enrichment.inference_warnings = [...enrichment.inference_warnings as Rec[], {
      code: 'GOAL_FIGURES_PROBABILITY_UNUSABLE', option_ids: [riskOption], message: 'This option has no usable chance.' }];
    saved = structuredClone(currentRead.graph);
    const payload = { kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    const input = lastComposeInput as ReplyComposeInput;
    expect(input.chanceCells).toContainEqual(expect.objectContaining({ kind: 'withheld', option_id: riskOption }));
    expect(input.chanceCells?.some(cell => cell.kind === 'figure' || cell.kind === 'range')).toBe(true);
    expect(input.widenedRiskNote).toBe(widenedRiskNote({ options: 0, risks: risks.length }));
    expect(input.widenedRiskMarker).toBe(widenedRiskMarker(risks));
    expect(body.assistant_text).not.toContain("and that option's chance doesn't include it yet");
    const option = currentRead.graph.nodes.find(node => node.id === riskOption)!;
    for (const risk of risks) expect(body.assistant_text).toContain(`‘${risk.label}’: ‘${option.label}’ relies on this not happening.`);
    await expectStoredAndReplayed(body, payload);
    const replayInput = lastComposeInput as ReplyComposeInput;
    expect(replayInput.widenedRiskNote).toBe(input.widenedRiskNote);
    expect(replayInput.widenedRiskMarker).toBe(input.widenedRiskMarker);
  });

  it('r11b B1 automatic first Run: exact pilot face/detail uses one cell marker without the retired horizon clause', async () => {
    currentRead = { ...structuredClone(B1), current_read: { analysis_ready: structuredClone(B1.analysis_ready),
      computed_against_hash: B1.graph_hash, current_analysis_hash: B1.graph_hash, run_id: 'fixture-head-b1' } };
    buildBrief = B1.brief;
    // The pilot completed its build with the host's ready/status words; its already-composed reply is not a narrator input.
    narrator = 'Your results are ready. You can view them now or ask me to explain them.';
    const { withholdGoalFiguresForMissingCurrentLevel } = await import('../../tools/handlers/run-analysis.js');
    currentRead.analysis_result.enrichment = withholdGoalFiguresForMissingCurrentLevel(currentRead.analysis_result.enrichment, currentRead.graph);
    const body = await buildTurn();
    expect((lastComposeInput as ReplyComposeInput).faceContract).toBe('draft');
    expect((lastComposeInput as ReplyComposeInput).chanceCells?.length).toBeGreaterThan(0);
    expect((lastComposeInput as ReplyComposeInput).chanceCells?.every(cell => cell.kind === 'withheld')).toBe(true);
    expect(body._answer_shape).toBeDefined();
    const shown = face(body._answer_shape!);
    expect(shown.split('\n').filter(line => /^Not shown(?::| yet;)/.test(line))).toEqual(['Not shown yet; why is under More detail']);
    expect(shown).toContain('How likely or how large is "Price-rise cancellation risk" today?');
    expect(shown).not.toContain('How likely or how large is it today?');
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
    // Q-c (DL 87114): one horizon-limit statement per surface.
    expect(count(body.assistant_text, "This model doesn't yet say whether any option gets there within 12 months.")).toBe(1);
    for (const sentence of [
      "Olumi can't show each option's chance of reaching your MRR target yet: the model doesn't have MRR's current level to measure from.",
      'This run doesn’t yet show each option’s chance of reaching £20,000.',
      "Olumi reads 'MRR' as 'Pro plan price' × 'Pro paying subscribers', but that hasn't been confirmed, so this run gives no chance of reaching the target for 'MRR'.",
    ]) expect(body._answer_shape!.detail, 'the three original detail withhold sentences are retained').toContain(sentence);
    process.stdout.write(`R11B_B1_BUILD ${JSON.stringify({ before: B1.before_shape, after: body._answer_shape, input: lastComposeInput,
      words: { before_face: words(face(B1.before_shape)), before_detail: words(B1.before_shape.detail),
        after_face: words(shown), after_detail: words(body._answer_shape!.detail) } })}\n`);
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it('r11c identity-only automatic first Run: the cell reason keeps the named identity marker through durable replay', async () => {
    currentRead = { ...structuredClone(B1), current_read: { analysis_ready: structuredClone(B1.analysis_ready),
      computed_against_hash: B1.graph_hash, current_analysis_hash: B1.graph_hash, run_id: 'fixture-head-b1-identity-only' } };
    buildBrief = B1.brief;
    narrator = 'Your results are ready. You can view them now or ask me to explain them.';
    // Keep the captured Run's identity-only cell reasons. Its graph's current-level gap is not marker authority.
    const body = await buildTurn();
    const input = lastComposeInput as ReplyComposeInput;
    expect(input.faceContract).toBe('draft');
    expect(input.chanceCells?.length).toBeGreaterThan(0);
    for (const cell of input.chanceCells!) {
      expect(cell.kind).toBe('withheld');
      if (cell.kind === 'withheld') expect(cell.reasons.map(reason => reason.code)).toEqual(['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED']);
    }
    expect(body._answer_shape).toBeDefined();
    const shown = face(body._answer_shape!);
    expect(shown.split('\n').filter(line => /^Not shown(?::| yet;)/.test(line))).toEqual([
      "Not shown: how MRR is worked out isn't confirmed",
    ]);
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
    // Q-c (DL 87114): one horizon-limit statement per surface.
    expect(count(body.assistant_text, "This model doesn't yet say whether any option gets there within 12 months.")).toBe(1);
    await expectStoredAndReplayed(body, lastBuildPayload);
  });

  it.each(['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_PRODUCT_NOT_READ'])(
    'typed %s cell owns the named marker even when the current graph identity is confirmed', code => {
      const graph = structuredClone(FX.read.graph);
      const goal = graph.nodes.find(n => n.id === 'mrr')!;
      (goal.nonlinear_identity as Rec).stated_in_brief = true;
      const verdict = targetTestabilityOf(graph);
      expect(verdict.kind === 'not_testable' && verdict.failures.some(f => f.code === 'identity_unconfirmed')).toBe(false);
      const note = withholdDisclosureFor(graph, withheldCells(code,
        'A generic read failure — reason prose must not select the cause.'));
      expect(note).toEqual({ kind: 'withhold', cause: 'unconfirmed_identity', goalLabel: 'MRR' });
      expect(markerForDisclosure(note!)).toBe("Not shown: how MRR is worked out isn't confirmed");
    });

  it.each(['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_PRODUCT_NOT_READ'])(
    'typed %s cell keeps the same named marker with an unconfirmed current graph identity', code => {
      const verdict = targetTestabilityOf(FX.read.graph);
      expect(verdict.kind === 'not_testable' && verdict.failures.some(f => f.code === 'identity_unconfirmed')).toBe(true);
      const note = withholdDisclosureFor(FX.read.graph, withheldCells(code, 'A generic read failure.'));
      expect(note).toEqual({ kind: 'withhold', cause: 'unconfirmed_identity', goalLabel: 'MRR' });
      expect(markerForDisclosure(note!)).toBe("Not shown: how MRR is worked out isn't confirmed");
    });

  it.each([null, 42, { nodes: null }, { nodes: [null, undefined, 12, 'x', {}] },
    { nodes: [{ kind: 'goal', label: 42 }] }, { nodes: [{ kind: 'goal', label: '  ' }] }])(
    'typed withheld marker safely falls back when graph nodes or the goal label are malformed (%j)', graph => {
      const note = withholdDisclosureFor(graph, withheldCells('GOAL_FIGURES_MISSING_CURRENT_LEVEL'));
      expect(note).toEqual({ kind: 'withhold', cause: 'missing_current_level' });
      expect(markerForDisclosure(note!)).toBe('Not shown yet; why is under More detail');
    });

  it.each(['GOAL_FIGURES_TARGET_NOT_TESTABLE', 'GOAL_FIGURES_USER_EFFECT_CLAMPED', 'GOAL_FIGURES_OPTIONS_IDENTICAL', 'GOAL_FIGURES_PROBABILITY_UNUSABLE',
    'GOAL_FIGURES_SHARE_APPROXIMATION', 'GOAL_FIGURES_CHANCE_AS_GOAL'])(
    'typed %s cause uses the fallback instead of borrowing a different graph cause', code => {
      const note = withholdDisclosureFor(FX.read.graph, withheldCells(code, 'A retained exact note.'));
      expect(note).toEqual({ kind: 'withhold', cause: 'other', goalLabel: 'MRR' });
      expect(markerForDisclosure(note!)).toBe('Not shown yet; why is under More detail');
    });

  it.each(['reason_not_recorded', 'FUTURE_UNMAPPED_WITHHOLD'])(
    'typed cell cause %s cannot be renamed after a latent graph failure', code => {
      const note = withholdDisclosureFor(FX.read.graph, withheldCells(code, 'The complete note stays under More detail.'));
      expect(note).toEqual({ kind: 'withhold', cause: 'other', goalLabel: 'MRR' });
      expect(markerForDisclosure(note!)).toBe('Not shown yet; why is under More detail');
    });

  it.each([{ cells: [] }, { cells: [{ kind: 'none' }] }, { cells: [{ kind: 'figure', display: '67%' }] }] as { cells: readonly CanonicalAnalysisCell[] }[])(
    'no withheld cell supplies no marker despite latent graph failures (%j)', ({ cells }) => {
      expect(withholdDisclosureFor(FX.read.graph, cells)).toBeNull();
    });

  it('the missing-current-level cell supplies its typed cause without reading reason prose', () => {
    const note = withholdDisclosureFor(FX.read.graph, withheldCells('GOAL_FIGURES_MISSING_CURRENT_LEVEL',
      'A deliberately generic producer message.'));
    expect(note).toEqual({ kind: 'withhold', cause: 'missing_current_level', goalLabel: 'MRR' });
    expect(markerForDisclosure(note!)).toBe("Not shown: MRR's current level is missing");
  });

  it('typed marker labels apply the existing proposal-id display reader before the last writer', () => {
    const graph = structuredClone(FX.read.graph);
    graph.nodes.find(n => n.id === 'mrr')!.label = 'MRR prop_deadbeef0123456789';
    const note = withholdDisclosureFor(graph, withheldCells('GOAL_FIGURES_MISSING_CURRENT_LEVEL'));
    expect(note).toEqual({ kind: 'withhold', cause: 'missing_current_level', goalLabel: 'MRR this proposal' });
    expect(markerForDisclosure(note!)).toBe("Not shown: MRR this proposal's current level is missing");
    expect(markerForDisclosure(note!)).not.toContain('prop_deadbeef0123456789');
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
    const { withholdGoalFiguresForMissingCurrentLevel } = await import('../../tools/handlers/run-analysis.js');
    currentRead.analysis_result.enrichment = withholdGoalFiguresForMissingCurrentLevel(enrichment, saved);
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
    expect((lastComposeInput as ReplyComposeInput).chanceCells?.every(cell => cell.kind === 'withheld')).toBe(true);
    const reason = thresholdReasonLine(saved, currentRead.analysis_result);
    expect(reason, 'the exact threshold producer still supplies the full detail reason').not.toBeNull();
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

  it('R3b mixed withhold (held month + missing current level): "Set current level" stays; no steady-state card (DL 58e392 #2903 P1)', async () => {
    currentRead = structuredClone(FX.read);
    saved = structuredClone(currentRead.graph);
    const goal = saved.nodes.find(n => n.id === 'mrr')!;
    delete goal.nonlinear_identity;
    expect(goal.goal_horizon_months).toBe(12);
    currentRead.graph = saved;
    currentRead.graph_hash = computeAnalysisAffectingGraphHash(saved as never)!.slice(0, 16);
    currentRead.analysis_result.computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).computed_against_hash = currentRead.graph_hash;
    (currentRead.current_read as Rec).current_analysis_hash = currentRead.graph_hash;
    const enrichment = currentRead.analysis_result.enrichment as Rec;
    enrichment.inference_warnings = (enrichment.inference_warnings as Rec[])
      .filter(w => w.code === 'GOAL_THRESHOLD_NOT_CONVERTIBLE');
    // The producer's own order (run-analysis.ts): the missing-level withhold, then the §(ad) horizon withhold.
    const { withholdGoalFiguresForMissingCurrentLevel } = await import('../../tools/handlers/run-analysis.js');
    const { withholdGoalFiguresForUntestedHorizon } = await import('../../goal-target/goal-horizon-verdict.js');
    currentRead.analysis_result.enrichment = withholdGoalFiguresForUntestedHorizon(
      withholdGoalFiguresForMissingCurrentLevel(enrichment, saved), saved);
    const codes = ((currentRead.analysis_result.enrichment as Rec).inference_warnings as Rec[]).map(w => w.code);
    expect(codes).toEqual(expect.arrayContaining(['GOAL_FIGURES_MISSING_CURRENT_LEVEL', 'GOAL_FIGURES_HORIZON_NOT_TESTED']));
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
    } });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as Body;
    expect(body.suggested_actions.map(a => a.label)).not.toContain('It stays about the same unless we act');
    const currentLevelControl = body.action_bar?.priority.filter(a => a.action_id === 'set_current_level' && a.enabled === true) ?? [];
    expect(count(face(body._answer_shape!), '?') + currentLevelControl.length, 'one resolving ask or current-level control').toBe(1);
  });
});
