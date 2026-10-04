import { AsyncLocalStorage } from 'node:async_hooks';

// Bound the entire canonical reread, not just its optional legacy-edit query.
// 5 s, not 1 s: this budget covers SEVERAL sequential database round trips (scenario, hot window, Run history,
// restore marker, edit facts). It exists to stop a read that never settles from stranding a reply, not to police
// ordinary latency: a tighter bound would degrade healthy turns on a slow day (freshness unknown, narration
// withheld), which is a worse user outcome than waiting. Tune from served latency evidence, not from a guess.
export const ANALYSIS_REREAD_TIMEOUT_MS = 5_000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // Promise.race installs rejection handlers even when a dependency settles after timeout.
      readSignal.run(controller.signal, async () => read(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AnalysisReadDeadlineError());
          controller.abort();
        }, ANALYSIS_REREAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Attach the shared cancellation signal only to readers whose client supports it. */
export function abortableAnalysisRead<T>(query: T): T {
  const signal = readSignal.getStore();
  const cancellable = query as T & { abortSignal?: (signal: AbortSignal) => T };
  return signal !== undefined && typeof cancellable.abortSignal === 'function'
    ? cancellable.abortSignal(signal) : query;
}
