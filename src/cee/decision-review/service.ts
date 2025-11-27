/**
 * Decision Review Service
 *
 * Provides enhanced decision review by combining LLM critique with ISL
 * analysis. Uses Promise.allSettled() for parallel ISL calls with graceful
 * degradation when ISL is unavailable or times out.
 */

import type { GraphV1 } from '../../contracts/plot/engine.js';
import {
  ISLClient,
  ISLTimeoutError,
  ISLValidationError,
  createISLClient,
} from '../../adapters/isl/index.js';
import type {
  ISLSensitivityRequest,
  ISLSensitivityResponse,
  ISLContrastiveRequest,
  ISLContrastiveResponse,
  ISLConformalRequest,
  ISLConformalResponse,
  ISLValidationStrategiesRequest,
  ISLValidationStrategiesResponse,
  NodeSensitivity,
  ContrastPoint,
  PredictionInterval,
  ValidationStrategy,
} from '../../adapters/isl/types.js';
import { causalValidationEnabled } from '../../adapters/isl/config.js';
import { logger } from '../../utils/simple-logger.js';
import type {
  DecisionReviewResponse,
  EnhancedNodeCritique,
  ISLAnalysis,
  ISLSensitivityResult,
  ISLContrastiveResult,
  ISLConformalResult,
  ISLAvailabilitySummary,
  ValidationSuggestions,
  NodeKind,
} from './schema.js';
import {
  createDegradedSensitivity,
  createDegradedContrastive,
  createDegradedConformal,
  createDegradedValidationSuggestions,
  createFullyDegradedAvailability,
} from './schema.js';

// ============================================================================
// Service Request/Config Types
// ============================================================================

/**
 * Configuration options for decision review
 */
interface ReviewConfig {
  enableSensitivity?: boolean;
  enableContrastive?: boolean;
  enableConformal?: boolean;
  enableValidationStrategies?: boolean;
  islTimeoutMs?: number;
  maxNodes?: number;
}

/**
 * Request for decision review service
 */
export interface ServiceDecisionReviewRequest {
  correlationId?: string;
  targetNodes?: string[];
  config?: ReviewConfig;
}

// ============================================================================
// Circuit Breaker (Shared State)
// ============================================================================

interface CircuitBreakerState {
  consecutiveFailures: number;
  pausedUntil: number | null;
  lastFailureTime: number;
}

