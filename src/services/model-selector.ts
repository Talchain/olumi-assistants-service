/**
 * Model Selection Service
 *
 * Intelligently selects LLM models based on task requirements,
 * user overrides, and quality gates. Provides comprehensive
 * telemetry for debugging and monitoring.
 */

import { log, emit, TelemetryEvents } from "../utils/telemetry.js";
import {
  getModelConfig,
  isModelEnabled,
  MODEL_REGISTRY,
  type ModelConfig,
  type ModelTier,
  type ModelProvider,
} from "../config/models.js";
import {
  type CeeTask,
  getDefaultModelForTask,
  isQualityRequired,
  isValidCeeTask,
  isTierShortcut,
  type TierShortcut,
} from "../config/model-routing.js";
import { config } from "../config/index.js";

/**
 * Configuration for model selection (injectable for testing)
 */
export interface ModelSelectionConfig {
  enabled: boolean;
  overrideAllowed: boolean;
  fallbackEnabled: boolean;
  qualityGateEnabled: boolean;
  latencyAnomalyThresholdMs: number;
  taskModels: Record<string, string | undefined>;
}

/**
 * Default config when feature is disabled
 */
const DEFAULT_CONFIG: ModelSelectionConfig = {
  enabled: false,
  overrideAllowed: true,
  fallbackEnabled: true,
  qualityGateEnabled: true,
  latencyAnomalyThresholdMs: 10000,
  taskModels: {},
};

/**
 * Result of model selection including metadata for debugging
 */
export interface ModelSelectionResult {
  /** Selected model ID */
  modelId: string;
  /** Model provider */
  provider: ModelProvider;
  /** Model tier */
  tier: ModelTier;
  /** How the model was selected */
  source: "default" | "override" | "fallback" | "env" | "legacy";
  /** Original request if override was denied */
  originalRequest?: string;
  /** Warnings generated during selection */
  warnings: string[];
}

/**
 * Input for model selection
 */
export interface ModelSelectionInput {
  /** CEE task being performed */
  task: CeeTask;
  /** Optional override from X-CEE-Model-Override header */
  override?: string;
  /** Correlation ID for telemetry */
  correlationId?: string;
}

/**
 * Custom telemetry events for model selection
 */
const ModelTelemetryEvents = {
  ModelSelected: "cee.model.selected",
  ModelOverrideAccepted: "cee.model.override_accepted",
  ModelOverrideRejected: "cee.model.override_rejected",
  ModelQualityGateApplied: "cee.model.quality_gate_applied",
  ModelFallbackApplied: "cee.model.fallback_applied",
  ModelFallbackTriggered: "cee.model.fallback_triggered",
  ModelLatencyAnomaly: "cee.llm.call.latency_anomaly",
  ModelQualityIssue: "cee.model.quality_issue",
} as const;

/**
 * Get the effective model selection config
 * Returns injected config if provided, otherwise reads from global config
 */
function getEffectiveConfig(injectedConfig?: ModelSelectionConfig): ModelSelectionConfig {
  if (injectedConfig) {
    return injectedConfig;
  }

  // Safely access config - may fail in test environments
  try {
    return config.cee.modelSelection as ModelSelectionConfig;
  } catch {
    // Config validation failed - use defaults
    return DEFAULT_CONFIG;
  }
}

/**
 * Select the appropriate model for a CEE task
 *
 * Selection precedence:
 * 1. Feature flag check (disabled = always use gpt-4o)
 * 2. User override validation (if allowed)
 * 3. Quality gate enforcement (prevents downgrade of critical tasks)
 * 4. Task-specific env var override
 * 5. Task default from TASK_MODEL_DEFAULTS
 *
 * @param input - Task and override info
 * @param injectedConfig - Optional config override for testing
 */
