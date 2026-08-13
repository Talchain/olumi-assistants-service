/**
 * Deterministic Pre-Repair Sweep
 *
 * Runs as substep 1 (before orchestrator validation) and before PLoT
 * validation (substep 2). Resolves mechanical violations deterministically, handles
 * unreachable factors, and fixes status quo connectivity.
 *
 * Violation routing:
 * - Bucket A: Always auto-fix (NAN_VALUE, SIGN_MISMATCH, STRUCTURAL_EDGE_NOT_CANONICAL_ERROR, etc.)
 * - Bucket B: Fix only when specific violation is cited (CATEGORY_MISMATCH, data completeness)
 * - Bucket C: Semantic, LLM-only (NO_PATH_TO_GOAL, CYCLE_DETECTED, etc.)
 */

import type { StageContext } from "../../types.js";
import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import { isDirectedEdge } from "../../../../schemas/graph.js";
import type { ValidationIssue } from "../../../../validators/graph-validator.types.js";
import { fuzzyMatchNodeId } from "../../../../validators/structural-reconciliation.js";
import { NAN_FIX_SIGNATURE_STD } from "../../../constants.js";
import { validateGraph as validateGraphDeterministic } from "../../../../validators/graph-validator.js";
import { sweepNodePath, pathsNameNode } from "../../../../validators/violation-paths.js";
import { detectEdgeFormat, canonicalStructuralEdge, patchEdgeNumeric } from "../../utils/edge-format.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { handleUnreachableFactors } from "./unreachable-factors.js";
import { fixStatusQuoConnectivity, findDisconnectedOptions } from "./status-quo-fix.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../../constants/versions.js";
import { log } from "../../../../utils/telemetry.js";
import { sha8 } from "../../../../utils/logger-config.js";
import { config } from "../../../../config/index.js";
import { DEFAULT_EXISTS_PROBABILITY } from "@talchain/schemas";
import { fieldDeletion, recordFieldDeletions, type FieldDeletionEvent } from "../../utils/field-deletion-audit.js";
import { BUCKET_C_CODES } from "./bucket-c-codes.js";

// ---------------------------------------------------------------------------
// Bucket classification (SSOT)
// ---------------------------------------------------------------------------

/** Bucket A: always auto-fix before LLM */
const BUCKET_A_CODES = new Set([
  "NAN_VALUE",
  "SIGN_MISMATCH",
  "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
  "INVALID_EDGE_REF",
  "GOAL_HAS_OUTGOING",
  "DECISION_HAS_INCOMING",
  "NODE_LIMIT_EXCEEDED",   // Unfixable here; passes through for upstream handling
  "EDGE_LIMIT_EXCEEDED",   // Unfixable here; passes through for upstream handling
  "CYCLE_DETECTED",        // Deterministic: remove weakest back-edge iteratively
]);

/** Bucket B: deterministic, only when specific violation is cited */
const BUCKET_B_CODES = new Set([
  "CATEGORY_MISMATCH",
  "CONTROLLABLE_MISSING_DATA",
  "OBSERVABLE_MISSING_DATA",
  "OBSERVABLE_EXTRA_DATA",
  "EXTERNAL_HAS_DATA",
  "INVALID_INTERVENTION_REF",  // Fuzzy-match intervention keys against factor node IDs
]);

/**
 * Bucket C: semantic, LLM only — we identify these to decide llmRepairNeeded.
 *
 * Declared in `./bucket-c-codes.js`, the single authority, and re-exported here
 * so existing `deterministic-sweep.js` importers keep working. ⚠ An importer
 * that reads it from THIS module inherits this module's mock exposure: two
 * wiring specs replace deterministic-sweep wholesale with a `vi.mock` factory,
 * and the binding is absent under them. Import from `./bucket-c-codes.js`
 * instead — that module has no behaviour and nothing to mock.
 */
export { BUCKET_C_CODES } from "./bucket-c-codes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Repair {
  code: string;
  path: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Bucket A fixes
// ---------------------------------------------------------------------------

export function fixNanValues(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const nanViolations = violations.filter((v) => v.code === "NAN_VALUE");
  if (nanViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Fix NaN in edges
  for (const edge of edges) {
    if (edge.strength_mean !== undefined && (Number.isNaN(edge.strength_mean) || !Number.isFinite(edge.strength_mean))) {
      const old = edge.strength_mean;
      edge.strength_mean = 0.5;
      repairs.push({ code: "NAN_VALUE", path: `edges[${edge.from}→${edge.to}].strength_mean`, action: `Replaced ${old} with 0.5` });
    }
    if (edge.strength_std !== undefined && (Number.isNaN(edge.strength_std) || !Number.isFinite(edge.strength_std))) {
      const old = edge.strength_std;
      edge.strength_std = NAN_FIX_SIGNATURE_STD;
      repairs.push({ code: "NAN_VALUE", path: `edges[${edge.from}→${edge.to}].strength_std`, action: `Replaced ${old} with ${NAN_FIX_SIGNATURE_STD}` });
    }
    if (edge.belief_exists !== undefined && (Number.isNaN(edge.belief_exists) || !Number.isFinite(edge.belief_exists))) {
      const old = edge.belief_exists;
      edge.belief_exists = DEFAULT_EXISTS_PROBABILITY;
      repairs.push({ code: "NAN_VALUE", path: `edges[${edge.from}→${edge.to}].belief_exists`, action: `Replaced ${old} with ${DEFAULT_EXISTS_PROBABILITY}` });
    }
  }

  // Fix NaN in factor node data
  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    const data = (node as any).data;
    if (data && typeof data.value === "number" && (Number.isNaN(data.value) || !Number.isFinite(data.value))) {
      const old = data.value;
      data.value = 0.5;
      repairs.push({ code: "NAN_VALUE", path: `nodes[${node.id}].data.value`, action: `Replaced ${old} with 0.5` });
    }
  }

  return repairs;
}

function fixSignMismatch(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const signViolations = violations.filter((v) => v.code === "SIGN_MISMATCH");
  if (signViolations.length === 0) return repairs;

  const edges = (graph as any).edges as EdgeT[];

  // Fix all edges that have actual sign mismatches (direction contradicts mean sign)
  for (const edge of edges) {
    if (!edge.effect_direction || edge.strength_mean === undefined) continue;

    const isNegativeDirection = edge.effect_direction === "negative";
    const isMeanPositive = edge.strength_mean > 0;
    const isMeanNegative = edge.strength_mean < 0;

    if ((isNegativeDirection && isMeanPositive) || (!isNegativeDirection && isMeanNegative)) {
      const old = edge.strength_mean;
      edge.strength_mean = -edge.strength_mean;
      repairs.push({
        code: "SIGN_MISMATCH",
        path: `edges[${edge.from}→${edge.to}].strength_mean`,
        action: `Flipped mean from ${old} to ${edge.strength_mean} to match effect_direction="${edge.effect_direction}"`,
      });
    }
  }

  return repairs;
}

function fixStructuralEdgesNotCanonical(
  graph: GraphT,
  violations: ValidationIssue[],
  format: EdgeFormat,
): Repair[] {
  const repairs: Repair[] = [];
  const canonViolations = violations.filter((v) => v.code === "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
  // Note: don't early-return when canonViolations is empty — decision→option
  // edges are fixed proactively (not gated by violations).

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    // Fix both option→factor (Bucket A violation-driven) and decision→option (proactive)
    const isOptionFactor = fromKind === "option" && toKind === "factor";
    const isDecisionOption = fromKind === "decision" && toKind === "option";
    if (!isOptionFactor && !isDecisionOption) continue;

    // Only canonicalise if not already canonical (format-aware check).
    // MUST include effect_direction: the validator's canonical tuple
    // (graph-validator.ts STRUCTURAL_EDGE_NOT_CANONICAL_ERROR) requires
    // direction === "positive" in addition to the numerics. A numerics-only
    // pre-check skipped edges with canonical numerics but missing/negative
    // direction, so the violation survived the sweep and post-enforcement
    // re-validation failed the request closed (CEE_GRAPH_INVALID → 422).
    const isCanonical = format === "LEGACY"
      ? (edge as Record<string, unknown>).weight === 1 && (edge as Record<string, unknown>).belief === 1
        && edge.effect_direction === "positive"
      : edge.strength_mean === 1 && edge.strength_std === 0.01 && edge.belief_exists === 1
        && edge.effect_direction === "positive";

    if (!isCanonical) {
      // decision→option: always fix proactively (LLMs frequently produce probability splits)
      // option→factor: only fix when cited by a validation violation
      const shouldFix = isDecisionOption || canonViolations.some((v) =>
        v.path && (
          v.path.includes(edge.from) ||
          v.path.includes(edge.to) ||
          (edge.id && v.path.includes(edge.id)) ||
          v.path.includes(`edges[${i}]`)
        ),
      );

      if (shouldFix) {
        edges[i] = canonicalStructuralEdge(edge, format);
        repairs.push({
          code: "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Canonicalised structural ${fromKind}→${toKind} edge to mean=1, std=0.01, existence=1.0`,
        });
      }
    }
  }

  return repairs;
}