const circuitBreaker: CircuitBreakerState = {
  consecutiveFailures: 0,
  pausedUntil: null,
  lastFailureTime: 0,
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 90000;
const CIRCUIT_BREAKER_RESET_MS = 60000;

function isCircuitBreakerOpen(): boolean {
  if (circuitBreaker.pausedUntil === null) {
    return false;
  }

  const now = Date.now();
  if (now < circuitBreaker.pausedUntil) {
    return true;
  }

  logger.info({
    event: 'decision_review.circuit_breaker.closed',
    pause_duration_ms: CIRCUIT_BREAKER_PAUSE_MS,
  });
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.pausedUntil = null;
  return false;
}

function recordIslSuccess(): void {
  if (circuitBreaker.consecutiveFailures > 0) {
    logger.info({
      event: 'decision_review.circuit_breaker.reset',
      previous_failures: circuitBreaker.consecutiveFailures,
    });
  }
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.pausedUntil = null;
}

function recordIslFailure(): void {
  const now = Date.now();

  if (now - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_RESET_MS) {
    circuitBreaker.consecutiveFailures = 0;
  }

  circuitBreaker.consecutiveFailures++;
  circuitBreaker.lastFailureTime = now;

  if (circuitBreaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.pausedUntil = now + CIRCUIT_BREAKER_PAUSE_MS;
    logger.warn({
      event: 'decision_review.circuit_breaker.opened',
      consecutive_failures: circuitBreaker.consecutiveFailures,
      pause_ms: CIRCUIT_BREAKER_PAUSE_MS,
    });
  }
}

// ============================================================================
// Graph Node Extraction
// ============================================================================

interface GraphNode {
  id: string;
  kind: string;
  label?: string;
  title?: string;
}

/**
 * Extract nodes from graph for analysis
 */
function extractNodesFromGraph(graph: GraphV1, targetNodeIds?: string[]): GraphNode[] {
  const nodes = (graph as { nodes?: GraphNode[] }).nodes ?? [];

  if (targetNodeIds && targetNodeIds.length > 0) {
    return nodes.filter((n) => targetNodeIds.includes(n.id));
  }

  // By default, analyze decision-relevant node types
  const relevantKinds = ['decision', 'option', 'criterion', 'evidence', 'assumption', 'risk'];
  return nodes.filter((n) => relevantKinds.includes(n.kind));
}

/**
 * Map graph node kind to schema NodeKind
 */
function mapNodeKind(kind: string): NodeKind {
  const validKinds = [
    'decision',
    'option',
    'criterion',
    'evidence',
    'assumption',
    'constraint',
    'stakeholder',
    'risk',
    'outcome',
    'milestone',
  ];
  return validKinds.includes(kind) ? (kind as NodeKind) : 'unknown';
}

// ============================================================================
// ISL Result Mappers
// ============================================================================

function mapSensitivityResult(
  nodeId: string,
  response: ISLSensitivityResponse,
): ISLSensitivityResult {
  const nodeSensitivity = response.sensitivities.find((s) => s.node_id === nodeId);

  if (!nodeSensitivity) {
    return createDegradedSensitivity('Node not found in ISL response');
  }

  return {
    available: true,
    score: nodeSensitivity.sensitivity_score,
    classification: nodeSensitivity.classification,
    factors: nodeSensitivity.contributing_factors.map((f) => f.description),
    affectedPaths: nodeSensitivity.affected_paths,
  };
}

function mapContrastiveResult(response: ISLContrastiveResponse): ISLContrastiveResult {
  return {
    available: true,
    explanation: response.summary.explanation,
    keyFactors: response.summary.key_factors,
    counterfactuals: response.contrasts
      .filter((c) => c.counterfactual)
      .map((c) => ({
        change: c.counterfactual!.change,
        predictedImpact: c.counterfactual!.predicted_impact,
      })),
  };
}

function mapConformalResult(
  nodeId: string,
  response: ISLConformalResponse,
): ISLConformalResult {
  const interval = response.intervals.find((i) => i.node_id === nodeId);

  if (!interval) {
    return createDegradedConformal('Node not found in ISL response');
  }

  return {
    available: true,
    interval: {
      lower: interval.lower_bound,
      upper: interval.upper_bound,
    },
    confidence: interval.confidence_level,
    wellCalibrated: interval.well_calibrated,
    widthFactors: interval.width_factors?.map((f) => f.factor),
  };
}

function mapValidationStrategies(
  response: ISLValidationStrategiesResponse,
): ValidationSuggestions {
  return {
    available: true,
    strategies: response.strategies.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      priority: s.priority,
      effort: s.effort,
      expectedImpact: s.expected_impact,
      actions: s.actions.map((a) => a.action),
    })),
    overallPriority:
      response.strategies.length > 0
        ? response.strategies[0].priority === 'critical'
          ? 'high'
          : response.strategies[0].priority
        : 'low',
    coverage: {
      nodeCoverage: response.coverage.node_coverage,
      riskCoverage: response.coverage.risk_coverage,
    },
  };
}

// ============================================================================
// ISL Call Wrappers (with Graceful Degradation)
// ============================================================================

type ISLCallResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function callSensitivity(
  client: ISLClient,
  request: ISLSensitivityRequest,
): Promise<ISLCallResult<ISLSensitivityResponse>> {
  try {
    const response = await client.getSensitivityDetailed(request);
    return { success: true, data: response };
  } catch (error) {
    const errorMsg =
      error instanceof ISLTimeoutError
        ? 'ISL sensitivity timeout'
        : error instanceof ISLValidationError
          ? `ISL sensitivity error: ${error.message}`
          : `ISL sensitivity failed: ${error instanceof Error ? error.message : String(error)}`;
    return { success: false, error: errorMsg };
  }
}

async function callContrastive(
  client: ISLClient,
  request: ISLContrastiveRequest,
): Promise<ISLCallResult<ISLContrastiveResponse>> {
  try {
    const response = await client.getContrastiveExplanation(request);
    return { success: true, data: response };
  } catch (error) {
    const errorMsg =
      error instanceof ISLTimeoutError
        ? 'ISL contrastive timeout'
        : error instanceof ISLValidationError
          ? `ISL contrastive error: ${error.message}`
          : `ISL contrastive failed: ${error instanceof Error ? error.message : String(error)}`;
    return { success: false, error: errorMsg };
  }
}