export function selectModel(
  input: ModelSelectionInput,
  injectedConfig?: ModelSelectionConfig
): ModelSelectionResult {
  const warnings: string[] = [];
  const modelSelectionConfig = getEffectiveConfig(injectedConfig);

  // Feature flag check - if disabled, use legacy behaviour
  if (!modelSelectionConfig.enabled) {
    return {
      modelId: "gpt-4o",
      provider: "openai",
      tier: "quality",
      source: "legacy",
      warnings: [],
    };
  }

  // Get task default
  const envOverride = getEnvModelForTask(input.task, modelSelectionConfig.taskModels);
  const taskDefault = envOverride ?? getDefaultModelForTask(input.task);

  // No user override requested - use default
  if (!input.override || input.override === "_default") {
    const result = resolveModel(taskDefault, envOverride ? "env" : "default", warnings, modelSelectionConfig.fallbackEnabled);
    emitSelectionTelemetry(input, result);
    return result;
  }

  // Handle tier shortcuts
  if (input.override === "_fast") {
    if (isQualityRequired(input.task)) {
      warnings.push(`Task '${input.task}' requires quality tier; ignoring _fast override`);
      log.warn(
        { task: input.task, correlationId: input.correlationId },
        "Fast tier override rejected for quality-required task"
      );
      emit(ModelTelemetryEvents.ModelOverrideRejected, {
        task: input.task,
        requested: "_fast",
        reason: "quality_required",
        correlationId: input.correlationId,
      });
      const result = resolveModel(taskDefault, "default", warnings, modelSelectionConfig.fallbackEnabled);
      emitSelectionTelemetry(input, result);
      return result;
    }
    const result = resolveModel("gpt-4o-mini", "override", warnings, modelSelectionConfig.fallbackEnabled);
    emit(ModelTelemetryEvents.ModelOverrideAccepted, {
      task: input.task,
      model: "gpt-4o-mini",
      shortcut: "_fast",
      correlationId: input.correlationId,
    });
    emitSelectionTelemetry(input, result);
    return result;
  }

  if (input.override === "_quality") {
    const result = resolveModel("gpt-4o", "override", warnings, modelSelectionConfig.fallbackEnabled);
    emit(ModelTelemetryEvents.ModelOverrideAccepted, {
      task: input.task,
      model: "gpt-4o",
      shortcut: "_quality",
      correlationId: input.correlationId,
    });
    emitSelectionTelemetry(input, result);
    return result;
  }

  // Check if overrides are allowed
  if (!modelSelectionConfig.overrideAllowed) {
    warnings.push("Model override is disabled; using default");
    const result = resolveModel(taskDefault, "default", warnings, modelSelectionConfig.fallbackEnabled);
    emitSelectionTelemetry(input, result);
    return result;
  }

  // Validate requested model
  const requestedConfig = getModelConfig(input.override);

  if (!requestedConfig) {
    warnings.push(`Unknown model '${input.override}'; using default`);
    log.warn(
      { model: input.override, correlationId: input.correlationId },
      "Unknown model requested"
    );
    emit(ModelTelemetryEvents.ModelOverrideRejected, {
      task: input.task,
      requested: input.override,
      reason: "unknown_model",
      correlationId: input.correlationId,
    });
    const result = resolveModel(taskDefault, "default", warnings, modelSelectionConfig.fallbackEnabled);
    emitSelectionTelemetry(input, result);
    return result;
  }

  if (!requestedConfig.enabled) {
    warnings.push(`Model '${input.override}' is disabled; using default`);
    log.warn(
      { model: input.override, correlationId: input.correlationId },
      "Disabled model requested"
    );
    emit(ModelTelemetryEvents.ModelOverrideRejected, {
      task: input.task,
      requested: input.override,
      reason: "model_disabled",
      correlationId: input.correlationId,
    });
    const result = resolveModel(taskDefault, "default", warnings, modelSelectionConfig.fallbackEnabled);
    emitSelectionTelemetry(input, result);
    return result;
  }

  // Quality gate: prevent downgrade for critical tasks
  if (
    isQualityRequired(input.task) &&
    requestedConfig.tier === "fast" &&
    modelSelectionConfig.qualityGateEnabled
  ) {
    warnings.push(`Task '${input.task}' requires quality tier; upgrade applied`);
    log.warn(
      { task: input.task, requested: input.override, correlationId: input.correlationId },
      "Quality gate prevented model downgrade"
    );
    emit(ModelTelemetryEvents.ModelQualityGateApplied, {
      task: input.task,
      requested: input.override,
      applied: taskDefault,
      correlationId: input.correlationId,
    });
    const result = resolveModel(taskDefault, "default", warnings, modelSelectionConfig.fallbackEnabled);
    emitSelectionTelemetry(input, result);
    return result;
  }

  // Override accepted
  emit(ModelTelemetryEvents.ModelOverrideAccepted, {
    task: input.task,
    model: input.override,
    correlationId: input.correlationId,
  });

  const result: ModelSelectionResult = {
    modelId: requestedConfig.id,
    provider: requestedConfig.provider,
    tier: requestedConfig.tier,
    source: "override",
    warnings,
  };

  emitSelectionTelemetry(input, result);
  return result;
}