function fixInvalidEdgeRefs(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const refViolations = violations.filter((v) => v.code === "INVALID_EDGE_REF");
  if (refViolations.length === 0) return repairs;

  const nodeIds = new Set<string>(((graph as any).nodes as NodeT[]).map((n) => n.id));
  const edges = (graph as any).edges as EdgeT[];

  const validEdges: EdgeT[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      repairs.push({
        code: "INVALID_EDGE_REF",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Removed edge referencing non-existent node(s)`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  (graph as any).edges = validEdges;
  return repairs;
}

function fixGoalHasOutgoing(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const goalViolations = violations.filter((v) => v.code === "GOAL_HAS_OUTGOING");
  if (goalViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const goalIds = new Set(nodes.filter((n) => n.kind === "goal").map((n) => n.id));
  const edges = (graph as any).edges as EdgeT[];

  const validEdges: EdgeT[] = [];
  for (const edge of edges) {
    if (goalIds.has(edge.from)) {
      repairs.push({
        code: "GOAL_HAS_OUTGOING",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Removed outgoing edge from goal node`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  (graph as any).edges = validEdges;
  return repairs;
}

function fixDecisionHasIncoming(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const decViolations = violations.filter((v) => v.code === "DECISION_HAS_INCOMING");
  if (decViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const decisionIds = new Set(nodes.filter((n) => n.kind === "decision").map((n) => n.id));
  const edges = (graph as any).edges as EdgeT[];

  const validEdges: EdgeT[] = [];
  for (const edge of edges) {
    if (decisionIds.has(edge.to)) {
      repairs.push({
        code: "DECISION_HAS_INCOMING",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Removed incoming edge to decision node`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  (graph as any).edges = validEdges;
  return repairs;
}

// ---------------------------------------------------------------------------
// Bucket B fixes
// ---------------------------------------------------------------------------

function fixCategoryMismatch(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const catViolations = violations.filter((v) => v.code === "CATEGORY_MISMATCH");
  if (catViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Build option→factor adjacency
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  const hasOptionEdge = new Set<string>();
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
      hasOptionEdge.add(edge.to);
    }
  }

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    const inferred = hasOptionEdge.has(node.id) ? "controllable" : "external";
    if ((node as any).category !== inferred) {
      const old = (node as any).category;
      (node as any).category = inferred;
      repairs.push({
        code: "CATEGORY_MISMATCH",
        path: `nodes[${node.id}].category`,
        action: `Structure-inferred category from "${old}" to "${inferred}"`,
      });
    }
  }

  return repairs;
}

function fixControllableMissingData(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const dataViolations = violations.filter((v) => v.code === "CONTROLLABLE_MISSING_DATA");
  if (dataViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "controllable") continue;

    const data = (node as any).data ?? {};
    let changed = false;

    // INVARIANT: Never overwrite an explicit or earlier-justified value.
    // Only default when truly absent (Stage 1 adapter sets 0.5; this is a safety net).
    if (data.value === undefined || data.value === null) {
      data.value = 0.5;
      changed = true;
    }
    if (data.extractionType === undefined) {
      data.extractionType = "inferred";
      changed = true;
    }
    if (data.factor_type === undefined) {
      data.factor_type = "other";
      changed = true;
    }
    if (data.uncertainty_drivers === undefined) {
      data.uncertainty_drivers = ["Not provided"];
      changed = true;
    }

    if (changed) {
      (node as any).data = data;
      repairs.push({
        code: "CONTROLLABLE_MISSING_DATA",
        path: `nodes[${node.id}].data`,
        action: `Populated missing required fields with defaults`,
      });
    }
  }

  return repairs;
}

function fixObservableMissingData(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const dataViolations = violations.filter((v) => v.code === "OBSERVABLE_MISSING_DATA");
  if (dataViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "observable") continue;

    // Write to data.value — the field the V3 transform reads to create
    // observed_state. Do NOT write to node.observed_state directly, as
    // that's a V3-only field created by transformNodeToV3.
    const data = (node as any).data;
    const hasValue = data && typeof data.value === "number";

    if (!hasValue) {
      (node as any).data = {
        ...(data ?? {}),
        value: 0.5,
        extractionType: "observed",
      };
      repairs.push({
        code: "OBSERVABLE_MISSING_DATA",
        path: `nodes[${node.id}]`,
        action: `Added data.value=0.5 and extractionType="observed"`,
      });
    } else if (data.extractionType === undefined) {
      data.extractionType = "observed";
      repairs.push({
        code: "OBSERVABLE_MISSING_DATA",
        path: `nodes[${node.id}]`,
        action: `Added extractionType="observed"`,
      });
    }
  }

  return repairs;
}

function fixObservableExtraData(
  graph: GraphT,
  violations: ValidationIssue[],
): { repairs: Repair[]; fieldDeletions: FieldDeletionEvent[] } {
  const repairs: Repair[] = [];
  const deletions: FieldDeletionEvent[] = [];
  const dataViolations = violations.filter((v) => v.code === "OBSERVABLE_EXTRA_DATA");
  if (dataViolations.length === 0) return { repairs, fieldDeletions: deletions };

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "observable") continue;

    const data = (node as any).data;
    if (!data) continue;

    let changed = false;
    if (data.factor_type !== undefined) {
      deletions.push(fieldDeletion('deterministic-sweep', node.id, 'data.factor_type', 'OBSERVABLE_EXTRA_DATA'));
      delete data.factor_type;
      changed = true;
    }
    if (data.uncertainty_drivers !== undefined) {
      deletions.push(fieldDeletion('deterministic-sweep', node.id, 'data.uncertainty_drivers', 'OBSERVABLE_EXTRA_DATA'));
      delete data.uncertainty_drivers;
      changed = true;
    }
    // Strip empty-array interventions sentinel from Anthropic structured outputs.
    // Non-option nodes should never have interventions; the empty array prevents
    // data deletion in downstream handlers (e.g. unreachable-factors).
    if (Array.isArray(data.interventions) && data.interventions.length === 0) {
      delete data.interventions;
      changed = true;
    }

    if (changed) {
      repairs.push({
        code: "OBSERVABLE_EXTRA_DATA",
        path: `nodes[${node.id}].data`,
        action: `Removed factor_type, uncertainty_drivers, and empty interventions sentinel (extra for observable)`,
      });
    }
  }

  return { repairs, fieldDeletions: deletions };
}

function fixExternalHasData(
  graph: GraphT,
  violations: ValidationIssue[],
): { repairs: Repair[]; fieldDeletions: FieldDeletionEvent[] } {
  const repairs: Repair[] = [];
  const deletions: FieldDeletionEvent[] = [];
  const dataViolations = violations.filter((v) => v.code === "EXTERNAL_HAS_DATA");
  if (dataViolations.length === 0) return { repairs, fieldDeletions: deletions };

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "external") continue;

    const data = (node as any).data;
    if (!data) continue;

    let changed = false;
    if (data.value !== undefined) {
      deletions.push(fieldDeletion('deterministic-sweep', node.id, 'data.value', 'EXTERNAL_HAS_DATA'));
      delete data.value;
      changed = true;
    }
    // factor_type, uncertainty_drivers, and extractionType are metadata fields that
    // describe the factor's classification and remain useful for downstream enrichment.
    // Only data.value is the actual invariant violation for external factors.
    // Promote metadata to node-level (NodeV3 passthrough preserves them) before
    // potentially removing data, so they survive even if data is deleted.
    if (data.factor_type !== undefined) {
      (node as any).factor_type = data.factor_type;
    }
    if (data.extractionType !== undefined) {
      (node as any).extractionType = data.extractionType;
    }
    if (data.uncertainty_drivers !== undefined) {
      (node as any).uncertainty_drivers = data.uncertainty_drivers;
    }
    if (data.encoding_map !== undefined) {
      (node as any).encoding_map = data.encoding_map;
    }
    if (data.unit !== undefined && data.unit !== null) {
      (node as any).unit = data.unit;
    }
    // After stripping value, remove data if it can't satisfy any NodeData union branch.
    // This is only reachable when changed=true (value was just deleted), because the
    // validator only flags EXTERNAL_HAS_DATA when data.value is present. A metadata-only
    // data object without value would not trigger this sweep at all.
    // Uses semantic checks (not key-presence) so that sentinel residue like
    // interventions: undefined doesn't prevent data deletion.
    const hasInterventions = data.interventions && typeof data.interventions === 'object'
      && !Array.isArray(data.interventions) && Object.keys(data.interventions).length > 0;
    const hasOperator = typeof data.operator === 'string';
    const hasValue = typeof data.value === 'number';
    if (changed && !hasInterventions && !hasOperator && !hasValue) {
      deletions.push(fieldDeletion('deterministic-sweep', node.id, 'data', 'EXTERNAL_HAS_DATA'));
      delete (node as any).data;
    }

    if (changed) {
      repairs.push({
        code: "EXTERNAL_HAS_DATA",
        path: `nodes[${node.id}].data`,
        action: `Removed value (prohibited for external). Promoted factor_type, extractionType, uncertainty_drivers, encoding_map, unit to node level.`,
      });
    }
  }

  return { repairs, fieldDeletions: deletions };
}

// ---------------------------------------------------------------------------
// Bucket A: Deterministic cycle breaking
// ---------------------------------------------------------------------------

/** Check if an edge is structural (decision→option or canonical option→factor). */
function isStructuralEdge(edge: EdgeT, nodeKindMap: Map<string, string>): boolean {
  const fk = nodeKindMap.get(edge.from);
  const tk = nodeKindMap.get(edge.to);
  return (fk === "decision" && tk === "option") ||
         (fk === "option" && tk === "factor" && edge.strength_mean === 1.0);
}

/** Find one cycle via DFS. Returns edges forming the cycle, or null if DAG. */
function findOneCycleDFS(nodes: NodeT[], edges: EdgeT[]): EdgeT[] | null {
  const adj = new Map<string, Array<{ edge: EdgeT; to: string }>>();
  for (const node of nodes) adj.set(node.id, []);
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue;
    const list = adj.get(edge.from);
    if (list) list.push({ edge, to: edge.to });
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parentEdge = new Map<string, EdgeT | null>();
  const parentNode = new Map<string, string | null>();
  for (const node of nodes) {
    color.set(node.id, WHITE);
    parentEdge.set(node.id, null);
    parentNode.set(node.id, null);
  }

  for (const startNode of nodes) {
    if (color.get(startNode.id) !== WHITE) continue;
    const stack: Array<{ nodeId: string; neighborIdx: number }> = [{ nodeId: startNode.id, neighborIdx: 0 }];
    color.set(startNode.id, GRAY);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top.nodeId) ?? [];
      if (top.neighborIdx >= neighbors.length) {
        color.set(top.nodeId, BLACK);
        stack.pop();
        continue;
      }
      const { edge, to } = neighbors[top.neighborIdx];
      top.neighborIdx++;

      if (color.get(to) === GRAY) {
        const cycleEdges: EdgeT[] = [edge];
        let current = top.nodeId;
        const maxSteps = nodes.length; // Safety: cycle can't be longer than node count
        let steps = 0;
        while (current !== to && steps < maxSteps) {
          const pe = parentEdge.get(current);
          if (!pe) break;
          cycleEdges.push(pe);
          current = parentNode.get(current)!;
          steps++;
        }
        return cycleEdges;
      }
      if (color.get(to) === WHITE) {
        color.set(to, GRAY);
        parentEdge.set(to, edge);
        parentNode.set(to, top.nodeId);
        stack.push({ nodeId: to, neighborIdx: 0 });
      }
    }
  }
  return null;
}

/**
 * Deterministically break all cycles by iteratively removing the weakest back-edge.
 * Structural edges (decision→option, canonical option→factor) are never removed.
 * Bidirected edges are excluded from cycle detection.
 */
export function fixCyclesDeterministic(graph: GraphT): Repair[] {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  let edges = (graph as any).edges as EdgeT[];

  const MAX_ITERATIONS = 50;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const cycleEdges = findOneCycleDFS(nodes, edges);
    if (!cycleEdges) break;

    const nodeKindMap = new Map<string, string>();
    for (const n of nodes) nodeKindMap.set(n.id, n.kind);

    const removable = cycleEdges.filter((e) => !isStructuralEdge(e, nodeKindMap));
    if (removable.length === 0) {
      log.error({
        event: "cee.deterministic_sweep.cycle_all_structural",
        cycle_edges: cycleEdges.map((e) => `${e.from}→${e.to}`),
      }, "Cycle contains only structural edges — cannot break deterministically");
      break;
    }

    let weakest: EdgeT = removable[0];
    let weakestIdx = edges.indexOf(weakest);
    for (let i = 1; i < removable.length; i++) {
      const candidate = removable[i];
      const candidateIdx = edges.indexOf(candidate);
      const candidateBelief = candidate.belief_exists ?? 1.0;
      const weakestBelief = weakest.belief_exists ?? 1.0;
      if (candidateBelief < weakestBelief || (candidateBelief === weakestBelief && candidateIdx > weakestIdx)) {
        weakest = candidate;
        weakestIdx = candidateIdx;
      }
    }

    edges = edges.filter((e) => e !== weakest);
    (graph as any).edges = edges;

    repairs.push({
      code: "CYCLE_DETECTED",
      path: `edges[${weakest.from}→${weakest.to}]`,
      action: `Removed back-edge to break cycle (belief_exists=${weakest.belief_exists ?? "undefined"})`,
    });
    log.info({
      event: "cee.deterministic_sweep.cycle_broken",
      removed_edge: `${weakest.from}→${weakest.to}`,
      belief_exists: weakest.belief_exists,
      iteration: iter + 1,
    }, `Cycle broken: removed ${weakest.from}→${weakest.to}`);
  }
  return repairs;
}

// ---------------------------------------------------------------------------
// Bucket B: Fuzzy intervention reference matching
// ---------------------------------------------------------------------------

/**
 * Fix INVALID_INTERVENTION_REF violations by fuzzy-matching intervention keys
 * against actual factor node IDs. Uses fuzzyMatchNodeId (substring-based with
 * strict uniqueness: returns undefined if >1 candidate matches, which is
 * stricter than a 0.1-similarity threshold — it requires exactly 1 match).
 */
function fixInvalidInterventionRefs(graph: GraphT): Repair[] {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const factorNodeIds: string[] = [];
  const factorLabelMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "factor") {
      factorNodeIds.push(node.id);
      if (node.label) factorLabelMap.set(node.id, node.label);
    }
  }
  const factorIdSet = new Set(factorNodeIds);

  for (const node of nodes) {
    if (node.kind !== "option") continue;
    const data = (node as any).data;
    if (!data?.interventions || typeof data.interventions !== "object") continue;

    const interventions = data.interventions as Record<string, unknown>;
    const keysToRemap: Array<{ oldKey: string; newKey: string }> = [];
    const keysToRemove: string[] = [];

    for (const key of Object.keys(interventions)) {
      if (factorIdSet.has(key)) continue;

      // 1. Exact prefix match
      const prefixMatches = factorNodeIds.filter((fid) => fid.startsWith(key) || key.startsWith(fid));
      if (prefixMatches.length === 1) { keysToRemap.push({ oldKey: key, newKey: prefixMatches[0] }); continue; }

      // 2. Fuzzy match (strict uniqueness — undefined if ambiguous)
      const fuzzyMatch = fuzzyMatchNodeId(key, factorNodeIds, factorLabelMap);
      if (fuzzyMatch) { keysToRemap.push({ oldKey: key, newKey: fuzzyMatch }); continue; }

      // 3. No match — remove
      keysToRemove.push(key);
    }

    for (const { oldKey, newKey } of keysToRemap) {
      interventions[newKey] = interventions[oldKey];
      delete interventions[oldKey];
      for (const edge of edges) { if (edge.from === node.id && edge.to === oldKey) edge.to = newKey; }
      repairs.push({ code: "INVALID_INTERVENTION_REF", path: `nodes[${node.id}].data.interventions[${oldKey}]`, action: `Fuzzy-matched "${oldKey}" → "${newKey}"` });
      log.info({ event: "cee.deterministic_sweep.intervention_ref_remapped", option_id: node.id, old_key: oldKey, new_key: newKey }, `Remapped intervention ref: ${oldKey} → ${newKey}`);
    }

    for (const key of keysToRemove) {
      delete interventions[key];
      repairs.push({ code: "INVALID_INTERVENTION_REF", path: `nodes[${node.id}].data.interventions[${key}]`, action: `Removed unmatched key "${key}"` });
      log.warn({ event: "cee.deterministic_sweep.intervention_ref_removed", option_id: node.id, key }, `Removed unmatched intervention ref: ${key}`);
    }
  }
  return repairs;
}

// ---------------------------------------------------------------------------
// Proactive: Remaining forbidden edge removal
// ---------------------------------------------------------------------------

const SIMPLE_REMOVE_PATTERNS: ReadonlyArray<[string, string]> = [
  ["decision", "outcome"], ["decision", "risk"], ["decision", "factor"],
  ["outcome", "outcome"], ["risk", "risk"],
];

/**
 * Remove remaining forbidden edge patterns not covered by existing shortcut handlers.
 * Logs a reachability warning when removal disconnects a target node from all inbound edges.
 */
export function fixRemainingForbiddenEdges(
  graph: GraphT,
  requestId?: string,
): { repairs: Repair[]; removedCount: number } {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) nodeKindMap.set(node.id, node.kind);

  const keptEdges: EdgeT[] = [];
  let removedCount = 0;
  const removedTargets: string[] = [];

  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    const isForbidden = fromKind && toKind &&
      SIMPLE_REMOVE_PATTERNS.some(([fk, tk]) => fk === fromKind && tk === toKind);

    if (isForbidden) {
      removedCount++;
      removedTargets.push(edge.to);
      repairs.push({ code: "FORBIDDEN_EDGE_AUTO_FIXED", path: `edges[${edge.from}→${edge.to}]`, action: `Removed forbidden ${fromKind}→${toKind} edge` });
      log.info({ event: "cee.deterministic_sweep.forbidden_edge_removed", from: edge.from, to: edge.to, pattern: `${fromKind}_${toKind}`, request_id: requestId }, `Removed forbidden edge: ${fromKind}→${toKind} (${edge.from}→${edge.to})`);
    } else {
      keptEdges.push(edge);
    }
  }

  if (removedCount > 0) {
    (graph as any).edges = keptEdges;

    // Check if any removed target lost ALL inbound edges — log reachability warning
    const uniqueTargets = [...new Set(removedTargets)];
    for (const targetId of uniqueTargets) {
      const hasInbound = keptEdges.some((e) => e.to === targetId);
      if (!hasInbound) {
        log.warn({
          event: "cee.deterministic_sweep.forbidden_edge_disconnected_target",
          target_id: targetId,
          target_kind: nodeKindMap.get(targetId),
          request_id: requestId,
        }, `Forbidden edge removal disconnected target "${targetId}" — connectivity substep will attempt rewiring`);
      }
    }
  }

  return { repairs, removedCount };
}

// ---------------------------------------------------------------------------
// Rescue score computation
// ---------------------------------------------------------------------------

function computeRescueScore(repairs: Repair[], unreachableResult: { reclassified: string[] }, llmRepairNeeded: boolean): number {
  let score = 0;
  for (const r of repairs) {
    if (BUCKET_A_CODES.has(r.code)) score += 1;
    else if (BUCKET_B_CODES.has(r.code)) score += 2;
    else score += 1;
  }
  score += (unreachableResult.reclassified?.length ?? 0) * 2;
  if (llmRepairNeeded) score += 10;
  return score;
}

// ---------------------------------------------------------------------------
// Goal threshold validation
// ---------------------------------------------------------------------------

/**
 * Strip goal_threshold when goal_threshold_raw is absent/null/undefined.
 *
 * The LLM prompt instructs it to omit goal_threshold for qualitative goals,
 * but this is sometimes ignored. A normalised threshold without a grounded
 * raw value is unreliable — strip all four threshold fields.
 *
 * If goal_threshold_raw IS present (even if the goal seems qualitative),
 * the extraction was grounded in a real number from the brief and is preserved.
 *
 * Runs proactively (not gated by violations).
 */
export function fixGoalThresholdNoRaw(graph: GraphT): Repair[] {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "goal") continue;

    const gt = (node as any).goal_threshold;
    const gtRaw = (node as any).goal_threshold_raw;

    // Only strip when goal_threshold is present but goal_threshold_raw is absent/null/undefined
    if (gt !== undefined && gt !== null && (gtRaw === undefined || gtRaw === null)) {
      delete (node as any).goal_threshold;
      delete (node as any).goal_threshold_raw;
      delete (node as any).goal_threshold_unit;
      delete (node as any).goal_threshold_cap;

      repairs.push({
        code: "GOAL_THRESHOLD_STRIPPED_NO_RAW",
        path: `nodes[${node.id}].goal_threshold`,
        action: "Goal threshold removed: no raw target value extracted from brief",
      });
    }
  }

  return repairs;
}

/**
 * Heuristic: warn when goal_threshold looks LLM-inferred rather than grounded.
 *
 * Fires when ALL of:
 *  1. goal_threshold AND goal_threshold_raw are both present
 *  2. goal_threshold_unit is absent or "%"
 *  3. goal_threshold_raw is a round number (ends in 0 or 5)
 *  4. goal label contains no digits
 *
 * This catches the common pattern where the LLM invents "70%" for
 * "improve UX". Does NOT strip — just emits a warning repair record.
 *
 * Runs proactively after fixGoalThresholdNoRaw.
 */
export function warnGoalThresholdPossiblyInferred(graph: GraphT): Repair[] {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "goal") continue;

    const gt = (node as any).goal_threshold;
    const gtRaw = (node as any).goal_threshold_raw;
    if (gt === undefined || gt === null || gtRaw === undefined || gtRaw === null) continue;

    const unit = (node as any).goal_threshold_unit as string | undefined;
    const unitIsPercentOrAbsent = !unit || unit === "%";
    const rawIsRound = typeof gtRaw === "number" && gtRaw % 5 === 0;
    const labelHasNoDigits = !/\d/.test(node.label ?? "");

    if (unitIsPercentOrAbsent && rawIsRound && labelHasNoDigits) {
      repairs.push({
        code: "GOAL_THRESHOLD_POSSIBLY_INFERRED",
        path: `nodes[${node.id}].goal_threshold`,
        action: "Goal threshold may not reflect an explicit target from the brief. Verify or remove.",
      });
    }
  }

  return repairs;
}

// ---------------------------------------------------------------------------
// Topology repair: factor→goal edge splitting
// ---------------------------------------------------------------------------

/**
 * Proactively detect and repair factor→goal edges by injecting intermediate
 * outcome nodes. This addresses the B4 minimisation failure where the LLM
 * short-circuits the causal chain (factor→goal) instead of building the
 * required factor→outcome→goal topology.
 *
 * For each factor→goal edge:
 *  1. Create outcome node: id = `out_${factorId}_impact`, kind = 'outcome'
 *  2. Replace edge: factor→goal → factor→outcome (original strength) + outcome→goal (defaults)
 *  3. Log repair with code FACTOR_GOAL_EDGE_SPLIT
 *
 * Runs proactively (not gated by violations) like unreachable-factor handling.
 */
export function fixFactorGoalEdges(graph: GraphT, format: EdgeFormat): { repairs: Repair[]; splitCount: number } {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const nodeKindMap = new Map<string, string>();
  const nodeLabelMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
    nodeLabelMap.set(node.id, node.label ?? node.id);
  }

  const keptEdges: EdgeT[] = [];
  const newNodes: NodeT[] = [];
  let splitCount = 0;

  // Mediating-outcome id resolved ONCE PER FACTOR, not per edge. Two reasons, and
  // the second only bites once collision handling exists:
  //  - several factor→goal edges from one factor must share one outcome node
  //    (pinned by "deduplicates outcome node when same factor targets multiple
  //    goals"), and
  //  - re-running the suffix search per edge would step _2, _3, _4… because each
  //    mint makes the previous id taken — turning one shared outcome into N.
  const resolvedOutcomeId = new Map<string, string>();

  // ── Duplicate-path suppression, keyed on ENDPOINTS **AND SIGN** ───────────
  //
  // Every factor→goal edge is re-routed as a factor→outcome→goal PATH. Where
  // several source claims share a limb — one factor mediated by one outcome, or
  // one outcome feeding one goal — the loop below used to emit that limb once
  // PER CLAIM, so a single causal relationship left this function as N parallel
  // edges. The old test pinned that as intended and narrated it in its own
  // comment.
  //
  // ⚠ THE HARM IS NOT MIS-WEIGHTING, WHICH IS WHAT IT LOOKS LIKE FROM HERE.
  // Derived at the consumer's bytes (`plot-lite-service` b9f6b5a7,
  // `src/integrations/isl/preflight.ts:334-344`, emitted at
  // `src/routes/v2/run.ts:6804-6826`): PLoT's `edgeFingerprint` keys on SEVEN
  // fields — `from`, `to`, `edge_type`, `exists_probability`, `strength.mean`,
  // `strength.std`, `label`. (⚠ Do not confuse that with the FOUR-field list at
  // `preflight.ts:349-354`: that is `divergentFields`, which composes the
  // blocker MESSAGE after a conflict is found. Different function, different
  // question — an earlier draft of this comment conflated them.) Identical
  // duplicates PLoT coalesces; DIVERGENT ones are a `DUPLICATE_EDGE_CONFLICT`
  // blocker — HTTP 422, `blocks_analysis: true`, ISL never called. And divergent
  // is the ORDINARY case here, because each limb inherits its own source edge's
  // numerics. So the unsuppressed shape did not tilt the maths; it stopped the
  // maths running at all, and returned "keep one edge per relationship" about
  // edges this repair had just minted on the user's behalf.
  //
  // SIGN IS PART OF THE KEY, deliberately. Two claims that agree on direction
  // are one relationship stated twice and collapse to one edge. Two that
  // DISAGREE may be a genuine conflict — but only under the two gates below,
  // because the naive form of that test narrates OUR artefact as the user's
  // incoherence.
  //
  // ⚠⚠ GATE 1 — ONLY A *STATED, KNOWN* SIGN CAN DISAGREE WITH ANOTHER.
  // `effect_direction` is OPTIONAL in the contract and admits `"unknown"`
  // (`@talchain/schemas` 0.39.0 `graph.d.ts:519`). Three populations would
  // otherwise be narrated as disagreements that nobody made:
  //   - the outcome→goal limb mints `"positive"` as a HARDCODED LITERAL below,
  //     whatever the source said, so its sign is ours and never a claim;
  //   - an absent `effect_direction` would have the `?? "positive"` default
  //     reported back as though it had been asserted; and
  //   - `"unknown"` is the explicit absence of a directional claim.
  // AN ABSENCE OF A CLAIM IS NOT A DISAGREEMENT.
  //
  // ⚠⚠ GATE 2 — THE TWO CLAIMS MUST SHARE A TARGET.
  // The mediating outcome is resolved ONCE PER FACTOR (`resolvedOutcomeId`
  // above), so `f→g1 positive` and `f→g2 negative` — "price helps revenue,
  // hurts share", a perfectly coherent model — land on the SAME factor→outcome
  // limb. Reporting that as a contradiction blames the user for our mediation
  // artefact. Only claims about the same target can contradict each other.
  //   ⚠ NOTE THE DEFECT THAT REMAINS, AND IS NOT THIS FUNCTION'S TO FIX: where
  //   the signs genuinely differ across different targets, the shared limb
  //   carries ONE sign, so the only path to the other goal comes out with the
  //   wrong sign. That SIGN INVERSION is pre-existing — it follows from the
  //   shared mediating outcome at `resolvedOutcomeId`, which predates this
  //   suppression — and is rowed separately. Suppression neither causes nor
  //   cures it; this note exists so the next reader does not mistake the
  //   silence here for absence of the problem.
  //
  // ORDER-FREE RESOLUTION. Which claim's numerics survive is decided by a
  // deterministic key over the SOURCE claim, never by position in `edges[]`.
  // First-in-list would have made the output graph depend on input order — a
  // property the pre-suppression code did not have, since it kept everything —
  // and the same model must analyse the same way twice.
  //
  // THE SURVIVING NUMBERS ARE ALWAYS ONES A SOURCE STATED. Never a mean, never
  // a max: a merged average would be a number nobody asserted.
  interface CarriedLimb {
    /** Sign as actually emitted on the surviving edge. */
    readonly sign: string;
    /** Sign the SOURCE claim stated — `undefined` when defaulted, minted or "unknown". */
    readonly statedSign: string | undefined;
    /** Target of the source claim; `undefined` for a pass-through edge. */
    readonly target: string | undefined;
    /** Deterministic tie-break key over the source claim; `undefined` = not replaceable. */
    readonly sourceKey: string | undefined;
    /** Index into `keptEdges`, so a better-ranked claim can replace in place. */
    readonly index: number;
  }

  const carried = new Map<string, CarriedLimb>();

  /** The sign a source ACTUALLY stated, or `undefined` if it stated none. */
  const statedSign = (e: EdgeT): string | undefined => {
    const raw = (e as Record<string, unknown>).effect_direction;
    if (typeof raw !== "string" || raw === "unknown") return undefined;
    return raw;
  };
  const emittedSign = (e: EdgeT): string => statedSign(e) ?? "positive";

  /** JSON-encoded so an id containing the delimiter cannot collide. */
  const claimKey = (from: string, to: string): string => JSON.stringify([from, to]);

  /** Human-facing name for a node — NEVER a raw id, which is not user-facing copy. */
  const displayName = (id: string): string => nodeLabelMap.get(id) ?? id;

  // Seed from the edges that pass through untouched. They survive this repair,
  // so their endpoints are already spoken for before the first split emits
  // anything. `sourceKey: undefined` makes them unreplaceable: an edge the model
  // already holds outranks any limb we would mint.
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "factor" && nodeKindMap.get(edge.to) === "goal") continue;
    const endpoints = `${edge.from}::${edge.to}`;
    if (!carried.has(endpoints)) {
      carried.set(endpoints, {
        sign: emittedSign(edge),
        statedSign: statedSign(edge),
        target: undefined,
        sourceKey: undefined,
        index: -1,
      });
    }
  }

  /**
   * Add one synthetic limb unless its endpoints are already carried. Returns a
   * Repair when the limb was NOT added, so the caller records what happened — a
   * suppression nobody can see is indistinguishable from a lost edge.
   *
   * `limbStatedSign` is the sign the SOURCE claim stated for THIS limb, which is
   * not the same as the limb's own `effect_direction`: the outcome→goal limb is
   * minted positive regardless, so it passes `undefined` and can never be
   * narrated as a disagreement.
   */
  const addLimb = (
    limb: EdgeT,
    source: { readonly target: string; readonly key: string; readonly statedSign: string | undefined },
  ): Repair | undefined => {
    const endpoints = `${limb.from}::${limb.to}`;
    const from = displayName(limb.from);
    const to = displayName(limb.to);
    const incumbent = carried.get(endpoints);

    if (incumbent === undefined) {
      carried.set(endpoints, {
        sign: emittedSign(limb),
        statedSign: source.statedSign,
        target: source.target,
        sourceKey: source.key,
        index: keptEdges.length,
      });
      keptEdges.push(limb);
      return undefined;
    }

    // Order-free: a claim that ranks earlier replaces the incumbent's numerics
    // in place. Pass-through edges (`sourceKey === undefined`) are never
    // replaced — the model already holds them.
    if (
      incumbent.sourceKey !== undefined &&
      incumbent.index >= 0 &&
      source.key < incumbent.sourceKey
    ) {
      keptEdges[incumbent.index] = limb;
      carried.set(endpoints, {
        sign: emittedSign(limb),
        statedSign: source.statedSign,
        target: source.target,
        sourceKey: source.key,
        index: incumbent.index,
      });
    }

    // A contradiction requires BOTH gates: two STATED, KNOWN signs that differ,
    // about the SAME target.
    const genuineConflict =
      source.statedSign !== undefined &&
      incumbent.statedSign !== undefined &&
      source.statedSign !== incumbent.statedSign &&
      incumbent.target !== undefined &&
      incumbent.target === source.target;

    if (genuineConflict) {
      return {
        code: "CONFLICTING_CAUSAL_DIRECTION",
        path: `edges[${limb.from}→${limb.to}]`,
        action:
          `Merged conflicting links between "${from}" and "${to}" into one, keeping the direction already ` +
          `in the model. The drafted model connected them with opposite directions of effect, and only one ` +
          `direction can be analysed.`,
      };
    }

    return {
      code: "DUPLICATE_CAUSAL_EDGE_SUPPRESSED",
      path: `edges[${limb.from}→${limb.to}]`,
      action:
        `Merged repeated links between "${from}" and "${to}" into one. The drafted model connected them ` +
        `more than once, and a repeated connection stops the analysis running.`,
    };
  };

  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    if (fromKind === "factor" && toKind === "goal") {
      const factorLabel = nodeLabelMap.get(edge.from) ?? edge.from;

      let outcomeId = resolvedOutcomeId.get(edge.from);
      if (outcomeId === undefined) {
        outcomeId = `out_${edge.from}_impact`;

        // `out_<factorId>_impact` is MINTED, not reserved — the id may already be
        // held by an unrelated node. Reusing it blindly wires factor→<non-outcome>,
        // and where the squatter is a GOAL it re-emits the very factor→goal edge
        // this repair exists to remove, after the sweep that owns that pattern has
        // run. Verify kind-compatibility, else generate a collision-safe id.
        // (Same policy, same file: `fixOptionGoalShortcut` below.)
        if (nodeKindMap.has(outcomeId) && nodeKindMap.get(outcomeId) !== "outcome") {
          let suffix = 2;
          while (nodeKindMap.has(`out_${edge.from}_impact_${suffix}`)) suffix++;
          outcomeId = `out_${edge.from}_impact_${suffix}`;
        }

        resolvedOutcomeId.set(edge.from, outcomeId);
      }

      // Only create the outcome node once (multiple factor→goal edges from same factor)
      if (!nodeKindMap.has(outcomeId)) {
        const outcomeLabel = `${factorLabel} Impact`;
        newNodes.push({
          id: outcomeId,
          kind: "outcome",
          label: outcomeLabel,
        } as NodeT);
        nodeKindMap.set(outcomeId, "outcome");
        // Register the label too: repair copy is USER-VISIBLE (the UI renders
        // `deterministic_repairs[].action` unconditionally and does not run it
        // through `sanitiseDetail`), so it must never fall back to a raw
        // `out_fac_…_impact` id.
        nodeLabelMap.set(outcomeId, outcomeLabel);
      }

      // factor→outcome: preserve original strength (causal relationship)
      const origMean = edge.strength_mean ?? ((edge as Record<string, unknown>).weight as number | undefined) ?? 0.5;
      const origStd = edge.strength_std ?? 0.15;
      const origExist = edge.belief_exists ?? ((edge as Record<string, unknown>).belief as number | undefined) ?? 0.9;

      // Both limbs come from THIS source claim, so they share its target and its
      // tie-break key. Only the factor→outcome limb carries the source's stated
      // direction; the outcome→goal limb below mints `"positive"` as a literal
      // whatever the source said, so it passes `statedSign: undefined` and can
      // never be narrated as a disagreement (GATE 1).
      const claim = { target: edge.to, key: claimKey(edge.from, edge.to) };

      const factorLimb = addLimb(patchEdgeNumeric(
        { from: edge.from, to: outcomeId, effect_direction: edge.effect_direction ?? "positive", origin: "repair", provenance: { source: "synthetic", quote: "Split factor→goal into factor→outcome→goal" }, provenance_source: "synthetic" } as EdgeT,
        format,
        { mean: origMean, std: origStd, existence: origExist },
      ), { ...claim, statedSign: statedSign(edge) });
      if (factorLimb) repairs.push(factorLimb);

      // outcome→goal: moderate defaults
      const goalLimb = addLimb(patchEdgeNumeric(
        { from: outcomeId, to: edge.to, effect_direction: "positive", origin: "repair", provenance: { source: "synthetic", quote: "Split factor→goal into factor→outcome→goal" }, provenance_source: "synthetic" } as EdgeT,
        format,
        { mean: 0.5, std: 0.15, existence: 0.9 },
      ), { ...claim, statedSign: undefined });
      if (goalLimb) repairs.push(goalLimb);

      splitCount++;
      repairs.push({
        code: "FACTOR_GOAL_EDGE_SPLIT",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Split factor→goal into factor→${outcomeId}→${edge.to} via synthetic outcome node`,
      });
    } else {
      keptEdges.push(edge);
    }
  }

  if (splitCount > 0) {
    (graph as any).nodes = [...nodes, ...newNodes];
    (graph as any).edges = keptEdges;
  }

  return { repairs, splitCount };
}

// ---------------------------------------------------------------------------
// Proactive: option→outcome shortcut removal (whitelisted FORBIDDEN_EDGE fix)
// ---------------------------------------------------------------------------

/**
 * Allowed edge patterns for reachability BFS.
 * Only edges matching these (fromKind → toKind) pairs are traversed,
 * ensuring the outcome reaches goal via a valid causal chain — not through
 * another forbidden shortcut.
 */
const REACHABILITY_ALLOWED: Array<[string, string]> = [
  ["factor", "outcome"],
  ["factor", "risk"],
  ["factor", "factor"],
  ["outcome", "goal"],
  ["risk", "goal"],
];

/**
 * Check if a node can reach a goal node following only allowed edge patterns.
 * @param excludeEdge - optional edge to exclude from traversal (the candidate for removal)
 */
function canReachGoalViaAllowed(
  startId: string,
  nodeKindMap: Map<string, string>,
  edges: EdgeT[],
  excludeEdge?: EdgeT,
): boolean {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (nodeKindMap.get(current) === "goal") return true;

    const currentKind = nodeKindMap.get(current);
    if (!currentKind) continue;

    for (const edge of edges) {
      if (edge === excludeEdge) continue;
      // Adopt the estate's directed-edge policy (`src/graph/reachability.ts`).
      // A bidirected edge is an unmeasured common cause, not a causal path
      // (`schemas/graph.ts:333-335`), so it must not vouch for an outcome
      // "already having a valid path to goal" and thereby authorise deleting a
      // forbidden shortcut. The kind whitelist below is a DELIBERATE extra
      // narrowing and is retained; only the edge policy is shared.
      if (!isDirectedEdge(edge)) continue;
      if (edge.from !== current) continue;
      const toKind = nodeKindMap.get(edge.to);
      if (!toKind) continue;

      // Only traverse via allowed edge patterns
      const isAllowed = REACHABILITY_ALLOWED.some(
        ([fk, tk]) => fk === currentKind && tk === toKind,
      );
      if (isAllowed && !visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }
  return false;
}

/**
 * Remove option→outcome shortcut edges when the outcome already has a valid
 * path to goal via allowed edge patterns (outcome→goal or outcome→factor→...→goal).
 *
 * Only handles the option→outcome pattern. All other forbidden patterns
 * (option→goal, option→risk, decision→outcome, etc.) remain Bucket C for LLM repair.
 *
 * Returns repair records for removed edges plus a count of non-eligible
 * forbidden edges that were skipped (flagged for LLM repair).
 */
export function fixOptionOutcomeShortcut(graph: GraphT): {
  repairs: Repair[];
  removedCount: number;
  skippedCount: number;
} {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) nodeKindMap.set(node.id, node.kind);

  const keptEdges: EdgeT[] = [];
  let removedCount = 0;
  let skippedCount = 0;

  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    if (fromKind === "option" && toKind === "outcome") {
      // Check if the outcome already reaches goal via allowed patterns
      // (excluding the current edge, which we're considering removing)
      if (canReachGoalViaAllowed(edge.to, nodeKindMap, edges, edge)) {
        removedCount++;
        repairs.push({
          code: "FORBIDDEN_EDGE_AUTO_FIXED",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Removed option→outcome shortcut (outcome already reaches goal via valid chain)`,
        });
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_fixed",
          from: edge.from,
          to: edge.to,
          pattern: "option_outcome_shortcut",
        }, `Auto-fixed forbidden edge: option→outcome shortcut ${edge.from}→${edge.to}`);
        continue; // Skip — don't keep this edge
      } else {
        // Outcome has no valid path to goal without this edge — leave for LLM
        skippedCount++;
        keptEdges.push(edge);
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_deferred",
          from: edge.from,
          to: edge.to,
          pattern: "option_outcome_no_goal_path",
          reason: "outcome has no valid path to goal via allowed edge patterns; deferred to LLM repair",
        }, `Deferred forbidden edge to LLM: option→outcome ${edge.from}→${edge.to} (no goal path)`);
      }
    } else {
      keptEdges.push(edge);
    }
  }

  if (removedCount > 0) {
    (graph as any).edges = keptEdges;
  }

  return { repairs, removedCount, skippedCount };
}

// ---------------------------------------------------------------------------
// Kind normalisation helper
// ---------------------------------------------------------------------------

/** Normalise V3 "action" kind to "option" for topology matching. */
function normaliseKind(kind: string): string {
  return kind === "action" ? "option" : kind;
}

// ---------------------------------------------------------------------------
// Proactive: option→risk shortcut removal
// ---------------------------------------------------------------------------

/**
 * Remove option→risk shortcut edges.
 *
 * For each forbidden option→risk edge:
 * 1. If the risk already reaches goal via allowed patterns, remove the shortcut.
 * 2. If no valid path exists but a controllable factor connects to the risk,
 *    remove the shortcut (the factor→risk path is the valid route).
 * 3. If neither condition holds, find the controllable factor most connected
 *    to the option's neighbourhood, insert a factor→risk edge with moderate
 *    defaults, and remove the shortcut.
 * 4. If no controllable factor exists at all, log a warning and leave the
 *    edge for LLM repair.
 */
export function fixOptionRiskShortcut(graph: GraphT, format: EdgeFormat): {
  repairs: Repair[];
  removedCount: number;
  rerouted: number;
  skippedCount: number;
} {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Normalise "action" → "option" for topology matching (V3 compat)
  const nodeKindMap = new Map<string, string>();
  const nodeCategoryMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, normaliseKind(node.kind));
    if (node.category) nodeCategoryMap.set(node.id, node.category);
  }

  // Find controllable factors (explicitly tagged or inferred from option→factor edges)
  const controllableIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "factor" && node.category === "controllable") controllableIds.add(node.id);
  }
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
      controllableIds.add(edge.to);
    }
  }

  // Build quick lookup: which controllable factors does each option connect to?
  const optionToFactors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "option" && controllableIds.has(edge.to)) {
      const set = optionToFactors.get(edge.from) ?? new Set();
      set.add(edge.to);
      optionToFactors.set(edge.from, set);
    }
  }

  // Check which controllable factors already have a direct edge to each risk
  const factorToRisks = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (controllableIds.has(edge.from) && nodeKindMap.get(edge.to) === "risk") {
      const set = factorToRisks.get(edge.from) ?? new Set();
      set.add(edge.to);
      factorToRisks.set(edge.from, set);
    }
  }

  const keptEdges: EdgeT[] = [];
  const newEdges: EdgeT[] = [];
  let removedCount = 0;
  let rerouted = 0;
  let skippedCount = 0;

  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    if (fromKind === "option" && toKind === "risk") {
      // Check if option has a compliant bridge (option→factor→risk) to this risk
      const optFactors = optionToFactors.get(edge.from);
      let hasBridge = false;
      if (optFactors) {
        for (const fId of optFactors) {
          if (factorToRisks.get(fId)?.has(edge.to)) {
            hasBridge = true;
            break;
          }
        }
      }

      // Case 1: option already has a compliant path to this risk AND risk reaches goal
      // — safe to remove the shortcut since the causal influence is preserved
      if (hasBridge && canReachGoalViaAllowed(edge.to, nodeKindMap, edges, edge)) {
        removedCount++;
        repairs.push({
          code: "FORBIDDEN_EDGE_AUTO_FIXED",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Removed option→risk shortcut (compliant bridge exists and risk reaches goal)`,
        });
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_fixed",
          from: edge.from,
          to: edge.to,
          pattern: "option_risk_shortcut",
        }, `Auto-fixed forbidden edge: option→risk shortcut ${edge.from}→${edge.to}`);
        continue;
      }

      // Case 2: option has a compliant bridge but risk has no goal path — still safe
      // to remove since the option→factor→risk path preserves causal influence
      if (hasBridge) {
        removedCount++;
        repairs.push({
          code: "FORBIDDEN_EDGE_AUTO_FIXED",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Removed option→risk shortcut (option already reaches risk via controllable factor)`,
        });
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_fixed",
          from: edge.from,
          to: edge.to,
          pattern: "option_risk_shortcut_existing_bridge",
        }, `Auto-fixed forbidden edge: option→risk ${edge.from}→${edge.to} (bridge exists)`);
        continue;
      }

      // Case 3: reroute via the best available controllable factor
      if (optFactors && optFactors.size > 0) {
        // Pick the first controllable factor connected to this option
        const bridgeFactor = optFactors.values().next().value;
        // Insert factor→risk edge with moderate defaults
        newEdges.push(patchEdgeNumeric(
          {
            from: bridgeFactor,
            to: edge.to,
            effect_direction: edge.effect_direction ?? "positive",
            origin: "repair",
            provenance: { source: "synthetic", quote: "Rerouted option→risk via controllable factor" },
            provenance_source: "synthetic",
          } as EdgeT,
          format,
          { mean: 0.5, std: 0.15, existence: 0.9 },
        ));
        // Track the new edge in factorToRisks so subsequent shortcuts to the same risk find it
        const set = factorToRisks.get(bridgeFactor!) ?? new Set();
        set.add(edge.to);
        factorToRisks.set(bridgeFactor!, set);

        removedCount++;
        rerouted++;
        repairs.push({
          code: "FORBIDDEN_EDGE_AUTO_FIXED",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Rerouted option→risk via ${bridgeFactor}: removed shortcut, added factor→risk edge`,
        });
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_fixed",
          from: edge.from,
          to: edge.to,
          bridge_factor: bridgeFactor,
          pattern: "option_risk_shortcut_rerouted",
        }, `Rerouted forbidden edge: option→risk ${edge.from}→${edge.to} via ${bridgeFactor}`);
        continue;
      }

      // Case 4: no controllable factor at all — defer to LLM repair
      skippedCount++;
      keptEdges.push(edge);
      log.warn({
        event: "cee.deterministic_sweep.forbidden_edge_deferred",
        from: edge.from,
        to: edge.to,
        pattern: "option_risk_no_factor",
        reason: "no controllable factor available; deferred to LLM repair",
      }, `Deferred forbidden edge to LLM: option→risk ${edge.from}→${edge.to} (no controllable factor)`);
    } else {
      keptEdges.push(edge);
    }
  }

  if (removedCount > 0 || newEdges.length > 0) {
    (graph as any).edges = [...keptEdges, ...newEdges];
  }

  return { repairs, removedCount, rerouted, skippedCount };
}

