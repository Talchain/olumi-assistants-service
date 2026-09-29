/**
 * The staged-vs-buffered equivalence comparison, pinned directly.
 *
 * The property under test used to be observable ONLY through a live pipeline
 * run, which made its verdict depend on how many milliseconds a stage happened
 * to take: at commit bfb2cb5f the same `Integration Tests (advisory)` job ran
 * twice on the identical tree and disagreed (job 92755069551 PASSED, job
 * 92755076632 FAILED at `trace.pipeline.threshold_sweep.duration_ms`). These
 * tests state the same property with no clock in the loop.
 *
 * They are written in pairs on purpose. Every "this difference is forgiven"
 * case sits next to a "this difference is still reported" case, because the
 * only way to make the flake go away wrongly is to blunt the pin — and a test
 * that cannot fail looks exactly like a test that passes.
 */

import { describe, it, expect } from "vitest";
import {
  TIMING_SENTINEL,
  deriveVolatility,
  diffPaths,
  equivalenceDivergences,
  isTimingKey,
  normaliseWallClockTimings,
} from "../helpers/payload-equivalence.js";

/** The real shape, trimmed to the block the CI failure named. */
const payload = (over: Record<string, unknown> = {}) => ({
  nodes: [{ id: "dec_1", label: "Decide", kind: "decision" }],
  quality: { overall: 9, coverage: 9 },
  trace: {
    pipeline: {
      total_duration_ms: 17,
      threshold_sweep: {
        ran: true,
        duration_ms: 0,
        goals_checked: 1,
        strips_applied: 0,
      },
      llm_metadata: { duration_ms: 0, model: "fixture" },
      ...over,
    },
  },
});

/** Deep-set `trace.pipeline.<...>` on a fresh payload. */
function withSweep(sweep: Record<string, unknown>) {
  const p = payload();
  p.trace.pipeline.threshold_sweep = { ...p.trace.pipeline.threshold_sweep, ...sweep } as never;
  return p;
}

