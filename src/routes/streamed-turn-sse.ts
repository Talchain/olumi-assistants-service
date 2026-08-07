/**
 * Staged-SSE delivery of a V5 turn — the shared transport.
 *
 * ROADMAP 2.122 / 1.204 M1, CEE lane 2. Extracted at adversarial review so the
 * two streamed turn routes share ONE transport instead of mirroring it:
 *
 *   · `POST /orchestrate/v2/turn/stream` — service callers (assist key), the
 *     global auth hook applies exactly as it does to the buffered turn.
 *   · `POST /proxy/v5/turn/stream`       — the BROWSER surface: public,
 *     origin-validated, service key injected internally. This is the route the
 *     UI can actually reach; the orchestrate sibling's auth model is
 *     unreachable from a browser by construction (any `VITE_*` value is public).
 *
 * They differ ONLY in ingress — who may call, how the caller is authenticated,
 * and which headers reach the inner turn. Everything after that (the emitter
 * context, the inject, the frame contract, the terminal frame, the timeout, the
 * heartbeat) is this module, once. Two copies of the frame writer would be the
 * hand-maintained mirror of CLAUDE.md trap 12, and the drift would be silent:
 * a divergent copy still emits valid-looking frames.
 *
 * ── HOW THE TURN STAYS THE SAME TURN ────────────────────────────────────────
 * Both routes forward to `/orchestrate/v2/turn` via `app.inject()` — the
 * in-process mechanism `/proxy/v5/turn` has used since it shipped. There is no
 * second pipeline and no forked handler; `route-v2.ts` and `turn-executor.ts`
 * are untouched. The inner request's `routeOptions.url` IS `/orchestrate/v2/turn`,
 * so the `preSerialization` finaliser, the B1 egress validator and the
 * claim-safety chain all run, and the commit happens inside the injected turn.
 *
 * ⚠ NEITHER ROUTE INJECTS INTO THE OTHER. The browser route forwards to the
 * BUFFERED turn, not to `/orchestrate/v2/turn/stream` — `app.inject()` buffers
 * a response until `raw.end()`, so streaming through a streamed route would
 * collapse the frames into one blob at the end and silently delete the entire
 * latency benefit while every frame-content test kept passing.
 *
 * ── FRAME CONTRACT ──────────────────────────────────────────────────────────
 * `event: stage`, JSON `data` with `stage`, `seq` (monotonic from 0), `status`:
 *
 *   DRAFTING        in_progress  — stream opened, turn dispatched
 *   PROGRESS        in_progress  — node labels from the live token stream
 *   GRAPH_READY     in_progress  — validated graph (~33 s); `graph`, `schema_version`
 *   COACHING_READY  in_progress  — coaching pass settled (~53 s); `coaching_status`
 *   COMPLETE        complete     — terminal; `payload` = the turn's OlumiResponse verbatim
 *
 * The three middle classes originate in the pipeline and appear only on a turn
 * that drafts. A turn that edits, answers or runs analysis emits DRAFTING then
 * COMPLETE — correct and honest, not a degraded case.
 *
 * `STAGED_FRAME_CLASSES` and `statusForStage` are IMPORTED from lane 1's staged
 * assist route rather than restated: one vocabulary, one derivation of `status`.
 *
 * ── CLIENT RULES ────────────────────────────────────────────────────────────
 *  · Reconcile by node `id`. Identity is stable between GRAPH_READY and
 *    COMPLETE; NUMERIC VALUES ARE NOT FINAL (`graph-data-integrity` refines them
 *    after the transform). The terminal frame is always the authority.
 *  · DISCARD the GRAPH_READY graph and render the terminal payload if COMPLETE
 *    carries `status_code >= 400`.
 *    ⚠ THE SALVAGE HALF OF THAT RULE IS NOT IMPLEMENTED HERE, DELIBERATELY, AND
 *    A CLIENT MUST NOT CODE FOR IT. The staged ASSIST route also keys the rule
 *    on `salvaged_from_truncation`, lifted from the DRAFT PIPELINE's
 *    `trace.pipeline.llm_metadata`. The turn's `OlumiResponse` is a different
 *    envelope and this lane did not verify where — or whether — that field
 *    lands on it. Shipping the lookup unverified would reproduce exactly the
 *    guarantee theatre #745 found in its own first version of this field (it
 *    resolved to `undefined` on every response and the doctrine it implemented
 *    was decoration). So THESE FRAMES NEVER CARRY `salvaged_from_truncation`,
 *    and a client branching on it would be writing dead code. Rowed.
 *  · `seq` is monotonic, so a dropped frame is detectable. Abort on SILENCE
 *    (heartbeats every `SSE_HEARTBEAT_INTERVAL_MS`), never on elapsed time.
 *  · Resume is not supported (M3 snapshot store is Paul-gated).
 *
 * ── THE CLIENT HANGING UP DOES NOT CANCEL THE TURN. DELIBERATELY. ───────────
 * The buffered assist routes destroy the in-flight pipeline on socket close
 * (`assist.v1.draft-graph.ts:452-457`). Inheriting that here would be a defect:
 * a turn aborted mid-flight could leave the scenario commit half-applied, so a
 * user who closed a tab would return to a corrupted model rather than a
 * finished one. The turn runs to completion and COMMITS; only the frame WRITES
 * become no-ops. Verified under adversarial review: socket destroyed after the
 * first frame ⇒ the turn still committed, no uncaught/unhandled fired.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";

import { runWithStageStream } from "../cee/unified-pipeline/stage-stream-context.js";
import type { PipelineStageEvent } from "../cee/unified-pipeline/types.js";
import {
  STAGED_FRAME_CLASSES,
  statusForStage,
  type StagedFrameClass,
} from "./assist.v1.draft-graph-staged.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../config/timeouts.js";
import { config } from "../config/index.js";

/** The buffered turn both streamed routes forward to. Single source of truth. */
export const STREAMED_TURN_INTERNAL_TARGET = "/orchestrate/v2/turn";

