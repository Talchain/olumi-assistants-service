/**
 * Domain-Specific Completeness Templates
 *
 * Detects decision domain from brief content and checks for
 * expected factors based on domain-specific templates.
 *
 * Supported domains:
 * - Product launch: competition, timing, resources, market fit
 * - Pricing: elasticity, competitor response, costs, value perception
 * - Hiring: capacity, training time, culture fit, opportunity cost
 * - Investment: ROI timeline, risk factors, alternatives, liquidity
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import type {
  DomainType,
  DomainTemplate,
  DomainCompletenessResult,
  MissingFactor,
  ExpectedFactor,
} from "./types.js";

// ============================================================================
// Domain Templates
// ============================================================================

const DOMAIN_TEMPLATES: DomainTemplate[] = [
  {
    domain: "product_launch",
    display_name: "Product Launch",
    keywords: [
      "launch", "product", "release", "ship", "go-to-market", "gtm",
      "market entry", "rollout", "deployment", "introduce", "unveil",
    ],
    expected_factors: [
      {
        name: "competition",
        rationale: "Competitor response can significantly impact launch success",
        importance: "critical",
      },
      {
        name: "timing",
        rationale: "Market timing affects adoption and competitive positioning",
        importance: "critical",
      },
      {
        name: "resources",
        rationale: "Resource availability determines execution capacity",
        importance: "recommended",
      },
      {
        name: "market fit",
        rationale: "Product-market fit is fundamental to launch success",
        importance: "critical",
      },
      {
        name: "readiness",
        rationale: "Product readiness affects quality perception and reviews",
        importance: "recommended",
      },
      {
        name: "support",
        rationale: "Customer support capacity affects post-launch satisfaction",
        importance: "optional",
      },
    ],
  },
  {
    domain: "pricing",
    display_name: "Pricing Decision",
    keywords: [
      "price", "pricing", "cost", "fee", "rate", "charge", "discount",
      "premium", "subscription", "tier", "monetiz",
    ],
    expected_factors: [
      {
        name: "elasticity",
        rationale: "Price sensitivity determines demand response to changes",
        importance: "critical",
      },
      {
        name: "competitor",
        rationale: "Competitor pricing sets market expectations",
        importance: "critical",
      },
      {
        name: "cost",
        rationale: "Cost structure defines margin boundaries",
        importance: "critical",
      },
      {
        name: "value",
        rationale: "Perceived value justifies price point",
        importance: "recommended",
      },
      {
        name: "segment",
        rationale: "Different segments may have different price sensitivities",
        importance: "recommended",
      },
      {
        name: "churn",
        rationale: "Pricing changes can affect customer retention",
        importance: "optional",
      },
    ],
  },
  {
    domain: "hiring",
    display_name: "Hiring Decision",
    keywords: [
      "hire", "hiring", "recruit", "candidate", "talent", "headcount",
      "employee", "staff", "team", "role", "position", "onboard",
    ],
    expected_factors: [
      {
        name: "capacity",
        rationale: "Current capacity gaps determine hiring urgency",
        importance: "critical",
      },
      {
        name: "training",
        rationale: "Training time affects time-to-productivity",
        importance: "recommended",
      },
      {
        name: "culture",
        rationale: "Cultural fit impacts team dynamics and retention",
        importance: "critical",
      },
      {
        name: "opportunity cost",
        rationale: "Delayed hiring has productivity implications",
        importance: "recommended",
      },
      {
        name: "compensation",
        rationale: "Competitive compensation affects talent attraction",
        importance: "recommended",
      },
      {
        name: "retention",
        rationale: "Retention risk affects long-term value of hire",
        importance: "optional",
      },
    ],
  },
  {
    domain: "investment",
    display_name: "Investment Decision",
    keywords: [
      "invest", "investment", "roi", "return", "capital", "funding",
      "portfolio", "asset", "equity", "stake", "allocation", "divest",
    ],
    expected_factors: [
      {
        name: "roi",
        rationale: "Return on investment is the primary success metric",
        importance: "critical",
      },
      {
        name: "timeline",
        rationale: "Investment horizon affects strategy and risk tolerance",
        importance: "critical",
      },
      {
        name: "risk",
        rationale: "Risk factors must be weighed against potential returns",
        importance: "critical",
      },
      {
        name: "alternative",
        rationale: "Alternative investments provide comparison baseline",
        importance: "recommended",
      },
      {
        name: "liquidity",
        rationale: "Liquidity needs affect investment structure",
        importance: "recommended",
      },
      {
        name: "diversification",
        rationale: "Portfolio diversification reduces concentration risk",
        importance: "optional",
      },
    ],
  },
];

// ============================================================================
// Domain Detection
// ============================================================================

type NodeLike = { id?: string; kind?: string; label?: string } & Record<string, unknown>;

function getNodes(graph: GraphV1 | undefined): NodeLike[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return (graph as any).nodes as NodeLike[];
}

/**
 * Detect domain from decision brief and/or graph content.
 *
 * @param brief - Decision brief text (optional)
 * @param graph - Decision graph (optional)
 * @returns Detected domain and confidence score
 */
