/**
 * Structural Truth Reconciliation Pass (STRP)
 *
 * Deterministic metadata reconciliation that runs BEFORE simpleRepair
 * and validateGraph. Corrects LLM-declared metadata that contradicts
 * the graph structure the LLM itself built.
 *
 * Pipeline order: LLM draft → STRP → simpleRepair → validateGraph
 *
 * Invariants:
 * - Does not add or remove nodes or edges
 * - Idempotent: STRP(STRP(graph)) === STRP(graph)
 * - Every field modification has a corresponding mutation record
 * - Only modifies fields explicitly handled by a rule
 *
 * @module validators/structural-reconciliation
 */

import { log } from "../utils/telemetry.js";
import type { GraphT, NodeT, EdgeT, FactorDataT } from "../schemas/graph.js";
import {
  FactorType,
  FactorCategory as ZodFactorCategory,
  EffectDirection,
  FactorData,
} from "../schemas/graph.js";
import type {
  FactorCategory,
  FactorCategoryInfo,
  NodeMap,
  ValidationIssue,
  ConstraintNormalisationResult,
} from "./graph-validator.types.js";

// =============================================================================
// Types
// =============================================================================

export interface STRPMutation {
  rule: string;
  code: string;
  node_id?: string;
  edge_id?: string;
  constraint_id?: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
  severity: "info" | "warn";
}

export interface STRPResult {
  graph: GraphT;
  mutations: STRPMutation[];
  /** Normalised constraints (only populated when goalConstraints provided) */
  goalConstraints?: Array<{ node_id: string; [key: string]: unknown }>;
}

// =============================================================================
// Shared helpers (re-used from graph-validator internal helpers)
// =============================================================================

function buildNodeMap(nodes: NodeT[]): NodeMap {
  const byId = new Map<string, NodeT>();
  const byKind = new Map<string, NodeT[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    const kindList = byKind.get(node.kind) ?? [];
    kindList.push(node);
    byKind.set(node.kind, kindList);
  }

  return { byId, byKind };
}

function inferFactorCategories(
  nodes: NodeT[],
  edges: EdgeT[],
  nodeMap: NodeMap
): Map<string, FactorCategoryInfo> {
  const categories = new Map<string, FactorCategoryInfo>();

  const optionIds = new Set(
    (nodeMap.byKind.get("option") ?? []).map((n) => n.id)
  );

  const factorsWithOptionEdge = new Set<string>();
  for (const edge of edges) {
    if (optionIds.has(edge.from)) {
      factorsWithOptionEdge.add(edge.to);
    }
  }

  const factors = nodeMap.byKind.get("factor") ?? [];
  for (const node of factors) {
    const hasOptionEdge = factorsWithOptionEdge.has(node.id);
    const data = node.data as FactorDataT | undefined;
    const hasValue = data?.value !== undefined;

    const explicitCategory = node.category as FactorCategory | undefined;

    let category: FactorCategory;
    if (hasOptionEdge) {
      category = "controllable";
    } else if (hasValue) {
      category = "observable";
    } else {
      category = "external";
    }

    categories.set(node.id, {
      nodeId: node.id,
      category,
      hasOptionEdge,
      hasValue,
      explicitCategory,
    });
  }

  return categories;
}

// =============================================================================
// Derive valid enum values from Zod schemas (source of truth)
// =============================================================================

const VALID_FACTOR_TYPES: Set<string> = new Set(FactorType.options);
const VALID_FACTOR_CATEGORIES: Set<string> = new Set(ZodFactorCategory.options);
const VALID_EFFECT_DIRECTIONS: Set<string> = new Set(EffectDirection.options);

/** Safe defaults: last/most-generic member of each enum */
const FACTOR_TYPE_DEFAULT = "other" as const;
const EXTRACTION_TYPE_DEFAULT = "inferred" as const;

// extractionType enum is inline on FactorData — derive from schema
const VALID_EXTRACTION_TYPES: Set<string> = new Set(
  FactorData.shape.extractionType.unwrap().options
);

// =============================================================================
// Rule 1: Category Override
// =============================================================================

