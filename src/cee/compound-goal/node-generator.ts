/**
 * Constraint Node Generator
 *
 * Generates constraint nodes from extracted goal constraints.
 * Follows PLoT Phase 1 T6 requirements:
 * - kind: 'constraint'
 * - Threshold in observed_state.value
 * - Explicit operator in observed_state.metadata.operator AND data.operator
 * - ASCII operators only: >= and <=
 */

import type { ExtractedGoalConstraint } from "./extractor.js";
import type { NodeT, EdgeT } from "../../schemas/graph.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Constraint node type following PLoT Phase 1 T6 spec.
 */
export interface ConstraintNode {
  id: string;
  kind: "constraint";
  label: string;
  body?: string;
  observed_state: {
    value: number;
    metadata: {
      operator: ">=" | "<=";
      original_value?: number;
      unit?: string;
      deadline_date?: string;
      reference_date?: string;
      assumed_reference_date?: boolean;
    };
  };
  data: {
    operator: ">=" | "<=";
  };
}

/**
 * Edge connecting a constraint to its target node.
 */
export interface ConstraintEdge {
  id: string;
  from: string;
  to: string;
  /** Constraint edges have no causal weight - structural only */
  strength_mean?: undefined;
  strength_std?: undefined;
  belief_exists?: number;
}

// ============================================================================
// Node Generation
// ============================================================================

/**
 * Generate constraint nodes from extracted constraints.
 *
 * PLoT requirements:
 * - id: constraint_[target_node_id]_[operator_shorthand]
 * - kind: "constraint"
 * - label: "Target: [human-readable description]"
 * - observed_state.value: threshold in user units
 * - observed_state.metadata.operator: ">=" or "<=" (ASCII only)
 * - data.operator: redundant copy for PLoT compatibility
 *
 * @param constraints - Extracted constraints from brief parsing
 * @returns Array of constraint nodes
 */
export function generateConstraintNodes(
  constraints: ExtractedGoalConstraint[]
): ConstraintNode[] {
  const nodes: ConstraintNode[] = [];
  const seenIds = new Set<string>();

  for (const constraint of constraints) {
    const operatorSuffix = constraint.operator === ">=" ? "min" : "max";
    const id = `constraint_${constraint.targetNodeId}_${operatorSuffix}`;

    // Skip duplicates
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    // Generate human-readable label
    const operatorWord = constraint.operator === ">=" ? "at least" : "at most";
    const valueDisplay = formatValueForDisplay(constraint.value, constraint.unit);
    const label = `Target: ${constraint.targetName} ${operatorWord} ${valueDisplay}`;

    const node: ConstraintNode = {
      id,
      kind: "constraint",
      label,
      body: constraint.sourceQuote || undefined,
      observed_state: {
        value: constraint.value,
        metadata: {
          operator: constraint.operator, // ASCII only: >= or <=
          original_value: constraint.value,
          unit: constraint.unit || undefined,
          // Include deadline metadata if present
          ...(constraint.deadlineMetadata?.deadline_date && {
            deadline_date: constraint.deadlineMetadata.deadline_date,
          }),
          ...(constraint.deadlineMetadata?.reference_date && {
            reference_date: constraint.deadlineMetadata.reference_date,
          }),
          ...(constraint.deadlineMetadata?.assumed_reference_date !== undefined && {
            assumed_reference_date: constraint.deadlineMetadata.assumed_reference_date,
          }),
        },
      },
      data: {
        operator: constraint.operator, // Redundant but ensures PLoT finds it
      },
    };

    nodes.push(node);
  }

  return nodes;
}

/**
 * Generate an edge connecting a constraint node to its target.
 *
 * Constraint edges are structural (not causal) - they indicate
 * the constraint applies to the target node.
 *
 * @param constraintId - The constraint node ID
 * @param targetNodeId - The target node the constraint applies to
 * @returns Edge connecting constraint to target
 */
export function generateConstraintEdge(
  constraintId: string,
  targetNodeId: string
): ConstraintEdge {
  return {
    id: `edge_${constraintId}_to_${targetNodeId}`,
    from: constraintId,
    to: targetNodeId,
    belief_exists: 1.0, // Constraints always apply to their targets
  };
}

/**
 * Generate constraint edges for all constraint nodes.
 *
 * @param constraints - Extracted constraints
 * @returns Array of edges connecting constraints to their targets
 */
export function generateConstraintEdges(
  constraints: ExtractedGoalConstraint[]
): ConstraintEdge[] {
  const edges: ConstraintEdge[] = [];
  const seenIds = new Set<string>();

  for (const constraint of constraints) {
    const operatorSuffix = constraint.operator === ">=" ? "min" : "max";
    const constraintId = `constraint_${constraint.targetNodeId}_${operatorSuffix}`;

    // Skip duplicates
    if (seenIds.has(constraintId)) {
      continue;
    }
    seenIds.add(constraintId);

    edges.push(generateConstraintEdge(constraintId, constraint.targetNodeId));
  }

  return edges;
}

/**
 * Check if a node ID represents a constraint node.
 */
export function isConstraintNodeId(nodeId: string): boolean {
  return nodeId.startsWith("constraint_");
}

/**
 * Extract the target node ID from a constraint node ID.
 */
export function getConstraintTargetId(constraintNodeId: string): string | null {
  if (!isConstraintNodeId(constraintNodeId)) {
    return null;
  }
  // Format: constraint_[targetNodeId]_[min|max]
  const match = constraintNodeId.match(/^constraint_(.+)_(min|max)$/);
  return match ? match[1] : null;
}

/**
 * Convert constraint nodes to standard NodeT format for graph integration.
 */
export function constraintNodesToGraphNodes(
  constraintNodes: ConstraintNode[]
): NodeT[] {
  return constraintNodes.map((cn) => ({
    id: cn.id,
    kind: cn.kind,
    label: cn.label,
    body: cn.body,
    observed_state: cn.observed_state,
    data: cn.data,
  }));
}

/**
 * Convert constraint edges to standard EdgeT format for graph integration.
 */
export function constraintEdgesToGraphEdges(
  constraintEdges: ConstraintEdge[]
): EdgeT[] {
  return constraintEdges.map((ce) => ({
    from: ce.from,
    to: ce.to,
    belief_exists: ce.belief_exists,
    origin: "default" as const,
    provenance: {
      source: "synthetic",
      quote: "Constraint edge (structural, not causal)",
    },
    provenance_source: "synthetic" as const,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a value for human-readable display.
 */
function formatValueForDisplay(value: number, unit?: string): string {
  // Handle percentages (stored as decimals)
  if (unit === "%") {
    return `${(value * 100).toFixed(0)}%`;
  }

  // Handle currencies
  if (unit && ["£", "$", "€"].includes(unit)) {
    // Format with thousands separators
    if (value >= 1000000000) {
      return `${unit}${(value / 1000000000).toFixed(1)}B`;
    }
    if (value >= 1000000) {
      return `${unit}${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `${unit}${(value / 1000).toFixed(0)}k`;
    }
    return `${unit}${value.toLocaleString()}`;
  }

  // Handle months for delivery time
  if (unit === "months") {
    return `${value} months`;
  }

  // Default formatting
  if (unit) {
    return `${value}${unit}`;
  }
  return value.toString();
}
