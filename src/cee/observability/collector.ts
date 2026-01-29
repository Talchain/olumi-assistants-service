/**
 * CEE Observability Collector
 *
 * Collects observability data throughout the CEE pipeline.
 * Similar pattern to CorrectionCollector but for LLM calls, validation, etc.
 *
 * Usage:
 *   const collector = createObservabilityCollector({ requestId, ceeVersion });
 *   collector.recordLLMCall({ ... });
 *   collector.recordValidationAttempt({ ... });
 *   const observability = collector.build();
 */

import { randomUUID, createHash } from "node:crypto";
import type {
  CEEObservability,
  LLMCallRecord,
  LLMCallStep,
  ValidationAttemptRecord,
  ValidationTracking,
  OrchestratorTracking,
  OrchestratorStepRecord,
  ObservabilityTotals,
  ObservabilityCollectorOptions,
} from "./types.js";

// ============================================================================
// Collector Interface
// ============================================================================

/**
 * Interface for observability data collection.
 */
export interface ObservabilityCollector {
  /**
   * Record an LLM call.
   */
  recordLLMCall(call: Omit<LLMCallRecord, "id" | "prompt_hash" | "response_hash">): void;

  /**
   * Record a validation attempt.
   */
  recordValidationAttempt(attempt: Omit<ValidationAttemptRecord, "attempt" | "timestamp">): void;

  /**
   * Record an orchestrator step.
   */
  recordOrchestratorStep(step: Omit<OrchestratorStepRecord, "timestamp">): void;

  /**
   * Set orchestrator enabled state.
   */
  setOrchestratorEnabled(enabled: boolean): void;

  /**
   * Start timing for an operation.
   * Returns a function to call when the operation completes.
   */
  startTimer(): () => number;

  /**
   * Build the final observability object.
   */
  build(): CEEObservability;

  /**
   * Check if any LLM calls have been recorded.
   */
  hasLLMCalls(): boolean;

  /**
   * Get count of LLM calls.
   */
  llmCallCount(): number;

  /**
   * Check if raw I/O capture is enabled.
   */
  isRawIOEnabled(): boolean;

  /**
   * Get the request ID.
   */
  getRequestId(): string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_MAX_PROMPT_LENGTH = 10000;
const DEFAULT_MAX_RESPONSE_LENGTH = 50000;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a new observability collector instance.
 */
export function createObservabilityCollector(
  options: ObservabilityCollectorOptions
): ObservabilityCollector {
  const {
    requestId,
    ceeVersion,
    captureRawIO = false,
    maxPromptLength = DEFAULT_MAX_PROMPT_LENGTH,
    maxResponseLength = DEFAULT_MAX_RESPONSE_LENGTH,
  } = options;

  // Internal state
  const llmCalls: LLMCallRecord[] = [];
  const validationAttempts: ValidationAttemptRecord[] = [];
  const orchestratorSteps: OrchestratorStepRecord[] = [];
  let orchestratorEnabled = false;
  let totalLatencyMs = 0;

  /**
   * Compute SHA-256 hash of a string.
   */
  function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  /**
   * Truncate string to max length.
   */
  function truncate(value: string | undefined, maxLength: number): string | undefined {
    if (!value) return undefined;
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength) + `... [truncated, ${value.length - maxLength} chars omitted]`;
  }

