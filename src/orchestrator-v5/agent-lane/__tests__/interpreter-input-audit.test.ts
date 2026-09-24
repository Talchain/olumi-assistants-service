/** Offline input-transport audit at FP3 7b49cb9b. Synthetic upstream responses;
 * real route/capability/request serialisation; all provider calls intercepted.
 * These tests describe transport, not model-answer quality or a release verdict.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const SCENARIO = '8b3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d6f';
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('six Interpreter cases: real FP3 input transport, no model evaluation', () => {
  let app: FastifyInstance;
  const captures: Record<string, any>[] = [];
  let modelBodies: Record<string, any>[] = [];
  let upstream: Record<string, any>;
  let graphHash = 'r7';
  let runs = 0;
  let sequence = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Offline transport stub. No answer quality is evaluated.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => { runs++; return upstream; });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Adoption rate' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: graphHash,
      analysis_result: upstream.blocks[0],
      analysis_state: upstream.analysis_state,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { writeFileSync('/private/tmp/olumi-fp3-captured-requests.json', JSON.stringify(captures, null, 2)); await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    modelBodies = []; runs = 0; graphHash = 'r7'; sequence++;
    upstream = {
      response_version: 2, assistant_text: 'Analysis completed.', suggested_actions: [], insights: [], graph_hash: 'r7',
      blocks: [{ type: 'analysis_result', summary: 'No material difference established.', leading_option_id: null, computed_against_hash: 'r7' }],
      analysis_ready: { status: 'ready', options: [], blockers: [] },
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    };
  });
  async function request(message: string, typedRun: boolean) {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, agent_session_id: `offline-${sequence}`, message,
      ...(typedRun ? { source: 'chip_click', chip: { action_type: 'run_analysis' } } : {}),
    } });
    expect(response.statusCode).toBe(200);
    return response.json();
  }
  function capturedRun() {
    expect(runs).toBe(1);
    expect(modelBodies).toHaveLength(1);
    expect(modelBodies[0].tool_choice).toBe('none');
    const profile = String(modelBodies[0].instructions).slice(-2929);
    expect(createHash('sha256').update(profile, 'utf8').digest('hex'))
      .toBe('3d979e8406693be42d3b340fd245d76a501c4b1c191d5ffaa1353f2f0380ba32');
    const input = modelBodies[0].input as Record<string, any>[];
    const call = input.find(x => x.type === 'function_call' && x.name === 'run_analysis');
    const output = input.find(x => x.type === 'function_call_output');
    expect(call).toBeDefined(); expect(output?.call_id).toBe(call?.call_id);
    expect(JSON.stringify(input)).not.toContain('case.expected');
    captures.push({ case_id: expect.getState().currentTestName?.match(/PJ\d+/)?.[0], request: modelBodies[0] });
    return JSON.parse(output!.output);
  }
  it('PJ01: partial summary and explicit canonical claim permission both reach interpretation', async () => {
    upstream.blocks[0].summary = 'The Churn <4% constraint was not evaluated; this is an incomplete assessment.';
    await request('Which approach should we pursue?', true);
    const sent = capturedRun();
    expect(sent.result.summary).toBe(upstream.blocks[0].summary);
    expect(sent.result.leading_option_id).toBeNull();
    expect(sent.canonical_state.analysis_state.leader_claim).toEqual(upstream.analysis_state.leader_claim);
    expect(JSON.stringify(modelBodies[0].input)).toContain('constraint_verdict_withheld');
  });
  it('PJ02: metric shares and their scope survive alongside canonical permissions', async () => {
    upstream.blocks[0].summary = 'MRR-only comparison in an illustrative model; the churn constraint is unassessed.';
    upstream.blocks[0].win_probabilities = { A: 0.81, B: 0.17, C: 0.02 };
    await request('What does the analysis tell us?', true);
    const sent = capturedRun();
    expect(sent.result).toEqual(upstream.blocks[0]);
    expect(sent.canonical_state.analysis_state.leader_claim.permitted).toBe(false);
  });
  it('PJ03: canonical stale status is supplied before interpretation of the historical analysed revision', async () => {
    graphHash = 'r8'; upstream.graph_hash = 'r8';
    upstream.analysis_state.run_state = { kind: 'complete_stale', cause: 'graph_changed' };
    const response = await request('What did my edit change?', true);
    const sent = capturedRun();
    expect(sent.result.computed_against_hash).toBe('r7');
    expect(sent.canonical_state.analysis_state.run_state).toEqual({ kind: 'complete_stale', cause: 'graph_changed' });
    expect(sent.graph_hash).toBeUndefined();
    expect(JSON.stringify(modelBodies[0].input)).not.toContain('r8');
    expect(response.graph_hash).toBe('r8');
  });
  it('PJ04: supplied sensitivity evidence survives without manufacturing a value-of-information number', async () => {
    upstream.blocks[0].enrichment = { factor_sensitivity: [{ factor_id: 'f', factor_label: 'Adoption rate', influence_rank: 1, confidence: 0.2 }] };
    await request('What would be useful to examine next? Adoption is my uncertain estimate.', true);
    const sent = capturedRun();
    expect(sent.result.enrichment).toEqual(upstream.blocks[0].enrichment);
    expect(sent.result.enrichment.factor_sensitivity[0]).not.toHaveProperty('value_of_information');
    expect(JSON.stringify(modelBodies[0].input)).toContain('my uncertain estimate');
  });
  it('PJ05: a prior refusal of an exercise is retained in the actual FP3 conversation input', async () => {
    await request('Just explain the result; I do not want an exercise.', false);
    modelBodies = []; runs = 0;
    await request('Run the analysis', true);
    capturedRun();
    expect(JSON.stringify(modelBodies[0].input)).toContain('I do not want an exercise');
    expect(JSON.stringify(modelBodies[0].input)).not.toContain('declined":true');
  });
  it('PJ06: qualitative exploration stays on normal conversation; it is not an FP3 Interpreter case', async () => {
    const response = await request('We are exploring why regional teams disagree about centralising customer support. What should we examine?', false);
    expect(runs).toBe(0); expect(modelBodies).toHaveLength(1);
    expect(modelBodies[0].tool_choice).not.toBe('none');
    expect(response._diagnostic_trace.fast_path).toBeUndefined();
    expect(JSON.stringify(modelBodies[0].input)).toContain('regional teams disagree');
  });
  it('PJ07: generic withheld reason does not supply a fictional constraint or failed threshold', async () => {
    upstream.blocks[0].summary = 'Analysis completed; an overall leader claim is not permitted.';
    await request('What can we conclude?', true);
    const sent = capturedRun();
    expect(sent.canonical_state.analysis_state.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
    expect(sent.result).not.toHaveProperty('constraints');
  });
  it('PJ08: an explicitly permitted model leader survives without becoming an overall recommendation', async () => {
    upstream.analysis_state.leader_claim = { permitted: true };
    upstream.blocks[0].leading_option_id = 'A';
    upstream.blocks[0].summary = 'A has the highest expected MRR among A and B under the supplied model; this is not a real-world success probability.';
    await request('What does the model tell us?', true);
    const sent = capturedRun();
    expect(sent.canonical_state.analysis_state.leader_claim.permitted).toBe(true);
    expect(sent.result.leading_option_id).toBe('A');
  });

});
