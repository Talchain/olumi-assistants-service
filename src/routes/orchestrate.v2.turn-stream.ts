/**
 * POST /orchestrate/v2/turn/stream — the V5 TURN, delivered as staged SSE.
 *
 * ROADMAP 2.122 (POC-DONE step 1) / 1.204 M1 — CEE lane 2. Design of record:
 * docs-designs/ASYNC-DRAFTING-DESIGN-2026-07-28.md Q3 item 2.
 *
 * ── WHY THIS ROUTE AND NOT THE ONE LANE 1 SHIPPED ───────────────────────────
 * A cold draft holds the user in one silent ~53–60 s request. Lane 1 (#745)
 * decomposed that wait and proved the graph is validated at ~33 s — but it
 * proved it on `/assist/v1/draft-graph/staged`, and THE PRODUCT DOES NOT DRAFT
 * THAT WAY. The UI's cold draft is a V5 TURN (`turnType: 'explicit_generate'`
 * → `POST /orchestrate/v2/turn`), and the M1-L2 lane established at the bytes
 * why re-pointing it at the assist route is not an option:
 *
 *   The turn COMMITS the drafted graph to the scenario store. The assist route
 *   has no scenario concept at all. Draft over the assist route and
 *   `scenarios.graph` stays NULL — so the very next thing the user does, Run
 *   analysis, honestly refuses with `analysis_not_ready`. A ~20 s latency win
 *   traded for a broken product.
 *
 * This route therefore streams THE TURN. Not a draft that resembles a turn — the
 * turn, with its commit, its session facts, its readiness read-back, its egress
 * chain, and its auth.
 *
 * ── HOW IT IS THE SAME TURN, RATHER THAN A SECOND ONE ───────────────────────
 * It forwards to `/orchestrate/v2/turn` via `app.inject()` — the identical
 * in-process mechanism `/proxy/v5/turn` has used since it shipped
 * (proxy-v5-turn.ts: "app.inject() runs the request through the full Fastify
 * hook chain"). The consequences are the point:
 *
 *   · There is no second pipeline, no forked handler, and no copy of
 *     `sendFinalised200`. `route-v2.ts` and `turn-executor.ts` are UNCHANGED —
 *     zero bytes. A twin would be CLAUDE.md trap 12 with a 250 KB surface.
 *   · The inner request's `routeOptions.url` IS `/orchestrate/v2/turn`, so the
 *     `preSerialization` finaliser (route-v2.ts:2019, URL-scoped by literal
 *     compare), the B1 egress validator and the claim-safety chain all run.
 *     A hand-extracted sibling handler would have escaped every one of them.
 *   · The commit runs inside the injected turn, so persisted state after a
 *     streamed turn is not "equivalent to" the buffered turn's — it is produced
 *     by the same code, in the same order, from the same inputs.
 *   · The terminal frame's payload is the buffered body verbatim, because it is
 *     literally the response the buffered route produced.
 *
 * The one thing `app.inject()` cannot carry is a callback, and `onStage` is a
 * callback. That gap is closed by an async-context store
 * (cee/unified-pipeline/stage-stream-context.ts) whose survival across the
 * inject boundary was MEASURED before this route was written, not assumed.
 *
 * ── TRANSPORT INVARIANT ─────────────────────────────────────────────────────
 * `scripts/validate-transport-invariants.sh` forbids `reply.raw.write` and
 * `text/event-stream` in `src/orchestrator-v5/` and `src/orchestrator/route-v2.ts`.
 * This file is in neither, exactly as lane 1's route is in neither. The
 * invariant needs no re-aiming and no weakening: `/orchestrate/v2/turn` remains
 * buffered-JSON-only, and this route does not write to its reply — it writes to
 * its own.
 *
 * ── FRAME CONTRACT (the five classes, shared with the staged assist route) ──
 * Every frame is `event: stage`, JSON `data` carrying `stage`, `seq` (monotonic
 * from 0) and `status`.
 *
 *   DRAFTING        in_progress  — stream opened, turn dispatched
 *   PROGRESS        in_progress  — node labels from the live token stream
 *   GRAPH_READY     in_progress  — validated graph (~33 s); `graph`, `schema_version`
 *   COACHING_READY  in_progress  — coaching pass settled (~53 s); `coaching_status`
 *   COMPLETE        complete     — terminal; `payload` = the turn's OlumiResponse verbatim
 *
 * The three middle classes originate in the pipeline and appear ONLY on a turn
 * that drafts. A turn that edits, answers or runs analysis emits DRAFTING then
 * COMPLETE — correct and honest, not a degraded case: this route carries full
 * turn semantics, and drafting is simply the turn with stages to report.
 *
 * `STAGED_FRAME_CLASSES` and `statusForStage` are IMPORTED from lane 1's route
 * rather than restated. One vocabulary, one derivation of `status`, no mirror.
 *
 * ── CLIENT RULES (identical to the staged assist route) ─────────────────────
 *  · Reconcile by node `id`. Identity is stable between GRAPH_READY and
 *    COMPLETE; NUMERIC VALUES ARE NOT FINAL — `graph-data-integrity` refines
 *    them after the transform. That is why the frame is `in_progress` and the
 *    terminal frame is always the authority.
 *  · DISCARD the GRAPH_READY graph and render the terminal payload if COMPLETE
 *    carries `status_code >= 400` OR `salvaged_from_truncation === true`.
 *  · `seq` is monotonic, so a dropped frame is detectable. Abort on SILENCE
 *    (heartbeats every `SSE_HEARTBEAT_INTERVAL_MS`), never on elapsed time.
 *  · Resume is not supported (M3 snapshot store is Paul-gated and staging still
 *    reports `x-olumi-degraded: redis`).
 *
 * ── THE CLIENT HANGING UP DOES NOT CANCEL THE TURN. DELIBERATELY. ───────────
 * The buffered assist routes destroy the in-flight pipeline when the socket
 * closes (assist.v1.draft-graph.ts:452-457). Inheriting that here would be a
 * defect, not a feature: a turn aborted mid-flight could leave the scenario
 * commit half-applied, and the user who closed a tab would come back to a
 * corrupted model rather than a finished one. So this route lets the turn run
 * to completion and COMMIT; only the frame WRITES become no-ops. Degradation is
 * to a plain, fully-persisted buffered turn — the same end state as if the user
 * had never streamed at all.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { runWithStageStream } from "../cee/unified-pipeline/stage-stream-context.js";
import type { PipelineStageEvent } from "../cee/unified-pipeline/types.js";
import {
  STAGED_FRAME_CLASSES,
  statusForStage,
  type StagedFrameClass,
} from "./assist.v1.draft-graph-staged.js";
import { getRequestId } from "../utils/request-id.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../config/timeouts.js";
import { config } from "../config/index.js";

/** The route this streams. Single source of truth for the inject target. */
export const STREAMED_TURN_INTERNAL_TARGET = "/orchestrate/v2/turn";

