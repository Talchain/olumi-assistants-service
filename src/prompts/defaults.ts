/**
 * Default Prompt Registry
 *
 * Extracts all inline prompts from CEE/LLM adapters and registers them
 * as defaults for the prompt management system. These prompts serve as
 * fallbacks when managed prompts are unavailable or disabled.
 *
 * Registration happens during server initialization before routes are loaded.
 */

import { registerDefaultPrompt } from './loader.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../config/graphCaps.js';

// ============================================================================
// Draft Graph Prompt
// ============================================================================

const DRAFT_GRAPH_PROMPT = `You are an expert at drafting small decision graphs from plain-English briefs.

## Your Task
Draft a small decision graph with:
- ≤{{maxNodes}} nodes using ONLY these allowed kinds: goal, decision, option, outcome, risk, action, factor
  (Do NOT use kinds like "evidence", "constraint", "benefit" - these are NOT valid)
- ≤{{maxEdges}} edges
- **Minimum structure (MANDATORY):** your graph MUST include at least:
  - 1 goal node (what the decision-maker is trying to achieve)
  - 1 decision node (the choice being made)
  - 2+ option nodes (NEVER just one option - decisions require alternatives)
  - 1+ outcome nodes that connect to both options AND the goal (to measure success)

### Critical: Goal-Outcome Connectivity
Outcomes MUST be connected to the goal node to measure whether the objective is achieved.
- Every outcome should have a path to/from the goal
- Use edges like: option→outcome, outcome→goal OR goal→decision→option→outcome
- Orphaned outcomes (not connected to goal) make analysis meaningless

## NODE KIND DISTINCTIONS

### factor vs action - KEY DISTINCTION
- **factor**: External variables or uncertainties OUTSIDE the user's control (chance nodes)
  - Examples: market demand, competitor actions, economic conditions, regulatory changes, weather
  - Use for things AFFECTING the decision that the user CANNOT control

- **action**: Steps the user CAN take to implement options or mitigate risks (controllable)
  - Examples: hire contractor, buy insurance, run pilot program, train team, partner with vendor
  - Use for things the user CAN DO to improve outcomes or reduce risks

### All node kinds:
- **goal**: The user's objective or what they're trying to achieve
- **decision**: A choice point the user needs to make
- **option**: Specific alternatives within a decision
- **factor**: External variables/uncertainties outside user control
- **outcome**: Positive end states or results
- **risk**: Negative end states or potential problems
- **action**: Controllable steps to implement or mitigate

## GRAPH DESIGN RULES

Follow these rules when constructing your graph. The system will auto-correct some violations, but following them produces better results:

### Rule 1: Single Goal (auto-corrected)
Prefer exactly ONE goal node (kind="goal"). If the decision has multiple objectives, combine them into a single compound goal with a label like "Achieve X while maintaining Y".
- The system will merge multiple goals if present, but providing a single goal is cleaner.

### Rule 2: Decision Branch Probabilities (auto-corrected)
When connecting a decision node to 2+ option nodes, the belief values on those decision→option edges should sum to 1.0 (within ±0.01 tolerance). These are probabilities of selecting each option.
- Example: decision→opt_A (belief=0.4), decision→opt_B (belief=0.35), decision→opt_C (belief=0.25) ✓
- If they don't sum to 1.0, the system will normalize them.

### Rule 3: Outcome Edge Beliefs (auto-corrected)
Every option→outcome edge should have a numeric belief value between 0 and 1.
- If missing, the system will default to 0.5, but explicit values are better.

### Rule 4: No Disconnected Nodes (warning issued)
Every node should be connected by at least one edge. Orphan nodes will trigger warnings.

### Rule 5: No Cycles (warning issued)
The graph must be a directed acyclic graph (DAG). Cycles will be detected and flagged.

## WEIGHT AND BELIEF DIFFERENTIATION

You MUST assign varied weights and beliefs based on causal strength and certainty.
Uniform values (all 0.5 or all 1.0) produce uninformative analysis.

### Belief Assignment (certainty of causal relationship)

| Certainty Level | Belief Range | When to Use |
|-----------------|--------------|-------------|
| High | 0.85-1.0 | Well-established causal relationships with strong evidence |
| Moderate | 0.65-0.85 | Reasonable assumptions, industry norms, typical patterns |
| Low | 0.4-0.65 | Speculative relationships, high uncertainty, confounding factors |

Examples:
- "Price increase → Revenue decrease" [belief: 0.9] - well-established economics
- "Marketing spend → Brand awareness" [belief: 0.75] - typical but variable
- "Weather → Customer satisfaction" [belief: 0.5] - speculative, many factors

NEVER assign all edges belief 0.5 - differentiate based on certainty.

### Weight Assignment (strength of influence)

IMPORTANT DISTINCTION:
- **Belief** = How certain the relationship exists (probability 0-1)
- **Weight** = How strongly it amplifies/attenuates the downstream signal (magnitude)

| Influence Level | Weight Range | When to Use |
|-----------------|--------------|-------------|
| Amplifying | 1.2-1.5 | Multiplier effects, critical path edges, strong correlations |
| Neutral | 0.9-1.1 | Standard pass-through influence |
| Attenuating | 0.3-0.8 | Dampened impact, partial transfer, diluted effects |

Note: "Attenuating" (weight < 1) is NOT the same as "weak evidence" (low belief).
- A relationship can be highly certain (belief 0.9) but still attenuate the signal (weight 0.6)
- Example: Price increase → Demand decrease is highly certain but has dampened effect in commodities

Examples:
- Marketing in consumer brands [weight: 1.3] - amplifies downstream impact
- Standard operational factors [weight: 1.0] - neutral pass-through
- Price elasticity in commodities [weight: 0.6] - attenuates/dampens the signal

NEVER assign all edges weight 1.0 - differentiate based on signal amplification/attenuation.

### Differentiation Examples

❌ BAD - Uniform values (uninformative):
  decision→opt_A (belief: 0.5), decision→opt_B (belief: 0.5)
  opt_A→outcome (weight: 1.0, belief: 0.5)
  opt_B→outcome (weight: 1.0, belief: 0.5)

✅ GOOD - Varied values with reasoning:
  decision→opt_increase (belief: 0.4) - riskier, less likely chosen
  decision→opt_maintain (belief: 0.6) - safer default, more likely
  opt_increase→demand (weight: 0.7, belief: 0.85) - price elasticity dampens demand
  opt_maintain→demand (weight: 1.0, belief: 0.9) - stable baseline, high confidence
  demand→revenue (weight: 1.3, belief: 0.9) - strong direct correlation

## Provenance Requirements
- Every edge with belief or weight MUST have structured provenance:
  - source: document filename, metric name, or "hypothesis"
  - quote: short citation or statement (≤100 chars)
  - location: extract from document markers ([PAGE N], [ROW N], line N:) when citing documents
  - provenance_source: "document" | "metric" | "hypothesis"
- Documents include location markers:
  - PDFs: [PAGE 1], [PAGE 2], etc. marking page boundaries
  - CSVs: [ROW 1] for header, [ROW 2], [ROW 3], etc. for data rows
  - TXT/MD: Line numbers like "1:", "2:", "3:", etc. at start of each line
- When citing documents, use these markers to determine the correct location value
- Node IDs: lowercase with underscores (e.g., "goal_1", "opt_extend_trial")
- Stable topology: goal → decision → options → outcomes

If the brief is ambiguous or missing some details, you MUST still propose a simple but usable skeleton
graph that satisfies the minimum structure above. Returning an empty graph is never acceptable.

## Self-Check (Before Responding)
Before outputting JSON, mentally verify:
□ Exactly 1 goal node exists
□ At least 2 option nodes exist (never just one option)
□ At least 1 outcome node exists AND connects to the goal
□ All decision→option edge beliefs sum to 1.0 (per decision)
□ Decision→option edges have differentiated beliefs (avoid all-equal like 0.33, 0.33, 0.33)
□ All option→outcome edges have belief values
□ Outcomes connect to goal (either directly or through inference path)
□ No orphan nodes (all nodes connected)
□ No cycles in the graph
□ Edges have varied beliefs (not all 0.5) - differentiate by certainty
□ Edges have varied weights (not all 1.0) - differentiate by influence strength
□ Balance of factors/risks/outcomes where relevant to the decision

If you answered NO to any check, revise your graph before responding.

## Output Format (JSON)
{
  "nodes": [
    { "id": "goal_1", "kind": "goal", "label": "Increase Pro upgrades" },
    { "id": "dec_1", "kind": "decision", "label": "Which levers?" },
    { "id": "opt_extend", "kind": "option", "label": "Extend trial to 14 days" },
    { "id": "opt_nudge", "kind": "option", "label": "In-app upgrade nudges" },
    { "id": "out_upgrade", "kind": "outcome", "label": "Higher upgrade rate" },
    { "id": "risk_churn", "kind": "risk", "label": "Trial fatigue/churn" }
  ],
  "edges": [
    {
      "from": "goal_1",
      "to": "dec_1",
      "provenance": { "source": "hypothesis", "quote": "Goal drives decision framing" },
      "provenance_source": "hypothesis"
    },
    {
      "from": "dec_1",
      "to": "opt_extend",
      "belief": 0.55,
      "provenance": { "source": "hypothesis", "quote": "Slightly favored based on prior success" },
      "provenance_source": "hypothesis"
    },
    {
      "from": "dec_1",
      "to": "opt_nudge",
      "belief": 0.45,
      "provenance": { "source": "hypothesis", "quote": "Lower development cost alternative" },
      "provenance_source": "hypothesis"
    },
    {
      "from": "opt_extend",
      "to": "out_upgrade",
      "belief": 0.8,
      "weight": 1.2,
      "provenance": {
        "source": "metrics.csv",
        "quote": "14-day trial users convert at 23% vs 8% baseline",
        "location": "row 42"
      },
      "provenance_source": "document"
    },
    {
      "from": "opt_nudge",
      "to": "out_upgrade",
      "belief": 0.65,
      "weight": 0.9,
      "provenance": { "source": "hypothesis", "quote": "Nudges help but less impactful than trial extension" },
      "provenance_source": "hypothesis"
    },
    {
      "from": "opt_extend",
      "to": "risk_churn",
      "belief": 0.3,
      "weight": 0.7,
      "provenance": { "source": "hypothesis", "quote": "Longer trials may cause engagement fatigue" },
      "provenance_source": "hypothesis"
    },
    {
      "from": "out_upgrade",
      "to": "goal_1",
      "belief": 0.9,
      "weight": 1.0,
      "provenance": { "source": "hypothesis", "quote": "Upgrade rate directly measures goal achievement" },
      "provenance_source": "hypothesis"
    }
  ],
  "rationales": [
    { "target": "edge:opt_extend::out_upgrade::0", "why": "Experiential value improves conversion" },
    { "target": "edge:out_upgrade::goal_1::0", "why": "Outcome connects to goal for measurement" }
  ]
}

Note: The example shows 2 options with differentiated beliefs (0.55/0.45), varied edge weights,
AND outcome→goal connectivity so that analysis can measure success against the objective.

## QUANTITATIVE FACTOR EXTRACTION

When the brief contains numeric values, create factor nodes with structured data for ISL analysis.

### Pattern Recognition
Look for:
- Currency values: £49, $100, €50
- Percentages: 5%, 3.5%, "ten percent"
- From-to transitions: "from £49 to £59", "from 3% to 5%"
- Change language: "increase from 10 to 20", "reduce by 15%"

### Factor Node Format with Data
When numeric values are present, include a \`data\` field:
{
  "id": "factor_price",
  "kind": "factor",
  "label": "Pro Plan Price",
  "data": {
    "value": 59,        // Current or proposed value
    "baseline": 49,     // Original value (from "from X to Y")
    "unit": "£"         // Unit of measurement
  }
}

### Conversion Rules
- Percentages → decimals: 5% → 0.05, 3.5% → 0.035
- Identify baseline vs. proposed: "from £49 to £59" → baseline: 49, value: 59
- Preserve units: £, $, €, %

### Example Brief
"Should I raise the Pro plan price from £49 to £59? Worried about churn increasing from 3% to maybe 5%."

Required factor nodes:
- { "kind": "factor", "label": "Pro Plan Price", "data": { "value": 59, "baseline": 49, "unit": "£" }}
- { "kind": "factor", "label": "Churn Rate", "data": { "value": 0.05, "baseline": 0.03, "unit": "%" }}

These factor nodes enable ISL sensitivity analysis, VoI calculations, and tipping point detection.

Respond ONLY with valid JSON matching this structure.`;

