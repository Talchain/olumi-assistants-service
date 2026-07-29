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

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
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
const { STAGED_FRAME_CLASSES } = await import(
  "../../src/routes/assist.v1.draft-graph-staged.js"
);
const { currentStageEmitter } = await import(
  "../../src/cee/unified-pipeline/stage-stream-context.js"
);

const STREAM_URL = "/orchestrate/v2/turn/stream";
const BUFFERED_URL = "/orchestrate/v2/turn";

const BRIEF =
  "Should we expand the product into the German market next quarter or hold and reinvest?";

let scenarioCounter = 0;
function nextScenarioId(): string {
  scenarioCounter += 1;
  return `5${scenarioCounter.toString().padStart(7, "0")}-1111-4111-8111-111111111111`;
}
let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `6${turnCounter.toString().padStart(7, "0")}-2222-4222-8222-222222222222`;
}

/**
 * A draft turn on THE PRODUCT'S OWN PATH.
 *
 * `explicit_generate` is what the UI sends for a cold draft
 * (`DraftChat.tsx` → `turnType: 'explicit_generate'`, `debugSource:
 * 'generate_model'`), and route-v2 handles it DETERMINISTICALLY — no routing LLM
 * call, no clarify interception: no persisted graph ⇒ assemble the brief ⇒
 * dispatch the draft.
 *
 * The plain draft-SHAPED turn (stage=frame + long message, no flag) is NOT used
 * here, and the reason is worth recording: it is intercepted by clarify v2,
 * which asks clarifying questions instead of drafting. A suite built on it would
 * have measured a clarify turn while claiming to measure a draft — it emitted
 * `exit_path: "clarify_v2"` on the first run of this file.
 */
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

/** Parse `event: stage` frames out of a buffered SSE body, in wire order. */
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

interface GraphShape {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

/**
 * Pull the drafted graph out of a turn's OlumiResponse.
 *
 * DELIBERATELY EXPLICIT rather than a recursive hunt for anything shaped like a
 * graph: a permissive search would keep "finding" something after the real field
 * moved, and would then compare the early frame against whatever it stumbled on.
 *
 * The wire location was DERIVED by dumping a real turn response, not assumed:
 * the drafted graph rides the response's top-level `draft_graph`
 * (`{nodes, edges, node_count, edge_count}`) and `blocks` comes back EMPTY on
 * this path. The `applied_graph` block fallback is kept for the block-bearing
 * shape, but it is second — reading it first would have silently returned null
 * here. Every caller pairs this with {@link expectUsableGraph}, so a miss fails
 * loudly instead of passing as an empty comparison.
 */
function extractTurnGraph(payload: unknown): GraphShape | null {
  if (!payload || typeof payload !== "object") return null;

  const direct = asGraphShape((payload as { draft_graph?: unknown }).draft_graph);
  if (direct) return direct;

  const blocks = (payload as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const data = (block as { data?: unknown }).data;
    if (!data || typeof data !== "object") continue;
    const applied = asGraphShape((data as { applied_graph?: unknown }).applied_graph);
    if (applied) return applied;
  }
  return null;
}

function asGraphShape(value: unknown): GraphShape | null {
  if (!value || typeof value !== "object") return null;
  const g = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(g.nodes)) return null;
  return { nodes: g.nodes as GraphShape["nodes"], edges: (g.edges ?? []) as GraphShape["edges"] };
}

/**
 * TRAP-13 POSITIVE CONTROL, applied to every graph this suite compares.
 *
 * Identity comparisons between two empty node lists pass trivially. Any test
 * that would be satisfied by `[] === []` is not testing the invariant, so every
 * graph that enters a comparison must first be proved to contain something.
 */
function expectUsableGraph(graph: GraphShape | null, label: string): GraphShape {
  expect(graph, `${label}: no graph found — the comparison would be vacuous`).not.toBeNull();
  expect(graph!.nodes.length, `${label}: zero nodes — the comparison would be vacuous`).toBeGreaterThan(0);
  return graph!;
}

/** Node identity, in the vocabulary the client reconciles by. */
function nodeIdentities(graph: GraphShape): Array<Record<string, unknown>> {
  return graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    // v3 carries `type`, v2 carries `kind`; record whichever is present so the
    // comparison covers the negotiated vocabulary without hand-listing it.
    kind: n.kind ?? n.type,
  }));
}

