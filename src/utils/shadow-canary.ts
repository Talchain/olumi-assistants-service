/**
 * Shadow Canary (v1.4.0 - PR F)
 *
 * Shadow testing infrastructure for safely testing new LLM providers, prompts,
 * or logic changes without affecting production responses.
 *
 * Features:
 * - Configurable sampling rate (% of requests to shadow)
 * - Async execution (doesn't slow down primary path)
 * - Telemetry for comparison metrics
 * - Error isolation (shadow failures don't affect prod)
 */

import { log, emit, TelemetryEvents } from "./telemetry.js";

const env = process.env;

/**
 * Configuration for shadow canary
 */
export interface ShadowCanaryConfig {
  enabled: boolean;
  sampleRate: number; // 0.0 to 1.0 (percentage of requests)
  timeoutMs: number; // Max time to wait for shadow
}

/**
 * Get shadow canary configuration from environment
 */
export function getShadowCanaryConfig(): ShadowCanaryConfig {
  const enabled = env.SHADOW_CANARY_ENABLED === "true";
  const sampleRate = Number(env.SHADOW_CANARY_SAMPLE_RATE) || 0.0;
  const timeoutMs = Number(env.SHADOW_CANARY_TIMEOUT_MS) || 5000;

  return {
    enabled: enabled && sampleRate > 0,
    sampleRate: Math.max(0, Math.min(1, sampleRate)), // Clamp to [0, 1]
    timeoutMs,
  };
}

/**
 * Determine if this request should be shadowed (sampling)
 */
export function shouldShadow(config: ShadowCanaryConfig): boolean {
  if (!config.enabled || config.sampleRate <= 0) {
    return false;
  }

  if (config.sampleRate >= 1.0) {
    return true; // 100% sampling
  }

  return Math.random() < config.sampleRate;
}

/**
 * Execute shadow request asynchronously
 * Returns immediately, logs results via telemetry
 */
export async function executeShadow<T>(
  primaryResult: T,
  shadowFn: () => Promise<T>,
  config: ShadowCanaryConfig,
  context: {
    requestId: string;
    operation: string;
  }
): Promise<void> {
  if (!shouldShadow(config)) {
    return;
  }

  // Execute shadow asynchronously (don't block primary response)
  void (async () => {
    const startTime = Date.now();
    let shadowResult: T | null = null;
    let error: Error | null = null;

    try {
      // Add timeout to shadow execution
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Shadow timeout")), config.timeoutMs)
      );

      shadowResult = await Promise.race([shadowFn(), timeoutPromise]);
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      log.warn(
        {
          request_id: context.requestId,
          operation: context.operation,
          error: error.message,
          redacted: true,
        },
        "Shadow canary execution failed"
      );
    }

    const duration = Date.now() - startTime;

    // Compare results if shadow succeeded
    let divergence = false;
    if (shadowResult && !error) {
      divergence = !deepEqual(primaryResult, shadowResult);
    }

    // Emit telemetry
    emit(TelemetryEvents.Stage, {
      stage: "shadow_canary_complete",
      request_id: context.requestId,
      operation: context.operation,
      duration_ms: duration,
      success: !error,
      divergence,
      error: error?.message,
    });
  })();
}

/**
 * Deep equality check for comparing results
 * Simplified implementation for common types
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();

    if (aKeys.length !== bKeys.length) return false;
    if (aKeys.some((k, i) => k !== bKeys[i])) return false;

    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  return false;
}

/**
 * Create a shadow adapter wrapper
 * Useful for testing different LLM providers or prompt versions
 */
export function createShadowWrapper<TInput, TOutput>(
  primaryFn: (input: TInput) => Promise<TOutput>,
  shadowFn: (input: TInput) => Promise<TOutput>,
  operation: string
): (input: TInput, requestId: string) => Promise<TOutput> {
  const config = getShadowCanaryConfig();

  return async (input: TInput, requestId: string): Promise<TOutput> => {
    // Execute primary (always)
    const primaryResult = await primaryFn(input);

    // Execute shadow (async, don't wait)
    if (config.enabled) {
      void executeShadow(
        primaryResult,
        () => shadowFn(input),
        config,
        { requestId, operation }
      );
    }

    // Always return primary result
    return primaryResult;
  };
}
