/**
 * ROADMAP 2.1249 — a terminal frame nobody received is not a `complete` stream.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * Both staged SSE routes tracked `socketWritable` (the frame writer flips it the
 * moment `reply.raw` is destroyed or a write throws) and LOGGED it on the
 * delivery line — then derived `sse_end_state` from the HTTP status code alone.
 * A turn that built and PERSISTED a draft, emitted 2 of 4 frames and lost its
 * socket was therefore recorded as `sse_end_state: "complete"`, at info level,
 * with a 200. The SLO
 * (`sse.completed{sse_end_state:complete} / sse.completed{env:prod}`) counted it
 * as a success.
 *
 * ── WHAT THESE TESTS BIND, AND WHY BOTH HALVES ARE NEEDED ──────────────────
 * The first block tests the DERIVATION. On its own that would prove nothing
 * about the product: a correct helper nothing calls is the guarantee-theatre
 * shape this estate keeps finding. The second block therefore drives the real
 * `streamTurnAsStagedSse` with a socket that dies mid-stream and asserts the
 * TELEMETRY THE ROUTE ACTUALLY EMITS — so a mutant that reverts the call site
 * while leaving the helper intact goes RED.
 *
 * ── THE PRECEDENCE CASES ARE NOT DECORATION ────────────────────────────────
 * A 500 on a dead socket must ALSO read `undelivered`, and a 200 on a live
 * socket must NOT. Testing only "dead + 200 → undelivered" would pass for an
 * implementation that ignored the status code entirely, and testing only the
 * live cases would pass for the defect itself. Every case here has its
 * opposite-direction twin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance, FastifyReply } from "fastify";

import { resolveSseEndState } from "../assist.v1.draft-graph-staged.js";
import { streamTurnAsStagedSse } from "../streamed-turn-sse.js";
import { setTestSink, log } from "../../utils/telemetry.js";

describe("resolveSseEndState — the derivation", () => {
  it("reports `undelivered` when the socket died, even on a 200", () => {
    expect(resolveSseEndState({ socketWritable: false, statusCode: 200 })).toBe("undelivered");
  });

  it("reports `undelivered` when the socket died, even on a 500 (precedence, both ways)", () => {
    expect(resolveSseEndState({ socketWritable: false, statusCode: 500 })).toBe("undelivered");
  });

  it("reports `complete` only when the socket survived AND the turn succeeded", () => {
    expect(resolveSseEndState({ socketWritable: true, statusCode: 200 })).toBe("complete");
  });

  it("still reports `error` for a failed turn the client DID receive", () => {
    expect(resolveSseEndState({ socketWritable: true, statusCode: 500 })).toBe("error");
  });
});

// ── The route-level binding ─────────────────────────────────────────────────

interface CapturedEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/**
 * A `reply` stand-in whose raw socket dies after `writesBeforeDeath` frames —
 * the shape of the measured incident (frames emitted, then nothing).
 *
 * `destroyed` is what the real writer reads, so this reproduces the production
 * mechanism rather than simulating its symptom.
 */
function makeReply(writesBeforeDeath: number): {
  reply: FastifyReply;
  writes: string[];
} {
  const writes: string[] = [];
  const raw = {
    destroyed: false,
    setHeader: () => {},
    writeHead: () => {},
    write(chunk: string) {
      if (this.destroyed) return false;
      writes.push(chunk);
      // Heartbeats do not count towards the frame budget.
      if (!chunk.startsWith("event: stage")) return true;
      const stageFrames = writes.filter((w) => w.startsWith("event: stage")).length;
      if (stageFrames >= writesBeforeDeath) this.destroyed = true;
      return true;
    },
    end: () => {},
  };
  const reply = {
    raw,
    getHeaders: () => ({}),
  } as unknown as FastifyReply;
  return { reply, writes };
}

/** A Fastify stand-in whose `inject` returns a successful turn body. */
function makeApp(statusCode: number): FastifyInstance {
  return {
    inject: () =>
      Promise.resolve({ statusCode, body: JSON.stringify({ ok: true }) }) as never,
  } as unknown as FastifyInstance;
}

