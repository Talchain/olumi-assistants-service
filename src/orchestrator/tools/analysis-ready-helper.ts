/**
 * Shared analysis_ready computation from graph structure.
 *
 * Single source of truth for computing GraphPatchBlockData.analysis_ready
 * from a GraphV3T. Used by both draft_graph (fallback) and edit_graph
 * (primary) to avoid implementation drift.
 *
 * Lighter than the full pipeline in src/cee/transforms/analysis-ready.ts —
 * checks structural readiness from graph nodes only, not pipeline context.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { GraphPatchBlockData } from "../types.js";
import { log } from "../../utils/telemetry.js";
import { labelMatchesBaseline } from "../../cee/transforms/analysis-ready.js";
import { pickGoalThresholdTrio } from "../../utils/goal-threshold-trio.js";

// ============================================================================
// Types
// ============================================================================

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// ============================================================================
// Intervention Extraction
// ============================================================================

/**
 * Extract a normalised numeric value (0-1 scale) from an intervention entry.
 * Handles both flat numbers and InterventionV3 objects `{ value: number, ... }`.
 * Extracts `.value` (the normalised numeric), NOT `.raw_value`.
 * @internal Exported for testing.
 */
export function extractNumericIntervention(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>).value;
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

/**
 * Merge intervention values from all known locations on an option node.
 *
 * Scope (post-2026-04-08): this helper is used by `computeStructuralReadiness`
 * which is now invoked ONLY by action handlers that compute their own readiness
 * payload from a synthetic graph (e.g. add_option's preview, edit_graph's
 * post-patch readiness). It is NOT used by envelope.ts anymore — the envelope
 * validates handler-produced analysis_ready instead of recomputing it. The
 * three-source merge below exists because each handler builds its synthetic
 * graph slightly differently and writes interventions to a different location.
 * Do not extend this helper for new envelope-time recomputation paths; the
 * canonical rule is "handlers produce analysis_ready, the envelope validates."
 * See: docs/intervention-lifecycle-and-health-audit-2026-04-08.md §6.
 *
 * Sources (in precedence order — first write wins per factor_id):
 * 1. `node.data.interventions` — prompt-taught canonical edit location (wins on conflict)
 * 2. `node["data/interventions/<fac_id>"]` — slash-keyed flat entries from scalar wrapping
 * 3. `node.interventions` — top-level passthrough (fallback only)
 *
 * data.interventions wins over top-level because edit_graph writes to
 * data.interventions per the prompt, while top-level may contain stale
 * values from a prior pipeline run.
 *
 * Fix 1A: the read path consults all three sources unconditionally. Previously
 * Sources 1+2 were gated behind CEE_EDIT_INTERVENTION_ROUTING_ENABLED, which
 * caused add_option (and any other handler that rebuilds a synthetic graph
 * post-mutation) to silently lose existing options' interventions whenever
 * the flag was off and those options happened to carry interventions at
 * `data.interventions` rather than the top-level field. The flag still gates
 * where future writers WRITE slash-keyed entries, but the read side must
 * always consider every known location.
 *
 * @internal Exported for testing.
 */
