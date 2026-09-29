/**
 * Factor Matcher
 *
 * Matches intervention targets (from option text) to factor nodes in the graph.
 * Uses exact ID matching, exact label matching, and semantic similarity.
 */

import type { NodeV3T, EdgeV3T } from "../../schemas/cee-v3.js";

/**
 * Result of matching an intervention target to a graph node.
 */
export interface FactorMatchResult {
  /** Whether a match was found */
  matched: boolean;
  /** Matched node ID (if found) */
  node_id?: string;
  /** How the match was determined */
  match_type: "exact_id" | "exact_label" | "semantic" | "none";
  /** Confidence in the match */
  confidence: "high" | "medium" | "low";
  /** Whether the matched node has a path to the goal */
  has_path_to_goal: boolean;
  /** Matched node (if found) */
  matched_node?: NodeV3T;
}

/**
 * Common synonyms for matching.
 */
const SYNONYM_GROUPS: string[][] = [
  ["price", "cost", "pricing", "rate", "fee", "charge"],
  ["revenue", "income", "sales", "earnings"],
  ["profit", "margin", "earnings", "income"],
  ["marketing", "advertising", "promotion", "ads"],
  ["customer", "client", "user", "buyer"],
  ["employee", "staff", "worker", "personnel", "team"],
  ["time", "duration", "period", "timeline", "schedule"],
  ["quality", "standard", "grade", "caliber"],
  ["risk", "danger", "threat", "exposure"],
  ["growth", "expansion", "increase", "gain"],
  ["reduction", "decrease", "cut", "savings"],
  ["investment", "spending", "expenditure", "outlay"],
  ["return", "roi", "yield", "payback"],
];

/**
 * Build a synonym map for fast lookup.
 */
const SYNONYM_MAP = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    const existing = SYNONYM_MAP.get(word) || new Set();
    for (const synonym of group) {
      if (synonym !== word) {
        existing.add(synonym);
      }
    }
    SYNONYM_MAP.set(word, existing);
  }
}

/**
 * Match an intervention target to a factor node in the graph.
 *
 * @param target - Target text to match (e.g., "price", "marketing spend")
 * @param nodes - Graph nodes to search
 * @param edges - Graph edges for path analysis
 * @param goalNodeId - Goal node ID for path-to-goal check
 * @returns Match result
 *
 * @example
 * matchInterventionToFactor("price", nodes, edges, "goal_1")
 * // { matched: true, node_id: "factor_price", match_type: "exact_label", ... }
 */
export function matchInterventionToFactor(
  target: string,
  nodes: NodeV3T[],
  edges: EdgeV3T[],
  goalNodeId: string
): FactorMatchResult {
  const normalizedTarget = normalizeText(target);

  // 1. Try exact ID match
  const exactIdMatch = nodes.find(
    (n) => n.id.toLowerCase() === normalizedTarget || n.id.toLowerCase() === `factor_${normalizedTarget}`
  );
  if (exactIdMatch && isValidInterventionTarget(exactIdMatch)) {
    return {
      matched: true,
      node_id: exactIdMatch.id,
      match_type: "exact_id",
      confidence: "high",
      has_path_to_goal: hasPathToGoal(exactIdMatch.id, edges, goalNodeId),
      matched_node: exactIdMatch,
    };
  }

  // 2. Try exact label match
  const exactLabelMatch = nodes.find(
    (n) => normalizeText(n.label) === normalizedTarget && isValidInterventionTarget(n)
  );
  if (exactLabelMatch) {
    return {
      matched: true,
      node_id: exactLabelMatch.id,
      match_type: "exact_label",
      confidence: "high",
      has_path_to_goal: hasPathToGoal(exactLabelMatch.id, edges, goalNodeId),
      matched_node: exactLabelMatch,
    };
  }

  // 3. Try semantic match (synonym + partial matching)
  const semanticMatch = findSemanticMatch(normalizedTarget, nodes);
  if (semanticMatch) {
    return {
      matched: true,
      node_id: semanticMatch.node.id,
      match_type: "semantic",
      confidence: semanticMatch.confidence,
      has_path_to_goal: hasPathToGoal(semanticMatch.node.id, edges, goalNodeId),
      matched_node: semanticMatch.node,
    };
  }

  // No match found
  return {
    matched: false,
    match_type: "none",
    confidence: "low",
    has_path_to_goal: false,
  };
}

/**
 * Check if a node is a valid intervention target.
 * Only factor nodes can receive interventions.
 */
function isValidInterventionTarget(node: NodeV3T): boolean {
  return node.kind === "factor";
}

/**
 * Normalize text for matching.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .trim();
}

/**
 * Find a semantic match using synonyms and partial matching.
 */