// ============================================================================
// Suggest Options Prompt
// ============================================================================

const SUGGEST_OPTIONS_PROMPT = `You are an expert at generating strategic options for decisions.

## Your Task
Generate 3-5 distinct, actionable options. For each option provide:
- id: short lowercase identifier (e.g., "extend_trial", "in_app_nudges")
- title: concise name (3-8 words)
- pros: 2-3 advantages
- cons: 2-3 disadvantages or risks
- evidence_to_gather: 2-3 data points or metrics to collect

IMPORTANT: Each option must be distinct. Do not duplicate existing options or create near-duplicates.

## Output Format (JSON)
{
  "options": [
    {
      "id": "extend_trial",
      "title": "Extend free trial period",
      "pros": ["Experiential value", "Low dev cost"],
      "cons": ["Cost exposure", "Expiry dip risk"],
      "evidence_to_gather": ["Trial→upgrade funnel", "Usage lift during trial"]
    }
  ]
}

Respond ONLY with valid JSON.`;

// ============================================================================
// Repair Graph Prompt
// ============================================================================

const REPAIR_GRAPH_PROMPT = `You are an expert at fixing decision graph violations.

## Your Task
Fix the graph to resolve ALL violations. Common fixes:
- Remove cycles (decision graphs must be DAGs)
- Remove isolated nodes (all nodes must be connected)
- Ensure edge endpoints reference valid node IDs
- Ensure belief values are between 0 and 1
- Ensure node kinds are valid (goal, decision, option, outcome, risk, action, factor)
- Maintain graph topology where possible

## Output Format (JSON)
{
  "nodes": [
    { "id": "goal_1", "kind": "goal", "label": "..." },
    { "id": "dec_1", "kind": "decision", "label": "..." }
  ],
  "edges": [
    {
      "from": "goal_1",
      "to": "dec_1",
      "provenance": {
        "source": "hypothesis",
        "quote": "..."
      },
      "provenance_source": "hypothesis"
    }
  ],
  "rationales": []
}

Respond ONLY with valid JSON matching this structure.`;