/**
 * Resolve a model ID to a full result, with fallback if needed
 */
function resolveModel(
  modelId: string,
  source: "default" | "override" | "env",
  warnings: string[],
  fallbackEnabled: boolean
): ModelSelectionResult {
  const modelConfig = getModelConfig(modelId);

  // Model exists and is enabled
  if (modelConfig && modelConfig.enabled) {
    return {
      modelId: modelConfig.id,
      provider: modelConfig.provider,
      tier: modelConfig.tier,
      source,
      warnings,
    };
  }

  // Fallback required
  if (fallbackEnabled) {
    const fallback = findFallbackModel(modelId);
    if (fallback) {
      warnings.push(`Model '${modelId}' unavailable; using fallback '${fallback.id}'`);
      log.warn({ requested: modelId, fallback: fallback.id }, "Model fallback applied");
      emit(ModelTelemetryEvents.ModelFallbackApplied, {
        requested: modelId,
        fallback: fallback.id,
      });

      return {
        modelId: fallback.id,
        provider: fallback.provider,
        tier: fallback.tier,
        source: "fallback",
        originalRequest: modelId,
        warnings,
      };
    }
  }

  // Ultimate fallback: gpt-4o (always available)
  warnings.push(`No suitable model found; using gpt-4o`);
  return {
    modelId: "gpt-4o",
    provider: "openai",
    tier: "quality",
    source: "fallback",
    originalRequest: modelId,
    warnings,
  };
}

/**
 * Find a fallback model when the requested model is unavailable
 * Prioritizes enabled models of same or higher tier
 */
function findFallbackModel(requestedId: string): ModelConfig | undefined {
  const requested = getModelConfig(requestedId);
  if (!requested) {
    // Unknown model, fallback to gpt-4o
    return getModelConfig("gpt-4o");
  }

  // Find enabled model of same or higher tier
  const tierPriority: ModelTier[] = ["fast", "quality", "premium"];
  const requestedTierIndex = tierPriority.indexOf(requested.tier);

  for (let i = requestedTierIndex; i < tierPriority.length; i++) {
    const tier = tierPriority[i];
    const candidate = Object.values(MODEL_REGISTRY).find(
      (m) => m.enabled && m.tier === tier && m.id !== requestedId
    );
    if (candidate) return candidate;
  }

  return undefined;
}

/**
 * Get task-specific model from environment config
 */
function getEnvModelForTask(
  task: CeeTask,
  taskModels: Record<string, string | undefined>
): string | undefined {
  const map: Partial<Record<CeeTask, string | undefined>> = {
    clarification: taskModels.clarification,
    preflight: taskModels.preflight,
    draft_graph: taskModels.draftGraph,
    bias_check: taskModels.biasCheck,
    evidence_helper: taskModels.evidenceHelper,
    sensitivity_coach: taskModels.sensitivityCoach,
    options: taskModels.options,
    explainer: taskModels.explainer,
    repair_graph: taskModels.repairGraph,
    critique_graph: taskModels.critiqueGraph,
  };
  return map[task];
}

