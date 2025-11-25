/**
 * ISL Causal Validation Integration Test
 *
 * Tests for ISL integration in the bias-check route
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.stubEnv('LLM_PROVIDER', 'fixtures');

import { build } from '../../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('POST /assist/v1/bias-check with ISL', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ASSIST_API_KEYS', 'test-key-isl');
    vi.stubEnv('CEE_BIAS_CHECK_RATE_LIMIT_RPM', '10');
    delete process.env.BASE_URL;
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validBiasCheckRequest = {
    graph: {
      version: '1',
      default_seed: 17,
      nodes: [
        { id: 'g1', kind: 'goal', label: 'Achieve product-market fit' },
        { id: 'opt1', kind: 'option', label: 'Strategy A' },
        { id: 'opt2', kind: 'option', label: 'Strategy B' },
        { id: 'out1', kind: 'outcome', label: 'Market research shows demand' },
      ],
      edges: [
        { from: 'opt1', to: 'out1' },
        { from: 'opt2', to: 'g1' },
      ],
      meta: {
        roots: ['g1'],
        leaves: ['opt1', 'opt2', 'out1'],
        suggested_positions: {},
        source: 'assistant',
      },
    },
    seed: '123',
  };

  it('should return bias findings without causal validation when feature is disabled', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'false';

    const response = await app.inject({
      method: 'POST',
      url: '/assist/v1/bias-check',
      headers: {
        'X-Olumi-Assist-Key': 'test-key-isl',
        'Content-Type': 'application/json',
      },
      payload: validBiasCheckRequest,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.trace).toBeDefined();
    expect(body.bias_findings).toBeInstanceOf(Array);

    // Findings should NOT have causal_validation or evidence_strength
    if (body.bias_findings.length > 0) {
      expect(body.bias_findings[0]).not.toHaveProperty('causal_validation');
      expect(body.bias_findings[0]).not.toHaveProperty('evidence_strength');
    }
  });

  it('should work without ISL when ISL_BASE_URL is not configured', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    // ISL_BASE_URL not set

    const response = await app.inject({
      method: 'POST',
      url: '/assist/v1/bias-check',
      headers: {
        'X-Olumi-Assist-Key': 'test-key-isl',
        'Content-Type': 'application/json',
      },
      payload: validBiasCheckRequest,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.bias_findings).toBeInstanceOf(Array);
    // Should still return findings, just not enriched
    if (body.bias_findings.length > 0) {
      expect(body.bias_findings[0]).not.toHaveProperty('causal_validation');
    }
  });

  it('should enrich findings with causal validation when ISL is configured', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8888';

    // Mock ISL response
    const mockISLResponse = {
      validations: [
        {
          bias_code: 'CONFIRMATION_BIAS',
          causal_validation: {
            identifiable: true,
            strength: 0.7,
            confidence: 'medium',
            details: {
              affected_paths: ['e1 -> g1', 'e2 -> g1'],
              counterfactual_delta: {
                metric: 'outcome_range',
                change_percent: 20,
              },
            },
          },
          evidence_strength: [
            {
              node_id: 'e1',
              causal_support: 'moderate',
              reasoning: 'Direct evidence for goal',
            },
            {
              node_id: 'e2',
              causal_support: 'weak',
              reasoning: 'Indirect support',
            },
          ],
        },
      ],
      request_id: 'isl-req-123',
      latency_ms: 100,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockISLResponse,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/assist/v1/bias-check',
      headers: {
        'X-Olumi-Assist-Key': 'test-key-isl',
        'Content-Type': 'application/json',
      },
      payload: validBiasCheckRequest,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.bias_findings).toBeInstanceOf(Array);

    // Find the CONFIRMATION_BIAS finding if it exists
    const confirmationBiasFinding = body.bias_findings.find(
      (f: any) => f.code === 'CONFIRMATION_BIAS'
    );

    if (confirmationBiasFinding) {
      expect(confirmationBiasFinding).toHaveProperty('causal_validation');
      expect(confirmationBiasFinding.causal_validation).toMatchObject({
        identifiable: true,
        strength: 0.7,
        confidence: 'medium',
      });
      expect(confirmationBiasFinding).toHaveProperty('evidence_strength');
      expect(confirmationBiasFinding.evidence_strength).toBeInstanceOf(Array);
    }
  });

  it('should gracefully degrade when ISL times out', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8888';
    process.env.ISL_TIMEOUT_MS = '100';

    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('AbortError');
          error.name = 'AbortError';
          reject(error);
        }, 200);
      });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/assist/v1/bias-check',
      headers: {
        'X-Olumi-Assist-Key': 'test-key-isl',
        'Content-Type': 'application/json',
      },
      payload: validBiasCheckRequest,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // Should still return findings, just not enriched
    expect(body.bias_findings).toBeInstanceOf(Array);
    if (body.bias_findings.length > 0) {
      expect(body.bias_findings[0]).not.toHaveProperty('causal_validation');
    }
  });

  it('should gracefully degrade when ISL returns error', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8888';

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'ISL service error',
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/assist/v1/bias-check',
      headers: {
        'X-Olumi-Assist-Key': 'test-key-isl',
        'Content-Type': 'application/json',
      },
      payload: validBiasCheckRequest,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // Should still return findings, just not enriched
    expect(body.bias_findings).toBeInstanceOf(Array);
    if (body.bias_findings.length > 0) {
      expect(body.bias_findings[0]).not.toHaveProperty('causal_validation');
    }
  });

  it('should send correct ISL request with evidence nodes', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8888';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        validations: [],
        request_id: 'req-123',
        latency_ms: 50,
      }),
    });

    await app.inject({
      method: 'POST',
      url: '/assist/v1/bias-check',
      headers: {
        'X-Olumi-Assist-Key': 'test-key-isl',
        'Content-Type': 'application/json',
      },
      payload: validBiasCheckRequest,
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8888/isl/v1/bias-validate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );

    const fetchCall = (fetch as any).mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    expect(requestBody).toHaveProperty('graph');
    expect(requestBody).toHaveProperty('bias_findings');
    expect(requestBody).toHaveProperty('validation_config');
    expect(requestBody.validation_config).toHaveProperty('enable_counterfactuals', true);
    expect(requestBody.validation_config).toHaveProperty('evidence_nodes');
    expect(requestBody.validation_config.evidence_nodes).toEqual(
      expect.arrayContaining(['out1'])
    );
  });
});
