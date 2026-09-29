/** Real local Postgres + PostgREST, production writer/readers; captured PLoT replay.
 * RUN_SHARED_DATA_LOCAL=1 pnpm vitest run tests/integration/shared-data-run-lifecycle.local.test.ts
 * Start scripts/dev/shared-data-db.mjs first. This fixture cannot target remote storage.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';

type Json = Record<string, any>;
const enabled = process.env.RUN_SHARED_DATA_LOCAL === '1';
const livePlot = process.env.SHARED_DATA_LIVE_PLOT === '1';
const suite = enabled ? describe : describe.skip;
const scenarioId = randomUUID();
const fixture = JSON.parse(readFileSync(new URL('../fixtures/cross-service/b5-per-limit/17d1cd3a.graph.json', import.meta.url), 'utf8')) as Json;
const plotBody = JSON.parse(readFileSync(new URL('../fixtures/cross-service/b5-per-limit/17d1cd3a.plot-response.json', import.meta.url), 'utf8')) as Json;
const clone = <T>(x: T): T => structuredClone(x);

suite('shared data: saved Run → cold read / AI context → edit → stale → rerun', () => {
  let client: SupabaseClient;
  let session: typeof import('../../src/orchestrator-v5/session/index.js');
  let loader: typeof import('../../src/orchestrator-v5/build-turn-context.js');
  let read: typeof import('../../src/routes/scenario-graph-analysis-read.js');
  let writer: typeof import('../../src/orchestrator-v5/system-events/dispatch.js');
  let runModule: typeof import('../../src/orchestrator-v5/tools/handlers/run-analysis.js');
  let hashes: typeof import('../../src/orchestrator-v5/context/graph-hash.js');
  let packModule: typeof import('../../src/orchestrator-v5/context/context-pack-assembler.js');
  let certaintyModule: typeof import('../../src/orchestrator-v5/agent-lane/goal-certainty-for-agent.js');
  let plotClient: import('../../src/orchestrator/plot-client.js').PLoTClient;
  beforeAll(async () => {
    const connection = JSON.parse(readFileSync(resolve(homedir(), '.codex/workspaces/shared-data-spine-local/connection.json'), 'utf8'));
    if (connection.supabaseUrl !== 'http://127.0.0.1:55431') throw new Error('Local-only test refused a non-local target');
    process.env.SUPABASE_URL = connection.supabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = connection.serviceRoleKey;
    process.env.CEE_V5_GRAPH_CAS_MODE = 'enforce';
    process.env.CEE_V5_GRAPH_CAS_RPC = 'enforce';
    process.env.CEE_MODEL_VERSIONS_ENABLED = 'true';
    if (livePlot) {
      if (!process.env.SHARED_DATA_PLOT_ENV) throw new Error('Live PLoT needs an explicit credentials file');
      const { parse } = await import('dotenv');
      const env = parse(readFileSync(process.env.SHARED_DATA_PLOT_ENV));
      // Copy only analysis client configuration. Database/auth service settings
      // from a shared deployment must never enter this local experiment.
      for (const key of ['PLOT_BASE_URL', 'PLOT_AUTH_TOKEN']) {
        if (!env[key]) throw new Error(`Missing ${key}`);
        process.env[key] = env[key];
      }
    }
    const config = await import('../../src/config/index.js');
    config._resetConfigCache();
    session = await import('../../src/orchestrator-v5/session/index.js');
    loader = await import('../../src/orchestrator-v5/build-turn-context.js');
    read = await import('../../src/routes/scenario-graph-analysis-read.js');
    writer = await import('../../src/orchestrator-v5/system-events/dispatch.js');
    runModule = await import('../../src/orchestrator-v5/tools/handlers/run-analysis.js');
    hashes = await import('../../src/orchestrator-v5/context/graph-hash.js');
    packModule = await import('../../src/orchestrator-v5/context/context-pack-assembler.js');
    certaintyModule = await import('../../src/orchestrator-v5/agent-lane/goal-certainty-for-agent.js');
    plotClient = livePlot ? (await import('../../src/orchestrator/plot-client.js')).createPLoTClient()!
      : { run: async () => clone(plotBody), validatePatch: async () => ({}) } as never;
    client = createClient(connection.supabaseUrl, connection.serviceRoleKey, { auth: { persistSession: false } });
    const { error } = await client.from('scenarios').insert({ id: scenarioId, user_id: randomUUID(), graph: fixture.graph, brief_text: fixture.brief_text });
    if (error) throw new Error(`Seed failed: ${error.message}`);
  });
  afterAll(async () => {
    if (client) await client.from('scenarios').delete().eq('id', scenarioId);
    session?.resetSessionStoreForTests();
  });

  async function coldRead() {
    session.resetSessionStoreForTests();
    const store = session.getSessionStore();
    const snapshot = await store.loadGraphAndBriefText(scenarioId);
    const result = await read.readScenarioAnalysis({ scenarioId, graph: snapshot.graph, briefText: snapshot.briefText, requestId: randomUUID() });
    const turns = await store.readRecent(scenarioId);
    const facts = await store.readFactsFor(turns.map(t => t.id));
    const pack = packModule.assembleContextPack({ payload: makeMessagePayload({ scenario_id: scenarioId }),
      graph: snapshot.graph as never, priorTurns: turns, priorFacts: facts });
    const agentCertainty = certaintyModule.goalCertaintyForAgent(result.analysis_result,
      { scenario_id: scenarioId, analysis_state: result.analysis_state }, {
        raw: snapshot.graph, analysis_state: result.analysis_state, analysis_result: result.analysis_result,
        goal_certainty: result.analysis_goal_certainty,
      });
    return { graph: snapshot.graph as Json, result, pack, facts, agentCertainty };
  }
  async function runAndSave() {
    const snapshot = await loader.loadScenarioSnapshotForRunAnalysis(scenarioId, 'local-shared-data-run');
    const handler = runModule.createRunAnalysisHandler({
      plotClient,
      scenarioReader: async () => snapshot,
    });
    const turnId = randomUUID();
    const outcome = await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: scenarioId, request_id: turnId, budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: fixture.brief_text, persistedGraph: snapshot.rawPersistedGraph },
      payload: makeMessagePayload({ turn_id: turnId, scenario_id: scenarioId, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
      requestId: turnId, signal: new AbortController().signal, orientationText: '',
    } as never);
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis')!;
    expect(fact).toBeDefined();
    await session.getSessionStore().append({ scenario_id: scenarioId, turn_id: turnId, turn_class: 'handler',
      handler_id: 'run_analysis', request_hash: turnId, response_emitted: true, llm_calls_used: 0, duration_ms: 1,
      handler_facts: outcome.handler_facts });
    return fact as Json;
  }

  it('preserves Run certainty, invalidates after one atomic value edit, then reloads the rerun', async () => {
    const firstFact = await runAndSave();
    const current = await coldRead();
    expect(current.result.analysis_state?.run_state.kind).toBe('complete_current');
    expect(current.result.analysis_goal_certainty).toEqual(firstFact.result.goal_certainty);
    expect(current.agentCertainty?.unchecked).toBeUndefined();
    if (firstFact.result.goal_certainty?.length) {
      expect(current.agentCertainty?.options).toEqual(firstFact.result.goal_certainty.map((decision: Json) =>
        expect.objectContaining({ option_id: decision.option_id, probability_of_goal: decision.probability_of_goal,
          earned: decision.earned, ...(decision.earned ? {} : { say: decision.say }) })));
    }
    expect(current.pack.analysis_state?.freshness).toBe('fresh');
    expect(current.result.analysis_result?.computed_against_hash).toBe(firstFact.result.graph_hash_at_run);
    const factor = current.graph.nodes.find((n: Json) => n.kind === 'factor' && n.observed_state?.raw_value > 0 && n.observed_state?.cap > n.observed_state.raw_value);
    expect(factor, 'captured model has a supported editable factor').toBeDefined();
    const input = { scenario_id: scenarioId, turn_id: randomUUID(),
      base_graph_hash: hashes.computeAnalysisAffectingGraphHash(current.graph as never)!, links: [], levels: [],
      values: [{ factor_id: factor.id, value: factor.observed_state.raw_value + 1, unit: factor.observed_state.unit, author: 'user_specified' as const }] };
    const edit = await writer.commitOptionLevelsInProcess(input, 'local-shared-data-edit');
    expect(edit.status, JSON.stringify(edit)).toBe('committed');
    const stale = await coldRead();
    expect(stale.result.analysis_state?.run_state.kind).toBe('complete_stale');
    expect(stale.result).not.toHaveProperty('analysis_goal_certainty');
    expect(stale.pack.analysis_state?.freshness).toBe('stale');
    const versionsBeforeReplay = await client.from('model_versions').select('id').eq('scenario_id', scenarioId);
    expect(versionsBeforeReplay.error).toBeNull();
    expect(versionsBeforeReplay.data).toHaveLength(1);
    // The in-process door refuses the old base before reaching SQL replay.
    // This is an explicit stale reply; the original edit must remain singular.
    expect((await writer.commitOptionLevelsInProcess(input, 'local-shared-data-replay')).status).toBe('stale');
    const versionsAfterReplay = await client.from('model_versions').select('id').eq('scenario_id', scenarioId);
    expect(versionsAfterReplay.data).toEqual(versionsBeforeReplay.data);
    const editFacts = await client.from('v5_handler_facts').select('id').eq('scenario_id', scenarioId).eq('payload->>fact_type', 'set_factor_value');
    expect(editFacts.error).toBeNull();
    expect(editFacts.data).toHaveLength(1);
    const concurrent = await writer.commitOptionLevelsInProcess({ ...input, turn_id: randomUUID(),
      values: [{ ...input.values[0], value: factor.observed_state.raw_value + 2 }] }, 'local-shared-data-old-base');
    expect(concurrent.status).toBe('stale');
    const secondFact = await runAndSave();
    const reopened = await coldRead();
    expect(secondFact.result.graph_hash_at_run).not.toBe(firstFact.result.graph_hash_at_run);
    expect(reopened.result.analysis_state?.run_state.kind).toBe('complete_current');
    expect(reopened.result.analysis_goal_certainty).toEqual(secondFact.result.goal_certainty);
    expect(reopened.pack.analysis_state?.freshness).toBe('fresh');
    expect(reopened.graph.nodes.find((n: Json) => n.id === factor.id).observed_state.raw_value).toBe(factor.observed_state.raw_value + 1);
    // Optional bridge into the independent UI checkout: actual stored/read bytes,
    // with no connection details. The UI consumes this through its real applier.
    if (process.env.SHARED_DATA_RECEIPT_PATH) writeFileSync(process.env.SHARED_DATA_RECEIPT_PATH, JSON.stringify({
      scenarioId, computation: livePlot ? 'live-PLoT' : 'captured-PLoT-replay',
      current: { read: current.result, agentCertainty: current.agentCertainty },
      stale: { read: stale.result, agentCertainty: stale.agentCertainty },
      reopened: { read: reopened.result, agentCertainty: reopened.agentCertainty },
    }, null, 2));
  }, 240000);
});
