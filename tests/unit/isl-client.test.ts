/**
 * ISL Client Unit Tests
 *
 * Tests for the ISL (Inference & Structure Learning) client functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ISLClient, ISLValidationError, ISLTimeoutError, createISLClient } from '../../src/adapters/isl/client.js';
import type { ISLBiasValidateRequest, ISLBiasValidateResponse } from '../../src/adapters/isl/types.js';

describe('ISLClient', () => {
  let client: ISLClient;
  const mockBaseUrl = 'http://localhost:8080';

  beforeEach(() => {
    client = new ISLClient({
      baseUrl: mockBaseUrl,
      timeout: 2000,
      maxRetries: 0,
    });
    vi.restoreAllMocks();
  });

  describe('validateBias', () => {
    it('should successfully validate bias findings', async () => {
      const mockRequest: ISLBiasValidateRequest = {
        graph: { nodes: [], edges: [] } as any,
        bias_findings: [
          {
            code: 'CONFIRMATION_BIAS',
            targets: { node_ids: ['node1'] },
            severity: 'high',
          },
        ],
        validation_config: {
          enable_counterfactuals: true,
          evidence_nodes: ['evidence1'],
        },
      };

      const mockResponse: ISLBiasValidateResponse = {
        validations: [
          {
            bias_code: 'CONFIRMATION_BIAS',
            causal_validation: {
              identifiable: true,
              strength: 0.8,
              confidence: 'high',
              details: {
                affected_paths: ['path1', 'path2'],
                counterfactual_delta: {
                  metric: 'outcome_range',
                  change_percent: 30,
                },
              },
            },
            evidence_strength: [
              {
                node_id: 'evidence1',
                causal_support: 'strong',
                reasoning: 'Direct causal link observed',
              },
            ],
          },
        ],
        request_id: 'req-123',
        latency_ms: 150,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.validateBias(mockRequest);

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/isl/v1/bias-validate`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(mockRequest),
        })
      );
    });

    it('should include API key header when provided', async () => {
      const clientWithKey = new ISLClient({
        baseUrl: mockBaseUrl,
        timeout: 2000,
        apiKey: 'test-key-123',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ validations: [], request_id: 'req-123', latency_ms: 100 }),
      });

      await clientWithKey.validateBias({
        graph: { nodes: [], edges: [] } as any,
        bias_findings: [],
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-ISL-API-Key': 'test-key-123',
          }),
        })
      );
    });

    it('should throw ISLValidationError on 400 error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid graph structure',
          },
        }),
      });

      await expect(
        client.validateBias({
          graph: { nodes: [], edges: [] } as any,
          bias_findings: [],
        })
      ).rejects.toThrow(ISLValidationError);
    });

    it('should throw ISLTimeoutError on request timeout', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('AbortError');
            error.name = 'AbortError';
            reject(error);
          }, 100);
        });
      });

      await expect(
        client.validateBias({
          graph: { nodes: [], edges: [] } as any,
          bias_findings: [],
        })
      ).rejects.toThrow(ISLTimeoutError);
    });

    it('should throw ISLValidationError on non-JSON error response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(
        client.validateBias({
          graph: { nodes: [], edges: [] } as any,
          bias_findings: [],
        })
      ).rejects.toThrow(ISLValidationError);
    });
  });
});

describe('createISLClient', () => {
  beforeEach(() => {
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_TIMEOUT_MS;
    delete process.env.ISL_MAX_RETRIES;
    delete process.env.ISL_API_KEY;
  });

  it('should return null if ISL_BASE_URL is not configured', () => {
    const client = createISLClient();
    expect(client).toBeNull();
  });

  it('should create client with default timeout and retries', () => {
    process.env.ISL_BASE_URL = 'http://localhost:8080';
    const client = createISLClient();

    expect(client).not.toBeNull();
    expect(client).toBeInstanceOf(ISLClient);
  });

  it('should create client with custom timeout and retries', () => {
    process.env.ISL_BASE_URL = 'http://localhost:8080';
    process.env.ISL_TIMEOUT_MS = '5000';
    process.env.ISL_MAX_RETRIES = '3';
    process.env.ISL_API_KEY = 'test-key';

    const client = createISLClient();

    expect(client).not.toBeNull();
    expect(client).toBeInstanceOf(ISLClient);
  });
});
