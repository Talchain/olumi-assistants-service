/**
 * Enrich Factors Prompt v1
 *
 * Generates factor-level validation guidance grounded in ISL sensitivity analysis.
 * Key principle: Output observations and perspectives, not instructions.
 * Help users interrogate the model, don't tell them what to do.
 *
 * @module prompts/enrich-factors
 */

// =============================================================================
// Factor Type Guidance Mapping
// =============================================================================

/**
 * Type-appropriate framing and perspectives per factor type.
 * Used to generate contextual observations and validation perspectives.
 */
export const FACTOR_TYPE_GUIDANCE: Record<string, {
  /** Framing for observations about this factor type */
  framing: string;
  /** Validation perspectives appropriate for this type */
  perspectives: string[];
}> = {
  cost: {
    framing: "expense or resource expenditure",
    perspectives: [
      "Vendor quotes may reveal different pricing tiers",
      "Budget actuals from comparable projects could inform estimates",
      "Industry benchmarks suggest typical ranges for this type of cost",
      "Historical spend patterns may indicate seasonal variation",
    ],
  },
  price: {
    framing: "pricing level or fee structure",
    perspectives: [
      "Competitor pricing analysis may reveal market positioning",
      "Historical discounting patterns could inform likely outcomes",
      "Willingness-to-pay signals from customer research may validate assumptions",
      "Price elasticity studies suggest typical customer response patterns",
    ],
  },
  time: {
    framing: "duration or schedule constraint",
    perspectives: [
      "Historical cycle times from similar initiatives provide reference points",
      "Dependency analysis may reveal hidden schedule risks",
      "Best/typical/worst range thinking captures schedule uncertainty",
      "Team velocity metrics could inform timeline confidence",
    ],
  },
  probability: {
    framing: "likelihood or success rate",
    perspectives: [
      "Cohort baselines from historical data establish reference rates",
      "Reference class forecasting suggests typical ranges for similar situations",
      "Structured expert judgement protocols may reduce bias in estimates",
      "Base rate analysis could reveal systematic optimism or pessimism",
    ],
  },
  revenue: {
    framing: "income or earnings projection",
    perspectives: [
      "Pipeline metrics may validate or challenge top-line projections",
      "ARPA/ACV trends could inform revenue per customer assumptions",
      "Unit economics analysis reveals margin sensitivity",
      "Historical revenue patterns may indicate seasonality or growth rates",
    ],
  },
  demand: {
    framing: "volume or adoption level",
    perspectives: [
      "Market sizing analysis establishes addressable opportunity",
      "Pipeline or intent signals may validate demand assumptions",
      "Segment variation analysis could reveal concentration risk",
      "Early adopter feedback may indicate broader market appetite",
    ],
  },
  quality: {
    framing: "performance or satisfaction metric",
    perspectives: [
      "Defect or latency metrics establish current baseline",
      "Customer satisfaction proxies may correlate with quality improvements",
      "Operational capability assessment reveals improvement feasibility",
      "Benchmark comparisons could contextualise quality targets",
    ],
  },
  other: {
    framing: "contextual variable",
    perspectives: [
      "Stakeholder priors may reveal implicit assumptions worth examining",
      "Comparable cases from similar contexts could inform expectations",
      "Range thinking captures uncertainty when precise estimates are unavailable",
      "Scenario analysis may surface hidden dependencies",
    ],
  },
};

// =============================================================================
// Prompt Constants
// =============================================================================

/**
 * Maximum rank to include in enrichment output
 */
export const MAX_ENRICHMENT_RANK = 10;

/**
 * Maximum rank to include confidence_question
 */
export const CONFIDENCE_QUESTION_MAX_RANK = 3;

// =============================================================================
// Enrich Factors Prompt v1
// =============================================================================

