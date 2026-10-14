import { AsyncLocalStorage } from 'node:async_hooks';

// Bound the entire canonical reread, not just its optional legacy-edit query.
// 5 s, not 1 s: this budget covers SEVERAL sequential database round trips (scenario, hot window, Run history,
// restore marker, edit facts). It exists to stop a read that never settles from stranding a reply, not to police
// ordinary latency: a tighter bound would degrade healthy turns on a slow day (freshness unknown, narration
// withheld), which is a worse user outcome than waiting. Tune from served latency evidence, not from a guess.
export const ANALYSIS_REREAD_TIMEOUT_MS = 5_000;

/**
 * ⭐ THE READS ARE CUT BEFORE THE BUDGET ENDS, so a reader that degrades on its own can still answer inside it (S1, RCA
 * 14 Oct 16:18Z). The in-process graph read runs inside this scope; its own analysis-fact read hung, the route degraded
 * it to "analysis unavailable" and answered 200 with the saved model at 5,039 ms, 39 ms after the outer read had already
 * thrown. That throw failed a turn whose model was saved. Cutting at 4.5 s leaves the reader 0.5 s to deliver its own
 * degraded answer (served: ~85 ms); a read that still does not settle rejects at the unchanged 5 s.
 */
export const ANALYSIS_READ_SETTLE_MS = 500;

export class AnalysisReadDeadlineError extends Error {
  constructor() {
    super('Canonical analysis reread timed out');
    this.name = 'AnalysisReadDeadlineError';
  }
}

// The scope survives in-process graph dispatch; it never wraps a writer.
const readSignal = new AsyncLocalStorage<AbortSignal>();

/** One wall-clock budget for all sibling/sequential reads, including non-cancellable promises. */
export async function withAnalysisReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const existing = readSignal.getStore();
  if (existing !== undefined) return read(existing);
  const controller = new AbortController();
  let cut: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // Promise.race installs rejection handlers even when a dependency settles after timeout.
      // A read that fails because it was cut is a deadline, whatever its own error says.
      readSignal.run(controller.signal, async () => read(controller.signal)).catch((error: unknown) => {
        throw controller.signal.aborted ? new AnalysisReadDeadlineError() : error;
      }),
      new Promise<never>((_resolve, reject) => {
        cut = setTimeout(() => controller.abort(), ANALYSIS_REREAD_TIMEOUT_MS - ANALYSIS_READ_SETTLE_MS);
        timer = setTimeout(() => {
          reject(new AnalysisReadDeadlineError());
          controller.abort();
        }, ANALYSIS_REREAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(cut);
    clearTimeout(timer);
  }
}

/** True once the enclosing reread's deadline has passed: a late result must not populate shared caches. */
export function analysisReadExpired(): boolean {
  return readSignal.getStore()?.aborted === true;
}

/** Attach the shared cancellation signal only to readers whose client supports it. */
export function abortableAnalysisRead<T>(query: T): T {
  const signal = readSignal.getStore();
  const cancellable = query as T & { abortSignal?: (signal: AbortSignal) => T };
  return signal !== undefined && typeof cancellable.abortSignal === 'function'
    ? cancellable.abortSignal(signal) : query;
}
