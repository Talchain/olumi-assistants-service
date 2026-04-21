/**
 * V5 slice A0 — integration tests for POST /orchestrate/v2/turn.
 *
 * Fixtures live under tests/fixtures/contracts/b1/. Each fixture declares:
 *   - request:  the JSON body to POST
 *   - expected: status + body shape + telemetry.boundary_validation_event_count
 *
 * We verify:
 *   - HTTP status matches
 *   - Body is the expected OlumiResponse envelope (valid case) or
 *     typed BoundaryError per §6.4 (invalid cases)
 *   - telemetry.boundary.validation events fire with correct
 *     direction + pass + validator + contract_version
 *   - Route is absent when feature flag is off (404)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setTestSink } from '../../src/utils/telemetry.js';

// ============================================================================
// Fixture loading
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = join(__dirname, '..', 'fixtures', 'contracts', 'b1');

type Fixture = {
  _meta: { fixture_id: string; expected_result_class: string };
  request: unknown;
  expected: {
    status: number;
    body: Record<string, unknown>;
    telemetry: { boundary_validation_event_count: number; ingress_pass?: boolean; egress_pass?: boolean };
  };
};

function loadFixture(name: string): Fixture {
  const raw = readFileSync(join(FIX_DIR, name), 'utf8');
  return JSON.parse(raw) as Fixture;
}

// Sanity check: enumerate expected files once so a missing fixture is loud.
const EXPECTED_FIXTURES = [
  'valid-turn-payload.json',
  'invalid-turn-payload-missing-scenario-id.json',
  'invalid-turn-payload-wrong-types.json',
  'invalid-turn-payload-extra-fields.json',
];

describe('B1 fixture folder', () => {
  it('contains the four A0 fixtures', () => {
    const actual = readdirSync(FIX_DIR).filter((f) => f.endsWith('.json')).sort();
    expect(actual).toEqual([...EXPECTED_FIXTURES].sort());
  });
});

// ============================================================================
// Feature flag mock — toggleable per describe block
// ============================================================================

let v5Enabled = true;

vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return v5Enabled;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

// A1: TurnExecutor calls getAdapter + getSystemPrompt. Mock at the seam so
// the A0 boundary tests still exercise B1 ingress + egress without touching
// a real provider. The valid-turn-payload fixture declares its expected
// narrate output in `mock_narrate_output`.
//
// A2: a classifier LLM call now precedes narrate. The mock distinguishes
// classify (responseFormat='json_object') from narrate and always returns a
// direct_answer classification — the A0 valid-turn-payload fixture is
// direct_answer-shaped, matching the A1 replacement envelope.
let mockNarrateOutput = '';
const a0MockAdapter = {
  name: 'a0-test-mock',
  chat: async (args: { responseFormat?: string }) => {
    const content = args.responseFormat === 'json_object'
      ? '{"turn_class":"direct_answer"}'
      : mockNarrateOutput;
    return {
      content,
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'a0-test-mock',
      latencyMs: 0,
    };
  },
  // V5 Phase 1: tool-use routing path. Returns a text-only tool result driven
  // by mockNarrateOutput (the A0 fixture is direct_answer-shaped).
  chatWithTools: async () => ({
    content: [{ type: 'text', text: mockNarrateOutput }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'a0-test-mock',
    latencyMs: 0,
  }),
};
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => a0MockAdapter,
  // Group 3 Task C: route-with-tool-use resolves via getAdapterWithResolution.
  getAdapterWithResolution: (task?: string) => ({
    adapter: a0MockAdapter,
    resolution: {
      task,
      resolved_model: 'a0-test-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));
vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// v5-maintenance Task 1: mock the session store so fixture 1 (valid payload)
// can exercise the B1 ingress + egress happy path without requiring
// SUPABASE_* env vars. Without this mock, commitDirectAnswer throws at
// getSessionStore() and the route returns 500 instead of 200.
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    checkScenarioExists: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Import AFTER the mock is set up.
const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

// ============================================================================
// Telemetry sink — collects boundary.validation events per test
// ============================================================================

type TelemetryEvent = { event: string; data: Record<string, unknown> };
let events: TelemetryEvent[] = [];

function installSink() {
  setTestSink((eventName, data) => {
    events.push({ event: eventName, data });
  });
}
function uninstallSink() {
  setTestSink(null);
}
function boundaryEvents(): TelemetryEvent[] {
  return events.filter((e) => e.event === 'boundary.validation');
}

// ============================================================================
// Flag-on tests — route is registered, fixtures drive behaviour
// ============================================================================

describe('POST /orchestrate/v2/turn (V5 flag ON)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    installSink();
  });

  afterAll(async () => {
    uninstallSink();
    await app.close();
  });

  beforeEach(() => {
    events = [];
  });

  it('fixture 1: valid payload → 200 + direct_answer success envelope + 2 boundary.validation events', async () => {
    const fx = loadFixture('valid-turn-payload.json');
    // A1: feed the mocked narrate adapter the fixture's declared output.
    mockNarrateOutput = (fx as unknown as { mock_narrate_output: string }).mock_narrate_output;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(fx.expected.status);
    const body = JSON.parse(res.body);
    expect(body).toEqual(fx.expected.body);

    const be = boundaryEvents();
    expect(be).toHaveLength(fx.expected.telemetry.boundary_validation_event_count);

    const ingress = be.find((e) => e.data.direction === 'ingress');
    const egress = be.find((e) => e.data.direction === 'egress');
    expect(ingress).toBeDefined();
    expect(egress).toBeDefined();
    expect(ingress?.data.pass).toBe(true);
    expect(egress?.data.pass).toBe(true);
    expect(ingress?.data.validator).toBe('OrchestratorTurnPayload');
    expect(egress?.data.validator).toBe('OlumiResponse');
    expect(ingress?.data.contract_version).toBe('0.3.0');
    expect(ingress?.data.boundary).toBe('B1');
  });

  it('fixture 2: missing scenario_id → 422 + BoundaryError + 1 ingress-fail event', async () => {
    const fx = loadFixture('invalid-turn-payload-missing-scenario-id.json');
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);

    // BoundaryError shape per §6.4 (exact keys, strict).
    expect(body).toMatchObject({
      error: 'INGRESS_CONTRACT_VIOLATION',
      boundary: 'B1',
      direction: 'ingress',
      validator: 'OrchestratorTurnPayload',
      retryable: false,
    });
    expect(typeof body.request_id).toBe('string');
    expect(body.request_id.length).toBeGreaterThan(0);
    expect(body.details).toBeDefined();
    expect(Array.isArray(body.details.issues)).toBe(true);

    // No top-level `code` or `fields` keys (per §6.4 lock-in).
    expect(body.code).toBeUndefined();
    expect(body.fields).toBeUndefined();

    // Must include an issue pointing at scenario_id.
    const paths = (body.details.issues as Array<{ path: string }>).map((i) => i.path);
    expect(paths).toContain('scenario_id');

    const be = boundaryEvents();
    expect(be).toHaveLength(1);
    expect(be[0].data.direction).toBe('ingress');
    expect(be[0].data.pass).toBe(false);
    expect(be[0].data.error_code).toBe('INGRESS_CONTRACT_VIOLATION');
  });

  it('fixture 3: wrong types → 422 + multiple issues', async () => {
    const fx = loadFixture('invalid-turn-payload-wrong-types.json');
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');

    const issues = body.details.issues as Array<{ path: string; code: string }>;
    expect(issues.length).toBeGreaterThanOrEqual(3);

    const paths = issues.map((i) => i.path);
    for (const required of ['turn_id', 'message', 'turn_class']) {
      expect(paths).toContain(required);
    }

    const be = boundaryEvents();
    expect(be).toHaveLength(1);
    expect(be[0].data.issue_count).toBe(issues.length);
  });

  it('fixture 4: unknown keys (strict mode) → 422 + unrecognized_keys issue', async () => {
    const fx = loadFixture('invalid-turn-payload-extra-fields.json');
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');

    const issues = body.details.issues as Array<{ path: string; code: string }>;
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);

    const be = boundaryEvents();
    expect(be).toHaveLength(1);
    expect(be[0].data.pass).toBe(false);
  });

  it('empty body → 422 (not 500, not 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');
  });
});

// ============================================================================
// Flag-off test — route must be absent (404)
// ============================================================================

describe('POST /orchestrate/v2/turn (V5 flag OFF)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = false;
    app = Fastify();
    // Simulate server.ts conditional registration logic: only call the
    // registrar when the flag is on. With flag off, nothing is registered.
    if (v5Enabled) {
      await ceeOrchestratorRouteV2(app);
    }
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('route is not registered when feature flag is off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: { turn_id: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});