  return {
    recordLLMCall(call: Omit<LLMCallRecord, "id" | "prompt_hash" | "response_hash">): void {
      const record: LLMCallRecord = {
        ...call,
        id: randomUUID(),
        prompt_hash: call.raw_prompt ? sha256(call.raw_prompt) : undefined,
        response_hash: call.raw_response ? sha256(call.raw_response) : undefined,
        // Only include raw I/O if capture is enabled
        raw_prompt: captureRawIO ? truncate(call.raw_prompt, maxPromptLength) : undefined,
        raw_response: captureRawIO ? truncate(call.raw_response, maxResponseLength) : undefined,
      };
      llmCalls.push(record);
      totalLatencyMs += call.latency_ms;
    },

    recordValidationAttempt(
      attempt: Omit<ValidationAttemptRecord, "attempt" | "timestamp">
    ): void {
      const record: ValidationAttemptRecord = {
        ...attempt,
        attempt: validationAttempts.length + 1,
        timestamp: new Date().toISOString(),
      };
      validationAttempts.push(record);
      totalLatencyMs += attempt.latency_ms;
    },

    recordOrchestratorStep(step: Omit<OrchestratorStepRecord, "timestamp">): void {
      const record: OrchestratorStepRecord = {
        ...step,
        timestamp: new Date().toISOString(),
      };
      orchestratorSteps.push(record);
      totalLatencyMs += step.latency_ms;
    },

    setOrchestratorEnabled(enabled: boolean): void {
      orchestratorEnabled = enabled;
    },

    startTimer(): () => number {
      const startTime = performance.now();
      return () => {
        const elapsed = performance.now() - startTime;
        return Math.round(elapsed);
      };
    },

    build(): CEEObservability {
      // Build validation tracking
      const validation: ValidationTracking = buildValidationTracking(validationAttempts);

      // Build orchestrator tracking
      const orchestrator: OrchestratorTracking = buildOrchestratorTracking(
        orchestratorSteps,
        orchestratorEnabled
      );

      // Build totals
      const totals: ObservabilityTotals = buildTotals(llmCalls, ceeVersion, totalLatencyMs);

      return {
        llm_calls: llmCalls,
        validation,
        orchestrator,
        totals,
        request_id: requestId,
        raw_io_included: captureRawIO,
      };
    },

    hasLLMCalls(): boolean {
      return llmCalls.length > 0;
    },

    llmCallCount(): number {
      return llmCalls.length;
    },

    isRawIOEnabled(): boolean {
      return captureRawIO;
    },

    getRequestId(): string {
      return requestId;
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build aggregated validation tracking from attempt records.
 */
function buildValidationTracking(
  attempts: ValidationAttemptRecord[]
): ValidationTracking {
  if (attempts.length === 0) {
    return {
      attempts: 0,
      passed: true, // No validation = passed by default
      total_rules_checked: 0,
      failed_rules: [],
      repairs_triggered: false,
      repair_types: [],
      retry_triggered: false,
      attempt_records: [],
      total_latency_ms: 0,
    };
  }

  // Aggregate data
  const allFailedRules = new Set<string>();
  const allRepairTypes = new Set<string>();
  let totalRulesChecked = 0;
  let anyRepairs = false;
  let anyRetry = false;
  let totalLatencyMs = 0;

  for (const attempt of attempts) {
    totalRulesChecked += attempt.rules_checked;
    for (const rule of attempt.rules_failed) {
      allFailedRules.add(rule);
    }
    if (attempt.repairs_triggered) {
      anyRepairs = true;
      for (const repairType of attempt.repair_types ?? []) {
        allRepairTypes.add(repairType);
      }
    }
    if (attempt.retry_triggered) {
      anyRetry = true;
    }
    totalLatencyMs += attempt.latency_ms;
  }

  // Final pass status is based on last attempt
  const lastAttempt = attempts[attempts.length - 1];
  const passed = lastAttempt?.passed ?? true;

  return {
    attempts: attempts.length,
    passed,
    total_rules_checked: totalRulesChecked,
    failed_rules: Array.from(allFailedRules),
    repairs_triggered: anyRepairs,
    repair_types: Array.from(allRepairTypes),
    retry_triggered: anyRetry,
    attempt_records: attempts,
    total_latency_ms: totalLatencyMs,
  };
}

/**
 * Build orchestrator tracking from step records.
 */
function buildOrchestratorTracking(
  steps: OrchestratorStepRecord[],
  enabled: boolean
): OrchestratorTracking {
  const stepsCompleted: string[] = [];
  const stepsSkipped: string[] = [];
  let totalLatencyMs = 0;

  for (const step of steps) {
    if (step.executed) {
      stepsCompleted.push(step.step);
    } else {
      stepsSkipped.push(step.step);
    }
    totalLatencyMs += step.latency_ms;
  }

  return {
    enabled,
    steps_completed: stepsCompleted,
    steps_skipped: stepsSkipped,
    total_latency_ms: totalLatencyMs,
    step_records: steps,
  };
}

/**
 * Build aggregated totals from LLM calls.
 */
function buildTotals(
  llmCalls: LLMCallRecord[],
  ceeVersion: string,
  totalLatencyMs: number
): ObservabilityTotals {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const call of llmCalls) {
    inputTokens += call.tokens.input;
    outputTokens += call.tokens.output;
  }

  return {
    total_llm_calls: llmCalls.length,
    total_tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
    total_latency_ms: totalLatencyMs,
    cee_version: ceeVersion,
  };
}

// ============================================================================
// No-Op Collector
// ============================================================================

/**
 * Create a no-op collector for when observability is disabled.
 * All methods are stubs that do nothing, minimizing overhead.
 */
export function createNoOpObservabilityCollector(requestId: string): ObservabilityCollector {
  const emptyValidation: ValidationTracking = {
    attempts: 0,
    passed: true,
    total_rules_checked: 0,
    failed_rules: [],
    repairs_triggered: false,
    repair_types: [],
    retry_triggered: false,
    attempt_records: [],
    total_latency_ms: 0,
  };

  const emptyOrchestrator: OrchestratorTracking = {
    enabled: false,
    steps_completed: [],
    steps_skipped: [],
    total_latency_ms: 0,
    step_records: [],
  };

  const emptyTotals: ObservabilityTotals = {
    total_llm_calls: 0,
    total_tokens: { input: 0, output: 0, total: 0 },
    total_latency_ms: 0,
    cee_version: "",
  };

  const emptyObservability: CEEObservability = {
    llm_calls: [],
    validation: emptyValidation,
    orchestrator: emptyOrchestrator,
    totals: emptyTotals,
    request_id: requestId,
    raw_io_included: false,
  };

  return {
    recordLLMCall(): void {},
    recordValidationAttempt(): void {},
    recordOrchestratorStep(): void {},
    setOrchestratorEnabled(): void {},
    startTimer(): () => number {
      return () => 0;
    },
    build(): CEEObservability {
      return emptyObservability;
    },
    hasLLMCalls(): boolean {
      return false;
    },
    llmCallCount(): number {
      return 0;
    },
    isRawIOEnabled(): boolean {
      return false;
    },
    getRequestId(): string {
      return requestId;
    },
  };
}
