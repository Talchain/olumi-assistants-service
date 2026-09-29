/**
 * Route-level fail-closed test for MC-29.
 *
 * Brief: v5-group2-model-routing-hygiene (Task C).
 *
 * Exercises the full unified-pipeline wrapper (not just the boundary
 * stage in isolation) to prove that an invalid V3 egress produces
 * HTTP 502 with a typed error envelope — not a 200 fallback.
 *
 * Strategy:
 *   - Use LLM_PROVIDER=fixtures so no real LLM is called.
 *   - Mock transformResponseToV3 to return a body that fails the
 *     CEEGraphResponseV3 Zod parse.
 *   - Call runUnifiedPipeline directly (it is the function the
 *     /assist/v1/draft-graph route invokes) and assert the
 *     { statusCode, body } result.
 *
 * This is a route-level integration test — it exercises stages 1-6
 * plus drainEarlyReturn plus attachPipelineOutcome — without booting
 * a full Fastify server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

// Fixtures provider so no real LLM keys are required
vi.stubEnv('LLM_PROVIDER', 'fixtures');
vi.stubEnv('CEE_STRUCTURAL_WARNINGS', 'false');

// Intentionally malformed V3 body: missing required fields. The real
// CEEGraphResponseV3 schema will reject this (not mocked here so the
// behaviour under test is the real Zod reject -> earlyReturn path).
const INVALID_V3_BODY = {
  // missing nodes, edges, meta, analysis_ready etc.
  broken: true,
};

vi.mock('../../src/cee/transforms/schema-v3.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/cee/transforms/schema-v3.js')>();
  return {
    ...orig,
    transformResponseToV3: vi.fn(() => INVALID_V3_BODY as any),
    // keep validateStrictModeV3 as original (not used when strictMode=false)
  };
});

// Avoid expensive/real dependencies in the CEE pipeline
vi.mock('../../src/services/validateClient.js', () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Import AFTER vi.mock so the mocked transform is picked up
import { runUnifiedPipeline } from '../../src/cee/unified-pipeline/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeRequest(): FastifyRequest {
  return {
    id: 'req-mc29',
    headers: {},
    query: {},
    raw: { destroyed: false },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as FastifyRequest;
}

const SIMPLE_BRIEF = `I need to decide between expanding to Europe this quarter or waiting until next year. The opportunity is real but resources are constrained.`;

// ── Test ────────────────────────────────────────────────────────────────

describe('Route-level fail-closed: invalid V3 egress produces 502 (MC-29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP 502 with CEE_EGRESS_CONTRACT_VIOLATION and reason egress_contract_violation', async () => {
    const baseInput = {
      brief: SIMPLE_BRIEF,
      docs: [],
    } as unknown as Parameters<typeof runUnifiedPipeline>[0];

    const rawBody = { brief: SIMPLE_BRIEF };

    const result = await runUnifiedPipeline(baseInput, rawBody, makeRequest(), {
      schemaVersion: 'v3',
      strictMode: false,
      includeDebug: false,
      rawOutput: false,
      refreshPrompts: false,
      forceDefault: false,
      requestStartMs: Date.now(),
    });

    // The previous soft-gate behaviour returned 200 with a fallback body.
    // Under MC-29, invalid V3 egress must return 502 with a typed
    // CEEErrorResponseV1 envelope (top-level code/message/reason/details).
    expect(result.statusCode).toBe(502);
    const body = result.body as {
      code?: string;
      message?: string;
      reason?: string;
      retryable?: boolean;
      source?: string;
      details?: Record<string, unknown>;
    };
    expect(body.code).toBe('CEE_EGRESS_CONTRACT_VIOLATION');
    expect(body.reason).toBe('egress_contract_violation');
    expect(body.message).toContain('Egress contract violation');
    expect(body.retryable).toBe(false);
    expect(body.source).toBe('cee');
    expect(body.details?.validator).toBe('zod_v3');
    expect(body.details?.boundary).toBe('B1');
    expect(body.details?.direction).toBe('response');
  });

  it('does NOT return a 200 fallback envelope when egress validation fails', async () => {
    const baseInput = { brief: SIMPLE_BRIEF, docs: [] } as unknown as Parameters<typeof runUnifiedPipeline>[0];
    const result = await runUnifiedPipeline(baseInput, { brief: SIMPLE_BRIEF }, makeRequest(), {
      schemaVersion: 'v3',
      strictMode: false,
      includeDebug: false,
      rawOutput: false,
      refreshPrompts: false,
      forceDefault: false,
      requestStartMs: Date.now(),
    });
    expect(result.statusCode).not.toBe(200);
    // Safety: body must not be a packaged-success envelope
    const body = result.body as { graph?: unknown };
    expect(body.graph).toBeUndefined();
  });
});