export function mergeInterventionSources(nodeAny: Record<string, unknown>): Record<string, number> | undefined {
  const merged: Record<string, number> = {};
  let found = false;

  // Source 1 (highest precedence): node.data.interventions — canonical edit location
  const data = nodeAny.data;
  if (data && typeof data === 'object') {
    const dataInterventions = (data as Record<string, unknown>).interventions;
    if (dataInterventions && typeof dataInterventions === 'object') {
      for (const [k, v] of Object.entries(dataInterventions as Record<string, unknown>)) {
        const num = extractNumericIntervention(v);
        if (num !== undefined) {
          merged[k] = num;
          found = true;
          log.info(
            { event: 'analysis_ready.intervention_merged', source: 'data.interventions', factor_id: k },
            `analysis_ready merged intervention from data.interventions: ${k}`,
          );
        }
      }
    }
  }

  // Source 2: flat slash-keyed entries like "data/interventions/fac_1"
  for (const [k, v] of Object.entries(nodeAny)) {
    const match = k.match(/^data\/interventions\/(.+)$/);
    if (!match) continue;
    const facId = match[1];
    if (facId in merged) continue; // data.interventions already set
    const num = extractNumericIntervention(v);
    if (num !== undefined) {
      merged[facId] = num;
      found = true;
      log.info(
        { event: 'analysis_ready.intervention_merged', source: 'slash_keyed', factor_id: facId, field_from: k },
        `analysis_ready merged intervention from slash-keyed entry: ${k}`,
      );
    }
  }

  // Source 3 (lowest precedence): top-level node.interventions — fallback
  if (nodeAny.interventions && typeof nodeAny.interventions === 'object') {
    for (const [k, v] of Object.entries(nodeAny.interventions as Record<string, unknown>)) {
      if (k in merged) continue; // higher-precedence source already set
      const num = extractNumericIntervention(v);
      if (num !== undefined) {
        merged[k] = num;
        found = true;
      }
    }
  }

  return found ? merged : undefined;
}

/**
 * Returns true exactly when `extractNumericIntervention(v)` would return a
 * finite number — bare finite number, or object with a finite numeric
 * `.value`. Mirrors that function's acceptance predicate VERBATIM (same
 * `typeof === 'object'` + `'value' in v` test, no extra array special-casing)
 * so the object-preserving merge below selects the same source and the same
 * factor set as the numeric `mergeInterventionSources`.
 * @internal Exported for testing.
 */
export function hasFiniteInterventionValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>).value;
    return typeof inner === 'number' && Number.isFinite(inner);
  }
  return false;
}

/**
 * Object-preserving sibling of `mergeInterventionSources`.
 *
 * `mergeInterventionSources` collapses each entry to a bare number via
 * `extractNumericIntervention`, discarding `raw_value` / `unit` / `cap` /
 * `value_type`. The CEE → PLoT egress value-scale protection
 * (`plot-intervention-scale.ts`) needs those fields to decide raw vs
 * normalised, so this returns the ORIGINAL intervention entry (object or bare
 * number) per factor_id.
 *
 * Precedence and membership are IDENTICAL to `mergeInterventionSources`: same
 * source order (1 `data.interventions` > 2 slash-keyed > 3 top-level
 * `interventions`), same container guards (`typeof === 'object'`), and the same
 * per-entry acceptance predicate (`hasFiniteInterventionValue`, which mirrors
 * `extractNumericIntervention`). The two therefore produce the SAME key set and
 * pick from the SAME source per factor_id — verified by a parity test. The only
 * difference is the value shape (original entry vs bare number) and the
 * empty-result encoding (`{}` here vs `undefined` there). Keep in sync.
 * Read-only: never mutates the node.
 * @internal Exported for the egress projection + testing.
 */
export function mergeInterventionSourceObjects(
  nodeAny: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  // Source 1 (highest precedence): node.data.interventions
  const data = nodeAny.data;
  if (data && typeof data === 'object') {
    const dataInterventions = (data as Record<string, unknown>).interventions;
    if (dataInterventions && typeof dataInterventions === 'object') {
      for (const [k, v] of Object.entries(dataInterventions as Record<string, unknown>)) {
        if (!(k in merged) && hasFiniteInterventionValue(v)) merged[k] = v;
      }
    }
  }

  // Source 2: flat slash-keyed entries like "data/interventions/fac_1"
  for (const [k, v] of Object.entries(nodeAny)) {
    const match = k.match(/^data\/interventions\/(.+)$/);
    if (!match) continue;
    const facId = match[1];
    if (facId in merged) continue;
    if (hasFiniteInterventionValue(v)) merged[facId] = v;
  }

  // Source 3 (lowest precedence): top-level node.interventions
  if (nodeAny.interventions && typeof nodeAny.interventions === 'object') {
    for (const [k, v] of Object.entries(nodeAny.interventions as Record<string, unknown>)) {
      if (k in merged) continue;
      if (hasFiniteInterventionValue(v)) merged[k] = v;
    }
  }

  return merged;
}