// ---------------------------------------------------------------------------
// Proactive: option→goal shortcut removal
// ---------------------------------------------------------------------------

/**
 * Remove option→goal shortcut edges.
 *
 * For each forbidden option→goal edge:
 * 1. If the option already has a complete path to goal through factors and
 *    outcomes/risks (via allowed patterns), remove the shortcut.
 * 2. If no valid path exists, find the controllable factor the option connects to,
 *    find or create an outcome that bridges to the goal, and reroute the chain.
 * 3. If no controllable factor exists, log a warning and defer to LLM repair.
 */
export function fixOptionGoalShortcut(graph: GraphT, format: EdgeFormat): {
  repairs: Repair[];
  removedCount: number;
  rerouted: number;
  skippedCount: number;
} {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Normalise "action" → "option" for topology matching (V3 compat)
  const nodeKindMap = new Map<string, string>();
  const nodeLabelMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, normaliseKind(node.kind));
    nodeLabelMap.set(node.id, node.label ?? node.id);
  }

  // Find controllable factors (explicitly tagged or inferred from option→factor edges)
  const controllableIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "factor" && node.category === "controllable") controllableIds.add(node.id);
  }
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
      controllableIds.add(edge.to);
    }
  }

  // Which controllable factors does each option connect to?
  const optionToFactors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "option" && controllableIds.has(edge.to)) {
      const set = optionToFactors.get(edge.from) ?? new Set();
      set.add(edge.to);
      optionToFactors.set(edge.from, set);
    }
  }

  // Check if option can reach goal via allowed patterns (excluding the forbidden edge)
  function optionCanReachGoal(optionId: string, goalId: string, excludeEdge: EdgeT): boolean {
    // BFS forward from option, but only follow option→factor edges first
    const optFactors = optionToFactors.get(optionId);
    if (!optFactors || optFactors.size === 0) return false;

    // From each controllable factor, check if goal is reachable via allowed patterns
    for (const fId of optFactors) {
      if (canReachGoalViaAllowed(fId, nodeKindMap, edges, excludeEdge)) return true;
    }
    return false;
  }

  const keptEdges: EdgeT[] = [];
  const newNodes: NodeT[] = [];
  const newEdges: EdgeT[] = [];
  let removedCount = 0;
  let rerouted = 0;
  let skippedCount = 0;

  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    if (fromKind === "option" && toKind === "goal") {
      // Case 1: option has a valid path to goal through factors — safe to remove
      if (optionCanReachGoal(edge.from, edge.to, edge)) {
        removedCount++;
        repairs.push({
          code: "FORBIDDEN_EDGE_AUTO_FIXED",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Removed option→goal shortcut (valid path exists via factors)`,
        });
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_fixed",
          from: edge.from,
          to: edge.to,
          pattern: "option_goal_shortcut",
        }, `Auto-fixed forbidden edge: option→goal shortcut ${edge.from}→${edge.to}`);
        continue;
      }

      // Case 2: reroute via controllable factor + synthetic outcome
      const optFactors = optionToFactors.get(edge.from);
      if (optFactors && optFactors.size > 0) {
        const bridgeFactor = optFactors.values().next().value;
        const factorLabel = nodeLabelMap.get(bridgeFactor!) ?? bridgeFactor;
        let outcomeId = `out_${bridgeFactor}_impact`;

        // Verify existing node (if any) is kind-compatible; generate collision-safe ID otherwise
        if (nodeKindMap.has(outcomeId) && nodeKindMap.get(outcomeId) !== "outcome") {
          let suffix = 2;
          while (nodeKindMap.has(`out_${bridgeFactor}_impact_${suffix}`)) suffix++;
          outcomeId = `out_${bridgeFactor}_impact_${suffix}`;
        }

        // Create synthetic outcome if it doesn't exist
        if (!nodeKindMap.has(outcomeId)) {
          newNodes.push({
            id: outcomeId,
            kind: "outcome",
            label: `${factorLabel} Impact`,
          } as NodeT);
          nodeKindMap.set(outcomeId, "outcome");
        }

        // factor→outcome edge (if not already present)
        const hasFactorOutcome = edges.some(
          (e) => e.from === bridgeFactor && e.to === outcomeId,
        ) || newEdges.some((e) => e.from === bridgeFactor && e.to === outcomeId);

        if (!hasFactorOutcome) {
          newEdges.push(patchEdgeNumeric(
            {
              from: bridgeFactor,
              to: outcomeId,
              effect_direction: "positive",
              origin: "repair",
              provenance: { source: "synthetic", quote: "Rerouted option→goal via factor→outcome→goal" },
              provenance_source: "synthetic",
            } as EdgeT,
            format,
            { mean: 0.5, std: 0.15, existence: 0.9 },
          ));
        }

        // outcome→goal edge (if not already present)
        const hasOutcomeGoal = edges.some(
          (e) => e.from === outcomeId && e.to === edge.to,
        ) || newEdges.some((e) => e.from === outcomeId && e.to === edge.to);

        if (!hasOutcomeGoal) {
          newEdges.push(patchEdgeNumeric(
            {
              from: outcomeId,
              to: edge.to,
              effect_direction: "positive",
              origin: "repair",
              provenance: { source: "synthetic", quote: "Rerouted option→goal via factor→outcome→goal" },
              provenance_source: "synthetic",
            } as EdgeT,
            format,
            { mean: 0.5, std: 0.15, existence: 0.9 },
          ));
        }

        removedCount++;
        rerouted++;
        repairs.push({
          code: "FORBIDDEN_EDGE_AUTO_FIXED",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Rerouted option→goal via ${bridgeFactor}→${outcomeId}→${edge.to}`,
        });
        log.info({
          event: "cee.deterministic_sweep.forbidden_edge_fixed",
          from: edge.from,
          to: edge.to,
          bridge_factor: bridgeFactor,
          outcome: outcomeId,
          pattern: "option_goal_shortcut_rerouted",
        }, `Rerouted forbidden edge: option→goal ${edge.from}→${edge.to} via ${bridgeFactor}→${outcomeId}`);
        continue;
      }

      // Case 3: no controllable factor — defer to LLM repair
      skippedCount++;
      keptEdges.push(edge);
      log.warn({
        event: "cee.deterministic_sweep.forbidden_edge_deferred",
        from: edge.from,
        to: edge.to,
        pattern: "option_goal_no_factor",
        reason: "no controllable factor available; deferred to LLM repair",
      }, `Deferred forbidden edge to LLM: option→goal ${edge.from}→${edge.to} (no controllable factor)`);
    } else {
      keptEdges.push(edge);
    }
  }

  if (removedCount > 0 || newEdges.length > 0 || newNodes.length > 0) {
    (graph as any).nodes = [...nodes, ...newNodes];
    (graph as any).edges = [...keptEdges, ...newEdges];
  }

  return { repairs, removedCount, rerouted, skippedCount };
}

