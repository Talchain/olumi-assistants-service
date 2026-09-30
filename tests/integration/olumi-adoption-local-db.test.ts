/**
 * Opt-in isolated PostgREST/Postgres witness for an approved Olumi option.
 * Requires only the named local DB/REST containers plus a local service JWT;
 * the test-only adapter binds Supabase JS's /rest/v1 path to bare PostgREST.
 * The scenario has a fresh non-null owner because v5 deliberately omits model
 * versions for guest scenarios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { OlumiResponse } from '@talchain/schemas/boundary';
import { commitDirectAnswer } from '../../src/orchestrator-v5/commit.js';
import { computeExpectedGraphCasHashes } from '../../src/orchestrator-v5/context/graph-cas-conflict.js';
import { loadPersistedGraphStrict } from '../../src/orchestrator-v5/build-turn-context.js';
import { commitOlumiOptionAdoptionInProcess } from '../../src/orchestrator-v5/system-events/olumi-option-adoption.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { config } from '../../src/config/index.js';
import { decideModelVersionCreation } from '../../src/orchestrator-v5/model-management/version-creation-policy.js';

const enabled = process.env.RUN_OLUMI_ADOPTION_LOCAL_DB === '1'
  && process.env.SUPABASE_URL === 'http://127.0.0.1:55434'
  && process.env.CEE_V5_GRAPH_CAS_RPC === 'enforce'
  && process.env.CEE_MODEL_VERSIONS_ENABLED === 'true'
  && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const scenarioId = randomUUID();
const userId = randomUUID();
const fixture = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as {
  graph: { nodes: Array<Record<string, unknown>>; edges: unknown[] };
};
const response = (): OlumiResponse => ({
  response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [],
  stage_indicator: 'frame',
});

describe.runIf(enabled)('Olumi option adoption against isolated local PostgREST', () => {
  let client: SupabaseClient;
  let store: SupabaseSessionStore;
  let scenarioCreated = false;
  let proxy: Server;

  beforeAll(async () => {
    // Supabase JS adds /rest/v1; the named local container is bare PostgREST.
    proxy = createServer((req, res) => {
      const path = (req.url ?? '/').replace(/^\/rest\/v1(?=\/|\?|$)/, '') || '/';
      const upstream = httpRequest({ hostname: '127.0.0.1', port: 55433, path,
        method: req.method, headers: { ...req.headers, host: '127.0.0.1:55433' } }, (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(res);
      });
      upstream.on('error', (err) => { res.writeHead(502); res.end(err.message); });
      req.pipe(upstream);
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(55434, '127.0.0.1', resolve);
    });
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    store = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 4 }), {
      defaultReadLimit: 10, graphCasRpc: 'enforce',
    });
    const { error } = await client.rpc('ensure_scenario_exists', { p_scenario_id: scenarioId, p_user_id: userId });
    if (error) throw new Error(`local scenario creation failed: ${JSON.stringify({ name: error.name, code: error.code, message: error.message, details: error.details })}`);
    scenarioCreated = true;
  });

  afterAll(async () => {
    try {
      if (!client || !scenarioCreated) return;
      // This test owns only its fresh random scenario. Never sweep by a broad marker.
      const { error } = await client.from('scenarios').delete().eq('id', scenarioId);
      if (error) throw new Error(`local scenario cleanup failed: ${error.code ?? error.message}`);
    } finally {
      proxy?.close();
    }
  });

  it('atomically includes the existing option and cold-reads its exact preserved meaning', async () => {
    expect(config.cee.modelVersionsEnabled).toBe(true);
    expect(config.features.graphCasRpc).toBe('enforce');
    expect(decideModelVersionCreation(null, fixture.graph).create).toBe(true);
    const seeded = await commitDirectAnswer(response(), {
      scenario_id: scenarioId,
      turn_id: `seed-${randomUUID()}`,
      turn_class: 'direct_answer', handler_id: null,
      request_hash: `sha256:${randomUUID().replaceAll('-', '')}`,
      llm_calls_used: 0, duration_ms: 0, handler_facts: [],
      graph: fixture.graph, contentGraph: fixture.graph,
      pending_actions: [], priorPendingActions: [], coaching_state: null,
      expectedGraphIdentityHash: null, expectedGraphAnalysisHash: null,
    }, store);
    expect(seeded.graphPersisted).toBe(true);

    const before = await loadPersistedGraphStrict(scenarioId, store) as typeof fixture.graph;
    const optionBefore = before.nodes.find((n) => n.id === 'raise_price_to_54')!;
    const hashes = computeExpectedGraphCasHashes(before);
    expect(hashes.expectedGraphAnalysisHash).toBeTruthy();
    expect(hashes.expectedGraphIdentityHash).toBeTruthy();

    const result = await commitOlumiOptionAdoptionInProcess({
      scenario_id: scenarioId, turn_id: `adopt-${randomUUID()}`,
      option_id: 'raise_price_to_54', expected_label: String(optionBefore.label),
      expected_interventions: optionBefore.interventions as Record<string, unknown>,
      base_graph_hash: hashes.expectedGraphAnalysisHash!,
      expected_graph_identity_hash: hashes.expectedGraphIdentityHash!,
    }, `local-witness-${randomUUID()}`);
    expect(result.status).toBe('committed');

    const coldStore = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 4 }), {
      defaultReadLimit: 10, graphCasRpc: 'enforce',
    });
    const after = await loadPersistedGraphStrict(scenarioId, coldStore) as typeof fixture.graph;
    const optionAfter = after.nodes.find((n) => n.id === 'raise_price_to_54')!;
    expect(optionAfter).toMatchObject({
      id: optionBefore.id, proposed_by: 'olumi', analysis_participation: 'included',
      interventions: optionBefore.interventions,
    });
    expect(after.edges).toEqual(before.edges);
    expect(after.nodes).toHaveLength(before.nodes.length);
    const { count: turns, error: turnError } = await client.from('v5_conversation_turns')
      .select('*', { count: 'exact', head: true }).eq('scenario_id', scenarioId);
    expect(turnError).toBeNull();
    expect(turns).toBe(2);
    const { count: versions, error: versionError } = await client.from('model_versions')
      .select('*', { count: 'exact', head: true }).eq('scenario_id', scenarioId);
    expect(versionError).toBeNull();
    expect(versions).toBe(2);
  });
});
