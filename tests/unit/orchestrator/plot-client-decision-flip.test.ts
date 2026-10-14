/**
 * SCIENCE ROBUSTNESS (EXPERIMENT): CEE is the validating boundary for ISL's decision-flip block, which PLoT #431
 * forwards verbatim. `decisionFlip` never throws except on a TURN abort; every other outcome is typed, and only a block
 * that passes the strict `DecisionFlipBlockV1Schema` (@talchain/schemas 0.75.0) is ever `ok`.
 * The block below is REAL ISL wire output (worker `run_decision_flip_v2`, ISL #220 @51bab705; D1, K=4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PLOT_DECISION_FLIP_TIMEOUT_MS } from "../../../src/config/timeouts.js";

vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "plot") return { baseUrl: "http://plot-test:3002", authToken: "test-token-secret" };
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { createPLoTClient, parseDecisionFlipResponse } = await import("../../../src/orchestrator/plot-client.js");

const ISL_D1_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"ai_reporting_module_sprint","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"sprint_capacity_for_ai_reporting","to_id":"ai_reporting_module_availability","status":"quoted","reason":null,"current_mean":0.25,"threshold":0.0625,"replicate_thresholds":[0.06125,0.06375,0.06125,0.06625],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"},{"from_id":"ai_reporting_module_availability","to_id":"enterprise_prospect_signing_likelihood","status":"absent","reason":"replicates_spread","current_mean":0.6,"threshold":null,"replicate_thresholds":[0.14125000000000001,0.15125,0.15624999999999997,0.15874999999999997],"replicate_range":0.01749999999999996,"to_option_id":null},{"from_id":"enterprise_prospect_signing_likelihood","to_id":"quarterly_revenue","status":"quoted","reason":null,"current_mean":0.5,"threshold":0.08875000000000002,"replicate_thresholds":[0.08625000000000002,0.09125000000000003,0.08875000000000002,0.08875000000000002],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"}]};
const PAYLOAD = {
  graph: { nodes: [], edges: [] }, options: [{ id: "a", option_id: "a", interventions: { fac_1: 0.5 } }], goal_node_id: "g1",
  decision_flip: { links: [{ from_id: "a", to_id: "b" }], replicates: 4 },
};
const ok200 = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("parseDecisionFlipResponse — the strict parse is the boundary", () => {
  it("ISL's real block is ok and comes back as parsed", () => {
    const r = parseDecisionFlipResponse({ decision_flip: ISL_D1_BLOCK, decision_flip_unavailable: null, meta: {} });
    expect(r).toEqual({ ok: true, block: ISL_D1_BLOCK });
  });
  it("a block that breaks the licence (bound_abs 0.02) or carries an unknown key is unparsable, never ok", () => {
    expect(parseDecisionFlipResponse({ decision_flip: { ...ISL_D1_BLOCK, bound_abs: 0.02 } })).toEqual({ ok: false, reason: "unparsable" });
    expect(parseDecisionFlipResponse({ decision_flip: { ...ISL_D1_BLOCK, flip_mean: 0.025 } })).toEqual({ ok: false, reason: "unparsable" });
  });
  it("PLoT's typed unavailable reason is carried; anything else (a Run body, garbage) is unparsable", () => {
    expect(parseDecisionFlipResponse({ decision_flip: null, decision_flip_unavailable: { reason: "ISL_TIMEOUT" } }))
      .toEqual({ ok: false, reason: "unavailable", detail: "ISL_TIMEOUT" });
    expect(parseDecisionFlipResponse({ results: [{ option_id: "a" }], meta: { response_hash: "h" } })).toEqual({ ok: false, reason: "unparsable" });
    expect(parseDecisionFlipResponse(null)).toEqual({ ok: false, reason: "unparsable" });
  });
});

describe("plotClient.decisionFlip — one attempt, typed outcomes", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts the payload to /v2/run once and returns the parsed block", async () => {
    fetchSpy.mockResolvedValue(ok200({ decision_flip: ISL_D1_BLOCK, decision_flip_unavailable: null, meta: {} }));
    const r = await createPLoTClient()!.decisionFlip!(PAYLOAD, "req-1");
    expect(r).toEqual({ ok: true, block: ISL_D1_BLOCK });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://plot-test:3002/v2/run");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual(PAYLOAD);
  });

  it("an HTTP error (an older PLoT refusing the unknown key: 400) is http_error, not retried", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    expect(await createPLoTClient()!.decisionFlip!(PAYLOAD, "req-2")).toEqual({ ok: false, reason: "http_error", status: 400 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a network failure is network", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    expect(await createPLoTClient()!.decisionFlip!(PAYLOAD, "req-3")).toEqual({ ok: false, reason: "network" });
  });

  it(`its own ${PLOT_DECISION_FLIP_TIMEOUT_MS} ms cap is a typed timeout`, async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const pending = createPLoTClient()!.decisionFlip!(PAYLOAD, "req-4");
    await vi.advanceTimersByTimeAsync(PLOT_DECISION_FLIP_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("headers then a STALLED body are still capped: a typed timeout (Codex P2 #2542)", async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation(async (_u: string, init: { signal: AbortSignal }) => ({
      ok: true, status: 200,
      json: () => new Promise((_res, rej) => {
        init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    }));
    const pending = createPLoTClient()!.decisionFlip!(PAYLOAD, "req-4b");
    await vi.advanceTimersByTimeAsync(PLOT_DECISION_FLIP_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a TURN abort is not swallowed: the caller went away", async () => {
    const turn = new AbortController();
    fetchSpy.mockImplementation((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const pending = createPLoTClient()!.decisionFlip!(PAYLOAD, "req-5", { turnSignal: turn.signal });
    turn.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
