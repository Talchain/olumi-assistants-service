/**
 * ⭐ ONE READ OF THE MODEL PER WRITE EPOCH (C6; served `pj-dispatch-2106r-c180f31c-8ef26ec-1654`, #70 5857893554).
 *
 * The graph read (`/assist/v1/scenarios/:id/graph`) costs ~1.1 s of server time, and one journey made 22 of them
 * (24.3 s). An approve made 4 (3.8–4.8 s of a ~6.5 s click), and a Run made 3. Slice C1c (#2097) reused a read
 * only until the turn's FIRST write, so after a commit every read was fresh again, even with nothing written since.
 *
 * Here a read is reused within a WRITE EPOCH. The epoch advances when any other dispatch or in-process writer
 * (`around`) FINISHES, and a kept read is tagged with the epoch at which it STARTED. So a read started after a write
 * has finished is never answered by one started before it: a changed model is never answered from before it
 * changed. That is C1c's guarantee, extended from "no write yet" to "no write since".
 *
 * A reused read is a deep copy, so no caller can alter what another caller is given.
 */
import { copyCanonicalAnalysisViewInput } from '../../routes/canonical-analysis-input-context.js';
import type { InternalDispatch } from './runtime/agent-capabilities.js';
import { withAnalysisReadDeadline } from '../session/analysis-read-deadline.js';

export interface TurnReadCache {
  /** The dispatch every reader and tool of the turn uses: graph reads are reused within an epoch; all else ends it. */
  readonly dispatch: InternalDispatch;
  /** Runs an in-process writer (or anything that may write); the epoch advances when it finishes. */
  around<T>(fn: () => Promise<T>): Promise<T>;
  /** Starts the turn's first graph read now; the first reader of the same epoch joins it (see the implementation). */
  prefetch(): void;
}

type Read = Awaited<ReturnType<InternalDispatch>>;
/** The body marker for a graph read that must not be served from the turn's cache (see `dispatch`). */
export const FRESH_READ = { fresh: true } as const;
const isFreshRead = (body: unknown): boolean =>
  body !== null && typeof body === 'object' && (body as { fresh?: unknown }).fresh === true;
const withoutFresh = (body: unknown): Record<string, unknown> => {
  const { fresh: _fresh, ...rest } = body as Record<string, unknown>;
  return rest;
};
const copy = (r: Read): Read => {
  const json = structuredClone(r.json);
  copyCanonicalAnalysisViewInput(r.json, json);
  return { ...r, json };
};

/**
 * ⭐ PJ-C1 BUILD TURN, LEVER 3 (DL GO #72 5868860230): `readOnlyPaths` are READS the caller names (the version list),
 * so dispatching one does not end the epoch. Measured on 16 served first-pass builds: the construction receipt lookup
 * (`/versions`, `findConstructionVersion`) ended the epoch the route's prefetch had started, so the "never build over a
 * model" check read the graph again, 0.5–0.7 s later, with nothing written in between. A path listed here must write
 * nothing: the version list is a read (`assist.v1.scenario-versions.ts`, LIST, refuses rather than create-on-read).
 */
export function turnReadCache(inner: InternalDispatch, graphReadPath: string, readOnlyPaths: readonly string[] = []): TurnReadCache {
  let epoch = 0;
  let kept: { read: Read; epoch: number } | undefined;
  /** The read `prefetch` started and has not finished yet, with the epoch it started in. */
  let inflight: { promise: Promise<Read>; epoch: number } | undefined;

  const around = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } finally {
      epoch += 1;
    }
  };

  const dispatch: InternalDispatch = async (path, body) => {
    if (readOnlyPaths.includes(path)) return inner(path, body);
    if (path !== graphReadPath) return around(() => inner(path, body));
    return withAnalysisReadDeadline(async (signal) => {
      // ⛔ A read that must SEE OTHER WRITERS asks for it: `{ fresh: true }` bypasses the kept read (and refreshes it).
      // The epoch only moves for THIS turn's writes, so a model another tab created during a long construction is
      // invisible to a reused read — the construction's own concurrency guard (`build-model.ts`, `stillEmpty`) went
      // blind that way under C1c and would stay blind under the epoch rule. The marker never reaches the route.
      const fresh = isFreshRead(body);
      if (!fresh && kept !== undefined && kept.epoch === epoch) return copy(kept.read);
      // The prefetched read of THIS epoch, still in flight: join it rather than read again. A failed one is never the
      // answer — the reader falls through and reads for itself.
      if (!fresh && inflight !== undefined && inflight.epoch === epoch) {
        const joined = await inflight.promise.catch(() => undefined);
        if (joined !== undefined && joined.status === 200) return copy(joined);
      }
      const startedAt = epoch;
      const read = await inner(path, fresh ? withoutFresh(body) : body);
      signal.throwIfAborted(); // A late success must never populate the cache after its deadline.
      kept = read.status === 200 ? { read: copy(read), epoch: startedAt } : undefined;
      return read;
    });
  };

  /**
   * ⭐ PJ-C1 LATENCY (#72 5861769155): start the turn's first graph read NOW, beside the route's own store reads and
   * turn claim, instead of after them (served 84440ff A13: ~560 ms of those, then a 1,011 ms read). It is tagged with
   * the epoch it starts in, so the epoch rule is unchanged: once anything else has been dispatched or written, no
   * reader is given it. Never throws; a second call while a read is kept or in flight does nothing.
   */
  const prefetch = (): void => {
    if (kept !== undefined || inflight !== undefined) return;
    const startedAt = epoch;
    const promise = withAnalysisReadDeadline(() => inner(graphReadPath, {}));
    const entry = { promise, epoch: startedAt };
    inflight = entry;
    promise.then(
      (read) => {
        if (read.status === 200 && kept === undefined) kept = { read: copy(read), epoch: startedAt };
      },
      () => undefined,
    ).finally(() => {
      if (inflight === entry) inflight = undefined;
    });
  };

  return { dispatch, around, prefetch };
}