function categoryOverrideRule(
  graph: GraphT,
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>
): STRPMutation[] {
  const mutations: STRPMutation[] = [];
  const factors = nodeMap.byKind.get("factor") ?? [];

  for (const node of factors) {
    const info = factorCategories.get(node.id);
    if (!info) continue;

    const declared = node.category as FactorCategory | undefined;
    const inferred = info.category;

    // Nothing to override when categories already agree or no declared category
    if (!declared || declared === inferred) continue;

    // Overwrite the node's declared category with the inferred one
    (node as any).category = inferred;

    // Update the factorCategories map so downstream checks see corrected state
    factorCategories.set(node.id, { ...info, explicitCategory: inferred });

    const data = (node.data ?? {}) as Record<string, unknown>;

    if (inferred === "controllable") {
      // Reclassified TO controllable — auto-fill missing required fields
      if (!data.factor_type) {
        data.factor_type = FACTOR_TYPE_DEFAULT;
      }
      if (!data.uncertainty_drivers) {
        data.uncertainty_drivers = ["Estimation uncertainty"];
      }
      if (!node.data) {
        (node as any).data = data;
      }
    } else {
      // Reclassified FROM controllable to observable/external — strip extra fields
      if (data.factor_type !== undefined) {
        delete data.factor_type;
      }
      if (data.uncertainty_drivers !== undefined) {
        delete data.uncertainty_drivers;
      }
    }

    mutations.push({
      rule: "category_override",
      code: "CATEGORY_OVERRIDE",
      node_id: node.id,
      field: "category",
      before: declared,
      after: inferred,
      reason: `Structural inference: ${info.hasOptionEdge ? "has option edge → controllable" : info.hasValue ? "has value → observable" : "no option edge, no value → external"}`,
      severity: "info",
    });
  }

  return mutations;
}

// =============================================================================
// Rule 5: Controllable Data Completeness (late-pipeline only)
// =============================================================================

/**
 * Fill missing factor_type / uncertainty_drivers on ALL controllable factors.
 * Runs as a separate rule gated by `fillControllableData` so that it only
 * executes in the late-pipeline STRP pass — after enrichment and repair have
 * finished and can no longer overwrite the filled values.
 */
function controllableDataCompletenessRule(
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>
): STRPMutation[] {
  const mutations: STRPMutation[] = [];
  const factors = nodeMap.byKind.get("factor") ?? [];

  // TEMP DIAG — remove after verification
  console.log("[STRP-DIAG] Rule 5 entered", {
    factor_count: factors.length,
    controllable: factors.filter(n => factorCategories.get(n.id)?.category === "controllable").map(n => ({
      id: n.id,
      category: factorCategories.get(n.id)?.category,
      hasOptionEdge: factorCategories.get(n.id)?.hasOptionEdge,
      has_factor_type: !!(n.data as any)?.factor_type,
      has_uncertainty_drivers: !!(n.data as any)?.uncertainty_drivers,
    })),
  });
  // END TEMP DIAG

  for (const node of factors) {
    const info = factorCategories.get(node.id);
    if (!info || info.category !== "controllable") continue;

    const data = (node.data ?? {}) as Record<string, unknown>;

    if (!data.factor_type) {
      data.factor_type = FACTOR_TYPE_DEFAULT;
      if (!node.data) (node as any).data = data;
      mutations.push({
        rule: "controllable_data_completeness",
        code: "CONTROLLABLE_DATA_FILLED",
        node_id: node.id,
        field: "data.factor_type",
        before: undefined,
        after: FACTOR_TYPE_DEFAULT,
        reason: "Controllable factor missing required factor_type — filled with schema default",
        severity: "info",
      });
    }

    if (!data.uncertainty_drivers) {
      data.uncertainty_drivers = ["Estimation uncertainty"];
      if (!node.data) (node as any).data = data;
      mutations.push({
        rule: "controllable_data_completeness",
        code: "CONTROLLABLE_DATA_FILLED",
        node_id: node.id,
        field: "data.uncertainty_drivers",
        before: undefined,
        after: ["Estimation uncertainty"],
        reason: "Controllable factor missing required uncertainty_drivers — filled with default",
        severity: "info",
      });
    }
  }

  return mutations;
}

