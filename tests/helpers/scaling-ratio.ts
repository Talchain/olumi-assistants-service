import { it } from 'vitest';
import { performance } from 'node:perf_hooks';

/** false under Required: timing assertions are advisory; behaviour assertions in the same row still gate */
export const timingGated = process.env.CEE_REQUIRED_GATE !== '1';

/** Timing rows are advisory: Required sets CEE_REQUIRED_GATE; the full advisory suite runs them. */
export const timingIt: typeof it.skip = process.env.CEE_REQUIRED_GATE === '1' ? it.skip : it;

/**
 * Growth of a call's cost from a small input to a large one (4× the size): min of 7 batches, the batch size
 * calibrated so the LARGE sample runs >= ~60 ms (the CEE #2763 pattern). Single-call min-of-5 samples of a few ms
 * read 8.2–10.2× against a bar of 8 on CI runners (7 Oct: #2765, #2761, #2748 and others) while the code was linear.
 * Linear ≈ 4×, quadratic ≈ 16×: callers bar the ratio < 8×. Never an absolute millisecond bar.
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
  const oneCall = Math.max(Math.min(batchMs(runLarge, 1), batchMs(runLarge, 1), batchMs(runLarge, 1)), 0.001);
  const calls = Math.min(Math.max(Math.ceil(60 / oneCall), 1), 50_000);
  const largeMs = minBatchMs(runLarge, calls);
  const smallMs = Math.max(minBatchMs(runSmall, calls), 0.05);
  const ratio = largeMs / smallMs;
  return { ratio, smallMs, largeMs, calls, detail: `small ${smallMs.toFixed(2)} ms -> large ${largeMs.toFixed(2)} ms (x${calls}): ${ratio.toFixed(2)}x` };
}
