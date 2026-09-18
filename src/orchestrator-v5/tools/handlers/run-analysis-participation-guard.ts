/**
 * COLLAB Track A — `run_analysis` participation guard.
 *
 * Honours `node.analysis_participation === 'retained_excluded'` at THE ONE
 * BOUNDARY WHERE PARTICIPATION IS DECIDED: the graph CEE hands to PLoT
 * (`run-analysis.ts`, `plotPayload.graph`). A retained-excluded node stays in
 * `scenarios.graph` with its label, value, identity and authorship intact —
 * it is simply ABSENT from the calculation input.
 *
 * ⭐ THE SHAPE IS THE OPTION PRECEDENT, ONE LEVEL DOWN. `run-analysis.ts`
 * already excludes an unanalysable OPTION by leaving it out of the wire
 * payload, and says why in its own comment: "An excluded option is absent
 * here, which is what makes 'no rank, no probability' true by construction
 * rather than by suppression." A retained-excluded NODE is absent for exactly
 * that reason — the calculation cannot be influenced by something it never
 * received, so the exclusion needs no downstream cooperation to be true.
 *
 * ⛔ ONLY THE EXACT LITERAL `'retained_excluded'` EXCLUDES. Absence is NOT a
 * claim (182,015 persisted nodes carry no field and every one of them must
 * keep participating), `'included'` participates, and an UNRECOGNISED value
 * participates. This is the binding display contract read back at the
 * producer: a surface may render an exclusion claim only on an explicit
 * `'retained_excluded'`, so this guard must ACT on exactly the same predicate
 * the surface may SPEAK on. A guard that excluded on "not 'included'" would
 * silently drop every one of those 182,015 nodes from their owner's analysis.
 *
 * ⚠ EDGES MUST GO WITH THE NODE, AND THIS IS NOT TIDINESS — IT IS MEASURED.
 * PLoT's `/v2/run` preflight (`src/validation/preflight-v2.ts`
 * `validateEdgeEndpoints`) raises `INVALID_EDGE_ENDPOINT` through
 * `createBlocker` for an edge whose `from` or `to` names a node that is not in
 * `graph.nodes`. A BLOCKER, not a warning: dropping a node and leaving its
 * edges would not quietly degrade the analysis, it would REFUSE THE WHOLE RUN.
 * Edges carry no `id` in the contract — identity is the directional
 * `(from, to)` pair — so incidence is the only way to select them.
 *
 * ⛔ THREE EXCLUSIONS ARE REFUSED RATHER THAN HONOURED, because honouring them
 * cannot produce an honest result. Each is measured against what PLoT actually
 * does, not inferred:
 *   · `goal_node` — `goal_node_id` is sent beside the graph and PLoT raises
 *     `GOAL_NODE_NOT_IN_GRAPH` (preflight-v2.ts:128). Excluding the goal is
 *     incoherent anyway: the calculation is ABOUT the goal.
 *   · `option_intervention_target` — PLoT raises "Option '…' references
 *     non-existent node '…'" (preflight-v2.ts:204) for an intervention whose
 *     target left the graph.
 *   · `submitted_option` — the node IS one of the options being compared. PLoT
 *     filters option-kind nodes from the causal graph itself, so this one
 *     would NOT blow up; it would do something worse and rank an option the
 *     user has excluded, silently.
 *
 * ⭐ WHY REFUSE THE RUN RATHER THAN QUIETLY UN-EXCLUDE. Un-excluding computes
 * with something the user removed, while the field still reads
 * `'retained_excluded'` — so the surface renders "excluded" over a number that
 * included it. That is the confident wrongness this estate bans, and it is
 * strictly worse than no number. It is also the house posture in this very
 * handler, which already refuses rather than "show you a result that just
 * means 'it was the only one'". And on a reasoning tool the refusal EARNS its
 * place: "you excluded this factor and an option changes it" is a real
 * inconsistency in the user's own model, and surfacing it is the product's job.
 *
 * This guard REPORTS refusals and never throws on them — the handler owns the
 * user-facing sentence.
 */
import { emit, log, TelemetryEvents } from '../../../utils/telemetry.js';

/** The one literal that excludes. Not exported as a predicate — see the file docblock. */
const RETAINED_EXCLUDED = 'retained_excluded';

export type ParticipationRefusalReason =
  | 'goal_node'
  | 'option_intervention_target'
  | 'submitted_option';

export interface ParticipationRefusal {
  readonly node_id: string;
  readonly reason: ParticipationRefusalReason;
}

export interface AnalysisParticipationGuardResult<T = unknown> {
  /** A deep CLONE with retained-excluded nodes and their incident edges removed. */
  readonly graph: T;
  /** Node ids actually withheld from the calculation, in graph order. */
  readonly excludedNodeIds: readonly string[];
  /** Edges removed because an endpoint left the graph. */
  readonly prunedEdgeCount: number;
  /**
   * Exclusions that CANNOT be honoured without producing a dishonest result.
   * Non-empty ⇒ the caller must refuse the run. The nodes are NOT dropped.
   */
  readonly refusals: readonly ParticipationRefusal[];
}

export interface AnalysisParticipationGuardOpts {
  /** `goal_node_id` as sent to PLoT beside the graph. */
  readonly goalNodeId?: string | null;
  /** Every node id any SUBMITTED option intervenes on. */
  readonly optionInterventionTargetIds?: Iterable<string>;
  /** Ids of the options being compared on this run. */
  readonly submittedOptionIds?: Iterable<string>;
  readonly requestId?: string;
  readonly scenarioId?: string;
}

/** Fixed error-class taxonomy for the redacted fallback diagnostic (mirrors the intercept guard). */
const KNOWN_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'SyntaxError', 'Error']);

