/**
 * Risks & Actions Validation (v1.5.0 - PR J)
 *
 * Validates risks and actions in decision graphs:
 * - Risks should identify potential negative outcomes
 * - Actions should mitigate risks or implement decisions
 * - Basic structural validation
 */

import type { GraphT } from "../schemas/graph.js";

export interface RiskActionIssue {
  level: "WARNING" | "INFO";
  node_id: string;
  message: string;
}

/**
 * Validate risks and actions in a graph
 *
 * @param graph Decision graph to validate
 * @returns Array of validation issues (warnings/info)
 */
export function validateRisksAndActions(graph: GraphT): RiskActionIssue[] {
  const issues: RiskActionIssue[] = [];

  const riskNodes = graph.nodes.filter(n => n.kind === "risk");
  const actionNodes = graph.nodes.filter(n => n.kind === "action");

  // Validate risk nodes
  for (const risk of riskNodes) {
    // Check if risk has a label
    if (!risk.label || risk.label.trim().length === 0) {
      issues.push({
        level: "WARNING",
        node_id: risk.id,
        message: "Risk node should have a descriptive label",
      });
    }

    // Check if risk is connected
    const hasIncoming = graph.edges.some(e => e.to === risk.id);
    const hasOutgoing = graph.edges.some(e => e.from === risk.id);

    if (!hasIncoming && !hasOutgoing) {
      issues.push({
        level: "WARNING",
        node_id: risk.id,
        message: "Risk node is isolated (no connections)",
      });
    }
  }

  // Validate action nodes
  for (const action of actionNodes) {
    // Check if action has a label
    if (!action.label || action.label.trim().length === 0) {
      issues.push({
        level: "WARNING",
        node_id: action.id,
        message: "Action node should have a descriptive label",
      });
    }

    // Check if action is connected
    const hasIncoming = graph.edges.some(e => e.to === action.id);
    const hasOutgoing = graph.edges.some(e => e.from === action.id);

    if (!hasIncoming && !hasOutgoing) {
      issues.push({
        level: "WARNING",
        node_id: action.id,
        message: "Action node is isolated (no connections)",
      });
    }
  }

  // Info: Suggest actions for risks
  if (riskNodes.length > 0 && actionNodes.length === 0) {
    issues.push({
      level: "INFO",
      node_id: "",
      message: `Graph has ${riskNodes.length} risk(s) but no mitigation actions defined`,
    });
  }

  return issues;
}

/**
 * Check if graph uses risks or actions (for feature flag)
 */
export function hasRisksOrActions(graph: GraphT): boolean {
  return graph.nodes.some(n => n.kind === "risk" || n.kind === "action");
}
