/**
 * Edge Direction Validator
 *
 * Validates that graph edges follow correct causal direction:
 * - Goal nodes must be terminal sinks (no outgoing edges)
 * - Edges flow FROM causes TO effects
 * - decision → option → outcome → goal
 *
 * This validator emits warnings for directional violations that
 * don't break the graph but indicate semantic incorrectness.
 */

import type { GraphV1 } from "../../../contracts/plot/engine.js";
import type { VerificationContext, VerificationResult, VerificationStage } from "../types.js";
import { emit, TelemetryEvents } from "../../../utils/telemetry.js";

/**
 * Describes a single edge direction violation
 */
export interface EdgeDirectionViolation {
  /** The edge causing the violation */
  edge_from: string;
  edge_to: string;
  /** Human-readable description of what's wrong */
  reason: string;
  /** Type of violation for programmatic handling */
  violation_type: "goal_has_outgoing" | "wrong_direction";
}

/**
 * Valid edge direction patterns (from_kind → to_kind)
 * These represent correct causal flow in decision graphs.
 */
const _VALID_EDGE_PATTERNS: Array<{ from: string; to: string }> = [
  { from: "decision", to: "option" },     // Decision frames options
  { from: "option", to: "outcome" },       // Option leads to outcome
  { from: "option", to: "risk" },          // Option has associated risk
  { from: "outcome", to: "goal" },         // Outcome contributes to goal
  { from: "risk", to: "goal" },            // Risk affects goal achievement
  { from: "factor", to: "option" },        // Factor affects option viability
  { from: "factor", to: "outcome" },       // Factor influences outcome
  // NOTE: factor→decision removed (V4 topology: factors must route through options/outcomes)
  { from: "action", to: "outcome" },       // Action leads to outcome
  { from: "action", to: "risk" },          // Action mitigates risk
  { from: "decision", to: "decision" },    // Sub-decisions (allowed)
];

/**
 * Invalid edge direction patterns that should be flagged
 */
const INVALID_EDGE_PATTERNS: Array<{ from: string; to: string; reason: string }> = [
  { from: "goal", to: "decision", reason: "Goals don't cause decisions; decisions pursue goals" },
  { from: "goal", to: "option", reason: "Goals don't cause options; options work toward goals" },
  { from: "goal", to: "outcome", reason: "Goals don't cause outcomes; outcomes achieve goals" },
  { from: "goal", to: "factor", reason: "Goals don't cause factors; factors affect decisions" },
  { from: "goal", to: "risk", reason: "Goals don't cause risks; risks threaten goals" },
  { from: "goal", to: "action", reason: "Goals don't cause actions; actions pursue goals" },
  { from: "outcome", to: "option", reason: "Outcomes don't cause options; options lead to outcomes" },
  { from: "outcome", to: "decision", reason: "Outcomes don't cause decisions; decisions lead to outcomes" },
];

export class EdgeDirectionValidator implements VerificationStage<unknown, unknown> {
  readonly name = "edge_direction" as const;

  async validate(
    payload: unknown,
    _context?: VerificationContext,
  ): Promise<VerificationResult<unknown>> {
    const graph = (payload as any)?.graph as GraphV1 | undefined;
    if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
      };
    }

    const nodes = (graph as any).nodes as any[];
    const edges = (graph as any).edges as any[];

    // Build a map of node IDs to their kinds
    const nodeKinds = new Map<string, string>();
    for (const node of nodes) {
      const id = typeof node?.id === "string" ? node.id : undefined;
      const kind = typeof node?.kind === "string" ? node.kind : undefined;
      if (id && kind) {
        nodeKinds.set(id, kind);
      }
    }

    // Find goal nodes
    const goalNodeIds = new Set<string>();
    for (const [id, kind] of nodeKinds) {
      if (kind === "goal") {
        goalNodeIds.add(id);
      }
    }

    // Skip if no goal nodes (can't validate direction without goals)
    if (goalNodeIds.size === 0) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
        message: "No goal nodes found to validate edge direction",
      };
    }

    const violations: EdgeDirectionViolation[] = [];

    for (const edge of edges) {
      const from = typeof edge?.from === "string" ? edge.from : undefined;
      const to = typeof edge?.to === "string" ? edge.to : undefined;
      if (!from || !to) continue;

      const fromKind = nodeKinds.get(from);
      const toKind = nodeKinds.get(to);
      if (!fromKind || !toKind) continue;

      // Check 1: Goal nodes should NEVER have outgoing edges
      if (goalNodeIds.has(from)) {
        violations.push({
          edge_from: from,
          edge_to: to,
          reason: `Goal node "${from}" has outgoing edge to "${to}" - goals must be terminal sinks with no outgoing edges`,
          violation_type: "goal_has_outgoing",
        });
        continue;
      }

      // Check 2: Known invalid patterns
      const invalidPattern = INVALID_EDGE_PATTERNS.find(
        p => p.from === fromKind && p.to === toKind
      );
      if (invalidPattern) {
        violations.push({
          edge_from: from,
          edge_to: to,
          reason: `${fromKind} → ${toKind}: ${invalidPattern.reason}`,
          violation_type: "wrong_direction",
        });
      }
    }

    // No violations found - graph has correct edge direction
    if (violations.length === 0) {
      emit(TelemetryEvents.EdgeDirectionValidationPassed, {
        request_id: _context?.requestId,
        endpoint: _context?.endpoint,
      });

      return {
        valid: true,
        stage: this.name,
      };
    }

    // Count by type for summary
    const goalOutgoingCount = violations.filter(v => v.violation_type === "goal_has_outgoing").length;
    const wrongDirectionCount = violations.filter(v => v.violation_type === "wrong_direction").length;

    // Emit telemetry for violations
    emit(TelemetryEvents.EdgeDirectionViolationDetected, {
      request_id: _context?.requestId,
      endpoint: _context?.endpoint,
      total_violations: violations.length,
      goal_outgoing_count: goalOutgoingCount,
      wrong_direction_count: wrongDirectionCount,
    });

    return {
      valid: true, // Still valid but with warnings
      stage: this.name,
      severity: "warning",
      code: "EDGE_DIRECTION_VIOLATION",
      message: `${violations.length} edge direction violation(s) detected: ${goalOutgoingCount} goal outgoing, ${wrongDirectionCount} wrong direction`,
      details: {
        violations: violations.slice(0, 10), // Cap at 10 for readability
        total_violations: violations.length,
        goal_outgoing_count: goalOutgoingCount,
        wrong_direction_count: wrongDirectionCount,
      },
    };
  }
}

