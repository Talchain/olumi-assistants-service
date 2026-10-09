import { performance } from 'node:perf_hooks';

/**
 * Growth of a call's cost: callers use 4× or 8× input steps. Take the min of 7 batches for each input,
 * with the SAME call count calibrated for SMALL >= ~20 ms and LARGE >= ~60 ms. Short small batches
 * let jitter decide the ratio even when the implementation is linear. Calibration has 10% headroom
 * and is bounded to 3 passes / ~1 s; estimated LARGE batch cost is capped at ~500 ms (50,000 calls max).
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
  const calibrationStart = performance.now();
  const probeMs = (run: () => unknown, calls: number): number =>
    Math.max(Math.min(batchMs(run, calls), batchMs(run, calls), batchMs(run, calls)), 0.001);
  const calibratedCalls = (smallPerCall: number, largePerCall: number): number => {
    const wanted = Math.ceil(Math.max(22 / smallPerCall, 66 / largePerCall));
    const cap = Math.max(1, Math.floor(500 / largePerCall));
    return Math.min(Math.max(wanted, 1), cap, 50_000);
  };
  let calls = calibratedCalls(probeMs(runSmall, 1), probeMs(runLarge, 1));
  for (let pass = 0; pass < 3 && performance.now() - calibrationStart < 1_000; pass += 1) {
    const large = probeMs(runLarge, calls);
    // Large calls can warm shared code substantially. Calibrate small AFTER them, using the same
    // warm-up / min-of-7 as the reported sample rather than a still-cold small-call estimate.
    const small = Math.max(minBatchMs(runSmall, calls), 0.001);
    const nextCalls = calibratedCalls(small / calls, large / calls);
    if (nextCalls === calls) break;
    calls = nextCalls;
    if (small >= 22 && large >= 66 && large <= 500) break;
  }
  const largeMs = minBatchMs(runLarge, calls);
  const smallMs = Math.max(minBatchMs(runSmall, calls), 0.05);
  const ratio = largeMs / smallMs;
  return { ratio, smallMs, largeMs, calls, detail: `small ${smallMs.toFixed(2)} ms -> large ${largeMs.toFixed(2)} ms (x${calls}): ${ratio.toFixed(2)}x` };
}