async function callConformal(
  client: ISLClient,
  request: ISLConformalRequest,
): Promise<ISLCallResult<ISLConformalResponse>> {
  try {
    const response = await client.getConformalPrediction(request);
    return { success: true, data: response };
  } catch (error) {
    const errorMsg =
      error instanceof ISLTimeoutError
        ? 'ISL conformal timeout'
        : error instanceof ISLValidationError
          ? `ISL conformal error: ${error.message}`
          : `ISL conformal failed: ${error instanceof Error ? error.message : String(error)}`;
    return { success: false, error: errorMsg };
  }
}

async function callValidationStrategies(
  client: ISLClient,
  request: ISLValidationStrategiesRequest,
): Promise<ISLCallResult<ISLValidationStrategiesResponse>> {
  try {
    const response = await client.getValidationStrategies(request);
    return { success: true, data: response };
  } catch (error) {
    const errorMsg =
      error instanceof ISLTimeoutError
        ? 'ISL validation strategies timeout'
        : error instanceof ISLValidationError
          ? `ISL validation strategies error: ${error.message}`
          : `ISL validation strategies failed: ${error instanceof Error ? error.message : String(error)}`;
    return { success: false, error: errorMsg };
  }
}

// ============================================================================
// Decision Review Service
// ============================================================================

export interface DecisionReviewServiceConfig {
  /** Custom ISL client (for testing) */
  islClient?: ISLClient | null;
  /** Mock LLM critique generator (for testing) */
  llmCritiqueGenerator?: (node: GraphNode) => { summary: string; concerns: string[]; suggestions: string[] };
}

/**
 * Default LLM critique generator (placeholder)
 * In production, this would call the actual LLM service
 */
function defaultLLMCritiqueGenerator(node: GraphNode): {
  summary: string;
  concerns: string[];
  suggestions: string[];
} {
  return {
    summary: `Analysis of ${node.kind} node "${node.label ?? node.title ?? node.id}"`,
    concerns: [],
    suggestions: [],
  };
}

/**
 * Execute enhanced decision review with ISL integration
 *
 * Uses Promise.allSettled() to call ISL endpoints in parallel and
 * gracefully degrade when calls fail.
 */
