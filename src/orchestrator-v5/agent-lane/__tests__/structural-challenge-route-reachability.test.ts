/** Route → real method adapter → real SCI-DEEP dispatch → real Run handler, entirely offline.
 * Only transport boundaries are replaced. Replaying the bank-2 response tests press reachability and licences;
 * it does not claim that the fixture is a fresh scientific recomputation of the renamed test graph.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { PLoTClient, PLoTClientRunOpts } from '../../../orchestrator/plot-client.js';
import type { CommittedTurnRecord, SessionStore } from '../../session/store.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY, parseStructuralChallengePress, structuralChallengePressId } from '../method-turn/structural-challenge-turn.js';
import { reconciliationPending, refreshScopePending } from '../goal-scope.js';
import type { HandlerFactWithTurn } from '../../types/handler-fact.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const transport = vi.hoisted(() => ({ store: undefined as SessionStore | undefined, plot: undefined as PLoTClient | undefined }));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => transport.store }));
vi.mock('../../../orchestrator/plot-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPLoTClient: () => transport.plot,
}));

const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const LINK = { from_id: 'driver_retention', to_id: 'goal_value' };
const REFUSAL = "I can't tell which link this is, so I can't test it. Nothing in your model changed.";
const MODEL_A = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/sci-deep-bank2/A-graph.json', import.meta.url), 'utf8')).graph as Rec;
const PLOT_A = JSON.parse(readFileSync(new URL('../../handlers/__tests__/fixtures/sci-deep-bank2-A.plot-body.json', import.meta.url), 'utf8')) as Rec;

/** Rename recorded ids throughout graph and response, including keyed maps, without changing their values. */
function renameIds(value: any, link: typeof LINK): any {
  const ids: Record<string, string> = { monthly_churn: link.from_id, paying_subscribers: link.to_id };
  if (typeof value === 'string') return ids[value] ?? value;
  if (Array.isArray(value)) return value.map((v) => renameIds(v, link));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, v]) => [ids[key] ?? key, renameIds(v, link)]));
  return value;
}