/** The streamed sibling's own path. */
export const STREAMED_TURN_ROUTE = "/orchestrate/v2/turn/stream";

const EVENT_STREAM = "text/event-stream";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache",
} as const;

/**
 * Headers that must NOT cross into the internal inject.
 *
 * Hop-by-hop headers describe THIS connection, not the request, and
 * `content-length` / `accept-encoding` would describe a body and an encoding the
 * injected call re-derives for itself. `accept` is overridden rather than
 * dropped: the client's `accept` is `text/event-stream`, which describes the
 * transport of the OUTER request; the inner turn is and must remain buffered
 * JSON.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "host",
  "content-length",
  "accept-encoding",
]);

/**
 * Build the internal request headers.
 *
 * EVERYTHING ELSE IS FORWARDED VERBATIM, and that is a security property rather
 * than convenience: the inner request must authenticate as the outer one did,
 * against the SAME global `onRequest` auth hook (plugins/auth.ts:145). Dropping
 * or rewriting an auth header here would create exactly the second auth surface
 * this lane is required not to create.
 */
export function buildInternalTurnHeaders(
  headers: FastifyRequest["headers"],
): Record<string, string> {
  const internal: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) continue;
    if (typeof value === "string") internal[key] = value;
    else if (Array.isArray(value)) internal[key] = value.join(", ");
  }
  internal["content-type"] = "application/json";
  internal["accept"] = "application/json";
  return internal;
}