describe("streamTurnAsStagedSse — the route reports delivery, not just status", () => {
  let captured: CapturedEvent[];
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captured = [];
    setTestSink((event, data) => {
      captured.push({ event, data: data as Record<string, unknown> });
    });
    warnSpy = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    infoSpy = vi.spyOn(log, "info").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    setTestSink(null);
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  function completedEvent(): Record<string, unknown> {
    const found = captured.filter((e) => e.event === "assist.draft.sse_completed");
    expect(found, "no sse_completed event was emitted").toHaveLength(1);
    return found[0].data;
  }

  function deliveryLines(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
    const calls = spy.mock.calls as unknown[][];
    return calls
      .map((call): Record<string, unknown> => call[0] as Record<string, unknown>)
      .filter((arg): boolean => Boolean(arg) && arg.event === "cee.streamed_turn.delivered");
  }

  it("a 200 turn whose socket died mid-stream is reported UNDELIVERED, at warn level", async () => {
    // Dies on the very first frame (DRAFTING), so the terminal COMPLETE cannot
    // land — the incident shape.
    const { reply } = makeReply(1);

    await streamTurnAsStagedSse({
      app: makeApp(200),
      reply,
      requestId: "req-dead-socket",
      internalHeaders: {},
      payload: "{}",
      featureVersion: "v5",
      endpoint: "/proxy/v5/turn/stream",
    });

    const data = completedEvent();
    expect(data.sse_end_state).toBe("undelivered");
    expect(data.status_code).toBe(200);

    const warned = deliveryLines(warnSpy);
    expect(warned, "the undelivered turn must not be logged at info level").toHaveLength(1);
    expect(warned[0].delivered).toBe(false);
    expect(warned[0].socket_writable).toBe(false);
    expect(deliveryLines(infoSpy)).toHaveLength(0);
  });

  it("the SLO DENOMINATOR is preserved: it stays an sse_completed event, not an error", async () => {
    // Re-filing an undelivered turn as `sse_error` would remove it from
    // `sum:assistants.sse.completed{env:prod}` — the delivery SLO would then
    // IMPROVE as delivery got worse. Guarded explicitly because it is the one
    // way of "fixing" this that reads as more correct and is not.
    const { reply } = makeReply(1);

    await streamTurnAsStagedSse({
      app: makeApp(200),
      reply,
      requestId: "req-denominator",
      internalHeaders: {},
      payload: "{}",
      featureVersion: "v5",
      endpoint: "/proxy/v5/turn/stream",
    });

    expect(captured.map((e) => e.event)).toContain("assist.draft.sse_completed");
  });

  it("a turn the client fully received is still reported complete, at info level", async () => {
    // The opposite-direction twin. A guard that called everything undelivered
    // would pass the two tests above and fail here.
    const { reply } = makeReply(Number.MAX_SAFE_INTEGER);

    await streamTurnAsStagedSse({
      app: makeApp(200),
      reply,
      requestId: "req-live-socket",
      internalHeaders: {},
      payload: "{}",
      featureVersion: "v5",
      endpoint: "/proxy/v5/turn/stream",
    });

    expect(completedEvent().sse_end_state).toBe("complete");
    const infoLines = deliveryLines(infoSpy);
    expect(infoLines).toHaveLength(1);
    expect(infoLines[0].delivered).toBe(true);
    expect(deliveryLines(warnSpy)).toHaveLength(0);
  });

  it("a failed turn the client DID receive is still `error`, not `undelivered`", async () => {
    const { reply } = makeReply(Number.MAX_SAFE_INTEGER);

    await streamTurnAsStagedSse({
      app: makeApp(500),
      reply,
      requestId: "req-live-error",
      internalHeaders: {},
      payload: "{}",
      featureVersion: "v5",
      endpoint: "/proxy/v5/turn/stream",
    });

    expect(completedEvent().sse_end_state).toBe("error");
  });
});
