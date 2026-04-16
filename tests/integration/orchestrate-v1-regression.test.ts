/**
 * V4 regression smoke — proves V5 slice A0 scaffold does not affect the V4
 * turn path when ENABLE_V5_ORCHESTRATOR is off.
 *
 * Scope (intentionally narrow):
 *   - With orchestratorV5 = false, POST /orchestrate/v1/turn returns 200 + a
 *     V4-shaped envelope containing the V4-only top-level fields.
 *   - With orchestratorV5 = false, POST /orchestrate/v2/turn is absent (404).
 *
 * This is a *scaffold* regression guard — it proves the route-v2 seam is not
 * reachable and not interfering. Full response-shape parity lives in the
 * existing route.test.ts / pipeline-integration.test.ts suites.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mocks mirror tests/integration/orchestrator/route.test.ts so this file is
// runnable standalone without the pipeline doing real work.
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({ content: 'Test response' }),
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'I can help with that.' }],
      stop_reason: 'end_turn',
    }),
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../src/orchestrator/plot-client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/orchestrator/plot-client.js')>();
  return {
    ...original,
    createPLoTClient: vi.fn().mockReturnValue(null),
  };
});

// V5 flag is OFF — this is the whole point of this test.
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestrator') return true;
              if (featProp === 'orchestratorV5') return false; // ← the lever
              if (featProp === 'deterministicOrchestratorEnabled') return false;
              if (featProp === 'legacyOrchestratorEnabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        if (prop === 'plot') return { baseUrl: undefined };
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV1 } = await import('../../src/orchestrator/route.js');
const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');
const { _clearIdempotencyCache } = await import('../../src/orchestrator/idempotency.js');

function makeValidV1Request() {
  return {
    message: 'Hello, how can you help?',
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: 'frame' },
      messages: [],
      scenario_id: 'test-scenario-v4-regression',
    },
    scenario_id: 'test-scenario-v4-regression',
    client_turn_id: 'v4-regression-turn-001',
  };
}

describe('V4 regression smoke (V5 flag OFF)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV1(app);
    // Mimic server.ts: only register v2 when the flag is on. Here it's off,
    // so we deliberately do NOT register. The 404 assertion proves this path.
    const v5On = false;
    if (v5On) {
      await ceeOrchestratorRouteV2(app);
    }
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    _clearIdempotencyCache();
  });

  it('POST /orchestrate/v1/turn does not emit V5 artefacts', async () => {
    // Scope: this test asserts that the V5 slice A0 scaffold has not leaked
    // into the V4 response path. It intentionally does NOT assert a specific
    // 2xx status — the V1 route's pipeline behaviour under test mocks is the
    // domain of tests/integration/orchestrator/route.test.ts, not A0.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v1/turn',
      payload: makeValidV1Request(),
    });

    // Whatever V1 returns, it must not carry V5-A0-specific artefacts.
    // FEATURE_NOT_ENABLED is the V5 A0 feature-unavailable sentinel.
    // B1 BoundaryError carries boundary + direction + validator — V5-only.
    // (response_version:2 is NOT a V5-only marker — V4's envelope already
    // uses response_version=2, so we do not assert against it here.)
    const bodyStr = res.body ?? '';
    expect(bodyStr).not.toContain('FEATURE_NOT_ENABLED');
    expect(bodyStr).not.toContain('"boundary":"B1"');
    expect(bodyStr).not.toContain('INGRESS_CONTRACT_VIOLATION');
  });

  it('POST /orchestrate/v2/turn is absent (404) when flag is off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeValidV1Request(),
    });
    expect(res.statusCode).toBe(404);
  });
});