// ---------------------------------------------------------------------------
// Proactive: disconnected observable/external pruning
// ---------------------------------------------------------------------------

/**
 * Remove observable or external factors with zero connected edges.
 *
 * These nodes carry no causal influence (no inbound or outbound edges) and
 * trigger ORPHAN_NODE violations.  Controllable factors are never pruned —
 * they represent actionable levers even when temporarily disconnected.
 */
export function fixDisconnectedObservables(graph: GraphT): { repairs: Repair[]; pruned: string[] } {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const edgeNodes = new Set<string>();
  for (const edge of edges) {
    edgeNodes.add(edge.from);
    edgeNodes.add(edge.to);
  }

  const pruned: string[] = [];
  const keptNodes: NodeT[] = [];
  for (const node of nodes) {
    if (
      node.kind === "factor" &&
      (node.category === "observable" || node.category === "external") &&
      !edgeNodes.has(node.id)
    ) {
      pruned.push(node.id);
      repairs.push({
        code: "DISCONNECTED_OBSERVABLE_PRUNED",
        path: `nodes[${node.id}]`,
        action: `Removed ${node.category} factor "${node.label ?? node.id}" with zero edges`,
      });
      // Per-node structured log (brief contract). PII rule (14-Jul
      // ruling): node ids are label-derived slugs and labels are user
      // decision content — the log carries a correlation digest and the
      // bounded category enum only; the raw id/label never reaches the
      // message string (path-based redaction cannot clean interpolated
      // prose, so the call site must not interpolate it).
      log.info({
        event: "cee.deterministic_sweep.observable_pruned",
        node_id_digest: sha8(node.id),
        category: node.category,
      }, `Pruned disconnected ${node.category} factor with zero edges`);
    } else {
      keptNodes.push(node);
    }
  }

  if (pruned.length > 0) {
    (graph as any).nodes = keptNodes;

    // Clean up intervention references on option nodes that point to pruned factors
    const prunedSet = new Set(pruned);
    for (const node of keptNodes) {
      if (node.kind !== "option") continue;
      const data = (node as any).data;
      if (!data?.interventions || typeof data.interventions !== "object") continue;
      for (const factorId of Object.keys(data.interventions)) {
        if (prunedSet.has(factorId)) {
          delete data.interventions[factorId];
          repairs.push({
            code: "DISCONNECTED_OBSERVABLE_PRUNED",
            path: `nodes[${node.id}].data.interventions[${factorId}]`,
            action: `Removed intervention reference to pruned factor "${factorId}"`,
          });
        }
      }
    }
  }

  return { repairs, pruned };
}

