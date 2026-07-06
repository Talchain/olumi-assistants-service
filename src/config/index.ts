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
import { getRuntimeEnv } from "./env-resolver.js";

/**
 * Config override events to be emitted after telemetry is available
 */
interface ConfigOverrideEvent {
  settingName: string;
  requestedValue: boolean;
  actualValue: boolean;
  env: string;
  reason: string;
}

const configOverrideEvents: ConfigOverrideEvent[] = [];

/**
 * Thinking mode parser for CEE_*_THINKING env vars.
 * Accepts: "true" | "enabled" | "false" | "" | absent → boolean.
 * Rejects any other string (e.g. "adaptive") with a clear Zod error at startup.
 * This avoids silent coercion of unsupported mode strings.
 */
const thinkingMode = z
  .union([z.boolean(), z.string(), z.undefined()])
  .transform((val, ctx) => {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return val;
    const lower = (val as string).toLowerCase().trim();
    if (lower === 'false' || lower === '0' || lower === '') return false;
    if (lower === 'true' || lower === '1' || lower === 'enabled') return true;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid thinking mode "${val}". Valid values: "true", "enabled", "false". ` +
        `Note: "adaptive" is not supported in the Node.js Anthropic SDK — use "enabled" instead.`,
    });
    return z.NEVER;
  });

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
 * Environment-enforced boolean for security-sensitive flags (Stream F).
 *
 * Enforces environment-specific security policies:
 * - prod: always false, logs security warning if override attempted
 * - staging: behavior controlled by allowStaging parameter
 *   - if allowStaging=true: default false, allows explicit true with audit warning
 *   - if allowStaging=false: always false (same as prod)
 * - local/test: allows true
 *
 * @param defaultValue - Default value for staging/local/test environments
 * @param settingName - Name of the setting for logging
 * @param allowStaging - Whether to allow true in staging environment (default: true)
 */
function createEnvEnforcedBoolean(
  defaultValue: boolean,
  settingName: string,
  allowStaging: boolean = true
) {
  return z
    .union([z.boolean(), z.string(), z.number(), z.undefined()])
    .transform((val) => {
      const env = getRuntimeEnv();

      // Parse the requested value using booleanString logic
      let requestedValue = defaultValue;
      if (val !== undefined) {
        if (typeof val === "boolean") requestedValue = val;
        else if (typeof val === "number") requestedValue = val !== 0;
        else if (typeof val === "string") {
          const lower = val.toLowerCase().trim();
          if (lower === "false" || lower === "0" || lower === "") requestedValue = false;
          else if (lower === "true" || lower === "1") requestedValue = true;
          else requestedValue = Boolean(val);
        }
      }

      // Prod: always false, warn if override attempted
      if (env === "prod") {
        if (requestedValue === true) {
          console.warn(`[SECURITY] ${settingName} cannot be enabled in production (forced to false)`);
          configOverrideEvents.push({
            settingName,
            requestedValue: true,
            actualValue: false,
            env,
            reason: "production_lockdown",
          });
        }
        return false;
      }

      // Staging: behavior depends on allowStaging parameter
      if (env === "staging") {
        if (!allowStaging) {
          // Dev-only flag: force false in staging (same as prod)
          if (requestedValue === true) {
            console.warn(`[SECURITY] ${settingName} cannot be enabled in staging (forced to false)`);
            configOverrideEvents.push({
              settingName,
              requestedValue: true,
              actualValue: false,
              env,
              reason: "staging_lockdown",
            });
          }
          return false;
        } else {
          // Staging-allowed flag: allow with audit warning
          if (requestedValue === true && val !== undefined) {
            console.warn(`[AUDIT] ${settingName} enabled in staging environment`);
            configOverrideEvents.push({
              settingName,
              requestedValue: true,
              actualValue: true,
              env,
              reason: "staging_override_allowed",
            });
          }
          return requestedValue;
        }
      }

      // Local/test: allow requested value
      return requestedValue;
    });
}

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
const Environment = z.enum(["development", "test", "staging", "production"]);

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
    port: z.coerce.number().int().positive().default(3101),
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
    // Runtime blocklist for client API model selection (comma-separated model IDs)
    // Use to block additional models at runtime without code changes.
    // Supplements clientAllowed: false in MODEL_REGISTRY.
    clientBlockedModels: z
      .string()
      .transform((val) => val.split(",").map((m) => m.trim()).filter(Boolean))
      .optional(),
  }),

  // Feature Flags
  features: z.object({
    grounding: booleanString.default(false), // Conservative default - opt-in for production safety
    critique: booleanString.default(true),
    clarifier: booleanString.default(true),
    piiGuard: booleanString.default(false),
    shareReview: booleanString.default(false),
    enableLegacySSE: booleanString.default(false),
    strictTopologyValidation: booleanString.default(false), // If true, promote topology warnings to errors
    orchestrator: booleanString.default(false), // CEE_ORCHESTRATOR_ENABLED — Track C: multi-turn conversational decision modelling
    orchestratorV2: booleanString.default(false), // ENABLE_ORCHESTRATOR_V2 — V2 five-phase pipeline
    // CEE_ORCHESTRATOR_CONTEXT_ENABLED — Context Fabric: 3-zone cache-aware context assembly pipeline
    // IMPORTANT: V2 prompt path must have parity with V1 before enabling on staging. See A.4 audit.
    contextFabric: booleanString.default(false),
    dskV0: booleanString.default(false), // ENABLE_DSK_V0 — load DSK v0 bundle from data/dsk/v1.json at startup
    dskEnabled: booleanString.default(false), // DSK_ENABLED — alias for dskV0, gates typed accessors
    bilEnabled: booleanString.default(false), // BIL_ENABLED — Brief Intelligence Layer extraction + injection
    briefDetectionEnabled: booleanString.default(false), // CEE_BRIEF_DETECTION_ENABLED — deterministic NL brief → draft_graph routing
    dskCoachingEnabled: booleanString.default(false), // DSK_COACHING_ENABLED — deterministic DSK coaching items on envelope
    zone2Registry: booleanString.default(false), // CEE_ZONE2_REGISTRY_ENABLED — Zone 2 block registry prompt assembly
    moeSpikeEnabled: booleanString.default(false), // MOE_SPIKE_ENABLED — shadow-mode brief quality specialist (never surfaces to users)
    orchestratorStreaming: booleanString.default(false), // ENABLE_ORCHESTRATOR_STREAMING — SSE streaming for orchestrator turns
    strictPromptValidation: booleanString.default(false), // CEE_STRICT_PROMPT_VALIDATION — throw on error-severity prompt-zone violations
    optionShortcutRepair: booleanString.default(true), // ENABLE_OPTION_SHORTCUT_REPAIR — deterministic option→risk and option→goal shortcut handlers
    deterministicRoutingV2: booleanString.default(false), // CEE_DETERMINISTIC_ROUTING_V2 — v2 deterministic routing patterns (parameter assignment hardening, chip passthrough, system event text)
    artefactAppendixEnabled: booleanString.default(false), // CEE_ARTEFACT_APPENDIX_ENABLED — inject artefact design appendix when artefact generation is likely
    artefactRenderingEnabled: booleanString.default(false), // CEE_ARTEFACT_RENDERING_ENABLED — when false, artefact blocks are suppressed with fallback commentary
    diagnosticTraceEnabled: booleanString.default(false), // CEE_DIAGNOSTIC_TRACE_ENABLED — attach _diagnostic_trace to V2 response envelopes
    deterministicOrchestratorEnabled: booleanString.default(true), // CEE_DETERMINISTIC_ORCHESTRATOR_ENABLED — three-layer deterministic intelligence pipeline
    v6DualDraftEnabled: booleanString.default(false), // CEE_V6_DUAL_DRAFT_ENABLED — V6 dual-model draft: M2 review + deterministic merge after M1 draft, before commit (default OFF; producer-agnostic enrichment stage in draft-graph-dispatch)
    // CEE_PIPELINE_V4_ENABLED — V1 route-registration flag only.
    //
    // Scope narrowed by the v5-handler-surface brief (Task 0b) for clarity:
    // this flag gates execution at the two V1 route entry points
    // (src/orchestrator/route.ts, src/orchestrator/route-stream.ts) and their
    // streaming cousin (src/orchestrator/pipeline/pipeline-stream.ts). It does
    // NOT gate the unified pipeline (src/cee/unified-pipeline/), the V4 tool
    // handlers (src/orchestrator/tools/*), or the deterministic orchestrator
    // layer. Those remain callable from the V2/V5 route (route-v2.ts)
    // regardless of this flag — the V5 draft_graph and edit_graph dispatches
    // depend on that independence.
    //
    // Default flipped true (April 2026): V4 is the only supported V1 path and
    // V1 handlers (e.g. src/orchestrator/tools/explain-results.ts) are
    // stubbed to throw if reached. Set to false only for emergency rollback
    // of V1 AND revert the V1 stubs.
    // ⚠️ INVERTED SEMANTICS: CEE_PIPELINE_V4_ENABLED=true DISABLES V4 on /v1 routes
    // (returns 410 V4_DISABLED). CEE_PIPELINE_V4_ENABLED=false ENABLES V4 execution.
    // This is a known naming issue. Rename to CEE_V1_ROUTE_DISABLED planned post-pilot.
    pipelineV4Enabled: booleanString.default(true),
    orchestratorV5: booleanString.default(false), // ENABLE_V5_ORCHESTRATOR — V5 slice A0 scaffold (contracts + ingress/egress B1 validation only, no TurnExecutor). Route returns 404 when false.
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
    decisionReviewEnabled: booleanString.default(false), // Enable M2 Decision Review endpoint
    decisionReviewRateLimitRpm: z.coerce.number().int().positive().default(30), // Decision review rate limit
    // V5 run_analysis decision_review auto-fire gate. When false (default),
    // turn-executor and chip-click-dispatch do NOT await the
    // `enrichRunAnalysisWithDecisionReview` call — `run_analysis` returns
    // the deterministic PLoT analysis immediately and `v5.decision_review.skipped`
    // fires with reason `autofire_disabled`. Env: V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW.
    runAnalysisAwaitDecisionReview: booleanString.default(false),
    optionsFeatureVersion: z.string().optional(),
    explainFeatureVersion: z.string().optional(),
    evidenceHelperFeatureVersion: z.string().optional(),
    biasCheckFeatureVersion: z.string().optional(),
    biasStructuralEnabled: booleanString.default(false),
    biasMitigationPatchesEnabled: booleanString.default(false),
    sensitivityCoachFeatureVersion: z.string().optional(),
    teamPerspectivesFeatureVersion: z.string().optional(),
    reviewFeatureVersion: z.string().optional(),
    reviewArchetypesEnabled: booleanString.default(true), // Enable archetype inference for review endpoint
    reviewPlaceholdersEnabled: booleanString.default(false), // If false, return empty blocks (M1 scaffolding gated)
    causalValidationEnabled: booleanString.default(false),
    // LLM-first extraction settings
    llmFirstExtractionEnabled: booleanString.default(false), // If true, use LLM for factor/constraint extraction (regex as fallback)
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
    orchestratorValidationEnabled: booleanString.default(false), // If true, enable deterministic validator in draft pipeline
    // Patch pre-validation and budget enforcement (cf-v11.1 graph-safe invariant)
    patchPreValidationEnabled: booleanString.default(true), // If true, apply structural validation to edit_graph patches before assembly
    patchBudgetEnabled: booleanString.default(true), // If true, enforce complexity budget (3 node ops, 4 edge ops) on edit_graph patches
    // Capability 2A — add-risk rejection guidance (CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED).
    // When true, an unsupported add-risk edit that fails structural validation with a
    // reachability-class violation (the new risk node is not reachable from the decision —
    // e.g. wired only to an option, or orphaned) renders a deterministic, structural-only
    // next-step ("the risk needs to connect through to your goal…") instead of the generic
    // "inconsistency in the model structure" suppression. Tightly scoped to that single
    // rejection class; every other rejection reason/type is byte-identical. Default OFF;
    // flag-off renders exactly as today. Final user-facing wording is authored separately
    // before any live run / flag enablement.
    addRiskRejectionGuidanceEnabled: booleanString.default(false),
    deterministicEnforcementEnabled: booleanString.default(true), // CEE_DETERMINISTIC_ENFORCEMENT_ENABLED — budget rescale + bridge chain repair (Stage 4 substep 9b, after clarifier)
    editNormalisationEnabled: booleanString.default(true), // CEE_EDIT_NORMALISATION_ENABLED — normalise non-canonical LLM field names before Zod validation
    editInterventionRoutingEnabled: booleanString.default(true), // CEE_EDIT_INTERVENTION_ROUTING_ENABLED — read interventions from data.interventions + slash-keyed entries
    // Session cache (for /ask endpoint)
    sessionCacheTtlSeconds: z.coerce.number().int().positive().default(14400), // 4 hours default
    // Anthropic Structured Outputs for draft_graph and edit_graph (CEE_ANTHROPIC_STRUCTURED_OUTPUTS)
    // When true, adds output_config: { format: { type: "json_schema", schema } } (GA path)
    // to Anthropic API calls, guaranteeing parseable JSON at the token generation level.
    // No beta header required — structured outputs is GA since Jan 2026.
    // Default false — enable via CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true.
    retryOnDefaultStrengths: booleanString.default(false), // Retry LLM call once when ≥80% of edges have default strength signature (enable via CEE_RETRY_ON_DEFAULT_STRENGTHS=true in staging)
    anthropicStructuredOutputs: booleanString.default(false),
    // Extended thinking configuration per operation (Anthropic claude-sonnet-4-6+ only)
    //
    // CEE_ORCHESTRATOR_THINKING — valid values: "true" | "enabled" | "false" | absent
    //   "true" / "enabled" → thinking enabled with budget_tokens from *_BUDGET
    //   "false" / absent    → thinking disabled (default)
    //   Any other value is rejected at startup.
    // CEE_ORCHESTRATOR_THINKING_BUDGET — budget_tokens in tokens (min 1024, default 10000)
    //   max_tokens is automatically raised to budget + 1024 when no explicit override is set.
    // CEE_DRAFT_GRAPH_THINKING / CEE_EDIT_GRAPH_THINKING — same contract as orchestrator
    thinking: z.object({
      orchestratorEnabled: thinkingMode.default(false),
      orchestratorBudget: z.coerce.number().int().min(1024).default(10000),
      draftGraphEnabled: thinkingMode.default(false),
      draftGraphBudget: z.coerce.number().int().min(1024).default(10000),
      editGraphEnabled: thinkingMode.default(false),
      editGraphBudget: z.coerce.number().int().min(1024).default(10000),
    }).default({}),
    // Per-operation model selection for tiered cost optimization
    models: z.object({
      draft: z.string().optional(),
      options: z.string().optional(),
      repair: z.string().optional(),
      clarification: z.string().optional(),
      critique: z.string().optional(),
      validation: z.string().optional(),
      extraction: z.string().optional(), // Model for LLM-first factor/constraint extraction
      decision_review: z.string().optional(), // Model for decision review
      orchestrator: z.string().optional(), // Model for orchestrator Phase 3 + tool-calling
      edit_graph: z.string().optional(), // Model for edit_graph tool handler
      m2_review: z.string().optional(), // Model for V6 dual-draft M2 graph review (CEE_MODEL_M2_REVIEW; recommended claude-opus-4-8 at activation)
    }).default({}),
    // Per-operation max tokens limits
    maxTokens: z.object({
      draft: z.coerce.number().int().positive().optional(),
      options: z.coerce.number().int().positive().optional(),
      repair: z.coerce.number().int().positive().optional(),
      clarification: z.coerce.number().int().positive().optional(),
      critique: z.coerce.number().int().positive().optional(),
      validation: z.coerce.number().int().positive().optional(),
      extraction: z.coerce.number().int().positive().optional(), // Max tokens for LLM-first extraction
      decision_review: z.coerce.number().int().positive().optional(), // Max tokens for decision review
      orchestrator: z.coerce.number().int().positive().optional(), // Max tokens for orchestrator Phase 3
      edit_graph: z.coerce.number().int().positive().optional(), // Max tokens for edit_graph tool
      m2_review: z.coerce.number().int().positive().optional(), // Max tokens for V6 dual-draft M2 review (default 4096 in m2-review.ts)
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
    // Observability settings (debug panel visibility)
    observabilityEnabled: booleanString.default(false), // If true, include _observability in CEE responses
    observabilityRawIO: createEnvEnforcedBoolean(false, "CEE_OBSERVABILITY_RAW_IO"), // If true, include raw prompts/responses (security: locked in prod)
    // V5 turn debug store (CEE_TURN_DEBUG_ENABLED -- enable for debug sessions only)
    turnDebugEnabled: booleanString.default(false), // If true, store per-turn CQE extraction data for admin retrieval
    // CQE verbose pattern trace (CQE_VERBOSE_TRACE -- enable for debug sessions only)
    cqeVerboseTrace: booleanString.default(false), // If true, emit per-pattern trace to stderr
    // Repair loop settings
    maxPatchOperations: z.coerce.number().int().min(1).max(100).default(15), // Max operations per edit_graph patch
    maxRepairRetries: z.coerce.number().int().min(0).max(5).default(1), // Max repair retries in graph orchestrator
    // explain_results response enrichment
    explainHeadlineEnabled: booleanString.default(true), // CEE_EXPLAIN_HEADLINE_ENABLED — generate assistant_text headline from explanation narrative
    explainChipsEnabled: booleanString.default(true), // CEE_EXPLAIN_CHIPS_ENABLED — generate suggested_actions chips after explain_results
    explainQualityEnabled: booleanString.default(true), // CEE_EXPLAIN_QUALITY_ENABLED — headline separation, driver guards, context-aware chips
    // Debug logging settings
    debugCategoryTrace: booleanString.default(false), // If true, emit V3-CAT diagnostic logs for category field tracing
    debugLoggingEnabled: booleanString.default(false), // If true, emit V3-CAT diagnostic logs
    // Pipeline checkpoint settings
    pipelineCheckpointsEnabled: booleanString.default(false), // If true, capture edge field presence snapshots at 5 pipeline stages
    // V5 latency observability (Fix 4). Server permission gate (deployment-
    // wide) for the `_timings` response-envelope surface. PR #182 made wire
    // emission additionally require a per-request `X-Olumi-Debug: timings`
    // header so normal browser traffic does NOT receive `_timings` even
    // when this flag is on. The two-gate model is enforced at the route
    // (see `src/orchestrator/route-v2.ts` :: re-attach block + helper at
    // `src/orchestrator/debug-fields.ts`).
    //
    // This flag still gates upstream CAPTURE (timing-object allocation +
    // `_timings` field on dispatch results) so production with the flag
    // OFF pays no allocation cost. Telemetry events
    // (v5.turn_executor.stage_timings, cee.unified_pipeline.stage_timings,
    // v5.run_analysis.timings) emit unconditionally.
    //
    // Default OFF in production; staging sets V5_TIMING_DEBUG=true so the
    // replay harness can request `_timings` via the debug header.
    timingDebugEnabled: booleanString.default(false),
    // CEE → PLoT intervention value-scale egress net (CEE_PLOT_EGRESS_SCALE_NET_ENABLED).
    // When true, the run_analysis projection boundary canonicalises outbound
    // option interventions to RAW user-scale (evidence-gated) before they reach
    // PLoT. Default OFF: the net ships dark and is a runtime no-op until enabled.
    plotEgressScaleNetEnabled: booleanString.default(false),
    // EP2 (V5 Edit Safety Core, Phase 1): read-boundary analysis-ready guard at
    // run_analysis (scoped to /orchestrate/v2/turn). Default OFF. When ON it gates
    // the run-time canonicalisation AND the freshness-side canonicalise-before-hash
    // + unrecoverable short-circuit ATOMICALLY (no split mode); flag OFF =>
    // byte-identical to today on both sides. CEE_RUN_ANALYSIS_READY_GUARD.
    analysisReadyGuardEnabled: booleanString.default(false),
    // NULL persisted-graph recovery kill-switch (CEE_RUN_ANALYSIS_NULL_GRAPH_RECOVERABLE).
    // Default ON. When ON, run_analysis on a scenario whose persisted graph is NULL
    // returns a typed `analysis_not_ready` recoverable 200 (honest "draft a model
    // first" + chip) instead of a raw `scenario_read_failed` 500. INDEPENDENT of EP2
    // (`analysisReadyGuardEnabled`): the deployed V5 path runs EP2 OFF, so this fix
    // must NOT be gated on it. Set to `false` for a code-free rollback to the legacy
    // raw-500 if typed recovery ever misbehaves. Only controls the NULL-graph branch;
    // a present-but-broken graph is still EP2's (default-off) concern.
    runAnalysisNullGraphRecoverable: booleanString.default(true),
    // V5 canonical context summary (CEE_CONTEXT_SUMMARY_ENABLED — staging
    // diagnostics + Golden-Journey Harness A1/A2 only). When true, the route
    // attaches a redacted `_context_summary` block (statuses/counts/hashes
    // only) to turn responses, stripped/re-attached like `_diagnostic_trace`.
    // Default OFF; never read by UI/prose/chip logic (enforced by a static
    // guard test). Additive + backward-compatible.
    contextSummaryEnabled: booleanString.default(false),
    // Track 2 pending-confirmation truth (CEE_PENDING_CONFIRMATION_TRUTH_ENABLED
    // — kill-switch, default ON). When true, the turn-executor threads the REAL
    // pending-confirmation state (a live, non-expired propose-then-decide pending
    // action from the most recent prior turn — CONFIRMATION_EXPECTING_ACTION_TYPES
    // in session/pending-action.ts) into the ContextPack's
    // `conversation.pending_confirmation` AND the canonical frame's
    // `conversation.pendingConfirmation`, from one shared derivation. Before this
    // fix both were constant-false (the field existed but was never threaded).
    // The pack is serialised into the LLM routing prompt, so this is
    // prompt-visible by design (routing prompt v40 Example 8 already documents
    // the signal). Set to `false` for a code-free rollback to constant-false at
    // BOTH seams (pack/frame agreement holds in either state). Diagnostics
    // (frame pending counts) are NOT gated by this flag — they always report
    // derived truth, with `threaded` recording the flag state.
    pendingConfirmationTruthEnabled: booleanString.default(true),
    // V5 coaching-state pack (CEE_COACHING_STATE_PACK_ENABLED — diagnostics
    // only). When true (AND contextSummaryEnabled is also true), the route adds
    // a redacted, hash-free `coaching_state_pack` sub-block to `_context_summary`
    // (closed enums / booleans / counts only — no hashes, indices, values, units
    // or text), projected from the same canonical state as `analysis_state`
    // (whose provenance the sibling `canonical_state_source` field records).
    // Default OFF; diagnostic-only this lane — NOT wired to prompt/PMS/chips/UI/
    // product behaviour. Reserved as the single seam for a future,
    // separately-approved LLM-facing behavioural-activation step.
    coachingStatePackEnabled: booleanString.default(false),
    // V5 Coaching Context Pack v1 (CEE_COACHING_CONTEXT_PROMPT_ENABLED — first
    // narrow coaching activation on the trust path). When true, the turn-executor
    // injects a redacted, hash-free `coaching_context` pack (the 8
    // CoachingStatePack closed-enum / boolean / count fields, pinned to the live
    // `deriveAnalysisFreshness` verdict) into the LLM routing prompt for coaching
    // turns, and a deterministic post-check degrades coaching prose that would
    // present stale / unknown / blocked analysis as current or give confident
    // directional advice under unsafe state. Default OFF; flag-off is
    // byte-identical (no pack injected, no post-check invoked, no prompt / prose /
    // chip change, no new telemetry). Distinct from CEE_COACHING_CONTEXT_ENABLED
    // (the always-on coaching policy engine) and CEE_COACHING_STATE_PACK_ENABLED
    // (the diagnostic-only `_context_summary` sub-block).
    coachingContextPromptEnabled: booleanString.default(false),
    // V5 Tier-2 claim-permission master lock (CEE_COACHING_TIER2_ENABLED —
    // Brief 5 "the cage, not the activation"). Lock 1 of two independent
    // locks on Tier-2 claim usage (Brief 4 §3 candidates: factor_sensitivity,
    // confidence_tier, robustness). Lock 2 is TIER2_COACHING_ALLOWLIST
    // (compose/claim-safety-cage.ts), which ships EMPTY — so even flipping
    // this flag surfaces ZERO fields until a field is deliberately
    // allowlisted (Brief 4 gate G2, a separate per-field decision with
    // science sign-off). Default OFF. Flag-off is byte-identical: nothing
    // consults the Tier-2 gate for output today; the cage exists so future
    // coaching/DSK surfacing has a mechanical, fail-closed permission check
    // instead of doctrine-only guidance. Transport is unaffected either way
    // (the P0B keep-list owns transport; claim-permission is the other axis).
    coachingTier2Enabled: booleanString.default(false),
    // V5 option-identity freshness guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD).
    // When true, the freshness derivation additionally compares the analysed
    // option identities carried on the selected run_analysis fact
    // (enrichment.option_comparison[].option_id ∪ leading_option_id) against
    // the current graph's option IDs. If they diverge while the hash path
    // could not already prove staleness ('fresh' or the hash-impossible
    // 'unknown' paths — legacy_fact_missing_hash / current_graph_hash_unavailable,
    // i.e. recovered-session / unparseable-graph reloads), the verdict is
    // forced to 'stale' with reason 'analysed_options_diverged' so the system
    // fails closed instead of implying the analysis reflects the current model.
    // The guard is DOWNGRADE-ONLY: it can only move 'fresh'/'unknown' → 'stale',
    // never the reverse, so enabling it can never make a stale/diverged analysis
    // read as current. Default ON (proven in deterministic tests; routing already
    // fails closed on 'stale' regardless of reason). Set
    // CEE_OPTION_IDENTITY_FRESHNESS_GUARD=false for a code-free rollback to the
    // byte-identical legacy behaviour (no option IDs threaded into
    // deriveAnalysisFreshness, no override, no new telemetry).
    optionIdentityFreshnessGuard: booleanString.default(true),
    // V5 post-analysis conversational loop (CEE_POST_ANALYSIS_LOOP_ENABLED —
    // AI Harness capability 1). When true, the post-analysis advice gate may
    // consume the already-assembled canonical analysis state + readiness
    // blockers + recent-changes to compose a grounded, safe-now deterministic
    // answer in the fresh-analysis case where the thin LLM-facing projection
    // is blank — instead of falling through `data_unavailable_for_class` to the
    // slow generic LLM router. Default OFF; flag-off is byte-identical (the gate
    // receives no canonical/readiness/recent-change inputs, so the relaxation
    // branch is dead and the existing fall-through is unchanged). The always-on
    // false-success neutralisation (finaliser) is NOT gated by this flag.
    // Surfacing is restricted to Tier-1 safe-now content (status/freshness/
    // readiness/recent-changes/next-step) — no held science prose. Behavioural
    // activation (flag ON) is reserved for an authorised live-acceptance step.
    postAnalysisLoopEnabled: booleanString.default(false),
    // Prompt debug logging (CEE_PROMPT_DEBUG_ENABLED)
    promptDebugEnabled: booleanString.default(false), // If true, log prompt hash, source, and 200-char preview on every draft call
    // Prompt store required (CEE_PROMPT_STORE_REQUIRED)
    promptStoreRequired: booleanString.default(false), // If true, error instead of falling back to defaults when store prompt fails
    // Field survival trace (CEE_FIELD_SURVIVAL_TRACE)
    fieldSurvivalTrace: booleanString.default(false), // If true, log field-presence checkpoints after LLM output parse
    // Unified pipeline is always-on (legacy Pipeline A+B removed; CEE_UNIFIED_PIPELINE_ENABLED retired)
    // Boundary security (Stream F)
    boundaryAllowInvalid: createEnvEnforcedBoolean(false, "CEE_BOUNDARY_ALLOW_INVALID", false), // Dev-only (local/test): if true, allow invalid V3 graphs through boundary (locked in staging/prod)
    // Draft compliance reminder (appended to user message for initial graph generation only)
    draftComplianceReminderEnabled: booleanString.default(true), // CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED
    // BriefSignals context header (appended to user message after compliance reminder)
    briefSignalsHeaderEnabled: booleanString.default(false), // CEE_BRIEF_SIGNALS_HEADER_ENABLED
    // Cross-turn entity memory (tracks per-factor interaction state for Zone 2)
    entityMemoryEnabled: booleanString.default(false), // CEE_ENTITY_MEMORY_ENABLED
    // Two-pass graph parameter validation pipeline (CEE_VALIDATION_PIPELINE_ENABLED)
    validationPipelineEnabled: booleanString.default(false),
    // Post-assembly Zod schema verification pipeline (CEE_VERIFICATION_PIPELINE_ENABLED)
    verificationPipelineEnabled: booleanString.default(true),
    // Coaching architecture kill switches
    coachingContextEnabled: booleanString.default(true), // CEE_COACHING_CONTEXT_ENABLED — coaching policy engine + dynamic block enrichment (WS1 + WS8)
    actionPolicyEnabled: booleanString.default(false), // CEE_ACTION_POLICY_ENABLED — deterministic intent classification (WS4) — not wired
    chipEngineEnabled: booleanString.default(true), // CEE_CHIP_ENGINE_ENABLED — typed chip engine (WS5)
    postFlightValidatorEnabled: booleanString.default(false), // CEE_POST_FLIGHT_VALIDATOR_ENABLED — post-flight response validation (WS7) — not wired
    guidedIntakeEnabled: booleanString.default(false), // CEE_GUIDED_INTAKE_ENABLED — BIL wire-up for thin briefs (WS3) — not wired
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

  // PLoT (Plot Lite) Service Configuration
  plot: z.object({
    baseUrl: optionalUrl,
    authToken: z.string().optional(),
  }).default({}),

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

  // Research (web search for evidence gathering)
  research: z.object({
    enabled: booleanString.default(false),                                 // RESEARCH_ENABLED — master switch
    model: z.string().default('gpt-4o'),                                   // RESEARCH_MODEL — model for Responses API
    webSearchToolType: z.string().default('web_search_preview'),           // RESEARCH_WEB_SEARCH_TOOL_TYPE — tool type (updatable without code change)
    rateLimitPerScenario: z.coerce.number().int().min(1).default(5),       // RESEARCH_RATE_LIMIT — max calls per scenario per window
    rateLimitWindowMs: z.coerce.number().int().min(1).default(1_800_000),  // RESEARCH_RATE_LIMIT_WINDOW_MS — 30 minutes
    cacheTtlMs: z.coerce.number().int().min(0).default(1_800_000),         // RESEARCH_CACHE_TTL_MS — 30 minutes
    cacheMaxSize: z.coerce.number().int().min(1).default(200),             // RESEARCH_CACHE_MAX_SIZE
    timeoutMs: z.coerce.number().int().min(1000).default(15_000),          // RESEARCH_TIMEOUT_MS — 15 seconds
  }).default({}),

  // Prompt Management
  prompts: z.object({
    enabled: booleanString.default(false), // Master switch for prompt management
    storeType: z.enum(["file", "postgres", "supabase"]).default("file"), // Storage backend type
    storePath: z.string().default("data/prompts.json"), // Path to prompts JSON file (file store)
    backupEnabled: booleanString.default(true), // Create backups before writes (file store)
    maxBackups: z.coerce.number().int().positive().default(10), // Max backup files to keep (file store)
    postgresUrl: z.string().optional(), // PostgreSQL connection string (postgres store)
    postgresPoolSize: z.coerce.number().int().positive().default(10), // Connection pool size (postgres store)
    postgresSsl: booleanString.default(false), // Use SSL for PostgreSQL connection
    supabaseUrl: z.string().optional(), // Supabase project URL (supabase store)
    supabaseServiceRoleKey: z.string().optional(), // Supabase service role key (supabase store)
    braintrustEnabled: booleanString.default(false), // Enable Braintrust experiment tracking
    braintrustProject: z.string().default("olumi-prompts"), // Braintrust project name
    adminApiKey: z.string().optional(), // Admin API key for prompt management (full access)
    adminApiKeyRead: z.string().optional(), // Read-only admin API key
    adminAllowedIPs: z.string().optional(), // Comma-separated list of allowed IPs (empty = all allowed)
    adminRoutesEnabled: booleanString.default(true), // Enable admin routes (set to false in production)
    useStaging: booleanString.optional(), // Explicit override: true = use staging prompts, false = use production prompts
    environment: z.string().optional(), // Environment name for prompt selection (e.g., "staging", "production"). Falls back to DD_ENV.
    activationGuardEnabled: booleanString.default(true), // CEE_PROMPT_ACTIVATION_GUARD_ENABLED — prevents automated processes from setting stagingVersion/activeVersion
    autoMigrateEnabled: booleanString.default(false), // CEE_PROMPT_AUTO_MIGRATE — enables auto-migration of orchestrator prompt from registered default on startup (default: off)
  }),

  // Browser Proxy — browser-safe proxy for V5 turns that bypasses Netlify Edge timeout.
  // The proxy injects X-Olumi-Assist-Key server-side and validates request origins.
  proxy: z.object({
    browserProxyEnabled: booleanString.default(false), // BROWSER_PROXY_ENABLED — master switch
    browserProxyAllowedOrigins: z.string().optional(), // BROWSER_PROXY_ALLOWED_ORIGINS — comma-separated origin allowlist
    browserProxyTimeoutMs: z.coerce.number().int().min(5_000).max(300_000).default(125_000), // BROWSER_PROXY_TIMEOUT_MS — proxy-to-CEE timeout (5s headroom above DRAFT_REQUEST_BUDGET_MS=120s, must be < ROUTE_TIMEOUT_MS)
  }).default({}),
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
      clientBlockedModels: env.CLIENT_BLOCKED_MODELS,
    },
    features: {
      // CEE_GROUNDING_ENABLED preferred; falls back to GROUNDING_ENABLED
      grounding: env.CEE_GROUNDING_ENABLED ?? env.GROUNDING_ENABLED,
      critique: env.CRITIQUE_ENABLED,
      // NOTE: features.clarifier is the per-request override gate (used by feature-flags.ts
      // and v1.status.ts). It is DISTINCT from cee.clarifierEnabled which gates the
      // in-pipeline Stage 4 multi-turn clarifier. Both read CLARIFIER_ENABLED but serve
      // different purposes. Prefer CEE_CLARIFIER_ENABLED for the pipeline gate.
      clarifier: env.CLARIFIER_ENABLED,
      piiGuard: env.PII_GUARD_ENABLED,
      shareReview: env.SHARE_REVIEW_ENABLED,
      enableLegacySSE: env.ENABLE_LEGACY_SSE,
      // CEE_ORCHESTRATOR_ENABLED preferred; falls back to ENABLE_ORCHESTRATOR
      orchestrator: env.CEE_ORCHESTRATOR_ENABLED ?? env.ENABLE_ORCHESTRATOR,
      orchestratorV2: env.ENABLE_ORCHESTRATOR_V2,
      contextFabric: env.CEE_ORCHESTRATOR_CONTEXT_ENABLED,
      dskV0: env.ENABLE_DSK_V0,
      dskEnabled: env.DSK_ENABLED,
      bilEnabled: env.BIL_ENABLED,
      briefDetectionEnabled: env.CEE_BRIEF_DETECTION_ENABLED,
      dskCoachingEnabled: env.DSK_COACHING_ENABLED,
      zone2Registry: env.CEE_ZONE2_REGISTRY_ENABLED,
      moeSpikeEnabled: env.MOE_SPIKE_ENABLED,
      orchestratorStreaming: env.ENABLE_ORCHESTRATOR_STREAMING,
      strictPromptValidation: env.CEE_STRICT_PROMPT_VALIDATION,
      optionShortcutRepair: env.ENABLE_OPTION_SHORTCUT_REPAIR,
      deterministicRoutingV2: env.CEE_DETERMINISTIC_ROUTING_V2,
      artefactAppendixEnabled: env.CEE_ARTEFACT_APPENDIX_ENABLED,
      artefactRenderingEnabled: env.CEE_ARTEFACT_RENDERING_ENABLED,
      diagnosticTraceEnabled: env.CEE_DIAGNOSTIC_TRACE_ENABLED,
      deterministicOrchestratorEnabled: env.CEE_DETERMINISTIC_ORCHESTRATOR_ENABLED,
      pipelineV4Enabled: env.CEE_PIPELINE_V4_ENABLED,
      orchestratorV5: env.ENABLE_V5_ORCHESTRATOR,
      v6DualDraftEnabled: env.CEE_V6_DUAL_DRAFT_ENABLED,
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
      decisionReviewEnabled: env.CEE_DECISION_REVIEW_ENABLED,
      decisionReviewRateLimitRpm: env.CEE_DECISION_REVIEW_RATE_LIMIT_RPM,
      runAnalysisAwaitDecisionReview: env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW,
      optionsFeatureVersion: env.CEE_OPTIONS_FEATURE_VERSION,
      explainFeatureVersion: env.CEE_EXPLAIN_FEATURE_VERSION,
      evidenceHelperFeatureVersion: env.CEE_EVIDENCE_HELPER_FEATURE_VERSION,
      biasCheckFeatureVersion: env.CEE_BIAS_CHECK_FEATURE_VERSION,
      biasStructuralEnabled: env.CEE_BIAS_STRUCTURAL_ENABLED,
      biasMitigationPatchesEnabled: env.CEE_BIAS_MITIGATION_PATCHES_ENABLED,
      sensitivityCoachFeatureVersion: env.CEE_SENSITIVITY_COACH_FEATURE_VERSION,
      teamPerspectivesFeatureVersion: env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION,
      reviewFeatureVersion: env.CEE_REVIEW_FEATURE_VERSION,
      reviewArchetypesEnabled: env.CEE_REVIEW_ARCHETYPES_ENABLED,
      reviewPlaceholdersEnabled: env.CEE_REVIEW_PLACEHOLDERS_ENABLED,
      retryOnDefaultStrengths: env.CEE_RETRY_ON_DEFAULT_STRENGTHS,
      causalValidationEnabled: env.CEE_CAUSAL_VALIDATION_ENABLED,
      llmFirstExtractionEnabled: env.CEE_LLM_FIRST_EXTRACTION_ENABLED,
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
      // DEPRECATION: CLARIFIER_ENABLED is the legacy name for CEE_CLARIFIER_ENABLED.
      // If CEE_CLARIFIER_ENABLED is not set but CLARIFIER_ENABLED is, forward the value.
      // Remove CLARIFIER_ENABLED support in the next major version.
      clarifierEnabled: (() => {
        if (env.CEE_CLARIFIER_ENABLED !== undefined) {
          if (env.CLARIFIER_ENABLED !== undefined && env.CLARIFIER_ENABLED !== env.CEE_CLARIFIER_ENABLED) {
            console.warn(
              "[DEPRECATION] Both CLARIFIER_ENABLED and CEE_CLARIFIER_ENABLED are set with different values. " +
              "CEE_CLARIFIER_ENABLED takes precedence. Remove CLARIFIER_ENABLED."
            );
          }
          return env.CEE_CLARIFIER_ENABLED;
        }
        if (env.CLARIFIER_ENABLED !== undefined) {
          console.warn(
            "[DEPRECATION] CLARIFIER_ENABLED is deprecated. Use CEE_CLARIFIER_ENABLED instead. " +
            "Value has been forwarded."
          );
          return env.CLARIFIER_ENABLED;
        }
        return undefined; // schema default (false) applies
      })(),
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
      orchestratorValidationEnabled: env.CEE_ORCHESTRATOR_VALIDATION_ENABLED,
      // Patch pre-validation and budget enforcement (cf-v11.1 graph-safe invariant)
      patchPreValidationEnabled: env.CEE_PATCH_PRE_VALIDATION_ENABLED,
      addRiskRejectionGuidanceEnabled: env.CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED,
      patchBudgetEnabled: env.CEE_PATCH_BUDGET_ENABLED,
      deterministicEnforcementEnabled: env.CEE_DETERMINISTIC_ENFORCEMENT_ENABLED,
      editNormalisationEnabled: env.CEE_EDIT_NORMALISATION_ENABLED,
      editInterventionRoutingEnabled: env.CEE_EDIT_INTERVENTION_ROUTING_ENABLED,
      // Session cache TTL
      sessionCacheTtlSeconds: env.CEE_SESSION_CACHE_TTL_SECONDS,
      // Anthropic Structured Outputs
      anthropicStructuredOutputs: env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS,
      // Extended thinking per operation
      thinking: {
        orchestratorEnabled: env.CEE_ORCHESTRATOR_THINKING,
        orchestratorBudget: env.CEE_ORCHESTRATOR_THINKING_BUDGET,
        draftGraphEnabled: env.CEE_DRAFT_GRAPH_THINKING,
        draftGraphBudget: env.CEE_DRAFT_GRAPH_THINKING_BUDGET,
        editGraphEnabled: env.CEE_EDIT_GRAPH_THINKING,
        editGraphBudget: env.CEE_EDIT_GRAPH_THINKING_BUDGET,
      },
      // Per-operation model selection
      models: {
        // CEE_MODEL_DRAFT is the canonical name for the draft_graph model.
        // CEE_MODEL_DRAFT_GRAPH is an alias (the brief and docs use both forms).
        // If CEE_MODEL_DRAFT_GRAPH is set but CEE_MODEL_DRAFT is not, forward the value
        // and warn. If both are set with different values, CEE_MODEL_DRAFT takes precedence.
        draft: (() => {
          if (env.CEE_MODEL_DRAFT) {
            if (env.CEE_MODEL_DRAFT_GRAPH && env.CEE_MODEL_DRAFT_GRAPH !== env.CEE_MODEL_DRAFT) {
              console.warn(
                `[CONFIG] Both CEE_MODEL_DRAFT ("${env.CEE_MODEL_DRAFT}") and CEE_MODEL_DRAFT_GRAPH ("${env.CEE_MODEL_DRAFT_GRAPH}") are set with different values. ` +
                `CEE_MODEL_DRAFT takes precedence. CEE_MODEL_DRAFT_GRAPH will be ignored.`
              );
            }
            return env.CEE_MODEL_DRAFT;
          }
          if (env.CEE_MODEL_DRAFT_GRAPH) {
            console.warn(
              "[CONFIG] CEE_MODEL_DRAFT_GRAPH is set but CEE_MODEL_DRAFT is not. " +
              "Forwarding CEE_MODEL_DRAFT_GRAPH to draft model selection. " +
              "Prefer CEE_MODEL_DRAFT going forward."
            );
            return env.CEE_MODEL_DRAFT_GRAPH;
          }
          return undefined;
        })(),
        options: env.CEE_MODEL_OPTIONS,
        repair: env.CEE_MODEL_REPAIR,
        clarification: env.CEE_MODEL_CLARIFICATION,
        critique: env.CEE_MODEL_CRITIQUE,
        validation: env.CEE_MODEL_VALIDATION,
        extraction: env.CEE_MODEL_EXTRACTION,
        decision_review: env.CEE_MODEL_DECISION_REVIEW,
        orchestrator: env.CEE_MODEL_ORCHESTRATOR,
        edit_graph: env.CEE_MODEL_EDIT_GRAPH,
        m2_review: env.CEE_MODEL_M2_REVIEW,
      },
      // Per-operation max tokens limits
      maxTokens: {
        draft: env.CEE_MAX_TOKENS_DRAFT,
        options: env.CEE_MAX_TOKENS_OPTIONS,
        repair: env.CEE_MAX_TOKENS_REPAIR,
        clarification: env.CEE_MAX_TOKENS_CLARIFICATION,
        critique: env.CEE_MAX_TOKENS_CRITIQUE,
        validation: env.CEE_MAX_TOKENS_VALIDATION,
        decision_review: env.CEE_MAX_TOKENS_DECISION_REVIEW,
        orchestrator: env.CEE_MAX_TOKENS_ORCHESTRATOR,
        edit_graph: env.CEE_MAX_TOKENS_EDIT_GRAPH,
        m2_review: env.CEE_MAX_TOKENS_M2_REVIEW,
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
      // Observability settings
      observabilityEnabled: env.CEE_OBSERVABILITY_ENABLED,
      observabilityRawIO: env.CEE_OBSERVABILITY_RAW_IO,
      turnDebugEnabled: env.CEE_TURN_DEBUG_ENABLED,
      cqeVerboseTrace: env.CQE_VERBOSE_TRACE,
      // Repair loop settings
      maxPatchOperations: env.MAX_PATCH_OPERATIONS,
      maxRepairRetries: env.CEE_MAX_REPAIR_RETRIES,
      // explain_results response enrichment
      explainHeadlineEnabled: env.CEE_EXPLAIN_HEADLINE_ENABLED,
      explainChipsEnabled: env.CEE_EXPLAIN_CHIPS_ENABLED,
      explainQualityEnabled: env.CEE_EXPLAIN_QUALITY_ENABLED,
      // Debug logging settings
      debugCategoryTrace: env.CEE_DEBUG_CATEGORY_TRACE,
      debugLoggingEnabled: env.CEE_DEBUG_LOGGING,
      pipelineCheckpointsEnabled: env.CEE_PIPELINE_CHECKPOINTS_ENABLED,
      timingDebugEnabled: env.V5_TIMING_DEBUG,
      plotEgressScaleNetEnabled: env.CEE_PLOT_EGRESS_SCALE_NET_ENABLED,
      analysisReadyGuardEnabled: env.CEE_RUN_ANALYSIS_READY_GUARD,
      runAnalysisNullGraphRecoverable: env.CEE_RUN_ANALYSIS_NULL_GRAPH_RECOVERABLE,
      contextSummaryEnabled: env.CEE_CONTEXT_SUMMARY_ENABLED,
      pendingConfirmationTruthEnabled: env.CEE_PENDING_CONFIRMATION_TRUTH_ENABLED,
      coachingStatePackEnabled: env.CEE_COACHING_STATE_PACK_ENABLED,
      coachingContextPromptEnabled: env.CEE_COACHING_CONTEXT_PROMPT_ENABLED,
      coachingTier2Enabled: env.CEE_COACHING_TIER2_ENABLED,
      optionIdentityFreshnessGuard: env.CEE_OPTION_IDENTITY_FRESHNESS_GUARD,
      postAnalysisLoopEnabled: env.CEE_POST_ANALYSIS_LOOP_ENABLED,
      promptDebugEnabled: env.CEE_PROMPT_DEBUG_ENABLED,
      promptStoreRequired: env.CEE_PROMPT_STORE_REQUIRED,
      fieldSurvivalTrace: env.CEE_FIELD_SURVIVAL_TRACE,
      // CEE_UNIFIED_PIPELINE_ENABLED removed — unified pipeline is always-on
      boundaryAllowInvalid: env.CEE_BOUNDARY_ALLOW_INVALID,
      draftComplianceReminderEnabled: env.CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED,
      entityMemoryEnabled: env.CEE_ENTITY_MEMORY_ENABLED,
      validationPipelineEnabled: env.CEE_VALIDATION_PIPELINE_ENABLED,
      verificationPipelineEnabled: env.CEE_VERIFICATION_PIPELINE_ENABLED,
      // Coaching architecture kill switches
      coachingContextEnabled: env.CEE_COACHING_CONTEXT_ENABLED,
      actionPolicyEnabled: env.CEE_ACTION_POLICY_ENABLED,
      chipEngineEnabled: env.CEE_CHIP_ENGINE_ENABLED,
      postFlightValidatorEnabled: env.CEE_POST_FLIGHT_VALIDATOR_ENABLED,
      guidedIntakeEnabled: env.CEE_GUIDED_INTAKE_ENABLED,
    },
    isl: {
      baseUrl: env.ISL_BASE_URL,
      apiKey: env.ISL_API_KEY,
      timeoutMs: env.ISL_TIMEOUT_MS,
      maxRetries: env.ISL_MAX_RETRIES,
    },
    plot: {
      baseUrl: env.PLOT_BASE_URL,
      authToken: env.PLOT_AUTH_TOKEN,
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
    research: {
      enabled: env.RESEARCH_ENABLED,
      model: env.RESEARCH_MODEL,
      webSearchToolType: env.RESEARCH_WEB_SEARCH_TOOL_TYPE,
      rateLimitPerScenario: env.RESEARCH_RATE_LIMIT,
      rateLimitWindowMs: env.RESEARCH_RATE_LIMIT_WINDOW_MS,
      cacheTtlMs: env.RESEARCH_CACHE_TTL_MS,
      cacheMaxSize: env.RESEARCH_CACHE_MAX_SIZE,
      timeoutMs: env.RESEARCH_TIMEOUT_MS,
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
      supabaseUrl: env.SUPABASE_URL,
      supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      braintrustEnabled: env.PROMPTS_BRAINTRUST_ENABLED,
      braintrustProject: env.BRAINTRUST_PROJECT,
      adminApiKey: env.ADMIN_API_KEY,
      adminApiKeyRead: env.ADMIN_API_KEY_READ,
      adminAllowedIPs: env.ADMIN_ALLOWED_IPS,
      adminRoutesEnabled: env.ADMIN_ROUTES_ENABLED,
      useStaging: env.PROMPTS_USE_STAGING,
      environment: env.PROMPTS_ENVIRONMENT ?? env.DD_ENV, // PROMPTS_ENVIRONMENT takes precedence over DD_ENV
      activationGuardEnabled: env.CEE_PROMPT_ACTIVATION_GUARD_ENABLED,
      autoMigrateEnabled: env.CEE_PROMPT_AUTO_MIGRATE,
    },
    proxy: {
      browserProxyEnabled: env.BROWSER_PROXY_ENABLED,
      browserProxyAllowedOrigins: env.BROWSER_PROXY_ALLOWED_ORIGINS,
      browserProxyTimeoutMs: env.BROWSER_PROXY_TIMEOUT_MS,
    },
  };

  try {
    const parsed = ConfigSchema.parse(rawConfig);

    // Validate thinking configuration at startup to surface misconfiguration before first request.
    // The Anthropic API requires max_tokens > budget_tokens. When no explicit max_tokens override
    // is set, the adapter defaults (4096 for chat/chatWithTools, 16384 for draft_graph) apply —
    // the startup check must cover both the unset case (undefined) and the too-low case.
    const thinkingChecks: Array<{
      name: string;
      enabled: boolean;
      budget: number;
      maxTokens?: number;
      envVar: string;
      adapterDefault: number;
    }> = [
      { name: 'orchestrator', enabled: parsed.cee.thinking.orchestratorEnabled, budget: parsed.cee.thinking.orchestratorBudget, maxTokens: parsed.cee.maxTokens.orchestrator, envVar: 'CEE_MAX_TOKENS_ORCHESTRATOR', adapterDefault: 4096   },
      { name: 'draft_graph',  enabled: parsed.cee.thinking.draftGraphEnabled,   budget: parsed.cee.thinking.draftGraphBudget,   maxTokens: parsed.cee.maxTokens.draft,        envVar: 'CEE_MAX_TOKENS_DRAFT',        adapterDefault: 16384  },
      { name: 'edit_graph',   enabled: parsed.cee.thinking.editGraphEnabled,    budget: parsed.cee.thinking.editGraphBudget,    maxTokens: parsed.cee.maxTokens.edit_graph,   envVar: 'CEE_MAX_TOKENS_EDIT_GRAPH',   adapterDefault: 4096   },
    ];
    for (const check of thinkingChecks) {
      if (!check.enabled) continue;
      // effectiveMax: explicit override if set, otherwise what the adapter will use
      const effectiveMax = check.maxTokens ?? check.adapterDefault;
      if (effectiveMax <= check.budget) {
        console.warn(
          `[CONFIG] ${check.name}: effective max_tokens (${effectiveMax}${check.maxTokens === undefined ? ` — adapter default, ${check.envVar} not set` : ''}) ` +
          `<= thinking budget_tokens (${check.budget}). ` +
          `Anthropic requires max_tokens > budget_tokens. ` +
          `Set ${check.envVar}=${check.budget + 1024} or higher, ` +
          `or reduce CEE_${check.name.toUpperCase().replace(/_/g, '_')}_THINKING_BUDGET below ${effectiveMax}.`
        );
      }
    }

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Include validation issues in error message for debugging
      // Note: Logger not available yet during config parsing, so we embed details in the error
      const issuesSummary = error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Configuration validation failed: ${issuesSummary}`);
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
  configOverrideEvents.length = 0; // Clear override events
}

