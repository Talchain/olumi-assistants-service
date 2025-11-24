/**
 * Causal Enrichment Unit Tests
 *
 * Tests for bias finding enrichment with ISL causal validation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { enrichBiasFindings, causalValidationEnabled } from '../../src/cee/bias/causal-enrichment.js';
import type { components } from '../../src/generated/openapi.d.ts';
import type { GraphV1 } from '../../src/contracts/plot/engine.js';

type CEEBiasFindingV1 = components['schemas']['CEEBiasFindingV1'];

describe('causalValidationEnabled', () => {
  beforeEach(() => {
    delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
  });

  it('should return false when flag is undefined', () => {
    expect(causalValidationEnabled()).toBe(false);
  });

  it('should return true when flag is "true"', () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    expect(causalValidationEnabled()).toBe(true);
  });

  it('should return true when flag is "1"', () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = '1';
    expect(causalValidationEnabled()).toBe(true);
  });

  it('should return false when flag is "false"', () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'false';
    expect(causalValidationEnabled()).toBe(false);
  });

  it('should return false when flag is "0"', () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = '0';
    expect(causalValidationEnabled()).toBe(false);
  });
});

describe('enrichBiasFindings', () => {
  let mockGraph: GraphV1;
  let mockFindings: CEEBiasFindingV1[];

  beforeEach(() => {
    delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
    delete process.env.ISL_BASE_URL;

    mockGraph = {
      version: '1',
      default_seed: 17,
      nodes: [
        { id: 'goal1', kind: 'goal', label: 'Main Goal' } as any,
        { id: 'evidence1', kind: 'evidence', label: 'Evidence 1' } as any,
      ],
      edges: [
        { id: 'e1', source: 'evidence1', target: 'goal1' } as any,
      ],
      meta: {
        roots: [],
        leaves: [],
        suggested_positions: {},
        source: 'fixtures' as const,
      },
    };

    mockFindings = [
      {
        id: 'CONFIRMATION_BIAS',
        code: 'CONFIRMATION_BIAS',
        category: 'selection',
        severity: 'high',
        explanation: 'Evidence may be selectively chosen',
        targets: {
          node_ids: ['evidence1'],
        },
      } as CEEBiasFindingV1,
    ];

    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return unenriched findings when feature flag is disabled', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'false';

    const result = await enrichBiasFindings(mockGraph, mockFindings);

    expect(result).toEqual(mockFindings);
    expect(result[0]).not.toHaveProperty('causal_validation');
    expect(result[0]).not.toHaveProperty('evidence_strength');
  });

  it('should return empty array when no findings provided', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';

    const result = await enrichBiasFindings(mockGraph, []);

    expect(result).toEqual([]);
  });

  it('should return unenriched findings when ISL client not configured', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    // ISL_BASE_URL not set

    const result = await enrichBiasFindings(mockGraph, mockFindings);

    expect(result).toEqual(mockFindings);
    expect(result[0]).not.toHaveProperty('causal_validation');
  });

  it('should enrich findings with causal validation when enabled', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';

    const mockValidation = {
      identifiable: true,
      strength: 0.75,
      confidence: 'high' as const,
      details: {
        affected_paths: ['evidence1 -> goal1'],
        counterfactual_delta: {
          metric: 'outcome_range',
          change_percent: 25,
        },
      },
    };

    const mockEvidenceStrength = [
      {
        node_id: 'evidence1',
        causal_support: 'moderate' as const,
        reasoning: 'Some causal support observed',
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        validations: [
          {
            bias_code: 'CONFIRMATION_BIAS',
            causal_validation: mockValidation,
            evidence_strength: mockEvidenceStrength,
          },
        ],
        request_id: 'req-123',
        latency_ms: 150,
      }),
    });

    const result = await enrichBiasFindings(mockGraph, mockFindings);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'CONFIRMATION_BIAS',
      causal_validation: mockValidation,
      evidence_strength: mockEvidenceStrength,
    });
  });

  it('should skip findings without canonical codes', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';

    const findingsWithoutCode = [
      {
        id: 'UNKNOWN_BIAS',
        category: 'other',
        severity: 'low',
        explanation: 'No code',
      } as CEEBiasFindingV1,
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        validations: [],
        request_id: 'req-123',
        latency_ms: 50,
      }),
    });

    const result = await enrichBiasFindings(mockGraph, findingsWithoutCode);

    expect(result).toEqual(findingsWithoutCode);
    expect(fetch).toHaveBeenCalled();

    const fetchCall = (fetch as any).mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.bias_findings).toEqual([]);
  });

  it('should gracefully handle ISL timeout errors', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';

    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('AbortError');
          error.name = 'AbortError';
          reject(error);
        }, 10);
      });
    });

    const result = await enrichBiasFindings(mockGraph, mockFindings);

    // Should return unenriched findings on timeout (graceful degradation)
    expect(result).toEqual(mockFindings);
    expect(result[0]).not.toHaveProperty('causal_validation');
  });

  it('should gracefully handle ISL validation errors', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';

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

    const result = await enrichBiasFindings(mockGraph, mockFindings);

    // Should return unenriched findings on error (graceful degradation)
    expect(result).toEqual(mockFindings);
    expect(result[0]).not.toHaveProperty('causal_validation');
  });

  it('should extract evidence nodes from graph', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';

    const graphWithMultipleEvidenceTypes = {
      version: '1',
      default_seed: 17,
      nodes: [
        { id: 'goal1', kind: 'goal', label: 'Goal' } as any,
        { id: 'evidence1', kind: 'evidence', label: 'Evidence' } as any,
        { id: 'risk1', kind: 'risk', label: 'Risk' } as any,
        { id: 'outcome1', kind: 'outcome', label: 'Outcome' } as any,
        { id: 'constraint1', kind: 'constraint', label: 'Constraint' } as any,
        { id: 'option1', kind: 'option', label: 'Option' } as any,
      ],
      edges: [],
      meta: {
        roots: [],
        leaves: [],
        suggested_positions: {},
        source: 'fixtures' as const,
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        validations: [],
        request_id: 'req-123',
        latency_ms: 50,
      }),
    });

    await enrichBiasFindings(graphWithMultipleEvidenceTypes, mockFindings);

    const fetchCall = (fetch as any).mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    // Should include evidence, risk, outcome, constraint nodes
    expect(requestBody.validation_config.evidence_nodes).toEqual(
      expect.arrayContaining(['evidence1', 'risk1', 'outcome1', 'constraint1'])
    );
    // Should NOT include option, goal
    expect(requestBody.validation_config.evidence_nodes).not.toContain('option1');
    expect(requestBody.validation_config.evidence_nodes).not.toContain('goal1');
  });
});