// ---------------------------------------------------------------------------
// Complexity cap: proportional edge pruning
// ---------------------------------------------------------------------------

/**
 * Edge limits proportional to the number of options in the decision.
 *
 * PLoT enforces an absolute MAX_EDGES cap (from @talchain/schemas) but does
 * NOT enforce proportional limits.  Over-dense graphs slow ISL and produce
 * noisy sensitivity distributions.  Pruning weak non-structural edges keeps
 * the causal model tractable.
 *
 * Structural edges (decision→option, option→factor/outcome/risk) are exempt
 * from pruning — they define the topology and must be preserved.
 *
 * Limits chosen empirically from benchmark runs (2026-03-18):
 *   2 options  → 15 total edges
 *   3 options  → 25 total edges
 *   4+ options → 35 total edges
 */
const COMPLEXITY_CAP_BY_OPTION_COUNT: Record<number, number> = {
  2: 15,
  3: 25,
};
const COMPLEXITY_CAP_DEFAULT = 35;
const PRUNE_WEIGHT_THRESHOLD = 0.1; // Prune non-structural edges with strength_mean < this

/**
 * Whether an edge is structural (must not be pruned):
 *   decision→option, option→factor, option→outcome, option→risk
 */
function isStructuralEdgeForCap(
  sourceKind: string | undefined,
  targetKind: string | undefined,
): boolean {
  if (sourceKind === "decision" && targetKind === "option") return true;
  if (sourceKind === "option" && (targetKind === "factor" || targetKind === "outcome" || targetKind === "risk")) return true;
  return false;
}

