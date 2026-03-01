/**
 * V2 Route Handler
 *
 * Handles POST /orchestrate/v1/turn when ENABLE_ORCHESTRATOR_V2 is ON.
 * Called from the existing route.ts via conditional dispatch.
 *
 * Features:
 * - Turn nonce validation (optional — skip if absent)
 * - Idempotency via existing module
 * - Pipeline execution via executePipeline()
 */

import type { FastifyRequest } from "fastify";
import { log } from "../../utils/telemetry.js";
import type { OrchestratorTurnRequest } from "../types.js";
import { getIdempotentResponse, setIdempotentResponse, getInflightRequest, registerInflightRequest } from "../idempotency.js";
import { ORCHESTRATOR_TURN_BUDGET_MS } from "../../config/timeouts.js";
import type { OrchestratorResponseEnvelopeV2 } from "./types.js";
import { executePipeline } from "./pipeline.js";
import { createProductionLLMClient } from "./llm-client.js";
import { createProductionToolDispatcher } from "./phase4-tools/index.js";
import type { PLoTClientRunOpts } from "../plot-client.js";
import { buildErrorEnvelope } from "./phase5-validation/envelope-assembler.js";

// ============================================================================
// Turn Nonce Tracking (in-memory, best-effort)
// ============================================================================

// F.4: Replace with Supabase read/write of scenarios.last_turn_nonce.
const NONCE_MAP_MAX_ENTRIES = 1000;
const nonceMap = new Map<string, number>();

/** Test-only: clear nonce state. */
export function _clearNonceMap(): void {
  nonceMap.clear();
}

/**
 * Set a nonce entry with bounded capacity.
 * When at capacity, evict the oldest entry (Map iteration order = insertion order).
 */
function setNonce(scenarioId: string, nonce: number): void {
  if (nonceMap.size >= NONCE_MAP_MAX_ENTRIES && !nonceMap.has(scenarioId)) {
    const firstKey = nonceMap.keys().next().value!;
    nonceMap.delete(firstKey);
    log.warn(
      { scenario_id: scenarioId, evicted_key: firstKey },
      'idempotency cache at capacity — evicting oldest entry',
    );
  }
  nonceMap.set(scenarioId, nonce);
}

// ============================================================================
// V2 Turn Handler
// ============================================================================

export interface TurnResultV2 {
  envelope: OrchestratorResponseEnvelopeV2;
  httpStatus: number;
}

/**
 * Handle a V2 orchestrator turn.
 *
 * 1. Idempotency check (must come first — retries with stale nonces should still return cached envelope)
 * 2. Turn nonce validation (if present)
 * 3. Execute pipeline
 * 4. Update nonce + cache response
 */
export async function handleTurnV2(
  turnRequest: OrchestratorTurnRequest,
  request: FastifyRequest,
  requestId: string,
  turnNonce?: number,
): Promise<TurnResultV2> {
  // 1. Idempotency check — completed responses (before nonce validation)
  // A retry of the same (scenario_id, client_turn_id) must return the cached
  // envelope even if its nonce is now stale relative to a newer turn.
  const cached = getIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id);
  if (cached) {
    log.info(
      { request_id: requestId, client_turn_id: turnRequest.client_turn_id },
      "V2 idempotency cache hit",
    );
    return { envelope: cached as unknown as OrchestratorResponseEnvelopeV2, httpStatus: 200 };
  }

  // 1b. Concurrent dedup — in-flight requests
  const inflight = getInflightRequest(turnRequest.scenario_id, turnRequest.client_turn_id);
  if (inflight) {
    log.info(
      { request_id: requestId, client_turn_id: turnRequest.client_turn_id },
      "V2 idempotency inflight hit",
    );
    const envelope = await inflight;
    return { envelope: envelope as unknown as OrchestratorResponseEnvelopeV2, httpStatus: 200 };
  }

  // 2. Turn nonce validation (optional — skip if absent)
  if (turnNonce === undefined) {
    log.warn(
      { scenario_id: turnRequest.scenario_id },
      'turn_nonce absent — ordering not enforced',
    );
  } else {
    const lastNonce = nonceMap.get(turnRequest.scenario_id);
    if (lastNonce !== undefined && turnNonce <= lastNonce) {
      log.info(
        { scenario_id: turnRequest.scenario_id, turn_nonce: turnNonce, last_nonce: lastNonce },
        "Stale turn nonce rejected",
      );
      return {
        envelope: buildErrorEnvelope(
          'nonce-rejected',
          'STALE_TURN',
          'Turn nonce is stale — a newer turn has been processed',
        ),
        httpStatus: 409,
      };
    }
  }

  // Register in-flight
  let resolveInflight!: (value: unknown) => void;
  const inflightPromise = new Promise<unknown>((resolve) => {
    resolveInflight = resolve;
  });
  registerInflightRequest(
    turnRequest.scenario_id,
    turnRequest.client_turn_id,
    inflightPromise as Promise<import("../types.js").OrchestratorResponseEnvelope>,
  );

  // 3. Build budget opts
  const turnStartedAt = Date.now();
  const budgetController = new AbortController();
  const budgetTimeout = setTimeout(() => budgetController.abort(), ORCHESTRATOR_TURN_BUDGET_MS);

  const plotOpts: PLoTClientRunOpts = {
    turnSignal: budgetController.signal,
    turnStartedAt,
    turnBudgetMs: ORCHESTRATOR_TURN_BUDGET_MS,
  };

  try {
    // 4. Create production deps
    const deps = {
      llmClient: createProductionLLMClient(),
      toolDispatcher: createProductionToolDispatcher(requestId, plotOpts, request),
    };

    // 5. Execute pipeline
    const envelope = await executePipeline(turnRequest, requestId, deps);

    // 6. Update nonce counter
    if (turnNonce !== undefined) {
      setNonce(turnRequest.scenario_id, turnNonce);
    }

    // 7. Cache response for idempotency
    setIdempotentResponse(
      turnRequest.scenario_id,
      turnRequest.client_turn_id,
      envelope as unknown as import("../types.js").OrchestratorResponseEnvelope,
    );
    resolveInflight(envelope);

    const httpStatus = envelope.error ? 500 : 200;
    return { envelope, httpStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { error: message, request_id: requestId },
      "V2 turn handler unhandled error",
    );

    const envelope = buildErrorEnvelope('error', 'PIPELINE_ERROR', 'Something went wrong.');
    resolveInflight(envelope);

    return { envelope, httpStatus: 500 };
  } finally {
    clearTimeout(budgetTimeout);
  }
}
