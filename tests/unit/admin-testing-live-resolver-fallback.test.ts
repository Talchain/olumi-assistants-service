/**
 * ⭐ THE BAKE-OFF HARNESS MUST REACH THE PROMPTS THE PRODUCT ACTUALLY RUNS.
 *
 * `POST /admin/v1/test-prompt-llm` is the only instrument that can compare
 * models on a real prompt while holding `prompt_id` + `version` constant. It
 * resolved prompts through the store's raw CRUD (`store.get`), while every
 * runtime call site resolves through the PMS-backed resolver
 * (`getSystemPromptSnapshot`). So it 404'd on every prompt the product runs.
 *
 * MEASURED on deployed staging, 23 Sep, with the discriminator that separates a
 * handler 404 from a route-level 404:
 *   POST /admin/v1/test-prompt-llm {"prompt_id":"draft_graph",...}
 *     -> 404 {"error":"not_found","message":"Prompt 'draft_graph' not found"}
 *   POST /admin/v1/zzz-no-such-route (control)
 *     -> 404 {...,"statusCode":404}          <- Fastify's, a DIFFERENT shape
 *   GET  /admin/prompts/status
 *     -> {"key":"draft_graph","source":"pms","version":"202","disposition":"live"}
 * The route was mounted and auth passed; the store simply had no record.
 *
 * ── WHY THIS TEST NEEDS NO LLM MOCK ──────────────────────────────────────────
 * `callLLMWithPrompt` RETURNS `{success:false, error:'Anthropic API key not
 * configured'}` rather than throwing, and the handler assembles `prompt`
 * alongside `llm` afterwards. So with no API key the route still reports which
 * bytes it resolved. These tests therefore bind PROMPT RESOLUTION and never
 * depend on a provider, a network call or a fabricated SDK response.
 *
 * ⚠ WHAT IS DELIBERATELY NOT ASSERTED: that the resolver returns the RIGHT
 * prompt, or anything about model quality. That is the bake-off's job, and the
 * harness discloses its own divergence from production in `harness_fidelity`.
 * This file asserts only that the instrument can reach a PMS-served prompt and
 * that it SAYS WHICH LOOKUP ANSWERED — a result that cannot name its own bytes
 * is not evidence.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  /** What `store.get(id)` returns. `null` models the real staging store. */
  storeRecord: null as unknown,
  snapshotCalls: [] as string[],
  snapshot: {
    content: 'RESOLVED LIVE SYSTEM PROMPT BYTES',
    meta: { taskId: 'draft_graph', prompt_version: 'v202', version: 202, source: 'store' }, // real SystemPromptMeta form — source is 'store'|'default', NEVER 'pms'
  } as unknown,
  snapshotThrows: null as Error | null,
}));

vi.mock('../../src/prompts/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/prompts/store.js')>();
  return {
    ...actual,
    isPromptStoreHealthy: () => true,
    getPromptStore: () => ({
      get: async (_id: string) => routeState.storeRecord,
      list: async () => [],
    }),
  };
});

vi.mock('../../src/adapters/llm/prompt-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/llm/prompt-loader.js')>();
  return {
    ...actual,
    getSystemPromptSnapshot: async (operation: string) => {
      routeState.snapshotCalls.push(operation);
      if (routeState.snapshotThrows) throw routeState.snapshotThrows;
      return routeState.snapshot;
    },
  };
});

vi.mock('../../src/middleware/admin-auth.js', () => ({
  AdminAuthTelemetryEvents: {},
  verifyAdminKey: () => true,
  getActorFromRequest: () => 'route-test-admin',
}));

/** ≥30 chars, as the route's own zod schema requires. */
const BRIEF =
  'We are a 40-person B2B SaaS company and our enterprise renewal rate fell from 91 to 78 percent.';

function post(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/admin/v1/test-prompt-llm',
    headers: { 'content-type': 'application/json', 'x-admin-key': 'test' },
    payload: body,
  });
}

