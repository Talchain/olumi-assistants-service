/**
 * Stage 1: Parse — LLM draft + adapter normalisation
 *
 * Source: Pipeline B lines 681-1020
 * Calls existing functions from their current locations — no logic rewrite.
 */

import type { StageContext } from "../types.js";
import type { DraftGraphResult } from "../../../adapters/llm/types.js";
import type { DocPreview } from "../../../services/docProcessing.js";
import type { GraphT } from "../../../schemas/graph.js";
import { groundAttachments, buildRefinementBrief } from "../../../routes/assist.draft-graph.js";
import { calcConfidence } from "../../../utils/confidence.js";
import { estimateTokens, allowedCostUSD } from "../../../utils/costGuard.js";
import { getAdapterWithResolution } from "../../../adapters/llm/router.js";
import { recordModelResolution } from "../../../orchestrator-v5/debug/turn-debug-store.js";
import { getSystemPromptMeta } from "../../../adapters/llm/prompt-loader.js";
import { config, shouldUseStagingPrompts } from "../../../config/index.js";
import { createEdgeFieldStash } from "../edge-identity.js";
import { normaliseCeeGraphVersionAndProvenance } from "../../transforms/graph-normalisation.js";
import {
  DRAFT_REQUEST_BUDGET_MS,
  DRAFT_LLM_TIMEOUT_MS,
  LLM_POST_PROCESSING_HEADROOM_MS,
  MIN_DRAFT_RETRY_BUDGET_MS,
  REPAIR_TIMEOUT_MS,
  getDraftLlmRetryBudgetMs,
  getJitteredRetryDelayMs,
} from "../../../config/timeouts.js";
import { LLMTimeoutError, RequestBudgetExceededError, ClientDisconnectError, UpstreamTimeoutError } from "../../../adapters/llm/errors.js";
import { buildCeeErrorResponse } from "../../validation/pipeline.js";
import { log, emit, calculateCost, TelemetryEvents } from "../../../utils/telemetry.js";
import { detectStrengthDefaultsV1 } from "../../validation/integrity-sentinel.js";
import { STRENGTH_DEFAULT_RETRY_NUDGE } from "../../constants.js";

/**
 * Stage 1: Parse — LLM draft + adapter normalisation.
 *
 * Steps:
 *  1. Ground attachments
 *  2. Confidence + clarifier determination
 *  3. Refinement brief (if applicable)
 *  4. Model override resolution
 *  5. Adapter selection
 *  6. Cost guard
 *  7. LLM call with budget-gated retry (max 2 attempts; a retry is launched
 *     only when the remaining request budget can fit a real draft, and its
 *     timeout is capped to that remaining window — see getDraftLlmRetryBudgetMs)
 *  8. Graph shape assertion (change 2: before stash creation)
 *  9. Edge field stash (frozen Record objects)
 * 10. Graph normalisation (version + provenance)
 * 11. Budget guard
 * 12. Repair budget computation
 * 13. Draft cost calculation
 */
