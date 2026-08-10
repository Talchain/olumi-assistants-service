/**
 * Decision Review Route (M2)
 *
 * POST /assist/v1/decision-review
 *
 * Accepts a deterministic data package from PLoT and returns an LLM-generated
 * decision review as structured JSON.
 *
 * CEE acts as LLM worker only:
 * - NO ISL calls
 * - NO strict validation (PLoT handles that)
 * - Lightweight shape check only
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EnrichmentFlipThresholdSchema } from "@talchain/schemas/boundary";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { config } from "../config/index.js";
import { getSystemPrompt, getSystemPromptMeta } from "../adapters/llm/prompt-loader.js";
import { extractJsonFromResponse } from "../utils/json-extractor.js";
import { getAdapter, getMaxTokensFromConfig } from "../adapters/llm/router.js";
// F3 carrier 2 — the SAME runner-up gap policy the V5 enricher seam installs.
// Imported, never re-implemented: two copies of a policy is how one of them
// gets the next fix (CLAUDE.md trap #12).
import { redactRunnerUpGapStatistic } from "../orchestrator-v5/compose/runner-up-gap-statistic.js";
import type { CallOpts } from "../adapters/llm/types.js";
import { UpstreamHTTPError } from "../adapters/llm/errors.js";
import { HTTP_CLIENT_TIMEOUT_MS } from "../config/timeouts.js";
import { buildLLMRawTrace } from "../cee/llm-output-store.js";
import { buildScienceClaimsSection, injectScienceClaimsSection } from "../cee/decision-review/science-claims.js";
import { performShapeCheck, type ReviewInputForGrounding } from "../cee/decision-review/shape-check.js";
import { buildDecisionReviewUserMessage } from "../cee/decision-review/invoke.js";

// ============================================================================
// Feature Flag
// ============================================================================

function isDecisionReviewEnabled(): boolean {
  return config.cee.decisionReviewEnabled;
}

function isRawOutputEnabled(): boolean {
  return config.cee.observabilityRawIO;
}

// ============================================================================
// Input Schema (Deterministic Data Package from PLoT)
// ============================================================================

/**
 * One `flip_threshold_data` row — DERIVED from the shared contract, never
 * hand-copied. (ROADMAP 2.505)
 *
 * ⚠ WHY THIS IS NOT A LOCAL `z.object({...})` ANY MORE. It used to be, and the
 * copy declared `direction: z.string()` — REQUIRED — untouched since this
 * endpoint's first commit (`e8978011`, 2026-02-02). Meanwhile PLoT's ROADMAP
 * 2.258 (deployed 2026-08-01) began deliberately OMITTING `direction` on an
 * attested-no-flip row, because a direction for a flip that does not exist is a
 * fabricated claim, and `@talchain/schemas` 0.31.0 relaxed
 * `EnrichmentFlipThresholdSchema.direction` to optional precisely to permit it.
 * The contract this repo already vendors therefore SAID THE PAYLOAD WAS VALID
 * while the hand-rolled copy beside it returned HTTP 400 `CEE_VALIDATION_FAILED`
 * in ~2 ms, before any LLM call — `fieldErrors: {flip_threshold_data:
 * ["Required"]}`, measured on live staging 2026-08-05.
 *
 * That is the hand-maintained-mirror defect at a service boundary. Widening
 * `direction` here would have been the right output at the wrong layer: the
 * mirror would remain, and the NEXT field the contract relaxes breaks this
 * route the same way. Deriving kills the class.
 *
 * ⚠ WHY `.partial().required(...)` RATHER THAN THE CONTRACT VERBATIM. The
 * contract additionally REQUIRES `flip_reason`. **PLoT's own producer interface
 * declares that field OPTIONAL** — `flip_reason?: string`
 * (`src/cee/validation/m1-review-types.ts:355` at deployed tip `e18e17c2`).
 * Requiring at the consumer what the producer's declared semantics mark
 * optional IS the 2.505 defect, one field over: it would re-arm the same trap
 * this change exists to disarm. (The route also never reads the field, and is
 * a LIGHTWEIGHT SHAPE CHECK per the file header — but those are the weaker
 * arguments; the producer's declared optionality is the decisive one.)
 *
 * Re-requiring exactly the four fields the route required before this change,
 * minus `direction`, yields the property that matters at a consumer seam:
 *
 *     contract-accepted  ⟹  route-accepted
 *
 * That is a THEOREM about these two schema objects, not a corpus result. After
 * unwrapping `ZodOptional`, every one of the 13 keys resolves to the SAME
 * OBJECT INSTANCE as the contract's; the key sets are identical; `unknownKeys`
 * and `catchall` are identical; and the route's required set is a strict subset
 * of the contract's. `.partial()` erases nothing here — the contract is a plain
 * `ZodObject` with no `.refine`/`.superRefine`/`.transform`/`.default`/`.catch`
 * (unlike the sibling `EnrichmentEdgeEValueStabilitySchema` just below it,
 * where `.partial()` would not even compile).
 *
 * ⚠ THE DELTA VS THE OLD LOCAL COPY IS **NOT** A PURE RELAXATION — MEASURED,
 * NOT ASSUMED. An earlier draft of this comment said it was. That was a wrong
 * mirror of the change it describes, i.e. this PR's own defect class, so the
 * measured numbers replace it. Against the OLD schema (zod 3.23.8 + this
 * repo's vendored 0.34.0):
 *
 *   RELAXED  — `direction` may be absent (the fix), and `flip_reason` absence
 *              stays accepted.
 *   TIGHTENED — 13 discriminating inputs across 9 KEYS. The old row was
 *              `.passthrough()` with only 5 declared keys, so the contract's
 *              other 8 arrived as UNKNOWN keys: unvalidated, any type. Deriving
 *              promotes them to typed optionals. Affected: `factor_id`
 *              (`.min(1)`), plus `unit`, `flip_reason`, `no_flip_in_range`,
 *              `iterations_used`, `probes_used`, `alternative_winner_id`,
 *              `alternative_winner_label`, `margin_sensitivity`.
 *
 * Every one of the 9 agrees with PLoT's declared producer types
 * (`m1-review-types.ts`), so no row the producer's own types permit is newly
 * rejected. ONE RESIDUAL, DISCLOSED RATHER THAN ROUNDED TO ZERO: `unit` is read
 * from `node?.observed_state?.unit` on JSON-sourced graph data, so its TS type
 * is not a runtime guarantee. The exposure is bounded — the contract types
 * `unit` identically, so a non-string unit was already contract-illegal — but
 * it is low, not nil.
 *
 * ⚠ `factor_id` EMPTY-STRING REACHABILITY — NARROWER THAN IT FIRST LOOKED.
 * The LIVE `preResolvedFlipData` path is guarded: `factor-flip-values.ts:215`
 * refuses any row whose `factor_id` is not a non-empty string. But TWO OTHER
 * PRODUCERS CARRY NO SUCH GUARD — `computeFlipThresholdData`
 * (`src/coaching/flip-thresholds.ts`, which filters only on elasticity,
 * `overriddenFactorIds`, and `getFactorCurrentValue(...) !== null`) and
 * `resolveFlipValues` (`src/analysis/flip-thresholds.ts`), which spreads those
 * candidates through. That fallback IS live-reachable: it runs whenever ISL
 * emits no `factor_flip_values` block (`run.ts:7707`). An empty id would
 * additionally need `getFactorCurrentValue('')` to be non-null, so it is
 * PRACTICALLY unreachable — which is a different and weaker claim than
 * "structurally impossible". Pinned by a named spec.
 */
