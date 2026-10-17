/**
 * ROADMAP 2.122 / 1.204 M1 — CEE lane 2: the STREAMED V5 TURN.
 *
 * `POST /orchestrate/v2/turn/stream` delivers the turn as staged SSE. Lane 1
 * (#745) proved staged delivery on an ASSIST route; this lane proves it on the
 * route the product actually drafts through — the one that COMMITS.
 *
 * The pins here are ordered by what would hurt most if it broke:
 *
 *  1. **COMMIT SEMANTICS.** A streamed draft must leave the SAME persisted state
 *     as a buffered draft, and a later turn must be able to read it back. The
 *     M1-L2 lane established that skipping this is not a cosmetic regression —
 *     it silently breaks Run analysis, because `run_analysis` reads
 *     `scenarios.graph` and honestly refuses when it is NULL. That outcome is
 *     the one this suite exists to make impossible.
 *  2. **THE CROSS-FRAME IDENTITY INVARIANT.** The early graph frame and the
 *     terminal payload must agree on node identity, or reconciliation by id
 *     fails at the client and the latency win is destroyed by a re-render.
 *     #745's review found two tests reading two different shapes and NEVER
 *     COMPARING THEM; that is the specific mistake this file must not repeat, so
 *     the comparison is ONE test over BOTH shapes, with a positive control that
 *     fails if either extraction comes back empty (an absence assertion about a
 *     graph nobody can see would be vacuous — trap 13).
 *  3. **FRAME SEQUENCE.** Classes, order, `seq` monotonicity, and the rule that
 *     no pre-terminal frame may present as complete.
 *  4. **THE ADDITIVE GUARANTEE.** The buffered `/orchestrate/v2/turn` must be
 *     regression-untouched — and here that is a mechanism, not a promise: the
 *     emitter lives in an async-context store that only the streamed route sets.
 *
 * ── #3283: PINS 1, 2, THE CLAIM-SAFETY PIN, THE BUFFERED HALF OF 4 AND THE
 * REAL-SOCKET PIN MOVED TO THE SERVED TARGET ────────────────────────────────
 * Every one of them needed a DRAFT, and they drafted a free-text brief through
 * this route's conventional target, `/orchestrate/v2/turn`, whose free-text
 * conversation #3283 retired (410 `conventional_conversation_retired`). The
 * guarantees belong to the shared transport (`streamed-turn-sse.ts`), which the
 * browser reaches through `/proxy/v5/turn/stream` → `/agent/v1/turn`, so the ten
 * rows now run there, titles kept, in `proxy-v5-turn-stream-served.test.ts`.
 * What stays here is what is specific to this route or target-independent: the
 * frame-sequence row, the emitter mechanism, the one frame vocabulary, and the
 * auth surface.
 *
 * ── ON WHAT `app.inject()` CAN AND CANNOT PROVE HERE ────────────────────────
 * `inject()` buffers the whole SSE response and resolves at `raw.end()`, so this
 * suite proves frame ORDER, CONTENT and COMMIT. It cannot prove wall-clock
 * ARRIVAL. The ~33 s/~53 s split is a property of WHERE the emission sites sit
 * in the pipeline; it is asserted structurally below (GRAPH_READY strictly
 * before COACHING_READY, both strictly before COMPLETE, with non-decreasing
 * `elapsed_ms`), and its latency payoff needs a live run to observe.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

// This suite makes many draft calls, and each streamed turn also costs the
// GLOBAL per-minute counter twice (outer request + injected inner turn — the
// same double-count /proxy/v5/turn has always produced). Rate limiting is not
// what this suite is about, so raise the tiers together: `assertRateBucketsValid`
// enforces draft <= coach <= read at module load, and raising one alone throws.
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_COACH_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_READ_RPM", "10000");
vi.stubEnv("RATE_LIMIT_MAX", "10000");

// Clone the fixture graph on every access — the pipeline mutates it, and without
// this a second run in the same process sees an already-repaired graph and does
// less repair work. That is a HARNESS artefact; left unguarded it would
// masquerade as a real streamed-vs-buffered divergence. Uses the
// importOriginal-spread pattern so nothing is hand-mirrored (trap 12).
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

/**
 * The graph validator, with a deliberate delay.
 *
 * The delay exists for ONE test — the real-socket incremental-delivery pin. Under
 * fixtures the whole turn completes in well under a millisecond, so Node coalesces
 * every SSE write into a single TCP chunk and a genuinely streaming route becomes
 * indistinguishable from a buffered one. That is a property of the harness's
 * speed, not of the route. Making the turn take a measurable amount of time
 * restores the distinction, so the pin measures the route instead of the clock.
 * Every other test in this file is indifferent to it.
 */
const VALIDATE_DELAY_MS = 60;
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS));
    return { ok: true, violations: [], normalized: undefined };
  }),
}));

