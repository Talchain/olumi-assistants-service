/**
 * Effect Direction Inference
 *
 * Infers effect direction (positive/negative) when the LLM doesn't provide it.
 * Uses heuristics based on node types, labels, and common causal patterns.
 *
 * This is a fallback mechanism - the LLM should output effect_direction directly.
 */

export type EffectDirection = "positive" | "negative";

export interface NodeInfo {
  id: string;
  kind: string;
  label: string;
}

// Patterns that typically indicate negative effects
const NEGATIVE_SOURCE_PATTERNS = [
  /\brisk\b/i,
  /\bcost\b/i,
  /\bexpense\b/i,
  /\bprice\b/i,
  /\bcompetition\b/i,
  /\bcompetitor\b/i,
  /\bchurn\b/i,
  /\battrition\b/i,
  /\bloss\b/i,
  /\bdebt\b/i,
  /\bliability\b/i,
  /\bfriction\b/i,
  /\bbarrier\b/i,
  /\bobstacle\b/i,
  /\bdelay\b/i,
  /\bcomplexity\b/i,
  /\bdifficulty\b/i,
];

const POSITIVE_TARGET_PATTERNS = [
  /\bsuccess\b/i,
  /\bprofit\b/i,
  /\brevenue\b/i,
  /\bgrowth\b/i,
  /\bsatisfaction\b/i,
  /\bretention\b/i,
  /\bconversion\b/i,
  /\bdemand\b/i,
  /\bsales\b/i,
  /\bshare\b/i,
  /\bvalue\b/i,
  /\bquality\b/i,
  /\bperformance\b/i,
  /\befficiency\b/i,
];

// Specific known negative relationships
const KNOWN_NEGATIVE_RELATIONSHIPS: Array<{
  sourcePattern: RegExp;
  targetPattern: RegExp;
}> = [
  // Price → Demand (classic inverse relationship)
  { sourcePattern: /\bprice\b/i, targetPattern: /\bdemand\b/i },
  { sourcePattern: /\bprice\b/i, targetPattern: /\bvolume\b/i },
  { sourcePattern: /\bprice\b/i, targetPattern: /\bsales\b/i },
  { sourcePattern: /\bprice\b/i, targetPattern: /\bconversion\b/i },

  // Risk → Success/Profit
  { sourcePattern: /\brisk\b/i, targetPattern: /\bsuccess\b/i },
  { sourcePattern: /\brisk\b/i, targetPattern: /\bprofit\b/i },
  { sourcePattern: /\brisk\b/i, targetPattern: /\brevenue\b/i },

  // Competition → Market Share
  { sourcePattern: /\bcompetit/i, targetPattern: /\bshare\b/i },
  { sourcePattern: /\bcompetit/i, targetPattern: /\brevenue\b/i },

  // Churn → Revenue/Growth
  { sourcePattern: /\bchurn\b/i, targetPattern: /\brevenue\b/i },
  { sourcePattern: /\bchurn\b/i, targetPattern: /\bgrowth\b/i },
  { sourcePattern: /\battrition\b/i, targetPattern: /\bretention\b/i },

  // Cost → Profit
  { sourcePattern: /\bcost\b/i, targetPattern: /\bprofit\b/i },
  { sourcePattern: /\bexpense\b/i, targetPattern: /\bprofit\b/i },

  // Delay → Success/Delivery
  { sourcePattern: /\bdelay\b/i, targetPattern: /\bsuccess\b/i },
  { sourcePattern: /\bdelay\b/i, targetPattern: /\bdelivery\b/i },
  { sourcePattern: /\bdelay\b/i, targetPattern: /\bon.?time\b/i },

  // Complexity → Efficiency
  { sourcePattern: /\bcomplexity\b/i, targetPattern: /\befficiency\b/i },
  { sourcePattern: /\bcomplexity\b/i, targetPattern: /\bspeed\b/i },
];

/**
 * Check if a relationship matches any known negative pattern.
 */
function matchesKnownNegativeRelationship(
  fromLabel: string,
  toLabel: string
): boolean {
  return KNOWN_NEGATIVE_RELATIONSHIPS.some(
    ({ sourcePattern, targetPattern }) =>
      sourcePattern.test(fromLabel) && targetPattern.test(toLabel)
  );
}

/**
 * Check if the source node typically has negative effects.
 */
function isNegativeSourceNode(label: string, kind: string): boolean {
  // Risk nodes typically have negative effects
  if (kind === "risk") {
    return true;
  }

  // Check label against negative source patterns
  return NEGATIVE_SOURCE_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Check if the target node is typically a positive outcome.
 */
function isPositiveTargetNode(label: string, kind: string): boolean {
  // Goal and positive outcome nodes
  if (kind === "goal") {
    return true;
  }

  return POSITIVE_TARGET_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Infer effect direction when LLM doesn't provide it.
 *
 * Uses heuristics based on node types and common causal patterns.
 *
 * @param edge - Edge with from/to node IDs
 * @param fromNode - Source node info
 * @param toNode - Target node info
 * @returns Inferred effect direction
 *
 * @example
 * inferEffectDirection(
 *   { from: 'price', to: 'demand' },
 *   { id: 'price', kind: 'factor', label: 'Price' },
 *   { id: 'demand', kind: 'outcome', label: 'Customer Demand' }
 * ) // Returns 'negative'
 */
export function inferEffectDirection(
  edge: { from: string; to: string },
  fromNode: NodeInfo,
  toNode: NodeInfo
): EffectDirection {
  const fromLabel = fromNode.label.toLowerCase();
  const toLabel = toNode.label.toLowerCase();

  // Check known negative relationships first (highest priority)
  if (matchesKnownNegativeRelationship(fromLabel, toLabel)) {
    return "negative";
  }

  // Check if source is a negative factor affecting a positive outcome
  if (
    isNegativeSourceNode(fromLabel, fromNode.kind) &&
    isPositiveTargetNode(toLabel, toNode.kind)
  ) {
    return "negative";
  }

  // Default to positive for most relationships
  return "positive";
}

/**
 * Ensure edge has effect_direction, inferring if necessary.
 *
 * @param edge - Edge object (may or may not have effect_direction)
 * @param nodes - Array of all nodes in the graph
 * @returns Effect direction (from edge or inferred)
 */
export function ensureEffectDirection(
  edge: { from: string; to: string; effect_direction?: EffectDirection },
  nodes: NodeInfo[]
): EffectDirection {
  // If LLM provided it, use it
  if (
    edge.effect_direction === "positive" ||
    edge.effect_direction === "negative"
  ) {
    return edge.effect_direction;
  }

  // Otherwise infer from node context
  const fromNode = nodes.find((n) => n.id === edge.from);
  const toNode = nodes.find((n) => n.id === edge.to);

  if (!fromNode || !toNode) {
    // Can't infer without node info, default to positive
    return "positive";
  }

  return inferEffectDirection(edge, fromNode, toNode);
}

/**
 * Batch ensure effect_direction for all edges in a graph.
 *
 * @param edges - Array of edges
 * @param nodes - Array of nodes
 * @returns Array of effect directions (same order as edges)
 */
export function ensureEffectDirectionBatch(
  edges: Array<{ from: string; to: string; effect_direction?: EffectDirection }>,
  nodes: NodeInfo[]
): EffectDirection[] {
  return edges.map((edge) => ensureEffectDirection(edge, nodes));
}
