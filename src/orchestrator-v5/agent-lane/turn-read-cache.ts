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
import type { InternalDispatch } from './runtime/agent-capabilities.js';

export interface TurnReadCache {
  /** The dispatch every reader and tool of the turn uses: graph reads are reused within an epoch; all else ends it. */
  readonly dispatch: InternalDispatch;
  /** Runs an in-process writer (or anything that may write); the epoch advances when it finishes. */
  around<T>(fn: () => Promise<T>): Promise<T>;
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
const copy = (r: Read): Read => ({ ...r, json: structuredClone(r.json) });

export function turnReadCache(inner: InternalDispatch, graphReadPath: string): TurnReadCache {
  let epoch = 0;
  let kept: { read: Read; epoch: number } | undefined;

  const around = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } finally {
      epoch += 1;
    }
  };

  const dispatch: InternalDispatch = async (path, body) => {
    if (path !== graphReadPath) return around(() => inner(path, body));
    // ⛔ A read that must SEE OTHER WRITERS asks for it: `{ fresh: true }` bypasses the kept read (and refreshes it).
    // The epoch only moves for THIS turn's writes, so a model another tab created during a long construction is
    // invisible to a reused read — the construction's own concurrency guard (`build-model.ts`, `stillEmpty`) went
    // blind that way under C1c and would stay blind under the epoch rule. The marker never reaches the route.
    const fresh = isFreshRead(body);
    if (!fresh && kept !== undefined && kept.epoch === epoch) return copy(kept.read);
    const startedAt = epoch;
    const read = await inner(path, fresh ? withoutFresh(body) : body);
    kept = read.status === 200 ? { read: copy(read), epoch: startedAt } : undefined;
    return read;
  };

  return { dispatch, around };
}
