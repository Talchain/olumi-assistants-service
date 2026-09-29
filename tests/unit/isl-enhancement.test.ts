/**
 * ISL Enhancement Tests
 *
 * Tests for ISL-powered decision review enhancements with graceful degradation.
 * Target: 37 tests covering all ISL endpoints and failure scenarios.
 */

import { describe, it, expect } from 'vitest';
import {
  formatAssumptionWarnings,
  formatActionableAlternatives,
  formatConfidenceStatement,
  formatModelImprovements,
  buildISLEnhancements,
} from '../../src/cee/decision-review/formatters.js';
import type {
  ISLSensitivityResponse,
  ISLContrastiveResponse,
  ISLConformalResponse,
  ISLValidationStrategiesResponse,
} from '../../src/adapters/isl/types.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockSensitivityResponse(
  overrides?: Partial<ISLSensitivityResponse>,
): ISLSensitivityResponse {
  return {
    sensitivities: [
      {
        node_id: 'node_1',
        sensitivity_score: 0.75,
        classification: 'high',
        contributing_factors: [
          { type: 'evidence_gap', impact: 0.4, description: 'Missing market data' },
          { type: 'assumption_chain', impact: 0.3, description: 'Cascading assumptions' },
        ],
        affected_paths: ['path_a', 'path_b'],
      },
      {
        node_id: 'node_2',
        sensitivity_score: 0.3,
        classification: 'low',
        contributing_factors: [
          { type: 'stable_evidence', impact: 0.1, description: 'Well-supported' },
        ],
      },
    ],
    summary: {
      avg_sensitivity: 0.525,
      high_sensitivity_count: 1,
      most_critical_node: 'node_1',
    },
    request_id: 'test-req-1',
    latency_ms: 150,
    ...overrides,
  };
}

function createMockContrastiveResponse(
  overrides?: Partial<ISLContrastiveResponse>,
): ISLContrastiveResponse {
  return {
    decision_node_id: 'decision_1',
    contrasts: [
      {
        type: 'evidence',
        node_id: 'evidence_1',
        actual_reason: 'Strong market research supports this',
        alternative_condition: 'Would need contrary evidence',
        confidence: 0.85,
        counterfactual: {
          change: 'Increase marketing budget by 20%',
          predicted_impact: 'improve conversion rate by 15%',
        },
      },
      {
        type: 'assumption',
        node_id: 'assumption_1',
        actual_reason: 'Assumes stable market conditions',
        alternative_condition: 'Market volatility increases',
        confidence: 0.6,
      },
    ],
    summary: {
      explanation: 'Decision based primarily on market research',
      key_factors: ['market_data', 'competitor_analysis'],
    },
    request_id: 'test-req-2',
    latency_ms: 200,
    ...overrides,
  };
}

function createMockConformalResponse(
  overrides?: Partial<ISLConformalResponse>,
): ISLConformalResponse {
  return {
    intervals: [
      {
        node_id: 'outcome_1',
        point_estimate: 100,
        lower_bound: 80,
        upper_bound: 120,
        confidence_level: 0.9,
        interval_width: 40,
        well_calibrated: true,
        width_factors: [
          { factor: 'market_uncertainty', contribution: 0.6 },
          { factor: 'data_quality', contribution: 0.4 },
        ],
      },
    ],
    calibration: {
      score: 0.85,
      is_reliable: true,
    },
    request_id: 'test-req-3',
    latency_ms: 180,
    ...overrides,
  };
}

function createMockValidationResponse(
  overrides?: Partial<ISLValidationStrategiesResponse>,
): ISLValidationStrategiesResponse {
  return {
    strategies: [
      {
        id: 'strat_1',
        title: 'Gather additional market data',
        description: 'Conduct customer surveys to validate assumptions',
        priority: 'high',
        effort: 'moderate',
        expected_impact: 0.75,
        target_nodes: ['assumption_1', 'evidence_1'],
        actions: [
          { action: 'Design customer survey', type: 'gather_data' },
          { action: 'Analyze results', type: 'expert_review' },
        ],
        success_criteria: 'Survey response rate > 30%',
      },
      {
        id: 'strat_2',
        title: 'Run sensitivity analysis',
        description: 'Test key assumptions under different scenarios',
        priority: 'medium',
        effort: 'minimal',
        expected_impact: 0.5,
        target_nodes: ['assumption_1'],
        actions: [{ action: 'Run scenario tests', type: 'sensitivity_test' }],
        success_criteria: 'All scenarios analyzed',
      },
    ],
    coverage: {
      node_coverage: 0.7,
      risk_coverage: 0.85,
    },
    request_id: 'test-req-4',
    latency_ms: 120,
    ...overrides,
  };
}

