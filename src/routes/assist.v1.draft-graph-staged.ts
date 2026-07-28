/**
 * POST /assist/v1/draft-graph/staged — STAGED SSE draft delivery.
 *
 * ROADMAP 1.204 M1, CEE lane 1. Design of record:
 * docs-designs/ASYNC-DRAFTING-DESIGN-2026-07-28.md.
 *
 * ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
 * A cold draft holds the user in one silent ~53 s request (live-probed 53.3 s,
 * first response byte at 53.2 s). The 28 Jul probe decomposed it: the graph is
 * finished and VALIDATED at ~33 s, and the last ~20 s is a coaching pass the
 * user cannot see. This route delivers those stages as they happen instead of
 * as one blob at the end.
 *
 * ── WHAT IS ADDITIVE (and therefore what is NOT at risk) ─────────────────────
 * This is a SIBLING route. `/assist/v1/draft-graph` (buffered) and
 * `/assist/v1/draft-graph/stream` (the pre-existing 2-frame SSE route) are
 * BYTE-UNCHANGED by this work — they do not pass `onStage`, and every emission
 * site in the pipeline is guarded on it. Old clients cannot observe this lane.
 * There is no flag: the route ships ON, and the UI opts in by calling it
 * (house doctrine — no dark launches, no env-var gates). Rollback is a revert.
 *
 * ── D-M RECONCILIATION ──────────────────────────────────────────────────────
 * D-M (11 Jul) rejected mid-turn events pushed through the EXISTING buffered
 * route inside the strict `OlumiResponse` envelope. This route does neither: it
 * is a sibling, and its frames are not `OlumiResponse` — the TERMINAL frame
 * carries the buffered body verbatim as a payload. `/orchestrate/v2/turn` and
 * its transport invariant ("buffered JSON only") are untouched; the invariant
 * script scopes to `src/orchestrator-v5` + `src/orchestrator/route-v2.ts`, and
 * this file is in neither.
 *
 * ── FRAME CONTRACT ──────────────────────────────────────────────────────────
 * Every frame is `event: stage` with a JSON `data` object carrying `stage`,
 * `seq` (monotonic from 0), and `status`.
 *
 *   DRAFTING        status:"in_progress"  — stream opened, pipeline starting
 *   PROGRESS        status:"in_progress"  — node labels from the live token
 *                                            stream; `labels[]`, `phase`
 *   GRAPH_READY     status:"in_progress"  — validated graph, ~33 s; `graph`
 *   COACHING_READY  status:"in_progress"  — coaching settled, ~53 s; `coaching_status`
 *   COMPLETE        status:"complete"     — terminal; `payload` is BYTE-EQUIVALENT
 *                                            to the buffered route's body
 *
 * PARTIAL CONTENT IS NEVER PRESENTED AS COMPLETE. `status` is `"in_progress"`
 * on every pre-terminal frame by construction (`writeStage` derives it from the
 * stage, callers cannot set it), and the terminal frame surfaces
 * `salvaged_from_truncation` so a salvaged draft presents as partial — the
 * register's standing doctrine.
 *
 * ── CLAIM-SAFETY ────────────────────────────────────────────────────────────
 * Pre-terminal frames carry NO leader/designation/recommendation content, and
 * not by filtering: at the pipeline line where GRAPH_READY is emitted,
 * `ctx.coaching` and `ctx.causalClaims` are still `undefined` (the coaching
 * pass has not run), so the claim-bearing fields do not yet exist. PROGRESS
 * carries node labels only. COACHING_READY carries a status enum, not prose.
 *
 * NOTE — this route does NOT pass through route-v2's egress chain
 * (`sanitiseOlumiResponseForEgress` / `validateEgress` /
 * `guardLeadingOptionClaimsAtEgress`). NEITHER DOES ITS BUFFERED SIBLING: that
 * chain is `/orchestrate/v2/turn`-only, so this is parity with the buffered
 * draft route, not a new gap. The pre-terminal frames therefore carry their own
 * structural guard, pinned in tests/integration/staged-draft-sse.test.ts.
 *
 * ── DEGRADATION ─────────────────────────────────────────────────────────────
 * The M3 snapshot/resume store is OUT OF SCOPE (Paul-gated; staging runs
 * `x-olumi-degraded: redis` today). If the socket drops mid-draft this route
 * degrades to a plain completion: writes become no-ops, the pipeline runs to
 * its normal end, and nothing half-written is persisted. The stage emitter is
 * synchronous, un-awaited, and swallows throws, so a dead socket can neither
 * stall nor fail an in-flight draft.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { DraftGraphInput } from "../schemas/assist.js";
import { sanitizeDraftGraphInput } from "./assist.draft-graph.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { runUnifiedPipeline } from "../cee/unified-pipeline/index.js";
import type { PipelineStageEvent } from "../cee/unified-pipeline/types.js";
import { enforceRateBuckets } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../config/timeouts.js";
import { logCeeCall } from "../cee/logging.js";
import { config } from "../config/index.js";
import { evaluatePreflightDecision } from "../cee/validation/preflight-decision.js";
import type { PreflightRejectPayload, NeedsClarificationPayload, PreflightDecision } from "../cee/validation/preflight-decision.js";
import { formatBriefHeader } from "../cee/signals/brief-header.js";
import { detectCurrency, buildCurrencyInstruction } from "../cee/signals/currency-signal.js";
import { parseSchemaVersion, transformResponseToV2 } from "../cee/transforms/index.js";

const EVENT_STREAM = "text/event-stream";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache",
} as const;

/** The five frame classes. Order of DECLARATION is the order of EMISSION. */
export const STAGED_FRAME_CLASSES = [
  "DRAFTING",
  "PROGRESS",
  "GRAPH_READY",
  "COACHING_READY",
  "COMPLETE",
] as const;

