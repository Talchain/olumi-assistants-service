/**
 * /healthz must DEGRADE when the prompt store is throwing.
 *
 * WHY THIS FILE EXISTS — the same reason as
 * `healthz.prompt-env-readiness.test.ts`: the decision logic is unit-tested in
 * `prompts.store-failure-fail-loud.test.ts`, but nothing would prove the
 * ENDPOINT honours it. A refactor could sever the wiring while every
 * decision-logic test stayed green. That is this repo's dominant defect class
 * (machinery that reads as a guarantee but never executes), so the mechanism
 * gets a test that exercises the real route.
 *
 * During the P0, `/healthz` returned `ok: true`, `prompts_ready: true`,
 * `degraded: false` for ~2.5 hours while every `draft_graph` version was
 * undecodable. `critical_prompts_pms` was false — and was DELIBERATELY excluded
 * from `degraded_reasons`, correctly, because it is false in healthy shapes
 * too. The new reason is scoped to an actual store FAILURE instead.
 *
 * `degraded` does not change the status code, so this stays safe for the
 * load balancer: the route still returns 200.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const storeBehaviour: { mode: 'throws' | 'not_found' | 'healthy'; reads: number } = {
  mode: 'throws',
  reads: 0,
};

vi.mock('../../src/prompts/store.js', async (importOriginal) => {
  // importOriginal spread — never a bare factory (it would REPLACE the module
  // and silently drop every other symbol server.ts imports from here).
  const actual = await importOriginal<typeof import('../../src/prompts/store.js')>();
  return {
    ...actual,
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () => ({
      getCompiled: async () => {
        storeBehaviour.reads += 1;
        if (storeBehaviour.mode === 'throws') {
          throw new SyntaxError('Unexpected end of JSON input');
        }
        if (storeBehaviour.mode === 'healthy') {
          return { promptId: 'prompt-1', version: 1, content: 'Managed prompt' };
        }
        return null;
      },
      get: async () => null,
    }),
  };
});

const { build } = await import('../../src/server.js');
const { __resetPromptsReadyCacheForTests, warmPromptReadinessSnapshot } = await import(
  '../../src/prompts/readiness.js'
);
const { __resetRoutingLiveStatusProviderForTests } = await import(
  '../../src/prompts/routing-live-status.js'
);
const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
const { loadPrompt } = await import('../../src/prompts/loader.js');

describe('/healthz — prompt-store fetch failure degrades loudly', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LLM_PROVIDER = 'fixtures';
    registerAllDefaultPrompts();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function healthz() {
    // The route reads a boot/promotion snapshot without touching PMS. Refresh
    // that snapshot under this test's selected store behaviour first.
    __resetPromptsReadyCacheForTests();
    __resetRoutingLiveStatusProviderForTests();
    await warmPromptReadinessSnapshot('reload');
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  // RED at pristine: the route reported degraded:false while the store threw.
  it('reports degraded with critical_prompt_fetch_error when the store THROWS', async () => {
    storeBehaviour.mode = 'throws';

    const { status, body } = await healthz();

    expect(status).toBe(200); // must NOT change the load-balancer verdict
    expect(body.degraded).toBe(true);
    expect(body.degraded_reasons).toContain('critical_prompt_fetch_error');
  });

  /**
   * THE DISCRIMINATING TWIN. Without this, a reason that fired unconditionally
   * would pass the assertion above and be no alarm at all.
   */
  it('DISCRIMINATING TWIN: does NOT raise the reason when keys merely have no PMS row', async () => {
    storeBehaviour.mode = 'not_found';

    const { status, body } = await healthz();

    expect(status).toBe(200);
    const reasons = (body.degraded_reasons ?? []) as string[];
    expect(reasons).not.toContain('critical_prompt_fetch_error');
    // Positive control on the probe itself: this shape genuinely has no PMS
    // coverage, so the honest signal IS false — the alarm is scoped tighter
    // than `critical_prompts_pms` on purpose.
    expect(body.critical_prompts_pms).toBe(false);
  });

  it('degrades after a later runtime store failure and recovers after a successful runtime read', async () => {
    storeBehaviour.mode = 'healthy';
    const initial = await healthz();
    expect(initial.body.critical_prompts_pms).toBe(true);
    expect(initial.body.degraded_reasons ?? []).not.toContain('critical_prompt_fetch_error');

    storeBehaviour.mode = 'throws';
    const fallback = await loadPrompt('draft_graph', { trigger: 'runtime' });
    expect(fallback.source).toBe('default');
    expect(fallback.fallbackReason).toBe('fetch_error');
    const readsBeforeHealth = storeBehaviour.reads;
    const failed = await app.inject({ method: 'GET', url: '/healthz' });
    const failedBody = failed.json() as Record<string, unknown>;
    expect(failed.statusCode).toBe(200);
    expect(failedBody.degraded_reasons).toContain('critical_prompt_fetch_error');
    expect(failedBody.critical_prompts_pms).toBe(false);
    expect(storeBehaviour.reads).toBe(readsBeforeHealth);

    storeBehaviour.mode = 'healthy';
    expect((await loadPrompt('draft_graph', { trigger: 'runtime' })).source).toBe('store');
    const readsBeforeRecoveryHealth = storeBehaviour.reads;
    const recovered = (await app.inject({ method: 'GET', url: '/healthz' })).json() as Record<string, unknown>;
    expect(recovered.degraded_reasons ?? []).not.toContain('critical_prompt_fetch_error');
    expect(recovered.critical_prompts_pms).toBe(true);
    expect(storeBehaviour.reads).toBe(readsBeforeRecoveryHealth);
  });
});
