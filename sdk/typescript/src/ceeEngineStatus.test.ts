import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEExplainGraphResponseV1,
} from "./ceeTypes.js";
import { buildCeeEngineStatus, type CeeEngineStatus } from "./ceeHelpers.js";

describe("buildCeeEngineStatus", () => {
  it("returns undefined when no envelopes have engine trace metadata", () => {
    const status = buildCeeEngineStatus({});
    expect(status).toBeUndefined();
  });

  it("aggregates provider, model, and degraded flag across envelopes", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: {
        request_id: "r1",
        correlation_id: "r1",
        engine: {
          provider: "fixtures",
          model: "fixture-draft-v1",
        },
      },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const explain: CEEExplainGraphResponseV1 = {
      trace: {
        request_id: "r1",
        correlation_id: "r1",
        engine: {
          provider: "fixtures",
          model: "fixture-explain-v1",
          degraded: true,
        },
      },
      quality: { overall: 6 } as any,
      explanations: [] as any,
    } as any;

    const status: CeeEngineStatus | undefined = buildCeeEngineStatus({ draft, explain });

    expect(status).toBeDefined();
    expect(status?.provider).toBe("fixtures");
    expect(["fixture-draft-v1", "fixture-explain-v1"]).toContain(status?.model);
    expect(status?.degraded).toBe(true);
  });

  it("never leaks graph labels or prompts into the engine status", () => {
    const SECRET = "ENGINE_STATUS_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: {
        request_id: "r-secret",
        correlation_id: "r-secret",
        engine: {
          provider: "fixtures",
          model: "fixture-secret-v1",
          degraded: true,
        },
      },
      quality: { overall: 6 } as any,
      graph: {
        // Intentionally include a secret marker in a label; engine status must
        // never surface it.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const status = buildCeeEngineStatus({ draft });

    const serialized = JSON.stringify(status).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
