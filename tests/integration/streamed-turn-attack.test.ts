/**
 * ADVERSARIAL REVIEW of PR #751 — attack suite. NOT part of the PR.
 *
 * Attacks: concurrent-stream isolation (async-context store), streamed+buffered
 * interleaving, client disconnect mid-stream (commit survival + process
 * survival), error paths (inner failure parity, inner validation failure,
 * outer malformed JSON), and CORS header parity on the raw-written SSE reply.
 *
 * Harness preamble mirrors tests/integration/streamed-turn-sse.test.ts so the
 * route runs under identical conditions.
  *
 * ── PROVENANCE ─────────────────────────────────────────────────────────────
 * ADOPTED FROM THE ADVERSARIAL REVIEW OF PR #751 (reviewer lane, 29 Jul).
 *
 * The review's central procedural finding was that this PR shipped an architecture
 * staking everything on two claims — that the async-context emitter cannot cross
 * between concurrent streams, and that a client disconnect cannot corrupt the
 * commit — and had NO COVERAGE OF EITHER. These are the reviewer's own attack
 * tests, adopted verbatim in substance so the claims are pinned in the PR that
 * makes them rather than in a clone that is about to be deleted.
 *
 * ATTACK 5 (CORS parity) is the test that FOUND the blocking defect: the raw
 * `reply.raw.writeHead` path silently dropped every CORS header, so a
 * cross-origin browser call would run the turn, COMMIT it, and be unable to read
 * a byte of the response. It is kept as the regression pin for that fix.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import http from "node:http";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_COACH_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_READ_RPM", "10000");
vi.stubEnv("RATE_LIMIT_MAX", "10000");
vi.stubEnv("GLOBAL_RATE_LIMIT_RPM", "10000");

vi.mock("../../src/utils/fixtures.js", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  const pristineGraph = structuredClone(mod.fixtureGraph);
  return {
    ...mod,
    get fixtureGraph() {
      return structuredClone(pristineGraph);
    },
  };
});

const VALIDATE_DELAY_MS = 60;
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS));
    return { ok: true, violations: [], normalized: undefined };
  }),
}));

/** Stateful session store; append THROWS for scenario ids with the marker prefix. */
const APPEND_THROW_PREFIX = "ee";
const appendWrites: Array<{ scenario_id: string; graph?: unknown }> = [];
const persistedGraphs = new Map<string, unknown>();

vi.mock("../../src/orchestrator-v5/session/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/orchestrator-v5/session/index.js")>();
  const { createMockSessionStore } = await import("../utils/mock-session-store.js");
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write) => {
          const w = write as { scenario_id: string; graph?: unknown };
          if (w.scenario_id?.startsWith(APPEND_THROW_PREFIX)) {
            throw new Error("simulated store failure on append");
          }
          appendWrites.push(w);
          if (w.graph !== undefined && w.graph !== null) {
            persistedGraphs.set(w.scenario_id, w.graph);
          }
          return {
            id: "mock-row",
            ...(w.graph != null
              ? { graph_write_disposition: "accepted_insert" as const }
              : {}),
          };
        },
        loadGraph: async (scenarioId: string) =>
          (persistedGraphs.get(scenarioId) ?? null) as never,
        loadGraphAndBriefText: async (scenarioId: string) => ({
          graph: (persistedGraphs.get(scenarioId) ?? null) as never,
          briefText: null,
        }),
      }),
    resetSessionStoreForTests: () => {},
  };
});

const { build } = await import("../../src/server.js");

const STREAM_URL = "/orchestrate/v2/turn/stream";
const BUFFERED_URL = "/orchestrate/v2/turn";
const BRIEF =
  "Should we expand the product into the German market next quarter or hold and reinvest?";

let scenarioCounter = 0;
function nextScenarioId(prefix = "5"): string {
  scenarioCounter += 1;
  // prefix (8 hex chars max) + zero-padded counter, ALWAYS keeping the counter's
  // distinguishing digits (a slice that truncates the counter collides every id).
  const counter = scenarioCounter.toString(16);
  const head = (prefix + "00000000").slice(0, 8 - counter.length) + counter;
  return `${head}-1111-4111-8111-111111111111`;
}
let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `6${turnCounter.toString().padStart(7, "0")}-2222-4222-8222-222222222222`;
}

function draftTurnPayload(scenarioId: string, turnId: string) {
  return {
    kind: "message",
    turn_id: turnId,
    scenario_id: scenarioId,
    stage: "frame",
    message: BRIEF,
    turn_class: "frame",
    source: "composer",
    explicit_generate: true,
  };
}