// =============================================================================
// Rule 2: Enum Validation
// =============================================================================

function enumValidationRule(graph: GraphT): STRPMutation[] {
  const mutations: STRPMutation[] = [];

  for (const node of graph.nodes) {
    // Validate factor_type on factor nodes
    if (node.kind === "factor" && node.data) {
      const data = node.data as Record<string, unknown>;

      if (data.factor_type !== undefined && !VALID_FACTOR_TYPES.has(data.factor_type as string)) {
        const before = data.factor_type;
        data.factor_type = FACTOR_TYPE_DEFAULT;
        mutations.push({
          rule: "enum_validation",
          code: "ENUM_VALUE_CORRECTED",
          node_id: node.id,
          field: "data.factor_type",
          before,
          after: FACTOR_TYPE_DEFAULT,
          reason: `Invalid factor_type "${before}" — valid: ${[...VALID_FACTOR_TYPES].join(", ")}`,
          severity: "warn",
        });
      }

      if (data.extractionType !== undefined && !VALID_EXTRACTION_TYPES.has(data.extractionType as string)) {
        const before = data.extractionType;
        data.extractionType = EXTRACTION_TYPE_DEFAULT;
        mutations.push({
          rule: "enum_validation",
          code: "ENUM_VALUE_CORRECTED",
          node_id: node.id,
          field: "data.extractionType",
          before,
          after: EXTRACTION_TYPE_DEFAULT,
          reason: `Invalid extractionType "${before}" — valid: ${[...VALID_EXTRACTION_TYPES].join(", ")}`,
          severity: "warn",
        });
      }
    }

    // Validate category on factor nodes (only if not handled by Rule 1)
    if (node.kind === "factor" && node.category !== undefined) {
      if (!VALID_FACTOR_CATEGORIES.has(node.category as string)) {
        const before = node.category;
        // Don't override here — Rule 1 handles category reconciliation.
        // Just strip invalid values so inference can fill correctly.
        (node as any).category = undefined;
        mutations.push({
          rule: "enum_validation",
          code: "ENUM_VALUE_CORRECTED",
          node_id: node.id,
          field: "category",
          before,
          after: undefined,
          reason: `Invalid category "${before}" — valid: ${[...VALID_FACTOR_CATEGORIES].join(", ")}; stripped for structural inference`,
          severity: "warn",
        });
      }
    }
  }

  // Validate effect_direction on edges
  for (const edge of graph.edges) {
    if (edge.effect_direction !== undefined && !VALID_EFFECT_DIRECTIONS.has(edge.effect_direction as string)) {
      const before = edge.effect_direction;
      // Default to positive for invalid direction
      (edge as any).effect_direction = "positive";
      mutations.push({
        rule: "enum_validation",
        code: "ENUM_VALUE_CORRECTED",
        edge_id: `${edge.from}::${edge.to}`,
        field: "effect_direction",
        before,
        after: "positive",
        reason: `Invalid effect_direction "${before}" — valid: ${[...VALID_EFFECT_DIRECTIONS].join(", ")}`,
        severity: "warn",
      });
    }
  }

  return mutations;
}

// =============================================================================
// Rule 3: Constraint Target Validation
// =============================================================================

const CONSTRAINT_NODE_PREFIXES = ["fac_", "out_", "risk_"];
const MIN_FUZZY_STEM_LENGTH = 4;

function stripNodePrefix(id: string): { stem: string; prefix: string } {
  for (const prefix of CONSTRAINT_NODE_PREFIXES) {
    if (id.startsWith(prefix)) {
      return { stem: id.slice(prefix.length), prefix };
    }
  }
  return { stem: id, prefix: "" };
}

