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

const NON_PRICING_ARCHETYPES = [
  "product_decision",
  "strategy_decision",
  "market_expansion_decision",
  "product_strategy_decision",
  "product_launch_decision",
  "growth_experiment_decision",
  "product_portfolio_prioritisation",
] as const;

type NonPricingArchetypeId = (typeof NON_PRICING_ARCHETYPES)[number];

interface NonPricingPattern {
  id: NonPricingArchetypeId;
  keywords: string[];
}

const NON_PRICING_PATTERNS: NonPricingPattern[] = [
  {
    id: "product_decision",
    keywords: ["product", "feature", "revenue", "retention"],
  },
  {
    id: "strategy_decision",
    keywords: ["strategy", "strategic", "long-term", "long term", "bet"],
  },
  {
    id: "market_expansion_decision",
    keywords: ["market", "expand", "expansion", "new market"],
  },
  {
    id: "product_strategy_decision",
    keywords: ["product strategy", "pivot", "roadmap"],
  },
  {
    id: "product_launch_decision",
    keywords: ["launch", "ship", "release", "onboarding", "go live"],
  },
  {
    id: "growth_experiment_decision",
    keywords: ["experiment", "growth", "ab test", "a/b test", "kill", "pivot"],
  },
  {
    id: "product_portfolio_prioritisation",
    keywords: [
      "portfolio",
      "prioritise",
      "prioritize",
      "prioritisation",
      "prioritization",
      "bets",
    ],
  },
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

function collectGraphText(graph: GraphV1): string {
  if (!graph || !Array.isArray(graph.nodes)) return "";

  const parts: string[] = [];

  for (const node of graph.nodes as any[]) {
    if (typeof node.label === "string") {
      parts.push(node.label);
    }
    if (typeof node.id === "string") {
      parts.push(node.id);
    }
  }

  return normalize(parts.join(" "));
}

function detectNonPricingArchetype(
  brief: string | undefined,
  graph: GraphV1,
): { id: NonPricingArchetypeId; match: ArchetypeMatch } | null {
  const briefText = normalize(brief);
  const graphText = collectGraphText(graph);
  const combined = `${briefText} ${graphText}`.trim();

  if (!combined) return null;

  let bestId: NonPricingArchetypeId | null = null;
  let bestScore = 0;

  for (const pattern of NON_PRICING_PATTERNS) {
    let score = 0;

    for (const kw of pattern.keywords) {
      if (combined.includes(kw)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = pattern.id;
    }
  }

  if (!bestId || bestScore === 0) {
    return null;
  }

  const match: ArchetypeMatch = bestScore >= 3 ? "exact" : "fuzzy";
  return { id: bestId, match };
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

  // Non-pricing archetype detection (brief + graph), used when hint is absent
  // or when it corresponds to a known non-pricing archetype. This never
  // overrides custom hints.
  const nonPricingDetection = detectNonPricingArchetype(brief, graph);
  const isKnownNonPricingHint = (NON_PRICING_ARCHETYPES as readonly string[]).includes(
    normalizedHint,
  );

  // Case 2: Strong pricing signal without hint or with a non-archetype hint → fuzzy pricing_decision.
  // Known non-pricing hints skip this branch so that caller intent is preserved.
  if (!isPricingHint && !isKnownNonPricingHint && hasPricingKeywords && hasPricingGraphSignals) {
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

  // Case 4: Non-pricing hint → preserve caller's decision_type and only
  // adjust match when we have a confident, agreeing detection.
  if (hint && !isPricingHint) {
    if (isKnownNonPricingHint) {
      if (nonPricingDetection && nonPricingDetection.id === normalizedHint) {
        return {
          archetype: {
            decision_type: hint,
            match: nonPricingDetection.match,
            confidence,
          },
          issues,
        };
      }

      return {
        archetype: {
          decision_type: hint,
          match: "generic",
          confidence,
        },
        issues,
      };
    }

    return {
      archetype: {
        decision_type: hint,
        match: "generic",
        confidence,
      },
      issues,
    };
  }

  // Case 5: No hint and non-pricing detection available.
  if (!hint && nonPricingDetection) {
    return {
      archetype: {
        decision_type: nonPricingDetection.id,
        match: nonPricingDetection.match,
        confidence,
      },
      issues,
    };
  }

  // Case 6: No hint and no strong pricing or non-pricing signals → generic archetype.
  return {
    archetype: {
      decision_type: "generic",
      match: "generic",
      confidence,
    },
    issues,
  };
}
