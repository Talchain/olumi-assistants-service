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

  const injectBuffered = () =>
    app.inject({ method: "POST", url: "/assist/v1/draft-graph", payload: PAYLOAD });

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
