/**
 * ROADMAP 1.77 slice F1 — draft substage timing completeness.
 *
 * WHY THIS EXISTS. The F1 investigation (2026-07-18) had to answer "where do
 * the ~57 seconds of a draft turn actually go?" and could NOT answer it from
 * the deployed `_diagnostic_trace`: `buildBenchmarkingForDraftGraph`
 * hand-listed 4 of the 12 numeric timings the pipeline captures, dropping
 * `normalise_ms`, `enrich_ms`, `threshold_sweep_ms`, `package_ms` and
 * `boundary_ms`. The answer had to be reconstructed from a different wire
 * surface (`_timings`, double-gated) plus Render logs.
 *
 * That is the hand-maintained-mirror defect class: the drift read as green.
 * The fix inverts the dependency — `DRAFT_GRAPH_NUMERIC_TIMING_KEYS` is the
 * source of truth and the writer maps over it — so this file's job is to
 * hold that inversion in place and to pin the flag-off byte-identity.
 *
 * Test-design notes:
 *  - T1 is the POSITIVE CONTROL for T2. T2 asserts an ABSENCE (flag off →
 *    detail keys gone); that assertion is only meaningful because T1 proves
 *    this same harness CAN see those keys present. An absence test without a
 *    proven-visible presence is vacuous.
 *  - T3 is the anti-drift pin: it derives its expectation from the exported
 *    key list rather than restating it, so adding a pipeline timing key
 *    without carrying it onto the trace fails here rather than silently
 *    shipping a hole.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

/**
 * A fully-populated timings object: every numeric key the pipeline can
 * capture, each with a DISTINCT value so a mis-mapped key is detectable
 * (equal values would let a rename collision pass).
 */
function makeFullTimings(): Record<string, number> {
  return {
    total_ms: 62640,
    parse_ms: 62537,
    parse_llm_ms: 62523,
    normalise_ms: 1,
    enrich_ms: 3,
    repair_ms: 17,
    repair_llm_ms: 11,
    repair_deterministic_ms: 6,
    validation_pipeline_ms: 2,
    threshold_sweep_ms: 4,
    coaching_pass_ms: 8,
    package_ms: 5,
    boundary_ms: 7,
  };
}

/**
 * Drive the REAL public builder (`buildV5DiagnosticTrace`), not an internal
 * helper — so the flag is proven through the path draft_graph actually
 * takes, rather than through a seam invented for the test.
 */
async function buildTrace(
  flag: boolean,
  timings: Record<string, number> = makeFullTimings(),
) {
  process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
  process.env.CEE_DRAFT_SUBSTAGE_DETAIL = flag ? 'true' : 'false';
  vi.resetModules();

  const mod = await import('../v5-diagnostic-trace.js');
  const { DRAFT_GRAPH_NUMERIC_TIMING_KEYS } = await import(
    '../../telemetry/turn-timings.js'
  );

  const full = mod.buildV5DiagnosticTrace({
    startedAt: Date.now() - 1000,
    persistenceMs: 42,
    scenarioId: 'scn_f1',
    turnId: 'turn_f1',
    requestId: 'req_f1',
    commitResult: { committed: true } as never,
    draftResult: {
      latencyMs: 62640,
      draftGraphTimings: timings,
    } as never,
  });

  expect(full).toBeDefined();
  return {
    trace: full!.benchmarking,
    keys: DRAFT_GRAPH_NUMERIC_TIMING_KEYS,
  };
}

describe('ROADMAP 1.77 F1 — draft substage timing detail', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  describe('T1 — flag ON emits the COMPLETE substage set (positive control for T2)', () => {
    it('carries every pipeline numeric timing onto the trace, under its trace-surface name', async () => {
      const { trace } = await buildTrace(true);
      const st = trace.substage_timings as Record<string, number>;

      // The five keys the old hand-listed writer silently dropped. These are
      // the whole point of the slice.
      expect(st.normalise_ms).toBe(1);
      expect(st.enrich_ms).toBe(3);
      expect(st.threshold_sweep_ms).toBe(4);
      expect(st.package_ms).toBe(5);
      expect(st.boundary_ms).toBe(7);

      // The repair split, also previously dropped.
      expect(st.repair_llm_ms).toBe(11);
      expect(st.repair_deterministic_ms).toBe(6);
      expect(st.total_ms).toBe(62640);

      // The two historical renames must still apply — not pass through raw.
      expect(st.llm_call_ms).toBe(62523);
      expect(st.validation_ms).toBe(2);
      expect(st.parse_llm_ms).toBeUndefined();
      expect(st.validation_pipeline_ms).toBeUndefined();

      // Handler-level fields survive the derived spread.
      expect(st.persistence_ms).toBe(42);
      expect(st.total_handler_duration_ms).toBe(62640);
    });

    it('omits a timing that was never captured rather than emitting undefined', async () => {
      // Honesty property: a stage that did not run must be ABSENT, not
      // present-as-undefined, so a consumer cannot read "ran in 0 ms".
      const { trace } = await buildTrace(true, { parse_ms: 50 });
      const st = trace.substage_timings as Record<string, unknown>;

      expect(st.parse_ms).toBe(50);
      expect('enrich_ms' in st).toBe(false);
      expect('package_ms' in st).toBe(false);
    });
  });

  describe('T2 — flag OFF is byte-identical to the historical payload', () => {
    it('emits exactly the six legacy keys and none of the detail keys', async () => {
      const { trace } = await buildTrace(false);
      const st = trace.substage_timings as Record<string, number>;

      // Exact key set — not a subset check. A superset would be a wire change.
      expect(Object.keys(st).sort()).toEqual(
        [
          'llm_call_ms',
          'parse_ms',
          'persistence_ms',
          'repair_ms',
          'total_handler_duration_ms',
          'validation_ms',
        ].sort(),
      );

      // The detail keys T1 proved this harness CAN see are absent here.
      expect(st.normalise_ms).toBeUndefined();
      expect(st.enrich_ms).toBeUndefined();
      expect(st.package_ms).toBeUndefined();
      expect(st.boundary_ms).toBeUndefined();
      expect(st.threshold_sweep_ms).toBeUndefined();

      // Legacy values unchanged.
      expect(st.llm_call_ms).toBe(62523);
      expect(st.parse_ms).toBe(62537);
      expect(st.repair_ms).toBe(17);
      expect(st.validation_ms).toBe(2);
    });
  });

  describe('T3 — anti-drift pin: the trace must cover the FULL key list', () => {
    it('emits a trace field for every exported pipeline timing key', async () => {
      const { trace, keys } = await buildTrace(true);
      const st = trace.substage_timings as Record<string, number>;

      // Derived from the exported source-of-truth list, NOT restated here.
      // If someone adds a key to DRAFT_GRAPH_NUMERIC_TIMING_KEYS and the
      // writer stops covering it, this fails loudly instead of shipping a
      // silent hole — the failure mode that made the 57s unattributable.
      const renames: Record<string, string> = {
        parse_llm_ms: 'llm_call_ms',
        validation_pipeline_ms: 'validation_ms',
      };

      const missing = keys
        .map((k) => renames[k] ?? k)
        .filter((traceKey) => !(traceKey in st));

      expect(missing).toEqual([]);
      // 13 since v12 (lean-draft contract): coaching_pass_ms (Stage 4.5) joined
      // DRAFT_GRAPH_NUMERIC_TIMING_KEYS. Bumped deliberately — this pin forces a
      // reviewer to acknowledge every new pipeline timing key (anti-drift).
      expect(keys.length).toBe(13);
    });
  });
});
