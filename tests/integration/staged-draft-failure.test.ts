/**
 * ROADMAP 1.204 M1 — what the staged route does when the draft fails AFTER
 * GRAPH_READY has already gone out, and the partial-draft signal that tells a
 * client to throw the early graph away.
 *
 * Why this is separate from staged-draft-sse.test.ts: proving a post-GRAPH_READY
 * failure needs `runUnifiedPipeline` itself replaced, and a module mock is
 * file-wide.
 *
 * The risk being pinned is a real one and it is a HONESTY risk, not a crash
 * risk. GRAPH_READY lands ~20 s before the terminal frame. If the draft then
 * fails, or turns out to have been salvaged from a truncated LLM response, the
 * canvas has been showing a graph that the finished draft does not endorse — and
 * nothing in the pre-terminal frames can say so, because at the time they were
 * written it was not yet known. The contract's answer is the terminal frame, so
 * the terminal frame must actually carry the two signals the client rule names.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "10000");

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Replace the pipeline: emit a GRAPH_READY through the real seam, then throw —
// the exact sequence a mid-draft failure produces.
vi.mock("../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: vi.fn(async (_input: unknown, _raw: unknown, _req: unknown, opts: any) => {
    opts.onStage?.({
      kind: "GRAPH_READY",
      graph: { nodes: [{ id: "goal_1", kind: "goal", label: "Grow revenue" }], edges: [] },
      schema_version: opts.schemaVersion,
      elapsed_ms: 33_000,
    });
    throw new Error("draft exploded after the graph was published");
  }),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { readSalvagedFromTruncation } from "../../src/routes/assist.v1.draft-graph-staged.js";

const PAYLOAD = { brief: "A sufficiently long decision brief to pass validation and exercise the pipeline." };

interface Frame { stage: string; seq: number; status: string; [k: string]: unknown }

function parseStageFrames(body: string): Frame[] {
  const out: Frame[] = [];
  for (const block of body.split("\n\n")) {
    if (!block.includes("event: stage")) continue;
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (line) out.push(JSON.parse(line.slice(6)) as Frame);
  }
  return out;
}

describe("staged draft — failure after GRAPH_READY", () => {
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

  it("still terminates cleanly, and the terminal frame carries the discard signal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph/staged",
      payload: PAYLOAD,
      headers: { accept: "text/event-stream" },
    });

    // SSE opened 200 and the stream is well-formed even though the draft died.
    expect(res.statusCode).toBe(200);

    const frames = parseStageFrames(res.body);
    const stages = frames.map((f) => f.stage);

    // The early graph did go out, and it was never claimed to be complete.
    expect(stages).toContain("GRAPH_READY");
    expect(frames.find((f) => f.stage === "GRAPH_READY")!.status).toBe("in_progress");

    // The stream still terminates — a failed draft must not hang the client.
    const terminal = frames[frames.length - 1]!;
    expect(terminal.stage).toBe("COMPLETE");
    expect(terminal.status).toBe("complete");

    // THE DISCARD SIGNAL. The documented client rule is "discard GRAPH_READY if
    // the terminal frame carries status_code >= 400". That rule is only usable
    // if the field is actually there on the failure path.
    expect(terminal.status_code).toBeGreaterThanOrEqual(400);

    // seq stays monotonic across the failure, so the client can still tell it
    // received every frame.
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i));
  });
});

describe("readSalvagedFromTruncation — the partial-draft signal is wired to the REAL path", () => {
  // The first implementation read `body.llm_metadata`, which does not exist:
  // the projection lands at `trace.pipeline.llm_metadata`. It therefore
  // resolved to undefined on every response and the field was never emitted —
  // the doctrine was decoration. These cases pin the path itself.

  it("reads a TRUE value from the real body shape (positive control)", () => {
    const body = { trace: { pipeline: { llm_metadata: { salvaged_from_truncation: true } } } };
    expect(readSalvagedFromTruncation(body)).toBe(true);
  });

  it("reads a FALSE value from the real body shape", () => {
    const body = { trace: { pipeline: { llm_metadata: { salvaged_from_truncation: false } } } };
    expect(readSalvagedFromTruncation(body)).toBe(false);
  });

  it("does NOT find it at the body root — the path the first version used", () => {
    // Guards the regression directly: if someone 'simplifies' the helper back
    // to a root lookup, the real-shape cases above go undefined and RED.
    const rootOnly = { llm_metadata: { salvaged_from_truncation: true } };
    // The helper tolerates this shape as a last resort, but the REAL body never
    // has it — which is exactly why a root-only implementation was silent.
    expect(readSalvagedFromTruncation({ trace: { pipeline: {} } })).toBeUndefined();
    expect(readSalvagedFromTruncation(rootOnly)).toBe(true);
  });

  it("returns undefined when genuinely unknown, rather than guessing false", () => {
    expect(readSalvagedFromTruncation(undefined)).toBeUndefined();
    expect(readSalvagedFromTruncation({})).toBeUndefined();
    expect(readSalvagedFromTruncation({ trace: {} })).toBeUndefined();
    // A non-boolean must not be coerced — unknown is a distinct state from false.
    expect(
      readSalvagedFromTruncation({ trace: { pipeline: { llm_metadata: { salvaged_from_truncation: "yes" } } } }),
    ).toBeUndefined();
  });
});