interface StageFrame {
  stage: string;
  seq: number;
  status: string;
  [k: string]: unknown;
}

function parseStageFrames(body: string): StageFrame[] {
  const frames: StageFrame[] = [];
  for (const block of body.split("\n\n")) {
    if (!block.includes("event: stage")) continue;
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    frames.push(JSON.parse(dataLine.slice("data: ".length)) as StageFrame);
  }
  return frames;
}

/** Process-survival instrumentation. */
const uncaught: unknown[] = [];
const unhandled: unknown[] = [];
const onUncaught = (e: unknown) => uncaught.push(e);
const onUnhandled = (e: unknown) => unhandled.push(e);

describe("ADVERSARIAL: streamed V5 turn attack battery", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandled);
    app = await build();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
  });

  beforeEach(() => {
    appendWrites.length = 0;
    persistedGraphs.clear();
    uncaught.length = 0;
    unhandled.length = 0;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 1a: N concurrent streamed turns — async-context isolation
  // ═════════════════════════════════════════════════════════════════════════
  it("4 concurrent streamed turns x5 rounds: no frame crossing, each commits its own scenario", async () => {
    for (let round = 0; round < 5; round++) {
      const lanes = [0, 1, 2, 3].map(() => ({
        scenarioId: nextScenarioId(),
        turnId: nextTurnId(),
      }));

      const results = await Promise.all(
        lanes.map(
          (lane, i) =>
            new Promise<{ body: string; statusCode: number }>((resolve, reject) => {
              // Stagger starts so pipelines genuinely overlap mid-flight.
              setTimeout(() => {
                app
                  .inject({
                    method: "POST",
                    url: STREAM_URL,
                    payload: draftTurnPayload(lane.scenarioId, lane.turnId),
                  })
                  .then((r) => resolve({ body: r.body, statusCode: r.statusCode }), reject);
              }, i * 15);
            }),
        ),
      );

      for (let i = 0; i < lanes.length; i++) {
        const frames = parseStageFrames(results[i].body);
        const count = (s: string) => frames.filter((f) => f.stage === s).length;
        // Exactly one of each — a crossed context would double a frame in one
        // stream and drop it in another.
        expect(count("DRAFTING"), `round ${round} lane ${i} DRAFTING`).toBe(1);
        expect(count("GRAPH_READY"), `round ${round} lane ${i} GRAPH_READY`).toBe(1);
        expect(count("COACHING_READY"), `round ${round} lane ${i} COACHING_READY`).toBe(1);
        expect(count("COMPLETE"), `round ${round} lane ${i} COMPLETE`).toBe(1);
        // seq contiguous from 0 — an interleaved foreign write would break it.
        expect(frames.map((f) => f.seq)).toEqual(frames.map((_, j) => j));
        const complete = frames.find((f) => f.stage === "COMPLETE")!;
        expect(complete.status_code, `round ${round} lane ${i} status`).toBe(200);
        // Its own commit landed.
        expect(
          persistedGraphs.has(lanes[i].scenarioId),
          `round ${round} lane ${i} commit missing`,
        ).toBe(true);
      }
      // Exactly 4 scenarios committed — no cross-writes, no losses.
      const committed = new Set(
        appendWrites.filter((w) => w.graph).map((w) => w.scenario_id),
      );
      for (const lane of lanes) expect(committed.has(lane.scenarioId)).toBe(true);
      appendWrites.length = 0;
      persistedGraphs.clear();
    }
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  }, 120_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 1b: streamed turn concurrent with a buffered turn
  // ═════════════════════════════════════════════════════════════════════════
  it("a buffered turn running concurrently with a streamed turn gets no SSE and both commit", async () => {
    for (let round = 0; round < 5; round++) {
      const sStream = nextScenarioId();
      const sBuf = nextScenarioId();

      const [streamed, buffered] = await Promise.all([
        app.inject({
          method: "POST",
          url: STREAM_URL,
          payload: draftTurnPayload(sStream, nextTurnId()),
        }),
        new Promise<{ body: string; statusCode: number; headers: Record<string, unknown> }>(
          (resolve, reject) => {
            setTimeout(() => {
              app
                .inject({
                  method: "POST",
                  url: BUFFERED_URL,
                  payload: draftTurnPayload(sBuf, nextTurnId()),
                })
                .then(
                  (r) =>
                    resolve({
                      body: r.body,
                      statusCode: r.statusCode,
                      headers: r.headers as Record<string, unknown>,
                    }),
                  reject,
                );
            }, 20);
          },
        ),
      ]);

      // The buffered turn must be untouched: JSON, no stage frames.
      expect(buffered.statusCode).toBe(200);
      expect(String(buffered.headers["content-type"])).toContain("application/json");
      expect(buffered.body).not.toContain("event: stage");
      // The streamed turn got its frames.
      const frames = parseStageFrames(streamed.body);
      expect(frames.filter((f) => f.stage === "GRAPH_READY")).toHaveLength(1);
      // Both committed, each under its own scenario.
      expect(persistedGraphs.has(sStream)).toBe(true);
      expect(persistedGraphs.has(sBuf)).toBe(true);
    }
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  }, 120_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 2: real-socket concurrency — two live streams on one server
  // ═════════════════════════════════════════════════════════════════════════
  it("two real-socket streams in parallel each receive exactly their own frame set", async () => {
    const server = await build();
    await server.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = server.server.address() as { port: number };
      const run = async (scenarioId: string, delayMs: number) => {
        await new Promise((r) => setTimeout(r, delayMs));
        const res = await fetch(`http://127.0.0.1:${port}${STREAM_URL}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(draftTurnPayload(scenarioId, nextTurnId())),
        });
        expect(res.status).toBe(200);
        return parseStageFrames(await res.text());
      };
      const sA = nextScenarioId();
      const sB = nextScenarioId();
      const [framesA, framesB] = await Promise.all([run(sA, 0), run(sB, 25)]);
      for (const [label, frames] of [
        ["A", framesA],
        ["B", framesB],
      ] as const) {
        expect(frames.filter((f) => f.stage === "GRAPH_READY"), `${label}`).toHaveLength(1);
        expect(frames.filter((f) => f.stage === "COMPLETE"), `${label}`).toHaveLength(1);
        expect(frames.map((f) => f.seq)).toEqual(frames.map((_, j) => j));
      }
      expect(persistedGraphs.has(sA)).toBe(true);
      expect(persistedGraphs.has(sB)).toBe(true);
    } finally {
      await server.close();
    }
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  }, 90_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 3: client disconnect mid-stream — commit survival, process survival
  // ═════════════════════════════════════════════════════════════════════════
  it("destroying the socket after the FIRST frame: turn still commits, server survives, next request fine", async () => {
    const server = await build();
    await server.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = server.server.address() as { port: number };
      const scenarioId = nextScenarioId();
      const body = JSON.stringify(draftTurnPayload(scenarioId, nextTurnId()));

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: STREAM_URL,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            res.on("data", () => {
              // First bytes seen (DRAFTING) — kill the connection mid-turn.
              res.destroy();
              req.destroy();
              resolve();
            });
            res.on("error", () => {});
          },
        );
        req.on("error", (e: NodeJS.ErrnoException) => {
          // ECONNRESET after our own destroy is expected.
          if (e.code !== "ECONNRESET") reject(e);
        });
        req.end(body);
      });

      // The doctrine says the turn keeps running and COMMITS. Poll for it.
      const deadline = Date.now() + 15_000;
      while (!persistedGraphs.has(scenarioId) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(
        persistedGraphs.has(scenarioId),
        "disconnected turn never committed — half-committed/dropped state",
      ).toBe(true);

      // Give the late frame-writes time to fire against the dead socket.
      await new Promise((r) => setTimeout(r, 500));

      // The server must still be fully alive.
      const after = await fetch(`http://127.0.0.1:${port}${STREAM_URL}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftTurnPayload(nextScenarioId(), nextTurnId())),
      });
      expect(after.status).toBe(200);
      const frames = parseStageFrames(await after.text());
      expect(frames.filter((f) => f.stage === "COMPLETE")).toHaveLength(1);
    } finally {
      await server.close();
    }
    expect(uncaught, `uncaughtException fired: ${String(uncaught[0])}`).toHaveLength(0);
    expect(unhandled, `unhandledRejection fired: ${String(unhandled[0])}`).toHaveLength(0);
  }, 60_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 4a: inner failure AFTER GRAPH_READY — parity with the buffered turn
  // ═════════════════════════════════════════════════════════════════════════
  it("store-append failure: streamed COMPLETE carries the same status/body class as the buffered turn", async () => {
    const sStream = nextScenarioId(APPEND_THROW_PREFIX);
    const sBuf = nextScenarioId(APPEND_THROW_PREFIX);

    const streamed = await app.inject({
      method: "POST",
      url: STREAM_URL,
      payload: draftTurnPayload(sStream, nextTurnId()),
    });
    const buffered = await app.inject({
      method: "POST",
      url: BUFFERED_URL,
      payload: draftTurnPayload(sBuf, nextTurnId()),
    });

    expect(streamed.statusCode).toBe(200); // SSE always opens 200
    const frames = parseStageFrames(streamed.body);
    const complete = frames.find((f) => f.stage === "COMPLETE");
    expect(complete, "no terminal frame on inner failure — silent hang class").toBeDefined();

    // PARITY: the streamed terminal status must equal the buffered route's
    // status for the identical failure — and the persisted state must be the
    // same (nothing committed in either case).
    expect(complete!.status_code).toBe(buffered.statusCode);
    expect(persistedGraphs.has(sStream)).toBe(false);
    expect(persistedGraphs.has(sBuf)).toBe(false);

    // The stream must still terminate correctly: last frame is COMPLETE, seq intact.
    expect(frames[frames.length - 1].stage).toBe("COMPLETE");
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, j) => j));
  }, 60_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 4b: a body the INNER route rejects — typed terminal frame, no hang
  // ═════════════════════════════════════════════════════════════════════════
  it("invalid turn body via the stream: SSE opens, COMPLETE carries the inner 4xx and its error body", async () => {
    const res = await app.inject({
      method: "POST",
      url: STREAM_URL,
      payload: { nonsense: true },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/event-stream");
    const frames = parseStageFrames(res.body);
    expect(frames[0].stage).toBe("DRAFTING");
    const complete = frames.find((f) => f.stage === "COMPLETE");
    expect(complete).toBeDefined();
    expect(complete!.status_code).toBeGreaterThanOrEqual(400);
    expect(complete!.status_code).toBeLessThan(500);
    expect(complete!.payload).toBeTypeOf("object");
  }, 60_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 4c: malformed JSON at the OUTER route — must not hang or half-open SSE
  // ═════════════════════════════════════════════════════════════════════════
  it("malformed JSON to the outer route: same non-SSE JSON error as the buffered route (repo-wide 500, pre-existing)", async () => {
    const res = await app.inject({
      method: "POST",
      url: STREAM_URL,
      headers: { "content-type": "application/json" },
      payload: "this is {not json",
    });
    const buffered = await app.inject({
      method: "POST",
      url: BUFFERED_URL,
      headers: { "content-type": "application/json" },
      payload: "this is {not json",
    });
    // Measured: BOTH routes return 500 error.v1 INTERNAL for malformed JSON —
    // a pre-existing repo-wide behaviour (arguably should be 400; not this PR's).
    // The requirement on THIS PR is parity and a prompt, non-SSE, JSON error.
    expect(res.statusCode).toBe(buffered.statusCode);
    expect(String(res.headers["content-type"])).not.toContain("text/event-stream");
    expect(String(res.headers["content-type"])).toContain("application/json");
    expect(JSON.parse(res.body).schema).toBe("error.v1");
  }, 30_000);

  // ═════════════════════════════════════════════════════════════════════════
  // ATTACK 5: CORS parity — the raw-written SSE reply vs the buffered reply
  // ═════════════════════════════════════════════════════════════════════════
  it("the streamed response carries the same access-control-allow-origin as the buffered response", async () => {
    const server = await build();
    await server.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = server.server.address() as { port: number };
      const origin = "http://localhost:5173"; // in DEFAULT_ORIGINS
      const bufferedRes = await fetch(`http://127.0.0.1:${port}${BUFFERED_URL}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(draftTurnPayload(nextScenarioId(), nextTurnId())),
      });
      await bufferedRes.text();
      const streamedRes = await fetch(`http://127.0.0.1:${port}${STREAM_URL}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(draftTurnPayload(nextScenarioId(), nextTurnId())),
      });
      await streamedRes.text();

      const bufferedAcao = bufferedRes.headers.get("access-control-allow-origin");
      const streamedAcao = streamedRes.headers.get("access-control-allow-origin");
      // A browser client cannot read a cross-origin SSE body without this header.
      expect(streamedAcao, "streamed SSE reply is missing CORS allow-origin — browser clients cannot read the stream").toBe(bufferedAcao);
    } finally {
      await server.close();
    }
  }, 60_000);
});
