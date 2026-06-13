/**
 * Track S 0.13c-1 — `run_analysis` load-time intercept guard.
 *
 * Legacy persisted graphs (drafted before #263 / Track S 0.13a) can carry the
 * duplicate-baseline pattern `intercept === observed_state.value` on observed
 * root nodes. ISL evaluates a non-intervened root as
 * `observed_state.value + intercept`, so such a root is analysed at twice its
 * baseline (the Track S 0.11 audit defect).
 *
 * #263 repairs this on the draft / CEE unified-pipeline path only. The
 * `run_analysis` handler loads `scenarios.graph` raw and forwards it straight
 * to PLoT (no integrity repair on that path), so a legacy scenario that has
 * not been re-drafted since #263 would still be analysed at 2x baseline. This
 * guard closes that gap at analysis time, WITHOUT a data migration:
 *
 *  - It applies the EXACT #263 repair (`repairObservedRootIntercepts`) — same
 *    doctrine, no semantic drift: removes only the nonzero duplicate on
 *    observed roots, preserves non-equal root intercepts, preserves derived
 *    (non-root) intercepts, preserves explicit zero.
 *  - It operates on a deep CLONE. The persisted `scenarios.graph`, the parsed
 *    snapshot graph, and `rawPersistedGraph` (which the handler hashes for
 *    `graph_hash_at_run` / freshness) are all left untouched — only the
 *    in-memory graph PLoT receives is repaired. Persistence and freshness
 *    semantics are unchanged, so this guard does not cause false staleness;
 *    the eventual data migration (Track S 0.13c) remains the durable fix.
 */
import {
  repairObservedRootIntercepts,
  type InterceptPopulationRepair,
} from '../../../cee/transforms/graph-data-integrity.js';
import { emit, log, TelemetryEvents } from '../../../utils/telemetry.js';

export interface RunAnalysisInterceptGuardResult<T = unknown> {
  /** A repaired deep CLONE of the input graph, safe to send to PLoT. */
  readonly graph: T;
  /** Repairs applied to the clone; empty when nothing matched the pattern. */
  readonly repairs: readonly InterceptPopulationRepair[];
}

/**
 * Return a repaired deep CLONE of `graph` for the PLoT payload, stripping any
 * duplicate observed-root intercept via the #263 repair. The input `graph` is
 * never mutated.
 *
 * Observability: `repairObservedRootIntercepts` already emits one redacted
 * per-node `cee.graph_integrity.duplicate_root_intercept_removed` log (node_id
 * only, no magnitudes). This wrapper emits a single registered telemetry event
 * `v5.run_analysis.intercept_guard` (`corrected_count` + node IDs only) so the
 * guard is queryable per scenario. No observed values/magnitudes are emitted.
 *
 * Non-blocking (mirrors the #263 draft-path contract — runGraphDataIntegrityChecks
 * never throws): if the clone or repair throws, the guard degrades to the
 * UNREPAIRED input graph and surfaces a `v5.run_analysis.intercept_guard_failed`
 * warning rather than failing run_analysis. This path is effectively unreachable
 * for persisted graphs — `JSON.stringify` only throws on BigInt/circular, which
 * DB-sourced JSON cannot contain — but keeps the analysis path resilient and
 * consistent with the draft path.
 *
 * Doctrine/residuals (inherited from the reused #263 predicate, identical on the
 * draft path — NOT introduced here): only top-level `node.intercept` vs
 * `node.observed_state.value` is compared (a second `observed_state.intercept`
 * location and the `data.value` alias are not consulted); `external`-category
 * roots are not specially excluded; rootness pins to PLoT's
 * `NON_CAUSAL_SOURCE_KINDS = {option, decision}` by comment only (no CI catches
 * cross-repo drift). See graph-data-integrity.ts for the full doctrine.
 */
export function guardAnalysisGraphIntercepts<T = unknown>(
  graph: T,
  opts: { readonly requestId?: string; readonly scenarioId?: string } = {},
): RunAnalysisInterceptGuardResult<T> {
  try {
    // JSON round-trip clone — the graph is JSON-serialisable (mirrors
    // d1-shared/apply-graph-mutation.ts `cloneGraph`). Guarantees the snapshot
    // graph and `rawPersistedGraph` are untouched.
    const clone = JSON.parse(JSON.stringify(graph)) as T;
    const repairs = repairObservedRootIntercepts(clone, opts.requestId);

    if (repairs.length > 0) {
      // Registered telemetry event (Track S 0.13c-1). Redacted: corrected_count
      // + node IDs only — never observed magnitudes (the before/after values
      // live on the returned repair records, not in telemetry). `emit` also
      // pino-logs and runs the shared sanitizeTelemetryData pass.
      emit(TelemetryEvents.V5RunAnalysisInterceptGuard, {
        request_id: opts.requestId,
        scenario_id: opts.scenarioId,
        corrected_count: repairs.length,
        node_ids: repairs.map((r) => r.node_id),
      });
    }

    return { graph: clone, repairs };
  } catch (err) {
    // Non-blocking fallback: never fail run_analysis because of the guard.
    // Redacted diagnostic — fixed `reason` + error CLASS only. Never log
    // `err.message`: it is arbitrary free text that could carry parser
    // positions, property paths, or (in future repair/clone errors) values,
    // which would violate the lane's "no values or magnitudes in diagnostics"
    // rule. `error_name` is a fixed error-class taxonomy (e.g. "TypeError").
    log.warn(
      {
        event: 'v5.run_analysis.intercept_guard_failed',
        request_id: opts.requestId,
        scenario_id: opts.scenarioId,
        reason: 'clone_or_repair_failed',
        error_name: err instanceof Error ? err.name : 'non_error_throw',
      },
      '[run-analysis] intercept guard failed; analysing the unrepaired graph',
    );
    return { graph, repairs: [] };
  }
}