export const ENRICH_FACTORS_PROMPT = `<ROLE>
You generate factor-level validation guidance for decision analysis.
Your output helps users interrogate their model assumptions.

KEY PRINCIPLE: Output observations and perspectives, NOT instructions.
Help users understand what to examine, not what to do.
</ROLE>

<INPUT_SCHEMA>
You receive:
1. goal_label: The goal being optimised
2. outcome_labels: Positive outcomes that contribute to the goal
3. risk_labels: Negative consequences that detract from the goal
4. controllable_factors: Factors with metadata:
   - factor_id: Unique identifier
   - label: Human-readable name
   - factor_type: One of cost, price, time, probability, revenue, demand, quality, other
   - uncertainty_drivers: 1-2 phrases explaining why the value is uncertain
5. factor_sensitivity: ISL analysis results:
   - factor_id: Factor identifier
   - elasticity: Relative influence magnitude (higher = more impact)
   - rank: Sensitivity rank (1 = most sensitive, ascending)
</INPUT_SCHEMA>

<BANNED_PHRASES>
NEVER use second-person directives:
- "You should..."
- "Do X..."
- "Run Y..."
- "Collect Z..."
- "Consider..."
- "Validate..."
- "Check..."
- "Ensure..."
- "Make sure..."

INSTEAD use observational framing:
- "A pilot could inform..."
- "One perspective is..."
- "Different evidence sources may imply..."
- "Historical data suggests..."
- "Market research may reveal..."
</BANNED_PHRASES>

<SENSITIVITY_LANGUAGE>
Use ISL elasticity explicitly in observations:
- "Top-ranked driver (elasticity 0.62) of [Goal Label]"
- "Second most influential factor (elasticity 0.45) affecting [Outcome Label]"

DO NOT claim "variance share" — ISL provides elasticity, not variance decomposition.

Reference goal/outcome labels specifically:
- GOOD: "...of Revenue Growth"
- BAD: "...of the outcome"
</SENSITIVITY_LANGUAGE>

<UNCERTAINTY_DRIVERS>
Leverage the factor's own uncertainty_drivers to frame relevant perspectives.
These explain WHY the value is uncertain — use them to suggest what evidence might help.

Do NOT repeat identical driver text across multiple factors.
Each factor's guidance should be specific to its context.
</UNCERTAINTY_DRIVERS>

<CONCISION_BY_RANK>
Adjust content depth based on sensitivity rank:

Rank 1-3 (most sensitive):
- 2 observations
- 2 perspectives
- May include confidence_question

Rank 4-7 (moderately sensitive):
- 2 observations
- 2 perspectives
- No confidence_question

Rank 8-10 (less sensitive):
- 1 observation
- 1 perspective
- No confidence_question

Rank > 10:
- Skip entirely (do not include in output)
</CONCISION_BY_RANK>

<FACTOR_TYPE_GUIDANCE>
Generate type-appropriate perspectives:

cost → vendor quotes, budget actuals, industry benchmarks
price → competitor pricing, discounting history, willingness-to-pay signals
time → historical cycle times, dependency analysis, best/typical/worst ranges
probability → cohort baselines, reference class, structured expert judgement
revenue → pipeline metrics, ARPA/ACV, unit economics
demand → market sizing, pipeline/intent signals, segment variation
quality → defect/latency metrics, satisfaction proxies, operational capability
other → stakeholder priors, comparable cases, range thinking
</FACTOR_TYPE_GUIDANCE>

<OUTPUT_SCHEMA>
Return JSON with enrichments array. Each enrichment:
{
  "factor_id": "fac_example",
  "sensitivity_rank": 1,
  "observations": [
    "Top-ranked driver (elasticity 0.62) of Revenue Growth",
    "This assumption is sensitive to competitor response uncertainty"
  ],
  "perspectives": [
    "Competitor pricing analysis may reveal market positioning",
    "Historical discounting patterns could inform likely outcomes"
  ],
  "confidence_question": "What evidence would change your estimate by more than 20%?"
}

RULES:
- observations: 1-2 strings, describe the factor's role and sensitivity
- perspectives: 1-2 strings, alternative ways to view/validate the factor
- confidence_question: Optional string, only for rank <= 3
- sensitivity_rank: Copy from input factor_sensitivity
- Exclude factors with rank > 10
</OUTPUT_SCHEMA>

<EXAMPLE_OUTPUT>
{
  "enrichments": [
    {
      "factor_id": "fac_price",
      "sensitivity_rank": 1,
      "observations": [
        "Top-ranked driver (elasticity 0.72) of Monthly Recurring Revenue",
        "Pricing assumptions may shift if competitor discounting intensifies"
      ],
      "perspectives": [
        "Customer willingness-to-pay research could validate price sensitivity",
        "Historical upgrade conversion rates may inform elasticity assumptions"
      ],
      "confidence_question": "What price point would make you reconsider the recommendation?"
    },
    {
      "factor_id": "fac_dev_time",
      "sensitivity_rank": 4,
      "observations": [
        "Fourth-ranked driver (elasticity 0.35) affecting Time to Market",
        "Schedule estimates assume stable team capacity"
      ],
      "perspectives": [
        "Past project timelines provide reference points for estimation",
        "Dependency mapping may surface hidden schedule risks"
      ]
    },
    {
      "factor_id": "fac_adoption",
      "sensitivity_rank": 8,
      "observations": [
        "Lower-ranked influence (elasticity 0.12) on Customer Acquisition"
      ],
      "perspectives": [
        "Early adopter feedback may indicate broader market appetite"
      ]
    }
  ]
}
</EXAMPLE_OUTPUT>

<VALIDATION_RULES>
Before outputting, verify:
1. No second-person directives in observations or perspectives
2. Elasticity values referenced match input factor_sensitivity
3. Goal/outcome labels referenced match input labels
4. confidence_question only appears for rank <= 3
5. Factors with rank > 10 are excluded
6. Each factor's content is specific (no generic duplicated text)
7. observations count: 2 for rank 1-7, 1 for rank 8-10
8. perspectives count: 2 for rank 1-7, 1 for rank 8-10
</VALIDATION_RULES>

Output ONLY valid JSON with the enrichments array.`;

/**
 * Get the enrich_factors prompt.
 */
export function getEnrichFactorsPrompt(): string {
  return ENRICH_FACTORS_PROMPT;
}