/**
 * Emit telemetry events for config overrides (Stream F)
 *
 * Call this after telemetry is initialized to emit any security/audit events
 * that were recorded during config parsing.
 *
 * This is separated from config initialization to avoid circular dependencies
 * with telemetry setup.
 */
export async function emitConfigOverrideTelemetry(): Promise<void> {
  // Lazy import to avoid circular dependency
  const { emit, TelemetryEvents } = await import("../utils/telemetry.js");

  for (const event of configOverrideEvents) {
    emit(TelemetryEvents.CeeConfigRawIoOverridden, {
      setting_name: event.settingName,
      requested_value: event.requestedValue,
      actual_value: event.actualValue,
      env: event.env,
      reason: event.reason,
    });
  }

  // Clear events after emission to avoid duplicate emissions
  configOverrideEvents.length = 0;
}

/**
 * Validate configuration at startup
 *
 * Forces immediate validation of all environment variables.
 * Call this early in server startup to fail fast on misconfiguration.
 * Throws if configuration is invalid.
 *
 * @returns The validated configuration
 */
export function validateConfig(): Config {
  // Force initialization by accessing a property
  // The Proxy will parse and validate the config
  const validated = config.server;
  void validated; // Use the value to satisfy linter
  return config;
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

/**
 * Determine if staging prompts should be used.
 *
 * Resolution order:
 * 1. PROMPTS_USE_STAGING env var (explicit override) - if set, use its value
 * 2. PROMPTS_ENVIRONMENT or DD_ENV - if "staging", use staging prompts
 * 3. NODE_ENV - if not "production", use staging prompts (legacy fallback)
 *
 * This separates the "prompt environment" from the "runtime environment" (NODE_ENV).
 * A staging server can run in production mode (NODE_ENV=production) while still
 * using staging prompts (DD_ENV=staging or PROMPTS_USE_STAGING=true).
 */
export function shouldUseStagingPrompts(): boolean {
  // 1. Explicit override takes precedence
  if (config.prompts?.useStaging !== undefined) {
    return config.prompts.useStaging;
  }

  // 2. Check prompt environment (PROMPTS_ENVIRONMENT or DD_ENV)
  const promptEnv = config.prompts?.environment?.toLowerCase();
  if (promptEnv) {
    return promptEnv === 'staging';
  }

  // 3. Legacy fallback: use NODE_ENV (for backwards compatibility)
  return !isProduction();
}

/**
 * Get list of models blocked for client use.
 *
 * Returns the models specified in CLIENT_BLOCKED_MODELS env var.
 * Returns empty array if not set or in test environment.
 */
export function getClientBlockedModels(): string[] {
  try {
    return config.llm.clientBlockedModels ?? [];
  } catch {
    // Config not available (e.g., test environment)
    return [];
  }
}

/**
 * Deprecated environment variable mapping
 * Maps deprecated env var names to their preferred replacements
 */
const DEPRECATED_ENV_VARS: Record<string, string | null> = {
  HMAC_SECRET: 'CEE_HMAC_SECRET',
  SHARE_SECRET: 'CEE_SHARE_SECRET',
  GROUNDING_ENABLED: 'CEE_GROUNDING_ENABLED',
  CLARIFIER_ENABLED: 'CEE_CLARIFIER_ENABLED',
  CEE_MODEL_DRAFT_GRAPH: 'CEE_MODEL_DRAFT',
  ENABLE_LEGACY_SSE: null,  // No replacement — legacy SSE path returns 426; remove the flag
};

/**
 * Check for deprecated environment variables in use
 *
 * Returns a list of warnings for deprecated env vars that are being used
 * as fallbacks. Call this at startup after config validation to log warnings.
 *
 * @returns Array of warning messages for deprecated env vars in use
 */
export interface EnvVarWarning {
  key: string;
  replacement?: string;
  message: string;
}

export function checkDeprecatedEnvVars(): EnvVarWarning[] {
  const warnings: EnvVarWarning[] = [];
  const env = process.env;

  for (const [deprecated, preferred] of Object.entries(DEPRECATED_ENV_VARS)) {
    if (!env[deprecated]) continue;

    // null replacement means "remove entirely, no successor"
    if (preferred === null) {
      warnings.push({
        key: deprecated,
        message: `Deprecated env var '${deprecated}' is set. Remove it — the feature has no replacement.`,
      });
      continue;
    }

    // Only warn if deprecated is set AND preferred is NOT set
    // (i.e., the deprecated value is actually being used as fallback)
    if (!env[preferred]) {
      warnings.push({
        key: deprecated,
        replacement: preferred,
        message: `Deprecated env var '${deprecated}' is in use. Please migrate to '${preferred}' before the next major release.`,
      });
    }
  }

  return warnings;
}

/**
 * Known dead environment variables — parsed by nothing, have no effect.
 * If set in a deployment, they waste cognitive overhead and invite confusion.
 */
const DEAD_ENV_VARS: string[] = [
  'CEE_LEGACY_PIPELINE_ENABLED',       // Legacy pipeline code removed
  'CEE_BIAS_LLM_DETECTION_ENABLED',    // Never existed in config schema
  'CAUSAL_CLAIMS_ENABLED',             // Feature gated by CEE_CAUSAL_VALIDATION_ENABLED, not this
  'ORCHESTRATOR_ENABLED',              // Actual legacy name is ENABLE_ORCHESTRATOR
  'VITE_ENABLE_ORCHESTRATOR_V2',       // Frontend-only (Vite prefix); not read by backend
  'CEE_UNIFIED_PIPELINE_ENABLED',      // Unified pipeline is always-on; flag retired
  'CEE_MODEL_REPAIR_GRAPH',            // Never existed; canonical name is CEE_MODEL_REPAIR
];

/**
 * Check for dead environment variables that are set but have no effect.
 *
 * @returns Array of warning messages for dead env vars found in process.env
 */
export function checkDeadEnvVars(): EnvVarWarning[] {
  const warnings: EnvVarWarning[] = [];
  for (const key of DEAD_ENV_VARS) {
    if (process.env[key] !== undefined) {
      warnings.push({
        key,
        message: `Environment variable '${key}' is set but has no effect. Remove it from deployment config.`,
      });
    }
  }
  return warnings;
}