function readNodeId(node: unknown): string | null {
  if (node === null || typeof node !== 'object') return null;
  const id = (node as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function isRetainedExcluded(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  // Strict equality against the single literal. Never a negation of 'included'.
  return (node as { analysis_participation?: unknown }).analysis_participation === RETAINED_EXCLUDED;
}

/**
 * Return a deep CLONE of `graph` with every `'retained_excluded'` node — and
 * every edge incident to one — withheld from the calculation. The input graph
 * is never mutated, so `scenarios.graph`, the parsed snapshot and
 * `rawPersistedGraph` (hashed for `graph_hash_at_run` / freshness) are
 * untouched: the node is still there, and still excluded, when the user
 * comes back.
 *
 * Non-blocking on INSTRUMENT failure, exactly like the intercept guard beside
 * it: if the clone throws, the analysis proceeds on the unmodified graph with
 * a warning. Note what that fallback does and does not risk — it can only
 * INCLUDE a node the user excluded, never exclude one they kept, so it cannot
 * silently shrink anybody's model. It is reported through `refusals` as a
 * `goal_node`-free empty list plus a warn log, and the caller's exclusion
 * disclosure is driven by `excludedNodeIds`, which is empty in that case.
 */
export function guardAnalysisParticipation<T = unknown>(
  graph: T,
  opts: AnalysisParticipationGuardOpts = {},
): AnalysisParticipationGuardResult<T> {
  try {
    const nodes = (graph as { nodes?: unknown })?.nodes;
    if (!Array.isArray(nodes)) {
      return { graph, excludedNodeIds: [], prunedEdgeCount: 0, refusals: [] };
    }

    // Cheap pre-pass on the INPUT: if nothing is excluded there is nothing to
    // do, and the overwhelmingly common graph pays only one scan and no clone.
    const anyExcluded = nodes.some((n) => isRetainedExcluded(n));
    if (!anyExcluded) {
      return { graph, excludedNodeIds: [], prunedEdgeCount: 0, refusals: [] };
    }

    const goalNodeId = typeof opts.goalNodeId === 'string' ? opts.goalNodeId : null;
    const interventionTargets = new Set(opts.optionInterventionTargetIds ?? []);
    const submittedOptionIds = new Set(opts.submittedOptionIds ?? []);

    const refusals: ParticipationRefusal[] = [];
    const dropIds = new Set<string>();

    for (const node of nodes) {
      if (!isRetainedExcluded(node)) continue;
      const id = readNodeId(node);
      // A retained-excluded node with no usable id cannot be matched to an
      // edge endpoint, so it cannot be dropped safely. Keep it (fail towards
      // including, never towards silently shrinking the model).
      if (id === null) continue;

      if (goalNodeId !== null && id === goalNodeId) {
        refusals.push({ node_id: id, reason: 'goal_node' });
        continue;
      }
      if (submittedOptionIds.has(id)) {
        refusals.push({ node_id: id, reason: 'submitted_option' });
        continue;
      }
      if (interventionTargets.has(id)) {
        refusals.push({ node_id: id, reason: 'option_intervention_target' });
        continue;
      }
      dropIds.add(id);
    }

    // A refusal means the caller will not run at all, so the clone would be
    // discarded. Return the untouched graph and let the handler speak.
    if (refusals.length > 0) {
      return { graph, excludedNodeIds: [], prunedEdgeCount: 0, refusals };
    }
    if (dropIds.size === 0) {
      return { graph, excludedNodeIds: [], prunedEdgeCount: 0, refusals: [] };
    }

    // JSON round-trip clone — the graph is JSON-serialisable (same basis as
    // the intercept guard beside this one).
    const clone = JSON.parse(JSON.stringify(graph)) as T;
    const cloneRecord = clone as { nodes?: unknown[]; edges?: unknown[] };

    const keptNodes = (cloneRecord.nodes ?? []).filter((n) => {
      const id = readNodeId(n);
      return id === null || !dropIds.has(id);
    });

    let prunedEdgeCount = 0;
    if (Array.isArray(cloneRecord.edges)) {
      const keptEdges = cloneRecord.edges.filter((e) => {
        if (e === null || typeof e !== 'object') return true;
        const { from, to } = e as { from?: unknown; to?: unknown };
        const incident =
          (typeof from === 'string' && dropIds.has(from)) ||
          (typeof to === 'string' && dropIds.has(to));
        if (incident) prunedEdgeCount += 1;
        return !incident;
      });
      cloneRecord.edges = keptEdges;
    }
    cloneRecord.nodes = keptNodes;

    const excludedNodeIds = [...dropIds];
    emit(TelemetryEvents.V5RunAnalysisParticipationGuard, {
      request_id: opts.requestId,
      scenario_id: opts.scenarioId,
      // Redacted: ids + counts only. Never a label, never a magnitude — the
      // excluded node's VALUE is precisely what the user kept and did not
      // want computed, so it must not leak into telemetry either.
      excluded_count: excludedNodeIds.length,
      excluded_node_ids: excludedNodeIds,
      pruned_edge_count: prunedEdgeCount,
    });

    return { graph: clone, excludedNodeIds, prunedEdgeCount, refusals: [] };
  } catch (err) {
    const errorName =
      err instanceof Error
        ? KNOWN_ERROR_NAMES.has(err.name)
          ? err.name
          : 'unknown_error'
        : 'non_error_throw';
    log.warn(
      {
        event: 'v5.run_analysis.participation_guard_failed',
        request_id: opts.requestId,
        scenario_id: opts.scenarioId,
        reason: 'clone_or_partition_failed',
        error_name: errorName,
      },
      '[run-analysis] participation guard failed; analysing the graph unchanged',
    );
    return { graph, excludedNodeIds: [], prunedEdgeCount: 0, refusals: [] };
  }
}