function findSemanticMatch(
  target: string,
  nodes: NodeV3T[]
): { node: NodeV3T; confidence: "high" | "medium" | "low" } | null {
  const targetWords = target.split("_").filter(Boolean);

  // Get all synonyms for target words
  const targetSynonyms = new Set<string>();
  for (const word of targetWords) {
    targetSynonyms.add(word);
    const synonyms = SYNONYM_MAP.get(word);
    if (synonyms) {
      for (const syn of synonyms) {
        targetSynonyms.add(syn);
      }
    }
  }

  let bestMatch: { node: NodeV3T; score: number } | null = null;

  for (const node of nodes) {
    if (!isValidInterventionTarget(node)) continue;

    const nodeText = normalizeText(node.label);
    const nodeWords = nodeText.split("_").filter(Boolean);

    // Calculate similarity score
    let matchingWords = 0;
    for (const nodeWord of nodeWords) {
      if (targetSynonyms.has(nodeWord)) {
        matchingWords++;
      }
      // Also check if node word has synonyms matching target
      const nodeSynonyms = SYNONYM_MAP.get(nodeWord);
      if (nodeSynonyms) {
        for (const syn of nodeSynonyms) {
          if (targetWords.includes(syn)) {
            matchingWords += 0.5;
            break;
          }
        }
      }
    }

    // Also check for substring matches
    if (nodeText.includes(target) || target.includes(nodeText)) {
      matchingWords += 1;
    }

    const score = matchingWords / Math.max(targetWords.length, nodeWords.length);

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { node, score };
    }
  }

  if (!bestMatch) {
    return null;
  }

  // Determine confidence based on score
  let confidence: "high" | "medium" | "low";
  if (bestMatch.score >= 0.8) {
    confidence = "high";
  } else if (bestMatch.score >= 0.5) {
    confidence = "medium";
  } else if (bestMatch.score >= 0.3) {
    confidence = "low";
  } else {
    return null; // Score too low
  }

  return { node: bestMatch.node, confidence };
}

/**
 * Check if a node has a path to the goal node.
 *
 * Uses BFS to traverse the graph from the node towards the goal.
 */
export function hasPathToGoal(nodeId: string, edges: EdgeV3T[], goalNodeId: string): boolean {
  if (nodeId === goalNodeId) {
    return true;
  }

  const visited = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    // Find all nodes this node connects to
    for (const edge of edges) {
      if (edge.from === current) {
        if (edge.to === goalNodeId) {
          return true;
        }
        if (!visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
  }

  return false;
}

/**
 * Batch match multiple targets to factors.
 *
 * @param targets - Array of target texts to match
 * @param nodes - Graph nodes
 * @param edges - Graph edges
 * @param goalNodeId - Goal node ID
 * @returns Map of target to match result
 */
export function batchMatchFactors(
  targets: string[],
  nodes: NodeV3T[],
  edges: EdgeV3T[],
  goalNodeId: string
): Map<string, FactorMatchResult> {
  const results = new Map<string, FactorMatchResult>();

  for (const target of targets) {
    results.set(target, matchInterventionToFactor(target, nodes, edges, goalNodeId));
  }

  return results;
}

/**
 * Find all factor nodes in a graph.
 */
export function findFactorNodes(nodes: NodeV3T[]): NodeV3T[] {
  return nodes.filter((n) => n.kind === "factor");
}

/**
 * Get match statistics for a set of targets.
 */
export interface MatchStatistics {
  total: number;
  matched: number;
  exact_id_matches: number;
  exact_label_matches: number;
  semantic_matches: number;
  unmatched: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  with_goal_path: number;
}

export function getMatchStatistics(matches: Map<string, FactorMatchResult>): MatchStatistics {
  const stats: MatchStatistics = {
    total: matches.size,
    matched: 0,
    exact_id_matches: 0,
    exact_label_matches: 0,
    semantic_matches: 0,
    unmatched: 0,
    high_confidence: 0,
    medium_confidence: 0,
    low_confidence: 0,
    with_goal_path: 0,
  };

  for (const result of matches.values()) {
    if (result.matched) {
      stats.matched++;
      if (result.match_type === "exact_id") stats.exact_id_matches++;
      if (result.match_type === "exact_label") stats.exact_label_matches++;
      if (result.match_type === "semantic") stats.semantic_matches++;
      if (result.has_path_to_goal) stats.with_goal_path++;
    } else {
      stats.unmatched++;
    }

    if (result.confidence === "high") stats.high_confidence++;
    if (result.confidence === "medium") stats.medium_confidence++;
    if (result.confidence === "low") stats.low_confidence++;
  }

  return stats;
}
