/**
 * Decision Review Service Tests
 *
 * Comprehensive test suite for enhanced decision review with ISL integration
 * and graceful degradation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GraphV1 } from '../../src/contracts/plot/engine.js';

// Schema imports
import {
  NodeKindSchema,
  ISLSensitivityResultSchema,
  ISLContrastiveResultSchema,
  ISLConformalResultSchema,
  ValidationSuggestionSchema,
  ValidationSuggestionsSchema,
  LLMCritiqueSchema,
  EnhancedNodeCritiqueSchema,
  DecisionReviewRequestSchema,
  DecisionReviewResponseSchema,
  ISLAvailabilitySummarySchema,
  createDegradedSensitivity,
  createDegradedContrastive,
  createDegradedConformal,
  createDegradedValidationSuggestions,
  createFullyDegradedAvailability,
} from '../../src/cee/decision-review/schema.js';

// Template imports
import {
  formatSensitivityExplanation,
  formatContrastiveExplanation,
  formatConformalExplanation,
  formatValidationSuggestions,
  formatNodeCritiqueSummary,
  formatDecisionReviewSummary,
  formatISLAvailability,
  formatDegradationNotice,
  explainSeverity,
} from '../../src/cee/decision-review/templates.js';

// Service imports
import {
  executeDecisionReview,
  __resetDecisionReviewCircuitBreakerForTests,
  getDecisionReviewCircuitBreakerStatus,
} from '../../src/cee/decision-review/service.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const createTestGraph = (): GraphV1 => ({
  nodes: [
    { id: 'decision-1', kind: 'decision', label: 'Main Decision' },
    { id: 'option-1', kind: 'option', label: 'Option A' },
    { id: 'option-2', kind: 'option', label: 'Option B' },
    { id: 'evidence-1', kind: 'evidence', label: 'Market Data' },
    { id: 'assumption-1', kind: 'assumption', label: 'Growth Assumption' },
    { id: 'risk-1', kind: 'risk', label: 'Market Risk' },
  ],
  edges: [
    { id: 'e1', source: 'decision-1', target: 'option-1' },
    { id: 'e2', source: 'decision-1', target: 'option-2' },
    { id: 'e3', source: 'evidence-1', target: 'decision-1' },
  ],
} as unknown as GraphV1);

const createMockISLClient = () => ({
  getSensitivityDetailed: vi.fn(),
  getContrastiveExplanation: vi.fn(),
  getConformalPrediction: vi.fn(),
  getValidationStrategies: vi.fn(),
});

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Decision Review Schema Validation', () => {
  describe('NodeKindSchema', () => {
    it('should accept valid node kinds', () => {
      expect(NodeKindSchema.parse('decision')).toBe('decision');
      expect(NodeKindSchema.parse('option')).toBe('option');
      expect(NodeKindSchema.parse('evidence')).toBe('evidence');
      expect(NodeKindSchema.parse('assumption')).toBe('assumption');
      expect(NodeKindSchema.parse('risk')).toBe('risk');
    });

    it('should reject invalid node kinds', () => {
      expect(() => NodeKindSchema.parse('invalid')).toThrow();
    });
  });

  describe('ISLSensitivityResultSchema', () => {
    it('should validate available sensitivity result', () => {
      const result = ISLSensitivityResultSchema.parse({
        available: true,
        score: 0.75,
        classification: 'high',
        factors: ['factor1', 'factor2'],
      });
      expect(result.available).toBe(true);
      expect(result.score).toBe(0.75);
    });

    it('should validate degraded sensitivity result', () => {
      const result = ISLSensitivityResultSchema.parse({
        available: false,
        error: 'ISL timeout',
      });
      expect(result.available).toBe(false);
      expect(result.error).toBe('ISL timeout');
    });

    it('should reject score out of range', () => {
      expect(() =>
        ISLSensitivityResultSchema.parse({
          available: true,
          score: 1.5,
        }),
      ).toThrow();
    });
  });

  describe('ISLContrastiveResultSchema', () => {
    it('should validate available contrastive result', () => {
      const result = ISLContrastiveResultSchema.parse({
        available: true,
        explanation: 'Decision was based on market data',
        keyFactors: ['price', 'volume'],
        counterfactuals: [
          { change: 'lower price', predictedImpact: 'reject option A' },
        ],
      });
      expect(result.available).toBe(true);
      expect(result.keyFactors).toHaveLength(2);
    });

    it('should validate degraded contrastive result', () => {
      const result = ISLContrastiveResultSchema.parse({
        available: false,
        error: 'No decision node found',
      });
      expect(result.available).toBe(false);
    });
  });

  describe('ISLConformalResultSchema', () => {
    it('should validate available conformal result', () => {
      const result = ISLConformalResultSchema.parse({
        available: true,
        interval: { lower: 10.5, upper: 15.5 },
        confidence: 0.9,
        wellCalibrated: true,
      });
      expect(result.interval?.lower).toBe(10.5);
      expect(result.confidence).toBe(0.9);
    });

    it('should reject confidence out of range', () => {
      expect(() =>
        ISLConformalResultSchema.parse({
          available: true,
          confidence: 1.5,
        }),
      ).toThrow();
    });
  });

  describe('ValidationSuggestionSchema', () => {
    it('should validate a complete validation suggestion', () => {
      const suggestion = ValidationSuggestionSchema.parse({
        id: 'vs-1',
        title: 'Gather additional evidence',
        description: 'Collect more market data',
        priority: 'high',
        effort: 'moderate',
        expectedImpact: 0.8,
        actions: ['Review reports', 'Interview experts'],
      });
      expect(suggestion.priority).toBe('high');
      expect(suggestion.actions).toHaveLength(2);
    });
  });

  describe('EnhancedNodeCritiqueSchema', () => {
    it('should validate a complete node critique', () => {
      const critique = EnhancedNodeCritiqueSchema.parse({
        nodeId: 'node-1',
        kind: 'decision',
        title: 'Main Decision',
        critique: {
          summary: 'Well-structured decision',
          concerns: ['Limited evidence'],
          suggestions: ['Gather more data'],
        },
        severity: 'medium',
        confidence: 0.85,
      });
      expect(critique.severity).toBe('medium');
      expect(critique.critique.concerns).toHaveLength(1);
    });

    it('should validate critique with ISL analysis', () => {
      const critique = EnhancedNodeCritiqueSchema.parse({
        nodeId: 'node-1',
        kind: 'decision',
        title: 'Main Decision',
        critique: {
          summary: 'Analysis complete',
          concerns: [],
          suggestions: [],
        },
        islAnalysis: {
          sensitivity: {
            available: true,
            score: 0.6,
            classification: 'medium',
          },
        },
        severity: 'info',
        confidence: 0.9,
      });
      expect(critique.islAnalysis?.sensitivity?.score).toBe(0.6);
    });
  });

  describe('DecisionReviewRequestSchema', () => {
    it('should validate minimal request', () => {
      const request = DecisionReviewRequestSchema.parse({});
      expect(request).toBeDefined();
    });

    it('should validate request with all options', () => {
      const request = DecisionReviewRequestSchema.parse({
        correlationId: 'corr-123',
        targetNodes: ['node-1', 'node-2'],
        config: {
          enableSensitivity: true,
          enableContrastive: false,
          maxNodes: 10,
        },
      });
      expect(request.targetNodes).toHaveLength(2);
      expect(request.config?.maxNodes).toBe(10);
    });
  });

  describe('ISLAvailabilitySummarySchema', () => {
    it('should validate full availability', () => {
      const summary = ISLAvailabilitySummarySchema.parse({
        serviceAvailable: true,
        sensitivitySuccessCount: 5,
        contrastiveSuccessCount: 1,
        conformalSuccessCount: 0,
        validationStrategiesAvailable: true,
      });
      expect(summary.serviceAvailable).toBe(true);
    });

    it('should validate degraded availability', () => {
      const summary = ISLAvailabilitySummarySchema.parse({
        serviceAvailable: false,
        sensitivitySuccessCount: 0,
        contrastiveSuccessCount: 0,
        conformalSuccessCount: 0,
        validationStrategiesAvailable: false,
        degradationReason: 'ISL service unavailable',
      });
      expect(summary.degradationReason).toContain('unavailable');
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Graceful Degradation Factory Functions', () => {
  it('createDegradedSensitivity should create degraded result', () => {
    const result = createDegradedSensitivity('timeout');
    expect(result.available).toBe(false);
    expect(result.error).toBe('timeout');
  });

  it('createDegradedSensitivity should use default message', () => {
    const result = createDegradedSensitivity();
    expect(result.error).toContain('unavailable');
  });

  it('createDegradedContrastive should create degraded result', () => {
    const result = createDegradedContrastive('no decision node');
    expect(result.available).toBe(false);
    expect(result.error).toBe('no decision node');
  });

  it('createDegradedConformal should create degraded result', () => {
    const result = createDegradedConformal();
    expect(result.available).toBe(false);
    expect(result.error).toContain('unavailable');
  });

  it('createDegradedValidationSuggestions should create degraded result', () => {
    const result = createDegradedValidationSuggestions('service error');
    expect(result.available).toBe(false);
    expect(result.error).toBe('service error');
  });

  it('createFullyDegradedAvailability should set all fields', () => {
    const result = createFullyDegradedAvailability('ISL offline');
    expect(result.serviceAvailable).toBe(false);
    expect(result.sensitivitySuccessCount).toBe(0);
    expect(result.contrastiveSuccessCount).toBe(0);
    expect(result.conformalSuccessCount).toBe(0);
    expect(result.validationStrategiesAvailable).toBe(false);
    expect(result.degradationReason).toBe('ISL offline');
  });
});

// ============================================================================
// Template Tests
// ============================================================================

describe('Plain-English Template Functions', () => {
  describe('formatSensitivityExplanation', () => {
    it('should format high sensitivity', () => {
      const explanation = formatSensitivityExplanation(
        { available: true, score: 0.85, classification: 'high', factors: ['evidence gap'] },
        'Main Decision',
      );
      expect(explanation).toContain('highly sensitive');
      expect(explanation).toContain('85%');
      expect(explanation).toContain('evidence gap');
    });

    it('should format medium sensitivity', () => {
      const explanation = formatSensitivityExplanation(
        { available: true, score: 0.55, classification: 'medium' },
        'Option A',
      );
      expect(explanation).toContain('moderate sensitivity');
    });

    it('should format low sensitivity', () => {
      const explanation = formatSensitivityExplanation(
        { available: true, score: 0.2, classification: 'low' },
        'Evidence Node',
      );
      expect(explanation).toContain('low sensitivity');
      expect(explanation).toContain('stable');
    });

    it('should format degraded result', () => {
      const explanation = formatSensitivityExplanation(
        { available: false, error: 'timeout' },
        'Node X',
      );
      expect(explanation).toContain('unavailable');
      expect(explanation).toContain('timeout');
    });
  });

  describe('formatContrastiveExplanation', () => {
    it('should format available result with counterfactuals', () => {
      const explanation = formatContrastiveExplanation(
        {
          available: true,
          explanation: 'Based on market data',
          keyFactors: ['price', 'demand'],
          counterfactuals: [{ change: 'higher price', predictedImpact: 'reject' }],
        },
        'Decision X',
      );
      expect(explanation).toContain('market data');
      expect(explanation).toContain('price, demand');
      expect(explanation).toContain('higher price');
    });

    it('should format degraded result', () => {
      const explanation = formatContrastiveExplanation(
        { available: false, error: 'no decision node' },
        'Node Y',
      );
      expect(explanation).toContain('unavailable');
    });
  });

  describe('formatConformalExplanation', () => {
    it('should format available result', () => {
      const explanation = formatConformalExplanation(
        {
          available: true,
          interval: { lower: 10, upper: 20 },
          confidence: 0.9,
          wellCalibrated: true,
        },
        'Prediction Node',
      );
      expect(explanation).toContain('10.00');
      expect(explanation).toContain('20.00');
      expect(explanation).toContain('90%');
      expect(explanation).toContain('well-calibrated');
    });

    it('should warn about poor calibration', () => {
      const explanation = formatConformalExplanation(
        {
          available: true,
          interval: { lower: 5, upper: 25 },
          confidence: 0.8,
          wellCalibrated: false,
        },
        'Node Z',
      );
      expect(explanation).toContain('less reliable');
    });
  });

  describe('formatValidationSuggestions', () => {
    it('should format available strategies', () => {
      const formatted = formatValidationSuggestions({
        available: true,
        strategies: [
          {
            id: 'vs-1',
            title: 'Gather Data',
            description: 'Collect more evidence',
            priority: 'high',
            effort: 'moderate',
            expectedImpact: 0.8,
            actions: ['Review', 'Interview'],
          },
        ],
        coverage: { nodeCoverage: 0.8, riskCoverage: 0.9 },
      });
      expect(formatted).toContain('Gather Data');
      expect(formatted).toContain('HIGH');
      expect(formatted).toContain('80%');
    });

    it('should format degraded result', () => {
      const formatted = formatValidationSuggestions({
        available: false,
        error: 'service unavailable',
      });
      expect(formatted).toContain('unavailable');
    });
  });

  describe('formatISLAvailability', () => {
    it('should format full availability', () => {
      const formatted = formatISLAvailability({
        serviceAvailable: true,
        sensitivitySuccessCount: 5,
        contrastiveSuccessCount: 1,
        conformalSuccessCount: 0,
        validationStrategiesAvailable: true,
      });
      expect(formatted).toContain('✓');
      expect(formatted).toContain('sensitivity');
      expect(formatted).toContain('5 nodes');
    });

    it('should format degraded availability', () => {
      const formatted = formatISLAvailability({
        serviceAvailable: false,
        sensitivitySuccessCount: 0,
        contrastiveSuccessCount: 0,
        conformalSuccessCount: 0,
        validationStrategiesAvailable: false,
        degradationReason: 'Circuit breaker open',
      });
      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('Circuit breaker');
    });
  });

  describe('explainSeverity', () => {
    it('should explain critical severity', () => {
      expect(explainSeverity('critical')).toContain('immediate attention');
    });

    it('should explain high severity', () => {
      expect(explainSeverity('high')).toContain('significant concern');
    });

    it('should explain medium severity', () => {
      expect(explainSeverity('medium')).toContain('notable concern');
    });

    it('should explain low severity', () => {
      expect(explainSeverity('low')).toContain('minor');
    });

    it('should explain info severity', () => {
      expect(explainSeverity('info')).toContain('informational');
    });
  });

  describe('formatDegradationNotice', () => {
    it('should create a clear degradation notice', () => {
      const notice = formatDegradationNotice('ISL service timeout');
      expect(notice).toContain('Note');
      expect(notice).toContain('ISL service timeout');
      expect(notice).toContain('LLM-based critique');
    });
  });
});

// ============================================================================
// Service Tests
// ============================================================================

describe('Decision Review Service', () => {
  beforeEach(() => {
    __resetDecisionReviewCircuitBreakerForTests();
    vi.clearAllMocks();
  });

  describe('executeDecisionReview - ISL Disabled (null client)', () => {
    it('should return LLM-only critiques when ISL client is null', async () => {
      const graph = createTestGraph();

      // Pass null ISL client to simulate disabled ISL
      const result = await executeDecisionReview(graph, {}, { islClient: null });

      expect(result.critiques).toBeDefined();
      expect(result.critiques.length).toBeGreaterThan(0);
      expect(result.islAvailability.serviceAvailable).toBe(false);
      expect(result.trace.requestId).toBeDefined();
    });

    it('should respect targetNodes filter', async () => {
      const graph = createTestGraph();

      const result = await executeDecisionReview(
        graph,
        { targetNodes: ['decision-1', 'option-1'] },
        { islClient: null },
      );

      // Should only analyze the specified nodes
      expect(result.critiques.length).toBeLessThanOrEqual(2);
      expect(result.critiques.some((c) => c.nodeId === 'decision-1')).toBe(true);
    });

    it('should respect maxNodes config', async () => {
      const graph = createTestGraph();

      const result = await executeDecisionReview(
        graph,
        { config: { maxNodes: 2 } },
        { islClient: null },
      );

      expect(result.critiques.length).toBeLessThanOrEqual(2);
    });

    it('should include correlation ID in trace', async () => {
      const graph = createTestGraph();
      const correlationId = 'test-corr-123';

      const result = await executeDecisionReview(
        graph,
        { correlationId },
        { islClient: null },
      );

      expect(result.trace.correlationId).toBe(correlationId);
    });

    it('should map node kinds correctly', async () => {
      const graph = createTestGraph();

      const result = await executeDecisionReview(graph, {}, { islClient: null });

      const decisionCritique = result.critiques.find((c) => c.nodeId === 'decision-1');
      expect(decisionCritique?.kind).toBe('decision');
    });

    it('should generate request IDs', async () => {
      const graph = createTestGraph();

      const result = await executeDecisionReview(graph, {}, { islClient: null });

      expect(result.trace.requestId).toMatch(/^dr_/);
    });

    it('should build summary correctly', async () => {
      const graph = createTestGraph();

      const result = await executeDecisionReview(graph, {}, { islClient: null });

      expect(result.summary.nodesAnalyzed).toBeGreaterThan(0);
      expect(result.summary.bySeverity).toBeDefined();
      expect(result.summary.bySeverity.info).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Circuit Breaker', () => {
    it('should start with closed circuit', () => {
      const status = getDecisionReviewCircuitBreakerStatus();
      expect(status.state).toBe('closed');
      expect(status.consecutive_failures).toBe(0);
    });

    it('should reset circuit breaker for tests', () => {
      __resetDecisionReviewCircuitBreakerForTests();
      const status = getDecisionReviewCircuitBreakerStatus();
      expect(status.state).toBe('closed');
    });
  });
});

// ============================================================================
// Response Schema Validation Tests
// ============================================================================

describe('DecisionReviewResponseSchema', () => {
  it('should validate a complete response', () => {
    const response = DecisionReviewResponseSchema.parse({
      critiques: [
        {
          nodeId: 'node-1',
          kind: 'decision',
          title: 'Main Decision',
          critique: { summary: 'OK', concerns: [], suggestions: [] },
          severity: 'info',
          confidence: 0.9,
        },
      ],
      islAvailability: {
        serviceAvailable: true,
        sensitivitySuccessCount: 1,
        contrastiveSuccessCount: 1,
        conformalSuccessCount: 0,
        validationStrategiesAvailable: true,
      },
      summary: {
        nodesAnalyzed: 1,
        bySeverity: { info: 1, low: 0, medium: 0, high: 0, critical: 0 },
        topConcerns: [],
        priorityStrategies: [],
      },
      trace: {
        requestId: 'req-123',
        latencyMs: 100,
      },
    });
    expect(response.critiques).toHaveLength(1);
    expect(response.summary.nodesAnalyzed).toBe(1);
  });
});

// ============================================================================
// Template Integration Tests
// ============================================================================

describe('formatNodeCritiqueSummary', () => {
  it('should format a complete critique summary', () => {
    const summary = formatNodeCritiqueSummary({
      nodeId: 'node-1',
      kind: 'decision',
      title: 'Main Decision',
      critique: {
        summary: 'Well-structured decision',
        concerns: ['Limited evidence', 'Assumption risk'],
        suggestions: ['Gather more data'],
      },
      islAnalysis: {
        sensitivity: {
          available: true,
          score: 0.7,
          classification: 'medium',
          factors: ['evidence gap'],
        },
      },
      severity: 'medium',
      confidence: 0.85,
    });

    expect(summary).toContain('Main Decision');
    expect(summary).toContain('MEDIUM');
    expect(summary).toContain('Well-structured');
    expect(summary).toContain('Limited evidence');
    expect(summary).toContain('Causal Analysis');
  });
});

describe('formatDecisionReviewSummary', () => {
  it('should format a complete review summary', () => {
    const summary = formatDecisionReviewSummary({
      critiques: [
        {
          nodeId: 'node-1',
          kind: 'decision',
          title: 'Main Decision',
          critique: {
            summary: 'OK',
            concerns: ['Risk identified'],
            suggestions: [],
          },
          severity: 'high',
          confidence: 0.8,
        },
      ],
      islAvailability: {
        serviceAvailable: true,
        sensitivitySuccessCount: 1,
        contrastiveSuccessCount: 0,
        conformalSuccessCount: 0,
        validationStrategiesAvailable: false,
      },
      summary: {
        nodesAnalyzed: 1,
        bySeverity: { info: 0, low: 0, medium: 0, high: 1, critical: 0 },
        topConcerns: ['Risk identified'],
        priorityStrategies: [],
      },
      trace: {
        requestId: 'req-456',
        latencyMs: 150,
      },
    });

    expect(summary).toContain('Decision Review Summary');
    expect(summary).toContain('1 high');
    expect(summary).toContain('Risk identified');
    expect(summary).toContain('req-456');
  });
});
