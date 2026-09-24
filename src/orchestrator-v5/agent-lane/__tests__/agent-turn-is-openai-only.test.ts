/**
 * ⛔ Every Agent turn runs under the OpenAI-only provider policy — and the policy
 * reaches the CONVENTIONAL handlers the Agent dispatches to internally.
 *
 * Measured on served c4a6cce: the Agent's run_analysis reached the legacy
 * decision_review (Claude) through `/orchestrate/v2/turn`. The guard only works if the
 * request-scoped policy survives that internal `app.inject()` hop, so this records
 * the policy AS SEEN INSIDE the internal handler, through the real route.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { currentProviderPolicy } from '../../../adapters/llm/provider-policy.js';

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('the Agent route is OpenAI-only, all the way down', () => {
  let app: FastifyInstance;
  const seenInsideOrchestrate: (string | null)[] = [];
  let call = 0;
  // When set, the internal handler attempts an Anthropic call, as the legacy
  // decision_review did on served c4a6cce.
  let internalTriesAnthropic = false;
  // Per-hop usage, so a test can prove attribution is BY HANDLE rather than to the
  // last call. Empty means the provider sent none, which is the default here and must
  // leave `usage` off the entry entirely rather than record a zero.
  let usagePerCall: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      const output = call === 1
        ? [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'Here is the comparison.' }] }];
      const usage = usagePerCall[call - 1];
      return new Response(JSON.stringify({ output, ...(usage !== undefined ? { usage } : {}) }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const policyMod = await import('../../../adapters/llm/provider-policy.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      // What a conventional handler (e.g. decision_review) would see.
      seenInsideOrchestrate.push(policyMod.currentProviderPolicy()?.route ?? null);
      if (internalTriesAnthropic) {
        try { policyMod.assertProviderAllowed('anthropic', 'decision_review', { model: 'claude-sonnet-5', purpose: 'decision_review' }); } catch { /* degraded, as the enricher does */ }
      }
      return { response_version: 2, assistant_text: 'ok', blocks: [], suggested_actions: [], insights: [], graph_hash: 'h1' };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the Agent’s run_analysis dispatch reaches the conventional handler UNDER the OpenAI-only policy', async () => {
    seenInsideOrchestrate.length = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
    expect(r.statusCode).toBe(200);
    expect(seenInsideOrchestrate).toEqual(['agent_v1_turn']);
  });

  it('RED: a forwarded canvas edit is under the same policy', async () => {
    seenInsideOrchestrate.length = 0;
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: '11111111-1111-4111-8111-111111111111', stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'f', value: 0.5, field: 'value' } } });
    expect(seenInsideOrchestrate).toEqual(['agent_v1_turn']);
  });

  it('RED: the response carries the turn\u2019s provider ledger — the Agent\u2019s own OpenAI calls, attributed', async () => {
    call = 0;
    internalTriesAnthropic = false;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
    const calls = r.json()._provider_calls as { site: string; provider: string; model: string; purpose: string; outcome: string; duration_ms?: number; usage?: unknown }[];
    /**
     * ⚠ THE PURITY FIELDS ARE DEEP-EQUALLED ON A PROJECTION, NOT ON THE WHOLE ENTRY.
     *
     * This asserted the whole object, so wiring `recordProviderUsage` on the transport
     * turned it RED for the right reason and the wrong cause: `duration_ms` is an
     * INTENDED field (#1805) and a key count is not what this test is about. Deleting
     * the deep-equal would have weakened the purity claim, so the five purity fields are
     * still compared exactly, by identity, and the new fields are asserted separately
     * below rather than tolerated by a loosened matcher.
     */
    const PURITY = ['site', 'provider', 'model', 'purpose', 'outcome'] as const;
    const project = (c: Record<string, unknown>) => Object.fromEntries(PURITY.map((k) => [k, c[k]]));
    // Two model hops: the run_analysis function call, then the answer.
    expect(calls.map((c) => project(c as unknown as Record<string, unknown>))).toEqual([
      { site: 'agent-v1-turn.callModel', provider: 'openai', model: expect.stringMatching(/^gpt-/), purpose: 'conversation', outcome: 'allowed' },
      { site: 'agent-v1-turn.callModel', provider: 'openai', model: expect.stringMatching(/^gpt-/), purpose: 'conversation', outcome: 'allowed' },
    ]);
    // No key beyond the purity five and the two measurement fields may appear, or this
    // projection would hide a field nobody reviewed.
    for (const c of calls) {
      expect(Object.keys(c).sort()).toEqual([...PURITY].concat('duration_ms').sort());
    }
  });

  /**
   * ⭐ CACHING IS NOW MEASURABLE ON A REAL TURN, which is the point of keeping the
   * handle. `normaliseProviderUsage` reads `input_tokens_details.cached_tokens` — the
   * Responses API's own cache field — so a turn reports what the provider actually
   * cached instead of what the source structurally permits.
   *
   * ⚠ THIS TEST DOES **NOT** DISCRIMINATE THE BY-HANDLE ATTRIBUTION, and saying so is
   * the honest option. MEASURED: mutating `provider-policy.ts` to attribute to the
   * newest row instead of the handle leaves this test GREEN, because the route's two
   * hops are SEQUENTIAL — during hop 1 the newest row IS hop 1's. The mutant is killed
   * by three tests in `adapters/llm/__tests__` ("attaches by handle, and a second
   * in-flight call is left untouched", "an out-of-range handle is ignored", "duration
   * attaches to the handle given, not the newest row"), which construct the concurrent
   * case this route cannot produce.
   *
   * What this test DOES prove is that the wiring reaches the ledger at all and that
   * each hop's own numbers arrive — which is what was missing, since
   * `recordProviderUsage` had zero callers before this change.
   */
  it('RED: each conversation call carries its OWN usage, including the prefix cache hit', async () => {
    call = 0;
    internalTriesAnthropic = false;
    usagePerCall = [
      { input_tokens: 2000, output_tokens: 40, input_tokens_details: { cached_tokens: 1800 } },
      { input_tokens: 2100, output_tokens: 90, input_tokens_details: { cached_tokens: 1900 } },
    ];
    try {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
      const calls = r.json()._provider_calls as { usage?: { input_tokens?: number; cached_input_tokens?: number } }[];
      expect(calls.length).toBe(2);
      expect(calls[0]?.usage?.input_tokens).toBe(2000);
      expect(calls[0]?.usage?.cached_input_tokens, 'the first hop\u2019s own cache hit').toBe(1800);
      expect(calls[1]?.usage?.input_tokens).toBe(2100);
      expect(calls[1]?.usage?.cached_input_tokens, 'the second hop\u2019s own cache hit').toBe(1900);
    } finally {
      usagePerCall = [];
    }
  });

  it('RED: an Anthropic attempt BENEATH internal dispatch is on the ledger as refused_before_network', async () => {
    call = 0;
    internalTriesAnthropic = true;
    try {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
      const calls = r.json()._provider_calls as { site: string; provider: string; outcome: string }[];
      expect(calls.filter((c) => c.provider === 'anthropic')).toEqual([
        { site: 'decision_review', provider: 'anthropic', model: 'claude-sonnet-5', purpose: 'decision_review', outcome: 'refused_before_network' },
      ]);
    } finally {
      internalTriesAnthropic = false;
    }
  });

  it('a forwarded canvas edit makes no generative call, and says so', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: '22222222-2222-4222-8222-222222222222', stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'f', value: 0.5, field: 'value' } } });
    expect(r.json()._provider_calls).toEqual([]);
  });

  it('CONTRAST: a request that does not come through the Agent route has no policy', () => {
    expect(currentProviderPolicy()).toBeUndefined();
  });
});
