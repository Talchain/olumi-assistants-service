/**
 * ROADMAP 1.204 M1 — staged SSE draft delivery (CEE lane 1).
 *
 * Pins the four properties the design's build bar names, in the order they
 * matter:
 *
 *  1. The staged route emits >= 3 frame CLASSES, in a fixed ORDER, with the
 *     graph frame strictly BEFORE completion.
 *  2. THE EQUIVALENCE PIN — the terminal frame's payload is equivalent to the
 *     buffered route's body for the same input. This is the core property: it
 *     is what makes staged delivery a pure latency change rather than a second,
 *     divergent draft path.
 *  3. Claim-safety — pre-terminal frames carry no claim-bearing content.
 *  4. The pre-existing routes are unchanged (additive-sibling guarantee).
 *
 * ── A NOTE ON THE EQUIVALENCE PIN'S HONESTY ─────────────────────────────────
 * Two runs of the SAME route differ in a few fields (correlation ids, plan
 * ids, durations). A pin that hand-listed those fields would be a maintained
 * mirror, and would silently grow to cover a REAL divergence the day one
 * appeared (CLAUDE.md trap 12). So the volatile set is DERIVED, not listed:
 * the test runs each route several times and unions the pairwise diffs, and
 * whatever differs between runs of the SAME route is by definition volatile.
 * The staged-vs-buffered comparison then ignores exactly that derived set and
 * nothing else — and a further assertion fails the test if the derived set ever
 * grows to include a structural key, which is the only way this normalisation
 * could hide a real difference.
 *
 * ⚠ SAMPLING ALONE WAS NOT ENOUGH, AND THIS WAS MEASURED, NOT ARGUED. Sampling
 * classifies a field volatile only if it HAPPENS to differ in the sample. Ids
 * always differ, so they are always caught. Sub-millisecond durations do not:
 * `trace.pipeline.threshold_sweep.duration_ms` read 0 on all 60 sampled runs of
 * a local census, so it was never classified volatile — and then a run that took
 * 1 ms reported it as a divergence. At commit bfb2cb5f the SAME
 * `Integration Tests (advisory)` job ran twice on an identical tree and
 * disagreed on exactly that path (job 92755069551 PASSED, 92755076632 FAILED).
 * Wall-clock readings are therefore NORMALISED BY CONSTRUCTION before the
 * comparison — not excluded — by `tests/helpers/payload-equivalence.ts`, whose
 * header carries the full rationale and whose sibling unit spec pins the
 * properties with no clock in the loop. Sampling keeps its job (ids); the two
 * mechanisms are complementary and neither supersedes the other.
 *
 * `app.inject()` buffers the whole SSE response and resolves on `raw.end()`, so
 * these tests prove frame ORDER and CONTENT. They cannot prove wall-clock
 * ARRIVAL times — the ~33 s/~53 s split is a property of where the emission
 * sites sit in the pipeline (asserted structurally below via elapsed_ms
 * ordering), and its latency payoff needs a live run to observe.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

// This suite makes many draft calls, and the staged route deliberately SHARES
// the pre-existing stream route's rate-limit bucket (so the sibling cannot hand
// a client a second streaming allowance). Raise the draft tier for the suite —
// rate limiting is not what these tests are about.
//
// Worth recording: the sharing was demonstrated empirically rather than merely
// asserted. Before this override the suite started returning 429 the moment the
// staged route began consuming the same bucket — which is direct evidence the
// two routes really do share one allowance, not two.
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "10000");

// Clone the fixture graph on every access — the pipeline mutates it, and
// without this a second run in the same process sees an already-repaired graph
// and does less repair work. That is a HARNESS artefact; left unguarded it
// would masquerade as a real staged-vs-buffered divergence. Uses the
// importOriginal-spread pattern so nothing is hand-mirrored.
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

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { STAGED_FRAME_CLASSES } from "../../src/routes/assist.v1.draft-graph-staged.js";
import {
  deriveVolatility,
  equivalenceDivergences,
  normaliseWallClockTimings,
} from "../helpers/payload-equivalence.js";

const BRIEF = "A sufficiently long decision brief to pass validation and exercise the pipeline.";
const PAYLOAD = { brief: BRIEF };

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
    frames.push(JSON.parse(dataLine.slice(6)) as StageFrame);
  }
  return frames;
}

/** Collect every object KEY appearing anywhere in a JSON value. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe("staged SSE draft delivery (ROADMAP 1.204 M1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const injectStaged = () =>
    app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph/staged",
      payload: PAYLOAD,
      headers: { accept: "text/event-stream" },
    });

  const injectBuffered = () =>
    app.inject({ method: "POST", url: "/assist/v1/draft-graph", payload: PAYLOAD });

  // ── 1. FRAME CLASSES + ORDER ──────────────────────────────────────────────

  it("opens SSE and emits at least three frame classes", async () => {
    const res = await injectStaged();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const frames = parseStageFrames(res.body);
    const classes = new Set(frames.map((f) => f.stage));

    // The bar: >= 3 distinct frame classes. A collapse to a single terminal
    // frame (the pre-existing SSE-costume shape) fails here.
    expect(classes.size).toBeGreaterThanOrEqual(3);

    // Every class emitted must be a declared one — no ad-hoc stage strings.
    for (const stage of classes) {
      expect(STAGED_FRAME_CLASSES).toContain(stage as never);
    }
  });

  it("emits GRAPH_READY strictly BEFORE COACHING_READY and COMPLETE", async () => {
    const frames = parseStageFrames((await injectStaged()).body);
    const order = frames.map((f) => f.stage);

    const iDrafting = order.indexOf("DRAFTING");
    const iGraph = order.indexOf("GRAPH_READY");
    const iCoaching = order.indexOf("COACHING_READY");
    const iComplete = order.lastIndexOf("COMPLETE");

    expect(iDrafting).toBe(0);
    expect(iGraph).toBeGreaterThan(-1);
    expect(iCoaching).toBeGreaterThan(-1);
    expect(iComplete).toBeGreaterThan(-1);

    // THE ORDERING PIN — this is the whole point of the lane: the validated
    // graph reaches the client before the coaching pass has even run, and
    // completion is last.
    expect(iDrafting).toBeLessThan(iGraph);
    expect(iGraph).toBeLessThan(iCoaching);
    expect(iCoaching).toBeLessThan(iComplete);
    expect(iComplete).toBe(order.length - 1);

    // seq is monotonic from 0 — a client can detect a dropped frame.
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i));

    // The graph frame's own clock reading precedes the coaching frame's, which
    // is the in-band evidence that the ~33 s / ~53 s split is real and not just
    // an emission-order accident.
    const graphFrame = frames[iGraph]!;
    const coachingFrame = frames[iCoaching]!;
    expect(typeof graphFrame.elapsed_ms).toBe("number");
    expect(coachingFrame.elapsed_ms as number).toBeGreaterThanOrEqual(
      graphFrame.elapsed_ms as number,
    );
  });

  it("carries the validated graph on GRAPH_READY", async () => {
    const frames = parseStageFrames((await injectStaged()).body);
    const graphFrame = frames.find((f) => f.stage === "GRAPH_READY")!;
    const graph = graphFrame.graph as { nodes?: unknown[]; edges?: unknown[] };

    expect(Array.isArray(graph?.nodes)).toBe(true);
    expect(Array.isArray(graph?.edges)).toBe(true);
    expect(graph.nodes!.length).toBeGreaterThan(0);
  });

  // ── 1b. NODE IDENTITY IS STABLE ACROSS FRAMES ────────────────────────────
  //
  // The defect this pins would have voided the whole lane silently.
  // `parseSchemaVersion` DEFAULTS to "v3", and the V3 boundary transform
  // rewrites node ids (`normalizeToId`, including collision suffixing) and
  // labels (`cleanNodeLabel`). An untransformed GRAPH_READY therefore hands the
  // client one set of ids at ~33 s and a DIFFERENT set at ~53 s: reconciliation
  // by id fails, the canvas duplicates or orphans nodes, and the early graph is
  // thrown away — destroying the exact latency win this route delivers.
  //
  // Note the shape of the original blind spot: the first version of this file
  // read `graphFrame.graph.nodes` in one test and asserted `toHaveProperty(
  // "nodes")` on the terminal body in another, and so never compared the two.
  // Testing each frame in isolation cannot catch a cross-frame contract.
  describe.each([
    { name: "default (v3 — the ordinary path, no ?schema)", url: "/assist/v1/draft-graph/staged", expected: "v3" },
    { name: "explicit ?schema=v2", url: "/assist/v1/draft-graph/staged?schema=v2", expected: "v2" },
  ])("node identity is byte-equal between GRAPH_READY and COMPLETE — $name", ({ url, expected }) => {
    it("matches ids, labels and kinds", async () => {
      const res = await app.inject({
        method: "POST",
        url,
        payload: PAYLOAD,
        headers: { accept: "text/event-stream" },
      });
      expect(res.statusCode).toBe(200);

      const frames = parseStageFrames(res.body);
      const graphFrame = frames.find((f) => f.stage === "GRAPH_READY")!;
      const terminal = frames[frames.length - 1]!;
      expect(terminal.stage).toBe("COMPLETE");

      // The frame must declare which vocabulary it speaks, and it must be the
      // one actually negotiated.
      expect(graphFrame.schema_version).toBe(expected);

      const early = (graphFrame.graph as { nodes: Record<string, unknown>[] }).nodes;
      const payload = terminal.payload as Record<string, unknown>;

      // v3 flattens nodes to the payload root; v1/v2 keep them under `graph`.
      const finalNodes = (Array.isArray(payload.nodes)
        ? payload.nodes
        : (payload.graph as { nodes: unknown[] } | undefined)?.nodes) as Record<string, unknown>[];

      expect(Array.isArray(early)).toBe(true);
      expect(Array.isArray(finalNodes)).toBe(true);
      expect(early.length).toBeGreaterThan(0);

      // IDENTITY — ids in order, byte-equal.
      expect(early.map((n) => n.id)).toEqual(finalNodes.map((n) => n.id));
      // LABELS — byte-equal.
      expect(early.map((n) => n.label)).toEqual(finalNodes.map((n) => n.label));
      // KIND/TYPE — whichever the negotiated vocabulary uses.
      expect(early.map((n) => n.kind ?? n.type)).toEqual(finalNodes.map((n) => n.kind ?? n.type));
    });
  });

  // ── 2. PARTIAL CONTENT NEVER PRESENTS AS COMPLETE ────────────────────────

  it("marks every pre-terminal frame in_progress and only the terminal frame complete", async () => {
    const frames = parseStageFrames((await injectStaged()).body);

    const terminal = frames[frames.length - 1]!;
    expect(terminal.stage).toBe("COMPLETE");
    expect(terminal.status).toBe("complete");

    for (const f of frames.slice(0, -1)) {
      expect(f.status).toBe("in_progress");
    }
    // Exactly one frame in the whole stream may claim completeness.
    expect(frames.filter((f) => f.status === "complete")).toHaveLength(1);
  });

  // ── 3. CLAIM-SAFETY ──────────────────────────────────────────────────────

  it("keeps claim-bearing content out of every pre-terminal frame", async () => {
    const frames = parseStageFrames((await injectStaged()).body);
    const preTerminal = frames.slice(0, -1);
    expect(preTerminal.length).toBeGreaterThan(0);

    // These carry leader designations, recommendations, or analysis verdicts.
    // None may appear before the terminal frame — and on the GRAPH_READY path
    // they CANNOT, because the coaching pass that produces them has not run
    // when that frame is emitted.
    const CLAIM_BEARING_KEYS = [
      "coaching",
      "causal_claims",
      "analysis_ready",
      "recommendation",
      "assistant_text",
      "leading_option",
      "verdict",
    ];

    for (const frame of preTerminal) {
      const keys = allKeys(frame);
      for (const banned of CLAIM_BEARING_KEYS) {
        expect(
          keys.has(banned),
          `pre-terminal frame ${frame.stage} leaked claim-bearing key "${banned}"`,
        ).toBe(false);
      }
    }

    // Positive control: the banned keys DO exist downstream, so the assertion
    // above is discriminating rather than vacuously true.
    const terminalKeys = allKeys(frames[frames.length - 1]!);
    expect(terminalKeys.has("coaching")).toBe(true);
    expect(terminalKeys.has("analysis_ready")).toBe(true);
  });

  // ── 4. THE EQUIVALENCE PIN ───────────────────────────────────────────────

  it("terminal payload is equivalent to the buffered route's body", async () => {
    // Two independent mechanisms decide what may differ, and they cover
    // different things. NEITHER replaces the other.
    //
    //  (a) NORMALISATION BY CONSTRUCTION — a wall-clock reading is volatile
    //      because of what it IS, not because a sample happened to catch it
    //      varying. Every numeric leaf under a timing-named key collapses to one
    //      sentinel before the comparison. Presence, type and every non-timing
    //      field still compare exactly (see payload-equivalence.ts).
    //
    //  (b) SAMPLING — the SAME route, several times. Whatever differs between
    //      two runs of one route is volatile by construction: ids, plan ids.
    //      Derived, never hand-listed (CLAUDE.md trap 12). Sampled from BOTH
    //      routes and only ever WITHIN a route, never across the two — across
    //      would be circular, using the very equality under test to decide what
    //      may be ignored.
    const bufferedBodies = [
      JSON.parse((await injectBuffered()).body),
      JSON.parse((await injectBuffered()).body),
      JSON.parse((await injectBuffered()).body),
    ];
    const stagedTerminal = async () => {
      const frames = parseStageFrames((await injectStaged()).body);
      return frames[frames.length - 1]!;
    };
    const stagedBodies = [
      (await stagedTerminal()).payload,
      (await stagedTerminal()).payload,
      (await stagedTerminal()).payload,
    ];

    const { volatilePaths, unnamedNumericVolatilePaths } = deriveVolatility([
      bufferedBodies,
      stagedBodies,
    ]);
    const controlBodies = bufferedBodies;

    // ── FAIL LOUD WHEN A NEW TIMING FIELD APPEARS ────────────────────────────
    // (a) is a NAME rule, so deriving guards from it moves the risk onto the
    // rule rather than removing it (trap 12d). This is the check that is NOT
    // derived from the rule: a number that changes between two runs of one route
    // under an identical input is either a wall-clock reading whose key the rule
    // does not recognise, or genuine non-determinism in the pipeline. Both are
    // findings, and both get named here instead of resurfacing as a mystery
    // flake once every ten runs — which is exactly how this test failed before.
    expect(
      unnamedNumericVolatilePaths,
      `a NUMBER varies between runs of the same route at: ${unnamedNumericVolatilePaths.join(", ")}. ` +
        `If these are wall-clock readings, teach TIMING_KEY_RE their name shape ` +
        `(tests/helpers/payload-equivalence.ts). If they are not, the draft pipeline ` +
        `is non-deterministic under an identical input and THAT is the finding.`,
    ).toEqual([]);

    // Guard the guards: neither mechanism may touch a structural or
    // claim-bearing path, because that is the only way either could conceal a
    // genuine divergence. Checked for the sampled set AND for every path the
    // wall-clock normaliser actually rewrote.
    const STRUCTURAL_PREFIXES = [
      "nodes",
      "edges",
      "options",
      "goal_node_id",
      "coaching",
      "causal_claims",
      "analysis_ready",
      "schema_version",
      "quality",
      "_pipeline_outcome",
    ];
    // Both ROUTES, not just the control: a timing-named key that appeared under
    // `nodes` on the staged side only would otherwise be rewritten without this
    // guard ever seeing it.
    const touchedEitherRoute = [...bufferedBodies, ...stagedBodies].flatMap(
      (b) => normaliseWallClockTimings(b).touched,
    );
    const suppressed = [...volatilePaths, ...touchedEitherRoute];
    for (const p of suppressed) {
      for (const prefix of STRUCTURAL_PREFIXES) {
        expect(
          p === prefix || p.startsWith(`${prefix}.`) || p.startsWith(`${prefix}[`),
          `a suppressed path "${p}" is structural — the equivalence pin would be hollow`,
        ).toBe(false);
      }
    }

    // Positive control: the normaliser must actually have engaged. If the trace
    // ever stops carrying wall-clock fields, `touched` goes empty and mechanism
    // (a) becomes a silent no-op — an absence assertion that cannot see a
    // presence proves nothing (trap 13).
    expect(
      touchedEitherRoute.length,
      "wall-clock normalisation touched nothing — mechanism (a) is inert and this pin is back to its flaky shape",
    ).toBeGreaterThan(0);

    // The real comparison.
    const staged = await injectStaged();
    const frames = parseStageFrames(staged.body);
    const terminal = frames[frames.length - 1]!;
    expect(terminal.stage).toBe("COMPLETE");
    expect(terminal.status_code).toBe(200);

    const differing = equivalenceDivergences(controlBodies[0], terminal.payload, {
      ignorePaths: volatilePaths,
    });

    expect(
      differing,
      `staged terminal payload diverged from the buffered body at: ${differing.join(", ")}`,
    ).toEqual([]);
  });

  // ── 5. THE SIBLING IS ADDITIVE ───────────────────────────────────────────

  it("leaves the buffered route returning buffered JSON", async () => {
    const res = await injectBuffered();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).not.toContain("event: stage");
    expect(JSON.parse(res.body)).toHaveProperty("nodes");
  });

  it("leaves the pre-existing 2-frame stream route emitting exactly DRAFTING then COMPLETE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph/stream",
      payload: PAYLOAD,
      headers: { accept: "text/event-stream" },
    });
    expect(res.statusCode).toBe(200);

    const stages = parseStageFrames(res.body).map((f) => f.stage);
    // The staged seam must not have leaked into this route: it does not pass
    // `onStage`, so it stays exactly as many frames as it had before.
    expect(stages).toEqual(["DRAFTING", "COMPLETE"]);
  });
});
