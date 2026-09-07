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
import { sha8 } from "../utils/logger-config.js";
import { fieldDeletion, type FieldDeletionEvent } from "../cee/unified-pipeline/utils/field-deletion-audit.js";
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
  /** Per-field deletion events from STRP rules (e.g. category override stripping controllable-only fields) */
  fieldDeletions: FieldDeletionEvent[];
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

// Derived from the schema, never re-typed. (The old wording said the enum is
// "inline on FactorData"; it was hoisted to `ExtractionType` in schemas/graph.ts
// on 2026-07-25 so the sent draft grammar could derive from it too. This read
// resolves through FactorData either way — comment corrected, not the code.)
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
): { mutations: STRPMutation[]; fieldDeletions: FieldDeletionEvent[] } {
  const mutations: STRPMutation[] = [];
  const deletions: FieldDeletionEvent[] = [];
  const factors = nodeMap.byKind.get("factor") ?? [];

  for (const node of factors) {
    const info = factorCategories.get(node.id);
    if (!info) continue;

    const declared = node.category as FactorCategory | undefined;
    const inferred = info.category;

    // Nothing to override when categories already agree
    if (declared === inferred) continue;

    // Overwrite the node's declared category with the inferred one
    node.category = inferred;

    // Update the factorCategories map so downstream checks see corrected state
    factorCategories.set(node.id, { ...info, explicitCategory: inferred });

    // Only adjust data fields when correcting a WRONG declared category.
    // When category was absent (undefined/null), just set category and let
    // Rule 5 (controllable data completeness) handle data fill in late STRP.
    if (declared) {
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
          node.data = data as unknown as NodeT["data"];
        }
      } else {
        // Reclassified FROM controllable to observable/external — strip extra fields
        if (data.factor_type !== undefined) {
          deletions.push(fieldDeletion('structural-reconciliation', node.id, 'data.factor_type', 'CATEGORY_OVERRIDE_STRIP'));
          delete data.factor_type;
        }
        if (data.uncertainty_drivers !== undefined) {
          deletions.push(fieldDeletion('structural-reconciliation', node.id, 'data.uncertainty_drivers', 'CATEGORY_OVERRIDE_STRIP'));
          delete data.uncertainty_drivers;
        }
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

  return { mutations, fieldDeletions: deletions };
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

  for (const node of factors) {
    const info = factorCategories.get(node.id);
    if (!info || info.category !== "controllable") continue;

    const data = (node.data ?? {}) as Record<string, unknown>;

    if (!data.factor_type) {
      data.factor_type = FACTOR_TYPE_DEFAULT;
      if (!node.data) node.data = data as unknown as NodeT["data"];
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
      if (!node.data) node.data = data as unknown as NodeT["data"];
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
        node.category = undefined;
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
      edge.effect_direction = "positive";
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

/**
 * Fuzzy-match a constraint node ID against a set of graph node IDs.
 *
 * Matching strategy (in order):
 *  1. Case-insensitive substring on de-prefixed stems (existing)
 *  2. If stem matching is ambiguous or empty AND nodeLabels is provided,
 *     normalise each node's label to a slug and try substring matching
 *     against the constraint stem.
 *
 * Returns the matched node ID if exactly 1 unambiguous match; undefined otherwise.
 */
export function fuzzyMatchNodeId(
  constraintNodeId: string,
  nodeIds: string[],
  nodeLabels?: Map<string, string>,
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

  if (matches.length === 1) return matches[0];

  // ── Label-based fallback ───────────────────────────────────────────────
  // When stem matching produces 0 or >1 results, try matching against
  // normalised node labels (e.g. "Customer Retention Rate" → "customer_retention_rate").
  if (nodeLabels && nodeLabels.size > 0) {
    const labelMatches: string[] = [];

    for (const nodeId of nodeIds) {
      // Apply same prefix safety as stem matching — don't cross node families
      const { prefix: nodePrefix } = stripNodePrefix(nodeId);
      if (constraintPrefix && nodePrefix && constraintPrefix !== nodePrefix) continue;

      const label = nodeLabels.get(nodeId);
      if (!label) continue;

      // Normalise label the same way the extractor normalises target names
      const normLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (normLabel.length < MIN_FUZZY_STEM_LENGTH) continue;

      if (normLabel.includes(constraintStemLower) || constraintStemLower.includes(normLabel)) {
        labelMatches.push(nodeId);
      }
    }

    if (labelMatches.length === 1) return labelMatches[0];
  }

  return undefined;
}

/**
 * Normalise goal_constraints node_id values against actual graph nodes.
 *
 * Matching order:
 *  1. Exact ID match → keep
 *  2. Label-based remap → normalise constraint label against node labels
 *  3. Fuzzy match → stem substring + label substring via fuzzyMatchNodeId()
 *  4. No match / ambiguous → drop + emit CONSTRAINT_DROPPED_NO_TARGET info
 */
export function normaliseConstraintTargets(
  constraints: Array<{ node_id: string; [key: string]: unknown }>,
  nodeIds: string[],
  requestId?: string,
  nodeLabels?: Map<string, string>,
): ConstraintNormalisationResult {
  const issues: ValidationIssue[] = [];
  const result: Array<{ node_id: string; [key: string]: unknown }> = [];
  const nodeIdSet = new Set(nodeIds);

  let valid = 0;
  let remapped = 0;
  let dropped = 0;

  for (const constraint of constraints) {
    const originalNodeId = constraint.node_id;

    // Step 1: Exact ID match
    if (nodeIdSet.has(originalNodeId)) {
      result.push(constraint);
      valid++;
      continue;
    }

    // Step 2: Label-based exact remap — if constraint has a label, try matching
    // it against normalised node labels before falling back to fuzzy matching
    if (nodeLabels && nodeLabels.size > 0) {
      const constraintLabel = constraint.label as string | undefined;
      if (constraintLabel) {
        const normConstraintLabel = constraintLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
          // strip common suffixes added by the extractor ("ceiling", "floor", "minimum", "maximum")
          .replace(/_(ceiling|floor|minimum|maximum|cap|min|max)$/, "");

        if (normConstraintLabel.length >= 4) {
          const labelMatches: string[] = [];
          for (const [nodeId, label] of nodeLabels) {
            const normLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
            if (normLabel === normConstraintLabel ||
                normLabel.includes(normConstraintLabel) ||
                normConstraintLabel.includes(normLabel)) {
              labelMatches.push(nodeId);
            }
          }
          if (labelMatches.length === 1) {
            result.push({ ...constraint, node_id: labelMatches[0] });
            remapped++;
            issues.push({
              code: "CONSTRAINT_NODE_REMAPPED",
              severity: "info",
              message: `Constraint node_id "${originalNodeId}" remapped to "${labelMatches[0]}" via label match`,
              path: `goal_constraints[].node_id`,
              context: {
                original_node_id: originalNodeId,
                remapped_node_id: labelMatches[0],
                constraint_id: constraint.constraint_id,
                match_strategy: "label",
              },
            });
            continue;
          }
        }
      }
    }

    // Step 3: Fuzzy match (stem substring + label substring)
    const match = fuzzyMatchNodeId(originalNodeId, nodeIds, nodeLabels);

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

      // Build diagnostic info for the drop
      const { stem: constraintStem, prefix: constraintPrefix } = stripNodePrefix(originalNodeId);
      const constraintStemLower = constraintStem.toLowerCase();

      // Compute fuzzy candidates for diagnostics
      const fuzzyCandidates: Array<{ id: string; score: number; prefix_match: boolean }> = [];
      for (const nodeId of nodeIds) {
        const { stem: nodeStem, prefix: nodePrefix } = stripNodePrefix(nodeId);
        const nodeStemLower = nodeStem.toLowerCase();
        const prefixMatch = !constraintPrefix || !nodePrefix || constraintPrefix === nodePrefix;

        // Simple substring overlap score
        let score = 0;
        if (nodeStemLower.includes(constraintStemLower) || constraintStemLower.includes(nodeStemLower)) {
          score = Math.min(constraintStemLower.length, nodeStemLower.length) / Math.max(constraintStemLower.length, nodeStemLower.length);
        }

        if (score > 0 || prefixMatch) {
          fuzzyCandidates.push({ id: nodeId, score, prefix_match: prefixMatch });
        }
      }
      fuzzyCandidates.sort((a, b) => b.score - a.score);

      // Determine drop reason
      let dropReason: string;
      if (fuzzyCandidates.length === 0 || fuzzyCandidates.every((c) => c.score === 0)) {
        dropReason = "no_candidates";
      } else if (fuzzyCandidates.filter((c) => c.score > 0 && !c.prefix_match).length > 0 &&
                 fuzzyCandidates.filter((c) => c.score > 0 && c.prefix_match).length === 0) {
        dropReason = "prefix_mismatch";
      } else if (fuzzyCandidates.filter((c) => c.score > 0).length > 1) {
        dropReason = "ambiguous";
      } else if (nodeLabels && nodeLabels.size === 0) {
        dropReason = "missing_node_labels";
      } else {
        dropReason = "below_threshold";
      }

      // Log enhanced diagnostics. PII rule (14-Jul ruling): node ids are
      // label-derived slugs and constraint labels are user decision
      // content — the old claim here that ids are "no PII" was wrong.
      // The log carries correlation DIGESTS, bounded enums, and counts
      // only; nothing user-authored is interpolated into the message.
      log.info({
        event: "CONSTRAINT_DROPPED",
        constraint_target_id_digest: sha8(originalNodeId),
        exact_match_found: false,
        fuzzy_candidates_top3: fuzzyCandidates.slice(0, 3).map((c) => ({
          id_digest: sha8(c.id),
          score: c.score,
          prefix_match: c.prefix_match,
        })),
        drop_reason: dropReason,
        available_node_count: nodeIds.length,
        stage: requestId?.startsWith("unified") ? "unified" : "legacy",
      }, `Constraint dropped — ${dropReason}`);

      issues.push({
        code: "CONSTRAINT_DROPPED_NO_TARGET",
        severity: "info",
        message: `Constraint with node_id "${originalNodeId}" dropped — no matching node found`,
        path: `goal_constraints[].node_id`,
        context: {
          original_node_id: originalNodeId,
          constraint_id: constraint.constraint_id,
          drop_reason: dropReason,
          fuzzy_candidates_top3: fuzzyCandidates.slice(0, 3),
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
  nodeLabels?: Map<string, string>,
): { mutations: STRPMutation[]; constraints: Array<{ node_id: string; [key: string]: unknown }> } {
  const normResult = normaliseConstraintTargets(goalConstraints, nodeIds, requestId, nodeLabels);
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
// Rule 3b: Constraint Direction Heuristic
// =============================================================================

/**
 * Factor types where the constraint operator is heuristically suspicious.
 *
 * - "upper_bound" types (cost, time, price): typically constrained with <= (ceiling).
 *   Using >= on these suggests the LLM may have inverted the direction.
 * - "lower_bound" types (revenue, demand, quality): typically constrained with >= (floor).
 *   Using <= on these suggests the LLM may have inverted the direction.
 *
 * Emits CONSTRAINT_DIRECTION_HEURISTIC (info severity) — never auto-corrects.
 */
const UPPER_BOUND_FACTOR_TYPES = new Set(["cost", "time", "price"]);
const LOWER_BOUND_FACTOR_TYPES = new Set(["revenue", "demand", "quality"]);

function constraintDirectionHeuristicRule(
  constraints: Array<{ node_id: string; [key: string]: unknown }>,
  nodeMap: NodeMap,
): STRPMutation[] {
  const mutations: STRPMutation[] = [];

  for (const constraint of constraints) {
    const operator = constraint.operator as string | undefined;
    if (!operator) continue;

    const node = nodeMap.byId.get(constraint.node_id);
    if (!node) continue;

    // Check factor_type on factor nodes
    const data = node.data as Record<string, unknown> | undefined;
    const factorType = data?.factor_type as string | undefined;
    const nodeKind = node.kind;

    let suspicious = false;
    let reason = "";

    if (factorType && UPPER_BOUND_FACTOR_TYPES.has(factorType) && operator === ">=") {
      suspicious = true;
      reason = `Constraint on ${factorType} factor "${node.label ?? constraint.node_id}" uses >= operator — ${factorType} factors are typically constrained as upper bounds (<=)`;
    } else if (factorType && LOWER_BOUND_FACTOR_TYPES.has(factorType) && operator === "<=") {
      suspicious = true;
      reason = `Constraint on ${factorType} factor "${node.label ?? constraint.node_id}" uses <= operator — ${factorType} factors are typically constrained as lower bounds (>=)`;
    } else if (nodeKind === "risk" && operator === ">=") {
      suspicious = true;
      reason = `Constraint on risk node "${node.label ?? constraint.node_id}" uses >= operator — risks are typically constrained as upper bounds (<=)`;
    }

    if (suspicious) {
      mutations.push({
        rule: "constraint_direction_heuristic",
        code: "CONSTRAINT_DIRECTION_HEURISTIC",
        constraint_id: constraint.constraint_id as string | undefined,
        node_id: constraint.node_id,
        field: "operator",
        before: operator,
        after: operator, // not auto-corrected
        reason,
        severity: "info",
      });
    }
  }

  return mutations;
}

// =============================================================================
// Rule 4: Sign Reconciliation
// =============================================================================

/**
 * ⭐⭐ THIS RULE ANSWERS **TWO** QUESTIONS, AND THEY HAVE DIFFERENT ANSWERS.
 * Until 5 Sep 2026 it asked only one and applied that answer to both, which
 * made it correct on one input class and a silent polarity inverter on the
 * other. They are named apart here rather than reconciled into one predicate,
 * because they are genuinely different questions (CLAUDE.md trap 21).
 *
 *   Q_B — `magnitudeCarriesNoSignInformation` (mean > 0)
 *     "The magnitude is an unsigned |mean| and the label contradicts it —
 *      what is this edge's polarity?"
 *     → the LABEL is the only polarity signal, so it informs the mean.
 *       `mean := -|mean|`. UNCHANGED behaviour; see the measured evidence below.
 *
 *   Q_A — `magnitudeCarriesItsOwnSign` (mean < 0)
 *     "The magnitude carries its OWN sign and the label contradicts it —
 *      what is this edge's polarity?"
 *     → the MEAN is authoritative, so the LABEL is corrected.
 *       `effect_direction := "negative"`. The mean is NEVER touched.
 *
 * The two predicates are DISJOINT by construction (`mean < 0` XOR `mean > 0`,
 * with zero excluded), so this is two named predicates, not one widened one.
 * A widened/symmetrised predicate is exactly the trap here — see the guard note
 * at the foot of this comment.
 *
 * ⭐ WHY THE MEAN IS AUTHORITATIVE ON Q_A — derived at the bytes, and it is the
 * fact that refutes point (d) below:
 *
 *   ISL — the actual compute engine — NEVER SEES `effect_direction`. `EdgeV2`
 *   does not declare it and sets `extra: "ignore"`
 *   (`Inference-Service-Layer/src/models/robustness_v2.py:415-419` @ 7781ca4f),
 *   so the field is silently dropped at the engine boundary. `current_mean` is
 *   `edge.strength.mean` verbatim (`robustness_analyzer_v2.py:6260-6262`), with
 *   no negation or direction lookup anywhere in that repo.
 *
 *   So on Q_A, rewriting -0.53 → +0.53 destroys the polarity of the ONLY field
 *   that computes, and ships a genuinely inverted sign to an engine that is
 *   structurally incapable of detecting it. Point (d)'s "LOSS-FREE" claim holds
 *   only where the mean's sign carried no information; on Q_A it is false and
 *   inverted. A field the engine ignores cannot be the authority for what the
 *   engine calculates.
 *
 *   The producer agrees: the live draft grammar instructs the model
 *   "effect_direction MUST match sign of strength.mean" (`prompts/defaults-v15.ts:425`)
 *   and the edit-graph prompt states the derivation as a rule — "mean > 0 ->
 *   effect_direction: 'positive' / mean < 0 -> 'negative'"
 *   (`prompts/edit-graph-v6.ts:181-182`). The canonical schema doc records
 *   `effect_direction` as "(encoded in sign)", applying the label only to the
 *   legacy UNSIGNED `weight` and only AFTER signed `strength.mean`
 *   (`Olumi_Decision_Model_Schema_v2_6.md` §C.2). The label is a projection of
 *   the sign; a Q_A disagreement is stochastic non-compliance with an explicit
 *   instruction, not a second opinion.
 *
 * The rest of this comment is the ORIGINAL Q_B rationale and its measured
 * evidence, preserved unedited because it is the record of a real measurement
 * and it remains correct FOR Q_B. Only its implicit claim to cover Q_A too is
 * withdrawn.
 *
 * ⚠ THREE PASSES IN CEE ANSWER THIS ONE QUESTION, AND UNTIL THIS CHANGE THEY
 * GAVE TWO DIFFERENT ANSWERS (the estate's signature defect, CLAUDE.md trap 21):
 *
 *   this rule            Stage 2 Normalise        answered "the MAGNITUDE"
 *   `fixSignMismatch`    Stage 4 Repair substep 1 answers  "the DIRECTION"
 *                        (`unified-pipeline/stages/repair/deterministic-sweep.ts:147`)
 *   `transformEdgeToV3`  Stage 6 Boundary         answers  "the DIRECTION"
 *                        (`cee/transforms/schema-v3.ts:830`)
 *
 * Because this rule runs FIRST it ERASED the disagreement, so the other two
 * never saw one and their (correct) verdict never applied. A drafting model
 * that emitted an UNSIGNED magnitude plus a direction — the natural shape, and
 * the one the live draft prompt's own PARAMETER_GUIDANCE grades with
 * absolute-value bars (`strong |mean|>0.6`) — had every stated NEGATIVE
 * relationship silently turned POSITIVE.
 *
 * MEASURED, not asserted. Across 465 JSON/JSONL files in this repo and
 * `Talchain/olumi-programme-docs`, 5,092 edge objects carry both a numeric mean
 * and an `effect_direction`. 25 disagree — ALL 25 of the class
 * `mean > 0 & direction = "negative"`, ZERO of the reverse. 19 of them sit in
 * ONE governed evaluator baseline of the real draft-graph task
 * (`tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json`),
 * and they are semantically correct negatives that this rule was inverting:
 * "Currency and Macro Risk" → "Revenue Growth Achieved",
 * "Current Retention Rate" → "Retention Shortfall Risk",
 * "Commuter Accessibility" → "Commuter Friction and Absenteeism".
 *
 * WHY THE DIRECTION IS THE AUTHORITY (derived at the bytes, not chosen):
 *   (a) the draft grammar makes `effect_direction` REQUIRED with a CLOSED enum
 *       (`cee/draft/anthropic-graph-schema.ts:395,409`); `strength.mean` is an
 *       unconstrained `number`. A closed enum the producer must fill is a
 *       stronger signal than a sign convention stated in one prompt line.
 *   (b) the live prompt grades strength as a MAGNITUDE (`|mean|`), so the sign
 *       of `mean` carries no guaranteed meaning at ingress.
 *   (c) two of the three authorities already honour the direction — this rule
 *       was the outlier, 1 of 3.
 *   (d) direction-authoritative is LOSS-FREE: `mean := sign(direction)·|mean|`
 *       keeps BOTH facts. Sign-authoritative DESTROYS the polarity. Between two
 *       remedies for one disagreement, the one that discards information is the
 *       wrong one.
 *
 * ⚠ THE OPPOSITE-DIRECTION HARM — this is Q_A, and it is now CLOSED BY
 * CORRECTING THE LABEL rather than by trusting it. When this comment was
 * written the rule trusted the direction on both classes, so a genuine negative
 * relationship carrying a correctly-signed negative magnitude had that sign
 * stripped. That class measured ZERO across the corpora above, but zero-observed
 * is not zero-possible, and a live witness subsequently found three at once.
 * Both classes are pinned together, Q_B in
 * `tests/unit/cee.edge-polarity-direction-authority.test.ts` and Q_A in
 * `tests/unit/cee.edge-direction-derives-from-mean-sign.test.ts`.
 *
 * The one in-tree producer that could create a disagreement AFTER this rule —
 * `normaliseRiskCoefficients` (`cee/transforms/risk-normalisation.ts`), which
 * runs immediately after in Stage 2 and again reaches Late STRP in Stage 4 —
 * stamps `effect_direction: "negative"` alongside the mean it negates, so Late
 * STRP has nothing to reconcile and cannot undo it. Under Q_A that edge would
 * now be self-consistent anyway, but the stamp is kept: it makes the agreement
 * explicit rather than incidental.
 *
 * ⚠⚠ DO NOT SYMMETRISE THE WIRE-BOUNDARY GUARDS. `transformEdgeToV3`
 * (`cee/transforms/schema-v3.ts:834`) and PLoT's `graph-normaliser.ts:708` both
 * handle only `direction === "negative" && mean > 0` — i.e. Q_B alone. That
 * asymmetry is not an oversight: it is presently the only thing protecting a
 * correctly-signed negative mean at the boundary. Making them symmetric would
 * let a stale "positive" label rewrite -0.53 → +0.53 downstream of this rule
 * and re-open the exact inversion Q_A closes.
 *
 * A zero magnitude carries no polarity and is left alone, as before — it
 * belongs to neither class.
 */

/**
 * Q_A predicate. "Does this edge's magnitude carry its own sign?"
 *
 * A NEGATIVE mean is positive evidence that the producer used the signed
 * convention, because an unsigned magnitude cannot be negative. That makes the
 * mean self-describing, and the label a derivable projection of it.
 */
function magnitudeCarriesItsOwnSign(strengthMean: number): boolean {
  return strengthMean < 0;
}

/**
 * Q_B predicate. "Is the label the only polarity signal available?"
 *
 * A POSITIVE mean is ambiguous — it is equally consistent with a signed
 * positive coefficient and with an unsigned |mean| whose polarity lives only in
 * the label. Where the magnitude cannot speak for itself the label must, so the
 * label informs the mean. This is the original, measured behaviour.
 */
function magnitudeCarriesNoSignInformation(strengthMean: number): boolean {
  return strengthMean > 0;
}

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

      if (signIsPositive === directionIsPositive) continue;

      const edgeId = `${edge.from}::${edge.to}`;

      if (magnitudeCarriesItsOwnSign(edge.strength_mean)) {
        // Q_A — the mean is authoritative. Correct the LABEL, never the mean.
        const before = edge.effect_direction;
        edge.effect_direction = "negative";

        mutations.push({
          rule: "sign_reconciliation",
          // Deliberately NOT `SIGN_CORRECTED`: that code maps to the
          // user-facing `risk_coefficient_corrected`
          // (`cee/transforms/analysis-ready.ts:1512`), and nothing about the
          // coefficient changed here. Claiming otherwise would be a false
          // disclosure. `DIRECTION_CORRECTED` is unmapped and therefore
          // internal-only, by design.
          code: "DIRECTION_CORRECTED",
          edge_id: edgeId,
          field: "effect_direction",
          before,
          after: "negative",
          reason: `effect_direction "${before}" contradicts the sign of strength_mean (${edge.strength_mean}); the magnitude carries its own sign and is the only field the engine reads, so the label is corrected to match it`,
          severity: "warn",
        });
      } else if (magnitudeCarriesNoSignInformation(edge.strength_mean)) {
        // Q_B — the label is the only signal. Move the SIGN onto the magnitude.
        const before = edge.strength_mean;
        const after = -Math.abs(before);
        edge.strength_mean = after;

        mutations.push({
          rule: "sign_reconciliation",
          code: "SIGN_CORRECTED",
          edge_id: edgeId,
          field: "strength_mean",
          before,
          after,
          reason: `strength_mean sign (${before}) contradicts the stated effect_direction "${edge.effect_direction}"; an unsigned magnitude carries no polarity of its own, so the direction is authoritative and the magnitude takes its sign`,
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
 * 3b. Constraint direction heuristic — warn when operator direction looks wrong for factor_type (info, never auto-corrects)
 * 4. Sign reconciliation — reconcile effect_direction and strength_mean. Which
 *    field moves depends on the input class: a signed (negative) magnitude is
 *    authoritative and the LABEL is corrected; an unsigned (positive) magnitude
 *    carries no polarity, so the LABEL is authoritative and the magnitude takes
 *    its sign. See the rule's own comment for why these are two questions.
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
    /** Map of node ID → label for label-based fuzzy matching in Rule 3 */
    nodeLabels?: Map<string, string>;
  },
): STRPResult {
  const requestId = options?.requestId;
  const startTime = Date.now();
  const mutations: STRPMutation[] = [];

  // Build lookup structures and infer categories
  const nodeMap = buildNodeMap(graph.nodes);
  const factorCategories = inferFactorCategories(graph.nodes, graph.edges, nodeMap);

  // Rule 1: Category override
  const categoryResult = categoryOverrideRule(graph, nodeMap, factorCategories);
  mutations.push(...categoryResult.mutations);
  const allFieldDeletions: FieldDeletionEvent[] = [...categoryResult.fieldDeletions];

  // Rule 2: Enum validation
  mutations.push(...enumValidationRule(graph));

  // Rule 3: Constraint target (no-op when constraints absent)
  let normalisedConstraints = options?.goalConstraints;
  if (normalisedConstraints && normalisedConstraints.length > 0) {
    const nodeIds = graph.nodes.map((n) => n.id);
    const constraintResult = constraintTargetRule(normalisedConstraints, nodeIds, requestId, options?.nodeLabels);
    mutations.push(...constraintResult.mutations);
    normalisedConstraints = constraintResult.constraints;

    // Rule 3b: Constraint direction heuristic (runs after target resolution)
    if (normalisedConstraints.length > 0) {
      mutations.push(...constraintDirectionHeuristicRule(normalisedConstraints, nodeMap));
    }
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
    fieldDeletions: allFieldDeletions,
  };
}
