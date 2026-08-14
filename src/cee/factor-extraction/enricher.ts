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
  BRIEF_EXTRACTION_CONFIRM_DRIVER,
  briefExtractionQuote,
} from "./brief-extraction-claim.js";
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
import { DEFAULT_EXISTS_PROBABILITY } from "@talchain/schemas";
import { synthesiseDisplayValue } from "./display-value.js";
import {
  CEE_GOAL_THRESHOLD_FRAME,
  resolveGoalThresholdCap,
} from "../../utils/goal-threshold-cap.js";

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

/** Target/goal synonym group for identifying quantities that should be goal thresholds */
const TARGET_GOAL_SYNONYMS = ["target", "goal", "objective", "threshold"];

/**
 * Patterns that indicate the label is a metric/KPI rather than a goal threshold.
 * These should NOT be redirected to goal_threshold even if they contain target/goal words.
 */
const METRIC_CONTEXT_PATTERNS = [
  /\brate\b/i,         // "target completion rate", "goal attainment rate"
  /\bmarket\b/i,       // "target market", "target segment"
  /\bsegment\b/i,      // "target segment churn"
  /\baudience\b/i,     // "target audience"
  /\bcustomer\s+type/i,// "target customer type"
  /\bcompletion\b/i,   // "goal completion rate"
  /\battainment\b/i,   // "goal attainment"
  /\bscore\b/i,        // "goal score"
  /\blevel\b/i,        // "threshold level"
];

/**
 * Check if a label refers to a target/goal quantity (should be goal_threshold, not a factor).
 *
 * Criteria for redirection:
 * 1. Label contains target/goal/objective/threshold
 * 2. Label does NOT contain metric/KPI context patterns
 * 3. Label is short (likely "Target 800" not "Target Market Segment Analysis")
 */
function isTargetGoalLabel(label: string): boolean {
  const normalized = label.toLowerCase().trim();

  // Must contain a goal/target synonym
  const hasGoalSynonym = TARGET_GOAL_SYNONYMS.some((term) => normalized.includes(term));
  if (!hasGoalSynonym) return false;

  // Reject if it looks like a metric/KPI rather than a goal quantity
  const looksLikeMetric = METRIC_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized));
  if (looksLikeMetric) return false;

  // Reject if label is too long (likely a descriptive factor, not a simple target quantity)
  // "Target 800 customers" is 3 words; "Target market segment churn rate" is 5+ words
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount > 4) return false;

  return true;
}

/**
 * Compute a normalisation cap for a large FACTOR-NODE value (display/model
 * normalisation for regular factor nodes — NOT goal thresholds).
 * Uses order-of-magnitude rounding: 800 → 1000, 50000 → 100000.
 *
 * NOTE (cap-doctrine unification, ROADMAP 1.18): the goal-threshold
 * redirection branch below does NOT use this function — it delegates to
 * the shared `resolveGoalThresholdCap` doctrine (../../utils/goal-threshold-cap.js)
 * so a goal target scores identically via the draft (this file) and chat
 * (add_constraint handler) registration paths. This function remains the
 * cap for plain factor nodes (enhance/create branches below), a separate,
 * unrelated concern (factor display legibility, not goal-fit scoring).
 */
function computeNormalisationCap(rawValue: number): number {
  if (rawValue <= 0) return 1;
  // Round up to next order of magnitude
  const orderOfMagnitude = Math.pow(10, Math.ceil(Math.log10(rawValue)));
  return orderOfMagnitude;
}

/**
 * Infer factor_type from unit and value characteristics.
 */