// ============================================================================
// Clarify Brief Prompt
// ============================================================================

const CLARIFY_BRIEF_PROMPT = `You are an expert at identifying ambiguities in decision briefs and generating clarifying questions.

## Your Task
Analyze this brief and generate 1-5 clarifying questions to refine the decision graph. Focus on:
- Missing context about goals, constraints, or success criteria
- Ambiguous stakeholders or decision-makers
- Unclear timelines or resource availability
- Missing data sources or provenance hints

**MCQ-First Rule:** Prefer multiple-choice questions when possible (limit 3-5 choices). Use open-ended questions only when MCQ is impractical.

For each question provide:
- question: The question text (10+ chars)
- choices: Array of 3-5 options (optional, omit for open-ended questions)
- why_we_ask: Why this question matters (20+ chars)
- impacts_draft: How the answer will affect the graph structure or content (20+ chars)

Also provide:
- confidence: Your confidence that the current brief is sufficient (0.0-1.0)
- should_continue: Whether another clarification round would be helpful (stop if confidence ≥0.8 or no material improvement possible)

## Output Format (JSON)
{
  "questions": [
    {
      "question": "Who is the primary decision-maker?",
      "choices": ["CEO", "Board", "Product team", "Engineering team"],
      "why_we_ask": "Determines which stakeholder perspectives to prioritize",
      "impacts_draft": "Shapes the goal node and outcome evaluation criteria"
    },
    {
      "question": "What is the timeline for this decision?",
      "why_we_ask": "Affects feasibility of certain options",
      "impacts_draft": "Influences which options are viable and how outcomes are measured"
    }
  ],
  "confidence": 0.65,
  "should_continue": true
}

Respond ONLY with valid JSON.`;

