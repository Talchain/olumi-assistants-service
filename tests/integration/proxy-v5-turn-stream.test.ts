/**
 * `POST /proxy/v5/turn/stream` — the BROWSER-facing streamed V5 turn.
 *
 * ROADMAP 2.122 / 1.204 M1, CEE lane 2. Added at adversarial review, which
 * established that the lane's first submission had shipped a streamed route the
 * stated consumer **could not use**: the service sibling requires an assist key
 * or HMAC, and a browser can hold neither.
 *
 * ── WHAT THIS SUITE IS FOR ──────────────────────────────────────────────────
 * CORS is life-or-death on this route specifically. A raw-written SSE reply that
 * omits `access-control-allow-origin` does not fail safe: the OPTIONS preflight
 * passes, the POST runs, **the turn COMMITS**, and the browser gets an opaque
 * error it can read nothing from. Invisible commit + natural user retry =
 * duplicate turns. So the CORS pins here are not header hygiene — they are the
 * difference between a working feature and a silent data-integrity bug.
 *
 * Everything downstream of ingress (frame contract, identity invariant, emitter
 * context) is the shared transport already pinned by `streamed-turn-sse.test.ts`;
 * this suite covers what is UNIQUE to the browser ingress: origin validation, the
 * CORS response, and the internally-injected service key.
 *
 * ── #3283: THE DRAFT ROWS MOVED TO THE SERVED TARGET ────────────────────────
 * This suite builds the whole server, whose default browser target is the
 * conventional `/orchestrate/v2/turn`, and #3283 retired that route's free-text
 * conversation (410 `conventional_conversation_retired`). The rows that needed a
 * DRAFT — "the streamed draft commits and reads back" and "GRAPH_READY's graph,
 * provenance and option identity are what was persisted" — and the GRAPH_READY
 * half of the first row now run on the path the browser is served,
 * `/proxy/v5/turn/stream` → `/agent/v1/turn`, in
 * `proxy-v5-turn-stream-served.test.ts`. The first row's other half, "the
 * injected service key authenticates the inner turn", needs the real auth plugin,
 * so it stays here on a shape the conventional route still serves (a canvas
 * system event). The CORS rows below assert the outer reply's headers, which do
 * not depend on what the inner turn answers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("RATE_LIMIT_MAX", "10000");
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_COACH_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_READ_RPM", "10000");

// The browser proxy family is gated; the streamed sibling registers inside the
// same switch as the buffered one.
vi.stubEnv("BROWSER_PROXY_ENABLED", "true");
const ALLOWED_ORIGIN = "http://localhost:5173";
const STAGING_ORIGIN = "https://staging--olumi.netlify.app";
const IMMUTABLE_DEPLOY_ORIGIN =
  "https://6a91550f3af620000895d1e5--olumi.netlify.app";
const FORBIDDEN_ORIGIN = "https://evil.example.com";
vi.stubEnv(
  "BROWSER_PROXY_ALLOWED_ORIGINS",
  `${ALLOWED_ORIGIN},${STAGING_ORIGIN}`,
);
vi.stubEnv("ALLOWED_ORIGINS", `${ALLOWED_ORIGIN},${STAGING_ORIGIN}`);
// The proxy injects this key internally; without it the inner turn 401s. Setting
// it is what makes this suite test the browser path rather than a 401 path.
vi.stubEnv("ASSIST_API_KEY", "proxy-stream-suite-key");

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

// A measurable turn duration, so the flush boundary is real rather than an
// artefact of how fast the fixtures pipeline finishes. Same reasoning as the
// service sibling's suite.
const VALIDATE_DELAY_MS = 60;
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS));
    return { ok: true, violations: [], normalized: undefined };
  }),
}));

/** Stateful store, so "did it commit and can a later turn read it" is answerable. */
const appendWrites: Array<{ scenario_id: string; graph?: unknown }> = [];
const persistedGraphs = new Map<string, unknown>();
const loadGraphCalls: string[] = [];

