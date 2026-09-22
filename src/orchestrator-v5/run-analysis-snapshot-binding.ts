/**
 * ⭐⭐⭐ ONE TURN, ONE PERSISTED SNAPSHOT — the per-turn binding.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A `run_analysis` turn reads `scenarios.graph` TWICE and nothing joins the two
 * reads — no snapshot, no version pin, no row lock, and the store is explicitly
 * uncached:
 *
 *   read A  `build-turn-context.ts` → `loadPersistedScenarioStateStrict`
 *           → feeds the turn's FRESHNESS verdict.
 *   read B  `tools/registry.ts` `DEFAULT_SCENARIO_READER`
 *           → `loadScenarioSnapshotForRunAnalysis` → the SAME strict read again
 *           → stamps `graph_hash_at_run` on the run_analysis fact.
 *
 * A write landing between A and B makes the turn's freshness verdict and the
 * fact it just stamped describe DIFFERENT persisted states, silently. SDL
 * reproduced it executably (`run-analysis-single-snapshot.test.ts`): freshness
 * hash `08efc1d8…`, fact hash `038423e3…`, no refusal. Re-executed here at
 * staging `9b98fcd0` — i.e. AFTER #1660 merged — with the same two hashes, so
 * #1660 does not close it. That corroborates by execution what the Core lane
 * had measured by file list.
 *
 * ── WHY A CONTEXT AND NOT A PARAMETER ─────────────────────────────────────
 * `ScenarioReader` is `(scenarioId, signal?) => Promise<…>`; the handler invokes
 * it with the abort signal alone, and production resolves a PROCESS-MEMOISED
 * registry (`getDefaultRegistry()`). There is no per-turn argument seam between
 * the turn and the reader, so an `expectedGraphHash` parameter on the loader
 * would be a guard with no producer — it could never fire. This estate has paid
 * for that shape twice, so it is not repeated here.
 *
 * AsyncLocalStorage is the seam that already exists for exactly this problem in
 * this codebase: the turn fence binds a slot in a Fastify hook and reads it ~50s
 * and many frames later at the commit chokepoint
 * (`orchestrator/turn-fence-prehandler.ts`). Same shape, same reason.
 *
 * ⚠ THE REFUSAL IS THE CONSERVATIVE HALF OF THE CHOICE. The banked test admits
 *   two fixes — reuse read A's graph, or refuse — and rejects only the third
 *   outcome, stamping a fact against a graph the turn never saw. REUSING read A
 *   would change WHAT GETS ANALYSED (a ~30s-old graph), which is a semantic
 *   change to the product. Refusing changes only availability on a genuinely
 *   concurrent write, leaves every non-racing turn byte-identical, and the next
 *   turn re-reads both sides cleanly. Availability is the cheaper thing to
 *   spend, so this refuses.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { computeAnalysisAffectingGraphHash } from './context/graph-hash.js';

/** What the turn's freshness verdict was derived from, for this turn only. */
export interface BoundAnalysisSnapshot {
  readonly scenarioId: string;
  /**
   * `computeAnalysisAffectingGraphHash` of read A's graph; `null` when the
   * scenario has no graph; `NO_CLAIM` when the graph exists but cannot be
   * hashed, which stands the guard down (see {@link analysisGraphIdentityOf}).
   */
  readonly analysisGraphHash: string | null | typeof NO_CLAIM;
}

const storage = new AsyncLocalStorage<BoundAnalysisSnapshot>();

/**
 * Run `fn` with this turn's read-A identity bound. Callback style is NOT
 * load-bearing here the way it is in the fence hook — this wraps an awaited
 * call rather than a Fastify `done()` — but the store still only covers the
 * async context `fn` creates, which is the whole dispatch.
 */
export function runWithBoundAnalysisSnapshot<T>(
  snapshot: BoundAnalysisSnapshot,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(snapshot, fn);
}

/**
 * ⭐ THE ONE TOTAL DERIVATION BOTH SIDES USE, and the reason it exists.
 *
 * `computeAnalysisAffectingGraphHash` THROWS on a persisted graph it cannot
 * project — measured, not assumed: an unguarded call in `runTurnExecutor`
 * turned five green suites red with `TypeError: nodes.map is not a function`,
 * on legacy/unparseable graphs the product deliberately keeps serving as
 * `freshness: unknown`.
 *
 * ⚠ `NO_CLAIM` IS NOT `null`, AND CONFLATING THEM WOULD BE THE DEFECT AGAIN.
 *   `null` means "this scenario has no graph", a fact two reads can agree on.
 *   `NO_CLAIM` means "this graph cannot be hashed", about which nothing can be
 *   compared — so the guard stands down rather than inventing an agreement or a
 *   divergence. A graph that is unhashable on BOTH reads must not refuse, and
 *   one that became unhashable must not silently pass as `null === null`.
 */