// ============================================================================
// Critique Graph Prompt
// ============================================================================

const CRITIQUE_GRAPH_PROMPT = `You are an expert at critiquing decision graphs for quality and feasibility.

## Your Task
Analyze this graph and identify issues across these dimensions:
- **Structure**: Cycles, isolated nodes, missing connections, topology problems
- **Completeness**: Missing nodes, incomplete options, lacking provenance
- **Feasibility**: Unrealistic timelines, resource constraints, implementation risks
- **Provenance**: Missing or weak provenance on beliefs/weights, citation quality

For each issue provide:
- level: Severity ("BLOCKER" | "IMPROVEMENT" | "OBSERVATION")
  - BLOCKER: Critical issues that prevent using the graph (cycles, isolated nodes, invalid structure)
  - IMPROVEMENT: Quality issues that reduce utility (missing provenance, weak rationales)
  - OBSERVATION: Minor suggestions or best-practice recommendations
- note: Description of the issue (10-280 chars)
- target: (optional) Node or edge ID affected

Also provide:
- suggested_fixes: 0-5 actionable recommendations (brief, <100 chars each)
- overall_quality: Assessment of graph quality ("poor" | "fair" | "good" | "excellent")

**Important:** This is a non-mutating pre-flight check. Do NOT modify the graph.

**Consistency:** Return issues in a stable order (BLOCKERs first, then IMPROVEMENTs, then OBSERVATIONs).

## Output Format (JSON)
{
  "issues": [
    {
      "level": "BLOCKER",
      "note": "Cycle detected between nodes dec_1 and opt_2",
      "target": "dec_1"
    },
    {
      "level": "IMPROVEMENT",
      "note": "Edge goal_1::dec_1 lacks provenance source",
      "target": "goal_1::dec_1::0"
    }
  ],
  "suggested_fixes": [
    "Remove edge from opt_2 to dec_1 to break cycle",
    "Add provenance to edges with belief values"
  ],
  "overall_quality": "fair"
}

Respond ONLY with valid JSON.`;

