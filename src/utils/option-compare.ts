/**
 * v1.5 PR K: Option Compare API
 *
 * Engine-friendly side-by-side comparison of decision options.
 * Produces structured deltas showing similarities and differences
 * between option nodes for downstream tooling and UX.
 */

import type { GraphT, NodeT } from "../schemas/graph.js";

export interface OptionComparisonField {
  field: string;
  values: Record<string, string | undefined>; // option_id -> value
  status: "same" | "different" | "partial"; // partial = some options missing this field
}

export interface OptionComparison {
  option_ids: string[];
  fields: OptionComparisonField[];
  edges_from: Record<string, number>; // option_id -> count of outgoing edges
  edges_to: Record<string, number>; // option_id -> count of incoming edges
}

/**
 * Compare multiple option nodes side-by-side.
 * Returns structured deltas for engine consumption.
 *
 * @param graph - The decision graph containing the options
 * @param optionIds - IDs of option nodes to compare (2+ required)
 * @returns Structured comparison with field-level deltas
 * @throws Error if invalid input (missing options, non-option nodes, etc.)
 */
export function compareOptions(graph: GraphT, optionIds: string[]): OptionComparison {
  // Validation: need at least 2 options
  if (optionIds.length < 2) {
    throw new Error("compare_options_min_two: At least 2 option IDs required for comparison");
  }

  // Find option nodes and validate they exist and are options
  const optionNodes = new Map<string, NodeT>();
  for (const id of optionIds) {
    const node = graph.nodes.find(n => n.id === id);
    if (!node) {
      throw new Error(`compare_options_not_found: Option node '${id}' not found in graph`);
    }
    if (node.kind !== "option") {
      throw new Error(`compare_options_invalid_kind: Node '${id}' is not an option (kind=${node.kind})`);
    }
    optionNodes.set(id, node);
  }

  // Compare field: label
  const labelValues: Record<string, string | undefined> = {};
  for (const id of optionIds) {
    labelValues[id] = optionNodes.get(id)!.label;
  }
  const labelStatus = getFieldStatus(labelValues);

  // Compare field: body
  const bodyValues: Record<string, string | undefined> = {};
  for (const id of optionIds) {
    bodyValues[id] = optionNodes.get(id)!.body;
  }
  const bodyStatus = getFieldStatus(bodyValues);

  const fields: OptionComparisonField[] = [
    { field: "label", values: labelValues, status: labelStatus },
    { field: "body", values: bodyValues, status: bodyStatus },
  ];

  // Count edges for each option
  const edgesFrom: Record<string, number> = {};
  const edgesTo: Record<string, number> = {};
  for (const id of optionIds) {
    edgesFrom[id] = graph.edges.filter(e => e.from === id).length;
    edgesTo[id] = graph.edges.filter(e => e.to === id).length;
  }

  return {
    option_ids: optionIds,
    fields,
    edges_from: edgesFrom,
    edges_to: edgesTo,
  };
}

/**
 * Determine the status of a field across multiple options.
 *
 * @param values - Map of option_id -> field value
 * @returns "same" if all values identical, "partial" if some missing, "different" otherwise
 */
function getFieldStatus(values: Record<string, string | undefined>): "same" | "different" | "partial" {
  const entries = Object.values(values);
  const defined = entries.filter(v => v !== undefined && v !== "");

  // If some options don't have this field, it's partial
  if (defined.length < entries.length) {
    return "partial";
  }

  // If all values are the same, it's same
  const firstValue = defined[0];
  const allSame = defined.every(v => v === firstValue);
  return allSame ? "same" : "different";
}

/**
 * Get detailed comparison for a specific option pair.
 * Returns character-level diff metadata for UX rendering.
 *
 * @param graph - The decision graph
 * @param optionA - First option ID
 * @param optionB - Second option ID
 * @returns Pairwise comparison with detailed deltas
 */
export function comparePair(
  graph: GraphT,
  optionA: string,
  optionB: string
): {
  option_a: { id: string; label?: string; body?: string };
  option_b: { id: string; label?: string; body?: string };
  label_diff: "same" | "different";
  body_diff: "same" | "different";
  label_similarity?: number; // 0-1, simple character overlap
  body_similarity?: number; // 0-1, simple character overlap
} {
  const nodeA = graph.nodes.find(n => n.id === optionA);
  const nodeB = graph.nodes.find(n => n.id === optionB);

  if (!nodeA || nodeA.kind !== "option") {
    throw new Error(`compare_pair_invalid: Option '${optionA}' not found or not an option`);
  }
  if (!nodeB || nodeB.kind !== "option") {
    throw new Error(`compare_pair_invalid: Option '${optionB}' not found or not an option`);
  }

  const labelDiff = nodeA.label === nodeB.label ? "same" : "different";
  const bodyDiff = nodeA.body === nodeB.body ? "same" : "different";

  // Calculate simple similarity scores (character overlap)
  const labelSimilarity =
    nodeA.label && nodeB.label
      ? calculateSimilarity(nodeA.label, nodeB.label)
      : undefined;
  const bodySimilarity =
    nodeA.body && nodeB.body
      ? calculateSimilarity(nodeA.body, nodeB.body)
      : undefined;

  return {
    option_a: {
      id: nodeA.id,
      label: nodeA.label,
      body: nodeA.body,
    },
    option_b: {
      id: nodeB.id,
      label: nodeB.label,
      body: nodeB.body,
    },
    label_diff: labelDiff,
    body_diff: bodyDiff,
    label_similarity: labelSimilarity,
    body_similarity: bodySimilarity,
  };
}

/**
 * Calculate simple character-based similarity (0-1).
 * Uses Jaccard similarity on character bigrams.
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const bigramsA = getBigrams(a.toLowerCase());
  const bigramsB = getBigrams(b.toLowerCase());

  const intersection = new Set([...bigramsA].filter(x => bigramsB.has(x)));
  const union = new Set([...bigramsA, ...bigramsB]);

  return union.size > 0 ? intersection.size / union.size : 0.0;
}

/**
 * Get character bigrams from a string.
 */
function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Generate a comparison matrix for all pairs of options.
 * Useful for UX showing similarity heatmap.
 *
 * @param graph - The decision graph
 * @param optionIds - Option IDs to compare
 * @returns Matrix of pairwise similarities (0-1 scores)
 */
export function compareMatrix(
  graph: GraphT,
  optionIds: string[]
): Record<string, Record<string, number>> {
  if (optionIds.length < 2) {
    throw new Error("compare_matrix_min_two: At least 2 option IDs required");
  }

  const matrix: Record<string, Record<string, number>> = {};

  for (const idA of optionIds) {
    matrix[idA] = {};
    for (const idB of optionIds) {
      if (idA === idB) {
        matrix[idA][idB] = 1.0; // Self-similarity is 1.0
      } else {
        const pair = comparePair(graph, idA, idB);
        // Average of label and body similarity (if both present)
        const scores: number[] = [];
        if (pair.label_similarity !== undefined) scores.push(pair.label_similarity);
        if (pair.body_similarity !== undefined) scores.push(pair.body_similarity);
        const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.0;
        matrix[idA][idB] = avgScore;
      }
    }
  }

  return matrix;
}