function inferFactorType(
  unit: string | undefined,
  label: string
): "cost" | "price" | "time" | "probability" | "revenue" | "demand" | "quality" | "other" {
  const labelLower = label.toLowerCase();

  // Check unit first
  if (unit === "%") return "probability";
  if (unit && ["£", "$", "€", "GBP", "USD", "EUR"].includes(unit)) {
    // Currency - check label for specifics
    if (labelLower.includes("cost") || labelLower.includes("expense") || labelLower.includes("budget")) {
      return "cost";
    }
    if (labelLower.includes("price") || labelLower.includes("fee")) {
      return "price";
    }
    if (labelLower.includes("revenue") || labelLower.includes("income") || labelLower.includes("sales")) {
      return "revenue";
    }
    return "cost"; // Default for currency
  }

  // Check label patterns
  if (labelLower.includes("customer") || labelLower.includes("user") || labelLower.includes("subscriber")) {
    return "demand";
  }
  if (labelLower.includes("time") || labelLower.includes("duration") || labelLower.includes("period")) {
    return "time";
  }
  if (labelLower.includes("rate") || labelLower.includes("churn") || labelLower.includes("conversion")) {
    return "probability";
  }

  return "other";
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
        belief: factor.confidence ?? DEFAULT_EXISTS_PROBABILITY,
        belief_exists: factor.confidence ?? DEFAULT_EXISTS_PROBABILITY,
        strength_mean: 0.5,
        strength_std: 0.2,
        effect_direction: "positive",
        origin: "enrichment",
        defaulted: true,
        provenance: {
          source: "hypothesis",
          quote: briefExtractionQuote(factor.matchedText),
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
  /**
   * Extraction mode used.
   *
   * ROADMAP 2.281 — `v4_complete_skip` means what it says and ONLY what it
   * says: nothing was written. When the factor-side skip fires but the
   * goal-target redirect still mints a threshold, the mode is
   * `v4_factor_skip_goal_minted`, because a run that changed the graph must
   * not report itself as a complete skip. (The re-witness found the wire
   * carrying no `goal_threshold` at all while the trace claimed a clean
   * "complete skip" — the label was true about factors and silent about the
   * thing that actually mattered.)
   */
  extractionMode:
    | "llm-first"
    | "regex-only"
    | "v4_complete_skip"
    | "v4_factor_skip_goal_minted";
  /** Whether LLM extraction succeeded (if LLM mode used) */
  llmSuccess?: boolean;
  /** Any warnings from extraction */
  warnings: string[];
  /**
   * ATTESTATION (ROADMAP 2.281): the ids of goal nodes whose `goal_threshold`
   * THIS run minted, derived at the mint site itself — never a hand list, never
   * re-inferred by a later stage from the shape of the data.
   *
   * Stage 4b (threshold-sweep) consumes it. Its "possibly model-inferred"
   * heuristic — round raw + digit-free label ⇒ strip — cannot distinguish a
   * model's invention from a user's stated target, and post-#789 the enricher
   * is the ONLY draft mint, so on a digit-free goal label that heuristic could
   * only ever delete a number the USER supplied. This list is what lets the
   * sweep tell the two apart from the RECORD of what happened, rather than by
   * guessing from the number's appearance.
   */
  goalThresholdsMinted: string[];
}

/**
 * Confidence-filter + dedupe the raw extraction into the list the enricher
 * will actually consume.
 *
 * HOISTED (ROADMAP 2.281) so the full path and the factor-skip path qualify
 * candidates through ONE implementation. Two copies of this logic would be
 * exactly the `generateGraphHash` twins defect: they would agree on the day
 * they were written and drift silently thereafter, and the drift would show
 * up as a goal threshold that appears on one draft shape and not another.
 */
function qualifyExtractedFactors(
  extracted: ExtractedFactor[],
  minConfidence: number,
): ExtractedFactor[] {
  const confidenceFiltered = extracted.filter((f) => f.confidence >= minConfidence);

  // Dedupe extracted factors against each other before injection
  // Same value + same unit = duplicate, or matching labels (e.g., "Churn" vs "Churn Rate")
  const qualified: ExtractedFactor[] = [];
  for (const factor of confidenceFiltered) {
    // Indices of every already-qualified factor this one collides with as
    // "the same quantity" (unit-compatible + value within 10%, or matching
    // labels). The predicate is byte-identical to the pre-2.299 `.some`.
    const collidingIdx: number[] = [];
    for (let i = 0; i < qualified.length; i++) {
      const existing = qualified[i];

      // Check unit compatibility first
      if (!unitsCompatible(existing.unit, factor.unit)) continue;

      // Check value within 10% tolerance
      let isDuplicate = false;
      if (existing.value !== undefined && factor.value !== undefined) {
        const tolerance = Math.abs(existing.value * 0.1);
        if (Math.abs(existing.value - factor.value) <= tolerance) {
          isDuplicate = true;
        }
      }

      // Check label similarity (e.g., "Churn" vs "Churn Rate")
      if (!isDuplicate && labelsMatch(existing.label, factor.label)) {
        isDuplicate = true;
      }

      if (isDuplicate) collidingIdx.push(i);
    }

    if (collidingIdx.length === 0) {
      qualified.push(factor);
      continue;
    }

    // ROADMAP 2.299 — the collision is decided by ROLE, then CONFIDENCE, and
    // only on a full tie by push order. The pre-2.299 rule was push order
    // ALONE ("first wins"), which let `genericRange` — an earlier, LOWER
    // confidence, generic extraction — swallow the user's stated Target when
    // a range midpoint landed within 10% of it (#791's collision brief: the
    // user said "our target is 6000000", the product rendered "Target: Not
    // set"). Only a goal/target-labelled factor can reach the goal-threshold
    // mint, so at equal value the Target IS the more truthful reading of the
    // quantity; among equals, the extractor's own confidence ranks them.
    // The challenger must beat EVERY collider — losing to any one of them
    // means an incumbent already covers this quantity better.
    const supersedes = collidingIdx.every((i) => {
      const incumbent = qualified[i];
      const challengerIsTarget = isTargetGoalLabel(factor.label);
      const incumbentIsTarget = isTargetGoalLabel(incumbent.label);
      if (challengerIsTarget !== incumbentIsTarget) return challengerIsTarget;
      return factor.confidence > incumbent.confidence;
    });

    if (supersedes) {
      // Replace the first collider IN PLACE (list position — and therefore
      // everything downstream that is order-sensitive — is preserved), and
      // drop any further colliders: the quantity has one survivor.
      const superseded = qualified[collidingIdx[0]];
      qualified[collidingIdx[0]] = factor;
      for (let j = collidingIdx.length - 1; j >= 1; j--) {
        qualified.splice(collidingIdx[j], 1);
      }
      log.debug(
        {
          keptLabel: factor.label,
          keptValue: factor.value,
          supersededLabel: superseded.label,
          supersededValue: superseded.value,
          event: "cee.factor_extraction.dedupe_superseded",
        },
        `Extracted factor "${factor.label}" superseded colliding "${superseded.label}"`
      );
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

  return qualified;
}

/**
 * THE ONE mint of `goal_threshold` on the draft path.
 *
 * Mutates `enrichedGraph.nodes[goalNodeIndex]` in place (the caller owns the
 * clone) and returns whether it minted. Returns `false` — writing nothing —
 * when the goal node already carries a threshold, which is the pre-existing
 * "first writer wins" rule.
 *
 * ROADMAP 2.281 — extracted verbatim from the enrichment loop so the
 * factor-skip path can reach it. Every line of arithmetic and every stamped
 * field below is unchanged from the in-loop version; only its address moved.
 */
function applyGoalTargetRedirect(
  enrichedGraph: GraphT,
  goalNodeIndex: number,
  factor: ExtractedFactor,
  collector?: CorrectionCollector,
): boolean {
  const currentGoalNode = enrichedGraph.nodes[goalNodeIndex];
  if (currentGoalNode.goal_threshold !== undefined) return false;

  // Full delegation to the SAME cap doctrine as the chat-path
  // add_constraint handler (cap-doctrine unification, ROADMAP 1.18):
  // an existing compatible cap wins, '%' always normalises against
  // 100, else 25% headroom above the raw target. Deliberately NOT
  // computeNormalisationCap (order-of-magnitude) — that diverged
  // from the chat path and scored the same target up to ~5x
  // differently depending on registration path.
  //
  // Regex extraction (cee/factor-extraction/index.ts) pre-divides
  // percentages into a 0-1 fraction before this code runs, whereas
  // resolveGoalThresholdCap's '%' branch — and the chat path's own
  // convention — expects the RAW PERCENT NUMBER (15 for "15%"), the
  // same "value stored in USER UNITS" convention add-constraint.ts
  // uses for goal_threshold_raw. Reconstruct it here so BOTH paths
  // register an IDENTICAL contract (raw/unit/cap/threshold), not
  // just a coincidentally-equal goal_threshold: without this a 15%
  // target registered via the draft path persisted
  // goal_threshold_raw=0.15 (fraction, wrong display units) and no
  // cap, while the chat path persisted raw=15/cap=100 — a
  // draft-vs-chat parity break in the DISPLAY contract even though
  // the scored 0.15 threshold happened to coincide.
  const rawForResolver = factor.unit === "%" ? factor.value * 100 : factor.value;

  let normalizedValue = factor.value;
  let rawValue: number | undefined;
  let cap: number | undefined;

  const resolvedCap = resolveGoalThresholdCap(
    currentGoalNode.goal_threshold_cap,
    rawForResolver,
    factor.unit,
    currentGoalNode.goal_threshold_unit,
  );
  // ROADMAP 2.273 — the user-stated CURRENT LEVEL, carried by the same
  // extraction match that produced the target (so the two numbers are
  // provably about the same metric) and reconstructed into the SAME raw
  // convention as the target above.
  const rawBaseline =
    factor.baseline === undefined
      ? undefined
      : factor.unit === "%"
        ? factor.baseline * 100
        : factor.baseline;

  let normalizedBaseline: number | undefined;

  if (resolvedCap !== null) {
    cap = resolvedCap;
    rawValue = rawForResolver;
    normalizedValue = rawForResolver / resolvedCap;
    // THE SHARED DENOMINATOR. Divided by the very same `resolvedCap` on
    // the same branch, so threshold and baseline cannot drift onto
    // different scales — ISL's `threshold − baseline + intercept` is
    // only meaningful when both operands were scored against one cap,
    // and a mismatch there yields a confident WRONG probability rather
    // than an error.
    normalizedBaseline =
      rawBaseline === undefined ? undefined : rawBaseline / resolvedCap;
  } else {
    rawValue = rawForResolver;
    // No sound denominator exists, so the target itself is registered
    // un-normalised. Carrying a normalised baseline beside an
    // un-normalised threshold would be exactly the cross-scale
    // subtraction guarded against above — so the baseline is omitted
    // too, and ISL keeps refusing honestly.
    normalizedBaseline = undefined;
  }

  // Update goal node with threshold fields
  enrichedGraph.nodes[goalNodeIndex] = {
    ...currentGoalNode,
    goal_threshold: normalizedValue,
    goal_threshold_raw: rawValue,
    goal_threshold_unit: factor.unit ?? "count",
    goal_threshold_cap: cap,
    // ROADMAP 2.258 — attest the FRAME beside the number. A CODE
    // CONSTANT: the arithmetic three lines up is `raw / cap`, an
    // absolute LEVEL on the metric's own scale, so `'level'` is true
    // here by construction and is never derived from `factor`, from the
    // brief, or from anything a model wrote.
    goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME,
    // Only ever present when the brief STATED a current level. No
    // inference, no default, no derivation from the target.
    ...(normalizedBaseline !== undefined && {
      goal_baseline: normalizedBaseline,
      goal_baseline_raw: rawBaseline,
    }),
  };

  log.info(
    {
      goalNodeId: currentGoalNode.id,
      goal_threshold: normalizedValue,
      goal_threshold_raw: rawValue,
      goal_threshold_cap: cap,
      originalLabel: factor.label,
      wasNormalized: cap !== undefined,
      event: "cee.factor_enrichment.goal_threshold_set",
    },
    `Redirected target quantity to goal_threshold on "${currentGoalNode.id}"`
  );

  // Record correction for goal threshold set (Stage 11: Factor Enrichment)
  if (collector) {
    collector.addByStage(
      11, // Stage 11: Factor Enrichment
      "node_modified",
      { node_id: currentGoalNode.id, kind: "goal" },
      `Set goal_threshold from extracted target quantity`,
      { id: currentGoalNode.id },
      {
        id: currentGoalNode.id,
        goal_threshold: normalizedValue,
        goal_threshold_raw: rawValue,
        goal_threshold_cap: cap,
      }
    );
  }

  return true;
}

/**
 * The goal-target redirect, run WITHOUT the factor side.
 *
 * ROADMAP 2.281 — the repair. `allOptionsHaveInterventions` is a sound reason
 * to stop re-extracting FACTORS (the model already supplied them); it was
 * never a reason to skip the GOAL TARGET, which is a number the USER stated
 * and which no amount of model-supplied intervention data can substitute for.
 * Because the skip fires on every well-formed draft, the mint at
 * `applyGoalTargetRedirect` was unreachable in production: the re-witness
 * measured `goal_threshold` ×0 on the wire across three scenario classes,
 * with ISL never asked.
 *
 * DELIBERATELY REGEX-ONLY (`extractFactors`, never `extractFactorsOrchestrated`):
 *   1. #789's doctrine is that no model authors a threshold. The goal target is
 *      a user-stated number and is read deterministically.
 *   2. The skip exists partly to avoid the LLM extraction pass on complete
 *      drafts. Reintroducing that call here would change the cost profile of
 *      every well-formed draft, which this repair has no mandate to do.
 */
function mintGoalTargetOnly(
  graph: GraphT,
  brief: string,
  minConfidence: number,
  collector?: CorrectionCollector,
): { graph: GraphT; mintedGoalId: string | undefined } {
  const goalNodeIndex = graph.nodes.findIndex((n) => n.kind === "goal");
  if (goalNodeIndex < 0) return { graph, mintedGoalId: undefined };

  const target = qualifyExtractedFactors(extractFactors(brief), minConfidence).find((f) =>
    isTargetGoalLabel(f.label),
  );
  if (!target) return { graph, mintedGoalId: undefined };

  // Clone before writing — the skip path returns the caller's own graph object
  // when nothing is minted, and must not mutate it when something is.
  const enrichedGraph: GraphT = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
  };

  const minted = applyGoalTargetRedirect(enrichedGraph, goalNodeIndex, target, collector);
  return minted
    ? { graph: enrichedGraph, mintedGoalId: enrichedGraph.nodes[goalNodeIndex].id }
    : { graph, mintedGoalId: undefined };
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

  // Early exit: skip extraction when LLM provides complete V4 intervention data
  const optionNodes = graph.nodes.filter(n => n.kind === "option");
  if (optionNodes.length > 0) {
    const factorNodes = graph.nodes.filter(n => n.kind === "factor");
    const factorMap = new Map(factorNodes.map(n => [n.id, n]));
    const allOptionsHaveInterventions = optionNodes.every(n => {
      if (!n.data || !('interventions' in n.data)) return false;
      const interventions = (n.data as { interventions: Record<string, number> }).interventions;
      const entries = Object.entries(interventions);
      // Must have at least one intervention, all targets must reference existing factors
      // with quantitative data (value defined) — otherwise enrichment may need to fill gaps
      return entries.length > 0 && entries.every(([factorId]) => {
        const factor = factorMap.get(factorId);
        return factor?.data && 'value' in factor.data;
      });
    });

    if (allOptionsHaveInterventions) {
      // The FACTOR side is genuinely complete — this log line is unchanged, so
      // the existing Render/telemetry signature for the factor skip still reads
      // exactly as it did.
      log.info(
        { optionCount: optionNodes.length, event: "cee.factor_enrichment.v4_complete_skip" },
        "Skipping factor enrichment: all options have complete V4 interventions"
      );

      // ROADMAP 2.281 — but the GOAL TARGET is never covered by option
      // interventions, so it must still be minted. This is the half of the
      // early exit that was silently swallowing the user's stated target on
      // every well-formed draft.
      const goalOnly = mintGoalTargetOnly(graph, brief, minConfidence, collector);
      const minted = goalOnly.mintedGoalId !== undefined;

      if (minted) {
        emit(TelemetryEvents.FactorExtractionComplete, {
          factors_added: 0,
          factors_enhanced: 0,
          factors_skipped: 0,
          goal_thresholds_set: 1,
          total_extracted: 0,
          extraction_mode: "v4_factor_skip_goal_minted",
        });
      }

      return {
        graph: goalOnly.graph,
        factorsAdded: 0,
        factorsEnhanced: 0,
        factorsSkipped: 0,
        // Honest naming: only claim a COMPLETE skip when the run really did
        // write nothing.
        extractionMode: minted ? "v4_factor_skip_goal_minted" : "v4_complete_skip",
        warnings: [],
        goalThresholdsMinted: goalOnly.mintedGoalId ? [goalOnly.mintedGoalId] : [],
      };
    }
  }

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

  // Filter by confidence, then dedupe — ONE implementation, shared with the
  // factor-skip path's goal-target selection (ROADMAP 2.281).
  const qualified = qualifyExtractedFactors(extracted, minConfidence);

  // Get existing factor labels (case-insensitive)
  const existingFactors = graph.nodes.filter((n) => n.kind === "factor");
  const existingLabels = new Set(
    existingFactors.map((n) => n.label?.toLowerCase() || "")
  );

  // Find the goal node for potential goal_threshold redirection
  const goalNode = graph.nodes.find((n) => n.kind === "goal");
  const goalNodeIndex = goalNode ? graph.nodes.findIndex((n) => n.id === goalNode.id) : -1;

  let factorsAdded = 0;
  let factorsEnhanced = 0;
  let factorsSkipped = 0;
  let goalThresholdsSet = 0;
  const goalThresholdsMinted: string[] = [];

  // Deep clone the graph to avoid mutation
  const enrichedGraph: GraphT = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
  };

  for (const factor of qualified) {
    if (factorsAdded >= maxFactors) break;

    // Step 1: Check if this is a target/goal quantity that should be goal_threshold
    // Redirect to goal node instead of injecting as a factor
    if (isTargetGoalLabel(factor.label) && goalNode && goalNodeIndex >= 0) {
      if (applyGoalTargetRedirect(enrichedGraph, goalNodeIndex, factor, collector)) {
        goalThresholdsSet++;
        goalThresholdsMinted.push(goalNode.id);
        continue; // Don't inject as factor
      }
      // goal_threshold was ALREADY set — fall through and treat this factor
      // like any other (unchanged pre-2.281 behaviour).
    }


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
          // Apply normalisation for large non-percentage values
          let normalizedValue = factor.value;
          let rawValue: number | undefined;
          let cap: number | undefined;

          if (factor.unit !== "%" && factor.value > 1) {
            // Large absolute value - normalise using cap
            cap = computeNormalisationCap(factor.value);
            rawValue = factor.value;
            normalizedValue = factor.value / cap;
          }

          const inferredFactorType = inferFactorType(factor.unit, factor.label);
          const factorData: FactorDataT = {
            value: normalizedValue,
            baseline: factor.baseline,
            unit: factor.unit,
            raw_value: rawValue,
            cap: cap,
            extractionType: factor.extractionType,
            confidence: factor.confidence,
            rangeMin: factor.rangeMin,
            rangeMax: factor.rangeMax,
            range: factor.rangeMin !== undefined && factor.rangeMax !== undefined
              ? { min: factor.rangeMin, max: factor.rangeMax }
              : undefined,
            factor_type: inferredFactorType,
            uncertainty_drivers: [BRIEF_EXTRACTION_CONFIRM_DRIVER],
            // Synthesise display_value when the LLM hasn't provided one (CEE-1 fallback)
            display_value: synthesiseDisplayValue({
              value: normalizedValue,
              raw_value: rawValue,
              unit: factor.unit,
              factor_type: inferredFactorType,
              cap,
            }),
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

    // Step 2: Apply normalisation for large non-percentage values
    let normalizedValue = factor.value;
    let rawValue: number | undefined;
    let cap: number | undefined;

    if (factor.unit !== "%" && factor.value > 1) {
      // Large absolute value - normalise using cap
      cap = computeNormalisationCap(factor.value);
      rawValue = factor.value;
      normalizedValue = factor.value / cap;

      log.debug(
        {
          label: factor.label,
          rawValue: factor.value,
          cap,
          normalizedValue,
          event: "cee.factor_enrichment.normalised",
        },
        `Normalised factor value: ${factor.value} / ${cap} = ${normalizedValue}`
      );
    }

    // Create new factor node with V3 fields
    const nodeId = generateFactorId(factor.label, factorsAdded);
    const newFactorType = inferFactorType(factor.unit, factor.label);
    const factorData: FactorDataT = {
      value: normalizedValue,
      baseline: factor.baseline,
      unit: factor.unit,
      raw_value: rawValue,
      cap: cap,
      extractionType: factor.extractionType,
      confidence: factor.confidence,
      rangeMin: factor.rangeMin,
      rangeMax: factor.rangeMax,
      range: factor.rangeMin !== undefined && factor.rangeMax !== undefined
        ? { min: factor.rangeMin, max: factor.rangeMax }
        : undefined,
      // V3 fields for injected factors
      factor_type: newFactorType,
      uncertainty_drivers: [BRIEF_EXTRACTION_CONFIRM_DRIVER],
      // Synthesise display_value when the LLM hasn't provided one (CEE-1 fallback)
      display_value: synthesiseDisplayValue({
        value: normalizedValue,
        raw_value: rawValue,
        unit: factor.unit,
        factor_type: newFactorType,
        cap,
      }),
    };

    // Connect to relevant node first (needed for category inference)
    const targetId = findConnectionTarget(graph, factor);
    const newEdge: EdgeT | null = targetId
      ? {
          from: nodeId,
          to: targetId,
          belief: factor.confidence ?? 0.8,
          belief_exists: factor.confidence ?? 0.8,
          strength_mean: 0.5,
          strength_std: 0.2,
          effect_direction: "positive",
          origin: "enrichment",
          defaulted: true,
          provenance: {
            source: "hypothesis",
            quote: briefExtractionQuote(factor.matchedText),
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
  if (factorsAdded > 0 || factorsEnhanced > 0 || goalThresholdsSet > 0) {
    emit(TelemetryEvents.FactorExtractionComplete, {
      factors_added: factorsAdded,
      factors_enhanced: factorsEnhanced,
      factors_skipped: factorsSkipped,
      goal_thresholds_set: goalThresholdsSet,
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
      goalThresholdsSet,
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
    goalThresholdsMinted,
  };
}