/**
 * Emit selection telemetry
 */
function emitSelectionTelemetry(
  input: ModelSelectionInput,
  result: ModelSelectionResult
): void {
  emit(ModelTelemetryEvents.ModelSelected, {
    task: input.task,
    model: result.modelId,
    tier: result.tier,
    source: result.source,
    hasWarnings: result.warnings.length > 0,
    correlationId: input.correlationId,
  });
}

/**
 * Check for latency anomaly and emit telemetry if detected
 */
export function checkLatencyAnomaly(
  modelId: string,
  actualLatencyMs: number,
  task: string,
  correlationId?: string
): void {
  let threshold = 10000;
  try {
    threshold = config.cee.modelSelection.latencyAnomalyThresholdMs;
  } catch {
    // Use default
  }

  const modelConfig = getModelConfig(modelId);
  if (!modelConfig) return;

  const expectedLatency = modelConfig.averageLatencyMs;

  // Flag if >3x expected or >absolute threshold
  if (actualLatencyMs > expectedLatency * 3 || actualLatencyMs > threshold) {
    log.warn(
      {
        modelId,
        task,
        actualLatencyMs,
        expectedLatencyMs: expectedLatency,
        correlationId,
      },
      "LLM latency anomaly detected"
    );

    emit(ModelTelemetryEvents.ModelLatencyAnomaly, {
      modelId,
      task,
      actualLatencyMs,
      expectedLatencyMs: expectedLatency,
      ratio: actualLatencyMs / expectedLatency,
      correlationId,
    });
  }
}

/**
 * Track model quality issues
 */
export interface QualityEvent {
  modelId: string;
  task: string;
  success: boolean;
  issue?: "empty_response" | "parse_failure" | "validation_failed" | "timeout";
  correlationId?: string;
}

export function trackQuality(event: QualityEvent): void {
  if (!event.success && event.issue) {
    emit(`cee.model.quality.${event.issue}`, {
      modelId: event.modelId,
      task: event.task,
      correlationId: event.correlationId,
    });

    log.warn(
      {
        modelId: event.modelId,
        task: event.task,
        issue: event.issue,
        correlationId: event.correlationId,
      },
      "Model quality issue detected"
    );
  }
}

/**
 * Validate a model ID for override requests
 * Returns validation result with reason if invalid
 */
export function validateModelRequest(
  modelId: string
): { valid: boolean; reason?: string } {
  // Check if it's a tier shortcut
  if (isTierShortcut(modelId)) {
    return { valid: true };
  }

  // Check allowlist
  const modelConfig = getModelConfig(modelId);
  if (!modelConfig) {
    return { valid: false, reason: "unknown_model" };
  }

  // Check enabled
  if (!modelConfig.enabled) {
    return { valid: false, reason: "model_disabled" };
  }

  // Check provider available
  if (modelConfig.provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return { valid: false, reason: "provider_not_configured" };
  }

  if (modelConfig.provider === "openai" && !process.env.OPENAI_API_KEY) {
    return { valid: false, reason: "provider_not_configured" };
  }

  return { valid: true };
}

/**
 * Get model selection headers for response
 */
export function getModelResponseHeaders(result: ModelSelectionResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-CEE-Model-Used": result.modelId,
    "X-CEE-Model-Tier": result.tier,
    "X-CEE-Model-Source": result.source,
  };

  if (result.warnings.length > 0) {
    headers["X-CEE-Model-Warnings"] = result.warnings.join("; ");
  }

  if (result.originalRequest) {
    headers["X-CEE-Model-Original-Request"] = result.originalRequest;
  }

  return headers;
}
