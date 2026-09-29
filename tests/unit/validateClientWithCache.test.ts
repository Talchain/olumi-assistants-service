import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphT } from "../../src/schemas/graph.js";

// Shared mock for the underlying validateClient
const directValidateMock = vi.fn();

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: (graph: GraphT) => directValidateMock(graph),
}));

function makeGraph(id: string): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [{ id, kind: "goal", label: "Test" }],
    edges: [],
    meta: { roots: [id], leaves: [id], suggested_positions: {}, source: "assistant" },
  };
}

describe("validateClientWithCache", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    directValidateMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches successful validation results for identical graphs", async () => {
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "true");

    const { validateGraph, __resetValidationCacheForTests } = await import(
      "../../src/services/validateClientWithCache.js"
    );

    await __resetValidationCacheForTests();

    const graph = makeGraph("g1");

    directValidateMock.mockResolvedValueOnce({ ok: true, normalized: graph, violations: [] });

    const result1 = await validateGraph(graph);
    const result2 = await validateGraph(graph);

    expect(result1).toEqual(result2);
    expect(directValidateMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache entirely when disabled", async () => {
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

    const { validateGraph, __resetValidationCacheForTests } = await import(
      "../../src/services/validateClientWithCache.js"
    );

    await __resetValidationCacheForTests();

    const graph = makeGraph("g2");

    directValidateMock.mockResolvedValue({ ok: true, normalized: graph, violations: [] });

    await validateGraph(graph);
    await validateGraph(graph);

    expect(directValidateMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache validate_unreachable failures so callers can retry", async () => {
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "true");

    const { validateGraph, __resetValidationCacheForTests } = await import(
      "../../src/services/validateClientWithCache.js"
    );

    await __resetValidationCacheForTests();

    const graph = makeGraph("g3");

    directValidateMock.mockResolvedValue({
      ok: false,
      normalized: undefined,
      violations: ["validate_unreachable"],
    });

    await validateGraph(graph);
    await validateGraph(graph);

    expect(directValidateMock).toHaveBeenCalledTimes(2);
  });

  it("emits telemetry events for cache miss then hit", async () => {
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "true");

    const { setTestSink, TelemetryEvents } = await import("../../src/utils/telemetry.js");
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => {
      events.push({ event, data });
    });

    const { validateGraph, __resetValidationCacheForTests } = await import(
      "../../src/services/validateClientWithCache.js"
    );

    await __resetValidationCacheForTests();

    const graph = makeGraph("g-telemetry-hit-miss");

    directValidateMock.mockResolvedValueOnce({ ok: true, normalized: graph, violations: [] });

    await validateGraph(graph); // miss
    await validateGraph(graph); // hit

    const names = events.map((e) => e.event);
    expect(names.filter((n) => n === TelemetryEvents.ValidationCacheMiss)).toHaveLength(1);
    expect(names.filter((n) => n === TelemetryEvents.ValidationCacheHit)).toHaveLength(1);

    setTestSink(null);
  });

  it("emits bypass telemetry for validate_unreachable without counting as hit or miss", async () => {
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "true");

    const { setTestSink, TelemetryEvents } = await import("../../src/utils/telemetry.js");
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => {
      events.push({ event, data });
    });

    const { validateGraph, __resetValidationCacheForTests } = await import(
      "../../src/services/validateClientWithCache.js"
    );

    await __resetValidationCacheForTests();

    const graph = makeGraph("g-telemetry-unreachable");

    directValidateMock.mockResolvedValue({
      ok: false,
      normalized: undefined,
      violations: ["validate_unreachable"],
    });

    await validateGraph(graph);
    await validateGraph(graph);

    const names = events.map((e) => e.event);
    expect(names).toContain(TelemetryEvents.ValidationCacheBypass);
    expect(names).not.toContain(TelemetryEvents.ValidationCacheHit);
    expect(names).not.toContain(TelemetryEvents.ValidationCacheMiss);

    setTestSink(null);
  });
});
