/**
 * Constraint to Risk Node Converter
 *
 * Converts extracted constraints into risk nodes for graph integration.
 * Max constraints become "risk of exceeding X"
 * Min constraints become "risk of falling below X"
 */

import { log } from "../../utils/telemetry.js";
import type { NodeT, EdgeT } from "../../schemas/graph.js";
import type { ExtractedConstraint } from "./llm-extractor.js";

// ============================================================================
// Types
// ============================================================================

export interface RiskNodeResult {
  /** The generated risk node */
  node: NodeT;
  /** Optional edge connecting to related factor node */
  edge?: EdgeT;
}

export interface ConversionOptions {
  /** ID prefix for generated nodes (default: "risk_constraint") */
  nodeIdPrefix?: string;
  /** Related factor node ID to connect with an edge */
  relatedFactorId?: string;
  /** Edge weight for constraint-to-factor relationship (default: 0.8) */
  edgeWeight?: number;
}

// ============================================================================
// Label Generation
// ============================================================================

/**
 * Format a value with its unit for display.
 */
function formatValueWithUnit(value: number, unit: string): string {
  // Handle currency
  if (unit === "$" || unit === "USD") {
    return formatCurrency(value, "$");
  }
  if (unit === "£" || unit === "GBP") {
    return formatCurrency(value, "£");
  }
  if (unit === "€" || unit === "EUR") {
    return formatCurrency(value, "€");
  }

  // Handle percentages
  if (unit === "%") {
    // If value is already in decimal form (0.4), convert to percentage
    const percentValue = value < 1 && value > 0 ? value * 100 : value;
    return `${percentValue}%`;
  }

  // Handle other units
  return `${value} ${unit}`;
}

/**
 * Format currency with appropriate suffixes (K, M, B).
 */
function formatCurrency(value: number, symbol: string): string {
  if (value >= 1_000_000_000) {
    return `${symbol}${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${symbol}${(value / 1_000).toFixed(0)}K`;
  }
  return `${symbol}${value}`;
}

/**
 * Generate a risk node label from a constraint.
 *
 * Max constraint: "Risk of exceeding $500K budget"
 * Min constraint: "Risk of NPS falling below 40"
 */
function generateRiskLabel(constraint: ExtractedConstraint): string {
  const formattedValue = formatValueWithUnit(constraint.threshold, constraint.unit);

  if (constraint.operator === "max") {
    return `Risk of exceeding ${formattedValue} ${constraint.label.toLowerCase()}`;
  } else {
    return `Risk of ${constraint.label.toLowerCase()} falling below ${formattedValue}`;
  }
}

/**
 * Generate a risk node body from a constraint.
 * Provides context about the constraint.
 */
function generateRiskBody(constraint: ExtractedConstraint): string {
  const formattedValue = formatValueWithUnit(constraint.threshold, constraint.unit);

  if (constraint.operator === "max") {
    return `Constraint: ${constraint.label} must not exceed ${formattedValue}`;
  } else {
    return `Constraint: ${constraint.label} must be at least ${formattedValue}`;
  }
}

// ============================================================================
// Node ID Generation
// ============================================================================

/**
 * Generate a unique node ID from constraint label.
 */
function generateNodeId(label: string, prefix: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 30);
  return `${prefix}_${slug}_${index}`;
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert a single constraint to a risk node.
 *
 * @param constraint - The extracted constraint
 * @param index - Index for unique ID generation
 * @param options - Conversion options
 * @returns Risk node and optional edge
 */
export function constraintToRiskNode(
  constraint: ExtractedConstraint,
  index: number,
  options: ConversionOptions = {}
): RiskNodeResult {
  const {
    nodeIdPrefix = "risk_constraint",
    relatedFactorId,
    edgeWeight = 0.8,
  } = options;

  const nodeId = generateNodeId(constraint.label, nodeIdPrefix, index);
  const label = generateRiskLabel(constraint);
  const body = generateRiskBody(constraint);

  const node: NodeT = {
    id: nodeId,
    kind: "risk",
    label,
    body: body.substring(0, 200), // Respect max 200 char limit
  };

  log.debug(
    {
      event: "cee.constraint_to_risk.converted",
      constraintLabel: constraint.label,
      operator: constraint.operator,
      riskNodeId: nodeId,
    },
    `Converted constraint "${constraint.label}" to risk node`
  );

  // Create edge to related factor if provided
  let edge: EdgeT | undefined;
  if (relatedFactorId) {
    edge = {
      from: relatedFactorId,
      to: nodeId,
      weight: edgeWeight,
      belief: constraint.confidence,
      provenance: {
        source: "constraint_extraction",
        quote: constraint.sourceQuote.substring(0, 100),
      },
    };
  }

  return { node, edge };
}

/**
 * Convert multiple constraints to risk nodes.
 *
 * @param constraints - Array of extracted constraints
 * @param factorIdMap - Optional map of constraint labels to factor node IDs
 * @param options - Conversion options
 * @returns Array of risk nodes and edges
 */
export function constraintsToRiskNodes(
  constraints: ExtractedConstraint[],
  factorIdMap?: Map<string, string>,
  options: ConversionOptions = {}
): { nodes: NodeT[]; edges: EdgeT[] } {
  const nodes: NodeT[] = [];
  const edges: EdgeT[] = [];

  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i];

    // Look up related factor ID
    const relatedFactorId = factorIdMap?.get(constraint.label.toLowerCase());

    const result = constraintToRiskNode(constraint, i, {
      ...options,
      relatedFactorId,
    });

    nodes.push(result.node);
    if (result.edge) {
      edges.push(result.edge);
    }
  }

  log.info(
    {
      event: "cee.constraints_to_risk.batch_complete",
      constraintCount: constraints.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
    `Converted ${constraints.length} constraints to risk nodes`
  );

  return { nodes, edges };
}

/**
 * Find factor nodes that may relate to a constraint.
 * Matches by label similarity.
 *
 * @param constraint - The constraint to match
 * @param factorLabels - Map of factor labels to node IDs
 * @returns Matching factor node ID or undefined
 */
export function findRelatedFactor(
  constraint: ExtractedConstraint,
  factorLabels: Map<string, string>
): string | undefined {
  const constraintLabel = constraint.label.toLowerCase();

  // Exact match
  if (factorLabels.has(constraintLabel)) {
    return factorLabels.get(constraintLabel);
  }

  // Partial match - check if any factor label contains constraint label or vice versa
  for (const [factorLabel, factorId] of factorLabels) {
    if (
      factorLabel.includes(constraintLabel) ||
      constraintLabel.includes(factorLabel)
    ) {
      return factorId;
    }
  }

  // Check for common keywords
  const constraintWords = constraintLabel.split(/\s+/);
  for (const word of constraintWords) {
    if (word.length < 4) continue; // Skip short words

    for (const [factorLabel, factorId] of factorLabels) {
      if (factorLabel.includes(word)) {
        return factorId;
      }
    }
  }

  return undefined;
}
