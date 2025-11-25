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
 * Optional URL string that treats empty/undefined as undefined, validates otherwise
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
 * PII Redaction Mode enum
 */
const PIIRedactionMode = z.enum(["mask", "remove", "hash"]);

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
    provider: LLMProvider.default("anthropic"),
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
    grounding: booleanString.default(true),
    critique: booleanString.default(true),
    clarifier: booleanString.default(true),
    piiGuard: booleanString.default(false),
    shareReview: booleanString.default(false),
    enableLegacySSE: booleanString.default(false),
  }),

  // Prompt Cache Configuration
  promptCache: z.object({
    enabled: booleanString.default(false),
    maxSize: z.coerce.number().int().positive().default(1000),
    ttlMs: z.coerce.number().int().positive().default(3600000), // 1 hour
    anthropicEnabled: booleanString.default(false),
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
    resumeSecret: z.string().optional(),
    resumeTtlMs: z.coerce.number().int().positive().default(3600000), // 1 hour
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
    draftArchetypesEnabled: booleanString.default(false),
    draftStructuralWarningsEnabled: booleanString.default(false),
    optionsFeatureVersion: z.string().optional(),
    explainFeatureVersion: z.string().optional(),
    evidenceHelperFeatureVersion: z.string().optional(),
    biasCheckFeatureVersion: z.string().optional(),
    biasStructuralEnabled: booleanString.default(false),
    sensitivityCoachFeatureVersion: z.string().optional(),
    teamPerspectivesFeatureVersion: z.string().optional(),
    causalValidationEnabled: booleanString.default(false),
  }),

  // ISL (Inference Service Layer) Configuration
  isl: z.object({
    baseUrl: optionalUrl,
    apiKey: z.string().optional(),
    timeoutMs: z.coerce.number().int().positive().default(30000),
    maxRetries: z.coerce.number().int().nonnegative().default(3),
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
    slowThresholdMs: z.coerce.number().int().positive().default(30000),
    p99ThresholdMs: z.coerce.number().int().positive().default(30000),
  }),

  // PII Protection
  pii: z.object({
    redactionMode: PIIRedactionMode.default("mask"),
  }),

  // Share Storage
  share: z.object({
    storageInMemory: booleanString.default(false),
  }),

  // Testing
  testing: z.object({
    isVitest: booleanString.default(false),
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
    },
    auth: {
      assistApiKeys: env.ASSIST_API_KEYS,
      assistApiKey: env.ASSIST_API_KEY,
      hmacSecret: env.HMAC_SECRET,
      hmacMaxSkewMs: env.HMAC_MAX_SKEW_MS,
      islApiKey: env.ISL_API_KEY,
      shareSecret: env.SHARE_SECRET,
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
      grounding: env.GROUNDING_ENABLED,
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
      optionsFeatureVersion: env.CEE_OPTIONS_FEATURE_VERSION,
      explainFeatureVersion: env.CEE_EXPLAIN_FEATURE_VERSION,
      evidenceHelperFeatureVersion: env.CEE_EVIDENCE_HELPER_FEATURE_VERSION,
      biasCheckFeatureVersion: env.CEE_BIAS_CHECK_FEATURE_VERSION,
      biasStructuralEnabled: env.CEE_BIAS_STRUCTURAL_ENABLED,
      sensitivityCoachFeatureVersion: env.CEE_SENSITIVITY_COACH_FEATURE_VERSION,
      teamPerspectivesFeatureVersion: env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION,
      causalValidationEnabled: env.CEE_CAUSAL_VALIDATION_ENABLED,
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
