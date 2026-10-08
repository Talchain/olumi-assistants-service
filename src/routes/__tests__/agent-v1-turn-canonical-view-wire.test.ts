/** Route harness follows agent-lane/__tests__/result-first-run.test.ts: real Run capability + final read. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema, type RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { ConversationContent } from '../../orchestrator-v5/session/conversation-content.js';
import type { LeaderFinalEgressOpts } from '../../orchestrator-v5/agent-lane/leader-final-egress.js';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE } from '../../orchestrator-v5/agent-lane/run-explanation.js';

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FACT = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8')) as RunAnalysisHandlerFact;
const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'MRR', goal_threshold_raw: 100 },
  { id: 'f', kind: 'factor', label: 'Price' }],
  edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }] };
const PRODUCER_CAPTURES = [
  ['point-driver', JSON.parse(readFileSync(new URL('./fixtures/canonical-view-b1.json', import.meta.url), 'utf8')).j],
  ['range-withheld', JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')).j],
] as const;
const WHY = 'UI-only why bytes: canonical-view-wire-1e';
type Json = Record<string, any>;
let fact: RunAnalysisHandlerFact | null = null;
let finalRead: Json;
let runRead: Json;
let viewChange: (view: Json) => unknown = view => view;
let graphReads = 0;
let scopeRecomposition = false;
let producerCapture: Json | null = null;
const rows: (Json & Partial<ConversationContent>)[] = [];
const modelBodies: Json[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.find(row => row.turn_id === id) ?? null),
  append: vi.fn(async (row: Json) => { rows.push({ ...row, id: row.turn_id, created_at: '2026-10-01T12:00:02.000Z',
    user_message: row.userMessage, assistant_message: row.assistantMessage }); return { id: row.turn_id }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => fact === null ? [] : [fact]),
  readFactsWithTurnFor: vi.fn(async () => fact === null ? [] : [{ fact, fact_row_id: producerCapture !== null ? 'captured-run' : 'selected-run',
    turn_id: 'run-row', fact_created_at: fact.result.computed_at }]),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store }));
const hashInput = vi.hoisted(() => vi.fn());
vi.mock('../../orchestrator-v5/build-turn-context.js', async original => {
  const actual = await original<typeof import('../../orchestrator-v5/build-turn-context.js')>();
  return { ...actual, deriveDecisionContextGraphHash: (graph: unknown) =>
    hashInput(graph) ?? actual.deriveDecisionContextGraphHash(graph) };
});
vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let app: FastifyInstance;
let producerReadApp: FastifyInstance;
let readAnalysis: typeof import('../scenario-graph-analysis-read.js')['readScenarioAnalysis'];
let hash: string;
function selectRun(id: string, computedAt: string) {
  fact = { ...FACT, noop: false, result: { ...FACT.result, scenario_id: SCENARIO,
    run_id: id, graph_hash_at_run: hash, computed_at: computedAt } };
}
function viewOf(read: Json): Json {
  return { ...read.canonical_analysis_view, options: [{ option_id: 'o1',
    cell: { kind: 'withheld', face: 'Chance not shown yet', why: WHY,
      reasons: [{ code: 'GOAL_FIGURES_MISSING_CURRENT_LEVEL', message: null }] },
    main_driver: { kind: 'not_recorded' } }] };
}
async function canonicalRead(): Promise<Json> {
  const read = await readAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'wire-test' });
  // This wire harness isolates transport from scope admission (the small graph has no option roster).
  return { graph: GRAPH, graph_hash: hash, brief_text: 'The strategic brief', ...read,
    analysis_state: scopeRecomposition ? read.analysis_state : { ...read.analysis_state, leader_claim: { permitted: false,
      withheld_reason: 'options_do_not_separate', separation: 'near_tie' } } };
}
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text',
      text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 });
  }));
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
  const { computeAnalysisAffectingGraphHash } = await import('../../orchestrator-v5/context/graph-hash.js');
  hash = computeAnalysisAffectingGraphHash(GRAPH as never)!;
  ({ readScenarioAnalysis: readAnalysis } = await import('../scenario-graph-analysis-read.js'));
  const { agentV1TurnRoute } = await import('../agent-v1-turn.js');
  const { default: scenarioGraphRoute } = await import('../assist.v1.scenario-graph.js');
  producerReadApp = Fastify({ logger: false });
  await scenarioGraphRoute(producerReadApp); await producerReadApp.ready();
  app = Fastify({ logger: false });
  app.post('/orchestrate/v2/turn', async () => {
    if (producerCapture !== null) {
      const read = await producerReadApp.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
      expect(read.statusCode).toBe(200);
      runRead = read.json();
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
        graph_hash: runRead.graph_hash, blocks: [runRead.analysis_result], analysis_state: runRead.analysis_state,
        analysis_ready: runRead.current_read.analysis_ready };
    }
    selectRun('earlier-tool-run', '2026-10-01T12:00:00.000Z');
    runRead = await canonicalRead();
    const response = { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: hash,
      blocks: [runRead.analysis_result], analysis_state: runRead.analysis_state,
      analysis_ready: { status: 'ready', options: [], blockers: [] }, canonical_analysis_view: viewOf(runRead) };
    // Another successful Run wins before the final read. The wire must use this selected Run, never the tool's.
    selectRun('final-selected-run', '2026-10-01T12:00:01.000Z');
    return response;
  });
  app.post('/assist/v1/scenarios/:id/graph', async () => {
    graphReads += 1;
    if (producerCapture !== null) {
      const read = await producerReadApp.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
      expect(read.statusCode).toBe(200);
      finalRead = read.json();
      return finalRead;
    }
    finalRead = await canonicalRead();
    finalRead.canonical_analysis_view = viewChange(viewOf(finalRead));
    return finalRead;
  });
  await app.register(agentV1TurnRoute); await app.ready();
}, 60_000);
afterAll(async () => {
  await app.close(); await producerReadApp.close(); vi.unstubAllGlobals();
  delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
});
beforeEach(() => {
  producerCapture = null; hashInput.mockReset();
  for (const key of ['readExistingScenario', 'readScenarioRunAnalysisFactsFor', 'readMostRecentPendingActions']) delete (store as Json)[key];
  selectRun('previous-run', '2026-09-30T12:00:00.000Z');
  scopeRecomposition = false; graphReads = 0; rows.length = 0; modelBodies.length = 0; viewChange = view => view;
});
const run = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
  turn_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
} });

function useProducerCapture(capture: Json) {
  producerCapture = capture;
  const result = capture.analysis_result;
  fact = RunAnalysisHandlerFactSchema.parse(JSON.parse(JSON.stringify({ fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: SCENARIO, leading_option_id: result.leading_option_id, summary: result.summary,
      win_probabilities: result.win_probabilities, enrichment: structuredClone(result.enrichment),
      graph_hash_at_run: capture.current_read.computed_against_hash,
      computed_at: capture.analysis_state.run_state.computed_at, run_id: capture.current_read.run_id,
      goal_certainty: capture.analysis_goal_certainty } }))); // Persisted facts are JSON, with absent optional keys.
  // Captures retain historical projection hashes: isolate the same hash-input seam as the neighbouring producer test.
  hashInput.mockReturnValue(fact.result.graph_hash_at_run);
  (store as Json).readExistingScenario = vi.fn(async () => ({ userId: null, graph: structuredClone(capture.graph),
    briefText: capture.brief_text, analysisInvalidatedAt: null, revision: 7 }));
  (store as Json).readMostRecentPendingActions = vi.fn(async () => []);
  (store as Json).readScenarioRunAnalysisFactsFor = vi.fn(async () => ({ facts: [{ fact,
    fact_row_id: 'captured-run', fact_created_at: fact!.result.computed_at }], total_count: 1 }));
}

function noViewBytes(value: unknown) {
  const bytes = JSON.stringify(value);
  expect({ key: bytes.includes('canonical_analysis_view'), face: bytes.includes('Chance not shown yet'),
    why: bytes.includes(WHY) }, 'UI view bytes must not reach model input').toEqual({ key: false, face: false, why: false });
}

describe('canonical view on the same-page turn wire', () => {
  it('RUN TURN: carries exactly the final selected Run view, beside that Run analysis_state', async () => {
    const response = await run();
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.canonical_analysis_view).toEqual(finalRead.canonical_analysis_view);
    expect(body.canonical_analysis_view.run.run_id).toBe(finalRead.current_read.run_id);
    // analysis_state identifies its selected Run by computed_at (it has no run_id member).
    expect(body.canonical_analysis_view.run.computed_at).toBe(body.analysis_state.run_state.computed_at);
    expect(body.analysis_state).toEqual(finalRead.analysis_state);
    expect(body.canonical_analysis_view.run.run_id).not.toBe(runRead.current_read.run_id);
    expect(graphReads, 'no second view read').toBe(1);
    expect(modelBodies).toHaveLength(0);
    // The UI separates additive keys before its strict schema parse.
    const shape = (OlumiResponseSchema as unknown as { shape: Json }).shape;
    const declared = Object.fromEntries(Object.entries(body).filter(([key]) => Object.hasOwn(shape, key)));
    expect(Object.hasOwn(shape, 'canonical_analysis_view')).toBe(false);
    expect(OlumiResponseSchema.safeParse(declared).success).toBe(true);
  });

  it('COMPOSED READ: scope recomposition owns both the view and analysis_state, never the earlier finalRead', async () => {
    scopeRecomposition = true;
    const response = await run();
    expect(response.statusCode, response.body).toBe(200);
    // The scope-removal path rereads canonical facts in-process and replaces both carriers together.
    const composed = await readAnalysis({ scenarioId: SCENARIO, graph: GRAPH,
      requestId: 'expected-composed', goalScopeClaimInput: { status: 'clear', issues: [] } });
    expect(response.json().canonical_analysis_view).toEqual(composed.canonical_analysis_view);
    expect(response.json().analysis_state).toEqual(composed.analysis_state);
    expect(response.json().canonical_analysis_view).not.toEqual(finalRead.canonical_analysis_view);
    expect(graphReads).toBe(1);
  });

  it('BYTE PARITY: every pre-existing wire field matches staging 8ec0a2574 bytes', async () => {
    const body = (await run()).json();
    const { canonical_analysis_view: _view, _agent, _diagnostic_trace, ...rest } = body;
    // Only the per-request UUID and elapsed milliseconds differ between executions.
    const { turn_id: _turnId, ...agent } = _agent;
    const { timing, ...trace } = _diagnostic_trace;
    const fixedTiming = { provider_ms: timing.provider_ms, tool_provider_ms: timing.tool_provider_ms,
      provider_calls: timing.provider_calls, tool_calls: timing.tool_calls, hops: timing.hops,
      dispatches: timing.dispatches.map(({ ms: _ms, ...dispatch }: Json) => dispatch) };
    const normalised = { ...rest, _agent: agent, _diagnostic_trace: { ...trace, timing: fixedTiming } };
    const hashes = Object.fromEntries(Object.entries(normalised).map(([key, value]) =>
      [key, createHash('sha256').update(JSON.stringify(value)).digest('hex')]));
    // Captured with this SAME harness against the untouched base route before adding the wire field.
    expect(hashes).toEqual({
      "response_version": "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35",
      "assistant_text": "ea302b607963c37f4a10715d61a863981104450a50ea248edaa6b4a3825913ec",
      "blocks": "c1a7d05ef1eb57e765cf8ff86b1864d848246594f7817f783021775555355be5",
      "suggested_actions": "0c1babe2aa530086daba3e4346227fa61665979da615bc207a5aa7e7bb427f14",
      "insights": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "stage_indicator": "6403d742dd3b2c3057824808325fa33bf51bd2508d294e9d2204b12a7e0cf79f",
      "analysis_state": "d812363987601da9e94e365714ecbfbee19927de7600d504fbb989e0244c5996",
      "narration": "7ef70f45e42695171732686a79b6e9f550486cd080f07877c4fbd7fbb3c123a9",
      "graph_hash": "912f94dbc24ee95f468d78bd45d466661919975ad99b90349205c103782cd933",
      "analysis_ready": "1aa3cd34589ca9242ad3cb05154043ee7559a1765b5646282ffacab83f9fce34",
      "draft_graph": "bad2923f6f0eabdecd4e44aa6905fbeb35343415facedcf40c953c7cb507fcd5",
      "_answer_shape": "42480035ce86ad4003eeace38ef517ee7ef4c930be0f5ca48c64e702f4b75b51",
      "action_bar": "0c1c0d9b61498c90fd27fed8d4d24d0e5851ef0747f3ecdaeedece34ee467603",
      "_provider_calls": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "_agent": "f54bda8731e3b9dab638e5a87fd362d85a695c5ccfafeda819e89f9a24c793de",
      "_diagnostic_trace": "d3559521297dafbcd23d2db68f21626e77e51129d92ccca32707cc0819295ec2"
    });
  });

  it.each([
    ['absent', () => undefined], ['null', () => null],
    ['wrong schema', (v: Json) => ({ ...v, schema: 'canonical_analysis_view.v0' })],
    ['wrong source', (v: Json) => ({ ...v, source: 'client_copy' })],
    ['missing options', (v: Json) => ({ ...v, options: undefined })],
    ['blank option', (v: Json) => ({ ...v, options: [{ option_id: ' ', cell: { kind: 'none' } }] })],
    ['partial cell', (v: Json) => ({ ...v, options: [{ option_id: 'o1', cell: { kind: 'figure' } }] })],
    ['invalid range', (v: Json) => ({ ...v, options: [{ option_id: 'o1', cell: { kind: 'range', display: '10–20%' } }] })],
    ['empty withheld reasons', (v: Json) => ({ ...v, options: [{ option_id: 'o1', cell: { kind: 'withheld', face: 'Hidden', reasons: [] } }] })],
  ])('INVALID/ABSENT VIEW: %s omits the own property', async (_name, change) => {
    viewChange = change;
    const response = await run();
    expect(response.statusCode, response.body).toBe(200);
    expect(Object.hasOwn(response.json(), 'canonical_analysis_view')).toBe(false);
  });

  it('empty valid options still carry the exact view', async () => {
    viewChange = view => ({ ...view, options: [] });
    const response = await run();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().canonical_analysis_view).toEqual(finalRead.canonical_analysis_view);
  });

  it.each(PRODUCER_CAPTURES)('RELOAD EQUALITY / REAL EGRESS: %s uses unchanged producer cells and licensed drivers', async (name, capture) => {
    useProducerCapture(capture);
    const response = await run();
    expect(response.statusCode, response.body).toBe(200);
    const turn = response.json();
    const reload = await producerReadApp.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(reload.statusCode).toBe(200);
    const read = reload.json();
    expect(turn.canonical_analysis_view.run.run_id).toBe(read.canonical_analysis_view.run.run_id);
    expect(turn.canonical_analysis_view).toEqual(read.canonical_analysis_view);
    expect(read.canonical_analysis_view.leader_licence).toBe('withheld');
    const kinds = read.canonical_analysis_view.options.map((row: Json) => row.cell.kind);
    const { goalChanceDriversForAgent } = await import('../../orchestrator-v5/goal-target/goal-chance-range-agent.js');
    const { isLicensedDriver } = await import('../../orchestrator-v5/goal-target/goal-chance-licence.js');
    if (name === 'point-driver') {
      expect(kinds).toContain('figure');
      const drivers = read.canonical_analysis_view.options.filter((row: Json) => row.main_driver.kind === 'available');
      expect(drivers.length).toBeGreaterThan(0);
      const licensed = goalChanceDriversForAgent(read.analysis_result, read.graph);
      for (const row of drivers) {
        expect(isLicensedDriver(row.main_driver.driver)).toBe(true);
        const recorded = capture.analysis_result.enrichment.inference_warnings.find((record: Json) => record.code === 'GOAL_CHANCE_LICENSED');
        expect(row.main_driver.driver).toEqual(recorded.driver_by_option[row.option_id]);
        expect(row.main_driver.driver).toEqual(licensed.find(driver => driver.option_id === row.option_id)!.driver);
      }
    } else {
      expect(kinds).toContain('range'); expect(kinds).toContain('withheld');
    }
    const { enforceLeaderLicenceAtFinalEgress, leaderGateInputsOf } = await import('../../orchestrator-v5/agent-lane/leader-final-egress.js');
    const view = structuredClone(read.canonical_analysis_view);
    const producerBytes = JSON.stringify(view);
    const egress = enforceLeaderLicenceAtFinalEgress({ ...turn, canonical_analysis_view: view }, {
      requestId: 'real-view-egress', exitPath: 'agent_lane_v1_final',
      ...leaderGateInputsOf({ analysisState: read.analysis_state, analysisReady: read.current_read.analysis_ready, graph: read.graph }),
    } as LeaderFinalEgressOpts);
    // Stop on any producer-view alteration: a removed leader path on a withheld view would also leak on reload.
    expect(egress.removedPaths.filter(path => path.startsWith('canonical_analysis_view'))).toEqual([]);
    expect(JSON.stringify(egress.response.canonical_analysis_view)).toBe(producerBytes);
    expect(JSON.stringify(view)).toBe(producerBytes);
  });

  it('CELLS HISTORY: the next model input carries sent prose, no canonical view key or cell reasons objects', async () => {
    useProducerCapture(PRODUCER_CAPTURES[1][1]);
    const runResponse = await run();
    expect(runResponse.statusCode, runResponse.body).toBe(200);
    const first = runResponse.json();
    expect(first.canonical_analysis_view.options.some((row: Json) => row.cell.kind === 'withheld' && row.cell.reasons.length > 0)).toBe(true);
    expect(modelBodies).toHaveLength(0); // Run composition is deterministic and makes no provider call.
    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: randomUUID(), scenario_id: SCENARIO, agent_session_id: first._agent.session_id,
      message: 'What does the model hold?',
    } });
    expect(next.statusCode).toBe(200); expect(modelBodies.length).toBeGreaterThan(0);
    for (const body of modelBodies) {
      expect(JSON.stringify(body.input)).not.toContain('canonical_analysis_view');
      expect(JSON.stringify(body.input)).not.toContain('"reasons":');
      const assistantHistory = body.input.filter((item: Json) => item.role === 'assistant');
      const historyTexts = assistantHistory.flatMap((item: Json) => typeof item.content === 'string'
        ? [item.content] : (item.content ?? []).flatMap((part: Json) => typeof part.text === 'string' ? [part.text] : []));
      expect(historyTexts).toContain(first.assistant_text);
      for (const row of first.canonical_analysis_view.options.filter((row: Json) => row.cell.kind === 'withheld')) {
        expect(JSON.stringify(body.input)).not.toContain(JSON.stringify(row.cell.reasons));
      }
    }
  });

  it('MODEL INPUT: carrying the view never feeds its key, face or why to warm/cold history, AI or interpreter/pack input', async () => {
    const first = (await run()).json();
    expect(first.canonical_analysis_view).toEqual(finalRead.canonical_analysis_view);
    expect(first.canonical_analysis_view.options[0].cell.why).toBe(WHY);
    const answers = rows.filter(row => typeof row.assistantMessage === 'string');
    expect(answers).toHaveLength(1);
    noViewBytes(answers); // The actual persistence writer uses named fields, never the whole response.
    // A future record carrying the additive root field must also be safe on cold reseed/pack assembly.
    const carryingRows = answers.map(row => ({ ...row, canonical_analysis_view: first.canonical_analysis_view }));
    const { historyFromDurableTurns } = await import('../../orchestrator-v5/agent-lane/history-store.js');
    noViewBytes(historyFromDurableTurns(carryingRows));
    rows[rows.length - 1].canonical_analysis_view = first.canonical_analysis_view;
    const chip = first.suggested_actions.find((action: Json) => isRunExplanationChip(action.id));
    expect(chip).toBeDefined();
    for (const session of [first._agent.session_id, randomUUID()]) {
      const explanation = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        turn_id: randomUUID(), scenario_id: SCENARIO, agent_session_id: session,
        message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id },
      } });
      expect(explanation.statusCode).toBe(200);
      expect(explanation.json().narration.status).toBe('ready');
    }
    expect(modelBodies).toHaveLength(2);
    for (const modelBody of modelBodies) noViewBytes(modelBody);
    // Ordinary Agent AI projection + actual serialised provider input, using the same carrying read/rows.
    const ordinary = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: randomUUID(), scenario_id: SCENARIO, agent_session_id: randomUUID(), message: 'What does the model hold?',
    } });
    expect(ordinary.statusCode).toBe(200);
    expect(modelBodies.length).toBeGreaterThan(2);
    for (const modelBody of modelBodies) noViewBytes(modelBody);
    const { assembleContextPack } = await import('../../orchestrator-v5/context/context-pack-assembler.js');
    const { makeMessagePayload } = await import('../../orchestrator-v5/__tests__/fixtures.js');
    const { projectModelFacingContextPack } = await import('../../orchestrator-v5/context/model-facing-context-pack.js');
    const { buildUserMessage } = await import('../../orchestrator-v5/routing/route-with-tool-use.js');
    const pack = assembleContextPack({ payload: makeMessagePayload(), priorTurns: carryingRows as never });
    noViewBytes(projectModelFacingContextPack(pack));
    noViewBytes(buildUserMessage(pack, 'Explain the current model.'));
    // Explicit Run-delta spread seam: project selected data, never the carrying turn object.
    const { selectedRunContextDelta } = await import('../../orchestrator-v5/agent-lane/__tests__/fixtures/selected-run-context-delta.js');
    const { savedRunContextFacts } = await import('../../orchestrator-v5/agent-lane/saved-run-context-facts.js');
    const { modelFacingToolResult } = await import('../../orchestrator-v5/agent-lane/licensed-run-view.js');
    const { projectModelFacingRunDelta } = await import('../../orchestrator-v5/context/model-facing-run-delta.js');
    const delta = selectedRunContextDelta(hash, first.analysis_state.run_state.computed_at);
    const carryingRead = { ...first, analysis_result: first.blocks.find((b: Json) => b.type === 'analysis_result'),
      run_delta: delta, raw: GRAPH };
    const facts = savedRunContextFacts(SCENARIO, carryingRead, { leader_may_be_named: true });
    expect(facts.run_delta).toEqual(projectModelFacingRunDelta(delta));
    noViewBytes(facts);
    noViewBytes(modelFacingToolResult('get_canonical_state', { analysis: facts }));
    noViewBytes(projectModelFacingContextPack({ ...pack, run_delta: facts.run_delta } as never));
  });
});
