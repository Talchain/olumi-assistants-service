import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { explainRun, explanationContext } from './fixtures/run-explanation-follow-up.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';

// Owner's served withheld block; graph transport and delta below are synthetic route fixtures.
const served = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8'));
const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Revenue' },
  { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' },
  { id: 'carry_on_as_now', kind: 'option', label: 'Carry On As Now' },
  { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] };
const delta = { leader: { current_leading_option_id: 'ai_reporting_sprint', prior_leading_option_id: 'carry_on_as_now' } };
const ready = { status: 'ready', options: [], blockers: [],
  analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const store = vi.hoisted(() => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null), append: vi.fn(async () => ({ id: 'synthetic-answer-row' })),
}));
const retainedRuns = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../history-store.js', async (original) => {
  const real = await original<typeof import('../history-store.js')>();
  return { ...real, pruneSupersededToolOutputs: (...args: Parameters<typeof real.pruneSupersededToolOutputs>) => {
    const output = (args[0] as Record<string, unknown>[]).find((item) => item.type === 'function_call_output');
    if (output !== undefined) retainedRuns.push(JSON.parse(String(output.output)));
    return real.pruneSupersededToolOutputs(...args);
  } };
});
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('result-first paths consume the owner-approved Run projection', () => {
  let app: FastifyInstance;
  let permitted = false;
  let reads = 0;
  let runs = 0;
  let sent: Record<string, unknown>[] = [];
  const state = () => permitted
    ? { ...served.analysis_state, leader_claim: { permitted: true } } : served.analysis_state;

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [
        { type: 'output_text', text: 'The result depends on the assumptions in your model.' },
      ] }] }), { status: 200 });
    }));
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      runs += 1;
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
        graph_hash: 'synthetic-raw-cas', blocks: [served.block], analysis_state: state(), analysis_ready: ready };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      reads += 1;
      return { graph, graph_hash: 'synthetic-raw-cas', analysis_state: state(), analysis_ready: ready,
        analysis_result: served.block, current_read: { run_delta: delta } };
    });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(() => { permitted = false; reads = 0; runs = 0; sent = []; retainedRuns.length = 0; });

  const run = (scenarioId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    scenario_id: scenarioId, message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
  } });
  const historyOutput = (body: Record<string, unknown>) => {
    const outputs = (body.input as Record<string, unknown>[]).filter((i) => i.type === 'function_call_output');
    expect(outputs, 'the next ordinary call actually consumed the preceding Run').toHaveLength(1);
    return JSON.parse(String(outputs[0].output));
  };
  const expectNoProducerLeaderProse = (block: Record<string, unknown>) => {
    expect(JSON.stringify(block)).not.toContain("the leading option's draws");
    expect(JSON.stringify(block)).not.toContain('of draws outside the level domain');
    const warnings = (block.enrichment as { decision_brief: { warnings: Record<string, unknown>[] } }).decision_brief.warnings;
    expect(warnings[0].code).toBe('CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
    expect(warnings[0]).not.toHaveProperty('message');
  };

  it('withheld Run history is projected before the next tool-enabled conversation consumes it', async () => {
    const id = randomUUID(); const first = await run(id);
    expect(first.statusCode, first.body).toBe(200); expect(sent).toHaveLength(0);
    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: id, agent_session_id: first.json()._agent.session_id, message: 'What should I examine next?',
    } });
    expect(next.statusCode, next.body).toBe(200); expect(runs).toBe(1); expect(sent).toHaveLength(1);
    expectNoProducerLeaderProse(retainedRuns[0].result as Record<string, unknown>);
    // Existing history pruning retains a neutral Run marker, not a competing analysis snapshot.
    expect(historyOutput(sent[0])).toEqual({ note: expect.stringContaining('see the current Run in CURRENT MODEL STATE') });
  });

  it('withheld explanation strips producer prose and nested delta leader designations, with only cached plus final fresh reads', async () => {
    const id = randomUUID(); const first = await run(id); const before = reads;
    const second = await explainRun(app, id, first);
    expect(second.statusCode, second.body).toBe(200); expect(sent).toHaveLength(1); expect(runs).toBe(1);
    const context = explanationContext(sent[0].input) as { result: Record<string, unknown>;
      claim_permissions: { leader_may_be_named: boolean }; canonical_state: { run_delta: typeof delta } };
    expect(context.claim_permissions.leader_may_be_named).toBe(false);
    expectNoProducerLeaderProse(context.result);
    expect(context.canonical_state.run_delta.leader).toEqual({ current_leading_option_id: null, prior_leading_option_id: null });
    // Initial prefetch supplies both result and delta; only the post-call currentness recheck is fresh.
    expect(reads - before).toBe(2);
  });

  it('permitted history keeps the existing producer result byte-for-byte', async () => {
    permitted = true; const id = randomUUID(); const first = await run(id);
    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: id, agent_session_id: first.json()._agent.session_id, message: 'Explain the assumptions.',
    } });
    expect(next.statusCode, next.body).toBe(200); expect(sent).toHaveLength(1);
    expect(JSON.stringify(retainedRuns[0].result)).toBe(JSON.stringify(analysisResultForAgent(served.block)));
    expect(historyOutput(sent[0])).toEqual({ note: expect.stringContaining('see the current Run in CURRENT MODEL STATE') });
  });

  it('permitted explanation preserves its existing result and supplied delta', async () => {
    permitted = true; const id = randomUUID(); const first = await run(id);
    const second = await explainRun(app, id, first);
    expect(second.statusCode, second.body).toBe(200); expect(sent).toHaveLength(1);
    const context = explanationContext(sent[0].input) as { result: unknown; claim_permissions: { leader_may_be_named: boolean };
      canonical_state: { run_delta: unknown } };
    expect(context.claim_permissions.leader_may_be_named).toBe(true);
    expect(JSON.stringify(context.result)).toBe(JSON.stringify(analysisResultForAgent(served.block)));
    expect(context.canonical_state.run_delta).toEqual(delta);
  });
});