const EVENT_STREAM = "text/event-stream";
const SSE_TRANSPORT_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache",
} as const;

/**
 * Build the header set for the raw SSE `writeHead`.
 *
 * ⚠ THIS FUNCTION IS THE FIX FOR A BLOCKING DEFECT, AND THE MECHANISM IS THE
 * WHOLE POINT. `@fastify/cors` (and `@fastify/rate-limit`, and helmet) stage
 * their headers through the **Reply API**, which flushes only on the framework's
 * send path. An SSE route writes `reply.raw.writeHead` directly and therefore
 * **bypasses that flush entirely** — measured on this repo: the buffered turn's
 * response carried `access-control-allow-origin`, `access-control-expose-headers`
 * and `vary: Origin`; the streamed one carried **none of the three**.
 *
 * The consequence chain is the nasty shape: the OPTIONS preflight PASSES (the
 * cors plugin answers it on its own path), the POST runs, **the turn COMMITS
 * server-side**, and the browser gets an opaque CORS error and can read nothing.
 * An invisible commit plus a natural user retry is duplicate turns.
 *
 * The fix DERIVES rather than mirrors: `reply.getHeaders()` returns whatever
 * Fastify and its plugins have already decided for THIS request — the real CORS
 * verdict for the real origin, from the real allowlist. Re-implementing the
 * origin rules here would be trap 12 with a security blast radius, and it would
 * drift the first time `resolveAllowedOrigins()` changed. Measured at handler
 * time, `reply.getHeaders()` already contains the full CORS decision plus the
 * `x-ratelimit-*` and helmet headers the raw path was also silently dropping.
 *
 * `content-length` is stripped (the body is a stream) and the SSE transport
 * headers are applied LAST so nothing can override the content type.
 */
export function buildStagedSseHeaders(
  reply: FastifyReply,
  extra?: Record<string, string>,
): OutgoingHttpHeaders {
  // Fastify's own header bag types some values as `number` (the `x-ratelimit-*`
  // family arrives that way), which `OutgoingHttpHeaders` rejects for named
  // headers. Copy through a coercion rather than casting the whole object: a
  // blanket cast would also silence a genuinely wrong shape later.
  const staged: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    const key = name.toLowerCase();
    // The body is a stream and the content type is ours — see below.
    if (key === "content-length" || key === "content-type" || key === "transfer-encoding") continue;
    if (value === undefined) continue;
    staged[key] = typeof value === "number" ? String(value) : value;
  }
  return { ...staged, ...(extra ?? {}), ...SSE_TRANSPORT_HEADERS };
}

export interface StagedTurnStreamOptions {
  /** Root Fastify instance — the inject target must be registered on it. */
  readonly app: FastifyInstance;
  readonly reply: FastifyReply;
  /** Correlation id for this stream; also sent to the inner turn (F3). */
  readonly requestId: string;
  /** Headers for the internal turn. The caller owns the auth story. */
  readonly internalHeaders: Record<string, string>;
  /** Request body for the internal turn, as bytes/string. */
  readonly payload: string;
  /** `X-CEE-Feature-Version` value, per route. */
  readonly featureVersion: string;
  /** Route path, for telemetry only. */
  readonly endpoint: string;
  /**
   * Additional raw response headers (e.g. the browser proxy's own CORS set).
   * Applied over the derived Fastify headers, under the SSE transport headers.
   */
  readonly extraResponseHeaders?: Record<string, string>;
}