export async function runStageParse(ctx: StageContext): Promise<void> {
  log.info({ requestId: ctx.requestId, stage: "parse" }, "Unified pipeline: Stage 1 (Parse) started");

  // ── Step 1: Ground attachments ──────────────────────────────────────────
  let docs: DocPreview[];
  try {
    const result = await groundAttachments(ctx.input, ctx.rawBody);
    docs = result.docs;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    ctx.earlyReturn = {
      statusCode: 400,
      body: buildCeeErrorResponse("CEE_VALIDATION_FAILED", `Attachment processing failed: ${err.message}`, {
        requestId: ctx.requestId,
      }),
    };
    return;
  }

  // ── Step 2: Confidence ──────────────────────────────────────────────────
  // (The write-only ctx.clarifierStatus that used to be derived here was
  // removed with the Stage-4 clarifier retirement — it had zero readers.)
  ctx.confidence = calcConfidence({ goal: ctx.input.brief });

  // ── Step 3: Refinement brief ────────────────────────────────────────────
  if (config.cee.refinementEnabled && ctx.input.previous_graph !== undefined) {
    ctx.effectiveBrief = buildRefinementBrief(
      ctx.input.brief,
      ctx.input.previous_graph as GraphT,
      {
        mode: (ctx.input as any).refinement_mode,
        instructions: (ctx.input as any).refinement_instructions,
        preserveNodes: (ctx.input as any).preserve_nodes,
      },
    );
  }

  // ── Step 4: Model override resolution ───────────────────────────────────
  let effectiveModelOverride = (ctx.input as any).model as string | undefined;
  // Origin distinguishes a store modelConfig override from a client-body
  // override. The router sees both as modelOverride; this flag preserves
  // the semantic distinction for resolution_source logging.
  let overrideOrigin: 'per_call' | 'store_model_config' = 'per_call';
  if (!effectiveModelOverride) {
    const promptMeta = getSystemPromptMeta("draft_graph");
    if (promptMeta.modelConfig) {
      const env = shouldUseStagingPrompts() ? "staging" : "production";
      const promptModel = promptMeta.modelConfig[env];
      if (promptModel) {
        effectiveModelOverride = promptModel;
        overrideOrigin = 'store_model_config';
        log.info({
          task: "draft_graph",
          env,
          promptModel,
          promptId: promptMeta.promptId,
        }, "Using model from prompt config");
      }
    }
  }

  // ── Step 5: Adapter selection ───────────────────────────────────────────
  const { adapter: draftAdapter, resolution: draftResolution } = getAdapterWithResolution(
    "draft_graph",
    effectiveModelOverride,
    overrideOrigin,
  );
  ctx.draftAdapter = draftAdapter;
  log.debug(
    {
      event: 'model.resolution',
      task: draftResolution.task,
      resolved_model: draftResolution.resolved_model,
      resolution_source: draftResolution.resolution_source,
      request_id: ctx.requestId,
    },
    'Model resolution recorded for LLM call',
  );
  recordModelResolution(ctx.requestId, ctx.requestId, {
    task: draftResolution.task,
    resolved_model: draftResolution.resolved_model,
    resolution_source: draftResolution.resolution_source,
  });

  // ── Step 6: Cost guard ──────────────────────────────────────────────────
  const promptChars = ctx.effectiveBrief.length + docs.reduce((acc, doc) => acc + doc.preview.length, 0);
  const tokensIn = estimateTokens(promptChars);
  const tokensOut = estimateTokens(1200);

  if (!allowedCostUSD(tokensIn, tokensOut, draftAdapter.model)) {
    // CEE_COST_CAP, not CEE_RATE_LIMIT: this is a per-request SPEND cap in
    // USD. It is unrelated to the requests-per-minute limiter in
    // src/middleware/rate-limit.ts, which keeps CEE_RATE_LIMIT.
    ctx.earlyReturn = {
      statusCode: 429,
      body: buildCeeErrorResponse("CEE_COST_CAP", "Cost guard exceeded", {
        requestId: ctx.requestId,
      }),
    };
    return;
  }

  // ── Step 7: LLM call with budget-gated retry ───────────────────────────
  const llmStartTime = Date.now();
  const effectiveLlmTimeout = DRAFT_LLM_TIMEOUT_MS;
  // Same baseline the Step-11 budget guard uses — retry affordability and the
  // guard that would discard a late result MUST agree on what "elapsed" means.
  // The live V5 turn path and the assist.v1 routes thread requestStartMs from
  // route-handler entry (review-576 condition 2); on any caller that omits it,
  // BOTH measurements fall back to LLM start and are blind to pre-LLM time.
  const requestStartMs = ctx.opts.requestStartMs ?? llmStartTime;
  emit(TelemetryEvents.Stage, {
    stage: "llm_start",
    confidence: ctx.confidence,
    tokensIn,
    provider: draftAdapter.name,
    correlation_id: ctx.requestId,
  });

  log.info({
    event: "cee.llm.call_start",
    model: draftAdapter.model,
    timeout_ms: effectiveLlmTimeout,
    request_id: ctx.requestId,
  }, "LLM draft call starting");

  let draftResult: DraftGraphResult | undefined;
  let attempt = 0;
  let strengthDefaultRetried = false;

  while (attempt < 2) {
    attempt += 1;
    const requestId = attempt === 1 ? `draft_${Date.now()}` : `draft_retry_${Date.now()}`;

    // Attempt 1 gets the full single-attempt cap; any retry (timeout or
    // strength-default) is CAPPED to what is still affordable inside
    // DRAFT_REQUEST_BUDGET_MS — never a fresh full window. An uncapped retry
    // produced the 2026-07-20 211s worst case against a 125s proxy deadline.
    const attemptTimeoutMs = attempt === 1
      ? effectiveLlmTimeout
      : getDraftLlmRetryBudgetMs(Date.now() - requestStartMs);

    try {
      const draftThinking = config.cee.thinking?.draftGraphEnabled
        ? { type: 'enabled' as const, budget_tokens: config.cee.thinking.draftGraphBudget }
        : undefined;

      draftResult = await draftAdapter.draftGraph(
        {
          brief: strengthDefaultRetried
            ? `${ctx.effectiveBrief}\n\n${STRENGTH_DEFAULT_RETRY_NUDGE}`
            : ctx.effectiveBrief,
          docs,
          seed: 17,
          flags: typeof ctx.input.flags === "object" && ctx.input.flags !== null
            ? (ctx.input.flags as Record<string, unknown>)
            : undefined,
          includeDebug: ctx.input.include_debug === true,
          briefSignalsHeader: ctx.input.briefSignalsHeader,
          currencyInstruction: ctx.input.currencyInstruction,
          ...(draftThinking ? { thinking: draftThinking } : {}),
        },
        {
          requestId,
          timeoutMs: attemptTimeoutMs,
          collector: ctx.collector,
          bypassCache: ctx.opts.refreshPrompts,
          forceDefault: ctx.opts.forceDefault,
          signal: ctx.opts.signal,
        },
      );

      /**
       * Strength-default retry decision:
       *
       * After a successful LLM call, check whether >=80% of causal edges carry
       * the default strength signature (|mean|≈0.5, std≈0.125). If so, retry
       * once with a nudge appended to the user message. Guards:
       *
       * - CEE_RETRY_ON_DEFAULT_STRENGTHS must be enabled
       * - First attempt only (attempt === 1) — prevents retry-on-retry
       * - Not combinable with timeout retry: if attempt 1 timed out and the
       *   catch block already scheduled a retry, attempt will be 2 here and
       *   the guard prevents a third call. Max 2 attempts total.
       *
       * If the retry still triggers defaults, the result is accepted with a
       * warning (no loop).
       */
      if (!config.cee.retryOnDefaultStrengths) {
        log.debug({
          event: "cee.strength_default.skip",
          reason: "flag_disabled",
          request_id: ctx.requestId,
        }, "Strength-default retry skipped — CEE_RETRY_ON_DEFAULT_STRENGTHS is false");
        break;
      }
      if (attempt !== 1) {
        // attempt === 2 means this is already a retry (timeout or strength-default).
        // Log only when defaults would have been relevant (timeout-first scenario).
        log.debug({
          event: "cee.strength_default.skip",
          reason: "not_first_attempt",
          attempt,
          request_id: ctx.requestId,
        }, "Strength-default retry skipped — already on retry attempt");
        break;
      }
      if (
        draftResult.graph &&
        Array.isArray(draftResult.graph.nodes) &&
        Array.isArray(draftResult.graph.edges)
      ) {
        const detection = detectStrengthDefaultsV1(
          draftResult.graph.nodes as ReadonlyArray<{ id: string; kind?: string }>,
          draftResult.graph.edges as ReadonlyArray<{ from: string; to: string; strength_mean?: number; strength_std?: number; strength?: { mean?: number; std?: number } }>,
        );
        if (detection.detected) {
          ctx.strengthDefaultDetection = {
            detected: true,
            total_edges: detection.total_edges,
            defaulted_count: detection.defaulted_count,
          };

          // Budget gate (2026-07-20 RCA): the nudge retry is another full LLM
          // call — launching it into a window that cannot fit one converts a
          // usable (defaulted) success into a timeout failure. Skip the retry
          // and accept the defaulted result instead.
          const strengthRetryWindowMs = getDraftLlmRetryBudgetMs(Date.now() - requestStartMs);
          if (strengthRetryWindowMs < MIN_DRAFT_RETRY_BUDGET_MS) {
            log.warn({
              event: "cee.strength_default.skip",
              reason: "insufficient_budget",
              retry_window_ms: strengthRetryWindowMs,
              min_retry_budget_ms: MIN_DRAFT_RETRY_BUDGET_MS,
              total_edges: detection.total_edges,
              defaulted_count: detection.defaulted_count,
              request_id: ctx.requestId,
            }, "Strength-default retry skipped — remaining request budget cannot fit another LLM attempt");
            break;
          }

          strengthDefaultRetried = true;

          log.warn({
            event: "cee.strength_default.retry",
            total_edges: detection.total_edges,
            defaulted_count: detection.defaulted_count,
            defaulted_edge_ids: detection.defaulted_edge_ids,
            request_id: ctx.requestId,
          }, "Default strength signature detected on ≥80% of edges — retrying with nudge");

          emit(TelemetryEvents.Stage, {
            stage: "strength_default_retry",
            total_edges: detection.total_edges,
            defaulted_count: detection.defaulted_count,
            correlation_id: ctx.requestId,
          });

          continue;
        }
        // Detection ran but threshold not met — no retry needed
        log.debug({
          event: "cee.strength_default.skip",
          reason: "below_threshold",
          total_edges: detection.total_edges,
          defaulted_count: detection.defaulted_count,
          request_id: ctx.requestId,
        }, "Strength-default retry skipped — defaults below 80% threshold");
      }
      break;
    } catch (error) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      const isTimeout = err.name === "UpstreamTimeoutError";
      const isAbort = err.name === "AbortError" || (ctx.opts.signal?.aborted === true);

      if (isAbort && !isTimeout) {
        const llmDuration = Date.now() - llmStartTime;
        log.info({
          event: "cee.llm.call_aborted",
          model: draftAdapter.model,
          elapsed_ms: llmDuration,
          reason: "client_disconnect",
          request_id: ctx.requestId,
        }, "LLM draft call aborted due to client disconnect");
        throw new ClientDisconnectError(
          "Client disconnected during LLM draft call",
          llmDuration,
          ctx.requestId,
        );
      }

      // UpstreamTimeoutError with pre_aborted phase = external signal abort, not timeout.
      // Route to ClientDisconnectError instead of retrying or wrapping in LLMTimeoutError.
      if (error instanceof UpstreamTimeoutError && error.timeoutPhase === "pre_aborted") {
        const llmDuration = Date.now() - llmStartTime;
        log.info({
          event: "cee.llm.call_aborted",
          model: draftAdapter.model,
          elapsed_ms: llmDuration,
          reason: "client_disconnect_pre_aborted",
          request_id: ctx.requestId,
        }, "LLM draft call aborted due to pre-aborted signal (client disconnect)");
        throw new ClientDisconnectError(
          "Client disconnected before LLM draft call",
          llmDuration,
          ctx.requestId,
        );
      }

      if (isTimeout) {
        const llmDuration = Date.now() - llmStartTime;
        log.warn({
          event: "cee.llm.call_timeout",
          model: draftAdapter.model,
          timeout_ms: attemptTimeoutMs,
          elapsed_ms: llmDuration,
          request_id: ctx.requestId,
        }, "LLM draft call timed out");
      }

      // Budget-gated retry (2026-07-20 RCA): retry only when the window still
      // affordable inside DRAFT_REQUEST_BUDGET_MS can fit a real draft. A
      // first attempt that burned its full window leaves 0 affordable — the
      // old unconditional retry gave a 211s worst case against a 125s proxy
      // deadline, and the Step-11 budget guard discarded every late retry
      // success anyway. Early failures (connect resets etc.) — the only case a
      // retry can help — still get one, capped to the remaining window.
      const retryDelayMs = getJitteredRetryDelayMs();
      const retryWindowMs = getDraftLlmRetryBudgetMs(Date.now() - requestStartMs + retryDelayMs);
      const retryAffordable = retryWindowMs >= MIN_DRAFT_RETRY_BUDGET_MS;

      if (!isTimeout || attempt >= 2 || !retryAffordable) {
        if (isTimeout && attempt < 2 && !retryAffordable) {
          // OBSERVABILITY HONESTY (review-576 condition 3): this is a
          // structured pino LOG, not a registered TelemetryEvents entry — it
          // reaches no Datadog dashboard or alert. Detection of a mis-tuned
          // floor is log search on Render (event:cee.llm.retry_skipped_budget),
          // same as its siblings cee.llm.call_timeout and
          // cee.request_budget.exceeded. Do not describe it as telemetry.
          log.warn({
            event: "cee.llm.retry_skipped_budget",
            model: draftAdapter.model,
            retry_window_ms: retryWindowMs,
            min_retry_budget_ms: MIN_DRAFT_RETRY_BUDGET_MS,
            elapsed_since_request_start_ms: Date.now() - requestStartMs,
            request_id: ctx.requestId,
          }, "Draft retry skipped — remaining request budget cannot fit a useful LLM attempt");
        }
        const llmDuration = Date.now() - llmStartTime;
        const upstreamStatusCode = isTimeout ? 504 : 500;
        emit(TelemetryEvents.DraftUpstreamError, {
          status_code: upstreamStatusCode,
          latency_ms: llmDuration,
          provider: draftAdapter.name,
          correlation_id: ctx.requestId,
        });

        if (isTimeout) {
          throw new LLMTimeoutError(
            `LLM provider did not respond within ${Math.round(attemptTimeoutMs / 1000)}s`,
            draftAdapter.model,
            attemptTimeoutMs,
            llmDuration,
            ctx.requestId,
            err,
          );
        }
        // Capture partial LLM metadata from adapter error (e.g. schema validation
        // failure after a successful LLM call). Without this, ctx.llmMeta stays
        // undefined and _diagnostic_trace.llm_calls is empty on 400 responses.
        const errMeta = (err as any)?._llm_meta;
        if (errMeta && !ctx.llmMeta) {
          ctx.llmMeta = errMeta;
        }
        throw err;
      }

      log.warn(
        {
          provider: draftAdapter.name,
          correlation_id: ctx.requestId,
          delay_ms: retryDelayMs,
          retry_window_ms: retryWindowMs,
        },
        "Upstream draft_graph timeout, retrying once",
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (!draftResult) {
    throw new Error("draft_graph_missing_result");
  }

  // Store strength-default retry state for telemetry/trace
  ctx.strengthDefaultRetried = strengthDefaultRetried;
  if (strengthDefaultRetried) {
    // Re-check the final result to determine if defaults persisted after retry
    const finalGraph = draftResult.graph;
    if (finalGraph && Array.isArray(finalGraph.nodes) && Array.isArray(finalGraph.edges)) {
      const finalDetection = detectStrengthDefaultsV1(
        finalGraph.nodes as ReadonlyArray<{ id: string; kind?: string }>,
        finalGraph.edges as ReadonlyArray<{ from: string; to: string; strength_mean?: number; strength_std?: number; strength?: { mean?: number; std?: number } }>,
      );
      ctx.strengthDefaultDetection = {
        detected: finalDetection.detected,
        total_edges: finalDetection.total_edges,
        defaulted_count: finalDetection.defaulted_count,
      };
      if (finalDetection.detected) {
        log.warn({
          event: "cee.strength_default.persisted_after_retry",
          total_edges: finalDetection.total_edges,
          defaulted_count: finalDetection.defaulted_count,
          request_id: ctx.requestId,
        }, "Default strengths persisted after retry — accepting result");
      } else {
        log.info({
          event: "cee.strength_default.retry_succeeded",
          total_edges: finalDetection.total_edges,
          defaulted_count: finalDetection.defaulted_count,
          request_id: ctx.requestId,
        }, "Strength default retry succeeded — LLM differentiated edge strengths");
      }
    }
  }

  // ── Step 8: Extract results + graph shape assertion (change 2: before stash) ──
  const { graph, rationales, usage: draftUsage, meta: llmMeta } = draftResult;
  ctx.rationales = rationales ?? [];
  ctx.llmMeta = llmMeta;
  // Coaching passthrough: stash LLM coaching for V3 output assembly
  ctx.coaching = (draftResult as any).coaching;
  // Causal claims passthrough (Phase 2B): stash raw for post-STRP validation
  ctx.causalClaims = (draftResult as any).causal_claims;
  // v0.11.0 schema amendment: stash topology_plan for Stage 5 packaging
  // and Stage 6 V1 → V3 deep-equality preservation.
  ctx.topologyPlan = (draftResult as any).topology_plan;
  // Goal constraints passthrough: LLM-emitted constraints merged with regex in Stage 4
  ctx.llmGoalConstraints = (draftResult as any).goal_constraints;

  // Graph shape assertion — must come before createEdgeFieldStash()
  if (!Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    ctx.earlyReturn = {
      statusCode: 400,
      body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "LLM returned malformed graph structure", {
        requestId: ctx.requestId,
      }),
    };
    return;
  }

  ctx.graph = graph as any;

  // LLM call success telemetry
  const llmDurationSuccess = Date.now() - llmStartTime;
  log.info({
    event: "cee.llm.call_success",
    model: draftAdapter.model,
    elapsed_ms: llmDurationSuccess,
    request_id: ctx.requestId,
  }, "LLM draft call succeeded");

  // ── Step 9: Edge field stash (frozen Records — change 1) ───────────────
  const stash = createEdgeFieldStash((graph as any).edges);
  Object.freeze(stash.byEdgeId);
  Object.freeze(stash.byFromTo);
  ctx.edgeFieldStash = stash;

  // ── Step 10: Graph normalisation ────────────────────────────────────────
  ctx.graph = normaliseCeeGraphVersionAndProvenance(ctx.graph as any) as any;

  // ── Step 11: Budget guard ───────────────────────────────────────────────
  const totalElapsed = Date.now() - requestStartMs;
  if (totalElapsed > DRAFT_REQUEST_BUDGET_MS) {
    log.warn({
      event: "cee.request_budget.exceeded",
      budget_ms: DRAFT_REQUEST_BUDGET_MS,
      elapsed_ms: totalElapsed,
      stage: "post_llm_draft",
      request_id: ctx.requestId,
    }, "Request budget exceeded after LLM draft");
    throw new RequestBudgetExceededError(
      `Request exceeded ${Math.round(DRAFT_REQUEST_BUDGET_MS / 1000)}s budget`,
      DRAFT_REQUEST_BUDGET_MS,
      totalElapsed,
      "post_llm_draft",
      ctx.requestId,
    );
  }

  // ── Step 12: Repair budget (budget-aware) ───────────────────────────────
  // Calculate effective repair timeout: min(configured, remaining - 2s safety margin).
  // If no time budget remains, skip repair entirely.
  const REPAIR_SAFETY_MARGIN_MS = 2_000;
  const remainingForRepair = DRAFT_REQUEST_BUDGET_MS - totalElapsed - LLM_POST_PROCESSING_HEADROOM_MS;
  const effectiveRepairTimeout = Math.min(REPAIR_TIMEOUT_MS, remainingForRepair - REPAIR_SAFETY_MARGIN_MS);
  ctx.skipRepairDueToBudget = effectiveRepairTimeout <= 0;
  ctx.repairTimeoutMs = ctx.skipRepairDueToBudget ? 0 : effectiveRepairTimeout;

  log.info({
    event: "cee.repair_budget",
    repair_timeout_configured_ms: REPAIR_TIMEOUT_MS,
    repair_timeout_effective_ms: ctx.repairTimeoutMs,
    remaining_for_repair_ms: remainingForRepair,
    total_elapsed_ms: totalElapsed,
    budget_ms: DRAFT_REQUEST_BUDGET_MS,
    skip_repair: ctx.skipRepairDueToBudget,
    request_id: ctx.requestId,
  }, ctx.skipRepairDueToBudget
    ? "No time budget for LLM repair - will use simple repair if needed"
    : "Repair budget calculated");

  // ── Step 13: Draft cost ─────────────────────────────────────────────────
  ctx.draftCost = calculateCost(draftAdapter.model, draftUsage.input_tokens, draftUsage.output_tokens);
  ctx.draftDurationMs = Date.now() - ctx.start;
}
