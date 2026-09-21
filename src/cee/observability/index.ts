/**
 * CEE Observability Module
 *
 * Provides observability tracking for CEE pipeline:
 * - LLM call tracking (model, tokens, latency, raw I/O)
 * - Validation tracking (attempts, rules, repairs)
 * - Orchestrator tracking (steps, timing)
 * - Graph quality metrics (structure, topology, data quality)
 *
 * Current Coverage:
 * - draft_graph: Full tracking via pipeline.ts
 * - critique_graph: Tracked via assist.critique-graph.ts
 * - suggest_options: Tracked via assist.suggest-options.ts
 *
 * Usage:
 *   import { createObservabilityCollector, isObservabilityEnabled } from "../observability/index.js";
 *
 *   if (isObservabilityEnabled()) {
 *     const collector = createObservabilityCollector({ requestId, ceeVersion });
 *     // ... record calls, validation, etc.
 *     collector.setGraphMetrics(computeGraphMetrics({ graph, validationResult, repairs }));
 *     response._observability = collector.build();
 *   }
 */

export {
  createObservabilityCollector,
  createNoOpObservabilityCollector,
  type ObservabilityCollector,
} from "./collector.js";

export type {
  CEEObservability,
  LLMCallRecord,
  LLMCallStep,
  ValidationAttemptRecord,
  ValidationTracking,
  ValidationAction,
  OrchestratorTracking,
  OrchestratorStepRecord,
  ObservabilityTotals,
  ObservabilityCollectorOptions,
  GraphQualityMetrics,
  GraphDiff,
  GraphDiffType,
  ModelSelectionReason,
  PromptModelConfig,
} from "./types.js";

export {
  recordLLMCall,
  createLLMCallContext,
  methodToStep,
  type RecordLLMCallParams,
  type LLMCallContext,
  type LLMCallCompleteParams,
} from "./llm-call-recorder.js";

export {
  computeGraphMetrics,
  type ComputeGraphMetricsInput,
} from "./graph-metrics.js";

export {
  repairRecordsToGraphDiffs,
  computeGraphDiffs,
} from "./graph-diff.js";

import { config } from "../../config/index.js";

/**
 * Check if CEE observability is enabled via feature flag.
 *
 * Returns true if:
 * - CEE_OBSERVABILITY_ENABLED=true, OR
 * - include_debug=true in request (debug bundle mode)
 */
export function isObservabilityEnabled(requestIncludeDebug?: boolean): boolean {
  return config.cee.observabilityEnabled || requestIncludeDebug === true;
}

/**
 * Check if raw I/O capture is enabled.
 *
 * Raw I/O (prompts/responses) is only captured when:
 * - CEE_OBSERVABILITY_RAW_IO=true, AND
 * - Either CEE_OBSERVABILITY_ENABLED=true OR include_debug=true
 *
 * In production, this should generally be disabled for security/privacy.
 */
export function isRawIOCaptureEnabled(requestIncludeDebug?: boolean): boolean {
  // Must have observability enabled first
  if (!isObservabilityEnabled(requestIncludeDebug)) {
    return false;
  }
  return config.cee.observabilityRawIO;
}
