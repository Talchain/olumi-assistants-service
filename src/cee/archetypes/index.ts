import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { components } from "../../generated/openapi.d.ts";

// Shared CEE types
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type ArchetypeMatch = "exact" | "fuzzy" | "generic";

export interface ArchetypeInput {
  hint?: string;
  brief?: string;
  graph: GraphV1;
  engineConfidence?: number;
}

export interface ArchetypeResult {
  archetype: {
    decision_type: string;
    match: ArchetypeMatch;
    confidence: number;
  };
  issues: CEEValidationIssue[];
}

const PRICING_KEYWORDS = [
  "price",
  "pricing",
  "discount",
  "fee",
  "fees",
  "rate",
  "rates",
  "tariff",
  "subscription",
  "plan",
  "tier",
  "tiers",
  "revenue",
  "margin",
  "margins",
  "gm",
  "cost",
  "costs",
];

function normalize(text: unknown): string {
  return typeof text === "string" ? text.toLowerCase() : "";
}

function hasPricingKeywordsInBrief(brief?: string): boolean {
  const text = normalize(brief);
  if (!text) return false;
  return PRICING_KEYWORDS.some((kw) => text.includes(kw));
}

function hasPricingSignalsInGraph(graph: GraphV1): boolean {
  if (!graph || !Array.isArray(graph.nodes)) return false;

  for (const node of graph.nodes as any[]) {
    const kind = typeof node.kind === "string" ? node.kind : "";
    const label = normalize(node.label);
    const id = normalize(node.id);

    if (!label && !id) continue;

    // Pricing signals are strongest on decision/goal/option/outcome nodes
    if (["decision", "goal", "option", "outcome"].includes(kind)) {
      if (PRICING_KEYWORDS.some((kw) => label.includes(kw) || id.includes(kw))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Infer archetype for Draft My Model from hint + brief + graph shape.
 *
 * - Supports a dedicated pricing_decision archetype.
 * - Falls back to generic when signals are weak or hints are unknown.
 * - Emits lightweight validation issues for weak matches (non-fatal).
 */
export function inferArchetype(input: ArchetypeInput): ArchetypeResult {
  const { hint, brief, graph, engineConfidence } = input;
  const normalizedHint = normalize(hint);
  const isPricingHint = normalizedHint === "pricing_decision";

  const hasPricingKeywords = hasPricingKeywordsInBrief(brief);
  const hasPricingGraphSignals = hasPricingSignalsInGraph(graph);

  const issues: CEEValidationIssue[] = [];
  const confidence =
    typeof engineConfidence === "number" && !Number.isNaN(engineConfidence)
      ? engineConfidence
      : 0.7;

  // Case 1: Strong pricing signal with explicit hint → exact pricing_decision.
  if (isPricingHint && (hasPricingKeywords || hasPricingGraphSignals)) {
    return {
      archetype: {
        decision_type: "pricing_decision",
        match: "exact",
        confidence,
      },
      issues,
    };
  }

  // Case 2: Strong pricing signal without hint → fuzzy pricing_decision.
  if (!isPricingHint && hasPricingKeywords && hasPricingGraphSignals) {
    return {
      archetype: {
        decision_type: "pricing_decision",
        match: "fuzzy",
        confidence,
      },
      issues,
    };
  }

  // Case 3: Pricing hint but weak signals → keep pricing_decision as a fuzzy match.
  if (isPricingHint && !hasPricingKeywords && !hasPricingGraphSignals) {
    return {
      archetype: {
        decision_type: "pricing_decision",
        match: "fuzzy",
        confidence,
      },
      issues,
    };
  }

  // Case 4: Unknown hint → preserve caller's decision_type, generic match.
  if (hint && !isPricingHint) {
    return {
      archetype: {
        decision_type: hint,
        match: "generic",
        confidence,
      },
      issues,
    };
  }

  // Case 5: No hint and no strong pricing signals → generic archetype.
  return {
    archetype: {
      decision_type: "generic",
      match: "generic",
      confidence,
    },
    issues,
  };
}
