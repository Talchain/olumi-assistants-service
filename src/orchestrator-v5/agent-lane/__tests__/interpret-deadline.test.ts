/**
 * AI HARNESS 2a — the Run's interpreting call has a deadline, and a deadline is never retried. The Run already stands
 * when the call is made: a slow explanation gets the honest fallback instead of holding the turn open (Paul 1 Oct:
 * 55–90 s Run turns, ~5 s of it the analysis).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { onceMoreOnTransportFailure } from '../runtime/transport-retry.js';
import { explainRun } from './fixtures/run-explanation-follow-up.js';

const store = vi.hoisted(() => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'synthetic-answer-row' })),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] };
// A current Run with its identity, so the result-first follow-up (#2455) is offered for it.
const STATE = { run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' }, leader_claim: { permitted: true } };
const BLOCK = { type: 'analysis_result', computed_against_hash: '0123456789abcdef', data: { marker: 'synthetic' } };

describe('the Run interpreting call has a deadline', () => {
  let app: FastifyInstance;
  let interpretCalls = 0;

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    // The provider never answers: only the request's own signal can end the call.
    vi.stubGlobal('fetch', vi.fn((url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
      if (String(url) !== 'https://api.openai.com/v1/responses') throw new Error(`Unexpected fetch ${String(url)}`);
      interpretCalls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }));
    vi.resetModules();
    const budgets = await import('../model-budgets.js');
    budgets.INTERPRET_DEADLINE.ms = 300;
    const route = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'Done.', suggested_actions: [], insights: [], graph_hash: 'h1', analysis_state: STATE,
      blocks: [BLOCK], analysis_ready: { status: 'ready', options: [], blockers: [] },
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: 'h1', analysis_state: STATE, analysis_result: BLOCK }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('RED: a provider that never answers gets the honest fallback at the deadline — one call, no retry, the Run stands', async () => {
    const scenarioId = randomUUID();
    const first = await app.inject({
      method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: scenarioId, message: 'Run the analysis please', source: 'chip_click', chip: { action_type: 'run_analysis' } },
    });
    // Result first (#2455): the Run stands with no model call; the interpreting call is the follow-up's.
    expect(interpretCalls, 'request 1 makes no model call').toBe(0);
    expect((first.json() as { _agent?: { tool_calls?: { name: string }[] } })._agent?.tool_calls?.map((c) => c.name)).toEqual(['run_analysis']);
    const started = Date.now();
    const res = await explainRun(app, scenarioId, first);
    const ms = Date.now() - started;
    expect(res.statusCode, res.body).toBe(200);
    expect(interpretCalls, 'the deadline is not retried').toBe(1);
    expect(ms).toBeLessThan(10_000);
    const body = res.json() as { assistant_text?: string; narration?: { status?: string }; _agent?: { tool_calls?: unknown[] } };
    expect(body.assistant_text).toMatch(/couldn.t explain it/i);
    expect(body.narration?.status).toBe('unavailable');
    expect(body._agent?.tool_calls).toEqual([]);
  }, 30_000);
});

describe('onceMoreOnTransportFailure never repeats a deadline', () => {
  it('RED: an abort (TimeoutError) is thrown at once, not retried', async () => {
    let calls = 0;
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    await expect(onceMoreOnTransportFailure('t', async () => { calls += 1; throw timeout; })).rejects.toBe(timeout);
    expect(calls).toBe(1);
  });
  it('CONTROL: a transport failure (fetch failed) is still retried once', async () => {
    let calls = 0;
    const out = await onceMoreOnTransportFailure('t', async () => { calls += 1; if (calls === 1) throw new TypeError('fetch failed'); return 'ok'; });
    expect(out).toBe('ok');
    expect(calls).toBe(2);
  });
});
