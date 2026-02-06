/**
 * Factor Enrichment Post-Processor
 *
 * Enriches decision graphs with factor nodes extracted from the brief.
 * Runs after LLM graph generation to ensure quantitative data is captured
 * even if the LLM misses it.
 *
 * When CEE_LLM_FIRST_EXTRACTION_ENABLED=true, uses LLM-first extraction
 * with market context and regex fallback/validation.
 */

import type { GraphT, NodeT, EdgeT, FactorDataT, NodeDataT } from "../../schemas/graph.js";
import {
  extractFactors,
  extractFactorsOrchestrated,
  generateFactorId,
  type ExtractedFactor,
} from "./index.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
import type { CorrectionCollector } from "../corrections.js";
import { formatEdgeId } from "../corrections.js";

/**
 * Type guard to check if node data is FactorData (not OptionData)
 * OptionData has 'interventions', FactorData does not
 */
function isFactorData(data: NodeDataT | undefined): data is FactorDataT {
  if (!data) return false;
  return !('interventions' in data);
}

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
 * Synonym groups for semantic label matching.
 * Each group contains terms that refer to the same concept.
 */
const SYNONYM_GROUPS = [
  ["price", "cost", "fee", "expense"],
  ["budget", "investment", "funding", "spend", "capital"],
  ["churn", "attrition", "turnover", "retention"],
  ["conversion", "upgrade", "signup", "acquisition"],
  ["revenue", "income", "sales", "earnings"],
  ["growth", "increase", "expansion", "scale"],
  ["user", "customer", "subscriber", "client"],
  ["target", "goal", "objective", "threshold"],
  ["rate", "percentage", "ratio", "proportion"],
  ["time", "duration", "period", "timeline"],
];

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

  // Check synonym groups
  for (const group of SYNONYM_GROUPS) {
    const has1 = group.some((s) => n1.includes(s));
    const has2 = group.some((s) => n2.includes(s));
    if (has1 && has2) return true;
  }

  return false;
}

/**
 * Check if units are compatible for duplicate detection.
 * Units match if: both undefined, both equal, or one undefined and semantic label matches.
 */
function unitsCompatible(existingUnit: string | undefined, extractedUnit: string | undefined): boolean {
  // Both undefined = compatible (unitless values)
  if (existingUnit === undefined && extractedUnit === undefined) return true;
  // Both defined and equal
  if (existingUnit !== undefined && extractedUnit !== undefined && existingUnit === extractedUnit) return true;
  // Mismatch: one has unit, other doesn't, or different units
  return false;
}

/**
 * Check if an extracted quantity is already covered by an existing LLM-generated factor.
 * Uses value matching (with tolerance) AND unit compatibility to avoid false matches.
 */
function isQuantityCoveredByExistingFactor(
  extracted: ExtractedFactor,
  existingFactors: NodeT[]
): { covered: boolean; matchedNode?: NodeT; matchReason?: string } {
  for (const node of existingFactors) {
    if (node.kind !== "factor" || !node.data) continue;
    if (!isFactorData(node.data)) continue;
    const data = node.data;

    // For numeric comparisons, require unit compatibility to avoid 5% vs $5 false matches
    const unitsMatch = unitsCompatible(data.unit, extracted.unit);

    // Match on value within 10% tolerance (requires compatible units)
    if (unitsMatch && data.value !== undefined && extracted.value !== undefined) {
      const tolerance = Math.abs(data.value * 0.1);
      if (Math.abs(data.value - extracted.value) <= tolerance) {
        return { covered: true, matchedNode: node, matchReason: "value_match" };
      }
    }

    // Match on raw_value within 10% tolerance (requires compatible units)
    if (unitsMatch && data.raw_value !== undefined && extracted.value !== undefined) {
      const tolerance = Math.abs(data.raw_value * 0.1);
      if (Math.abs(data.raw_value - extracted.value) <= tolerance) {
        return { covered: true, matchedNode: node, matchReason: "raw_value_match" };
      }
    }

    // Match on cap value within 10% tolerance (requires compatible units)
    if (unitsMatch && data.cap !== undefined && extracted.value !== undefined) {
      const tolerance = Math.abs(data.cap * 0.1);
      if (Math.abs(data.cap - extracted.value) <= tolerance) {
        return { covered: true, matchedNode: node, matchReason: "cap_match" };
      }
    }

    // Match on unit + semantic label overlap (using synonym groups)
    if (data.unit && extracted.unit && data.unit === extracted.unit && node.label) {
      if (labelsMatch(node.label, extracted.label)) {
        return { covered: true, matchedNode: node, matchReason: "unit_label_match" };
      }
    }
  }
  return { covered: false };
}