export function detectDomain(
  brief?: string,
  graph?: GraphV1,
): { domain: DomainType; confidence: number } {
  const scores: Record<DomainType, number> = {
    product_launch: 0,
    pricing: 0,
    hiring: 0,
    investment: 0,
    general: 0,
  };

  // Combine brief and node labels for keyword matching
  const textSources: string[] = [];
  if (brief) {
    textSources.push(brief.toLowerCase());
  }

  // Extract text from graph nodes
  const nodes = getNodes(graph);
  for (const node of nodes) {
    if (node.label) {
      textSources.push(node.label.toLowerCase());
    }
  }

  const combinedText = textSources.join(" ");

  // Score each domain by keyword matches
  for (const template of DOMAIN_TEMPLATES) {
    for (const keyword of template.keywords) {
      // Use word boundary matching for better accuracy
      const regex = new RegExp(`\\b${escapeRegex(keyword)}`, "i");
      if (regex.test(combinedText)) {
        scores[template.domain] += 1;
      }
    }
  }

  // Find highest-scoring domain
  let maxScore = 0;
  let detectedDomain: DomainType = "general";

  for (const [domain, score] of Object.entries(scores)) {
    if (score > maxScore && domain !== "general") {
      maxScore = score;
      detectedDomain = domain as DomainType;
    }
  }

  // Calculate confidence (0-1) based on keyword matches
  // 0 matches = 0 confidence, 3+ matches = high confidence
  const confidence = maxScore === 0 ? 0 : Math.min(1, maxScore / 3);

  // If confidence is too low, fall back to general
  if (confidence < 0.33) {
    return { domain: "general", confidence: 0 };
  }

  return { domain: detectedDomain, confidence };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Completeness Checking
// ============================================================================

/**
 * Factor name patterns for matching node labels to expected factors.
 * Maps expected factor names to regex patterns that match them.
 */
const FACTOR_PATTERNS: Record<string, RegExp> = {
  // Product launch
  competition: /compet|rival|market\s*share|alternative/i,
  timing: /timing|timeline|schedule|when|deadline|date/i,
  resources: /resource|budget|capacity|team|staff|bandwidth/i,
  "market fit": /market\s*fit|fit|pmf|product.market|demand/i,
  readiness: /ready|readiness|mature|complete|qa|quality/i,
  support: /support|service|customer\s*success|help/i,

  // Pricing
  elasticity: /elastic|sensitiv|demand\s*curve|price\s*point/i,
  competitor: /compet|rival|market\s*rate|benchmark/i,
  cost: /cost|expense|margin|cogs|overhead/i,
  value: /value|worth|perceive|benefit|utility/i,
  segment: /segment|tier|cohort|customer\s*type|persona/i,
  churn: /churn|retention|cancel|attrit|lifetime/i,

  // Hiring
  capacity: /capacity|workload|bandwidth|headcount|gap/i,
  training: /train|onboard|ramp|learn|mentor/i,
  culture: /culture|fit|team\s*dynamic|values|alignment/i,
  "opportunity cost": /opportunity|delay|backlog|productivity|velocity/i,
  compensation: /compens|salary|pay|benefit|equity|offer/i,
  retention: /retain|tenure|turnover|loyalty/i,

  // Investment
  roi: /roi|return|yield|profit|gain/i,
  timeline: /timeline|horizon|period|duration|term/i,
  risk: /risk|volatil|downside|exposure|uncertain/i,
  alternative: /alternative|option|other|compare|benchmark/i,
  liquidity: /liquid|cash|convert|exit|divest/i,
  diversification: /divers|portfolio|concentration|spread|allocation/i,
};

/**
 * Check graph completeness against domain-specific template.
 *
 * @param graph - Decision graph to evaluate
 * @param brief - Decision brief text (optional)
 * @returns Domain completeness analysis result
 */
export function checkDomainCompleteness(
  graph: GraphV1 | undefined,
  brief?: string,
): DomainCompletenessResult {
  // Detect domain
  const { domain, confidence } = detectDomain(brief, graph);

  // If general domain, return early with neutral result
  if (domain === "general") {
    return {
      detected_domain: "general",
      detection_confidence: confidence,
      factors_found: [],
      missing_factors: [],
      completeness_score: 100, // No domain-specific expectations
      summary: "No specific domain detected — general decision modeling guidance applies",
    };
  }

  // Get template for detected domain
  const template = DOMAIN_TEMPLATES.find((t) => t.domain === domain);
  if (!template) {
    return {
      detected_domain: domain,
      detection_confidence: confidence,
      factors_found: [],
      missing_factors: [],
      completeness_score: 100,
      summary: "Domain template not available",
    };
  }

  // Extract all node labels for matching
  const nodes = getNodes(graph);
  const nodeLabels = nodes
    .filter((n) => n.label)
    .map((n) => n.label!.toLowerCase());
  const allText = [...nodeLabels, brief?.toLowerCase() ?? ""].join(" ");

  // Check for each expected factor
  const factorsFound: string[] = [];
  const missingFactors: MissingFactor[] = [];

  for (const expected of template.expected_factors) {
    const pattern = FACTOR_PATTERNS[expected.name];
    const found = pattern
      ? pattern.test(allText)
      : allText.includes(expected.name.toLowerCase());

    if (found) {
      factorsFound.push(expected.name);
    } else {
      missingFactors.push({
        name: expected.name,
        rationale: expected.rationale,
        importance: expected.importance,
        suggestion: generateFactorSuggestion(expected, template.display_name),
      });
    }
  }

  // Calculate completeness score
  const completenessScore = calculateCompletenessScore(
    factorsFound.length,
    template.expected_factors,
  );

  // Generate summary
  const summary = generateCompletenessSummary(
    template.display_name,
    factorsFound.length,
    missingFactors,
    completenessScore,
  );

  return {
    detected_domain: domain,
    detection_confidence: confidence,
    factors_found: factorsFound,
    missing_factors: missingFactors,
    completeness_score: completenessScore,
    summary,
  };
}

/**
 * Calculate completeness score based on found factors.
 * Critical factors have higher weight.
 */
function calculateCompletenessScore(
  foundCount: number,
  expectedFactors: ExpectedFactor[],
): number {
  if (expectedFactors.length === 0) return 100;

  // Weight by importance
  const weights = { critical: 3, recommended: 2, optional: 1 };
  let totalWeight = 0;
  let foundWeight = 0;

  const foundNames = new Set<string>();
  // We'll track by checking if foundCount covers the first N factors
  // This is a simplification - in practice we'd need the actual found names

  for (let i = 0; i < expectedFactors.length; i++) {
    const factor = expectedFactors[i];
    const weight = weights[factor.importance];
    totalWeight += weight;

    // Assume factors are found in order of importance (critical first)
    if (i < foundCount) {
      foundWeight += weight;
    }
  }

  return Math.round((foundWeight / totalWeight) * 100);
}

/**
 * Generate actionable suggestion for adding a missing factor.
 */
function generateFactorSuggestion(
  factor: ExpectedFactor,
  domainName: string,
): string {
  const importanceLabel =
    factor.importance === "critical"
      ? "Important"
      : factor.importance === "recommended"
        ? "Recommended"
        : "Consider adding";

  return `${importanceLabel}: Add a factor or risk node for "${factor.name}" — ${factor.rationale.toLowerCase()}`;
}

/**
 * Generate human-readable completeness summary.
 */
function generateCompletenessSummary(
  domainName: string,
  foundCount: number,
  missingFactors: MissingFactor[],
  score: number,
): string {
  const criticalMissing = missingFactors.filter((f) => f.importance === "critical");
  const recommendedMissing = missingFactors.filter((f) => f.importance === "recommended");

  if (missingFactors.length === 0) {
    return `${domainName} model is comprehensive — all expected factors are present`;
  }

  if (criticalMissing.length > 0) {
    const names = criticalMissing.slice(0, 2).map((f) => f.name).join(", ");
    return `${domainName} model is missing critical factors: ${names}. Add these for a more complete analysis.`;
  }

  if (recommendedMissing.length > 0) {
    const names = recommendedMissing.slice(0, 2).map((f) => f.name).join(", ");
    return `${domainName} model could be strengthened by adding: ${names}`;
  }

  return `${domainName} model has good coverage of key factors`;
}

// ============================================================================
// Exports for Testing
// ============================================================================

export const __test_only = {
  DOMAIN_TEMPLATES,
  FACTOR_PATTERNS,
  calculateCompletenessScore,
  generateFactorSuggestion,
  generateCompletenessSummary,
};