// ============================================================================
// formatAssumptionWarnings Tests
// ============================================================================

describe('formatAssumptionWarnings', () => {
  it('returns undefined for null input', () => {
    expect(formatAssumptionWarnings(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(formatAssumptionWarnings(undefined)).toBeUndefined();
  });

  it('returns undefined for empty sensitivities', () => {
    const response = createMockSensitivityResponse({
      sensitivities: [],
    });
    expect(formatAssumptionWarnings(response)).toBeUndefined();
  });

  it('filters out low sensitivity nodes (< 0.5)', () => {
    const response = createMockSensitivityResponse();
    const warnings = formatAssumptionWarnings(response);
    expect(warnings).toHaveLength(1);
    expect(warnings![0].variable).toBe('node_1');
  });

  it('includes variable name from node_id', () => {
    const response = createMockSensitivityResponse();
    const warnings = formatAssumptionWarnings(response);
    expect(warnings![0].variable).toBe('node_1');
  });

  it('includes sensitivity score', () => {
    const response = createMockSensitivityResponse();
    const warnings = formatAssumptionWarnings(response);
    expect(warnings![0].sensitivity).toBe(0.75);
  });

  it('combines contributing factors into impact string', () => {
    const response = createMockSensitivityResponse();
    const warnings = formatAssumptionWarnings(response);
    expect(warnings![0].impact).toContain('Missing market data');
    expect(warnings![0].impact).toContain('Cascading assumptions');
  });

  it('generates plain English for high sensitivity (>= 0.8)', () => {
    const response = createMockSensitivityResponse({
      sensitivities: [
        {
          node_id: 'critical_node',
          sensitivity_score: 0.85,
          classification: 'high',
          contributing_factors: [{ type: 'test', impact: 0.5, description: 'Critical factor' }],
        },
      ],
    });
    const warnings = formatAssumptionWarnings(response);
    expect(warnings![0].plain_english).toContain('critical');
    expect(warnings![0].plain_english).toContain('significantly alter');
  });

  it('generates plain English for medium/high sensitivity (0.5-0.8)', () => {
    const response = createMockSensitivityResponse();
    const warnings = formatAssumptionWarnings(response);
    // Score 0.75 is "high" classification
    expect(warnings![0].plain_english).toContain('sensitive');
    expect(warnings![0].plain_english).toContain('Consider validating');
  });
});

// ============================================================================
// formatActionableAlternatives Tests
// ============================================================================

describe('formatActionableAlternatives', () => {
  it('returns undefined for null input', () => {
    expect(formatActionableAlternatives(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(formatActionableAlternatives(undefined)).toBeUndefined();
  });

  it('returns undefined for empty contrasts', () => {
    const response = createMockContrastiveResponse({ contrasts: [] });
    expect(formatActionableAlternatives(response)).toBeUndefined();
  });

  it('filters out contrasts without counterfactuals', () => {
    const response = createMockContrastiveResponse();
    const alternatives = formatActionableAlternatives(response);
    expect(alternatives).toHaveLength(1); // Only one has counterfactual
  });

  it('includes change from counterfactual', () => {
    const response = createMockContrastiveResponse();
    const alternatives = formatActionableAlternatives(response);
    expect(alternatives![0].change).toBe('Increase marketing budget by 20%');
  });

  it('includes outcome_diff from predicted_impact', () => {
    const response = createMockContrastiveResponse();
    const alternatives = formatActionableAlternatives(response);
    expect(alternatives![0].outcome_diff).toBe('improve conversion rate by 15%');
  });

  it('includes feasibility from confidence', () => {
    const response = createMockContrastiveResponse();
    const alternatives = formatActionableAlternatives(response);
    expect(alternatives![0].feasibility).toBe(0.85);
  });

  it('generates plain English with feasibility assessment', () => {
    const response = createMockContrastiveResponse();
    const alternatives = formatActionableAlternatives(response);
    expect(alternatives![0].plain_english).toContain('Consider');
    expect(alternatives![0].plain_english).toContain('feasible');
  });
});

// ============================================================================
// formatConfidenceStatement Tests
// ============================================================================

describe('formatConfidenceStatement', () => {
  it('returns undefined for null input', () => {
    expect(formatConfidenceStatement(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(formatConfidenceStatement(undefined)).toBeUndefined();
  });

  it('returns undefined for empty intervals', () => {
    const response = createMockConformalResponse({ intervals: [] });
    expect(formatConfidenceStatement(response)).toBeUndefined();
  });

  it('uses first interval as primary statement', () => {
    const response = createMockConformalResponse();
    const statement = formatConfidenceStatement(response);
    expect(statement!.prediction_interval).toEqual([80, 120]);
  });

  it('includes confidence level', () => {
    const response = createMockConformalResponse();
    const statement = formatConfidenceStatement(response);
    expect(statement!.confidence_level).toBe(0.9);
  });

  it('combines width factors into uncertainty source', () => {
    const response = createMockConformalResponse();
    const statement = formatConfidenceStatement(response);
    expect(statement!.uncertainty_source).toContain('market_uncertainty');
    expect(statement!.uncertainty_source).toContain('data_quality');
  });

  it('generates plain English with percentage confidence', () => {
    const response = createMockConformalResponse();
    const statement = formatConfidenceStatement(response);
    expect(statement!.plain_english).toContain('90%');
    expect(statement!.plain_english).toContain('80.00');
    expect(statement!.plain_english).toContain('120.00');
  });
});

// ============================================================================
// formatModelImprovements Tests
// ============================================================================

describe('formatModelImprovements', () => {
  it('returns undefined for null input', () => {
    expect(formatModelImprovements(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(formatModelImprovements(undefined)).toBeUndefined();
  });

  it('returns undefined for empty strategies', () => {
    const response = createMockValidationResponse({ strategies: [] });
    expect(formatModelImprovements(response)).toBeUndefined();
  });

  it('includes type from first action', () => {
    const response = createMockValidationResponse();
    const improvements = formatModelImprovements(response);
    expect(improvements![0].type).toBe('gather_data');
  });

  it('includes description', () => {
    const response = createMockValidationResponse();
    const improvements = formatModelImprovements(response);
    expect(improvements![0].description).toBe('Conduct customer surveys to validate assumptions');
  });

  it('maps critical priority to high', () => {
    const response = createMockValidationResponse({
      strategies: [
        {
          ...createMockValidationResponse().strategies[0],
          priority: 'critical',
        },
      ],
    });
    const improvements = formatModelImprovements(response);
    expect(improvements![0].priority).toBe('high');
  });

  it('preserves other priority levels', () => {
    const response = createMockValidationResponse();
    const improvements = formatModelImprovements(response);
    expect(improvements![0].priority).toBe('high');
    expect(improvements![1].priority).toBe('medium');
  });

  it('generates plain English with priority label', () => {
    const response = createMockValidationResponse();
    const improvements = formatModelImprovements(response);
    expect(improvements![0].plain_english).toContain('[HIGH]');
    expect(improvements![0].plain_english).toContain('Gather additional market data');
  });
});

// ============================================================================
// buildISLEnhancements Tests
// ============================================================================

describe('buildISLEnhancements', () => {
  it('returns isl_available: false when all inputs are null', () => {
    const enhancements = buildISLEnhancements(null, null, null, null);
    expect(enhancements.isl_available).toBe(false);
    expect(enhancements.isl_endpoints_used).toHaveLength(0);
  });

  it('returns isl_available: true when any endpoint has data', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      null,
      null,
      null,
    );
    expect(enhancements.isl_available).toBe(true);
  });

  it('tracks sensitivity endpoint in isl_endpoints_used', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      null,
      null,
      null,
    );
    expect(enhancements.isl_endpoints_used).toContain('sensitivity');
  });

  it('tracks contrastive endpoint in isl_endpoints_used', () => {
    const enhancements = buildISLEnhancements(
      null,
      createMockContrastiveResponse(),
      null,
      null,
    );
    expect(enhancements.isl_endpoints_used).toContain('contrastive');
  });

  it('tracks conformal endpoint in isl_endpoints_used', () => {
    const enhancements = buildISLEnhancements(
      null,
      null,
      createMockConformalResponse(),
      null,
    );
    expect(enhancements.isl_endpoints_used).toContain('conformal');
  });

  it('tracks validation endpoint in isl_endpoints_used', () => {
    const enhancements = buildISLEnhancements(
      null,
      null,
      null,
      createMockValidationResponse(),
    );
    expect(enhancements.isl_endpoints_used).toContain('validation');
  });

  it('tracks all endpoints when all succeed', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      createMockContrastiveResponse(),
      createMockConformalResponse(),
      createMockValidationResponse(),
    );
    expect(enhancements.isl_endpoints_used).toHaveLength(4);
    expect(enhancements.isl_endpoints_used).toContain('sensitivity');
    expect(enhancements.isl_endpoints_used).toContain('contrastive');
    expect(enhancements.isl_endpoints_used).toContain('conformal');
    expect(enhancements.isl_endpoints_used).toContain('validation');
  });

  it('includes assumption_warnings when sensitivity succeeds', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      null,
      null,
      null,
    );
    expect(enhancements.assumption_warnings).toBeDefined();
    expect(enhancements.assumption_warnings!.length).toBeGreaterThan(0);
  });

  it('includes actionable_alternatives when contrastive succeeds', () => {
    const enhancements = buildISLEnhancements(
      null,
      createMockContrastiveResponse(),
      null,
      null,
    );
    expect(enhancements.actionable_alternatives).toBeDefined();
    expect(enhancements.actionable_alternatives!.length).toBeGreaterThan(0);
  });

  it('includes confidence_statement when conformal succeeds', () => {
    const enhancements = buildISLEnhancements(
      null,
      null,
      createMockConformalResponse(),
      null,
    );
    expect(enhancements.confidence_statement).toBeDefined();
  });

  it('includes model_improvements when validation succeeds', () => {
    const enhancements = buildISLEnhancements(
      null,
      null,
      null,
      createMockValidationResponse(),
    );
    expect(enhancements.model_improvements).toBeDefined();
    expect(enhancements.model_improvements!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Graceful Degradation Tests
// ============================================================================

describe('Graceful Degradation', () => {
  it('continues when sensitivity fails', () => {
    const enhancements = buildISLEnhancements(
      null, // sensitivity failed
      createMockContrastiveResponse(),
      createMockConformalResponse(),
      createMockValidationResponse(),
    );
    expect(enhancements.isl_available).toBe(true);
    expect(enhancements.isl_endpoints_used).not.toContain('sensitivity');
    expect(enhancements.isl_endpoints_used).toContain('contrastive');
  });

  it('continues when contrastive fails', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      null, // contrastive failed
      createMockConformalResponse(),
      createMockValidationResponse(),
    );
    expect(enhancements.isl_available).toBe(true);
    expect(enhancements.isl_endpoints_used).not.toContain('contrastive');
    expect(enhancements.isl_endpoints_used).toContain('sensitivity');
  });

  it('continues when conformal fails', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      createMockContrastiveResponse(),
      null, // conformal failed
      createMockValidationResponse(),
    );
    expect(enhancements.isl_available).toBe(true);
    expect(enhancements.isl_endpoints_used).not.toContain('conformal');
    expect(enhancements.isl_endpoints_used).toContain('sensitivity');
  });

  it('continues when validation fails', () => {
    const enhancements = buildISLEnhancements(
      createMockSensitivityResponse(),
      createMockContrastiveResponse(),
      createMockConformalResponse(),
      null, // validation failed
    );
    expect(enhancements.isl_available).toBe(true);
    expect(enhancements.isl_endpoints_used).not.toContain('validation');
    expect(enhancements.isl_endpoints_used).toContain('sensitivity');
  });

  it('continues when multiple endpoints fail', () => {
    const enhancements = buildISLEnhancements(
      null, // sensitivity failed
      null, // contrastive failed
      createMockConformalResponse(),
      createMockValidationResponse(),
    );
    expect(enhancements.isl_available).toBe(true);
    expect(enhancements.isl_endpoints_used).toHaveLength(2);
  });
});