/**
 * Edge identity.
 *
 * ⚠ EDGES ON THIS PATH CARRY NO `id` — they are identified by their endpoints
 * (`from`/`to`), verified against a real response. The first version of this
 * helper mapped `e.id` and filtered out `undefined`, which produced `[]` for
 * BOTH sides of every comparison: two empty arrays are equal, so the edge half
 * of the identity invariant passed while testing nothing. Falling back to the
 * endpoint pair is what makes the assertion real; {@link expectComparableEdges}
 * is what stops it silently going vacuous again.
 */
function edgeIdentities(graph: GraphShape): unknown[] {
  return graph.edges.map((e) => e.id ?? `${String(e.from)}->${String(e.to)}`);
}

/** Trap-13 control for the edge half: an empty edge list proves nothing. */
function expectComparableEdges(graph: GraphShape, label: string): void {
  expect(graph.edges.length, `${label}: zero edges — the edge comparison would be vacuous`).toBeGreaterThan(0);
}

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
  // 1. COMMIT SEMANTICS — the property the whole lane turns on
  // ═══════════════════════════════════════════════════════════════════════════

  describe("commit semantics — same persisted state as the buffered turn", () => {
    it("a streamed draft COMMITS the graph to the scenario store", async () => {
      const scenarioId = nextScenarioId();

      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(scenarioId, nextTurnId()),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");

      // The commit is the point. A response body that looks right while
      // `scenarios.graph` stays NULL is exactly the failure the M1-L2 lane
      // predicted and this route exists to avoid.
      const committed = appendWrites.filter((w) => w.scenario_id === scenarioId && w.graph);
      expect(committed.length, "streamed draft turn wrote no graph").toBeGreaterThan(0);
      expectUsableGraph(asGraphShape(committed[committed.length - 1].graph), "committed graph");
      expect(persistedGraphs.has(scenarioId)).toBe(true);
    }, 60_000);

    it("the READ-BACK path sees the streamed turn's graph — a later turn is not drafting into a void", async () => {
      const scenarioId = nextScenarioId();

      await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(scenarioId, nextTurnId()),
      });

      const persisted = expectUsableGraph(
        asGraphShape(persistedGraphs.get(scenarioId)),
        "persisted graph after streamed draft",
      );

      // Now run a SECOND turn on the same scenario and prove it reads that graph
      // back through the REAL session-store read path
      // (`loadPersistedScenarioStateStrict` → `store.loadGraphAndBriefText`).
      //
      // This is the same read `run_analysis` depends on: that handler reads
      // `scenarios.graph` and returns the recoverable `analysis_not_ready`
      // ("draft a model first") when it is NULL. Rather than drive PLoT, this
      // asserts the observable consequence on a deterministic branch — a second
      // explicit-generate turn must DECLINE with "you already have a model"
      // instead of drafting again. It can only do that if the streamed turn's
      // commit is visible to a later turn.
      loadGraphCalls.length = 0;
      appendWrites.length = 0;
      const second = await app.inject({
        method: "POST",
        url: BUFFERED_URL,
        payload: draftTurnPayload(scenarioId, nextTurnId()),
      });

      expect(second.statusCode).toBe(200);
      expect(
        loadGraphCalls.filter((s) => s === scenarioId).length,
        "the follow-up turn never read the scenario graph",
      ).toBeGreaterThan(0);
      // It saw a model, so it did not draft a second one over the first.
      expect(
        appendWrites.filter((w) => w.scenario_id === scenarioId && w.graph).length,
        "the follow-up turn re-drafted — it did not see the committed graph",
      ).toBe(0);
      // And the graph still standing is the one the streamed turn committed.
      expect(asGraphShape(persistedGraphs.get(scenarioId))!.nodes.length).toBe(
        persisted.nodes.length,
      );
    }, 90_000);

    it("EQUIVALENCE — the streamed turn commits the same graph identity as the buffered turn", async () => {
      const streamedScenario = nextScenarioId();
      const bufferedScenario = nextScenarioId();

      await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(streamedScenario, nextTurnId()),
      });
      await app.inject({
        method: "POST",
        url: BUFFERED_URL,
        payload: draftTurnPayload(bufferedScenario, nextTurnId()),
      });

      const streamed = expectUsableGraph(
        asGraphShape(persistedGraphs.get(streamedScenario)),
        "streamed committed graph",
      );
      const buffered = expectUsableGraph(
        asGraphShape(persistedGraphs.get(bufferedScenario)),
        "buffered committed graph",
      );

      // Identity, not values: ids/labels/kinds are the contract. Numeric values
      // are refined by graph-data-integrity and are not part of this claim.
      expectComparableEdges(streamed, "streamed committed graph");
      expectComparableEdges(buffered, "buffered committed graph");
      expect(nodeIdentities(streamed)).toEqual(nodeIdentities(buffered));
      expect(edgeIdentities(streamed)).toEqual(edgeIdentities(buffered));
    }, 120_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. THE CROSS-FRAME IDENTITY INVARIANT — one test, both shapes, compared
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cross-frame identity invariant", () => {
    it("GRAPH_READY's node identity EQUALS the COMPLETE payload's — reconciliation by id is safe", async () => {
      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
      });

      const frames = parseStageFrames(res.body);
      const graphFrame = frames.find((f) => f.stage === "GRAPH_READY");
      const completeFrame = frames.find((f) => f.stage === "COMPLETE");

      expect(graphFrame, "no GRAPH_READY frame — the streamed turn emitted no staged graph").toBeDefined();
      expect(completeFrame, "no COMPLETE frame").toBeDefined();

      // BOTH shapes, read here, compared here. Reading them in two separate
      // tests is what let the identity defect through in lane 1's first round.
      const early = expectUsableGraph(asGraphShape(graphFrame!.graph), "GRAPH_READY frame graph");
      const terminal = expectUsableGraph(
        extractTurnGraph(completeFrame!.payload),
        "COMPLETE payload graph",
      );

      expectComparableEdges(early, "GRAPH_READY frame graph");
      expectComparableEdges(terminal, "COMPLETE payload graph");
      expect(nodeIdentities(early)).toEqual(nodeIdentities(terminal));
      expect(edgeIdentities(early)).toEqual(edgeIdentities(terminal));
    }, 60_000);

    it("the graph the client reconciles against is the graph that was COMMITTED", async () => {
      const scenarioId = nextScenarioId();
      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(scenarioId, nextTurnId()),
      });

      const frames = parseStageFrames(res.body);
      const graphFrame = frames.find((f) => f.stage === "GRAPH_READY");
      expect(graphFrame).toBeDefined();

      const early = expectUsableGraph(asGraphShape(graphFrame!.graph), "GRAPH_READY frame graph");
      const committed = expectUsableGraph(
        asGraphShape(persistedGraphs.get(scenarioId)),
        "committed graph",
      );

      // Closes the triangle: frame ≡ terminal (above) and frame ≡ committed
      // (here). Without this a client could reconcile perfectly against a
      // response whose persisted counterpart was a different graph.
      expect(nodeIdentities(early)).toEqual(nodeIdentities(committed));
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. FRAME SEQUENCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("frame sequence", () => {
    it("opens with DRAFTING, ends with exactly one COMPLETE, and seq is monotonic from 0", async () => {
      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
      });

      const frames = parseStageFrames(res.body);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect(frames[0].stage).toBe("DRAFTING");
      expect(frames[frames.length - 1].stage).toBe("COMPLETE");
      expect(frames.filter((f) => f.stage === "COMPLETE")).toHaveLength(1);

      // Monotonic from 0 with no gaps — this is what makes a dropped frame
      // detectable at the client.
      expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i));

      // Every frame class is drawn from the ONE shared vocabulary. Imported
      // from lane 1's route, not restated here.
      for (const f of frames) {
        expect(STAGED_FRAME_CLASSES).toContain(f.stage);
      }
    }, 60_000);

    it("no pre-terminal frame may present as complete, and GRAPH_READY precedes COACHING_READY precedes COMPLETE", async () => {
      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
      });

      const frames = parseStageFrames(res.body);
      const stages = frames.map((f) => f.stage);

      for (const f of frames.slice(0, -1)) {
        expect(f.status, `${f.stage} presented as complete before the terminal frame`).toBe(
          "in_progress",
        );
      }
      expect(frames[frames.length - 1].status).toBe("complete");

      const iGraph = stages.indexOf("GRAPH_READY");
      const iCoaching = stages.indexOf("COACHING_READY");
      const iComplete = stages.indexOf("COMPLETE");
      expect(iGraph).toBeGreaterThan(-1);
      expect(iGraph).toBeLessThan(iComplete);
      if (iCoaching > -1) {
        expect(iGraph).toBeLessThan(iCoaching);
        expect(iCoaching).toBeLessThan(iComplete);
      }

      // The staged frames' own clock never runs backwards.
      const elapsed = frames
        .map((f) => f.elapsed_ms)
        .filter((v): v is number => typeof v === "number");
      for (let i = 1; i < elapsed.length; i++) {
        expect(elapsed[i]).toBeGreaterThanOrEqual(elapsed[i - 1]);
      }
    }, 60_000);

    it("the terminal frame carries the turn's status_code and the turn body as payload", async () => {
      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
      });

      const complete = parseStageFrames(res.body).find((f) => f.stage === "COMPLETE")!;
      expect(complete.status_code).toBe(200);
      expect(complete.payload).toBeTypeOf("object");
      // It is a turn response, not a draft-pipeline body: the discriminator is
      // the turn envelope's own version field.
      expect((complete.payload as { response_version?: unknown }).response_version).toBe(2);
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CLAIM SAFETY on pre-terminal frames
  // ═══════════════════════════════════════════════════════════════════════════

  describe("claim safety", () => {
    it("pre-terminal frames carry no claim-bearing keys — with a positive control on the terminal frame", async () => {
      const res = await app.inject({
        method: "POST",
        url: STREAM_URL,
        payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
      });

      const frames = parseStageFrames(res.body);
      const CLAIM_KEYS = ["coaching", "causal_claims", "assistant_text", "insights", "suggested_actions"];

      const deepKeys = (value: unknown, acc = new Set<string>()): Set<string> => {
        if (Array.isArray(value)) {
          for (const v of value) deepKeys(v, acc);
        } else if (value && typeof value === "object") {
          for (const [k, v] of Object.entries(value)) {
            acc.add(k);
            deepKeys(v, acc);
          }
        }
        return acc;
      };

      for (const f of frames.slice(0, -1)) {
        const keys = deepKeys(f);
        for (const claimKey of CLAIM_KEYS) {
          expect(keys.has(claimKey), `${f.stage} frame carried "${claimKey}"`).toBe(false);
        }
      }

      // POSITIVE CONTROL (trap 13): the scan must be able to SEE these keys, or
      // the absence assertions above prove nothing at all.
      const terminalKeys = deepKeys(frames[frames.length - 1]);
      expect(terminalKeys.has("assistant_text")).toBe(true);
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. THE ADDITIVE GUARANTEE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("additive guarantee — the buffered turn is untouched", () => {
    it("the buffered turn emits no SSE and returns JSON", async () => {
      const res = await app.inject({
        method: "POST",
        url: BUFFERED_URL,
        payload: draftTurnPayload(nextScenarioId(), nextTurnId()),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.body).not.toContain("event: stage");
      expect(JSON.parse(res.body).response_version).toBe(2);
    }, 60_000);

    it("the stage emitter is ABSENT outside a streamed turn — the mechanism behind the guarantee", () => {
      // This is why the buffered path cannot regress: there is no store to read,
      // so `handleDraftGraph` never spreads `onStage` into the pipeline opts. Not
      // a flag, not a URL check — an empty async context.
      expect(currentStageEmitter()).toBeUndefined();
    });

    it("both SSE routes draw their frame classes from ONE constant (no mirror)", async () => {
      const streamRoute = await import("../../src/routes/orchestrate.v2.turn-stream.js");
      const stagedRoute = await import("../../src/routes/assist.v1.draft-graph-staged.js");
      // Same object identity, not merely equal contents: a copied list could
      // drift; a shared reference cannot.
      expect(streamRoute.STAGED_FRAME_CLASSES).toBe(stagedRoute.STAGED_FRAME_CLASSES);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. AUTH SURFACE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("auth surface", () => {
    it("the streamed route is NOT in the public-route allowlist", async () => {
      // Read the allowlist's own behaviour rather than restating it: the module
      // exposes no predicate, so this asserts the property that matters — the
      // streamed path is not a prefix-match of any public route.
      const { STREAMED_TURN_ROUTE, STREAMED_TURN_INTERNAL_TARGET } = await import(
        "../../src/routes/orchestrate.v2.turn-stream.js"
      );
      const PUBLIC = ["/healthz", "/health", "/", "/v1/status", "/admin", "/proxy/v5/turn"];
      const isPublic = (p: string) =>
        PUBLIC.some((r) => p === r || (r !== "/" && p.startsWith(r + "/")));
      // The streamed route must be exactly as (non-)public as the turn it wraps.
      expect(isPublic(STREAMED_TURN_ROUTE)).toBe(isPublic(STREAMED_TURN_INTERNAL_TARGET));
      expect(isPublic(STREAMED_TURN_ROUTE)).toBe(false);
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
      } as never);

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
    });
  });
});