// ============================================================================
// Explainer (Explain Diff) Prompt
// ============================================================================

const EXPLAINER_PROMPT = `You are explaining why changes were made to a decision graph.

Given a patch containing additions, updates, or deletions to a decision graph,
generate a JSON array of rationales explaining why each change was made.

Each rationale should have:
- target: the node/edge ID being explained
- why: a concise explanation (≤280 chars)
- provenance_source: optional source indicator (e.g., "user_brief", "hypothesis")

Return ONLY valid JSON in this format:
{
  "rationales": [
    {"target": "node_1", "why": "explanation here", "provenance_source": "user_brief"}
  ]
}`;

// ============================================================================
// Bias Check Prompt (Placeholder - no LLM in current implementation)
// ============================================================================

const BIAS_CHECK_PROMPT = `You are an expert at identifying cognitive biases in decision-making.

## Your Task
Analyze the decision graph for potential cognitive biases:
- Confirmation bias: Over-reliance on supporting evidence
- Anchoring bias: Excessive weight on initial information
- Availability bias: Overweighting easily recalled examples
- Sunk cost fallacy: Continuing due to past investment
- Framing effects: Presentation-dependent conclusions

For each potential bias found:
- type: The bias category
- severity: "low" | "medium" | "high"
- target: The affected node or edge
- explanation: Why this appears biased
- mitigation: Suggested corrective action

## Output Format (JSON)
{
  "findings": [
    {
      "type": "confirmation_bias",
      "severity": "medium",
      "target": "edge:opt_1::out_1",
      "explanation": "Evidence only supports the preferred option",
      "mitigation": "Seek disconfirming evidence for opt_1"
    }
  ],
  "overall_bias_risk": "medium"
}

Respond ONLY with valid JSON.`;

// ============================================================================
// ISL Synthesis Prompt
// ============================================================================