export const FlipThresholdRowSchema = EnrichmentFlipThresholdSchema
  .partial()
  .required({
    factor_id: true,
    factor_label: true,
    current_value: true,
    flip_value: true,
  });

export const DecisionReviewInputSchema = z
  .object({
    /** Raw decision brief text */
    brief: z.string(),

    /** Hash of the brief from PLoT */
    brief_hash: z.string(),

    /** Graph snapshot with nodes and edges */
    graph: z
      .object({
        nodes: z.array(z.record(z.unknown())),
        edges: z.array(z.record(z.unknown())).optional(),
      })
      .passthrough(),

    /** ISL deterministic output */
    isl_results: z
      .object({
        option_comparison: z.array(z.record(z.unknown())),
        factor_sensitivity: z.array(z.record(z.unknown())),
        fragile_edges: z.array(z.record(z.unknown())).optional(),
        robustness: z.record(z.unknown()).optional(),
      })
      .passthrough(),

    /** M1 coaching from PLoT */
    deterministic_coaching: z
      .object({
        readiness: z.string(),
        headline_type: z.string(),
        evidence_gaps: z.array(z.record(z.unknown())),
        model_critiques: z.array(z.record(z.unknown())),
      })
      .passthrough(),

    /** Winning option (accepts id/label or option_id/option_label) */
    winner: z
      .object({
        id: z.string(),
        label: z.string(),
        win_probability: z.number(),
        outcome_mean: z.number().optional(),
      })
      .passthrough(),

    /** Runner-up option (null for single-option decisions) */
    runner_up: z
      .object({
        id: z.string(),
        label: z.string(),
        win_probability: z.number(),
        outcome_mean: z.number().optional(),
      })
      .passthrough()
      .nullable(),

    /**
     * PLoT-computed flip threshold data (max 2). Row shape derived from
     * `@talchain/schemas` — see `FlipThresholdRowSchema` above (ROADMAP 2.505).
     */
    flip_threshold_data: z.array(FlipThresholdRowSchema).optional(),

    /** Correlation ID for tracing */
    correlation_id: z.string().optional(),

    /** Configuration options */
    config: z
      .object({
        /** Include raw LLM output in response (requires CEE_OBSERVABILITY_RAW_IO=true) */
        include_raw: z.boolean().default(false),
      })
      .optional(),
  })
  .passthrough();