/**
 * Prune weak non-structural edges when graph exceeds the proportional edge cap.
 *
 * Only prunes edges with strength_mean < PRUNE_WEIGHT_THRESHOLD.
 * Stops pruning once the edge count falls within the cap — never over-prunes.
 */
export function applyComplexityCap(graph: GraphT): { repairs: Repair[]; prunedCount: number } {
  const repairs: Repair[] = [];
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Count option nodes to determine the cap
  const optionCount = nodes.filter((n) => n.kind === "option").length;
  if (optionCount === 0) return { repairs, prunedCount: 0 };

  const cap = COMPLEXITY_CAP_BY_OPTION_COUNT[optionCount] ?? COMPLEXITY_CAP_DEFAULT;

  if (edges.length <= cap) return { repairs, prunedCount: 0 };

  // Build kind lookup
  const kindMap = new Map<string, string>();
  for (const n of nodes) {
    kindMap.set(n.id, n.kind);
  }

  // Collect non-structural edges weak enough to prune
  const pruneableCandidates: { edge: EdgeT; weight: number }[] = [];

  for (const edge of edges) {
    const srcKind = kindMap.get(edge.from);
    const tgtKind = kindMap.get(edge.to);
    if (!isStructuralEdgeForCap(srcKind, tgtKind)) {
      const mean = edge.strength_mean ?? (edge as any).weight ?? 0.5;
      const absWeight = Math.abs(mean);
      if (absWeight < PRUNE_WEIGHT_THRESHOLD) {
        pruneableCandidates.push({ edge, weight: absWeight });
      }
    }
  }

  if (pruneableCandidates.length === 0) return { repairs, prunedCount: 0 };

  // Sort weakest first — prune as few as needed
  pruneableCandidates.sort((a, b) => a.weight - b.weight);

  const toRemove = new Set<string>();
  let remaining = edges.length;

  for (const { edge } of pruneableCandidates) {
    if (remaining <= cap) break;
    const edgeKey = edge.id ?? `${edge.from}→${edge.to}`;
    toRemove.add(edgeKey);
    remaining--;
    repairs.push({
      code: "COMPLEXITY_CAP_PRUNE",
      path: `edges[${edgeKey}]`,
      action: `Pruned weak edge ${edge.from}→${edge.to} (strength_mean=${edge.strength_mean ?? (edge as any).weight ?? 0.5}) — graph exceeded ${optionCount}-option cap of ${cap} edges`,
    });
  }

  if (toRemove.size > 0) {
    (graph as any).edges = edges.filter((e) => {
      const key = e.id ?? `${e.from}→${e.to}`;
      return !toRemove.has(key);
    });
  }

  return { repairs, prunedCount: toRemove.size };
}

