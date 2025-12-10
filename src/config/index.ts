/**
 * Centralized Configuration Module
 *
 * Provides type-safe, validated access to all environment variables.
 * Replaces scattered `process.env` usage throughout the codebase.
 *
 * Benefits:
 * - Type safety: All config values have proper types
 * - Validation: Invalid configurations fail fast at startup
 * - Testability: Easy to mock and override in tests
 * - Documentation: Single source of truth for all configuration
 * - Defaults: Sensible defaults for optional values
 */

import { z } from "zod";

/**
 * Custom boolean coercion that handles string "false" and "true"
 */
const booleanString = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    if (typeof val === "string") {
      const lower = val.toLowerCase().trim();
      if (lower === "false" || lower === "0" || lower === "") return false;
      if (lower === "true" || lower === "1") return true;
      return Boolean(val); // fallback
    }
    return Boolean(val);
  });

/**
 * Optional URL string that treats empty/undefined as undefined
 * In test mode, invalid URLs are treated as undefined (lenient)
 * In production mode, invalid URLs fail validation (strict)
 */
const optionalUrl = z
  .union([z.string(), z.undefined()])
  .transform((val, ctx) => {
    // Handle undefined, null, or empty string
    if (val === undefined || val === null || val === "") {
      return undefined;
    }
    // Validate URL format
    try {
      new URL(val);
      return val;
    } catch {
      // In test mode, be lenient - return undefined for invalid URLs
      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || Boolean(process.env.VITEST);
      if (isTestEnv) {
        return undefined;
      }
      // In production, fail validation
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid url`,
      });
      return z.NEVER;
    }
  });

/**
 * Environment enum
 */
const Environment = z.enum(["development", "test", "production"]);

/**
 * LLM Provider enum
 */
const LLMProvider = z.enum(["anthropic", "openai", "fixtures"]);

/**
 * Log Level enum
 */
const LogLevel = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);

/**
 * PII Redaction Mode
 * - strict: Aggressive redaction including IPs, URLs, file paths, potential names
 * - standard: Standard redaction of emails, phones, API keys, tokens, credit cards, SSNs
 * - off: No redaction
 *
 * Case-insensitive, defaults to "standard" for invalid values
 */
const PIIRedactionMode = z
  .union([z.string(), z.undefined()])
  .transform((val): "strict" | "standard" | "off" => {
    if (!val) return "standard";
    const lower = val.toLowerCase().trim();
    if (lower === "strict") return "strict";
    if (lower === "off") return "off";
    return "standard"; // default for invalid values
  });

/**
 * Configuration Schema
 */
const ConfigSchema = z.object({
  // Server Configuration
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    nodeEnv: Environment.default("development"),
    logLevel: LogLevel.default("info"),
    version: z.string().default("1.0.0"),
    baseUrl: optionalUrl,
    deprecationSunset: z.string().default("2025-12-01"), // API deprecation sunset date
  }),

  // Authentication
  auth: z.object({
    assistApiKeys: z
      .string()
      .transform((val) => val.split(",").map((k) => k.trim()))
      .optional(),
    assistApiKey: z.string().optional(), // Legacy single key support
    hmacSecret: z.string().optional(),
    hmacMaxSkewMs: z.coerce.number().int().positive().default(300000), // 5 minutes
    islApiKey: z.string().optional(),
    shareSecret: z.string().optional(),
  }),

  // LLM Configuration
  llm: z.object({
    provider: LLMProvider.default("openai"), // matches DEFAULT_PROVIDER in router.ts
    model: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    failoverProviders: z
      .string()
      .transform((val) => val.split(",").map((p) => p.trim()))
      .optional(),
    providersConfigPath: z.string().optional(),
  }),

  // Feature Flags
  features: z.object({
    grounding: booleanString.default(false), // Conservative default - opt-in for production safety
    critique: booleanString.default(true),
    clarifier: booleanString.default(true),
    piiGuard: booleanString.default(false),
    shareReview: booleanString.default(false),
    enableLegacySSE: booleanString.default(false),
  }),

  // Prompt Cache Configuration
  promptCache: z.object({
    enabled: booleanString.default(false),
    maxSize: z.coerce.number().int().positive().default(100), // matches original default
    ttlMs: z.coerce.number().int().positive().default(3600000), // 1 hour
    anthropicEnabled: booleanString.default(true), // default to enabled for cache hints
  }),

  // Rate Limiting
  rateLimits: z.object({
    defaultRpm: z.coerce.number().int().positive().default(120),
    sseRpm: z.coerce.number().int().positive().default(20),
  }),

  // Redis Configuration
  redis: z.object({
    url: z.string().optional(),
    tls: booleanString.default(false),
    namespace: z.string().default("assistants"),
    connectTimeout: z.coerce.number().int().positive().default(10000),
    commandTimeout: z.coerce.number().int().positive().default(5000),
    quotaEnabled: booleanString.default(false),
    hmacNonceEnabled: booleanString.default(false),
    promptCacheEnabled: booleanString.default(false),
  }),

  // SSE Configuration
  sse: z.object({
    resumeLiveEnabled: booleanString.default(true),
    resumeLiveRpm: z.coerce.number().int().positive().optional(), // SSE resume rate limit (falls back to sseRpm)
    resumeSecret: z.string().optional(),
    resumeTtlMs: z.coerce.number().int().positive().default(900000), // 15 minutes (matches original default)
    snapshotTtlSec: z.coerce.number().int().positive().default(900), // 15 minutes
    stateTtlSec: z.coerce.number().int().positive().default(900), // 15 minutes
    bufferMaxEvents: z.coerce.number().int().positive().default(1000),
    bufferMaxSizeMb: z.coerce.number().positive().default(10),
    bufferCompress: booleanString.default(true),
    bufferTrimPayloads: booleanString.default(true),
  }),

  // CEE Configuration
  cee: z.object({
    draftFeatureVersion: z.string().optional(),
    draftArchetypesEnabled: booleanString.default(true), // Default true to match pipeline.ts behavior
    draftStructuralWarningsEnabled: booleanString.default(false),
    refinementEnabled: booleanString.default(false), // Enable draft refinement feature
    decisionReviewRateLimitRpm: z.coerce.number().int().positive().default(30), // Decision review rate limit
    optionsFeatureVersion: z.string().optional(),
    explainFeatureVersion: z.string().optional(),
    evidenceHelperFeatureVersion: z.string().optional(),
    biasCheckFeatureVersion: z.string().optional(),
    biasStructuralEnabled: booleanString.default(false),
    biasMitigationPatchesEnabled: booleanString.default(false),
    sensitivityCoachFeatureVersion: z.string().optional(),
    teamPerspectivesFeatureVersion: z.string().optional(),
    causalValidationEnabled: booleanString.default(false),
    // Preflight validation settings
    preflightEnabled: booleanString.default(false), // Enable input validation before draft
    preflightStrict: booleanString.default(false), // If true, reject on preflight failure
    preflightReadinessThreshold: z.coerce.number().min(0).max(1).default(0.4), // Min readiness score to proceed
    // Mandatory clarification settings (Phase 5)
    clarificationEnforced: booleanString.default(false), // If true, require clarification based on thresholds
    clarificationThresholdAllowDirect: z.coerce.number().min(0).max(1).default(0.8), // >= this = allow direct draft
    clarificationThresholdOneRound: z.coerce.number().min(0).max(1).default(0.4), // >= this = require 1 round, < this = require 2+ rounds
    // Pre-decision checklist and framing nudges (Phase 6)
    preDecisionChecksEnabled: booleanString.default(false), // If true, include pre-decision checks in draft response
    // Multi-turn clarifier integration
    clarifierEnabled: booleanString.default(false), // If true, enable clarifier integration in draft-graph
    clarifierMaxRoundsDefault: z.coerce.number().int().min(0).max(10).default(5), // Default max clarifier rounds
    clarifierQualityThreshold: z.coerce.number().min(0).max(10).default(8.0), // Quality score to stop asking
    clarifierStabilityThreshold: z.coerce.number().int().min(0).default(2), // Max graph changes for stability
    clarifierMinImprovementThreshold: z.coerce.number().min(0).max(10).default(0.5), // Min quality improvement per round
    clarifierQuestionCacheTtlSeconds: z.coerce.number().int().min(0).default(3600), // Question cache TTL
    // Bias detection confidence thresholding (Phase 6)
    biasConfidenceThreshold: z.coerce.number().min(0).max(1).default(0.3), // Minimum confidence to report bias finding
    // Response caching (Phase 7)
    cacheResponseEnabled: booleanString.default(false), // If true, cache draft-graph responses
    cacheResponseTtlMs: z.coerce.number().min(0).default(300000), // Cache TTL in milliseconds (default 5 min)
    cacheResponseMaxSize: z.coerce.number().min(1).default(100), // Maximum cache entries
    // Graph structure validation (Phase: Graph Validation)
    enforceSingleGoal: booleanString.default(true), // If true, merge multiple goals into compound goal
    // Per-operation model selection for tiered cost optimization
    models: z.object({
      draft: z.string().optional(),
      options: z.string().optional(),
      repair: z.string().optional(),
      clarification: z.string().optional(),
      critique: z.string().optional(),
      validation: z.string().optional(),
    }).default({}),
    // Per-operation max tokens limits
    maxTokens: z.object({
      draft: z.coerce.number().int().positive().optional(),
      options: z.coerce.number().int().positive().optional(),
      repair: z.coerce.number().int().positive().optional(),
      clarification: z.coerce.number().int().positive().optional(),
      critique: z.coerce.number().int().positive().optional(),
      validation: z.coerce.number().int().positive().optional(),
    }).default({}),
    // Tiered model selection (Phase: Model Selection)
    modelSelection: z.object({
      enabled: booleanString.default(false), // Master switch for tiered model selection
      overrideAllowed: booleanString.default(true), // Allow X-CEE-Model-Override header
      fallbackEnabled: booleanString.default(true), // Enable fallback to higher tier on failure
      qualityGateEnabled: booleanString.default(true), // Prevent downgrade of quality-required tasks
      latencyAnomalyThresholdMs: z.coerce.number().int().positive().default(10000), // Alert threshold
      // Per-task model defaults (override TASK_MODEL_DEFAULTS from model-routing.ts)
      taskModels: z.object({
        clarification: z.string().optional(),
        preflight: z.string().optional(),
        draftGraph: z.string().optional(),
        biasCheck: z.string().optional(),
        evidenceHelper: z.string().optional(),
        sensitivityCoach: z.string().optional(),
        options: z.string().optional(),
        explainer: z.string().optional(),
        repairGraph: z.string().optional(),
        critiqueGraph: z.string().optional(),
      }).default({}),
    }).default({}),
  }),

  // ISL (Inference Service Layer) Configuration
  // Note: timeoutMs and maxRetries are stored as strings and validated/clamped
  // by parseTimeout() and parseMaxRetries() in src/adapters/isl/config.ts
  isl: z.object({
    baseUrl: optionalUrl,
    apiKey: z.string().optional(),
    timeoutMs: z.string().optional(), // Validated by parseTimeout()
    maxRetries: z.string().optional(), // Validated by parseMaxRetries()
  }),

  // Graph Limits
  graph: z.object({
    maxNodes: z.coerce.number().int().positive().default(100),
    maxEdges: z.coerce.number().int().positive().default(200),
    limitMaxNodes: z.coerce.number().int().positive().default(100),
    limitMaxEdges: z.coerce.number().int().positive().default(200),
    costMaxUsd: z.coerce.number().positive().default(1.0),
  }),

  // Validation Configuration
  validation: z.object({
    engineBaseUrl: optionalUrl,
    cacheEnabled: booleanString.default(false),
    cacheMaxSize: z.coerce.number().int().positive().default(500),
    cacheTtlMs: z.coerce.number().int().positive().default(3600000), // 1 hour
  }),

  // Performance Monitoring
  performance: z.object({
    metricsEnabled: booleanString.default(true),
    slowThresholdMs: z.coerce.number().int().positive().default(5000),
    p99ThresholdMs: z.coerce.number().int().positive().default(5000),
  }),

  // PII Protection
  pii: z.object({
    redactionMode: PIIRedactionMode.default("standard"),
  }),

  // Share Storage
  share: z.object({
    storageInMemory: booleanString.default(false),
  }),

  // Testing
  testing: z.object({
    isVitest: booleanString.default(false),
  }),

  // Prompt Management
  prompts: z.object({
    enabled: booleanString.default(false), // Master switch for prompt management
    storeType: z.enum(["file", "postgres"]).default("file"), // Storage backend type
    storePath: z.string().default("data/prompts.json"), // Path to prompts JSON file (file store)
    backupEnabled: booleanString.default(true), // Create backups before writes (file store)
    maxBackups: z.coerce.number().int().positive().default(10), // Max backup files to keep (file store)
    postgresUrl: z.string().optional(), // PostgreSQL connection string (postgres store)
    postgresPoolSize: z.coerce.number().int().positive().default(10), // Connection pool size (postgres store)
    postgresSsl: booleanString.default(false), // Use SSL for PostgreSQL connection
    braintrustEnabled: booleanString.default(false), // Enable Braintrust experiment tracking
    braintrustProject: z.string().default("olumi-prompts"), // Braintrust project name
    adminApiKey: z.string().optional(), // Admin API key for prompt management (full access)
    adminApiKeyRead: z.string().optional(), // Read-only admin API key
    adminAllowedIPs: z.string().optional(), // Comma-separated list of allowed IPs (empty = all allowed)
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse and validate configuration from environment variables
 */
function parseConfig(): Config {
  const env = process.env;

  const rawConfig = {
    server: {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
      version: env.SERVICE_VERSION,
      baseUrl: env.BASE_URL,
      deprecationSunset: env.DEPRECATION_SUNSET,
    },
    auth: {
      assistApiKeys: env.ASSIST_API_KEYS,
      assistApiKey: env.ASSIST_API_KEY,
      // CEE_HMAC_SECRET preferred; falls back to HMAC_SECRET
      hmacSecret: env.CEE_HMAC_SECRET ?? env.HMAC_SECRET,
      hmacMaxSkewMs: env.HMAC_MAX_SKEW_MS,
      islApiKey: env.ISL_API_KEY,
      // CEE_SHARE_SECRET preferred; falls back to SHARE_SECRET
      shareSecret: env.CEE_SHARE_SECRET ?? env.SHARE_SECRET,
    },
    llm: {
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      failoverProviders: env.LLM_FAILOVER_PROVIDERS,
      providersConfigPath: env.PROVIDERS_CONFIG_PATH,
    },
    features: {
      // CEE_GROUNDING_ENABLED preferred; falls back to GROUNDING_ENABLED
      grounding: env.CEE_GROUNDING_ENABLED ?? env.GROUNDING_ENABLED,
      critique: env.CRITIQUE_ENABLED,
      clarifier: env.CLARIFIER_ENABLED,
      piiGuard: env.PII_GUARD_ENABLED,
      shareReview: env.SHARE_REVIEW_ENABLED,
      enableLegacySSE: env.ENABLE_LEGACY_SSE,
    },
    promptCache: {
      enabled: env.PROMPT_CACHE_ENABLED,
      maxSize: env.PROMPT_CACHE_MAX_SIZE,
      ttlMs: env.PROMPT_CACHE_TTL_MS,
      anthropicEnabled: env.ANTHROPIC_PROMPT_CACHE_ENABLED,
    },
    rateLimits: {
      defaultRpm: env.RATE_LIMIT_RPM,
      sseRpm: env.SSE_RATE_LIMIT_RPM,
    },
    redis: {
      url: env.REDIS_URL,
      tls: env.REDIS_TLS,
      namespace: env.REDIS_NAMESPACE,
      connectTimeout: env.REDIS_CONNECT_TIMEOUT,
      commandTimeout: env.REDIS_COMMAND_TIMEOUT,
      quotaEnabled: env.REDIS_QUOTA_ENABLED,
      hmacNonceEnabled: env.REDIS_HMAC_NONCE_ENABLED,
      promptCacheEnabled: env.REDIS_PROMPT_CACHE_ENABLED,
    },
    sse: {
      resumeLiveEnabled: env.SSE_RESUME_LIVE_ENABLED,
      resumeLiveRpm: env.SSE_RESUME_LIVE_RPM,
      resumeSecret: env.SSE_RESUME_SECRET,
      resumeTtlMs: env.SSE_RESUME_TTL_MS,
      snapshotTtlSec: env.SSE_SNAPSHOT_TTL_SEC,
      stateTtlSec: env.SSE_STATE_TTL_SEC,
      bufferMaxEvents: env.SSE_BUFFER_MAX_EVENTS,
      bufferMaxSizeMb: env.SSE_BUFFER_MAX_SIZE_MB,
      bufferCompress: env.SSE_BUFFER_COMPRESS,
      bufferTrimPayloads: env.SSE_BUFFER_TRIM_PAYLOADS,
    },
    cee: {
      draftFeatureVersion: env.CEE_DRAFT_FEATURE_VERSION,
      draftArchetypesEnabled: env.CEE_DRAFT_ARCHETYPES_ENABLED,
      draftStructuralWarningsEnabled: env.CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED,
      refinementEnabled: env.CEE_REFINEMENT_ENABLED,
      decisionReviewRateLimitRpm: env.CEE_DECISION_REVIEW_RATE_LIMIT_RPM,
      optionsFeatureVersion: env.CEE_OPTIONS_FEATURE_VERSION,
      explainFeatureVersion: env.CEE_EXPLAIN_FEATURE_VERSION,
      evidenceHelperFeatureVersion: env.CEE_EVIDENCE_HELPER_FEATURE_VERSION,
      biasCheckFeatureVersion: env.CEE_BIAS_CHECK_FEATURE_VERSION,
      biasStructuralEnabled: env.CEE_BIAS_STRUCTURAL_ENABLED,
      biasMitigationPatchesEnabled: env.CEE_BIAS_MITIGATION_PATCHES_ENABLED,
      sensitivityCoachFeatureVersion: env.CEE_SENSITIVITY_COACH_FEATURE_VERSION,
      teamPerspectivesFeatureVersion: env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION,
      causalValidationEnabled: env.CEE_CAUSAL_VALIDATION_ENABLED,
      preflightEnabled: env.CEE_PREFLIGHT_ENABLED,
      preflightStrict: env.CEE_PREFLIGHT_STRICT,
      preflightReadinessThreshold: env.CEE_PREFLIGHT_READINESS_THRESHOLD,
      // Mandatory clarification settings
      clarificationEnforced: env.CEE_CLARIFICATION_ENFORCED,
      clarificationThresholdAllowDirect: env.CEE_CLARIFICATION_THRESHOLD_ALLOW_DIRECT,
      clarificationThresholdOneRound: env.CEE_CLARIFICATION_THRESHOLD_ONE_ROUND,
      // Pre-decision checklist and framing nudges
      preDecisionChecksEnabled: env.CEE_PRE_DECISION_CHECKS_ENABLED,
      // Multi-turn clarifier integration
      clarifierEnabled: env.CEE_CLARIFIER_ENABLED,
      clarifierMaxRoundsDefault: env.CEE_CLARIFIER_MAX_ROUNDS_DEFAULT,
      clarifierQualityThreshold: env.CEE_CLARIFIER_QUALITY_THRESHOLD,
      clarifierStabilityThreshold: env.CEE_CLARIFIER_STABILITY_THRESHOLD,
      clarifierMinImprovementThreshold: env.CEE_CLARIFIER_MIN_IMPROVEMENT_THRESHOLD,
      clarifierQuestionCacheTtlSeconds: env.CEE_CLARIFIER_QUESTION_CACHE_TTL_SECONDS,
      // Bias detection confidence thresholding
      biasConfidenceThreshold: env.CEE_BIAS_CONFIDENCE_THRESHOLD,
      // Response caching
      cacheResponseEnabled: env.CEE_CACHE_RESPONSE_ENABLED,
      cacheResponseTtlMs: env.CEE_CACHE_RESPONSE_TTL_MS,
      cacheResponseMaxSize: env.CEE_CACHE_RESPONSE_MAX_SIZE,
      // Graph structure validation
      enforceSingleGoal: env.CEE_ENFORCE_SINGLE_GOAL,
      // Per-operation model selection
      models: {
        draft: env.CEE_MODEL_DRAFT,
        options: env.CEE_MODEL_OPTIONS,
        repair: env.CEE_MODEL_REPAIR,
        clarification: env.CEE_MODEL_CLARIFICATION,
        critique: env.CEE_MODEL_CRITIQUE,
        validation: env.CEE_MODEL_VALIDATION,
      },
      // Per-operation max tokens limits
      maxTokens: {
        draft: env.CEE_MAX_TOKENS_DRAFT,
        options: env.CEE_MAX_TOKENS_OPTIONS,
        repair: env.CEE_MAX_TOKENS_REPAIR,
        clarification: env.CEE_MAX_TOKENS_CLARIFICATION,
        critique: env.CEE_MAX_TOKENS_CRITIQUE,
        validation: env.CEE_MAX_TOKENS_VALIDATION,
      },
      // Tiered model selection
      modelSelection: {
        enabled: env.CEE_MODEL_SELECTION_ENABLED,
        overrideAllowed: env.CEE_MODEL_OVERRIDE_ALLOWED,
        fallbackEnabled: env.CEE_MODEL_FALLBACK_ENABLED,
        qualityGateEnabled: env.CEE_MODEL_QUALITY_GATE_ENABLED,
        latencyAnomalyThresholdMs: env.CEE_MODEL_LATENCY_ANOMALY_THRESHOLD_MS,
        taskModels: {
          clarification: env.CEE_MODEL_TASK_CLARIFICATION,
          preflight: env.CEE_MODEL_TASK_PREFLIGHT,
          draftGraph: env.CEE_MODEL_TASK_DRAFT_GRAPH,
          biasCheck: env.CEE_MODEL_TASK_BIAS_CHECK,
          evidenceHelper: env.CEE_MODEL_TASK_EVIDENCE_HELPER,
          sensitivityCoach: env.CEE_MODEL_TASK_SENSITIVITY_COACH,
          options: env.CEE_MODEL_TASK_OPTIONS,
          explainer: env.CEE_MODEL_TASK_EXPLAINER,
          repairGraph: env.CEE_MODEL_TASK_REPAIR_GRAPH,
          critiqueGraph: env.CEE_MODEL_TASK_CRITIQUE_GRAPH,
        },
      },
    },
    isl: {
      baseUrl: env.ISL_BASE_URL,
      apiKey: env.ISL_API_KEY,
      timeoutMs: env.ISL_TIMEOUT_MS,
      maxRetries: env.ISL_MAX_RETRIES,
    },
    graph: {
      maxNodes: env.GRAPH_MAX_NODES,
      maxEdges: env.GRAPH_MAX_EDGES,
      limitMaxNodes: env.LIMIT_MAX_NODES,
      limitMaxEdges: env.LIMIT_MAX_EDGES,
      costMaxUsd: env.COST_MAX_USD,
    },
    validation: {
      engineBaseUrl: env.ENGINE_BASE_URL,
      cacheEnabled: env.VALIDATION_CACHE_ENABLED,
      cacheMaxSize: env.VALIDATION_CACHE_MAX_SIZE,
      cacheTtlMs: env.VALIDATION_CACHE_TTL_MS,
    },
    performance: {
      metricsEnabled: env.PERF_METRICS_ENABLED,
      slowThresholdMs: env.PERF_SLOW_THRESHOLD_MS,
      p99ThresholdMs: env.PERF_P99_THRESHOLD_MS,
    },
    pii: {
      redactionMode: env.PII_REDACTION_MODE,
    },
    share: {
      storageInMemory: env.SHARE_STORAGE_INMEMORY,
    },
    testing: {
      isVitest: env.VITEST,
    },
    prompts: {
      enabled: env.PROMPTS_ENABLED,
      storeType: env.PROMPTS_STORE_TYPE,
      storePath: env.PROMPTS_STORE_PATH,
      backupEnabled: env.PROMPTS_BACKUP_ENABLED,
      maxBackups: env.PROMPTS_MAX_BACKUPS,
      postgresUrl: env.PROMPTS_POSTGRES_URL,
      postgresPoolSize: env.PROMPTS_POSTGRES_POOL_SIZE,
      postgresSsl: env.PROMPTS_POSTGRES_SSL,
      braintrustEnabled: env.PROMPTS_BRAINTRUST_ENABLED,
      braintrustProject: env.BRAINTRUST_PROJECT,
      adminApiKey: env.ADMIN_API_KEY,
      adminApiKeyRead: env.ADMIN_API_KEY_READ,
      adminAllowedIPs: env.ADMIN_ALLOWED_IPS,
    },
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Configuration validation failed:");
      console.error(JSON.stringify(error.issues, null, 2));
      throw new Error("Invalid configuration. Please check environment variables.");
    }
    throw error;
  }
}

/**
 * Lazy-initialized configuration using Proxy pattern
 *
 * Defers parsing until first property access. This allows tests
 * to set environment variables before the config is parsed, solving
 * the singleton initialization timing issue.
 *
 * Usage remains the same:
 * ```
 * import { config } from './config/index.js';
 * const port = config.server.port;
 * ```
 *
 * The config is parsed once on first access and cached thereafter.
 */
let _cachedConfig: Config | null = null;

export const config = new Proxy({} as Config, {
  get(_target, prop) {
    // Initialize on first access
    if (_cachedConfig === null) {
      _cachedConfig = parseConfig();
    }

    return (_cachedConfig as any)[prop];
  },

  // Support Object.keys(), Object.entries(), spread operator
  ownKeys(_target) {
    if (_cachedConfig === null) {
      _cachedConfig = parseConfig();
    }
    return Reflect.ownKeys(_cachedConfig);
  },

  getOwnPropertyDescriptor(_target, prop) {
    if (_cachedConfig === null) {
      _cachedConfig = parseConfig();
    }
    return Reflect.getOwnPropertyDescriptor(_cachedConfig, prop);
  },

  // Support has operator (prop in config)
  has(_target, prop) {
    if (_cachedConfig === null) {
      _cachedConfig = parseConfig();
    }
    return prop in _cachedConfig;
  },
});

/**
 * Get configuration (for compatibility and testing)
 */
export function getConfig(): Config {
  return config;
}

/**
 * Reset cached configuration (for testing only)
 *
 * This function is used by tests to clear the cached configuration
 * and force a fresh parse on next access. This allows tests to change
 * environment variables and re-initialize the config.
 *
 * @internal
 */
export function _resetConfigCache(): void {
  _cachedConfig = null;
}

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return config.server.nodeEnv === "production";
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return config.server.nodeEnv === "development";
}

/**
 * Check if running in test environment
 */
export function isTest(): boolean {
  return config.server.nodeEnv === "test" || config.testing.isVitest;
}