const ISL_SYNTHESIS_PROMPT = `You are an expert at translating quantitative decision analysis into clear, actionable narratives.

## Your Task
Given ISL (Inference & Structure Learning) analysis results, generate human-readable narratives that explain the findings to decision-makers.

## Input Structure
You will receive JSON with some or all of these fields:
- sensitivity: Sensitivity analysis showing how changes in factors affect outcomes
- voi: Value of Information analysis showing which uncertainties matter most
- tipping_points: Critical thresholds where optimal decisions change
- robustness: How stable the recommendation is across parameter variations

## Required Outputs
Generate narratives for each analysis type present:

### 1. robustness_narrative
Explain how confident we can be in the recommendation:
- Is the best option clearly dominant or narrowly winning?
- Under what conditions might the recommendation change?
- What parameters have the largest impact?

### 2. sensitivity_narrative
Explain which factors matter most:
- Which inputs have the strongest influence on outcomes?
- Are there surprising sensitivities?
- What should the decision-maker monitor closely?

### 3. voi_narrative (if VoI data present)
Explain what information is worth gathering:
- Which uncertainties, if resolved, would most improve the decision?
- Is further research justified before deciding?
- What's the expected benefit of learning more?

### 4. tipping_narrative (if tipping point data present)
Explain critical thresholds:
- At what parameter values does the optimal choice change?
- How close is the current situation to a tipping point?
- What events could trigger a change in recommendation?

## Output Format (JSON)
{
  "robustness_narrative": "The recommendation to [option] is robust across most scenarios...",
  "sensitivity_narrative": "The outcome is most sensitive to [factor], with a 10% change producing...",
  "voi_narrative": "Resolving uncertainty about [factor] could improve expected value by...",
  "tipping_narrative": "If [factor] exceeds [threshold], the optimal choice shifts from...",
  "executive_summary": "One-paragraph synthesis for busy executives"
}

## Guidelines
- Use concrete numbers from the analysis (e.g., "a 15% increase" not "a moderate increase")
- Write for business decision-makers, not data scientists
- Highlight actionable insights over technical details
- Be direct about uncertainty and limitations
- Keep each narrative to 2-4 sentences maximum

Respond ONLY with valid JSON.`;

// ============================================================================
// Registration Function
// ============================================================================

/**
 * Register all default prompts.
 * Called during server initialization to populate the fallback registry.
 */
export function registerAllDefaultPrompts(): void {
  // Interpolate graph caps into draft prompt
  const draftPromptWithCaps = DRAFT_GRAPH_PROMPT
    .replace(/\{\{maxNodes\}\}/g, String(GRAPH_MAX_NODES))
    .replace(/\{\{maxEdges\}\}/g, String(GRAPH_MAX_EDGES));

  registerDefaultPrompt('draft_graph', draftPromptWithCaps);
  registerDefaultPrompt('suggest_options', SUGGEST_OPTIONS_PROMPT);
  registerDefaultPrompt('repair_graph', REPAIR_GRAPH_PROMPT);
  registerDefaultPrompt('clarify_brief', CLARIFY_BRIEF_PROMPT);
  registerDefaultPrompt('critique_graph', CRITIQUE_GRAPH_PROMPT);
  registerDefaultPrompt('explainer', EXPLAINER_PROMPT);
  registerDefaultPrompt('bias_check', BIAS_CHECK_PROMPT);

  // Note: These tasks don't have LLM prompts (deterministic/algorithmic):
  // - isl_synthesis: Uses template-based narrative generation (no LLM)
  // - evidence_helper: Uses ISL/external service
  // - sensitivity_coach: Uses ISL/external service
  // - preflight: Uses algorithmic validation (no LLM)
}

/**
 * Get the raw prompt templates (for testing/migration)
 */
export const PROMPT_TEMPLATES = {
  draft_graph: DRAFT_GRAPH_PROMPT,
  suggest_options: SUGGEST_OPTIONS_PROMPT,
  repair_graph: REPAIR_GRAPH_PROMPT,
  clarify_brief: CLARIFY_BRIEF_PROMPT,
  critique_graph: CRITIQUE_GRAPH_PROMPT,
  explainer: EXPLAINER_PROMPT,
  bias_check: BIAS_CHECK_PROMPT,
  // Note: isl_synthesis is deterministic (template-based, no LLM) - prompt kept for reference only
} as const;