vi.mock("../../src/orchestrator-v5/session/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/orchestrator-v5/session/index.js")>();
  const { createMockSessionStore } = await import("../utils/mock-session-store.js");
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write) => {
          appendWrites.push(write as { scenario_id: string; graph?: unknown });
          if (write.graph !== undefined && write.graph !== null) {
            persistedGraphs.set(write.scenario_id, write.graph);
          }
          return { id: "mock-row" };
        },
        loadGraph: async (scenarioId: string) => {
          loadGraphCalls.push(scenarioId);
          return (persistedGraphs.get(scenarioId) ?? null) as never;
        },
        loadGraphAndBriefText: async (scenarioId: string) => {
          loadGraphCalls.push(scenarioId);
          return { graph: (persistedGraphs.get(scenarioId) ?? null) as never, briefText: null };
        },
      }),
    resetSessionStoreForTests: () => {},
  };
});

const { build } = await import("../../src/server.js");
const { PROXY_STREAMED_TURN_ROUTE } = await import(
  "../../src/routes/proxy-v5-turn-stream.js"
);

const PROXY_BUFFERED = "/proxy/v5/turn";
const BRIEF =
  "Should we expand the product into the German market next quarter or hold and reinvest?";

let n = 0;
const nextScenarioId = () => `8${(++n).toString().padStart(7, "0")}-1111-4111-8111-111111111111`;
let t = 0;
const nextTurnId = () => `9${(++t).toString().padStart(7, "0")}-2222-4222-8222-222222222222`;

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

/** A canvas system event — a shape `/orchestrate/v2/turn` still serves after #3283. */
function systemEventPayload(scenarioId: string, turnId: string) {
  return {
    kind: "system_event",
    turn_id: turnId,
    scenario_id: scenarioId,
    event: { kind: "patch_accepted", patch_id: "proxy-stream-suite" },
    stage: "analyse",
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
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    frames.push(JSON.parse(line.slice("data: ".length)) as StageFrame);
  }
  return frames;
}

