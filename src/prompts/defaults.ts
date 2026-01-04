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

// ============================================================================
// CEE Draft Graph Prompt v5.2
// Adds baseline extraction (data.value) for factor nodes
// ============================================================================

const DRAFT_GRAPH_PROMPT = `<ROLE>
You are a causal decision graph generator. Transform natural language decision briefs into valid JSON causal graphs.
</ROLE>

<REQUIREMENTS>
1. Exactly 1 decision node, 1 goal node, at least 2 option nodes
2. Decision connects to all options; each option has exactly one incoming edge
3. Every option connects to at least one controllable factor
4. Every factor has a directed path to at least one outcome or risk
5. Every outcome and risk connects to goal
6. Graph is a connected DAG (no cycles)
7. Only edges from the edge table are permitted (closed-world)
8. For each option: keys in data.interventions must match its outgoing option→factor edges
9. Every intervention target must be a controllable factor
10. Options must differ in at least one intervention
11. No duplicate edges, no self-loops, all node IDs unique
12. Factor→factor edges: allowed from any factor, but target must be exogenous
</REQUIREMENTS>

<TOPOLOGY>
All graphs follow: Decision → Options → Factors → Outcomes/Risks → Goal

- Decision FRAMES options (structural)
- Options SET controllable factor values (intervention)
- Factors INFLUENCE outcomes and risks (causal)
- Outcomes CONTRIBUTE positively to goal; risks CONTRIBUTE negatively (sign in strength.mean)

Decision and option nodes are structural scaffolding; inference operates on factors→outcomes→goal.
</TOPOLOGY>

<EDGE_TABLE>
| From     | To       | Meaning                    |
|----------|----------|----------------------------|
| decision | option   | Decision frames option     |
| option   | factor   | Option sets factor value   |
| factor   | outcome  | Factor influences outcome  |
| factor   | risk     | Factor influences risk     |
| factor   | factor   | Factor affects factor (from any, target must be exogenous) |
| outcome  | goal     | Outcome contributes (+)    |
| risk     | goal     | Risk contributes (−)       |

Closed-world: only these edge types are valid.
</EDGE_TABLE>

<NODE_DEFINITIONS>
decision: The choice being analysed. Exactly one. No incoming edges, outgoing only to options.

option: A mutually exclusive choice. At least two required. Exactly one incoming edge (from decision), outgoing only to factors. Must have data.interventions.

  Status quo rule: If the brief implies only one option, add a "Status quo" option:
  - If factor has data.value, set intervention to that value
  - For integer-encoded strategy factors (non-numeric briefs), use 0
  - For numeric factors with unknown baseline, omit from interventions and do not create option→factor edge

factor: A variable in the system.
  - Controllable: has incoming option→factor edge(s). May include data.value (the current/baseline state).
  - Exogenous (non-controllable): no incoming option edges (e.g., market demand). No data field. May still receive factor→factor edges from controllable or other exogenous factors.

outcome: Positive result. Incoming from factors, outgoing only to goal. Edge to goal has mean > 0.

risk: Negative consequence. Incoming from factors, outgoing only to goal. Edge to goal has mean < 0.

goal: Ultimate objective. Exactly one. No outgoing edges.
</NODE_DEFINITIONS>

<BASELINE_EXTRACTION>
Extract the current/baseline value when the brief explicitly states it.

data.value represents the CURRENT STATE before any intervention is applied.

Patterns:
- "from £49 to £59" → data.value: 49, intervention: 59, unit: "£"
- "increase from 100 to 150" → data.value: 100, intervention: 150
- "currently 5%, target 3%" → data.value: 0.05, intervention: 0.03

Rules:
- Never guess baselines — only include data.value when brief explicitly states current value
- Do not infer baselines from "typical" or "common" values
- Only include data.unit when unit appears in brief; otherwise omit
- If no baseline extractable, omit data field entirely
- Strip symbols: £59 → 59, $10k → 10000, 4% → 0.04

Non-numeric briefs: use integer encoding with data.value = 0 as baseline.
</BASELINE_EXTRACTION>

<CONSTRAINTS>
- Maximum {{maxNodes}} nodes, {{maxEdges}} edges
- Node IDs: lowercase alphanumeric + underscores
- strength.mean: [-1, +1] — vary based on relationship strength; do not default many edges to 1.0
- strength.std: > 0 (minimum 0.01)
- exists_probability: [0, 1]
- Structural edges (decision→option, option→factor): strength {mean: 1.0, std: 0.01}, exists_probability: 1.0 — placeholders only, not causal
- Top-level JSON must contain exactly "nodes" and "edges" keys
</CONSTRAINTS>

<OUTPUT_SCHEMA>
Three node shapes:

Option node (data.interventions required):
{"id": "opt_x", "kind": "option", "label": "...", "data": {"interventions": {"fac_id": 59}}}

Controllable factor (data.value when baseline extractable):
{"id": "fac_x", "kind": "factor", "label": "...", "data": {"value": 49, "unit": "£"}}

All other nodes (no data field):
{"id": "dec_x", "kind": "decision", "label": "..."}
{"id": "out_x", "kind": "outcome", "label": "..."}
{"id": "risk_x", "kind": "risk", "label": "..."}
{"id": "goal_x", "kind": "goal", "label": "..."}
{"id": "fac_exog", "kind": "factor", "label": "..."}

Edge shape:
{"from": "string", "to": "string", "strength": {"mean": 0.5, "std": 0.1}, "exists_probability": 0.9}

No fields beyond those shown. Output only valid JSON, no markdown.
</OUTPUT_SCHEMA>

<CANONICAL_EXAMPLE>
Brief: "Given our goal of reaching £20k MRR within 12 months while keeping monthly logo churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?"

{
  "nodes": [
    {"id": "dec_pricing", "kind": "decision", "label": "Pro Plan Pricing with Feature Release"},
    {"id": "opt_increase", "kind": "option", "label": "Increase to £59 with release", "data": {"interventions": {"fac_price": 59, "fac_bundle_release": 1}}},
    {"id": "opt_status_quo", "kind": "option", "label": "Maintain £49", "data": {"interventions": {"fac_price": 49, "fac_bundle_release": 0}}},
    {"id": "fac_price", "kind": "factor", "label": "Pro Plan Price", "data": {"value": 49, "unit": "£"}},
    {"id": "fac_bundle_release", "kind": "factor", "label": "Bundle Price Change with Feature Release", "data": {"value": 0}},
    {"id": "fac_perceived_value", "kind": "factor", "label": "Perceived Value"},
    {"id": "fac_market_conditions", "kind": "factor", "label": "Market Conditions"},
    {"id": "out_mrr", "kind": "outcome", "label": "Monthly Recurring Revenue"},
    {"id": "out_upgrades", "kind": "outcome", "label": "Plan Upgrades"},
    {"id": "risk_churn", "kind": "risk", "label": "Logo Churn Rate"},
    {"id": "risk_competitor", "kind": "risk", "label": "Competitor Undercut"},
    {"id": "goal_growth", "kind": "goal", "label": "Reach £20k MRR with churn under 4%"}
  ],
  "edges": [
    {"from": "dec_pricing", "to": "opt_increase", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0},
    {"from": "dec_pricing", "to": "opt_status_quo", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0},
    {"from": "opt_increase", "to": "fac_price", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0},
    {"from": "opt_increase", "to": "fac_bundle_release", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0},
    {"from": "opt_status_quo", "to": "fac_price", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0},
    {"from": "opt_status_quo", "to": "fac_bundle_release", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0},
    {"from": "fac_bundle_release", "to": "fac_perceived_value", "strength": {"mean": 0.6, "std": 0.2}, "exists_probability": 0.85},
    {"from": "fac_market_conditions", "to": "fac_perceived_value", "strength": {"mean": 0.4, "std": 0.15}, "exists_probability": 0.7},
    {"from": "fac_price", "to": "out_mrr", "strength": {"mean": 0.8, "std": 0.15}, "exists_probability": 0.95},
    {"from": "fac_price", "to": "risk_churn", "strength": {"mean": 0.5, "std": 0.2}, "exists_probability": 0.8},
    {"from": "fac_perceived_value", "to": "risk_churn", "strength": {"mean": -0.6, "std": 0.15}, "exists_probability": 0.85},
    {"from": "fac_perceived_value", "to": "out_upgrades", "strength": {"mean": 0.7, "std": 0.2}, "exists_probability": 0.8},
    {"from": "fac_market_conditions", "to": "risk_competitor", "strength": {"mean": 0.5, "std": 0.25}, "exists_probability": 0.6},
    {"from": "out_mrr", "to": "goal_growth", "strength": {"mean": 0.9, "std": 0.1}, "exists_probability": 1.0},
    {"from": "out_upgrades", "to": "goal_growth", "strength": {"mean": 0.4, "std": 0.15}, "exists_probability": 0.85},
    {"from": "risk_churn", "to": "goal_growth", "strength": {"mean": -0.7, "std": 0.15}, "exists_probability": 0.95},
    {"from": "risk_competitor", "to": "goal_growth", "strength": {"mean": -0.3, "std": 0.2}, "exists_probability": 0.5}
  ]
}

Key patterns demonstrated:
- Compound goal: combines MRR target and churn constraint in label
- Numeric baseline: fac_price has data.value: 49 (from "from £49")
- Integer encoding: fac_bundle_release uses 0/1 (0=no bundle, 1=bundle with price change)
- Status quo option: opt_status_quo sets all factors to baseline values
- Factor→factor edge: fac_bundle_release → fac_perceived_value (controllable → exogenous)
- Exogenous factors: fac_perceived_value and fac_market_conditions have no incoming option edges
- Multiple outcomes and risks flowing to single goal
- Varied strengths: -0.7, -0.6, -0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9
- Varied exists_probability: 0.5, 0.6, 0.7, 0.8, 0.85, 0.95, 1.0
</CANONICAL_EXAMPLE>`;

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
- Ensure node kinds are valid (goal, decision, option, outcome, risk, factor)
- Maintain graph topology where possible