export type StagedFrameClass = (typeof STAGED_FRAME_CLASSES)[number];

/**
 * `status` is DERIVED from the stage, never supplied by a caller. This is the
 * mechanism behind "partial content presents as in-progress, never complete":
 * there is no code path that can stamp `"complete"` on a pre-terminal frame,
 * so the doctrine is enforced by construction rather than by review.
 */
function statusForStage(stage: StagedFrameClass): "in_progress" | "complete" {
  return stage === "COMPLETE" ? "complete" : "in_progress";
}

export default async function route(app: FastifyInstance) {
  const FEATURE_VERSION = "staged-1.0.0";

  app.post("/assist/v1/draft-graph/staged", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req) ?? randomUUID();
    const keyId = getRequestKeyId(req);
    const callerContext = getRequestCallerContext(req);
    const telemetryCtx = callerContext ? contextToTelemetry(callerContext) : { request_id: requestId };

    const schemaVersion = parseSchemaVersion((req.query as Record<string, unknown>)?.schema);

    // ── Frame writer ────────────────────────────────────────────────────────
    // Fire-and-forget by design. Backpressure is handled by DROPPING the frame
    // rather than awaiting a drain: a pre-terminal frame is a progressive
    // nicety, and stalling the pipeline on a slow socket would reintroduce the
    // very latency this route removes. The terminal frame is the one that must
    // land, and it lands on the same socket after the pipeline has finished.
    let seq = 0;
    let socketWritable = true;

    const writeStage = (stage: StagedFrameClass, extra?: Record<string, unknown>): void => {
      if (!socketWritable) return;
      const frame = {
        stage,
        seq: seq++,
        status: statusForStage(stage),
        ...(extra ?? {}),
      };
      try {
        const ok = reply.raw.write(`event: stage\ndata: ${JSON.stringify(frame)}\n\n`);
        // `false` means the kernel buffer is full — not an error. Keep writing;
        // Node queues it. Only a destroyed socket stops us.
        if (reply.raw.destroyed) socketWritable = false;
        void ok;
      } catch (err) {
        socketWritable = false;
        log.debug({ err, correlation_id: requestId, stage }, "staged SSE write failed — degrading to silent completion");
      }
    };

    // Rate limiting: shared draft-tier bucket, same feature family as the
    // pre-existing stream route so a client cannot use the staged sibling to
    // sidestep the draft budget.
    const { allowed, retryAfterSeconds } = enforceRateBuckets({
      feature: "draft_graph_staged",
      envVarName: "CEE_STREAM_RATE_LIMIT_RPM",
      keyId: keyId ?? undefined,
      ip: req.ip,
    });

    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Draft Staged rate limit exceeded",
        { retryable: true, requestId, details: { retry_after_seconds: retryAfterSeconds } }
      );

      emit(TelemetryEvents.CeeDraftGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph_staged",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_RATE_LIMIT",
        httpStatus: 429,
      });

      reply.raw.setHeader("X-CEE-Request-ID", requestId);
      reply.raw.setHeader("Retry-After", retryAfterSeconds.toString());
      reply.raw.writeHead(429, SSE_HEADERS);
      writeStage("COMPLETE", { payload: errorBody });
      reply.raw.end();
      return reply;
    }

    // Input validation
    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      log.warn({ correlation_id: requestId, validation_error: parsed.error.flatten() }, "staged stream input validation failed");
      const errorBody = buildCeeErrorResponse(
        "CEE_VALIDATION_FAILED",
        "Invalid input",
        { retryable: false, requestId, details: { field_errors: parsed.error.flatten() } }
      );

      emit(TelemetryEvents.CeeDraftGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 200, // SSE always opens with 200
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph_staged",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_VALIDATION_FAILED",
        httpStatus: 200,
      });

      reply.raw.setHeader("X-CEE-Request-ID", requestId);
      reply.raw.writeHead(200, SSE_HEADERS);
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ code: "CEE_VALIDATION_FAILED", reason: "SCHEMA_VALIDATION_FAILED", message: "Invalid input", details: errorBody.details })}\n\n`
      );
      reply.raw.end();
      return reply;
    }

    const input = sanitizeDraftGraphInput(parsed.data, req.body);

    // Preflight — identical ladder to the buffered and 2-frame routes (shared
    // evaluatePreflightDecision). SSE opens 200 even for reject/clarify.
    let preflightDecision: PreflightDecision | undefined;
    if (config.cee.preflightEnabled) {
      const decision = preflightDecision = evaluatePreflightDecision(input.brief, {
        preflightStrict: config.cee.preflightStrict,
        preflightReadinessThreshold: config.cee.preflightReadinessThreshold,
      });
      const { readiness } = decision;

      emit(TelemetryEvents.PreflightCompleted, {
        ...telemetryCtx,
        ...decision.telemetry,
      });

      if (decision.action === "reject") {
        const p = decision.payload as PreflightRejectPayload;

        emit(TelemetryEvents.PreflightRejected, {
          ...telemetryCtx,
          latency_ms: Date.now() - start,
          readiness_score: readiness.score,
          readiness_level: readiness.level,
          rejection_reason: p.rejection_reason,
        });

        logCeeCall({
          requestId,
          capability: "cee_draft_graph_staged",
          latencyMs: Date.now() - start,
          status: "error",
          errorCode: "CEE_PREFLIGHT_REJECTED",
          httpStatus: 200,
        });

        reply.raw.setHeader("X-CEE-Request-ID", requestId);
        reply.raw.writeHead(200, SSE_HEADERS);
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ code: "CEE_VALIDATION_FAILED", reason: p.rejection_reason, message: p.message })}\n\n`
        );
        reply.raw.end();
        return reply;
      }

      if (decision.action === "clarify") {
        const p = decision.payload as NeedsClarificationPayload;

        emit(TelemetryEvents.PreflightRejected, {
          ...telemetryCtx,
          latency_ms: Date.now() - start,
          readiness_score: readiness.score,
          readiness_level: readiness.level,
          rejection_reason: "underspecified",
        });

        logCeeCall({
          requestId,
          capability: "cee_draft_graph_staged",
          latencyMs: Date.now() - start,
          status: "ok",
          httpStatus: 200,
        });

        reply.raw.setHeader("X-CEE-Request-ID", requestId);
        reply.raw.setHeader("X-CEE-Readiness-Score", readiness.score.toString());
        reply.raw.writeHead(200, SSE_HEADERS);
        reply.raw.write(`event: needs_clarification\ndata: ${JSON.stringify(p)}\n\n`);
        reply.raw.end();
        return reply;
      }

      if (config.cee.clarificationEnforced) {
        const allowDirectThreshold = config.cee.clarificationThresholdAllowDirect;
        const oneRoundThreshold = config.cee.clarificationThresholdOneRound;
        const completedRounds = parsed.data.clarification_rounds_completed ?? 0;

        let requiredRounds = 0;
        if (readiness.score < allowDirectThreshold) {
          requiredRounds = readiness.score >= oneRoundThreshold ? 1 : 2;
        }

        if (requiredRounds > completedRounds) {
          const errorBody = buildCeeErrorResponse(
            "CEE_CLARIFICATION_REQUIRED",
            "Brief requires clarification before drafting",
            {
              retryable: true,
              requestId,
              details: {
                readiness_score: readiness.score,
                readiness_level: readiness.level,
                required_rounds: requiredRounds,
                completed_rounds: completedRounds,
                suggested_questions: readiness.suggested_questions,
                clarification_endpoint: "/assist/clarify-brief",
                hint: `Complete ${requiredRounds - completedRounds} more clarification round(s) before drafting`,
              },
            }
          );

          emit(TelemetryEvents.ClarificationRequired, {
            ...telemetryCtx,
            latency_ms: Date.now() - start,
            readiness_score: readiness.score,
            readiness_level: readiness.level,
            required_rounds: requiredRounds,
            completed_rounds: completedRounds,
          });

          logCeeCall({
            requestId,
            capability: "cee_draft_graph_staged",
            latencyMs: Date.now() - start,
            status: "error",
            errorCode: "CEE_CLARIFICATION_REQUIRED",
            httpStatus: 200,
          });

          reply.raw.setHeader("X-CEE-Request-ID", requestId);
          reply.raw.setHeader("X-CEE-Readiness-Score", readiness.score.toString());
          reply.raw.writeHead(200, SSE_HEADERS);
          reply.raw.write(
            `event: error\ndata: ${JSON.stringify({ code: "CEE_CLARIFICATION_REQUIRED", reason: "CLARIFICATION_REQUIRED", message: "Brief requires clarification before drafting", details: errorBody.details })}\n\n`
          );
          reply.raw.end();
          return reply;
        }
      }
    }

    // ── Thread BriefSignals into pipeline input (parity with siblings) ──────
    if (preflightDecision?.briefSignals) {
      if (config.cee.briefSignalsHeaderEnabled) {
        (input as any).briefSignalsHeader = formatBriefHeader(preflightDecision.briefSignals);
      }
      if (preflightDecision.briefSignals.bias_signals.length > 0) {
        (input as any).bias_signals = preflightDecision.briefSignals.bias_signals;
      }
    }

    const currencySignal = detectCurrency(input.brief);
    (input as any).currencyInstruction = buildCurrencyInstruction(currencySignal);

    // ── Open the stream ────────────────────────────────────────────────────
    reply.raw.setHeader("X-CEE-API-Version", schemaVersion === "v2" ? "v2" : "v1");
    reply.raw.setHeader("X-CEE-Feature-Version", FEATURE_VERSION);
    reply.raw.setHeader("X-CEE-Request-ID", requestId);
    reply.raw.writeHead(200, SSE_HEADERS);

    writeStage("DRAFTING");
    emit(TelemetryEvents.SSEStarted, { correlation_id: requestId, endpoint: "/assist/v1/draft-graph/staged" });

    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch (error) {
        clearInterval(heartbeatInterval);
        log.debug({ error, correlation_id: requestId }, "Heartbeat failed - stopping");
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    let sseEndState: "complete" | "error";
    let graphReadyAtMs: number | null = null;
    let progressFrameCount = 0;

    try {
      const { statusCode, body } = await runUnifiedPipeline(input, req.body, req, {
        schemaVersion,
        strictMode: false,
        includeDebug: false,
        rawOutput: false,
        requestStartMs: start,
        // ── THE STAGED SEAM ────────────────────────────────────────────────
        // A pure observer. It cannot reach the pipeline's context or its
        // response body, so the COMPLETE frame below carries exactly what the
        // buffered route would have returned for this input.
        onStage: (event: PipelineStageEvent) => {
          switch (event.kind) {
            case "PROGRESS":
              progressFrameCount++;
              writeStage("PROGRESS", {
                labels: event.labels,
                phase: event.phase,
                elapsed_ms: event.elapsed_ms,
              });
              break;
            case "GRAPH_READY":
              graphReadyAtMs = event.elapsed_ms;
              writeStage("GRAPH_READY", {
                graph: event.graph,
                elapsed_ms: event.elapsed_ms,
              });
              break;
            case "COACHING_READY":
              writeStage("COACHING_READY", {
                coaching_status: event.coaching_status,
                elapsed_ms: event.elapsed_ms,
              });
              break;
          }
        },
      });

      sseEndState = statusCode >= 400 ? "error" : "complete";
      if (sseEndState === "error") {
        emit(TelemetryEvents.SSEError, {
          correlation_id: requestId,
          status_code: statusCode,
          sse_end_state: sseEndState,
        });
      }

      // Schema transform — identical branch to the 2-frame stream route, so the
      // terminal payload matches that route's COMPLETE payload as well.
      let responseBody: unknown = body;
      if (schemaVersion === "v2" && statusCode === 200 && body && typeof body === "object" && "graph" in body) {
        responseBody = transformResponseToV2(body as any);
      }

      // ── TERMINAL FRAME ─────────────────────────────────────────────────────
      // `payload` is the buffered route's body verbatim. `salvaged_from_truncation`
      // is lifted onto the frame so a client can tell a salvaged (partial) draft
      // from a whole one WITHOUT reaching into the payload — the register's
      // doctrine that partial content must present as partial.
      const salvaged =
        body && typeof body === "object"
          ? ((body as Record<string, unknown>).llm_metadata as Record<string, unknown> | undefined)?.salvaged_from_truncation
          : undefined;

      writeStage("COMPLETE", {
        status_code: statusCode,
        ...(salvaged !== undefined ? { salvaged_from_truncation: salvaged } : {}),
        payload: responseBody,
      });

      emit(TelemetryEvents.SSECompleted, {
        correlation_id: requestId,
        stream_duration_ms: Date.now() - start,
        sse_end_state: sseEndState,
        status_code: statusCode,
      });

      log.info({
        event: "cee.staged_draft.delivered",
        request_id: requestId,
        graph_ready_ms: graphReadyAtMs,
        total_ms: Date.now() - start,
        progress_frames: progressFrameCount,
        frames_emitted: seq,
        socket_writable: socketWritable,
      }, "staged draft delivered");

      logCeeCall({
        requestId,
        capability: "cee_draft_graph_staged",
        latencyMs: Date.now() - start,
        status: statusCode >= 400 ? "error" : "ok",
        httpStatus: statusCode,
      });
    } catch (error) {
      sseEndState = "error";
      log.error({ err: error, correlation_id: requestId }, "staged SSE draft graph failure");

      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        error instanceof Error ? error.message : "Internal error",
        { retryable: true, requestId }
      );

      writeStage("COMPLETE", { status_code: 500, payload: errorBody });

      emit(TelemetryEvents.SSEError, {
        correlation_id: requestId,
        stream_duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : "unknown",
        sse_end_state: sseEndState,
      });
    } finally {
      clearInterval(heartbeatInterval);
      reply.raw.end();
    }

    return reply;
  });
}