describe("equivalence comparison — wall-clock timings are normalised, not ignored", () => {
  // ── THE REGRESSION ────────────────────────────────────────────────────────

  it("forgives the exact divergence that reds CI: threshold_sweep.duration_ms 0 vs 1", () => {
    const a = withSweep({ duration_ms: 0 });
    const b = withSweep({ duration_ms: 1 });

    // Sanity: the two payloads really do differ, so this case is not vacuous.
    expect(diffPaths(a, b)).toEqual(["trace.pipeline.threshold_sweep.duration_ms"]);

    expect(equivalenceDivergences(a, b)).toEqual([]);
  });

  it("forgives the second field in the same class — llm_metadata.duration_ms", () => {
    // Measured constant at 0 over 60 runs, so sampling never classified it
    // volatile either. It had not fired yet; it is the same defect.
    const a = payload();
    const b = payload();
    b.trace.pipeline.llm_metadata.duration_ms = 4;
    expect(diffPaths(a, b)).toEqual(["trace.pipeline.llm_metadata.duration_ms"]);
    expect(equivalenceDivergences(a, b)).toEqual([]);
  });

  it("forgives a timing key it has never seen, because the rule is a NAME rule", () => {
    const a = payload({ boundary: { serialise_elapsed_ms: 2 } });
    const b = payload({ boundary: { serialise_elapsed_ms: 9 } });
    expect(equivalenceDivergences(a, b)).toEqual([]);
  });

  // ── THE OTHER HALF: WHAT MUST STILL BE REPORTED ──────────────────────────
  //
  // Each of these is a way the fix could have been "achieved" by weakening the
  // claim instead of narrowing it.

  it("still reports a NON-timing sibling inside the very same block", () => {
    // Leaf-scoped, not block-scoped: normalising `duration_ms` must not buy
    // amnesty for `strips_applied` sitting beside it.
    const a = withSweep({ duration_ms: 0, strips_applied: 0 });
    const b = withSweep({ duration_ms: 1, strips_applied: 3 });
    expect(equivalenceDivergences(a, b)).toEqual([
      "trace.pipeline.threshold_sweep.strips_applied",
    ]);
  });

  it("still reports a timing key PRESENT ON ONE SIDE ONLY", () => {
    const a = payload();
    const b = payload();
    delete (b.trace.pipeline.threshold_sweep as { duration_ms?: number }).duration_ms;
    expect(equivalenceDivergences(a, b)).toEqual([
      "trace.pipeline.threshold_sweep.duration_ms",
    ]);
  });

  it("still reports a WHOLE timing-bearing block vanishing", () => {
    const a = payload();
    const b = payload();
    delete (b.trace.pipeline as { threshold_sweep?: unknown }).threshold_sweep;
    expect(equivalenceDivergences(a, b)).toEqual(["trace.pipeline.threshold_sweep"]);
  });

  it.each([
    ["null", null],
    ["a string", "0"],
    ["a boolean", false],
  ])("still reports a timing value whose TYPE changed to %s", (_label, value) => {
    const a = withSweep({ duration_ms: 0 });
    const b = withSweep({ duration_ms: value });
    expect(equivalenceDivergences(a, b)).toEqual([
      "trace.pipeline.threshold_sweep.duration_ms",
    ]);
  });

  it("still reports two different NON-NUMBER values under a timing key", () => {
    // Only numbers are wall-clock readings. `"fast"` vs `"slow"` is content.
    const a = withSweep({ duration_ms: "fast" });
    const b = withSweep({ duration_ms: "slow" });
    expect(equivalenceDivergences(a, b)).toEqual([
      "trace.pipeline.threshold_sweep.duration_ms",
    ]);
  });

  it("still reports structural and product content", () => {
    const a = payload();
    const b = payload();
    b.nodes[0]!.label = "Decide differently";
    b.quality.overall = 3;
    expect(equivalenceDivergences(a, b).sort()).toEqual([
      "nodes[0].label",
      "quality.overall",
    ]);
  });

  it("honours the sampled ignore set without letting it hide anything else", () => {
    const a = payload();
    const b = payload();
    b.quality.overall = 3;
    b.nodes[0]!.id = "dec_2";
    expect(equivalenceDivergences(a, b, { ignorePaths: new Set(["nodes[0].id"]) })).toEqual([
      "quality.overall",
    ]);
  });
});

// ── THE RULE'S OWN CORPUS ───────────────────────────────────────────────────
//
// Deriving the guard from a name rule MOVES the risk onto the rule; it does not
// remove it (CLAUDE.md trap 12d). Nothing derived from the rule can notice that
// the rule is short or broad, so this corpus is hand-written from the 195
// distinct leaf keys of a real draft payload, plus names the estate does not use
// yet but would.
describe("isTimingKey — the name rule, against a corpus it was not derived from", () => {
  it.each([
    "duration_ms",
    "total_duration_ms",
    "stream_duration_ms",
    "graph_ready_ms",
    "elapsed_ms",
    "latency_ms",
    "ms",
    "duration",
    "total_duration",
    "elapsed",
    "durations",
    "runtime_ms",
    "uptime_seconds",
    "took_ms",
    "sweep_took",
    "started_at",
    "created_at",
  ])("matches the wall-clock key %s", (key) => {
    expect(isTimingKey(key)).toBe(true);
  });

  // The rule's KNOWN BLIND SPOT, stated rather than glossed over. These are
  // real wall-clock names it does not recognise, and it is the fail-loud
  // `unnamedNumericVolatilePaths` signal below — not this rule — that catches
  // them. Pinning them here keeps the residual honest: if someone later widens
  // TIMING_KEY_RE to cover one, this test tells them the guard's division of
  // labour has moved.
  it.each(["sweep_millis", "render_nanos", "phase_wallclock"])(
    "does NOT recognise the wall-clock name %s — the fail-loud signal covers it",
    (key) => {
      expect(isTimingKey(key)).toBe(false);
    },
  );

  it.each([
    // Real keys from the payload census. Matching any of these would let the
    // normalisation conceal a genuine divergence.
    "build_timestamp",
    "estimated_minutes",
    "edge_format",
    "total_tokens",
    "prompt_tokens",
    "strips_applied",
    "goals_checked",
    "warnings_emitted",
    "repairs_count",
    "rescue_score",
    "mean",
    "std",
    "confidence",
    "value",
    "total",
    "overall",
    "coverage",
    "node_count",
    "edge_count",
    "temperature",
    "exists_probability",
    "jaccard",
    "llm_call_count",
    "mutation_count",
    "violations_before",
    "violations_after",
    "goal_threshold",
    "normalised_value",
    "attempts",
    "steps",
  ])("leaves the structural/content key %s alone", (key) => {
    expect(isTimingKey(key)).toBe(false);
  });
});

