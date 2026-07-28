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
 * the test runs the BUFFERED route twice, and whatever differs between those
 * two runs is by definition volatile. The staged-vs-buffered comparison then
 * ignores exactly that derived set and nothing else — and a further assertion
 * fails the test if the derived set ever grows to include a structural key,
 * which is the only way this normalisation could hide a real difference.
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

/** Every differing path between two JSON values, as dotted paths. */
function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (a === b) return [];
  const bothObjects =
    typeof a === "object" && a !== null && typeof b === "object" && b !== null;
  if (!bothObjects) return [path];
  if (Array.isArray(a) !== Array.isArray(b)) return [path];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [path];
    return a.flatMap((v, i) => diffPaths(v, (b as unknown[])[i], `${path}[${i}]`));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  return [...keys].flatMap((k) => diffPaths(ao[k], bo[k], path ? `${path}.${k}` : k));
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
    // Control run: the SAME route twice. Whatever differs here is volatile by
    // construction (ids, clocks) — derived, never hand-listed.
    const bufferedA = await injectBuffered();
    const bufferedB = await injectBuffered();
    expect(bufferedA.statusCode).toBe(200);
    expect(bufferedB.statusCode).toBe(200);

    const volatilePaths = new Set(
      diffPaths(JSON.parse(bufferedA.body), JSON.parse(bufferedB.body)),
    );

    // Guard the guard: the derived volatile set must never include a
    // structural or claim-bearing path, because that is the only way the
    // normalisation below could conceal a genuine divergence.
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
    for (const p of volatilePaths) {
      for (const prefix of STRUCTURAL_PREFIXES) {
        expect(
          p === prefix || p.startsWith(`${prefix}.`) || p.startsWith(`${prefix}[`),
          `volatile-path derivation captured a structural path "${p}" — the equivalence pin would be hollow`,
        ).toBe(false);
      }
    }

    // The real comparison.
    const staged = await injectStaged();
    const frames = parseStageFrames(staged.body);
    const terminal = frames[frames.length - 1]!;
    expect(terminal.stage).toBe("COMPLETE");
    expect(terminal.status_code).toBe(200);

    const differing = diffPaths(JSON.parse(bufferedA.body), terminal.payload).filter(
      (p) => !volatilePaths.has(p),
    );

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