// ---------------------------------------------------------------------------
// Main sweep
// ---------------------------------------------------------------------------

/**
 * Run the deterministic pre-repair sweep.
 *
 * 1. Capture before-counts for observability
 * 2. Collect validation errors from graph-validator
 * 3. Detect edge format
 * 4. Partition into Bucket A, B, C
 * 5. Apply Bucket A fixes
 * 6. Apply Bucket B fixes (only for cited codes)
 * 6b. Goal threshold validation (proactive)
 * 6c. Factor→goal topology repair (proactive)
 * 7. Unreachable factor handling
 * 8. Status quo fix
 * 9. Re-validate
 * 10. Oscillation guard
 * 11. Write results to ctx
 */
export async function runDeterministicSweep(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  const graph = ctx.graph as GraphT;
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Step 1: Capture before-counts
  const nodesBefore = nodes.length;
  const edgesBefore = edges.length;

  // Step 2: Detect edge format once (needed by all downstream steps)
  const format = detectEdgeFormat(edges);
  ctx.detectedEdgeFormat = format;

  // Step 3: Collect validation errors using the graph-validator
  // Pre-sweep diagnostic — informational only, do not fail on these results.
  // v0.11.0 schema amendment: pass coaching + causalClaims to enable
  // referential-integrity warnings (CAUSAL_CLAIM_INVALID_REF, etc).
  const validationResult = validateGraphDeterministic({
    graph,
    requestId: ctx.requestId,
    phase: "pre_sweep_diagnostic",
    coaching: ctx.coaching,
    causalClaims: ctx.causalClaims,
  });
  const allViolations = validationResult.errors;

  log.info({
    event: "cee.deterministic_sweep.started",
    request_id: ctx.requestId,
    sweep_version: DETERMINISTIC_SWEEP_VERSION,
    violations_in: allViolations.length,
    node_count: nodesBefore,
    edge_count: edgesBefore,
  }, "Deterministic sweep started");

  const allRepairs: Repair[] = [];
  const allDeletions: FieldDeletionEvent[] = [];

  // Hoist bucket counts so they are available for repairTrace regardless of violations
  let bucketACount = 0;
  let bucketBCount = 0;
  let bucketCCount = 0;

  // Step 4: Apply Bucket A/B fixes when violations exist
  if (allViolations.length > 0) {
    // Partition into buckets
    const bucketA = allViolations.filter((v) => BUCKET_A_CODES.has(v.code));
    const bucketB = allViolations.filter((v) => BUCKET_B_CODES.has(v.code));
    const bucketC = allViolations.filter((v) => BUCKET_C_CODES.has(v.code));
    bucketACount = bucketA.length;
    bucketBCount = bucketB.length;
    bucketCCount = bucketC.length;
    const citedBCodes = new Set(bucketB.map((v) => v.code));

    log.info({
      requestId: ctx.requestId,
      stage: "deterministic_sweep",
      violations_total: allViolations.length,
      bucket_a: bucketACount,
      bucket_b: bucketBCount,
      bucket_c: bucketCCount,
      bucket_a_codes: [...new Set(bucketA.map((v) => v.code))],
      bucket_b_codes: [...citedBCodes],
      bucket_c_codes: [...new Set(bucketC.map((v) => v.code))],
    }, "Deterministic sweep: violation routing");

    // Per-violation routing log for debugging (capped at 30 to avoid log flood)
    for (const v of allViolations.slice(0, 30)) {
      const bucket = BUCKET_A_CODES.has(v.code) ? "A" : BUCKET_B_CODES.has(v.code) ? "B" : "C";
      const action = bucket === "A" ? "fixed" : bucket === "B" ? "fixed" : "forwarded_to_llm";
      log.info({
        event: "cee.deterministic_sweep.violation_routed",
        request_id: ctx.requestId,
        code: v.code,
        node_id: v.path,
        bucket,
        action,
      }, `Violation ${v.code} → Bucket ${bucket}`);
    }

    // Apply Bucket A in single pass
    allRepairs.push(...fixNanValues(graph, bucketA));
    allRepairs.push(...fixSignMismatch(graph, bucketA));
    allRepairs.push(...fixStructuralEdgesNotCanonical(graph, bucketA, format));
    allRepairs.push(...fixInvalidEdgeRefs(graph, bucketA));
    allRepairs.push(...fixGoalHasOutgoing(graph, bucketA));
    allRepairs.push(...fixDecisionHasIncoming(graph, bucketA));
    allRepairs.push(...fixCyclesDeterministic(graph));

    // Apply Bucket B only for codes present in violations
    if (citedBCodes.has("CATEGORY_MISMATCH")) {
      allRepairs.push(...fixCategoryMismatch(graph, bucketB));
    }
    if (citedBCodes.has("CONTROLLABLE_MISSING_DATA")) {
      allRepairs.push(...fixControllableMissingData(graph, bucketB));
    }
    if (citedBCodes.has("OBSERVABLE_MISSING_DATA")) {
      allRepairs.push(...fixObservableMissingData(graph, bucketB));
    }
    if (citedBCodes.has("OBSERVABLE_EXTRA_DATA")) {
      const obsResult = fixObservableExtraData(graph, bucketB);
      allRepairs.push(...obsResult.repairs);
      allDeletions.push(...obsResult.fieldDeletions);
    }
    if (citedBCodes.has("EXTERNAL_HAS_DATA")) {
      const extResult = fixExternalHasData(graph, bucketB);
      allRepairs.push(...extResult.repairs);
      allDeletions.push(...extResult.fieldDeletions);
    }
    if (citedBCodes.has("INVALID_INTERVENTION_REF")) {
      allRepairs.push(...fixInvalidInterventionRefs(graph));
    }
  }

  // Step 4b: Goal threshold hygiene — execution moved to Stage 4b (threshold-sweep.ts).
  // Helper functions (fixGoalThresholdNoRaw, warnGoalThresholdPossiblyInferred) remain
  // exported for backward-compatible unit tests. Stage 4b writes final counts to
  // ctx.repairTrace.deterministic_sweep after this function creates the trace object.
  const THRESHOLD_SWEEP_MOVED_TO_STAGE_4B = true;
  if (!THRESHOLD_SWEEP_MOVED_TO_STAGE_4B) {
    // Dead code — retained so the intent of the gate is unmissable.
    // Remove this block entirely once Stage 4b has been stable for several releases.
    fixGoalThresholdNoRaw(graph);
    warnGoalThresholdPossiblyInferred(graph);
  }

  // Step 4c: Factor→goal topology repair — ALWAYS run regardless of violations.
  // The LLM may short-circuit the causal chain under cost-reduction / minimisation framing,
  // producing factor→goal edges that violate the ALLOWED_EDGES topology.
  // This splits each factor→goal edge into factor→outcome→goal via a synthetic outcome node.
  const factorGoalResult = fixFactorGoalEdges(graph, format);
  allRepairs.push(...factorGoalResult.repairs);

  if (factorGoalResult.splitCount > 0) {
    log.info({
      event: "cee.deterministic_sweep.factor_goal_split",
      request_id: ctx.requestId,
      split_count: factorGoalResult.splitCount,
    }, `Split ${factorGoalResult.splitCount} factor→goal edge(s) via synthetic outcome nodes`);
  }

  // Step 4d: Option→outcome shortcut removal — ALWAYS run.
  // Removes option→outcome edges when the outcome already reaches goal via valid chain.
  const optionOutcomeResult = fixOptionOutcomeShortcut(graph);
  allRepairs.push(...optionOutcomeResult.repairs);

  if (optionOutcomeResult.removedCount > 0) {
    log.info({
      event: "cee.deterministic_sweep.option_outcome_shortcut",
      request_id: ctx.requestId,
      removed_count: optionOutcomeResult.removedCount,
      skipped_count: optionOutcomeResult.skippedCount,
    }, `Removed ${optionOutcomeResult.removedCount} option→outcome shortcut(s)`);
  }

  // Step 4e: Option→risk shortcut removal — gated by ENABLE_OPTION_SHORTCUT_REPAIR.
  // Removes option→risk edges by removing (when valid path exists) or rerouting
  // through a controllable factor.
  let optionRiskResult = { repairs: [] as Repair[], removedCount: 0, rerouted: 0, skippedCount: 0 };
  if (config.features.optionShortcutRepair) {
    optionRiskResult = fixOptionRiskShortcut(graph, format);
    allRepairs.push(...optionRiskResult.repairs);

    if (optionRiskResult.removedCount > 0) {
      log.info({
        event: "cee.deterministic_sweep.option_risk_shortcut",
        request_id: ctx.requestId,
        removed_count: optionRiskResult.removedCount,
        rerouted: optionRiskResult.rerouted,
        skipped_count: optionRiskResult.skippedCount,
      }, `Fixed ${optionRiskResult.removedCount} option→risk shortcut(s)`);
    }
  }

  // Step 4f: Option→goal shortcut removal — gated by ENABLE_OPTION_SHORTCUT_REPAIR.
  // Removes option→goal edges by removing (when valid path exists) or rerouting
  // through a controllable factor and synthetic outcome.
  let optionGoalResult = { repairs: [] as Repair[], removedCount: 0, rerouted: 0, skippedCount: 0 };
  if (config.features.optionShortcutRepair) {
    optionGoalResult = fixOptionGoalShortcut(graph, format);
    allRepairs.push(...optionGoalResult.repairs);

    if (optionGoalResult.removedCount > 0) {
      log.info({
        event: "cee.deterministic_sweep.option_goal_shortcut",
        request_id: ctx.requestId,
        removed_count: optionGoalResult.removedCount,
        rerouted: optionGoalResult.rerouted,
        skipped_count: optionGoalResult.skippedCount,
      }, `Fixed ${optionGoalResult.removedCount} option→goal shortcut(s)`);
    }
  }

  // Step 4g: Remaining forbidden edge patterns — ALWAYS run.
  const remainingForbiddenResult = fixRemainingForbiddenEdges(graph, ctx.requestId);
  allRepairs.push(...remainingForbiddenResult.repairs);

  if (remainingForbiddenResult.removedCount > 0) {
    log.info({
      event: "cee.deterministic_sweep.remaining_forbidden_edges",
      request_id: ctx.requestId,
      removed_count: remainingForbiddenResult.removedCount,
    }, `Removed ${remainingForbiddenResult.removedCount} remaining forbidden edge(s)`);
  }

  // Step 5: Proactive unreachable factor handling — ALWAYS run regardless of violations.
  // simpleRepair (Stage 3) preserves unreachable factors but doesn't reclassify them.
  // The sweep must detect and reclassify them so model_adjustments gets populated.
  const unreachableResult = handleUnreachableFactors(graph, format);
  allRepairs.push(...unreachableResult.repairs);
  allDeletions.push(...unreachableResult.fieldDeletions);

  // Step 6: Status quo / disconnected option fix — ALWAYS run.
  // Uses proactive reachability check (BFS from each option to goal).
  // This catches cases where the graph validator doesn't flag NO_PATH_TO_GOAL
  // but the orchestrator validation loop would later (causing 422s).
  const disconnectedBefore = findDisconnectedOptions(graph);
  const violationCodes = allViolations.map((v) => ({ code: v.code }));

  // If we proactively found disconnected options, synthesize violations to trigger the fix
  if (disconnectedBefore.length > 0 && !violationCodes.some((v) => v.code === "NO_PATH_TO_GOAL")) {
    violationCodes.push({ code: "NO_PATH_TO_GOAL" });
  }

  const statusQuoResult = fixStatusQuoConnectivity(graph, violationCodes, format);
  allRepairs.push(...statusQuoResult.repairs);

  // Step 6b: Proactive disconnected-observable pruning — ALWAYS run.
  // Observable/external factors with zero edges (no inbound or outbound) contribute
  // nothing to the causal model. LLMs (especially gpt-4o) emit these as context data
  // without wiring them, causing ORPHAN_NODE violations. Pruning is safe because
  // these nodes have no causal influence on any metric.
  // Controllable factors are NEVER pruned — they represent actionable levers.
  const disconnectedObservableResult = fixDisconnectedObservables(graph);
  allRepairs.push(...disconnectedObservableResult.repairs);

  // Step 6c: Proportional complexity cap — ALWAYS run.
  // PLoT enforces an absolute MAX_EDGES cap but not a per-option-count cap.
  // This step prunes weak non-structural edges (strength_mean < 0.1) when the
  // graph exceeds the proportional limit for the number of options.
  const complexityCapResult = applyComplexityCap(graph);
  allRepairs.push(...complexityCapResult.repairs);

  if (complexityCapResult.prunedCount > 0) {
    log.info({
      event: "cee.deterministic_sweep.complexity_cap",
      request_id: ctx.requestId,
      pruned_count: complexityCapResult.prunedCount,
    }, `Complexity cap: pruned ${complexityCapResult.prunedCount} weak edge(s)`);
  }
  // Warn if graph is still over cap after pruning (insufficient weak edges to prune further)
  const edgesAfterCap = (graph as any).edges as EdgeT[];
  const optionsAfterCap = ((graph as any).nodes as NodeT[]).filter((n: NodeT) => n.kind === "option").length;
  if (optionsAfterCap > 0) {
    const capAfter = COMPLEXITY_CAP_BY_OPTION_COUNT[optionsAfterCap] ?? COMPLEXITY_CAP_DEFAULT;
    if (edgesAfterCap.length > capAfter) {
      log.warn({
        event: "cee.deterministic_sweep.complexity_cap_exceeded",
        request_id: ctx.requestId,
        edge_count: edgesAfterCap.length,
        cap: capAfter,
        option_count: optionsAfterCap,
      }, `Complexity cap not fully met after pruning: ${edgesAfterCap.length} edges > cap of ${capAfter} (no more weak edges to prune)`);
    }
  }

  // Step 7: Re-validate using same validator (post-sweep authoritative pass).
  // v0.11.0 schema amendment: pass coaching + causalClaims to enable
  // referential-integrity warnings against the post-sweep graph IDs.
  const revalidation = validateGraphDeterministic({
    graph,
    requestId: ctx.requestId,
    phase: "post_sweep_authoritative",
    coaching: ctx.coaching,
    causalClaims: ctx.causalClaims,
  });
  const remainingErrors = revalidation.errors;

  // Step 8: Proactive disconnected-option check after all fixes.
  // If options are still disconnected after the status quo fix, flag for LLM repair.
  const disconnectedAfter = findDisconnectedOptions(graph);
  let proactiveDisconnected = false;
  if (disconnectedAfter.length > 0) {
    proactiveDisconnected = true;
    // Add synthetic remaining violations for disconnected options not already flagged.
    //
    // The suppression test MUST be format-agnostic: the paths in this set are
    // minted by graph-validator (`nodesById.<id>`) while the path we are about
    // to push is minted by this sweep (`nodes[<id>]`). Comparing one literal
    // against the other — as this guard used to — can never match, so every
    // already-flagged option was reported twice. `pathsNameNode` derives both
    // spellings from the shared builders instead of re-writing either literal
    // here (platform trap 12: derive, don't mirror).
    const existingPaths = new Set(
      remainingErrors
        .filter((v) => v.code === "NO_PATH_TO_GOAL")
        .map((v) => v.path)
        .filter((p): p is string => typeof p === "string"),
    );
    for (const optId of disconnectedAfter) {
      if (!pathsNameNode(existingPaths, optId)) {
        remainingErrors.push({
          code: "NO_PATH_TO_GOAL" as any,
          severity: "error" as any,
          message: `Option "${optId}" has no directed path to goal (proactive check)`,
          path: sweepNodePath(optId),
        });
      }
    }
  }

  // Determine if LLM repair is needed
  const remainingBucketC = remainingErrors.filter((v) => BUCKET_C_CODES.has(v.code));
  const externalValidationNeeded = !revalidation.valid || proactiveDisconnected;
  const llmRepairNeeded = remainingBucketC.length > 0 && externalValidationNeeded;

  // Step 8b: Push field deletion audit events to ctx
  recordFieldDeletions(ctx, 'deterministic-sweep', allDeletions);

  // Step 9: Write to ctx
  ctx.deterministicRepairs = allRepairs;
  // Preserve validator-specific `context` field (e.g. OPTIONS_IDENTICAL →
  // { optionIds, signature }) so the pre-LLM-repair fail-fast gate in
  // stages/repair/index.ts can surface diagnostic data (identical option
  // IDs) without re-running the validator.
  ctx.remainingViolations = remainingErrors.map((v) => ({
    code: v.code,
    path: v.path,
    message: v.message,
    ...((v as { context?: Record<string, unknown> }).context
      ? { context: (v as { context?: Record<string, unknown> }).context }
      : {}),
  }));
  ctx.llmRepairNeeded = llmRepairNeeded;

  // Store unreachable factor and status quo results on repairTrace for observability.
  // Always emitted — proves the sweep executed regardless of whether it had work to do.
  ctx.repairTrace = {
    ...(ctx.repairTrace ?? {}),
    deterministic_sweep: {
      sweep_ran: true,
      sweep_version: DETERMINISTIC_SWEEP_VERSION,
      bucket_summary: { a: bucketACount, b: bucketBCount, c: bucketCCount },
      repairs_count: allRepairs.length,
      unreachable_factors: {
        reclassified: unreachableResult.reclassified,
        marked_droppable: unreachableResult.markedDroppable,
      },
      // Initialised to 0 — Stage 4b (threshold-sweep.ts) overwrites with actual counts.
      goal_threshold_stripped: 0,
      goal_threshold_possibly_inferred: 0,
      factor_goal_splits: factorGoalResult.splitCount,
      option_outcome_shortcuts_removed: optionOutcomeResult.removedCount,
      option_outcome_shortcuts_skipped: optionOutcomeResult.skippedCount,
      option_risk_shortcuts_removed: optionRiskResult.removedCount,
      option_risk_shortcuts_rerouted: optionRiskResult.rerouted,
      option_risk_shortcuts_skipped: optionRiskResult.skippedCount,
      option_goal_shortcuts_removed: optionGoalResult.removedCount,
      option_goal_shortcuts_rerouted: optionGoalResult.rerouted,
      option_goal_shortcuts_skipped: optionGoalResult.skippedCount,
      remaining_forbidden_edges_removed: remainingForbiddenResult.removedCount,
      disconnected_observables_pruned: disconnectedObservableResult.pruned,
      complexity_cap_pruned: complexityCapResult.prunedCount,
      status_quo: {
        fixed: statusQuoResult.fixed,
        marked_droppable: statusQuoResult.markedDroppable,
      },
      disconnected_options_before: disconnectedBefore,
      disconnected_options_after: disconnectedAfter,
      violations_before: allViolations.length,
      violations_after: remainingErrors.length,
      llm_repair_needed: llmRepairNeeded,
      edge_format: format,
      graph_delta: {
        nodes_before: nodesBefore,
        nodes_after: ((graph as any).nodes as NodeT[]).length,
        edges_before: edgesBefore,
        edges_after: ((graph as any).edges as EdgeT[]).length,
      },
      rescue_score: computeRescueScore(allRepairs, unreachableResult, llmRepairNeeded),
    },
  };

  // Derive status quo action for log
  const statusQuoAction: "wired" | "droppable" | "none" =
    statusQuoResult.fixed ? "wired" : statusQuoResult.markedDroppable ? "droppable" : "none";

  log.info({
    event: "cee.deterministic_sweep.completed",
    request_id: ctx.requestId,
    sweep_version: DETERMINISTIC_SWEEP_VERSION,
    violations_in: allViolations.length,
    violations_out: remainingErrors.length,
    repairs_count: allRepairs.length,
    status_quo_action: statusQuoAction,
    llm_repair_needed: llmRepairNeeded,
    // goal_threshold_stripped / goal_threshold_possibly_inferred: emitted by Stage 4b event
    factor_goal_splits: factorGoalResult.splitCount,
    unreachable_reclassified: unreachableResult.reclassified.length,
    unreachable_droppable: unreachableResult.markedDroppable.length,
    disconnected_before: disconnectedBefore.length,
    disconnected_after: disconnectedAfter.length,
    disconnected_observables_pruned: disconnectedObservableResult.pruned.length,
    complexity_cap_pruned: complexityCapResult.prunedCount,
    edge_format: format,
  }, "Deterministic sweep completed");
}
