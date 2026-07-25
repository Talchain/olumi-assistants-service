/**
 * Draft token-ceiling experiment — tests for the diagnostic instrument.
 *
 * The load-bearing property is ONE thing: the requested `window_ms` must reach
 * the draft call as its `timeoutMs`, because that is the ONLY lever that raises
 * the token ceiling (`resolveDraftMaxTokens(timeoutMs)` in the adapter derives
 * max_tokens from it). If the thread is dropped or the window is silently
 * replaced by the default, every run measures the 8,550-token cap the
 * experiment exists to lift — and would report a null result that looks real.
 *
 * The expected ceiling is DERIVED here by calling the same
 * `getAffordableDraftTokens` the route and the adapter call. A literal would be
 * a hand-maintained mirror of the derivation (trap 12) and would keep passing
 * if the derivation changed underneath it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const TEST_KEY = 'test-admin-key-ceiling';

vi.mock('../../config/index.js', () => ({
  config: {
    prompts: { adminApiKey: TEST_KEY, adminApiKeyRead: undefined, adminAllowedIPs: '' },
    server: {},
  },
}));

vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  hashIP: () => 'hashed-ip',
  TelemetryEvents: {},
}));

vi.mock('../../utils/hash.js', () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

/** Captured opts of the last draftGraph call — the lever assertion reads this. */
let lastDraftOpts: Record<string, unknown> | null = null;
/** What the fake adapter should do on the next call. */
let nextDraftBehaviour: () => Promise<unknown> = async () => ({ graph: { nodes: [], edges: [] } });

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'anthropic',
      model: 'claude-test-model',
      draftGraph: async (_args: unknown, opts: Record<string, unknown>) => {
        lastDraftOpts = opts;
        return nextDraftBehaviour();
      },
    },
    resolution: {},
  }),
}));

const { adminTestRoutes } = await import('../admin.testing.js');
const { getAffordableDraftTokens, DRAFT_LLM_TIMEOUT_MS } = await import('../../config/timeouts.js');

const START = '/admin/v1/draft-ceiling';
const STATUS = '/admin/v1/draft-ceiling/status';
const BRIEF =
  'SaaS customer support is getting overwhelmed. Should we hire two more support engineers or build a self-serve help centre?';

let app: FastifyInstance;

beforeEach(async () => {
  lastDraftOpts = null;
  nextDraftBehaviour = async () => ({ graph: { nodes: [], edges: [] } });
  app = Fastify({ logger: false });
  await app.register(adminTestRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function start(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: START,
    headers: { 'x-admin-key': TEST_KEY, 'content-type': 'application/json' },
    payload: body,
  });
}

async function awaitRun(runId: string, includeGraph = false): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({
      method: 'POST',
      url: STATUS,
      headers: { 'x-admin-key': TEST_KEY, 'content-type': 'application/json' },
      payload: { run_id: runId, include_graph: includeGraph },
    });
    const body = res.json() as Record<string, unknown>;
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('run never left "running"');
}