export async function executeDecisionReview(
  graph: GraphV1,
  request: ServiceDecisionReviewRequest = {},
  serviceConfig: DecisionReviewServiceConfig = {},
): Promise<DecisionReviewResponse> {
  const startTime = Date.now();
  const requestId = `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const config: ReviewConfig = request.config ?? {};

  // Extract nodes to analyze
  const nodes = extractNodesFromGraph(graph, request.targetNodes);
  const limitedNodes = nodes.slice(0, config.maxNodes ?? 20);

  // Initialize ISL client - use provided client if any, otherwise check config
  const hasExplicitClient = 'islClient' in serviceConfig;
  const islClient = hasExplicitClient
    ? serviceConfig.islClient
    : (causalValidationEnabled() ? createISLClient() : null);
  const islEnabled = islClient !== null && !isCircuitBreakerOpen();

  logger.info({
    event: 'decision_review.start',
    request_id: requestId,
    nodes_count: limitedNodes.length,
    isl_enabled: islEnabled,
  });

  // LLM critique generator
  const generateCritique = serviceConfig.llmCritiqueGenerator ?? defaultLLMCritiqueGenerator;

  // If ISL is not available, return LLM-only critiques
  if (!islEnabled) {
    const reason = islClient === null
      ? 'ISL client not configured'
      : 'Circuit breaker open';

    logger.info({
      event: 'decision_review.isl_unavailable',
      request_id: requestId,
      reason,
    });

    const critiques: EnhancedNodeCritique[] = limitedNodes.map((node) => ({
      nodeId: node.id,
      kind: mapNodeKind(node.kind),
      title: node.label ?? node.title ?? node.id,
      critique: generateCritique(node),
      severity: 'info',
      confidence: 0.5,
    }));

    return {
      critiques,
      islAvailability: createFullyDegradedAvailability(reason),
      summary: buildSummary(critiques, undefined),
      trace: {
        requestId,
        correlationId: request.correlationId,
        latencyMs: Date.now() - startTime,
      },
    };
  }

  // Prepare ISL requests
  const nodeIds = limitedNodes.map((n) => n.id);
  const decisionNode = limitedNodes.find((n) => n.kind === 'decision');
  const quantitativeNodes = limitedNodes.filter((n) =>
    ['outcome', 'risk', 'criterion'].includes(n.kind),
  );

  // Build ISL request promises with labels for result tracking
  interface ISLResults {
    sensitivity: ISLCallResult<ISLSensitivityResponse> | null;
    contrastive: ISLCallResult<ISLContrastiveResponse> | null;
    conformal: ISLCallResult<ISLConformalResponse> | null;
    validation: ISLCallResult<ISLValidationStrategiesResponse> | null;
  }

  const results: ISLResults = {
    sensitivity: null,
    contrastive: null,
    conformal: null,
    validation: null,
  };

  const islPromises: Promise<void>[] = [];

  // At this point islClient is guaranteed to be non-null because we returned early above
  const client = islClient!;

  // Sensitivity analysis
  if (config.enableSensitivity !== false) {
    const sensitivityRequest: ISLSensitivityRequest = {
      graph,
      target_nodes: nodeIds,
      config: { include_paths: true },
    };
    islPromises.push(
      callSensitivity(client, sensitivityRequest).then((r) => {
        results.sensitivity = r;
      }),
    );
  }

  // Contrastive explanation (only if there's a decision node)
  if (config.enableContrastive !== false && decisionNode) {
    const contrastiveRequest: ISLContrastiveRequest = {
      graph,
      decision_node_id: decisionNode.id,
      config: { include_counterfactuals: true },
    };
    islPromises.push(
      callContrastive(client, contrastiveRequest).then((r) => {
        results.contrastive = r;
      }),
    );
  }

  // Conformal prediction (only if enabled and there are quantitative nodes)
  if (config.enableConformal === true && quantitativeNodes.length > 0) {
    const conformalRequest: ISLConformalRequest = {
      graph,
      prediction_nodes: quantitativeNodes.map((n) => n.id),
      confidence_level: 0.9,
    };
    islPromises.push(
      callConformal(client, conformalRequest).then((r) => {
        results.conformal = r;
      }),
    );
  }

  // Validation strategies
  if (config.enableValidationStrategies !== false) {
    const validationRequest: ISLValidationStrategiesRequest = {
      graph,
      config: { prioritize_by: 'impact' },
    };
    islPromises.push(
      callValidationStrategies(client, validationRequest).then((r) => {
        results.validation = r;
      }),
    );
  }

  // Execute all ISL calls in parallel with graceful degradation
  const islStartTime = Date.now();
  await Promise.allSettled(islPromises);
  const islLatencyMs = Date.now() - islStartTime;

  // Track ISL availability
  let sensitivitySuccessCount = 0;
  let contrastiveSuccessCount = 0;
  let conformalSuccessCount = 0;
  let anyIslSuccess = false;

  if (results.sensitivity?.success) {
    sensitivitySuccessCount = results.sensitivity.data.sensitivities.length;
    anyIslSuccess = true;
  }
  if (results.contrastive?.success) {
    contrastiveSuccessCount = 1;
    anyIslSuccess = true;
  }
  if (results.conformal?.success) {
    conformalSuccessCount = results.conformal.data.intervals.length;
    anyIslSuccess = true;
  }

  // Update circuit breaker based on results
  if (anyIslSuccess) {
    recordIslSuccess();
  } else if (islPromises.length > 0) {
    recordIslFailure();
  }

  // Build enhanced critiques
  const critiques: EnhancedNodeCritique[] = limitedNodes.map((node) => {
    const islAnalysis: ISLAnalysis = {};

    // Sensitivity
    if (results.sensitivity) {
      islAnalysis.sensitivity = results.sensitivity.success
        ? mapSensitivityResult(node.id, results.sensitivity.data)
        : createDegradedSensitivity(results.sensitivity.error);
    }

    // Contrastive (only for decision nodes)
    if (results.contrastive && node.kind === 'decision') {
      islAnalysis.contrastive = results.contrastive.success
        ? mapContrastiveResult(results.contrastive.data)
        : createDegradedContrastive(results.contrastive.error);
    }

    // Conformal (only for quantitative nodes)
    if (results.conformal && quantitativeNodes.some((n) => n.id === node.id)) {
      islAnalysis.conformal = results.conformal.success
        ? mapConformalResult(node.id, results.conformal.data)
        : createDegradedConformal(results.conformal.error);
    }

    // Calculate severity based on ISL analysis
    const severity = calculateSeverity(islAnalysis);

    return {
      nodeId: node.id,
      kind: mapNodeKind(node.kind),
      title: node.label ?? node.title ?? node.id,
      critique: generateCritique(node),
      islAnalysis: Object.keys(islAnalysis).length > 0 ? islAnalysis : undefined,
      severity,
      confidence: calculateConfidence(islAnalysis),
    };
  });

  // Build global validation suggestions
  const globalValidationSuggestions: ValidationSuggestions = results.validation?.success
    ? mapValidationStrategies(results.validation.data)
    : createDegradedValidationSuggestions(results.validation?.error);

  // Build ISL availability summary
  const islAvailability: ISLAvailabilitySummary = {
    serviceAvailable: anyIslSuccess,
    sensitivitySuccessCount,
    contrastiveSuccessCount,
    conformalSuccessCount,
    validationStrategiesAvailable: results.validation?.success ?? false,
    degradationReason: anyIslSuccess ? undefined : 'All ISL calls failed',
  };

  logger.info({
    event: 'decision_review.complete',
    request_id: requestId,
    nodes_analyzed: critiques.length,
    isl_latency_ms: islLatencyMs,
    total_latency_ms: Date.now() - startTime,
    sensitivity_success: results.sensitivity?.success ?? false,
    contrastive_success: results.contrastive?.success ?? false,
    conformal_success: results.conformal?.success ?? false,
    validation_success: results.validation?.success ?? false,
  });

  return {
    critiques,
    globalValidationSuggestions,
    islAvailability,
    summary: buildSummary(critiques, globalValidationSuggestions),
    trace: {
      requestId,
      correlationId: request.correlationId,
      latencyMs: Date.now() - startTime,
      islLatencyMs,
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateSeverity(
  islAnalysis: ISLAnalysis,
): 'info' | 'low' | 'medium' | 'high' | 'critical' {
  // High sensitivity = higher severity
  if (islAnalysis.sensitivity?.available && islAnalysis.sensitivity.score) {
    if (islAnalysis.sensitivity.score >= 0.8) return 'high';
    if (islAnalysis.sensitivity.score >= 0.5) return 'medium';
  }
  return 'info';
}

function calculateConfidence(islAnalysis: ISLAnalysis): number {
  // Base confidence on ISL availability
  let availableCount = 0;
  let totalCount = 0;

  if (islAnalysis.sensitivity) {
    totalCount++;
    if (islAnalysis.sensitivity.available) availableCount++;
  }
  if (islAnalysis.contrastive) {
    totalCount++;
    if (islAnalysis.contrastive.available) availableCount++;
  }
  if (islAnalysis.conformal) {
    totalCount++;
    if (islAnalysis.conformal.available) availableCount++;
  }

  if (totalCount === 0) return 0.5;
  return 0.5 + (availableCount / totalCount) * 0.5;
}

function buildSummary(
  critiques: EnhancedNodeCritique[],
  validationSuggestions: ValidationSuggestions | undefined,
): DecisionReviewResponse['summary'] {
  const bySeverity = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const critique of critiques) {
    bySeverity[critique.severity]++;
  }

  // Extract top concerns from critiques
  const topConcerns = critiques
    .filter((c) => c.severity !== 'info')
    .flatMap((c) => c.critique.concerns)
    .slice(0, 5);

  // Extract priority strategies
  const priorityStrategies =
    validationSuggestions?.available && validationSuggestions.strategies
      ? validationSuggestions.strategies.slice(0, 3).map((s) => s.title)
      : [];

  return {
    nodesAnalyzed: critiques.length,
    bySeverity,
    topConcerns,
    priorityStrategies,
  };
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Reset circuit breaker state (for testing)
 */
export function __resetDecisionReviewCircuitBreakerForTests(): void {
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.pausedUntil = null;
  circuitBreaker.lastFailureTime = 0;
}

/**
 * Get circuit breaker status (for diagnostics)
 */
export function getDecisionReviewCircuitBreakerStatus() {
  const now = Date.now();
  const isOpen =
    circuitBreaker.pausedUntil !== null && now < circuitBreaker.pausedUntil;

  return {
    state: isOpen ? 'open' : 'closed',
    consecutive_failures: circuitBreaker.consecutiveFailures,
    threshold: CIRCUIT_BREAKER_THRESHOLD,
    pause_ms: CIRCUIT_BREAKER_PAUSE_MS,
  };
}
