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
 * ── #3283: ATTACKS 1a, 1b, 2 AND 3 MOVED TO THE SERVED TARGET ──────────────
 * Each drafted a free-text brief through `/orchestrate/v2/turn`, whose free-text
 * conversation #3283 retired (410 `conventional_conversation_retired`). The
 * claims they pin — concurrent streams never cross, a buffered turn beside a
 * stream gets no SSE, and a socket destroyed after the first frame still lets the
 * turn commit — belong to the shared transport, which the browser reaches
 * through `/proxy/v5/turn/stream` → `/agent/v1/turn`. They now run there, titles
 * kept and bound to each lane's own model by identity, in
 * `proxy-v5-turn-stream-served.test.ts`.
 *
 * ATTACK 5 (CORS parity) is the test that FOUND the blocking defect: the raw
 * `reply.raw.writeHead` path silently dropped every CORS header, so a
 * cross-origin browser call would run the turn, COMMIT it, and be unable to read
 * a byte of the response. It is kept as the regression pin for that fix.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

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
          return { id: "mock-row" };
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
  // ATTACK 4a: inner failure AFTER GRAPH_READY — parity with the buffered turn
  // ═════════════════════════════════════════════════════════════════════════

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