/**
 * Standalone function for quick edge direction check
 * Returns true if graph has correct edge direction
 */
export function hasCorrectEdgeDirection(graph: GraphV1): boolean {
  const nodes = (graph as any).nodes as any[] | undefined;
  const edges = (graph as any).edges as any[] | undefined;

  if (!nodes || !edges) return true;

  const goalNodeIds = new Set<string>();
  const nodeKinds = new Map<string, string>();

  for (const node of nodes) {
    const id = typeof node?.id === "string" ? node.id : undefined;
    const kind = typeof node?.kind === "string" ? node.kind : undefined;
    if (id && kind) {
      nodeKinds.set(id, kind);
      if (kind === "goal") goalNodeIds.add(id);
    }
  }

  for (const edge of edges) {
    const from = typeof edge?.from === "string" ? edge.from : undefined;
    const to = typeof edge?.to === "string" ? edge.to : undefined;
    if (!from || !to) continue;

    // Goal nodes should never have outgoing edges
    if (goalNodeIds.has(from)) return false;

    const fromKind = nodeKinds.get(from);
    const toKind = nodeKinds.get(to);
    if (!fromKind || !toKind) continue;

    // Check for known invalid patterns
    const isInvalid = INVALID_EDGE_PATTERNS.some(
      p => p.from === fromKind && p.to === toKind
    );
    if (isInvalid) return false;
  }

  return true;
}

/**
 * Get edge direction violations for a graph
 * Useful for detailed reporting without full validator context
 */
export function getEdgeDirectionViolations(graph: GraphV1): EdgeDirectionViolation[] {
  const nodes = (graph as any).nodes as any[] | undefined;
  const edges = (graph as any).edges as any[] | undefined;

  if (!nodes || !edges) return [];

  const violations: EdgeDirectionViolation[] = [];
  const goalNodeIds = new Set<string>();
  const nodeKinds = new Map<string, string>();

  for (const node of nodes) {
    const id = typeof node?.id === "string" ? node.id : undefined;
    const kind = typeof node?.kind === "string" ? node.kind : undefined;
    if (id && kind) {
      nodeKinds.set(id, kind);
      if (kind === "goal") goalNodeIds.add(id);
    }
  }

  for (const edge of edges) {
    const from = typeof edge?.from === "string" ? edge.from : undefined;
    const to = typeof edge?.to === "string" ? edge.to : undefined;
    if (!from || !to) continue;

    if (goalNodeIds.has(from)) {
      violations.push({
        edge_from: from,
        edge_to: to,
        reason: `Goal node "${from}" has outgoing edge - goals must be terminal sinks`,
        violation_type: "goal_has_outgoing",
      });
      continue;
    }

    const fromKind = nodeKinds.get(from);
    const toKind = nodeKinds.get(to);
    if (!fromKind || !toKind) continue;

    const invalidPattern = INVALID_EDGE_PATTERNS.find(
      p => p.from === fromKind && p.to === toKind
    );
    if (invalidPattern) {
      violations.push({
        edge_from: from,
        edge_to: to,
        reason: `${fromKind} → ${toKind}: ${invalidPattern.reason}`,
        violation_type: "wrong_direction",
      });
    }
  }

  return violations;
}