/**
 * Infer factor category from graph edge structure.
 * - controllable: Has incoming edge from option node
 * - observable: Has data.value but no option edge, or has outbound edges
 * - external: No edges and no clear state
 */
function inferCategoryFromEdges(
  nodeId: string,
  edges: EdgeT[],
  nodes: NodeT[]
): "controllable" | "observable" | "external" {
  const optionNodeIds = new Set(
    nodes.filter((n) => n.kind === "option").map((n) => n.id)
  );

  // Check for incoming edges from option nodes
  const hasInboundOptionEdge = edges.some(
    (e) => e.to === nodeId && optionNodeIds.has(e.from)
  );
  if (hasInboundOptionEdge) return "controllable";

  // Check for any outbound edges (indicates observable influence)
  const hasOutboundEdge = edges.some((e) => e.from === nodeId);
  if (hasOutboundEdge) return "observable";

  // Default to external for isolated factors
  return "external";
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
 * Enrich a graph with extracted factors from the brief.
 *
 * When CEE_LLM_FIRST_EXTRACTION_ENABLED=true, uses LLM-first extraction
 * with market context. Falls back to regex-only for synchronous callers.
 *
 * @deprecated Use enrichGraphWithFactorsAsync for LLM-first support
 */
export function enrichGraphWithFactors(
  graph: GraphT,
  brief: string,
  options: { minConfidence?: number; maxFactors?: number } = {}
): EnrichmentResult {
  const { minConfidence = 0.6, maxFactors = 10 } = options;

  // Sync version always uses regex extraction
  // Use enrichGraphWithFactorsAsync for LLM-first support
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
      // Enhance existing factor with data if it doesn't have meaningful values
      // Check for actual numeric data, not just existence of data object
      // Use type guard to ensure we're checking FactorData properties (not OptionData)
      const hasFactorData = isFactorData(existingNode.data) && (
        existingNode.data.value !== undefined ||
        existingNode.data.baseline !== undefined
      );
      if (!hasFactorData) {
        const nodeIndex = enrichedGraph.nodes.findIndex((n) => n.id === existingNode.id);
        if (nodeIndex >= 0) {
          const factorData: FactorDataT = {
            value: factor.value,
            baseline: factor.baseline,
            unit: factor.unit,
            // Include extraction metadata for value_std derivation
            extractionType: factor.extractionType,
            confidence: factor.confidence,
            rangeMin: factor.rangeMin,
            rangeMax: factor.rangeMax,
            // Synthesize range object for backward compatibility
            range: factor.rangeMin !== undefined && factor.rangeMax !== undefined
              ? { min: factor.rangeMin, max: factor.rangeMax }
              : undefined,
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
      // Include extraction metadata for value_std derivation
      extractionType: factor.extractionType,
      confidence: factor.confidence,
      rangeMin: factor.rangeMin,
      rangeMax: factor.rangeMax,
      // Synthesize range object for backward compatibility
      range: factor.rangeMin !== undefined && factor.rangeMax !== undefined
        ? { min: factor.rangeMin, max: factor.rangeMax }
        : undefined,
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

/**
 * Extended enrichment result with LLM metadata
 */
export interface EnrichmentResultAsync extends EnrichmentResult {
  /** Extraction mode used (llm-first or regex-only) */
  extractionMode: "llm-first" | "regex-only";
  /** Whether LLM extraction succeeded (if LLM mode used) */
  llmSuccess?: boolean;
  /** Any warnings from extraction */
  warnings: string[];
}

/**
 * Enrich a graph with extracted factors from the brief (async version).
 *
 * When CEE_LLM_FIRST_EXTRACTION_ENABLED=true, uses LLM-first extraction
 * with market context, glossary expansion, and regex validation/fallback.
 *
 * This is the preferred method for callers that can handle async operations.
 */
export async function enrichGraphWithFactorsAsync(
  graph: GraphT,
  brief: string,
  options: { minConfidence?: number; maxFactors?: number; collector?: CorrectionCollector; modelOverride?: string } = {}
): Promise<EnrichmentResultAsync> {
  const { minConfidence = 0.6, maxFactors = 10, collector, modelOverride } = options;

  // Check feature flag for LLM-first extraction
  let useLLMFirst = false;
  try {
    useLLMFirst = config.cee.llmFirstExtractionEnabled;
  } catch {
    // Config validation failed, default to regex
  }

  let extracted: ExtractedFactor[];
  let extractionMode: "llm-first" | "regex-only" = "regex-only";
  let llmSuccess: boolean | undefined;
  let warnings: string[] = [];

  if (useLLMFirst) {
    // Use orchestrated extraction (LLM-first with regex fallback)
    const result = await extractFactorsOrchestrated(brief, { modelOverride });
    extracted = result.factors;
    extractionMode = result.mode;
    llmSuccess = result.llmSuccess;
    warnings = result.warnings;

    log.debug(
      {
        mode: result.mode,
        llmSuccess: result.llmSuccess,
        factorCount: extracted.length,
        mergeStats: result.mergeStats,
      },
      "Orchestrated factor extraction complete"
    );
  } else {
    // Use regex-only extraction
    extracted = extractFactors(brief);
  }

  // Filter by confidence
  const confidenceFiltered = extracted.filter((f) => f.confidence >= minConfidence);

  // Dedupe extracted factors against each other before injection
  // Same value + same unit = duplicate, or matching labels (e.g., "Churn" vs "Churn Rate")
  const qualified: ExtractedFactor[] = [];
  for (const factor of confidenceFiltered) {
    const isDuplicate = qualified.some((existing) => {
      // Check unit compatibility first
      if (!unitsCompatible(existing.unit, factor.unit)) return false;

      // Check value within 10% tolerance
      if (existing.value !== undefined && factor.value !== undefined) {
        const tolerance = Math.abs(existing.value * 0.1);
        if (Math.abs(existing.value - factor.value) <= tolerance) {
          return true;
        }
      }

      // Check label similarity (e.g., "Churn" vs "Churn Rate")
      if (labelsMatch(existing.label, factor.label)) {
        return true;
      }

      return false;
    });

    if (!isDuplicate) {
      qualified.push(factor);
    } else {
      log.debug(
        {
          skippedLabel: factor.label,
          skippedValue: factor.value,
          event: "cee.factor_extraction.dedupe_within_extraction",
        },
        `Skipping duplicate extracted factor: "${factor.label}"`
      );
    }
  }

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
      // Enhance existing factor with data if it doesn't have meaningful values
      // Use type guard to ensure we're checking FactorData properties (not OptionData)
      const hasFactorData = isFactorData(existingNode.data) && (
        existingNode.data.value !== undefined ||
        existingNode.data.baseline !== undefined
      );
      if (!hasFactorData) {
        const nodeIndex = enrichedGraph.nodes.findIndex((n) => n.id === existingNode.id);
        if (nodeIndex >= 0) {
          const factorData: FactorDataT = {
            value: factor.value,
            baseline: factor.baseline,
            unit: factor.unit,
            extractionType: factor.extractionType,
            confidence: factor.confidence,
            rangeMin: factor.rangeMin,
            rangeMax: factor.rangeMax,
            range: factor.rangeMin !== undefined && factor.rangeMax !== undefined
              ? { min: factor.rangeMin, max: factor.rangeMax }
              : undefined,
          };
          const beforeData = enrichedGraph.nodes[nodeIndex].data;
          enrichedGraph.nodes[nodeIndex] = {
            ...enrichedGraph.nodes[nodeIndex],
            data: factorData,
          };
          factorsEnhanced++;

          // Record correction for enhanced factor node (Stage 11: Factor Enrichment)
          if (collector) {
            collector.addByStage(
              11, // Stage 11: Factor Enrichment
              "node_modified",
              { node_id: existingNode.id, kind: "factor" },
              `Enhanced existing factor node with extracted data`,
              beforeData,
              factorData
            );
          }
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

    // Check if quantity is already covered by an LLM-generated factor
    const coverageCheck = isQuantityCoveredByExistingFactor(factor, existingFactors);
    if (coverageCheck.covered) {
      factorsSkipped++;
      log.info(
        {
          skippedLabel: factor.label,
          skippedValue: factor.value,
          matchedNodeId: coverageCheck.matchedNode?.id,
          matchedNodeLabel: coverageCheck.matchedNode?.label,
          matchReason: coverageCheck.matchReason,
          event: "cee.factor_enrichment.skipped_duplicate",
        },
        `Skipping factor injection: "${factor.label}" covered by LLM factor "${coverageCheck.matchedNode?.id}"`
      );
      continue;
    }

    // Create new factor node
    const nodeId = generateFactorId(factor.label, factorsAdded);
    const factorData: FactorDataT = {
      value: factor.value,
      baseline: factor.baseline,
      unit: factor.unit,
      extractionType: factor.extractionType,
      confidence: factor.confidence,
      rangeMin: factor.rangeMin,
      rangeMax: factor.rangeMax,
      range: factor.rangeMin !== undefined && factor.rangeMax !== undefined
        ? { min: factor.rangeMin, max: factor.rangeMax }
        : undefined,
    };

    // Connect to relevant node first (needed for category inference)
    const targetId = findConnectionTarget(graph, factor);
    const newEdge: EdgeT | null = targetId
      ? {
          from: nodeId,
          to: targetId,
          belief: factor.confidence,
          provenance: {
            source: "hypothesis",
            quote: `Extracted from brief: "${factor.matchedText}"`,
          },
          provenance_source: "hypothesis",
        }
      : null;

    // Infer category from edge structure
    const allEdges = newEdge ? [...enrichedGraph.edges, newEdge] : enrichedGraph.edges;
    const category = inferCategoryFromEdges(nodeId, allEdges, enrichedGraph.nodes);

    const newNode: NodeT = {
      id: nodeId,
      kind: "factor",
      label: factor.label,
      data: factorData,
      category,
    };

    enrichedGraph.nodes.push(newNode);
    existingLabels.add(factor.label.toLowerCase());

    // Record correction for added factor node (Stage 11: Factor Enrichment)
    if (collector) {
      collector.addByStage(
        11, // Stage 11: Factor Enrichment
        "node_added",
        { node_id: nodeId, kind: "factor" },
        `Added factor node extracted from brief (category: ${category})`,
        undefined,
        { id: nodeId, kind: "factor", label: factor.label, category }
      );
    }

    // Add the edge to the graph
    if (newEdge) {
      enrichedGraph.edges.push(newEdge);

      // Record correction for added factor edge (Stage 11: Factor Enrichment)
      if (collector) {
        collector.addByStage(
          11, // Stage 11: Factor Enrichment
          "edge_added",
          { edge_id: formatEdgeId(nodeId, targetId!) },
          `Added edge connecting factor to ${targetId}`,
          undefined,
          { from: nodeId, to: targetId, belief: factor.confidence }
        );
      }
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
      extraction_mode: extractionMode,
      llm_success: llmSuccess,
    });
  }

  log.debug(
    {
      factorsAdded,
      factorsEnhanced,
      factorsSkipped,
      totalExtracted: extracted.length,
      extractionMode,
      llmSuccess,
    },
    "Factor enrichment complete (async)"
  );

  return {
    graph: enrichedGraph,
    factorsAdded,
    factorsEnhanced,
    factorsSkipped,
    extractionMode,
    llmSuccess,
    warnings,
  };
}
