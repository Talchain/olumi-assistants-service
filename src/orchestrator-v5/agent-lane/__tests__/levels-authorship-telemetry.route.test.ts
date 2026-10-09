/** Per-level telemetry at the real route; scripted provider, real level handler, no external transport. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAgentTurn } from '../runtime/agent-loop.js';
import type { AgentCapabilities, ToolResult } from '../runtime/agent-tools.js';
import { asSent } from './helpers/as-sent.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/empty-gaps-served-2919.json', import.meta.url), 'utf8'));
const graph = fixture.served;
const rows = new Map<string, Record<string, unknown>>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  readRecent: vi.fn(async () => []), readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null), readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: Record<string, unknown>) => {
    const id = String(w.turn_id);
    rows.set(id, { id, turn_id: w.turn_id, request_hash: w.request_hash,
      assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null,
      pending_actions: w.pending_actions ?? [], llm_calls_used: w.llm_calls_used ?? 0 });
    return { id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
let nextTool = 'propose_option_interventions';
let nextArgs: unknown;
let providerHop = 0;
let requests: Record<string, unknown>[] = [];
const mixedLevels = [
  { option_label: 'Trial', factor_label: 'Duration', value: 0.3, unit: 'days', user_stated: true, basis: 'The user gave their own figure.' },
  { option_label: 'Full', factor_label: 'Duration', value: 20, unit: 'days', user_stated: false, basis: 'Olumi estimate requested by the user.' },
];

describe('per-level authorship telemetry on /agent/v1/turn', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubEnv('OPENAI_API_KEY', 'fake-provider-no-transport');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      requests.push(JSON.parse(String(init?.body)));
      providerHop += 1;
      return new Response(JSON.stringify({ status: 'completed', output: providerHop === 1
        ? [{ type: 'function_call', name: nextTool, call_id: 'telemetry', arguments: JSON.stringify(nextArgs) }]
        : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Please review the proposed change.' }] }],
      }), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => graph);
    await app.register(agentV1TurnRoute); await app.ready();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  async function turn(tool: string, args: unknown) {
    nextTool = tool; nextArgs = args; providerHop = 0; requests = [];
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: graph.scenario_id, agent_session_id: randomUUID(), turn_id: randomUUID(), message: fixture.message,
    } });
    expect(response.statusCode).toBe(200);
    return response.json();
  }
  it('T1: binds Trial to the user and Full to Olumi; telemetry contains only labels and authorship', async () => {
    const body = await turn('propose_option_interventions', { interventions: mixedLevels, whole_request: false });
    expect(body._agent.tool_calls).toEqual([{ name: 'propose_option_interventions', ok: true, mutated: false,
      proposal_id: expect.any(String), levels: [
        { option: 'Full', factor: 'Duration', stated_by: 'olumi_estimate' },
        { option: 'Trial', factor: 'Duration', stated_by: 'user' },
      ] }]);
    expect(Object.fromEntries(body._agent.tool_calls[0].levels.map((l: { option: string; stated_by: string }) => [l.option, l.stated_by])))
      .toEqual({ Full: 'olumi_estimate', Trial: 'user' });
    expect(providerHop).toBe(2);
    const second = asSent(requests[1]!);
    const output = (second.input as { type?: string; output?: string }[]).find(i => i.type === 'function_call_output')!;
    const result = JSON.parse(output.output!);
    expect(result.interventions.map((l: { option: string; stated_by: string }) => [l.option, l.stated_by]))
      .toEqual([['Full', 'olumi_estimate'], ['Trial', 'user']]);
  });
  it('T2: a non-propose tool has no levels key', async () => {
    const body = await turn('get_canonical_state', {});
    expect(body._agent.tool_calls).toEqual([{ name: 'get_canonical_state', ok: true, mutated: false }]);
    expect(body._agent.tool_calls[0]).not.toHaveProperty('levels');
  });
  it('T3: a real refused proposal has no levels key', async () => {
    const body = await turn('propose_option_interventions', { interventions: [] });
    expect(body._agent.tool_calls).toEqual([{ name: 'propose_option_interventions', ok: false, mutated: false, refusal: 'empty_proposal' }]);
    expect(body._agent.tool_calls[0]).not.toHaveProperty('levels');
  });
});

describe('equivalent proposal result shapes and omission controls', () => {
  const row = { option: 'Trial', factor: 'Duration', stated_by: 'user', value: 0.3, unit: 'days', basis: 'private context' };
  it.each([
    ['propose_starting_point', 'proposeStartingPoint', { option_levels: [row] }],
    ['propose_new_option', 'proposeNewOption', { option: { label: 'Trial' }, levels: [{ factor: 'Duration', stated_by: 'user', value: 0.3 }] }],
    ['propose_new_option', 'proposeNewOption', { options: [{ label: 'Trial', levels: [{ factor: 'Duration', stated_by: 'user', value: 0.3 }] }] }],
    ['propose_option_interventions', 'proposeOptionInterventions', { interventions: [row] }],
  ] as const)('%s projects only option, factor and authorship (%j)', async (tool, capability, fields) => {
    let hop = 0;
    const result: ToolResult = { ok: true, mutated: false, proposal_id: 'p', ...fields };
    const r = await runAgentTurn({ ctx: { scenario_id: 's', authenticated_user_id: null, request_id: 'r' }, history: [],
      message: 'm', instructions: 'i', maxOutputTokens: 100 }, { [capability]: async () => result } as unknown as AgentCapabilities,
    async () => ({ output: ++hop === 1 ? [{ type: 'function_call', name: tool, call_id: 'c', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Review it.' }] }] }));
    expect(r.tool_calls).toEqual([{ name: tool, ok: true, mutated: false, proposal_id: 'p',
      levels: [{ option: 'Trial', factor: 'Duration', stated_by: 'user' }] }]);
    expect(r.tool_results[0]).toBe(result);
  });
  it.each([
    ['get_canonical_state', 'getCanonicalState', { ok: true, mutated: false, interventions: [row] }],
    ['propose_option_interventions', 'proposeOptionInterventions', { ok: false, mutated: false, refusal: 'not_found', interventions: [row] }],
    ['propose_option_interventions', 'proposeOptionInterventions', { ok: true, mutated: false, interventions: [{ ...row, stated_by: 'untyped' }, { stated_by: 'user' }, null] }],
  ])('%s omits levels without successful typed option-level authorship', async (tool, capability, result) => {
    let hop = 0;
    const r = await runAgentTurn({ ctx: { scenario_id: 's', authenticated_user_id: null, request_id: 'r' }, history: [], message: 'm', instructions: 'i', maxOutputTokens: 100 },
      { [String(capability)]: async () => result } as unknown as AgentCapabilities, async () => ({ output: ++hop === 1
        ? [{ type: 'function_call', name: tool, call_id: 'c', arguments: '{}' }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] }));
    expect(r.tool_calls[0]).not.toHaveProperty('levels');
  });
});