// ============================================================================
// Readiness Computation
// ============================================================================

/**
 * Compute structural analysis readiness from a graph.
 *
 * Returns undefined if no goal node exists (cannot determine readiness).
 *
 * Status logic (mirrors src/cee/transforms/analysis-ready.ts):
 * - "ready": all options have at least one numeric intervention
 * - "needs_user_mapping": some options lack numeric interventions
 * - "needs_user_input": fewer than 2 options
 */
export function computeStructuralReadiness(
  graph: GraphV3T,
): AnalysisReadyPayload | undefined {
  const goalNode = graph.nodes.find((n) => n.kind === 'goal');
  if (!goalNode) return undefined;

  const optionNodes = graph.nodes.filter((n) => n.kind === 'option');

  // Build edge map from options to factors for intervention lookup
  const optionToFactors = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    // Edges from option nodes to factor/goal nodes represent interventions
    const sourceNode = graph.nodes.find((n) => n.id === edge.from);
    if (sourceNode?.kind === 'option') {
      if (!optionToFactors.has(edge.from)) {
        optionToFactors.set(edge.from, new Set());
      }
      optionToFactors.get(edge.from)!.add(edge.to);
    }
  }

  const options: AnalysisReadyPayload['options'] = [];

  for (const opt of optionNodes) {
    const nodeAny = opt as Record<string, unknown>;
    const interventions = mergeInterventionSources(nodeAny);
    const connectedFactors = optionToFactors.get(opt.id) ?? new Set<string>();

    // Option is ready if it has numeric interventions or connected factors
    const hasNumericInterventions = interventions != null
      && Object.keys(interventions).length > 0
      && Object.values(interventions).every((v) => typeof v === 'number');

    let status: string;
    if (hasNumericInterventions) {
      status = 'ready';
    } else if (connectedFactors.size > 0) {
      // Connected but no encoded interventions yet
      status = 'needs_encoding';
    } else {
      status = 'needs_user_mapping';
    }

    options.push({
      option_id: opt.id,
      label: opt.label,
      status,
      interventions: interventions ?? {},
    });
  }

  // === is_baseline detection (CEE-2) ===
  // Mirror the detection logic from buildAnalysisReadyPayload:
  // Priority 1: node-level is_baseline flag from LLM
  // Priority 2: label keyword match via shared BASELINE_KEYWORDS
  // Non-matching options get explicit false (not omitted) so downstream can
  // distinguish "detected as not baseline" from "detection didn't run".
  let baselineIdx: number | null = null;
  for (let i = 0; i < optionNodes.length; i++) {
    if ((optionNodes[i] as Record<string, unknown>).is_baseline === true) {
      baselineIdx = i;
      break;
    }
  }
  if (baselineIdx === null) {
    for (let i = 0; i < options.length; i++) {
      if (labelMatchesBaseline(options[i].label)) {
        baselineIdx = i;
        break;
      }
    }
  }
  for (let i = 0; i < options.length; i++) {
    options[i].is_baseline = i === baselineIdx;
  }

  // Determine overall status
  let payloadStatus: string;
  if (options.length < 2) {
    payloadStatus = 'needs_user_input';
  } else if (options.some((o) => o.status === 'needs_user_mapping')) {
    payloadStatus = 'needs_user_mapping';
  } else if (options.some((o) => o.status === 'needs_encoding')) {
    payloadStatus = 'needs_encoding';
  } else {
    payloadStatus = 'ready';
  }

  return {
    options,
    goal_node_id: goalNode.id,
    status: payloadStatus,
    ...(goalNode.goal_threshold != null && { goal_threshold: goalNode.goal_threshold }),
    // ROADMAP 2.315(a) — the raw target trio, carried verbatim from the goal
    // node's attested mint. ATOMIC (all three or none) via the shared rule, so
    // this mirror cannot drift from the primary builder's.
    ...pickGoalThresholdTrio(goalNode),
  };
}