export default async function route(app: FastifyInstance) {
  const FEATURE_VERSION = "streamed-turn-1.0.0";

  app.post(STREAMED_TURN_ROUTE, async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req) ?? randomUUID();

    // ── Frame writer ────────────────────────────────────────────────────────
    // Fire-and-forget by design. `reply.raw.write` returning false means the
    // kernel buffer is full and Node QUEUES the frame — frames are not dropped.
    // We stop only once the socket is destroyed, i.e. the client has genuinely
    // gone away. Awaiting a drain would stall the turn on a slow socket, which
    // is the exact latency this route exists to remove.
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
        reply.raw.write(`event: stage\ndata: ${JSON.stringify(frame)}\n\n`);
        if (reply.raw.destroyed) socketWritable = false;
      } catch (err) {
        socketWritable = false;
        log.debug(
          { err, correlation_id: requestId, stage },
          "streamed-turn SSE write failed — degrading to silent completion",
        );
      }
    };

    // ── Open the stream ─────────────────────────────────────────────────────
    // NOTE ON RATE LIMITS, stated precisely rather than over-claimed:
    // this route mints NO bucket of its own. The expensive-operation allowance
    // is spent by the INNER turn, through the identical limiter the buffered
    // turn goes through, so a client gains no extra draft allowance by
    // streaming. The one measurable difference is the GLOBAL per-minute request
    // counter, which sees the outer request as well as the inner one — the same
    // double-count `/proxy/v5/turn` has produced since it shipped.
    reply.raw.setHeader("X-CEE-Feature-Version", FEATURE_VERSION);
    reply.raw.setHeader("X-CEE-Request-ID", requestId);
    reply.raw.writeHead(200, SSE_HEADERS);

    writeStage("DRAFTING");
    emit(TelemetryEvents.SSEStarted, {
      correlation_id: requestId,
      endpoint: STREAMED_TURN_ROUTE,
    });

    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch (error) {
        clearInterval(heartbeatInterval);
        log.debug({ error, correlation_id: requestId }, "Heartbeat failed - stopping");
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    let graphReadyAtMs: number | null = null;
    let progressFrameCount = 0;

    // The stage emitter. A pure observer of the pipeline running inside the
    // injected turn: it cannot reach the pipeline context or the turn's
    // response body, which is what makes the terminal frame exactly the body
    // the buffered turn would have returned.
    const onStage = (event: PipelineStageEvent): void => {
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
            schema_version: event.schema_version,
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
    };

    try {
      // Forward the RAW body bytes when the auth plugin captured them
      // (preParsing, plugins/auth.ts:120-143). This is not a micro-optimisation:
      // HMAC request signing verifies over the exact bytes, so re-serialising
      // `req.body` would break signature auth on the inner request for every
      // HMAC client. Falling back to a re-serialised body keeps non-HMAC
      // callers working when no raw capture happened.
      const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody;
      const payload = typeof rawBody === "string" ? rawBody : JSON.stringify(req.body ?? {});

      // ⚠ THE `await` MUST HAPPEN INSIDE `runWithStageStream`, AND THIS IS NOT A
      // STYLE CHOICE. `app.inject()` returns light-my-request's CHAINABLE
      // object, which defers the actual dispatch until the result is awaited.
      // Creating the chainable inside the context and awaiting it outside
      // therefore starts the request in the CALLER's async context, and the
      // emitter is invisible for the whole turn — measured: with the await
      // outside, `currentStageEmitter()` read `false` at route-v2's handler
      // entry, at `dispatchDraftGraph`, and at `handleDraftGraph`, so the turn
      // committed correctly but emitted no GRAPH_READY frame at all. The failure
      // is silent in exactly the wrong way: every commit-semantics pin still
      // passes and only the staged frames vanish.
      const injectPromise = runWithStageStream(onStage, async () =>
        await app.inject({
          method: "POST",
          url: STREAMED_TURN_INTERNAL_TARGET,
          headers: buildInternalTurnHeaders(req.headers),
          payload,
        }),
      );

      // A hung turn must still terminate the stream honestly rather than hold a
      // socket open forever. Reuses the proxy's already-reasoned budget, which
      // config validates to sit above the draft budget and below the route
      // timeout.
      const timeoutMs = config.proxy.browserProxyTimeoutMs;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      // The turn keeps running (and committing) even if we stop waiting — see
      // the socket-close doctrine in the header. Swallow a late rejection so it
      // cannot surface as an unhandled rejection after we have ended the stream.
      injectPromise.catch((err: unknown) => {
        log.warn(
          { correlation_id: requestId, err },
          "[streamed-turn] late internal-inject rejection after stream ended",
        );
      });

      const result = await Promise.race([injectPromise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (result === "timeout") {
        log.error(
          { correlation_id: requestId, timeout_ms: timeoutMs, duration: Date.now() - start },
          "[streamed-turn] internal turn exceeded the stream budget",
        );
        writeStage("COMPLETE", {
          status_code: 504,
          payload: {
            schema: "error.v1",
            code: "UPSTREAM_TIMEOUT",
            message: "The turn did not complete within the stream budget.",
            request_id: requestId,
          },
        });
        emit(TelemetryEvents.SSEError, {
          correlation_id: requestId,
          status_code: 504,
          sse_end_state: "error",
        });
        return reply;
      }

      // ── TERMINAL FRAME ────────────────────────────────────────────────────
      // `payload` is the turn's OlumiResponse verbatim — the same bytes
      // `/orchestrate/v2/turn` returned for this request, because that is
      // exactly what produced them.
      let payloadValue: unknown;
      try {
        payloadValue = result.body.length > 0 ? JSON.parse(result.body) : null;
      } catch (parseErr) {
        // The turn route is JSON-only, so this is a genuine anomaly. Surface it
        // as a terminal failure rather than shipping an unparsed string that a
        // client would mistake for a response.
        log.error(
          { correlation_id: requestId, err: parseErr, status: result.statusCode },
          "[streamed-turn] internal turn returned a non-JSON body",
        );
        writeStage("COMPLETE", {
          status_code: 502,
          payload: {
            schema: "error.v1",
            code: "UPSTREAM_MALFORMED_RESPONSE",
            message: "The turn returned a response that could not be parsed.",
            request_id: requestId,
          },
        });
        return reply;
      }

      writeStage("COMPLETE", {
        status_code: result.statusCode,
        payload: payloadValue,
      });

      emit(TelemetryEvents.SSECompleted, {
        correlation_id: requestId,
        stream_duration_ms: Date.now() - start,
        sse_end_state: result.statusCode >= 400 ? "error" : "complete",
        status_code: result.statusCode,
      });

      log.info(
        {
          event: "cee.streamed_turn.delivered",
          request_id: requestId,
          graph_ready_ms: graphReadyAtMs,
          total_ms: Date.now() - start,
          progress_frames: progressFrameCount,
          frames_emitted: seq,
          status_code: result.statusCode,
          socket_writable: socketWritable,
        },
        "streamed turn delivered",
      );
    } catch (error) {
      log.error({ err: error, correlation_id: requestId }, "streamed turn failure");
      writeStage("COMPLETE", {
        status_code: 500,
        payload: {
          schema: "error.v1",
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Internal error",
          request_id: requestId,
        },
      });
      emit(TelemetryEvents.SSEError, {
        correlation_id: requestId,
        stream_duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : "unknown",
        sse_end_state: "error",
      });
    } finally {
      clearInterval(heartbeatInterval);
      reply.raw.end();
    }

    return reply;
  });
}

/**
 * Re-exported so a consumer (and the contract test) reads ONE frame vocabulary
 * for both SSE routes rather than two lists that could drift apart.
 */
export { STAGED_FRAME_CLASSES };
