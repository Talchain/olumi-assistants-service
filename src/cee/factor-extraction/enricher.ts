/**
 * Factor Enrichment Post-Processor
 *
 * Enriches decision graphs with factor nodes extracted from the brief.
 * Runs after LLM graph generation to ensure quantitative data is captured
 * even if the LLM misses it.
 */

import type { GraphT, NodeT, EdgeT, FactorDataT } from "../../schemas/graph.js";
import { extractFactors, generateFactorId, type ExtractedFactor } from "./index.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";

/**
 * Result of factor enrichment
 */
export interface EnrichmentResult {
  /** The enriched graph */
  graph: GraphT;
  /** Number of factors added */
  factorsAdded: number;
  /** Number of existing factors enhanced with data */
  factorsEnhanced: number;
  /** Factors that were extracted but not added (duplicates) */
  factorsSkipped: number;
}

/**
 * Check if two labels refer to the same concept
 */
function labelsMatch(label1: string, label2: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .trim();

  const n1 = normalize(label1);
  const n2 = normalize(label2);

  // Exact match
  if (n1 === n2) return true;

  // Substring match (e.g., "price" matches "pro plan price")
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Common synonyms
  const synonymGroups = [
    ["price", "cost", "fee"],
    ["churn", "attrition", "turnover"],
    ["conversion", "upgrade", "signup"],
    ["revenue", "income", "sales"],
    ["growth", "increase", "expansion"],
    ["user", "customer", "subscriber"],
  ];

  for (const group of synonymGroups) {
    const has1 = group.some((s) => n1.includes(s));
    const has2 = group.some((s) => n2.includes(s));
    if (has1 && has2) return true;
  }

  return false;
}

/**
 * Find the most relevant node to connect a factor to
 */
function findConnectionTarget(graph: GraphT, factor: ExtractedFactor): string | null {
  // Priority: decision > option > goal > outcome
  const priorityOrder = ["decision", "option", "goal", "outcome"];

  for (const kind of priorityOrder) {
    const candidates = graph.nodes.filter((n) => n.kind === kind);
    if (candidates.length > 0) {
      // Try to find one with a matching label
      const labelMatch = candidates.find(
        (n) => n.label && labelsMatch(n.label, factor.label)
      );
      if (labelMatch) return labelMatch.id;

      // Otherwise return the first one
      return candidates[0].id;
    }
  }

  // Fallback: any node
  return graph.nodes[0]?.id || null;
}

/**
 * Enrich a graph with extracted factors from the brief
 */
export function enrichGraphWithFactors(
  graph: GraphT,
  brief: string,
  options: { minConfidence?: number; maxFactors?: number } = {}
): EnrichmentResult {
  const { minConfidence = 0.6, maxFactors = 10 } = options;

  // Extract factors from brief
  const extracted = extractFactors(brief);

  // Filter by confidence
  const qualified = extracted.filter((f) => f.confidence >= minConfidence);

  // Get existing factor labels (case-insensitive)
  const existingFactors = graph.nodes.filter((n) => n.kind === "factor");
  const existingLabels = new Set(
    existingFactors.map((n) => n.label?.toLowerCase() || "")
  );

  let factorsAdded = 0;
  let factorsEnhanced = 0;
  let factorsSkipped = 0;

  // Deep clone the graph to avoid mutation
  const enrichedGraph: GraphT = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
  };

  for (const factor of qualified) {
    if (factorsAdded >= maxFactors) break;

    // Check if a similar factor already exists
    const existingNode = existingFactors.find(
      (n) => n.label && labelsMatch(n.label, factor.label)
    );

    if (existingNode) {
      // Enhance existing factor with data if it doesn't have any
      if (!existingNode.data) {
        const nodeIndex = enrichedGraph.nodes.findIndex((n) => n.id === existingNode.id);
        if (nodeIndex >= 0) {
          const factorData: FactorDataT = {
            value: factor.value,
            baseline: factor.baseline,
            unit: factor.unit,
          };
          enrichedGraph.nodes[nodeIndex] = {
            ...enrichedGraph.nodes[nodeIndex],
            data: factorData,
          };
          factorsEnhanced++;
        }
      } else {
        factorsSkipped++;
      }
      continue;
    }

    // Check if label already exists (exact match)
    if (existingLabels.has(factor.label.toLowerCase())) {
      factorsSkipped++;
      continue;
    }

    // Create new factor node
    const nodeId = generateFactorId(factor.label, factorsAdded);
    const factorData: FactorDataT = {
      value: factor.value,
      baseline: factor.baseline,
      unit: factor.unit,
    };

    const newNode: NodeT = {
      id: nodeId,
      kind: "factor",
      label: factor.label,
      data: factorData,
    };

    enrichedGraph.nodes.push(newNode);
    existingLabels.add(factor.label.toLowerCase());

    // Connect to relevant node
    const targetId = findConnectionTarget(graph, factor);
    if (targetId) {
      const newEdge: EdgeT = {
        from: nodeId,
        to: targetId,
        belief: factor.confidence,
        provenance: {
          source: "hypothesis",
          quote: `Extracted from brief: "${factor.matchedText}"`,
        },
        provenance_source: "hypothesis",
      };
      enrichedGraph.edges.push(newEdge);
    }

    factorsAdded++;
  }

  // Emit telemetry
  if (factorsAdded > 0 || factorsEnhanced > 0) {
    emit(TelemetryEvents.FactorExtractionComplete, {
      factors_added: factorsAdded,
      factors_enhanced: factorsEnhanced,
      factors_skipped: factorsSkipped,
      total_extracted: extracted.length,
    });
  }

  log.debug(
    { factorsAdded, factorsEnhanced, factorsSkipped, totalExtracted: extracted.length },
    "Factor enrichment complete"
  );

  return {
    graph: enrichedGraph,
    factorsAdded,
    factorsEnhanced,
    factorsSkipped,
  };
}
