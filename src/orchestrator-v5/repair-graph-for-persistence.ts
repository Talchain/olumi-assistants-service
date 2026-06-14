/**
 * Track S 0.13c-4 — persist-site intercept repair.
 *
 * Closes the non-draft reintroduction path found by the 0.13c-3 audit. After the
 * 0.13c-2 migration cleaned persisted `scenarios.graph`, non-draft persist paths
 * (`set_factor_value`, `edit_graph`, proposal/apply) can still re-introduce the
 * duplicate observed-root pattern `intercept === observed_state.value`, because
 * they do NOT run the #263 repair before persistence — only the draft boundary
 * (`cee/unified-pipeline/stages/boundary.ts`) and the run_analysis in-memory guard
 * do. This applies the SAME #263 predicate (`repairObservedRootIntercepts`) to a
 * CLONE of the graph immediately before it is written to `scenarios.graph`, at the
 * single commit chokepoint (`commitDirectAnswer` → `store.append`).
 *
 * Post-edit normalisation rule (deliberate — Track S 0.13c-4): a node previously
 * classified as ambiguous (a no-baseline root or a non-equal root) that an edit
 * turns into an EXACT duplicate observed-root (`intercept === observed_state.value`,
 * nonzero, within epsilon) IS normalised here — its `intercept` is removed at
 * persistence. This does NOT retroactively strip the preserved 76 ambiguous nodes;
 * it only normalises a newly-created exact duplicate at persist time. Flagged for
 * the Neil/Jinghui Monday sanity-check.
 *
 * Doctrine preserved (reuses the #263/#269 predicate — no duplication): removes
 * only nonzero observed-root intercepts within epsilon of `observed_state.value`;
 * preserves explicit zero, no-baseline roots, non-equal roots, derived/non-root,
 * and constraint-derived nodes; never assigns `intercept`.
 *
 * Safety:
 *  - No-op when there is no graph to persist (undefined/null) → returns the input
 *    unchanged (system events, chip clicks, non-graph turns write no graph).
 *  - Clean graphs are returned UNCHANGED (the original reference, no clone) so a
 *    no-duplicate write is byte-identical to before this change.
 *  - Non-blocking: never fails a commit. A clone failure persists the unrepaired
 *    graph; a repair-step throw persists the never-dirtier clone (the repair only
 *    ever deletes duplicate intercepts) — observability can never discard a repair.
 *    Both emit a redacted warning (no values, no graph content).
 */
import { repairObservedRootIntercepts } from '../cee/transforms/graph-data-integrity.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';

/** Fixed error-class taxonomy for the redacted fallback diagnostic (0.13c-1 doctrine). */
const KNOWN_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'SyntaxError', 'Error']);

/** Redacted error class — never the message (which could carry values/paths). */
function errorClass(err: unknown): string {
  return err instanceof Error
    ? (KNOWN_ERROR_NAMES.has(err.name) ? err.name : 'unknown_error')
    : 'non_error_throw';
}

/** Best-effort redacted warn that itself never throws — observability must never affect the flow. */
function safeWarn(payload: Record<string, unknown>, msg: string): void {
  try {
    log.warn(payload, msg);
  } catch {
    /* observability is best-effort; never throw from a diagnostic */
  }
}

export interface PersistRepairContext {
  readonly scenarioId?: string;
  /** Per-turn correlation id (turn_id doubles as request_id in V5). */
  readonly turnId?: string;
  readonly turnClass?: string;
  /** Originating handler id (e.g. set_factor_value, edit_graph) — non-sensitive. */
  readonly source?: string;
}

/**
 * Return the graph to persist to `scenarios.graph`: a repaired CLONE when a graph
 * is present and a duplicate observed-root intercept was found, otherwise the
 * original reference unchanged. Reuses the #263 `repairObservedRootIntercepts`
 * predicate — the predicate is never re-implemented here.
 *
 * Repair success is DECOUPLED from telemetry: once a duplicate is removed, the
 * repaired clone is returned even if the summary telemetry/logging throws. An
 * observability failure must never cause a known-dirty graph to be persisted. This
 * holds structurally: clone and repair are separated, so a repair-step throw (today
 * only reachable via the predicate's own internal log) returns the never-dirtier
 * clone, and only a clone failure (unreachable for DB-JSON graphs) falls back to the
 * unrepaired graph.
 */
export function repairGraphForPersistence<T>(graph: T, ctx: PersistRepairContext = {}): T {
  // Graph-absent no-op: nothing to persist/repair.
  if (graph === undefined || graph === null) return graph;

  // 1. Clone. Only a clone failure leaves us with no repaired artifact, so only then
  //    do we fall back to the original graph. (Unreachable for DB-JSON — JSON.stringify
  //    throws only on BigInt/circular, neither of which occurs in a persisted graph.)
  let clone: T;
  try {
    clone = JSON.parse(JSON.stringify(graph)) as T;
  } catch (err) {
    safeWarn(
      {
        event: 'v5.graph_persist.intercept_repair_failed',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        reason: 'clone_failed',
        error_name: errorClass(err),
      },
      '[commit] persist-site intercept repair could not clone the graph; persisting the unrepaired graph',
    );
    return graph;
  }

  // 2. Repair the CLONE in place. `repairObservedRootIntercepts` only ever DELETES
  //    duplicate observed-root intercepts (never adds/changes a value) and mutates a
  //    node BEFORE its own redacted per-node logging. So even if it throws (today only
  //    reachable via that internal log, which the stock pino logger does not do), the
  //    clone is at-least-as-repaired as the original and NEVER dirtier — persist the
  //    clone, never the unrepaired original. This makes "observability never discards a
  //    repair" structural, not contingent on the logger being non-throwing.
  let repairs: ReturnType<typeof repairObservedRootIntercepts>;
  try {
    repairs = repairObservedRootIntercepts(clone, ctx.turnId);
  } catch (err) {
    safeWarn(
      {
        event: 'v5.graph_persist.intercept_repair_failed',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        reason: 'repair_failed',
        error_name: errorClass(err),
      },
      '[commit] persist-site intercept repair threw after cloning; persisting the never-dirtier clone',
    );
    return clone; // never dirtier than the original; never the unrepaired graph
  }

  if (repairs.length === 0) return graph; // clean → persist the original reference, unchanged

  // Repair SUCCEEDED. Telemetry is best-effort and MUST NOT discard the repair — emit
  // in its own guard so an observability failure cannot persist the dirty graph.
  // Redacted: IDs + counts only; never observed values/magnitudes or graph content.
  // (`repairObservedRootIntercepts` also logs one redacted per-node event, node_id only.)
  try {
    emit(TelemetryEvents.V5GraphPersistInterceptRepair, {
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      ...(ctx.turnClass !== undefined ? { turn_class: ctx.turnClass } : {}),
      ...(ctx.source !== undefined && ctx.source !== null ? { source: ctx.source } : {}),
      corrected_count: repairs.length,
      node_ids: repairs.map((r) => r.node_id),
    });
  } catch (emitErr) {
    safeWarn(
      {
        event: 'v5.graph_persist.intercept_repair_telemetry_failed',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        reason: 'telemetry_emit_failed',
        error_name: errorClass(emitErr),
      },
      '[commit] persist-site intercept repair telemetry failed; the graph WAS repaired',
    );
  }
  return clone; // ALWAYS the repaired clone once repairs > 0
}