type DecisionReviewInput = z.infer<typeof DecisionReviewInputSchema>;

// ============================================================================
// Rate Limiting
// ============================================================================

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const decisionReviewBuckets = new Map<string, BucketState>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

  if (map.size <= MAX_BUCKETS) return;

  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

function checkDecisionReviewLimit(
  key: string,
  limit: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(decisionReviewBuckets, now);
  let state = decisionReviewBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    decisionReviewBuckets.set(key, state);
  }

  if (now - state.windowStart >= WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }

  if (state.count >= limit) {
    const resetAt = state.windowStart + WINDOW_MS;
    const diffMs = Math.max(0, resetAt - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  state.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// ============================================================================
// LLM Call (using adapter pattern)
// ============================================================================

// ChatResult type is imported from adapter types

// The adapter.chat() method provides:
// - Automatic retry with exponential backoff
// - Proper timeout handling
// - Consistent error classification (UpstreamTimeoutError, UpstreamHTTPError)
// - Telemetry integration
// - Idempotency keys for request deduplication

// Mock M2 response is now handled by the FixturesAdapter.chat() method

// ============================================================================
// User Message Builder
// ============================================================================
//
// V5 Group 1 Task B follow-up (review feedback P1.3): the route delegates
// user-message assembly to the shared helper in
// src/cee/decision-review/invoke.ts so the HTTP route and the V5 auto-fire
// path emit byte-identical prompts.

// performShapeCheck extracted to src/cee/decision-review/shape-check.ts

// ============================================================================
// Route Handler
// ============================================================================

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_RPM = config.cee.decisionReviewRateLimitRpm;
  const FEATURE_VERSION = "decision-review-2.0.0";

  app.post("/assist/v1/decision-review", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx
      ? contextToTelemetry(callerCtx)
      : { request_id: requestId };

    // Observability: Request received
    emit(TelemetryEvents.DecisionReviewRequested, {
      ...telemetryCtx,
      feature: "cee_decision_review",
      api_key_present: apiKeyPresent,
    });

    // Feature flag check
    if (!isDecisionReviewEnabled()) {
      const errorBody = buildCeeErrorResponse(
        "CEE_SERVICE_UNAVAILABLE",
        "Decision Review feature is not enabled",
        {
          retryable: false,
          requestId,
        }
      );

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_SERVICE_UNAVAILABLE",
        http_status: 503,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_SERVICE_UNAVAILABLE",
        httpStatus: 503,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(503);
      return reply.send(errorBody);
    }

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkDecisionReviewLimit(
      rateKey,
      RATE_LIMIT_RPM
    );
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "Decision Review rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_RATE_LIMIT",
        httpStatus: 429,
      });

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Validate input
    const parsed = DecisionReviewInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse(
        "CEE_VALIDATION_FAILED",
        "Invalid input",
        {
          retryable: false,
          requestId,
          details: { field_errors: parsed.error.flatten() },
        }
      );

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_VALIDATION_FAILED",
        httpStatus: 400,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input: DecisionReviewInput = parsed.data;
    const correlationId = input.correlation_id ?? requestId;

    // Log with brief_hash, not raw brief text
    log.info(
      {
        request_id: requestId,
        brief_hash: input.brief_hash,
        winner_id: input.winner.id,
        runner_up_id: input.runner_up?.id ?? null,
        readiness: input.deterministic_coaching.readiness,
      },
      "Processing decision review request"
    );

    try {
      // Get system prompt
      const rawPrompt = await getSystemPrompt("decision_review");
      const promptMeta = getSystemPromptMeta("decision_review");

      // Inject <SCIENCE_CLAIMS> section when DSK is enabled, bundle loaded,
      // and the loaded prompt does not already contain the section (store v12+ may bake it in).
      let assembledPrompt = rawPrompt;
      const scienceResult = buildScienceClaimsSection();
      if (scienceResult !== null && !rawPrompt.includes('<SCIENCE_CLAIMS>')) {
        assembledPrompt = injectScienceClaimsSection(rawPrompt, scienceResult.section);
        log.info(
          { request_id: requestId, bias_claims: scienceResult.biasCount, technique_claims: scienceResult.techniqueCount },
          `Science claims injected: ${scienceResult.biasCount} bias, ${scienceResult.techniqueCount} technique`,
        );
      } else if (scienceResult !== null) {
        // Caller-side skip: injector is the authoritative collision handler,
        // but we log here with request-scoped context the injector lacks.
        const openCount = (rawPrompt.match(/<SCIENCE_CLAIMS>/g) || []).length;
        const closeCount = (rawPrompt.match(/<\/SCIENCE_CLAIMS>/g) || []).length;
        log.warn(
          {
            request_id: requestId,
            prompt_version: promptMeta.prompt_version,
            has_open_tag: openCount > 0,
            has_close_tag: closeCount > 0,
            science_claims_tag_count: openCount,
          },
          'Skipping SCIENCE_CLAIMS injection: prompt already contains section',
        );
      }

      // Observability: Prompt loaded
      emit(TelemetryEvents.CeeDecisionReviewPromptLoaded, {
        ...telemetryCtx,
        prompt_version: promptMeta.prompt_version,
        prompt_source: promptMeta.source,
      });

      // Compute margin once — reused in both the LLM prompt and the grounding corpus
      const margin = input.runner_up !== null
        ? input.winner.win_probability - input.runner_up.win_probability
        : null;

      // Build user message via the shared helper (single source of truth
       // across the HTTP endpoint and the V5 auto-fire path).
      const userMessage = buildDecisionReviewUserMessage(input, margin);

      // Get adapter for provider/model info
      const adapter = getAdapter("decision_review");

      // Call LLM
      emit(TelemetryEvents.CeeDecisionReviewLlmCallStarted, {
        ...telemetryCtx,
        user_message_chars: userMessage.length,
        provider: adapter.name,
        model: adapter.model,
      });

      // Get max tokens from config, with fallback
      const configuredMaxTokens = getMaxTokensFromConfig('decision_review');
      const maxTokens = configuredMaxTokens ?? 4096;
      if (configuredMaxTokens === undefined) {
        log.debug(
          { request_id: requestId, task: 'decision_review', default_max_tokens: 4096 },
          'CEE_MAX_TOKENS_DECISION_REVIEW not set, using default'
        );
      }

      // -----------------------------------------------------------------------
      // LLM call helper — extracted so the retry path reuses the same logic
      // -----------------------------------------------------------------------
      const callOpts: CallOpts = {
        requestId,
        timeoutMs: HTTP_CLIENT_TIMEOUT_MS,
      };

      const runLlmCall = async (systemPrompt: string, msg: string) =>
        adapter.chat(
          { system: systemPrompt, userMessage: msg, temperature: 0, maxTokens, responseFormat: 'json_object' },
          callOpts,
        );

      // -----------------------------------------------------------------------
      // Build the grounding corpus from the validated input so the shape check
      // can cross-reference numbers in descriptive fields.
      // -----------------------------------------------------------------------
      const reviewInputForGrounding: ReviewInputForGrounding = {
        winner: input.winner as ReviewInputForGrounding['winner'],
        runner_up: input.runner_up as ReviewInputForGrounding['runner_up'],
        margin,
        isl_results: input.isl_results as ReviewInputForGrounding['isl_results'],
        flip_threshold_data: input.flip_threshold_data as ReviewInputForGrounding['flip_threshold_data'],
      };

      // -----------------------------------------------------------------------
      // Attempt 1
      // -----------------------------------------------------------------------
      let llmResult = await runLlmCall(assembledPrompt, userMessage);

      emit(TelemetryEvents.CeeDecisionReviewLlmCallCompleted, {
        ...telemetryCtx,
        llm_latency_ms: llmResult.latencyMs,
        model: llmResult.model,
        input_tokens: llmResult.usage.input_tokens,
        output_tokens: llmResult.usage.output_tokens,
      });

      let extractionResult = extractJsonFromResponse(llmResult.content, {
        task: "decision_review",
        model: llmResult.model,
        correlationId,
      });

      // Pre-shape telemetry: check required field presence before full validation
      const REQUIRED_SHAPE_KEYS = [
        'narrative_summary', 'story_headlines', 'robustness_explanation',
        'readiness_rationale', 'evidence_enhancements', 'bias_findings',
        'key_assumptions', 'decision_quality_prompts',
      ];
      const extractedObj = extractionResult.json && typeof extractionResult.json === 'object' ? extractionResult.json as Record<string, unknown> : null;
      const presentKeys = extractedObj ? REQUIRED_SHAPE_KEYS.filter((k) => k in extractedObj) : [];

      emit(TelemetryEvents.CeeDecisionReviewJsonExtracted, {
        ...telemetryCtx,
        was_extracted: extractionResult.wasExtracted,
        extraction_method: extractionResult.extractionMethod,
        required_fields_present: presentKeys.length === REQUIRED_SHAPE_KEYS.length,
        required_fields_count: presentKeys.length,
        preamble_length: extractionResult.preambleLength ?? 0,
      });

      let shapeCheck = performShapeCheck(extractionResult.json, reviewInputForGrounding);

      // -----------------------------------------------------------------------
      // Retry on shape failures OR UNGROUNDED_NUMBER (cap: 1 retry total)
      // -----------------------------------------------------------------------
      let didRetry = false;

      // Shape-failure retry: if the LLM returned an object missing required fields,
      // retry once with an explicit field contract before returning 422.
      if (!shapeCheck.valid) {
        log.warn(
          {
            request_id: requestId,
            brief_hash: input.brief_hash,
            attempt: 1,
            shape_errors: shapeCheck.errors,
          },
          'Decision review attempt 1: shape check failed — retrying with explicit field contract',
        );

        const shapeCorrectionSuffix = [
          '',
          '<CORRECTION>',
          'Your previous response was missing required fields. Return a JSON object with EXACTLY these top-level fields:',
          '- narrative_summary (string)',
          '- story_headlines (non-empty object)',
          '- robustness_explanation (object with summary, primary_risk, stability_factors[], fragility_factors[])',
          '- readiness_rationale (string)',
          '- evidence_enhancements (object)',
          '- bias_findings (array, max 3 items)',
          '- key_assumptions (array, max 5 items)',
          '- decision_quality_prompts (array, max 3 items)',
          'Return ONLY the JSON object. No markdown fences, no preamble, no explanation.',
          '</CORRECTION>',
        ].join('\n');

        const retryUserMessage = userMessage + shapeCorrectionSuffix;
        const retryResult = await runLlmCall(assembledPrompt, retryUserMessage);

        log.info(
          {
            request_id: requestId,
            attempt: 2,
            retry_reason: 'shape_failure',
            input_tokens: retryResult.usage.input_tokens,
            output_tokens: retryResult.usage.output_tokens,
          },
          'Decision review attempt 2 (shape retry) completed',
        );

        const retryExtraction = extractJsonFromResponse(retryResult.content, {
          task: "decision_review",
          model: retryResult.model,
          correlationId,
        });
        const retryShapeCheck = performShapeCheck(retryExtraction.json, reviewInputForGrounding);

        llmResult = retryResult;
        extractionResult = retryExtraction;
        shapeCheck = retryShapeCheck;
        didRetry = true;

        if (retryShapeCheck.valid) {
          log.info(
            { request_id: requestId, attempt: 2 },
            'Decision review shape retry resolved missing fields',
          );
        } else {
          log.warn(
            { request_id: requestId, errors: retryShapeCheck.errors },
            'Decision review shape retry still invalid — will return 422',
          );
        }
      }

      // Recompute warnings from the current shapeCheck (may have changed after shape retry)
      const ungroundedWarnings = shapeCheck.warnings.filter((w) =>
        w.startsWith('UNGROUNDED_NUMBER'),
      );

      if (shapeCheck.valid && ungroundedWarnings.length > 0 && !didRetry) {
        // Extract the specific fabricated numbers for a targeted correction prompt
        const fabricatedNumbers = ungroundedWarnings.map((w) => {
          const match = /UNGROUNDED_NUMBER: "([^"]+)"/.exec(w);
          return match ? match[1] : 'unknown';
        });

        log.warn(
          {
            request_id: requestId,
            brief_hash: input.brief_hash,
            attempt: 1,
            ungrounded_numbers: fabricatedNumbers,
            warnings: ungroundedWarnings,
          },
          'Decision review attempt 1: UNGROUNDED_NUMBER detected — retrying with correction prompt',
        );

        emit(TelemetryEvents.CeeDecisionReviewShapeCheckWarnings, {
          ...telemetryCtx,
          warnings: ungroundedWarnings,
          attempt: 1,
        });

        // Build correction message: append the original user message with a targeted instruction
        const correctionSuffix = [
          '',
          '<CORRECTION>',
          `Your previous response contained numbers that do not appear in the input data: ${fabricatedNumbers.map((n) => `"${n}"`).join(', ')}.`,
          'Rewrite the entire response using ONLY numbers that appear verbatim in the provided input fields (winner, runner_up, margin, isl_results, flip_threshold_data).',
          'Every number in narrative_summary, robustness_explanation, readiness_rationale, scenario_contexts, flip_thresholds, pre_mortem, and bias_findings.description must be traceable to an input value (±10%).',
          'Return ONLY the corrected JSON object. No explanation.',
          '</CORRECTION>',
        ].join('\n');

        const retryUserMessage = userMessage + correctionSuffix;
        const retryResult = await runLlmCall(assembledPrompt, retryUserMessage);

        log.info(
          {
            request_id: requestId,
            attempt: 2,
            input_tokens: retryResult.usage.input_tokens,
            output_tokens: retryResult.usage.output_tokens,
          },
          'Decision review attempt 2 (UNGROUNDED_NUMBER retry) completed',
        );

        const retryExtraction = extractJsonFromResponse(retryResult.content, {
          task: "decision_review",
          model: retryResult.model,
          correlationId,
        });
        const retryShapeCheck = performShapeCheck(retryExtraction.json, reviewInputForGrounding);

        const retryUngrounded = retryShapeCheck.warnings.filter((w) =>
          w.startsWith('UNGROUNDED_NUMBER'),
        );

        if (retryUngrounded.length === 0 || !retryShapeCheck.valid) {
          // Retry resolved grounding violations (or introduced shape errors — fall through to normal handling)
          llmResult = retryResult;
          extractionResult = retryExtraction;
          shapeCheck = retryShapeCheck;
          didRetry = true;

          if (retryUngrounded.length === 0) {
            log.info(
              { request_id: requestId, attempt: 2, ungrounded_numbers: [] },
              'Decision review retry resolved UNGROUNDED_NUMBER violations',
            );
          } else {
            // Retry also had shape errors — accept it and let normal shape rejection handle it
            log.warn(
              { request_id: requestId, errors: retryShapeCheck.errors },
              'Decision review retry introduced shape errors; proceeding with retry result',
            );
          }
        } else {
          // Retry still has ungrounded numbers — graceful degradation: use retry result but keep warnings
          llmResult = retryResult;
          extractionResult = retryExtraction;
          shapeCheck = retryShapeCheck;
          didRetry = true;

          const retryFabricated = retryUngrounded.map((w) => {
            const match = /UNGROUNDED_NUMBER: "([^"]+)"/.exec(w);
            return match ? match[1] : 'unknown';
          });

          log.warn(
            {
              request_id: requestId,
              attempt: 2,
              ungrounded_numbers: retryFabricated,
            },
            'Decision review retry still has UNGROUNDED_NUMBER violations — degraded response will be returned',
          );
        }
      }

      // Build llm_raw trace (same pattern as draft-graph)
      const llmRawTrace = buildLLMRawTrace(requestId, llmResult.content, extractionResult.json, {
        model: llmResult.model,
        promptVersion: promptMeta.prompt_version,
        storeOutput: true,
      });

      if (!shapeCheck.valid) {
        log.warn(
          {
            request_id: requestId,
            brief_hash: input.brief_hash,
            errors: shapeCheck.errors,
            did_retry: didRetry,
          },
          "Decision review response failed shape check"
        );

        emit(TelemetryEvents.CeeDecisionReviewShapeCheckFailed, {
          ...telemetryCtx,
          errors: shapeCheck.errors,
        });

        // Return error with shape check details and llm_raw for diagnosis
        const errorBody = buildCeeErrorResponse(
          "CEE_LLM_VALIDATION_FAILED",
          "LLM response did not match expected M2 schema",
          {
            retryable: true,
            requestId,
            details: {
              shape_errors: shapeCheck.errors,
              partial_response: extractionResult.json,
              llm_raw: llmRawTrace,
            },
          }
        );

        logCeeCall({
          requestId,
          capability: "cee_decision_review",
          latencyMs: Date.now() - start,
          status: "error",
          errorCode: "CEE_LLM_VALIDATION_FAILED",
          httpStatus: 422,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(422);
        return reply.send(errorBody);
      }

      if (shapeCheck.warnings.length > 0) {
        log.info(
          {
            request_id: requestId,
            brief_hash: input.brief_hash,
            warnings: shapeCheck.warnings,
            did_retry: didRetry,
          },
          "Decision review response has shape warnings"
        );

        emit(TelemetryEvents.CeeDecisionReviewShapeCheckWarnings, {
          ...telemetryCtx,
          warnings: shapeCheck.warnings,
        });
      }

      // Build response
      //
      // F3 CARRIER 2 — the runner-up GAP statistic, removed at THIS route's
      // egress with the SAME policy the V5 enricher seam applies. Not a second
      // rule: the same reader, the same replacement, the same per-field,
      // per-sentence action (`compose/runner-up-gap-statistic.ts`).
      //
      // WHY THE ROUTE NEEDS ITS OWN INSTALL. The V5 seam covers the auto-fire
      // path only. PLoT's `decision-review-orchestrator.ts` calls THIS route
      // and merges the parsed review into its `/v2/run` response as
      // `m1_review` — a second wire carrier for `narrative_summary` and
      // `key_assumptions` that never passes through the enricher, and that the
      // UI has live readers for. One producer, two exits; both must be seamed
      // or the policy is a guard pointed at one door (CLAUDE.md trap 3b at the
      // carrier grain).
      //
      // Placed at the SINGLE point where the parsed review becomes the response
      // body, AFTER the shape check (which is structural and must read what the
      // model actually produced) and BEFORE anything reads `reviewOutput`, so
      // there is no un-redacted path to the wire.
      const rawReviewOutput = extractionResult.json as Record<string, unknown>;
      const gapRedaction = redactRunnerUpGapStatistic(rawReviewOutput);
      if (gapRedaction.fields > 0) {
        log.warn(
          {
            event: 'cee.decision_review.runner_up_gap_redacted',
            request_id: requestId,
            brief_hash: input.brief_hash,
            // Field PATHS and pattern CODES only — never the matched prose,
            // which is the user's own decision content (R-004).
            hit_paths: gapRedaction.paths,
            hit_codes: gapRedaction.codes,
            hit_fields: gapRedaction.fields,
          },
          'cee.decision_review.runner_up_gap_redacted: the review stated the size of the lead as a ' +
            'gap between options. The gap between two win frequencies is not a difference in outcome ' +
            'and inflates when any other option collapses. FIX THE SERVED PROMPT — the repo default ' +
            'is correct; the PMS `decision_review_default` row is what this alarm is measuring.',
        );
      }
      const reviewOutput = gapRedaction.value;
      const latencyMs = Date.now() - start;

      const response: Record<string, unknown> = {
        review: reviewOutput,
        trace: {
          request_id: requestId,
          correlation_id: correlationId,
          brief_hash: input.brief_hash,
          prompt_version: promptMeta.prompt_version,
          prompt_source: promptMeta.source,
          pipeline: {
            llm_raw: llmRawTrace,
          },
        },
        _meta: {
          model: llmResult.model,
          model_used: llmResult.model,
          latency_ms: latencyMs,
          llm_latency_ms: llmResult.latencyMs,
          did_retry: didRetry,
          token_usage: {
            input_tokens: llmResult.usage.input_tokens,
            output_tokens: llmResult.usage.output_tokens,
            total_tokens:
              llmResult.usage.input_tokens + llmResult.usage.output_tokens,
          },
          extraction_method: extractionResult.extractionMethod,
          shape_warnings: shapeCheck.warnings.length > 0 ? shapeCheck.warnings : undefined,
        },
      };

      // Include raw LLM output only if requested AND env var allows it
      if (input.config?.include_raw && isRawOutputEnabled()) {
        (response._meta as Record<string, unknown>).raw_llm_output = llmResult.content;
      } else if (input.config?.include_raw && !isRawOutputEnabled()) {
        log.debug(
          { request_id: requestId },
          "include_raw requested but CEE_OBSERVABILITY_RAW_IO is disabled"
        );
      }

      // Observability: Success
      emit(TelemetryEvents.DecisionReviewSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        llm_latency_ms: llmResult.latencyMs,
        model: llmResult.model,
        readiness: input.deterministic_coaching.readiness,
        bias_findings_count: Array.isArray(reviewOutput.bias_findings)
          ? reviewOutput.bias_findings.length
          : 0,
        key_assumptions_count: Array.isArray(reviewOutput.key_assumptions)
          ? reviewOutput.key_assumptions.length
          : 0,
        has_pre_mortem: Boolean(reviewOutput.pre_mortem),
        has_flip_thresholds: Array.isArray(reviewOutput.flip_thresholds) && reviewOutput.flip_thresholds.length > 0,
        did_retry: didRetry,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs,
        status: shapeCheck.warnings.length > 0 ? "degraded" : "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");
      const isTimeout =
        err.name === "AbortError" || err.message.includes("timeout");
      const isUpstreamError = error instanceof UpstreamHTTPError;

      // Extract upstream error details for debug bundles
      const upstreamDetails = isUpstreamError
        ? {
            upstream_status: (error as UpstreamHTTPError).status,
            upstream_code: (error as UpstreamHTTPError).code,
            upstream_provider: (error as UpstreamHTTPError).provider,
          }
        : undefined;

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR",
        http_status: isTimeout ? 504 : 500,
        error_message: err.message,
        ...upstreamDetails,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR",
        httpStatus: isTimeout ? 504 : 500,
      });

      log.error(
        {
          request_id: requestId,
          error: err.message,
          stack: err.stack,
          ...upstreamDetails,
        },
        "Decision review failed"
      );

      const errorBody = buildCeeErrorResponse(
        isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR",
        err.message || "internal error",
        {
          retryable: isTimeout,
          requestId,
          // Include upstream error details so debug bundles capture the actual failure reason
          details: {
            error_detail: err.message,
            ...(upstreamDetails || {}),
          },
        }
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(isTimeout ? 504 : 500);
      return reply.send(errorBody);
    }
  });
}