describe("normaliseWallClockTimings", () => {
  it("replaces numeric wall-clock leaves and reports exactly which", () => {
    const { value, touched } = normaliseWallClockTimings(payload());
    expect(touched.sort()).toEqual([
      "trace.pipeline.llm_metadata.duration_ms",
      "trace.pipeline.threshold_sweep.duration_ms",
      "trace.pipeline.total_duration_ms",
    ]);
    const v = value as ReturnType<typeof payload>;
    expect(v.trace.pipeline.threshold_sweep.duration_ms).toBe(TIMING_SENTINEL as never);
    // Everything else survives untouched.
    expect(v.trace.pipeline.threshold_sweep.goals_checked).toBe(1);
    expect(v.nodes[0]!.id).toBe("dec_1");
    expect(v.quality.overall).toBe(9);
  });

  it("does not mutate its input", () => {
    const original = payload();
    const before = JSON.stringify(original);
    normaliseWallClockTimings(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("normalises array-valued timing fields elementwise", () => {
    const { value, touched } = normaliseWallClockTimings({ stage_durations_ms: [1, 2, 3] });
    expect(touched).toEqual([
      "stage_durations_ms[0]",
      "stage_durations_ms[1]",
      "stage_durations_ms[2]",
    ]);
    expect(value).toEqual({
      stage_durations_ms: [TIMING_SENTINEL, TIMING_SENTINEL, TIMING_SENTINEL],
    });
  });

  it("touches nothing in a payload with no timing fields — so an empty `touched` means something", () => {
    expect(normaliseWallClockTimings({ nodes: [{ id: "a", value: 1 }] }).touched).toEqual([]);
  });
});

describe("deriveVolatility — the fail-loud completeness signal", () => {
  it("classifies ids volatile without hand-listing them", () => {
    const { volatilePaths } = deriveVolatility([
      [{ trace: { request_id: "a" } }, { trace: { request_id: "b" } }],
    ]);
    expect([...volatilePaths]).toEqual(["trace.request_id"]);
  });

  it("stays SILENT when the only numeric variation is a NAMED wall-clock field", () => {
    const { unnamedNumericVolatilePaths } = deriveVolatility([
      [{ trace: { pipeline: { duration_ms: 0 } } }, { trace: { pipeline: { duration_ms: 7 } } }],
    ]);
    expect(unnamedNumericVolatilePaths).toEqual([]);
  });

  it("FIRES, by name, on a number that varies under a key the rule does not know", () => {
    // This is the whole point: the next wall-clock field to arrive under a name
    // TIMING_KEY_RE has not learned reds LOUDLY and says which path it is,
    // instead of reappearing as a mystery flake once every ten runs.
    // `sweep_millis` is deliberately a name the rule does NOT match (pinned
    // above) — using one it DOES match would make this test agree with itself.
    const { unnamedNumericVolatilePaths } = deriveVolatility([
      [{ trace: { pipeline: { sweep_millis: 0 } } }, { trace: { pipeline: { sweep_millis: 3 } } }],
    ]);
    expect(unnamedNumericVolatilePaths).toEqual(["trace.pipeline.sweep_millis"]);
  });

  it("compares only WITHIN a route group, never across them", () => {
    // Comparing across routes would be circular — it would use the very
    // equality under test to decide what may be ignored.
    const { volatilePaths } = deriveVolatility([
      [{ q: 1 }, { q: 1 }],
      [{ q: 2 }, { q: 2 }],
    ]);
    expect([...volatilePaths]).toEqual([]);
  });
});