describe('the bake-off harness resolves PMS-served prompts, and says so', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('PROMPTS_ENABLED', 'true');
    // ⚠ Deliberately NO provider API key. The LLM call then fails closed and
    // returns success:false, which is all this file needs — and it guarantees
    // no test in this suite can ever make a real provider call.
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const configModule = await import('../../src/config/index.js');
    configModule._resetConfigCache();
    const fastify = (await import('fastify')).default;
    const { adminTestRoutes } = await import('../../src/routes/admin.testing.js');
    app = fastify();
    await app.register(adminTestRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    const configModule = await import('../../src/config/index.js');
    configModule._resetConfigCache();
  });

  beforeEach(() => {
    routeState.storeRecord = null;
    routeState.snapshotCalls = [];
    routeState.snapshotThrows = null;
    routeState.snapshot = {
      content: 'RESOLVED LIVE SYSTEM PROMPT BYTES',
      meta: { taskId: 'draft_graph', prompt_version: 'v202', version: 202, source: 'store' }, // real SystemPromptMeta form — source is 'store'|'default', NEVER 'pms'
    };
  });

  /**
   * ⛔ THE LOAD-BEARING ASSERTION. Reverting the fallback makes this REDdirectly:
   * the old code returned 404 the instant `store.get` came back empty.
   */
  it('a store MISS on a valid CEE task falls back to the runtime resolver instead of 404ing', async () => {
    const res = await post(app, { prompt_id: 'draft_graph', version: 202, brief: BRIEF });

    expect(res.statusCode, 'the store has no draft_graph record — this 404d before the fix').toBe(200);
    const body = res.json();
    expect(body.prompt.resolved_via).toBe('live_resolver');
    expect(routeState.snapshotCalls, 'the resolver must actually have been consulted').toEqual([
      'draft_graph',
    ]);
  });

  it('reports the LIVE version and source, because the echoed `version` is only the REQUEST', async () => {
    // The trap this closes: a bake-off row saying `version: 202` when the
    // resolver served something else is a result that cannot name its own bytes.
    const res = await post(app, { prompt_id: 'draft_graph', version: 1, brief: BRIEF });
    const body = res.json();
    expect(body.prompt.version, 'echoes the request verbatim').toBe(1);
    expect(body.prompt.live_prompt_version, 'the authority on what ran').toBe('v202');
    // ⚠ CORRECTED IN REVIEW: I asserted source 'pms', which `SystemPromptMeta`
    // cannot produce — it is `'store' | 'default'` (`prompt-loader.ts:549`).
    // A mock that returns an impossible value tests a shape the runtime never
    // emits, so the assertion was green and meaningless.
    expect(body.prompt.live_prompt_source).toBe('store');
    expect(body.prompt.content_length).toBe('RESOLVED LIVE SYSTEM PROMPT BYTES'.length);
  });

  /**
   * ⛔ CONTRAST CONTROL — without this the fix reads as "never 404 again".
   * An id that is not in the store AND not a known CEE task must be unchanged.
   */
  it('CONTRAST CONTROL: an id that is not a CEE task still 404s, with the original message', async () => {
    const res = await post(app, { prompt_id: 'zzz_not_a_cee_task', version: 1, brief: BRIEF });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("Prompt 'zzz_not_a_cee_task' not found");
    expect(routeState.snapshotCalls, 'the resolver must NOT be consulted for a non-task').toEqual([]);
  });

  /**
   * ⛔ THE OTHER HALF OF THE CONTRAST: the version-pinned path must be
   * untouched. If the fallback ever hijacked a store hit, every existing
   * version-pinned comparison would silently start testing live bytes.
   */
  it('CONTRAST CONTROL: a store HIT still answers store_version, and never calls the resolver', async () => {
    routeState.storeRecord = {
      id: 'some_stored_prompt',
      taskId: 'draft_graph',
      status: 'staging',
      versions: [{ version: 7, content: 'STORED VERSION SEVEN BYTES' }],
    };
    const res = await post(app, { prompt_id: 'some_stored_prompt', version: 7, brief: BRIEF });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prompt.resolved_via).toBe('store_version');
    expect(body.prompt.live_prompt_version, 'absent, not invented, on the store path').toBeUndefined();
    expect(body.prompt.content_length).toBe('STORED VERSION SEVEN BYTES'.length);
    expect(routeState.snapshotCalls).toEqual([]);
  });

  it('a store hit for a MISSING version 404s on the version, not the prompt', async () => {
    routeState.storeRecord = {
      id: 'some_stored_prompt',
      taskId: 'draft_graph',
      status: 'staging',
      versions: [{ version: 7, content: 'STORED VERSION SEVEN BYTES' }],
    };
    const res = await post(app, { prompt_id: 'some_stored_prompt', version: 99, brief: BRIEF });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("Version 99 not found for prompt 'some_stored_prompt'");
  });

  it('a valid CEE task the resolver cannot serve 404s naming BOTH attempts', async () => {
    // The original message claimed the prompt did not exist when it demonstrably
    // did. An operator must not be left guessing which lookup failed.
    routeState.snapshot = { content: '', meta: {} };
    const res = await post(app, { prompt_id: 'draft_graph', version: 202, brief: BRIEF });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toContain('not found in the store');
    expect(res.json().message).toContain('runtime resolver returned no content');
  });

  /**
   * ⛔⛔ THE WRONG BOUNDARY THIS PR SHIPPED FIRST, NOW PINNED.
   *
   * `isValidCeeTask` and "the resolver can serve this operation" are DIFFERENT
   * SETS. `model-routing.ts` admits `explain_diff` and `routing`; neither
   * appears in `prompts/operations.ts`, and `getSystemPromptSnapshot` THROWS on
   * an unmapped operation (`prompt-loader.ts:660-663`). The first version of
   * this route gated on `isValidCeeTask`, so those two reached the resolver,
   * threw, and the route answered **500** — an instrument promising a broader
   * resolvable surface than it implements.
   *
   * ⚠ AND MY OWN TEST COULD NOT HAVE CAUGHT IT: every case used `draft_graph`,
   * which IS mapped. A fixture drawn from the supported set cannot exercise the
   * boundary between the two sets. That is what these cases are for.
   */
  it.each(['explain_diff', 'routing'])(
    '⛔ %s is a valid CEE task the resolver CANNOT serve — bounded 422, never 500',
    async (taskId) => {
      const res = await post(app, { prompt_id: taskId, version: 1, brief: BRIEF });

      expect(res.statusCode, 'must be a bounded 4xx, not the catch-all 500').toBe(422);
      expect(res.json().error).toBe('unsupported_operation');
      // Identity binding: the response names the id it refused and discloses
      // the scope it DOES support, so a bake-off cannot silently omit a task.
      expect(res.json().message).toContain(taskId);
      expect(res.json().message).toContain('Supported operations:');
      expect(res.json().message).toContain('draft_graph');
      // ⛔ AND THE RESOLVER IS NEVER CONSULTED — the refusal happens before any
      // provider call, which is the difference between a disclosed limit and a
      // 500 with a sanitised message.
      expect(routeState.snapshotCalls).toEqual([]);
    },
  );

  it('POSITIVE CONTROL — a MAPPED task still resolves, so the gate is not refusing everything', async () => {
    // Without this, the two refusals above would pass on a gate that rejected
    // every store miss. `draft_graph` is in `OPERATION_TO_TASK_ID`, so it must
    // still reach the resolver and answer 200.
    const res = await post(app, { prompt_id: 'draft_graph', version: 202, brief: BRIEF });
    expect(res.statusCode).toBe(200);
    expect(res.json().prompt.resolved_via).toBe('live_resolver');
    expect(routeState.snapshotCalls).toEqual(['draft_graph']);
  });

  /**
   * ⛔ NON-VACUITY CONTROL. Every assertion above would pass if the route
   * silently stopped making LLM calls — the responses would still carry
   * `prompt`. This pins that the harness really did attempt a call and reported
   * its failure honestly, so a later green here cannot mean "nothing ran".
   */
  it('NON-VACUITY: the harness attempted a real call and reported the failure honestly', async () => {
    const res = await post(app, { prompt_id: 'draft_graph', version: 202, brief: BRIEF });
    const body = res.json();
    expect(body.success, 'no API key is stubbed, so the call must fail').toBe(false);
    expect(body.llm, 'the llm block must still be reported').toBeDefined();
    expect(String(body.llm.model).length).toBeGreaterThan(0);
    expect(body.request_id, 'identity binding for any result read later').toBeTruthy();
  });
});
