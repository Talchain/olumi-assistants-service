/**
 * ⛔ EVERY SUPABASE REQUEST IS BOUNDED (served 14 Oct: a Run held 139 s at 14:19Z, and Paul's 16:18Z draft failed).
 *
 * Both had one signature: CEE's request never reached Supabase. There is no edge-log entry for it, while the same query
 * for other scenarios answered in ~150 ms. The request stalled on CEE's side until the socket gave up (109.8 s), on a
 * pooled connection that was already dead. Nothing bounded it.
 *
 * This is the `global.fetch` of every CEE Supabase client:
 *  - a per-request timeout well above the database's own statement timeout (`authenticator` 8 s), so a real query is
 *    never cut;
 *  - a READ (GET/HEAD) that times out or fails on the network is retried ONCE, on a fresh connection;
 *  - a WRITE (POST/PATCH/PUT/DELETE, every RPC) is NEVER retried. A timeout or network failure there may or may not have
 *    reached the database, so it is `SupabaseOutcomeUnknownError`: never "failed", never "saved". postgrest-js returns
 *    it as `error.message` "SupabaseOutcomeUnknownError: …" with `status: 0`;
 *  - one log line per stall, `supabase.fetch_stalled {method, target, ms, retried, reason}`, so stalls can be counted;
 *  - a caller's own abort (the analysis-read deadline) is the caller's, and passes through untouched.
 */
import { Agent } from 'undici';
import { log } from './telemetry.js';

export const SUPABASE_READ_TIMEOUT_MS = 20_000;
export const SUPABASE_WRITE_TIMEOUT_MS = 30_000;

/** A write whose request stalled or failed in flight: it may or may not have reached the database. */
export class SupabaseOutcomeUnknownError extends Error {
  readonly outcome = 'unknown' as const;
  constructor(readonly method: string, readonly target: string, cause: unknown) {
    super(`${method} ${target}: the request did not complete, so whether it was applied is unknown`, { cause });
    this.name = 'SupabaseOutcomeUnknownError';
  }
}

class SupabaseRequestTimeoutError extends Error {
  constructor(ms: number) {
    super(`no response within ${ms} ms`);
    this.name = 'SupabaseRequestTimeoutError';
  }
}

type Fetch = typeof fetch;
const READS = new Set(['GET', 'HEAD']);

/** "rest:v5_handler_facts" / "rpc:append_turn": the table or function, never the query string (no scenario ids). */
function targetOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const rpc = /\/rest\/v1\/rpc\/([^/]+)/.exec(path);
    if (rpc !== null) return `rpc:${rpc[1]}`;
    const table = /\/rest\/v1\/([^/]+)/.exec(path);
    return table !== null ? `rest:${table[1]}` : path.split('/').slice(0, 3).join('/');
  } catch {
    return 'unknown';
  }
}

/**
 * The wrapper. `inner` is the fetch to bound (the global fetch in production; a stub in tests). `freshInner` makes the ONE
 * retry: by default a fetch on a new connection pool, so a dead pooled socket cannot answer the retry too.
 */
export function boundedSupabaseFetch(
  // The global fetch at CALL time, never captured at client construction (a stubbed global stays the one called).
  inner: Fetch = (input, init) => globalThis.fetch(input, init),
  freshInner: () => Fetch = freshConnectionFetch,
): Fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const read = READS.has(method);
    const timeoutMs = read ? SUPABASE_READ_TIMEOUT_MS : SUPABASE_WRITE_TIMEOUT_MS;
    const callerSignal = init?.signal ?? undefined;

    const attempt = async (via: Fetch): Promise<Response> => {
      const timer = new AbortController();
      const handle = setTimeout(() => timer.abort(new SupabaseRequestTimeoutError(timeoutMs)), timeoutMs);
      const signal = callerSignal === undefined ? timer.signal : AbortSignal.any([callerSignal, timer.signal]);
      // Raced, not only signalled: a stuck socket need not honour the abort, and the stall must still end here.
      let onAbort: (() => void) | undefined;
      const ended = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(callerSignal?.aborted === true ? callerSignal.reason : timer.signal.reason);
        if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        return await Promise.race([via(input, { ...init, signal }), ended]);
      } catch (err) {
        // Our own timeout surfaces as its reason, whatever the fetch implementation threw.
        throw timer.signal.aborted && callerSignal?.aborted !== true ? timer.signal.reason : err;
      } finally {
        clearTimeout(handle);
        if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
      }
    };

    const started = Date.now();
    try {
      return await attempt(inner);
    } catch (err) {
      // The caller's own deadline is not a stall: theirs to handle, never retried.
      if (callerSignal?.aborted === true) throw err;
      const reason = err instanceof SupabaseRequestTimeoutError ? 'timeout' : 'network';
      const target = targetOf(url);
      log.warn({ event: 'supabase.fetch_stalled', method, target, ms: Date.now() - started, retried: read, reason },
        'supabase: a request stalled or failed in flight');
      if (!read) throw new SupabaseOutcomeUnknownError(method, target, err);
      return attempt(freshInner());
    }
  };
}

/** A fetch on its own connection pool, closed once it has been idle for a minute (the retry is rare). */
function freshConnectionFetch(): Fetch {
  const agent = new Agent({ keepAliveTimeout: 1_000 });
  setTimeout(() => { void agent.close().catch(() => undefined); }, 60_000).unref();
  return ((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => globalThis.fetch(input, onAgent(init, agent))) as Fetch;
}

/**
 * The request's own options, on `agent`. Node's fetch reads `dispatcher` from them; the DOM type does not name it, and the
 * userland undici `Agent` is not the bundled type, so it is set as a property, never cast in.
 */
function onAgent(init: Parameters<Fetch>[1], agent: Agent): Parameters<Fetch>[1] {
  const options: NonNullable<Parameters<Fetch>[1]> = { ...init };
  Reflect.set(options, 'dispatcher', agent);
  return options;
}