describe("POST /proxy/v5/turn/stream — the browser-facing streamed turn", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendWrites.length = 0;
    loadGraphCalls.length = 0;
    persistedGraphs.clear();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THE ROUTE EXISTS AND IS REACHABLE WITHOUT A SERVICE KEY
  // ═══════════════════════════════════════════════════════════════════════════

  it("is registered, and a browser with NO service key gets a real streamed turn", async () => {
    const scenarioId = nextScenarioId();
    const res = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      // Deliberately NO x-olumi-assist-key: that is the whole point of this
      // route. A browser cannot hold one.
      headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN },
      // A shape the conventional target still serves (#3283): the real auth
      // plugin must admit the inner turn on the key the proxy injected. The
      // GRAPH_READY half of this row is on the served target in
      // proxy-v5-turn-stream-served.test.ts.
      payload: systemEventPayload(scenarioId, nextTurnId()),
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/event-stream");

    const frames = parseStageFrames(res.body);
    expect(frames[0].stage).toBe("DRAFTING");
    const complete = frames[frames.length - 1];
    expect(complete.stage).toBe("COMPLETE");
    // 200 proves the internally-injected service key authenticated the inner
    // turn. A 401 here would mean the browser surface is decorative.
    expect(
      complete.status_code,
      `inner turn refused the injected service key: ${JSON.stringify(complete.payload).slice(0, 300)}`,
    ).toBe(200);
    // Positive control: the inner turn ran the system event, not a refusal that
    // happens to carry 200.
    expect((complete.payload as { response_version?: unknown }).response_version).toBe(2);
    expect(
      appendWrites.filter((w) => w.scenario_id === scenarioId).length,
      "the inner turn committed nothing for this scenario",
    ).toBeGreaterThan(0);
  }, 90_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // CORS — the reason this route exists at all
  // ═══════════════════════════════════════════════════════════════════════════

  it("the streamed reply carries the SAME CORS allow-origin as the buffered proxy reply", async () => {
    const server = await build();
    await server.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = server.server.address() as { port: number };

      const buffered = await fetch(`http://127.0.0.1:${port}${PROXY_BUFFERED}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN },
        body: JSON.stringify(draftTurnPayload(nextScenarioId(), nextTurnId())),
      });
      await buffered.text();

      const streamed = await fetch(`http://127.0.0.1:${port}${PROXY_STREAMED_TURN_ROUTE}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN },
        body: JSON.stringify(draftTurnPayload(nextScenarioId(), nextTurnId())),
      });
      await streamed.text();

      const bufferedAcao = buffered.headers.get("access-control-allow-origin");
      const streamedAcao = streamed.headers.get("access-control-allow-origin");

      // Positive control first: if the BUFFERED reply has no CORS header either,
      // then equality below would pass by both being null and prove nothing.
      expect(bufferedAcao, "buffered proxy reply has no CORS header — comparison would be vacuous")
        .not.toBeNull();
      expect(
        streamedAcao,
        "streamed reply is missing CORS allow-origin — a browser cannot read the stream, " +
          "yet the turn has already COMMITTED",
      ).toBe(bufferedAcao);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("the streamed reply is browser-readable: allow-origin echoes the caller and Vary names Origin", async () => {
    const server = await build();
    await server.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = server.server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}${PROXY_STREAMED_TURN_ROUTE}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN },
        body: JSON.stringify(draftTurnPayload(nextScenarioId(), nextTurnId())),
      });
      await res.text();

      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
      // Vary must name Origin or a shared cache can serve one origin's response
      // to another.
      expect(String(res.headers.get("vary") ?? "")).toContain("Origin");
      expect(String(res.headers.get("content-type"))).toContain("text/event-stream");
    } finally {
      await server.close();
    }
  }, 90_000);

  it("an immutable Olumi deploy receives readable CORS on the streamed route", async () => {
    const scenarioId = nextScenarioId();
    const res = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: {
        "content-type": "application/json",
        origin: IMMUTABLE_DEPLOY_ORIGIN,
      },
      payload: draftTurnPayload(scenarioId, nextTurnId()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      IMMUTABLE_DEPLOY_ORIGIN,
    );
  });

  it("the full server admits immutable Olumi deploy preflight", async () => {
    const server = await build();
    await server.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = server.server.address() as { port: number };
      const res = await fetch(
        `http://127.0.0.1:${port}${PROXY_STREAMED_TURN_ROUTE}`,
        {
          method: "OPTIONS",
          headers: {
            origin: IMMUTABLE_DEPLOY_ORIGIN,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
          },
        },
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        IMMUTABLE_DEPLOY_ORIGIN,
      );
    } finally {
      await server.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ORIGIN VALIDATION — refused BEFORE the stream opens
  // ═══════════════════════════════════════════════════════════════════════════

  it("a disallowed origin is refused 403 as plain JSON, and no turn is committed", async () => {
    const scenarioId = nextScenarioId();
    const res = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: { "content-type": "application/json", origin: FORBIDDEN_ORIGIN },
      payload: draftTurnPayload(scenarioId, nextTurnId()),
    });

    expect(res.statusCode).toBe(403);
    // Refused BEFORE the stream opens, so the browser gets an error body it can
    // actually parse rather than a 200 stream whose first frame is a failure.
    expect(String(res.headers["content-type"])).toContain("application/json");
    expect(res.body).not.toContain("event: stage");
    expect(JSON.parse(res.body).error.code).toBe("PROXY_ORIGIN_REJECTED");

    // The security property that matters: nothing ran, so nothing committed.
    expect(appendWrites.filter((w) => w.scenario_id === scenarioId)).toHaveLength(0);
  }, 60_000);

  it("a missing origin is refused, and a non-JSON content-type is refused with CORS headers attached", async () => {
    const noOrigin = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: { "content-type": "application/json" },
      payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
    });
    expect(noOrigin.statusCode).toBe(403);

    const badCt = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: { "content-type": "text/plain", origin: ALLOWED_ORIGIN },
      payload: "not json",
    });
    expect(badCt.statusCode).toBe(415);
    // CORS on the error too — otherwise the browser sees a CORS failure instead
    // of the reason it was refused.
    expect(badCt.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // THE SERVICE KEY MUST NEVER REACH THE BROWSER
  // ═══════════════════════════════════════════════════════════════════════════

  it("the injected service key appears nowhere in the streamed response", async () => {
    const res = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN },
      payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
    });

    const KEY = "proxy-stream-suite-key";
    // Positive control (trap 13): the scan must be able to SEE the key when it
    // IS present, or this absence assertion proves nothing.
    expect(`prefix ${KEY} suffix`).toContain(KEY);

    expect(res.body).not.toContain(KEY);
    expect(JSON.stringify(res.headers)).not.toContain(KEY);
    expect(JSON.stringify(res.headers).toLowerCase()).not.toContain("x-olumi-assist-key");
  }, 90_000);
});