describe('draft token-ceiling experiment — auth', () => {
  it('refuses the start route without the admin key', async () => {
    const res = await app.inject({ method: 'POST', url: START, payload: { brief: BRIEF } });
    expect(res.statusCode).toBe(401);
  });

  it('refuses the status route without the admin key', async () => {
    const res = await app.inject({ method: 'POST', url: STATUS, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty brief', async () => {
    const res = await start({ brief: '   ', window_ms: 148_334 });
    expect(res.statusCode).toBe(400);
  });
});

describe('draft token-ceiling experiment — THE LEVER', () => {
  it('threads window_ms into the draft call timeoutMs (the only thing that raises the cap)', async () => {
    const windowMs = 192_778;
    const res = await start({ brief: BRIEF, window_ms: windowMs, label: 'w16k' });
    expect(res.statusCode).toBe(202);
    await awaitRun((res.json() as { run_id: string }).run_id);

    expect(lastDraftOpts).not.toBeNull();
    expect(lastDraftOpts!.timeoutMs).toBe(windowMs);
    // The window must NOT have been silently replaced by the product default —
    // that is the exact failure mode that would make the whole run vacuous.
    expect(lastDraftOpts!.timeoutMs).not.toBe(DRAFT_LLM_TIMEOUT_MS);
  });

  it('passes NO maxTokensCeiling, so the raised affordability is not re-clamped down', async () => {
    const res = await start({ brief: BRIEF, window_ms: 148_334 });
    await awaitRun((res.json() as { run_id: string }).run_id);
    expect(lastDraftOpts!.maxTokensCeiling).toBeUndefined();
  });

  it('reports a derived ceiling that actually RISES with the window, and matches the derivation', async () => {
    const w12 = 148_334;
    const w16 = 192_778;
    const r12 = (await start({ brief: BRIEF, window_ms: w12 })).json() as Record<string, unknown>;
    const r16 = (await start({ brief: BRIEF, window_ms: w16 })).json() as Record<string, unknown>;

    expect(r12.derived_max_tokens).toBe(getAffordableDraftTokens(w12));
    expect(r16.derived_max_tokens).toBe(getAffordableDraftTokens(w16));
    expect(r16.derived_max_tokens as number).toBeGreaterThan(r12.derived_max_tokens as number);
    // …and both must exceed the ceiling the default window affords, or the
    // experiment is not an experiment.
    expect(r12.derived_max_tokens as number).toBeGreaterThan(
      getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS),
    );
  });

  it('clamps an absurd window rather than sending it to the provider', async () => {
    const r = (await start({ brief: BRIEF, window_ms: 5_000_000 })).json() as Record<string, unknown>;
    expect(r.window_ms).toBe(300_000);
    expect(r.derived_max_tokens).toBe(getAffordableDraftTokens(300_000));
  });
});

describe('draft token-ceiling experiment — what the ledger must record', () => {
  it('records the termination signal, the applied cap and the token count from a SUCCESS', async () => {
    nextDraftBehaviour = async () => ({
      graph: {
        nodes: [
          { id: 'goal_1', type: 'goal', label: 'Cut first-response time' },
          { id: 'opt_1', type: 'option', label: 'Hire two engineers' },
          { id: 'f_1', type: 'factor', label: 'Cost per ticket' },
        ],
        edges: [{ id: 'e1', from: 'f_1', to: 'goal_1' }],
        options: [{ id: 'opt_1' }],
      },
      coaching: { summary: 'ok' },
      meta: {
        model: 'claude-test-model',
        max_tokens: 16_000,
        finish_reason: 'end_turn',
        runaway_abort_count: 0,
        time_to_edges_ms: 4321,
        provider_latency_ms: 55_000,
        salvaged_from_truncation: false,
        token_usage: { prompt_tokens: 900, completion_tokens: 2_010, total_tokens: 2_910 },
      },
    });

    const res = await start({ brief: BRIEF, window_ms: 192_778, label: 'w16k' });
    const run = await awaitRun((res.json() as { run_id: string }).run_id, true);

    expect(run.status).toBe('done');
    expect(run.stop_reason).toBe('end_turn');
    expect(run.max_tokens_applied).toBe(16_000);
    expect(run.completion_tokens).toBe(2_010);
    expect(run.runaway_abort_count).toBe(0);
    expect(run.salvaged_from_truncation).toBe(false);
    expect(run.coaching_present).toBe(true);
    expect(run.graph).toMatchObject({ nodes: 3, edges: 1, options: 1, goal_node_ids: ['goal_1'] });
    expect(run.graph_json).toBeTruthy();
  });

  it('classifies nodes by `kind` — the key graphs actually use — not only `type`', async () => {
    // The wire shape is {id, kind, label, provenance}. Reading only `type`
    // classified EVERY node as "unknown" and reported ZERO goal nodes on a graph
    // that had one — the extractor-trap class that mis-scored two prior lanes.
    nextDraftBehaviour = async () => ({
      graph: {
        nodes: [
          { id: 'goal_support', kind: 'goal', label: 'Sustainable support quality' },
          { id: 'opt_hire', kind: 'option', label: 'Hire two engineers' },
          { id: 'opt_helpcentre', kind: 'option', label: 'Build a help centre' },
          { id: 'fac_volume', kind: 'factor', label: 'Ticket volume' },
        ],
        edges: [{ from: 'fac_volume', to: 'goal_support' }],
      },
      meta: { finish_reason: 'end_turn', token_usage: { completion_tokens: 2000, prompt_tokens: 170, total_tokens: 2170 } },
    });
    const res = await start({ brief: BRIEF, window_ms: 148_334 });
    const run = await awaitRun((res.json() as { run_id: string }).run_id, true);
    const graph = run.graph as { node_types: Record<string, number>; goal_node_ids: string[] };

    expect(graph.goal_node_ids).toEqual(['goal_support']);
    expect(graph.node_types).toMatchObject({ goal: 1, option: 2, factor: 1 });
    expect(graph.node_types.unknown).toBeUndefined();
  });

  it('does NOT let a SALVAGED truncation read as a terminated generation', async () => {
    nextDraftBehaviour = async () => ({
      graph: { nodes: [{ id: 'n1', type: 'factor' }], edges: [] },
      meta: {
        finish_reason: 'max_tokens',
        max_tokens: 12_000,
        salvaged_from_truncation: true,
        token_usage: { prompt_tokens: 900, completion_tokens: 12_000, total_tokens: 12_900 },
      },
    });
    const res = await start({ brief: BRIEF, window_ms: 148_334 });
    const run = await awaitRun((res.json() as { run_id: string }).run_id);

    expect(run.status).toBe('done');
    expect(run.stop_reason).toBe('max_tokens');
    expect(run.salvaged_from_truncation).toBe(true);
  });

  it('recovers cap / stop_reason / tokens from _llm_meta on a FAILED draft', async () => {
    nextDraftBehaviour = async () => {
      throw Object.assign(new Error('anthropic draft_graph truncated'), {
        name: 'DraftTruncatedError',
        _llm_meta: {
          finish_reason: 'max_tokens',
          max_tokens: 12_000,
          runaway_abort_count: 0,
          provider_latency_ms: 130_000,
          token_usage: { prompt_tokens: 900, completion_tokens: 12_000, total_tokens: 12_900 },
        },
      });
    };
    const res = await start({ brief: BRIEF, window_ms: 148_334 });
    const run = await awaitRun((res.json() as { run_id: string }).run_id);

    expect(run.status).toBe('error');
    expect(run.stop_reason).toBe('max_tokens');
    expect(run.max_tokens_applied).toBe(12_000);
    expect(run.completion_tokens).toBe(12_000);
    expect(run.runaway_abort_count).toBe(0);
    expect(run.error_name).toBe('DraftTruncatedError');
  });

  it('keeps the poll small: the list view omits the full graph', async () => {
    nextDraftBehaviour = async () => ({
      graph: { nodes: [{ id: 'n1', type: 'factor' }], edges: [] },
      meta: { finish_reason: 'end_turn', token_usage: { completion_tokens: 10, prompt_tokens: 1, total_tokens: 11 } },
    });
    const res = await start({ brief: BRIEF, window_ms: 148_334 });
    await awaitRun((res.json() as { run_id: string }).run_id);
    const list = await app.inject({
      method: 'POST',
      url: STATUS,
      headers: { 'x-admin-key': TEST_KEY, 'content-type': 'application/json' },
      payload: {},
    });
    const body = list.json() as { runs: Array<Record<string, unknown>> };
    expect(body.runs.length).toBeGreaterThan(0);
    for (const r of body.runs) expect(r).not.toHaveProperty('graph_json');
  });

  it('404s an unknown run id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: STATUS,
      headers: { 'x-admin-key': TEST_KEY, 'content-type': 'application/json' },
      payload: { run_id: 'nope' },
    });
    expect(res.statusCode).toBe(404);
  });
});