/**
 * Open the SSE stream, run the turn, emit staged frames, terminate.
 *
 * Never throws: every failure path terminates the stream with a COMPLETE frame
 * carrying a status code, so a client always sees an ending.
 */
export async function streamTurnAsStagedSse(opts: StagedTurnStreamOptions): Promise<void> {
  const { app, reply, requestId, internalHeaders, payload, featureVersion, endpoint } = opts;
  const start = Date.now();

  // ── Frame writer ──────────────────────────────────────────────────────────
  // Fire-and-forget by design. `reply.raw.write` returning false means the
  // kernel buffer is full and Node QUEUES the frame — frames are not dropped.
  // We stop only once the socket is destroyed, i.e. the client has genuinely
  // gone away. Awaiting a drain would stall the turn on a slow socket, which is
  // the exact latency this transport exists to remove.
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

  reply.raw.setHeader("X-CEE-Feature-Version", featureVersion);
  reply.raw.setHeader("X-CEE-Request-ID", requestId);
  reply.raw.writeHead(200, buildStagedSseHeaders(reply, opts.extraResponseHeaders));

  writeStage("DRAFTING");
  emit(TelemetryEvents.SSEStarted, { correlation_id: requestId, endpoint });

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

  // A pure observer of the pipeline running inside the injected turn: it cannot
  // reach the pipeline context or the turn's response body, which is what makes
  // the terminal frame exactly the body the buffered turn would have returned.
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

  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    // ⚠ THE `await` MUST HAPPEN INSIDE `runWithStageStream`, AND THIS IS NOT A
    // STYLE CHOICE. `app.inject()` returns light-my-request's CHAINABLE object,
    // which defers the actual dispatch until the result is awaited. Creating the
    // chainable inside the context and awaiting it outside therefore starts the
    // request in the CALLER's async context, and the emitter is invisible for
    // the whole turn — measured: `currentStageEmitter()` read `false` at
    // route-v2's handler entry, at `dispatchDraftGraph`, and at
    // `handleDraftGraph`, so the turn committed correctly but emitted no
    // GRAPH_READY frame at all. The failure is silent in exactly the wrong way:
    // every commit-semantics pin still passes and only the staged frames vanish.
    const injectPromise = runWithStageStream(onStage, async () =>
      await app.inject({
        method: "POST",
        url: STREAMED_TURN_INTERNAL_TARGET,
        headers: internalHeaders,
        payload,
      }),
    );

    // A hung turn must terminate the stream honestly rather than hold a socket
    // open forever. Reuses the proxy's already-reasoned budget, which config
    // validates to sit above the draft budget and below the route timeout.
    const timeoutMs = config.proxy.browserProxyTimeoutMs;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    // The turn keeps running (and committing) even if we stop waiting — see the
    // socket-close doctrine in the header. Swallow a late rejection so it cannot
    // surface as an unhandled rejection after we have ended the stream.
    injectPromise.catch((err: unknown) => {
      log.warn(
        { correlation_id: requestId, err },
        "[streamed-turn] late internal-inject rejection after stream ended",
      );
    });

    const result = await Promise.race([injectPromise, timeoutPromise]);

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
      return;
    }

    // ── TERMINAL FRAME ───────────────────────────────────────────────────────
    // `payload` is the turn's OlumiResponse verbatim — the same bytes
    // `/orchestrate/v2/turn` returned for this request, because that is exactly
    // what produced them.
    let payloadValue: unknown;
    try {
      payloadValue = result.body.length > 0 ? JSON.parse(result.body) : null;
    } catch (parseErr) {
      // The turn route is JSON-only, so this is a genuine anomaly. Surface it as
      // a terminal failure rather than shipping an unparsed string a client
      // would mistake for a response.
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
      return;
    }

    writeStage("COMPLETE", { status_code: result.statusCode, payload: payloadValue });

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
        endpoint,
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
    // Cleared HERE rather than beside the race, so the inject-rejection path
    // (which throws past the race into the catch above) also clears it. It
    // previously leaked a live timer for up to the full stream budget on that
    // path — harmless but untidy, and `/proxy/v5/turn` already clears in its
    // own catch.
    if (timeoutHandle) clearTimeout(timeoutHandle);
    clearInterval(heartbeatInterval);
    reply.raw.end();
  }
}

export { STAGED_FRAME_CLASSES };