describe('agent route: real structural challenge press reachability', () => {
  let app: FastifyInstance;
  let graph: Rec;
  let graphRead: Rec;
  let graphReadFailed = false;
  let lateScope = false;
  let runFacts: HandlerFact[];
  let runRows: HandlerFactWithTurn[];
  let runTurns: SessionTurnWithContent[];
  let turnId: string;
  let baselineBody: Rec;
  let link = LINK;
  let plotCalls: { body: Rec; requestId: string; opts?: PLoTClientRunOpts }[];
  let append: Mock<SessionStore['append']>;
  let graphWrite: Mock<SessionStore['storeDraftGraph']>;
  const provider = vi.fn(async () => new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'normal' }] }],
  }), { status: 200 }));

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', provider);
    transport.plot = {
      run: vi.fn(async (body, requestId, opts) => {
        plotCalls.push({ body: structuredClone(body), requestId, opts });
        const response = renameIds(PLOT_A, link);
        delete response._source;
        // Echo the handler's pinned seed, as the real PLoT transport does.
        response.meta.seed_used = String(body.seed ?? PLOT_A.meta.seed_used);
        return response;
      }),
      validatePatch: vi.fn(async () => { throw new Error('Unexpected patch validation'); }),
    };
    app = await buildApp();
  }, 120_000);

  /** Re-importing gives the cold route no remembered turn, while the durable store rows remain the same. */
  async function buildApp(cold = false): Promise<FastifyInstance> {
    if (cold) vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const instance = Fastify({ logger: false });
    instance.post('/assist/v1/scenarios/:id/graph', async () => {
      if (graphReadFailed) throw new Error('offline graph read failure');
      /** Only the post-candidate graph read introduces this issue; dispatch has already read its receipt. */
      if (lateScope && plotCalls.length > 0) {
        // A typed issue gains its operands on the first refresh; its refreshed form is the stable open issue.
        const pending = refreshScopePending(reconciliationPending(SCENARIO, {
          kind: 'reconcile_goal_scope', goal_id: 'mrr', goal_label: 'MRR',
          declared_scope: { modelled: 'all revenue', alternative: 'one stream', stated_in_brief: true },
          question: 'Which revenue scope should this model represent?', /* #2613-successor (Science d5 6006584860): an UNTYPED question no longer blocks; this fixture's open issue is a typed one. */ scope: { modelled: 'all revenue', alternative: 'one stream', extent: 'total', stated_in_brief: true, source: { quote: 'all revenue' } }, expected: 'billing_basis', operands: [], derivations: [],
        }), graph)!;
        expect(refreshScopePending(pending, graph)).toEqual(pending);
        transport.store!.readMostRecentPendingActions = vi.fn(async () => [pending]);
      }
      return graphRead;
    });
    instance.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'normal', blocks: [] }));
    await instance.register(agentV1TurnRoute);
    await instance.ready();
    return instance;
  }

  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  /** Both baselines use the real Run handler and transport; only the selected durable fact set changes. */
  async function realRun(requestId: string, runTurnId?: string) {
    const { buildTurnContext, loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const { createRegistry, resolveHandler } = await import('../../tools/registry.js');
    const { priorRunForSeed } = await import('../../coaching/seed-reuse.js');
    // Kept as the module namespace: destructuring widens its `unique symbol` NO_CLAIM to `symbol` (typecheck ratchet).
    const binding = await import('../../run-analysis-snapshot-binding.js');
    const payload = makeMessagePayload({ scenario_id: SCENARIO, stage: 'analyse', turn_class: 'decide', message: 'run analysis',
      ...(runTurnId !== undefined ? { turn_id: runTurnId } : {}) });
    const context = await buildTurnContext(payload, requestId);
    const handler = resolveHandler(createRegistry({
      plotClient: transport.plot,
      scenarioReader: () => loadScenarioSnapshotForRunAnalysis(SCENARIO, requestId),
      counterfactualClient: null,
    }), 'run_analysis')!;
    const output = await binding.runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: binding.NO_CLAIM, priorRunSeed: priorRunForSeed([]) },
      () => handler({ context, payload, requestId, signal: new AbortController().signal, orientationText: '' }));
    const fact = output.handler_facts.find((entry) => entry.fact_type === 'run_analysis')!;
    expect(fact).toBeDefined();
    return { fact, payload };
  }

  async function licensedRun(selectedLink = LINK) {
    link = selectedLink;
    graph = renameIds(MODEL_A, link);
    // The user has stated these sizes before Run A; the current real admission/licence logic stays in force.
    for (const edge of graph.edges as Rec[]) edge.provenance = { ...edge.provenance, source: 'user_specified', magnitude: 'user_stated' };
    transport.store = createNoopSessionStore({ loadGraphResult: graph });
    const { fact: runA, payload } = await realRun('baseline');
    expect(runA).toBeDefined();
    expect(plotCalls).toHaveLength(1);
    baselineBody = plotCalls[0].body;
    const computedAt = (runA as Rec).result.computed_at;
    runFacts = [runA];
    runRows = [{ fact: runA, fact_row_id: 'run-a-row', fact_created_at: computedAt, turn_id: 'baseline-row' }];
    runTurns = [{
      id: 'baseline-row', scenario_id: SCENARIO, user_id: null, turn_id: payload.turn_id,
      created_at: computedAt, turn_class: 'handler', handler_id: 'run_analysis', request_hash: 'baseline',
      response_emitted: true, llm_calls_used: 0, duration_ms: 0, user_message: 'run analysis', assistant_message: 'Analysis complete.',
    }];
    transport.store = createNoopSessionStore({
      loadGraphResult: graph,
      facts: runFacts,
      factsWithTurn: runRows,
      scenarioAnalysisFacts: runFacts,
      priorTurns: runTurns,
    });
    transport.store.readAnalysisInvalidatedAt = vi.fn(async () => null);
    const rows = new Map<string, CommittedTurnRecord>();
    append = vi.fn(async (write) => {
      const id = `row-${rows.size + 1}`;
      rows.set(write.turn_id, { id, request_hash: write.request_hash, assistant_message: write.assistantMessage ?? null,
        user_message: write.userMessage ?? null, llm_calls_used: write.llm_calls_used });
      return { id };
    });
    transport.store.readCommittedTurn = vi.fn(async (_sid, id) => rows.get(id) ?? null);
    graphWrite = vi.fn(async () => {});
    transport.store.append = append;
    transport.store.storeDraftGraph = graphWrite;
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'licensed-read' });
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.analysis_result).not.toBeNull();
    graphRead = { graph, graph_hash: (runA as Rec).result.graph_hash_at_run, ...read };
    plotCalls = [];
    provider.mockClear();
  }

  beforeEach(async () => { plotCalls = []; graphReadFailed = false; lateScope = false; turnId = randomUUID(); await licensedRun(); });
  const post = (chip: string, extra: Rec = {}, overrides: Rec = {}, on = app) => on.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: 'normal', source: 'chip', chip: { id: chip, ...extra }, ...overrides,
  } });

  function noModelCallsOrGraphWrites(body: Rec) {
    expect(provider).not.toHaveBeenCalled();
    expect(body._provider_calls).toEqual([]);
    expect(body._diagnostic_trace.timing.provider_calls).toBe(0);
    expect(body._diagnostic_trace.timing.tool_calls).toBe(0);
    expect(body._agent.tool_calls).toEqual([]);
    expect(body._agent.mutated).toBe(false);
    expect(body._diagnostic_trace.fast_path).toBe('method');
    // The claim is a separate row; the UI's conversation answer is recorded exactly once.
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.filter(([write]) => write.turn_id === turnId)).toHaveLength(1);
    expect(append.mock.calls.filter(([write]) => write.turn_id === `${turnId}:claim`)).toHaveLength(1);
    for (const [write] of append.mock.calls) {
      expect(write.handler_facts).toEqual([]);
      expect(write).not.toHaveProperty('graph');
      expect(write).not.toHaveProperty('graph_patch');
      expect(write.modelVersion).toBeUndefined();
    }
    expect(append.mock.calls.find(([write]) => write.turn_id === turnId)?.[0].assistantMessage).toBe(body.assistant_text);
    expect(graphWrite).not.toHaveBeenCalled();
    expect(transport.plot!.validatePatch).not.toHaveBeenCalled();
  }

  async function accepted(chip: string, extra: Rec = {}) {
    const response = await post(chip, extra);
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(body.assistant_text).toContain('What I tested:');
    expect(body.assistant_text).toContain("This test isn't saved.");
    // A candidate PLoT request proves the real dispatcher and Run handler were reached with this exact link.
    expect(plotCalls).toHaveLength(1);
    expect(plotCalls[0].requestId).toContain('structural-challenge');
    expect(plotCalls[0].opts?.retryPolicy).toBe('no_retry');
    expect(plotCalls[0].body.graph).toEqual({ ...baselineBody.graph, edges: baselineBody.graph.edges
      .filter((edge: Rec) => !(edge.from === link.from_id && edge.to === link.to_id)) });
    expect(baselineBody.graph.edges).toContainEqual(expect.objectContaining({ from: link.from_id, to: link.to_id }));
    noModelCallsOrGraphWrites(body);
    return body;
  }

  it('literal served UI press reaches real dispatch for driver_retention → goal_value on a licensed current Run', async () => {
    await accepted('agent-test-without-link:driver_retention::goal_value');
  });

  it('colon-bearing legacy endpoints resolve uniquely against existing graph edges', async () => {
    plotCalls = [];
    await licensedRun({ from_id: 'a:', to_id: 'b' });
    await accepted('agent-test-without-link:a:::b');
  });

  it('canonical JSON pair still reaches real dispatch', async () => {
    await accepted(structuralChallengePressId(LINK));
  });

  // A chip that ALSO says action_type run_analysis must not be taken by the earlier ordinary-Run branch.
  const RUN_TYPED = { action_type: 'run_analysis' };
  it('served legacy press carrying action_type run_analysis is still SCI-DEEP, never an ordinary Run', async () => {
    await accepted('agent-test-without-link:driver_retention::goal_value', RUN_TYPED);
  });
  it('canonical press carrying action_type run_analysis is still SCI-DEEP, never an ordinary Run', async () => {
    await accepted(structuralChallengePressId(LINK), RUN_TYPED);
  });
  it.each([
    ['malformed', 'agent-test-without-link:', REFUSAL],
    ['unknown legacy link', 'agent-test-without-link:a:::b',
      "That link isn't in your current model. Open a link from the canvas and try again. Nothing in your model changed."],
  ])('%s press carrying action_type run_analysis refuses as SCI-DEEP with zero provider calls and no Run', async (_name, chip, reply) => {
    const response = await post(chip, RUN_TYPED);
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.assistant_text).toBe(reply);
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(plotCalls).toHaveLength(0); noModelCallsOrGraphWrites(body);
  });

  it.each(['two matching edges', 'no matching edges'] as const)('ambiguous legacy press refuses with zero provider calls: %s', async (kind) => {
    if (kind === 'two matching edges') graphRead = { ...graphRead, graph: { ...graph, edges: [
      ...graph.edges, { from: 'a', to: ':b' }, { from: 'a:', to: 'b' },
    ] } };
    const response = await post('agent-test-without-link:a:::b');
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.assistant_text).toBe(kind === 'two matching edges'
      ? "More than one link in your model matches this one, so I can't tell which to test. Nothing in your model changed."
      : "That link isn't in your current model. Open a link from the canvas and try again. Nothing in your model changed.");
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(plotCalls).toHaveLength(0); noModelCallsOrGraphWrites(body);
  });

  it.each(['agent-test-without-link:', 'agent-test-without-link:["driver_retention"]'])('malformed prefixed press refuses with zero provider calls: %s', async (chip) => {
    const response = await post(chip);
    const body = response.json();
    expect(response.statusCode).toBe(200); expect(body.assistant_text).toBe(REFUSAL);
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(plotCalls).toHaveLength(0); noModelCallsOrGraphWrites(body);
  });

  it('100,000-character colon suffix: the parser refuses in under 20 ms, and the route turn refuses well under 2 s with zero provider calls', async () => {
    const chip = `agent-test-without-link:${':'.repeat(100_000)}`;
    const parseStarted = performance.now();
    expect(parseStructuralChallengePress(chip)).toBeNull();
    expect(performance.now() - parseStarted).toBeLessThan(20);
    const started = performance.now();
    const response = await post(chip);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2_000);
    expect(response.statusCode).toBe(200);
    expect(response.json().assistant_text).toBe(REFUSAL);
    expect(plotCalls).toHaveLength(0); noModelCallsOrGraphWrites(response.json());
  });

  it('canonical link absent from read-back graph reaches real dispatcher link_not_found', async () => {
    const response = await post(structuralChallengePressId({ from_id: 'absent', to_id: 'goal_value' }));
    expect(response.statusCode).toBe(200);
    expect(response.json().assistant_text).toBe("I can't test the link from absent to Paying subscribers. That link isn't in the model this analysis ran on, so there is nothing to test. Nothing in your model changed.");
    expect(plotCalls).toHaveLength(0); noModelCallsOrGraphWrites(response.json());
  });

  it('legacy read-back accepts recorded from_id/to_id endpoints', async () => {
    const { buildCanonicalAnalysisReadyFromGraph } = await import('../../../orchestrator/tools/analysis-ready-helper.js');
    graphRead.analysis_ready = buildCanonicalAnalysisReadyFromGraph(graph);
    graphRead = { ...graphRead, graph: { ...graph, edges: graph.edges.map(({ from, to, ...edge }: Rec) => ({ ...edge, from_id: from, to_id: to })) } };
    const response = await post('agent-test-without-link:driver_retention::goal_value');
    const body = response.json();
    expect(response.statusCode).toBe(200);
    // This read-back graph has no decision-context hash on served code.
    // No current result can be presented from it, even though the legacy press resolves and dispatches.
    expect(body.assistant_text).toBe("I couldn't line this test up exactly with the analysis you ran, so there's no fair comparison to show. Run the analysis again, then try this test. Nothing in your model changed.");
    expect(body.assistant_text).not.toContain('What I tested:');
    expect(plotCalls).toHaveLength(1);
    expect(plotCalls[0].requestId).toContain('structural-challenge');
    expect(plotCalls[0].opts?.retryPolicy).toBe('no_retry');
    expect(plotCalls[0].body.graph).toEqual({ ...baselineBody.graph, edges: baselineBody.graph.edges
      .filter((edge: Rec) => !(edge.from === link.from_id && edge.to === link.to_id)) });
    expect(baselineBody.graph.edges).toContainEqual(expect.objectContaining({ from: link.from_id, to: link.to_id }));
    noModelCallsOrGraphWrites(body);
  });

  it.each(['read fails', 'no graph'] as const)('prefixed press refuses when graph %s with zero provider calls', async (cause) => {
    if (cause === 'read fails') graphReadFailed = true;
    else graphRead = { ...graphRead, graph: undefined };
    const response = await post('agent-test-without-link:driver_retention::goal_value');
    expect(response.statusCode).toBe(200);
    expect(response.json().assistant_text).toBe("I couldn't read a model to test this link against. Nothing in your model changed.");
    expect(plotCalls).toHaveLength(0); noModelCallsOrGraphWrites(response.json());
  });

  it('not-a-press keeps ordinary model handling', async () => {
    const response = await post('not-a-press');
    const body = response.json();
    expect(response.statusCode).toBe(200); expect(body.assistant_text).toBe('normal');
    expect(body._diagnostic_trace.fast_path).not.toBe('method');
    expect(provider).toHaveBeenCalledTimes(1); expect(body._diagnostic_trace.timing.provider_calls).toBe(1);
    expect(plotCalls).toHaveLength(0);
  });
  describe('fresh SCI-DEEP presentation and baseline-bound replay', () => {
    const PRESS = 'agent-test-without-link:driver_retention::goal_value';
    const WITHHELD = 'The current analysis permission does not allow this comparison to be shown, so there is no conclusion to report. Nothing in your model changed.';

    /** Run identity hashes the turn id, not the seed; a distinct turn and later clock make B a newer Run on the same graph. */
    async function newerRun() {
      const runA = runFacts[0] as Rec;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.parse(runA.result.computed_at) + 1_000);
      let next: Awaited<ReturnType<typeof realRun>>;
      try { next = await realRun('baseline-b', randomUUID()); } finally { vi.useRealTimers(); }
      const runB = next.fact;
      expect((runB as Rec).result.run_id).not.toBe(runA.result.run_id);
      expect((runB as Rec).result.graph_hash_at_run).toBe(runA.result.graph_hash_at_run);
      runFacts.unshift(runB);
      runRows.unshift({ fact: runB, fact_row_id: 'run-b-row', fact_created_at: (runB as Rec).result.computed_at, turn_id: 'baseline-b-row' });
      runTurns.unshift({ ...runTurns[0], id: 'baseline-b-row', turn_id: next.payload.turn_id,
        created_at: (runB as Rec).result.computed_at, request_hash: 'baseline-b' });
      const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
      let selectedRunId: unknown;
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'licensed-read-b',
        onCurrentnessRead: (current) => { selectedRunId = (current.fact as Rec)?.result?.run_id; } });
      expect(selectedRunId).toBe((runB as Rec).result.run_id);
      expect(read.analysis_state?.run_state.kind).toBe('complete_current');
      expect(read.analysis_state?.run_state).toMatchObject({ kind: 'complete_current', computed_at: (runB as Rec).result.computed_at });
      expect(read.analysis_result).not.toBeNull();
      graphRead = { graph, graph_hash: (runB as Rec).result.graph_hash_at_run, ...read };
    }

    async function retry(form: 'exact' | 'chipless', on = app) {
      return post(PRESS, {}, form === 'chipless' ? { source: 'retry', chip: undefined } : {}, on);
    }

    function replayIs(response: Awaited<ReturnType<typeof post>>, expected: string, calls: number) {
      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body._agent.replayed).toBe(true);
      expect(body.assistant_text).toBe(expected);
      expect(body.blocks).toEqual([]);
      if (expected === STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY) expect(body.assistant_text).not.toContain('What I tested:');
      expect(plotCalls).toHaveLength(calls);
      expect(provider).not.toHaveBeenCalled();
      expect(body._provider_calls).toEqual([]);
    }

    it('F1-R1: an issue introduced only after dispatch withholds the final presentation', async () => {
      const adapter = await import('../method-turn/structural-challenge-turn.js');
      const presented = vi.spyOn(adapter, 'structuralChallengeTurnUnderLicence');
      lateScope = true;
      try {
        const response = await post(PRESS);
        const body = response.json();
        expect(response.statusCode).toBe(200);
        expect(body._diagnostic_trace.fast_path).toBe('method');
        expect(body.assistant_text).toBe(WITHHELD);
        expect(body.assistant_text).not.toContain('What I tested:');
        expect(presented.mock.results.at(-1)?.value?.result?.status).toBe('withheld');
        expect(plotCalls).toHaveLength(1);
        noModelCallsOrGraphWrites(body);
      } finally { presented.mockRestore(); }
    });

    it('F1-C1: the same harness without a late issue still presents the full accepted answer', async () => {
      await accepted(PRESS);
    });

    for (const form of ['exact', 'chipless'] as const) {
      it(`F2-${form === 'exact' ? 'R1' : 'R2'}: ${form} retry cannot present Run A beside newer Run B`, async () => {
        const live = await accepted(PRESS);
        await newerRun();
        expect(plotCalls).toHaveLength(2);
        expect(live.assistant_text).not.toBe(STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY);
        replayIs(await retry(form), STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY, 2);
      });
    }

    it('F2-R3: after a restart both retry forms refuse even while Run A is current', async () => {
      await accepted(PRESS);
      const cold = await buildApp(true);
      try {
        for (const form of ['exact', 'chipless'] as const) replayIs(await retry(form, cold), STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY, 1);
      } finally { await cold.close(); }
    });

    it('F2-C1: both warm retry forms re-present the original live reply byte for byte on Run A', async () => {
      const live = await accepted(PRESS);
      for (const form of ['exact', 'chipless'] as const) replayIs(await retry(form), live.assistant_text, 1);
    });

    it('F2-C2: a chipless ordinary-chip retry keeps exactly its stored words', async () => {
      const live = await post('not-a-press');
      expect(live.statusCode).toBe(200);
      expect(live.json().assistant_text).toBe('normal');
      expect(provider).toHaveBeenCalledTimes(1);
      provider.mockClear();
      const response = await post('not-a-press', {}, { source: 'retry', chip: undefined });
      replayIs(response, live.json().assistant_text, 0);
    });
  });
});