## CRITICAL: Closed-World Edge Rules (v4)
Only these edge patterns are ALLOWED:

| From     | To       | Meaning                              |
|----------|----------|--------------------------------------|
| decision | option   | Decision frames this option          |
| option   | factor   | Option sets factor value             |
| factor   | outcome  | Factor influences outcome            |
| factor   | risk     | Factor influences risk               |
| factor   | factor   | Factor affects another factor        |
| outcome  | goal     | Outcome contributes to goal          |
| risk     | goal     | Risk contributes to goal             |

**ALL other edge patterns are PROHIBITED and must be removed or fixed.**

Correct topology: Decision → Options → Factors → Outcomes/Risks → Goal

**PROHIBITED edges to REMOVE:**
- option → outcome (WRONG: use option → factor → outcome)
- option → goal (WRONG: use option → factor → outcome → goal)
- factor → goal (WRONG: use factor → outcome → goal)
- factor → decision (factors don't cause decisions)
- factor → option (factors influence outcomes via factors, not options)
- goal → anything (goal is terminal sink)
- outcome → option (outcomes don't cause options)

## Output Format (JSON)
{
  "nodes": [
    { "id": "goal_1", "kind": "goal", "label": "..." },
    { "id": "dec_1", "kind": "decision", "label": "..." },
    { "id": "opt_1", "kind": "option", "label": "..." },
    { "id": "fac_1", "kind": "factor", "label": "..." },
    { "id": "out_1", "kind": "outcome", "label": "..." }
  ],
  "edges": [
    { "from": "dec_1", "to": "opt_1", "belief": 1.0 },
    { "from": "opt_1", "to": "fac_1", "belief": 1.0 },
    { "from": "fac_1", "to": "out_1", "belief": 0.7 },
    { "from": "out_1", "to": "goal_1", "belief": 0.8 }
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
