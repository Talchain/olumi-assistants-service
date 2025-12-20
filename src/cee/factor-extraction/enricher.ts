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

import type { GraphT, NodeT, EdgeT, FactorDataT } from "../../schemas/graph.js";
import {
  extractFactors,
  extractFactorsOrchestrated,
  generateFactorId,
  type ExtractedFactor,
} from "./index.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";

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
      const hasFactorData = existingNode.data?.value !== undefined ||
                            existingNode.data?.baseline !== undefined;
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
  options: { minConfidence?: number; maxFactors?: number } = {}
): Promise<EnrichmentResultAsync> {
  const { minConfidence = 0.6, maxFactors = 10 } = options;

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
    const result = await extractFactorsOrchestrated(brief);
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
      const hasFactorData = existingNode.data?.value !== undefined ||
                            existingNode.data?.baseline !== undefined;
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
      extractionType: factor.extractionType,
      confidence: factor.confidence,
      rangeMin: factor.rangeMin,
      rangeMax: factor.rangeMax,
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