export const NO_CLAIM = Symbol('analysis-graph-hash-underivable');

/**
 * ⭐ THE BIND-SITE DERIVATION — graph PLUS the state of the read that produced it.
 *
 * ⛔ WHY THE GRAPH ALONE IS NOT ENOUGH. `context.persistedGraph` is `null` in
 *    THREE situations, and only one of them is "this scenario has no graph":
 *      · the store was unavailable   (`build-turn-context.ts:1840-1846`, degraded)
 *      · the read threw and was caught (`:1873-1879`, degraded)
 *      · a genuine absence            (ok_absent)
 *
 *    Read B does NOT swallow — `loadPersistedScenarioStateStrict` either throws
 *    or returns the real graph. So arming this guard with `null` after a
 *    DEGRADED read A makes a transient blip look exactly like a concurrent
 *    write: `observed = <real hash>` against `expected = null`, and the turn is
 *    refused although nothing raced.
 *
 *    That is the conflation this module's own header forbids, and the estate
 *    already paid to remove it once — `build-turn-context.ts:104-117` records
 *    the removal and the discriminator it introduced (`persistedGraphRead`).
 *
 * ⚠ THE ERROR DIRECTION IS ONE-WAY, DELIBERATELY. A degraded read stands the
 *   guard DOWN, so this can only ever refuse FEWER turns. It cannot mask a real
 *   divergence: a real divergence requires read A to have SUCCEEDED and produced
 *   a hash for read B to disagree with.
 */
export function analysisGraphIdentityForRead(
  graph: unknown,
  read: { readonly status: string } | undefined,
): string | null | typeof NO_CLAIM {
  if (read !== undefined && read.status === 'degraded') return NO_CLAIM;
  return analysisGraphIdentityOf(graph);
}

export function analysisGraphIdentityOf(graph: unknown): string | null | typeof NO_CLAIM {
  if (graph == null) return null;
  try {
    return computeAnalysisAffectingGraphHash(graph as never) ?? NO_CLAIM;
  } catch {
    return NO_CLAIM;
  }
}

/**
 * Bind for the REST of the current async context — the turn — rather than
 * around a callback.
 *
 * `runTurnExecutor` is a ~17,000-line function whose run_analysis dispatch is
 * many frames down and reached from more than one branch. Wrapping its body in
 * a callback would mean re-indenting the whole function: a diff nobody could
 * review for the behaviour change it actually contains, which is the same
 * argument `turn-fence-prehandler.ts` makes for its own hook placement.
 * `enterWith` sets the store for this execution context and every child of it,
 * which is exactly the turn, and it is one line at the point the turn's read A
 * becomes known.
 */
export function bindAnalysisSnapshotForTurn(snapshot: BoundAnalysisSnapshot): void {
  storage.enterWith(snapshot);
}

/**
 * The bound snapshot, or `undefined` outside a turn. `undefined` means NO
 * CLAIM — callers must not treat it as "the graph is unchanged". Every path
 * that is not a turn (a test double, a script, a future ingress) therefore
 * keeps today's behaviour exactly.
 */
export function currentBoundAnalysisSnapshot(): BoundAnalysisSnapshot | undefined {
  return storage.getStore();
}

/**
 * The turn's persisted graph moved between the freshness read and the
 * run-analysis read. Retryable: the next turn re-derives both sides from one
 * state, so the honest answer is "ask again", never a fact stamped against a
 * graph this turn never saw.
 */
export class AnalysisSnapshotDivergedError extends Error {
  readonly scenarioId: string;
  readonly expectedGraphHash: string | null;
  readonly observedGraphHash: string | null;

  constructor(args: {
    scenarioId: string;
    expectedGraphHash: string | null;
    observedGraphHash: string | null;
  }) {
    super(
      `The model changed while this analysis was being prepared (scenario ${args.scenarioId}): ` +
        `the turn's freshness verdict was derived from ${args.expectedGraphHash ?? 'no graph'} ` +
        `but the analysis read ${args.observedGraphHash ?? 'no graph'}.`,
    );
    this.name = 'AnalysisSnapshotDivergedError';
    this.scenarioId = args.scenarioId;
    this.expectedGraphHash = args.expectedGraphHash;
    this.observedGraphHash = args.observedGraphHash;
  }
}
