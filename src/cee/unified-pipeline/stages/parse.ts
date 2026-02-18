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
import { calcConfidence, shouldClarify } from "../../../utils/confidence.js";
import { estimateTokens, allowedCostUSD } from "../../../utils/costGuard.js";
import { getAdapter } from "../../../adapters/llm/router.js";
import { getSystemPromptMeta } from "../../../adapters/llm/prompt-loader.js";
import { config, shouldUseStagingPrompts } from "../../../config/index.js";
import { createEdgeFieldStash } from "../edge-identity.js";
import { normaliseCeeGraphVersionAndProvenance } from "../../transforms/graph-normalisation.js";
import {
  DRAFT_REQUEST_BUDGET_MS,
  DRAFT_LLM_TIMEOUT_MS,
  LLM_POST_PROCESSING_HEADROOM_MS,
  REPAIR_TIMEOUT_MS,
  getJitteredRetryDelayMs,
} from "../../../config/timeouts.js";
import { LLMTimeoutError, RequestBudgetExceededError, ClientDisconnectError, UpstreamTimeoutError } from "../../../adapters/llm/errors.js";
import { buildCeeErrorResponse } from "../../validation/pipeline.js";
import { log, emit, calculateCost, TelemetryEvents } from "../../../utils/telemetry.js";

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
 *  7. LLM call with retry (max 2 attempts)
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

  // ── Step 2: Confidence + clarifier ──────────────────────────────────────
  ctx.confidence = calcConfidence({ goal: ctx.input.brief });
  // Inline determineClarifier logic (Pipeline B line 567-570)
  if (ctx.confidence >= 0.9) {
    ctx.clarifierStatus = "confident";
  } else {
    ctx.clarifierStatus = shouldClarify(ctx.confidence, 0) ? "max_rounds" : "complete";
  }

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
  if (!effectiveModelOverride) {
    const promptMeta = getSystemPromptMeta("draft_graph");
    if (promptMeta.modelConfig) {
      const env = shouldUseStagingPrompts() ? "staging" : "production";
      const promptModel = promptMeta.modelConfig[env];
      if (promptModel) {
        effectiveModelOverride = promptModel;
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
  const draftAdapter = getAdapter("draft_graph", effectiveModelOverride);
  ctx.draftAdapter = draftAdapter;

  // ── Step 6: Cost guard ──────────────────────────────────────────────────
  const promptChars = ctx.effectiveBrief.length + docs.reduce((acc, doc) => acc + doc.preview.length, 0);
  const tokensIn = estimateTokens(promptChars);
  const tokensOut = estimateTokens(1200);

  if (!allowedCostUSD(tokensIn, tokensOut, draftAdapter.model)) {
    ctx.earlyReturn = {
      statusCode: 429,
      body: buildCeeErrorResponse("CEE_RATE_LIMIT", "Cost guard exceeded", {
        requestId: ctx.requestId,
      }),
    };
    return;
  }

  // ── Step 7: LLM call with retry ────────────────────────────────────────
  const llmStartTime = Date.now();
  const effectiveLlmTimeout = DRAFT_LLM_TIMEOUT_MS;
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

  while (attempt < 2) {
    attempt += 1;
    const requestId = attempt === 1 ? `draft_${Date.now()}` : `draft_retry_${Date.now()}`;

    try {
      draftResult = await draftAdapter.draftGraph(
        {
          brief: ctx.effectiveBrief,
          docs,
          seed: 17,
          flags: typeof ctx.input.flags === "object" && ctx.input.flags !== null
            ? (ctx.input.flags as Record<string, unknown>)
            : undefined,
          includeDebug: ctx.input.include_debug === true,
        },
        {
          requestId,
          timeoutMs: effectiveLlmTimeout,
          collector: ctx.collector,
          bypassCache: ctx.opts.refreshPrompts,
          forceDefault: ctx.opts.forceDefault,
          signal: ctx.opts.signal,
        },
      );
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
          timeout_ms: effectiveLlmTimeout,
          elapsed_ms: llmDuration,
          request_id: ctx.requestId,
        }, "LLM draft call timed out");
      }

      if (!isTimeout || attempt >= 2) {
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
            `LLM provider did not respond within ${Math.round(effectiveLlmTimeout / 1000)}s`,
            draftAdapter.model,
            effectiveLlmTimeout,
            llmDuration,
            ctx.requestId,
            err,
          );
        }
        throw err;
      }

      const delayMs = getJitteredRetryDelayMs();
      log.warn(
        { provider: draftAdapter.name, correlation_id: ctx.requestId, delay_ms: delayMs },
        "Upstream draft_graph timeout, retrying once",
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!draftResult) {
    throw new Error("draft_graph_missing_result");
  }

  // ── Step 8: Extract results + graph shape assertion (change 2: before stash) ──
  const { graph, rationales, usage: draftUsage, meta: llmMeta } = draftResult;
  ctx.rationales = rationales ?? [];
  ctx.llmMeta = llmMeta;
  // Coaching passthrough: stash LLM coaching for V3 output assembly
  ctx.coaching = (draftResult as any).coaching;

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
  const requestStartMs = ctx.opts.requestStartMs ?? llmStartTime;
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