function fuzzyMatchNodeId(
  constraintNodeId: string,
  nodeIds: string[]
): string | undefined {
  const { stem: constraintStem, prefix: constraintPrefix } = stripNodePrefix(constraintNodeId);
  const constraintStemLower = constraintStem.toLowerCase();

  if (constraintStemLower.length < MIN_FUZZY_STEM_LENGTH) return undefined;

  const matches: string[] = [];

  for (const nodeId of nodeIds) {
    const { stem: nodeStem, prefix: nodePrefix } = stripNodePrefix(nodeId);
    const nodeStemLower = nodeStem.toLowerCase();

    if (constraintPrefix && nodePrefix && constraintPrefix !== nodePrefix) continue;
    if (nodeStemLower.length < MIN_FUZZY_STEM_LENGTH) continue;

    if (nodeStemLower.includes(constraintStemLower) || constraintStemLower.includes(nodeStemLower)) {
      matches.push(nodeId);
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Normalise goal_constraints node_id values against actual graph nodes.
 *
 * - Exact match → keep
 * - Single fuzzy match → remap + emit CONSTRAINT_NODE_REMAPPED info
 * - No match / ambiguous → drop + emit CONSTRAINT_DROPPED_NO_TARGET info
 */
export function normaliseConstraintTargets(
  constraints: Array<{ node_id: string; [key: string]: unknown }>,
  nodeIds: string[],
  requestId?: string,
): ConstraintNormalisationResult {
  const issues: ValidationIssue[] = [];
  const result: Array<{ node_id: string; [key: string]: unknown }> = [];
  const nodeIdSet = new Set(nodeIds);

  let valid = 0;
  let remapped = 0;
  let dropped = 0;

  for (const constraint of constraints) {
    const originalNodeId = constraint.node_id;

    if (nodeIdSet.has(originalNodeId)) {
      result.push(constraint);
      valid++;
      continue;
    }

    const match = fuzzyMatchNodeId(originalNodeId, nodeIds);

    if (match) {
      result.push({ ...constraint, node_id: match });
      remapped++;
      issues.push({
        code: "CONSTRAINT_NODE_REMAPPED",
        severity: "info",
        message: `Constraint node_id "${originalNodeId}" remapped to "${match}"`,
        path: `goal_constraints[].node_id`,
        context: {
          original_node_id: originalNodeId,
          remapped_node_id: match,
          constraint_id: constraint.constraint_id,
        },
      });
    } else {
      dropped++;
      issues.push({
        code: "CONSTRAINT_DROPPED_NO_TARGET",
        severity: "info",
        message: `Constraint with node_id "${originalNodeId}" dropped — no matching node found`,
        path: `goal_constraints[].node_id`,
        context: {
          original_node_id: originalNodeId,
          constraint_id: constraint.constraint_id,
        },
      });
    }
  }

  if (issues.length > 0) {
    log.info(
      {
        event: "strp.constraint_normalisation",
        requestId,
        constraints_total: constraints.length,
        constraints_valid: valid,
        constraints_remapped: remapped,
        constraints_dropped: dropped,
      },
      `Constraint normalisation: ${valid} valid, ${remapped} remapped, ${dropped} dropped`
    );
  }

  return {
    constraints: result,
    issues,
    constraints_total: constraints.length,
    constraints_valid: valid,
    constraints_remapped: remapped,
    constraints_dropped: dropped,
  };
}

function constraintTargetRule(
  goalConstraints: Array<{ node_id: string; [key: string]: unknown }>,
  nodeIds: string[],
  requestId?: string,
): { mutations: STRPMutation[]; constraints: Array<{ node_id: string; [key: string]: unknown }> } {
  const normResult = normaliseConstraintTargets(goalConstraints, nodeIds, requestId);
  const mutations: STRPMutation[] = [];

  for (const issue of normResult.issues) {
    if (issue.code === "CONSTRAINT_NODE_REMAPPED") {
      mutations.push({
        rule: "constraint_target",
        code: "CONSTRAINT_REMAPPED",
        constraint_id: issue.context?.constraint_id as string,
        field: "node_id",
        before: issue.context?.original_node_id,
        after: issue.context?.remapped_node_id,
        reason: issue.message,
        severity: "info",
      });
    } else if (issue.code === "CONSTRAINT_DROPPED_NO_TARGET") {
      mutations.push({
        rule: "constraint_target",
        code: "CONSTRAINT_DROPPED",
        constraint_id: issue.context?.constraint_id as string,
        field: "node_id",
        before: issue.context?.original_node_id,
        after: null,
        reason: issue.message,
        severity: "info",
      });
    }
  }

  return { mutations, constraints: normResult.constraints };
}

// =============================================================================
// Rule 4: Sign Reconciliation
// =============================================================================

function signReconciliationRule(graph: GraphT): STRPMutation[] {
  const mutations: STRPMutation[] = [];

  for (const edge of graph.edges) {
    if (
      edge.effect_direction &&
      edge.strength_mean !== undefined &&
      edge.strength_mean !== 0
    ) {
      const signIsPositive = edge.strength_mean > 0;
      const directionIsPositive = edge.effect_direction === "positive";

      if (signIsPositive !== directionIsPositive) {
        const before = edge.effect_direction;
        const after = signIsPositive ? "positive" : "negative";
        (edge as any).effect_direction = after;

        mutations.push({
          rule: "sign_reconciliation",
          code: "SIGN_CORRECTED",
          edge_id: `${edge.from}::${edge.to}`,
          field: "effect_direction",
          before,
          after,
          reason: `effect_direction "${before}" contradicts strength_mean sign (${edge.strength_mean})`,
          severity: "warn",
        });
      }
    }
  }

  return mutations;
}

// =============================================================================
// Main STRP Function
// =============================================================================

/**
 * Structural Truth Reconciliation Pass (STRP).
 *
 * Runs a pipeline of deterministic reconciliation rules:
 * 1. Category override — align declared categories with structural inference
 * 2. Enum validation — correct invalid enum values to safe defaults
 * 3. Constraint target — remap/drop mismatched constraint node_ids (when provided)
 * 4. Sign reconciliation — align effect_direction with strength_mean sign
 * 5. Controllable data completeness — fill missing factor_type/uncertainty_drivers (when fillControllableData)
 *
 * Mutates the graph in place and returns mutation records for observability.
 */
export function reconcileStructuralTruth(
  graph: GraphT,
  options?: {
    goalConstraints?: Array<{ node_id: string; [key: string]: unknown }>;
    requestId?: string;
    /** Run data-completeness pass for controllable factors. Use in late-pipeline
     *  STRP only — early calls skip this because enrichment/repair overwrite the values. */
    fillControllableData?: boolean;
  },
): STRPResult {
  const requestId = options?.requestId;
  const startTime = Date.now();
  const mutations: STRPMutation[] = [];

  // Build lookup structures and infer categories
  const nodeMap = buildNodeMap(graph.nodes);
  const factorCategories = inferFactorCategories(graph.nodes, graph.edges, nodeMap);

  // Rule 1: Category override
  mutations.push(...categoryOverrideRule(graph, nodeMap, factorCategories));

  // Rule 2: Enum validation
  mutations.push(...enumValidationRule(graph));

  // Rule 3: Constraint target (no-op when constraints absent)
  let normalisedConstraints = options?.goalConstraints;
  if (normalisedConstraints && normalisedConstraints.length > 0) {
    const nodeIds = graph.nodes.map((n) => n.id);
    const constraintResult = constraintTargetRule(normalisedConstraints, nodeIds, requestId);
    mutations.push(...constraintResult.mutations);
    normalisedConstraints = constraintResult.constraints;
  }

  // Rule 4: Sign reconciliation
  mutations.push(...signReconciliationRule(graph));

  // Rule 5: Controllable data completeness (late-pipeline only)
  if (options?.fillControllableData) {
    mutations.push(...controllableDataCompletenessRule(nodeMap, factorCategories));
  }

  const durationMs = Date.now() - startTime;

  if (mutations.length > 0) {
    log.info(
      {
        event: "strp.complete",
        requestId,
        mutation_count: mutations.length,
        rules_triggered: [...new Set(mutations.map((m) => m.rule))],
        durationMs,
      },
      `STRP: ${mutations.length} mutation(s) applied`
    );
  } else {
    log.debug(
      {
        event: "strp.clean",
        requestId,
        durationMs,
      },
      "STRP: no mutations needed"
    );
  }

  return {
    graph,
    mutations,
    goalConstraints: normalisedConstraints,
  };
}
