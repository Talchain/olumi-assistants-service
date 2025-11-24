/**
 * Causal Validation Enrichment for Bias Findings
 *
 * Enriches bias findings with causal validation from ISL (Inference & Structure Learning)
 * when CEE_CAUSAL_VALIDATION_ENABLED feature flag is enabled.
 */

import type { components } from '../../generated/openapi.d.ts';
import type { GraphV1 } from '../../contracts/plot/engine.js';
import {
  ISLTimeoutError,
  ISLValidationError,
  createISLClient,
} from '../../adapters/isl/index.js';
import type {
  ISLBiasValidateRequest,
  CausalValidation,
  EvidenceStrength,
} from '../../adapters/isl/types.js';
import { causalValidationEnabled } from '../../adapters/isl/config.js';
import { logger } from '../../utils/simple-logger.js';

type CEEBiasFindingV1 = components['schemas']['CEEBiasFindingV1'];

/**
 * Extended bias finding with causal validation
 */
export interface CEEBiasFindingWithCausalValidation extends CEEBiasFindingV1 {
  /** Causal validation result from ISL (optional, only when enabled) */
  causal_validation?: CausalValidation;

  /** Evidence strength analysis (optional, only when enabled) */
  evidence_strength?: EvidenceStrength[];
}

/**
 * Circuit breaker state for ISL integration
 */
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

const CIRCUIT_BREAKER_THRESHOLD = 3; // Open circuit after 3 consecutive failures
const CIRCUIT_BREAKER_PAUSE_MS = 90000; // Pause for 90 seconds (60-120s range)
const CIRCUIT_BREAKER_RESET_MS = 60000; // Reset counter if no failures for 60s

/**
 * Check if circuit breaker is open (paused)
 */
function isCircuitBreakerOpen(): boolean {
  if (circuitBreaker.pausedUntil === null) {
    return false;
  }

  const now = Date.now();
  if (now < circuitBreaker.pausedUntil) {
    return true;
  }

  // Circuit breaker pause expired, reset state
  logger.info({
    event: 'isl.circuit_breaker.closed',
    pause_duration_ms: CIRCUIT_BREAKER_PAUSE_MS,
  });
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.pausedUntil = null;
  return false;
}

/**
 * Record ISL success - reset circuit breaker
 */
function recordIslSuccess(): void {
  if (circuitBreaker.consecutiveFailures > 0) {
    logger.info({
      event: 'isl.circuit_breaker.reset',
      previous_failures: circuitBreaker.consecutiveFailures,
    });
  }
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.pausedUntil = null;
}

/**
 * Record ISL failure - increment circuit breaker counter
 */
function recordIslFailure(): void {
  const now = Date.now();

  // Reset counter if last failure was too long ago
  if (now - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_RESET_MS) {
    circuitBreaker.consecutiveFailures = 0;
  }

  circuitBreaker.consecutiveFailures++;
  circuitBreaker.lastFailureTime = now;

  if (circuitBreaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.pausedUntil = now + CIRCUIT_BREAKER_PAUSE_MS;
    logger.warn({
      event: 'isl.circuit_breaker.opened',
      consecutive_failures: circuitBreaker.consecutiveFailures,
      pause_ms: CIRCUIT_BREAKER_PAUSE_MS,
      resume_at: new Date(circuitBreaker.pausedUntil).toISOString(),
    });
  }
}

/**
 * Extract evidence nodes from graph
 *
 * @param graph - Decision graph
 * @returns Array of evidence node IDs
 */
function extractEvidenceNodes(graph: GraphV1): string[] {
  if (!graph || !Array.isArray((graph as any).nodes)) {
    return [];
  }

  const evidenceKinds = ['evidence', 'risk', 'outcome', 'constraint'];
  const nodes = (graph as any).nodes as any[];

  return nodes
    .filter((n) => n && evidenceKinds.includes((n as any).kind))
    .map((n) => (n as any).id as string)
    .filter(Boolean);
}

/**
 * Enrich bias findings with causal validation from ISL
 *
 * @param graph - Decision graph
 * @param biasFindings - Detected bias findings
 * @returns Enriched findings with causal validation (if enabled)
 */