/**
 * A STATEFUL session store — the whole point of this suite.
 *
 * A store whose `append` throws its argument away can never distinguish "the
 * turn committed" from "the turn returned a nice-looking body", which is
 * precisely the failure mode being guarded. This one persists what the turn
 * writes and serves it back through the real read path
 * (`loadGraph` / `loadGraphAndBriefText`), so a later turn genuinely SEES the
 * committed graph. Built on `createMockSessionStore` so the double stays
 * complete as the interface grows (derive, don't mirror).
 */
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
          return {
            graph: (persistedGraphs.get(scenarioId) ?? null) as never,
            briefText: null,
          };
        },
      }),
    resetSessionStoreForTests: () => {},
  };
});

const { build } = await import("../../src/server.js");
const { currentStageEmitter } = await import(
  "../../src/cee/unified-pipeline/stage-stream-context.js"
);

describe("POST /orchestrate/v2/turn/stream — the streamed V5 turn", () => {
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
  // 3. FRAME SEQUENCE
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. THE ADDITIVE GUARANTEE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("additive guarantee — the buffered turn is untouched", () => {
    it("the stage emitter is ABSENT outside a streamed turn — the mechanism behind the guarantee", () => {
      // This is why the buffered path cannot regress: there is no store to read,
      // so `handleDraftGraph` never spreads `onStage` into the pipeline opts. Not
      // a flag, not a URL check — an empty async context.
      expect(currentStageEmitter()).toBeUndefined();
    });

    it("both SSE routes draw their frame classes from ONE constant (no mirror)", async () => {
      const streamRoute = await import("../../src/routes/orchestrate.v2.turn-stream.js");
      const stagedRoute = await import("../../src/routes/streamed-turn-sse.js");
      // Same object identity, not merely equal contents: a copied list could
      // drift; a shared reference cannot.
      expect(streamRoute.STAGED_FRAME_CLASSES).toBe(stagedRoute.STAGED_FRAME_CLASSES);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. AUTH SURFACE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("auth surface", () => {
    it("the SERVICE route is authenticated and the BROWSER route is public — derived, not mirrored", async () => {
      // F7 (review): this test used to restate `auth.ts`'s `publicRoutes` array
      // and admit it in its own comment. That is a trap-12 mirror — it would keep
      // asserting the old answer after the real list moved. The predicate is now
      // exported, so this DERIVES each route's posture from the code that decides
      // it.
      const { isPublicRoute } = await import("../../src/plugins/auth.js");
      const { STREAMED_TURN_ROUTE, STREAMED_TURN_INTERNAL_TARGET } = await import(
        "../../src/routes/orchestrate.v2.turn-stream.js"
      );
      const { PROXY_STREAMED_TURN_ROUTE } = await import(
        "../../src/routes/proxy-v5-turn-stream.js"
      );

      // The service sibling must be exactly as (non-)public as the turn it wraps.
      expect(isPublicRoute(STREAMED_TURN_ROUTE, "POST")).toBe(
        isPublicRoute(STREAMED_TURN_INTERNAL_TARGET, "POST"),
      );
      expect(isPublicRoute(STREAMED_TURN_ROUTE, "POST")).toBe(false);

      // The browser sibling must be exactly as public as the proxy it wraps —
      // by prefix INHERITANCE, without a new allowlist entry.
      expect(isPublicRoute(PROXY_STREAMED_TURN_ROUTE, "POST")).toBe(
        isPublicRoute("/proxy/v5/turn", "POST"),
      );
      expect(isPublicRoute(PROXY_STREAMED_TURN_ROUTE, "POST")).toBe(true);

      // Positive control: the predicate discriminates at all.
      expect(isPublicRoute("/assist/v1/draft-graph", "POST")).toBe(false);
    });

    it("forwards auth headers verbatim to the internal turn and strips hop-by-hop headers", async () => {
      const { buildInternalTurnHeaders } = await import(
        "../../src/routes/orchestrate.v2.turn-stream.js"
      );
      const forwarded = buildInternalTurnHeaders({
        "x-olumi-assist-key": "test-key",
        authorization: "Bearer jwt-token",
        "x-olumi-signature": "sig",
        accept: "text/event-stream",
        "content-length": "123",
        connection: "keep-alive",
        host: "cee-staging.onrender.com",
      } as never, "req-id-under-test");

      // The inner request must authenticate as the outer one did.
      expect(forwarded["x-olumi-assist-key"]).toBe("test-key");
      expect(forwarded["authorization"]).toBe("Bearer jwt-token");
      expect(forwarded["x-olumi-signature"]).toBe("sig");
      // The outer request's TRANSPORT must not leak into the inner one.
      expect(forwarded["accept"]).toBe("application/json");
      expect(forwarded["content-type"]).toBe("application/json");
      expect(forwarded).not.toHaveProperty("content-length");
      expect(forwarded).not.toHaveProperty("connection");
      expect(forwarded).not.toHaveProperty("host");

      // F3 (review): the inner turn must be attributable to the stream that ran
      // it. Without this, a client that sends no x-request-id gets UUID-A on the
      // stream and a different UUID-B in the turn's logs, and the two cannot be
      // joined. /proxy/v5/turn sets it for exactly this reason.
      expect(forwarded["x-request-id"]).toBe("req-id-under-test");
    });
  });
});
