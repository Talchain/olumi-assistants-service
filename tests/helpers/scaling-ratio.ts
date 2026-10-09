import { performance } from 'node:perf_hooks';

/**
 * Growth of a call's cost: callers use 4× or 8× input steps. Take the min of 7 batches for each input,
 * with the SAME call count calibrated for SMALL >= ~15 ms and LARGE >= ~60 ms. Short small batches
 * let jitter decide the ratio even when the implementation is linear. Calibration has 10% headroom
 * and is one refinement pass; estimated LARGE batch cost is capped at ~120 ms (50,000 calls max), so a row stays
 * ~1.2 s, inside vitest's default 5 s test timeout (a 500 ms cap with 3 passes timed out 9 rows on CI, #2911 r1).
 * The cap takes precedence when, e.g., quadratic growth makes both floors impossible. A single slow
 * call or runner pause can exceed these estimated budgets. Linear ≈ 4× / 8×, quadratic ≈ 16× / 64×;
 * callers choose the ratio bar. Never an absolute millisecond bar.
 */
export function scalingRatio(runSmall: () => unknown, runLarge: () => unknown): { ratio: number; smallMs: number; largeMs: number; calls: number; detail: string } {
  const batchMs = (run: () => unknown, calls: number): number => {
    const t0 = performance.now();
    for (let j = 0; j < calls; j += 1) run();
    return performance.now() - t0;
  };
  const minBatchMs = (run: () => unknown, calls: number): number => {
    batchMs(run, calls); // warm-up
    let best = Infinity;
    for (let i = 0; i < 7; i += 1) best = Math.min(best, batchMs(run, calls));
    return best;
  };
  const probeMs = (run: () => unknown, calls: number): number =>
    Math.max(Math.min(batchMs(run, calls), batchMs(run, calls), batchMs(run, calls)), 0.001);
  const calibratedCalls = (smallPerCall: number, largePerCall: number): number => {
    const wanted = Math.ceil(Math.max(16 / smallPerCall, 66 / largePerCall));
    const cap = Math.max(1, Math.floor(120 / largePerCall));
    return Math.min(Math.max(wanted, 1), cap, 50_000);
  };
  let calls = calibratedCalls(probeMs(runSmall, 1), probeMs(runLarge, 1));
  // ONE refinement pass at the estimated batch size: large calls warm shared code, so re-measure small after them.
  // Single batches here keep the whole row ~1.2 s (8 large + 8 small batches dominate), inside vitest's 5 s default.
  const largeProbe = Math.max(batchMs(runLarge, calls), 0.001);
  const smallProbe = Math.max(batchMs(runSmall, calls), 0.001);
  calls = calibratedCalls(smallProbe / calls, largeProbe / calls);
  const largeMs = minBatchMs(runLarge, calls);
  const smallMs = Math.max(minBatchMs(runSmall, calls), 0.05);
  const ratio = largeMs / smallMs;
  return { ratio, smallMs, largeMs, calls, detail: `small ${smallMs.toFixed(2)} ms -> large ${largeMs.toFixed(2)} ms (x${calls}): ${ratio.toFixed(2)}x` };
}
