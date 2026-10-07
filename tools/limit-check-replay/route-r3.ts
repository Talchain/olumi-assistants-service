/** Real saved/Explain route; the local singleton store and provider are stubbed. No Vitest. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { runExplanationChip, RUN_EXPLANATION_MESSAGE } from '../../src/orchestrator-v5/agent-lane/run-explanation.js';

const rows: Record<string, any>[] = [];
const store = {
  ensureScenarioExists: async () => ({ user_id: null }),
  readCommittedTurn: async (_scenario: string, id: string) => {
    const r = rows.find(x => x.turn_id === id);
    return r ? { id, request_hash: r.request_hash, assistant_message: r.assistantMessage ?? null, user_message: r.userMessage ?? null, llm_calls_used: r.llm_calls_used ?? 0, pending_actions: r.pending_actions ?? [] } : null;
  },
  releaseTurnClaim: async () => {},
  readMostRecentPendingActions: async () => [],
  append: async (row: Record<string, any>) => { rows.push(row); return { id: String(row.turn_id) }; },
  readRecent: async () => [], readFactsFor: async () => [], readAnalysisInvalidatedAt: async () => null,
};
process.env.AGENT_LANE_ENABLED = 'true';
process.env.AGENT_LANE_PREVIEW = 'false';
const { captured } = await import('./r2-cases.js');
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-replay-unused';
const { getSessionStore } = await import('../../src/orchestrator-v5/session/index.js');
const { createNoopSessionStore } = await import('../../src/orchestrator-v5/session/__tests__/fixtures.js');
Object.assign(getSessionStore(), createNoopSessionStore(), store);
process.env.AGENT_LANE_ENABLED = 'true';
process.env.AGENT_LANE_PREVIEW = 'false';
let providerInput = ''; let calls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (_input, init) => {
  if (!String(_input).startsWith('https://api.openai.com/v1/responses')) return new Response('[]', { status: 200 });
  calls++; providerInput = String(init?.body ?? '');
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The result depends on the figures in your model.' }] }] }), { status: 200 });
};
const { agentV1TurnRoute } = await import('../../src/routes/agent-v1-turn.js');
const app = Fastify({ logger: false });
const s = captured();
s.graph.nodes.find((n: Record<string, any>) => n.id === 'starter_tier_mrr').nonlinear_identity.stated_in_brief = true;
let attested = true;
app.post('/assist/v1/scenarios/:id/graph', async () => {
  const { analysis_identity_evaluated_node_ids, ...read } = s;
  return { ...read, ...(attested ? { analysis_identity_evaluated_node_ids } : {}) };
});
await app.register(agentV1TurnRoute); await app.ready();
try {
  const chip = runExplanationChip(s.scenario_id, { graphHash: s.graph_hash, analysisState: s.analysis_state, analysisResult: s.analysis_result });
  assert.ok(chip, 'capture must bind a current Explain control');
  for (const present of [true, false]) {
    attested = present; providerInput = ''; const prior = calls;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: s.scenario_id, turn_id: randomUUID(), message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id },
    } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(calls, prior + 1, 'real route must reach the interpreter with saved facts');
    assert.ok(providerInput.includes('limit_checks'), 'route carrier reaches savedRunContextFacts at agent-v1-turn.ts:2635');
    // The provider payload is captured before narration filtering: direct evidence of THIS selected Run's fact carrier.
    assert.equal(providerInput.includes('Olumi hasn’t sized'), !present, 'route must pass same-Run evaluation to its limit sentence');
    assert.equal(providerInput.includes('couldn’t be checked'), !present);
    console.log(`Explain route ${present ? 'evaluated' : 'declaration-only'} GREEN`);
  }
} finally { await app.close(); globalThis.fetch = nativeFetch; }