export async function enrichBiasFindings(
  graph: GraphV1,
  biasFindings: CEEBiasFindingV1[],
): Promise<CEEBiasFindingWithCausalValidation[]> {
  // Early return if feature disabled
  if (!causalValidationEnabled()) {
    const flagValue = process.env.CEE_CAUSAL_VALIDATION_ENABLED;
    logger.debug({
      event: 'cee.bias.causal_validation.disabled',
      reason: flagValue === undefined ? 'not_configured' : 'disabled',
      flag_value: flagValue,
    });
    return biasFindings as CEEBiasFindingWithCausalValidation[];
  }

  // Early return if no findings to validate
  if (biasFindings.length === 0) {
    return [];
  }

  // Create ISL client
  const islClient = createISLClient();
  if (!islClient) {
    logger.warn({
      event: 'cee.bias.causal_validation.no_client',
      reason: 'ISL_BASE_URL not configured',
    });
    return biasFindings as CEEBiasFindingWithCausalValidation[];
  }

  // Check circuit breaker
  if (isCircuitBreakerOpen()) {
    logger.warn({
      event: 'cee.bias.causal_validation.circuit_open',
      reason: 'Circuit breaker paused due to consecutive failures',
    });
    return biasFindings as CEEBiasFindingWithCausalValidation[];
  }

  const startTime = Date.now();

  try {
    // Build ISL validation request
    const request: ISLBiasValidateRequest = {
      graph,
      bias_findings: biasFindings
        .filter((f) => f.code) // Only validate findings with canonical codes
        .map((f) => ({
          code: f.code!,
          targets: {
            node_ids: f.targets?.node_ids ?? [],
            edge_ids: f.targets?.edge_ids,
          },
          severity: f.severity,
        })),
      validation_config: {
        enable_counterfactuals: true,
        evidence_nodes: extractEvidenceNodes(graph),
      },
    };

    logger.debug({
      event: 'cee.bias.causal_validation.start',
      findings_count: request.bias_findings.length,
      evidence_nodes_count: request.validation_config?.evidence_nodes?.length ?? 0,
    });

    // Call ISL for validation
    const response = await islClient.validateBias(request);

    // Record success - reset circuit breaker
    recordIslSuccess();

    const latency = Date.now() - startTime;

    // Merge validations into findings
    const enrichedFindings = biasFindings.map((finding) => {
      if (!finding.code) {
        return finding as CEEBiasFindingWithCausalValidation;
      }

      const validation = response.validations.find(
        (v) => v.bias_code === finding.code,
      );

      if (!validation) {
        return finding as CEEBiasFindingWithCausalValidation;
      }

      return {
        ...finding,
        causal_validation: validation.causal_validation,
        evidence_strength: validation.evidence_strength,
      } as CEEBiasFindingWithCausalValidation;
    });

    // Log success metrics
    const identifiableCount = response.validations.filter(
      (v) => v.causal_validation.identifiable,
    ).length;

    const logData: Record<string, any> = {
      event: 'cee.bias.causal_validation.success',
      validated_count: response.validations.length,
      identifiable_count: identifiableCount,
      isl_latency_ms: response.latency_ms,
      total_latency_ms: latency,
    };

    // Only compute avg_strength if there are validations
    if (response.validations.length > 0) {
      const avgStrength =
        response.validations.reduce(
          (sum, v) => sum + v.causal_validation.strength,
          0,
        ) / response.validations.length;
      logData.avg_strength = avgStrength.toFixed(3);
    }

    logger.info(logData);

    return enrichedFindings;
  } catch (error) {
    const latency = Date.now() - startTime;

    // Handle timeouts gracefully
    if (error instanceof ISLTimeoutError) {
      recordIslFailure();
      logger.warn({
        event: 'cee.bias.causal_validation.timeout',
        latency_ms: latency,
        error: error.message,
      });
      return biasFindings as CEEBiasFindingWithCausalValidation[];
    }

    // Handle validation errors gracefully
    if (error instanceof ISLValidationError) {
      recordIslFailure();
      logger.warn({
        event: 'cee.bias.causal_validation.error',
        error_code: error.errorCode,
        status_code: error.statusCode,
        latency_ms: latency,
        error: error.message,
      });
      return biasFindings as CEEBiasFindingWithCausalValidation[];
    }

    // Handle unexpected errors
    recordIslFailure();
    logger.error({
      event: 'cee.bias.causal_validation.failed',
      latency_ms: latency,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return unenriched findings on error (graceful degradation)
    return biasFindings as CEEBiasFindingWithCausalValidation[];
  }
}
