/**
 * CEE Draft Graph Prompt v8.2
 *
 * Optimised for reasoning LLMs (GPT-5.2, Claude Opus 4.5)
 * - ~185 lines (reduced from ~600 in v6.0.2)
 * - "Why" explanations from Schema v2.6 B.1/B.4
 * - Single annotated example (general domain)
 * - No self-validation theatre (server validates)
 * - Assumes OpenAI structured outputs for JSON compliance
 *
 * Changes from v8.0:
 * - Fixed OPENAI_STRUCTURED_CONFIG.response_format shape (critical blocker)
 * - Added maxItems caps to schema arrays (50 nodes, 200 edges)
 * - "All edges" -> "All causal edges" in UNREASONABLE PATTERNS
 * - Added intermediate variable clarification
 * - Expanded explicit forbidden edges list
 * - Added pattern validation to edge from/to fields
 *
 * Changes from v7.0:
 * - Fixed TOPOLOGY: uncontrollable factors allow exogenous roots (no incoming edges)
 * - Added label polarity hints (outcomes positive, risks negative framing)
 * - Expanded forbidden edge patterns
 * - Added explicit sign constraint for outcome->goal and risk->goal
 * - Added simple brief guidance to prevent over-elaboration
 * - Tightened JSON schema with additionalProperties: false on nested objects
 *
 * Fallback: defaults.ts (v6.0.2) remains available via PROMPT_VERSION=v6
 */

import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../config/graphCaps.js';

// ============================================================================
// CEE Draft Graph Prompt v8.2
// ============================================================================

export const DRAFT_GRAPH_PROMPT_V8 = `<ROLE>
You generate causal decision graphs from natural language briefs. These graphs enable Monte Carlo simulation to compare options quantitatively. Your output directly determines whether users receive meaningful analysis or identical, useless results.
</ROLE>

<INFERENCE_CONTEXT>
Your parameters drive Monte Carlo simulation. Understanding this prevents common failures:

ALGORITHM (per sample):
1. For each edge: active = Bernoulli(exists_probability)
2. If active: beta = Normal(strength.mean, strength.std)
3. child_value += beta * parent_value
4. Propagate through graph to goal

WHY PARAMETER VARIATION MATTERS:
- Identical strength.mean values -> identical option outcomes -> no differentiation
- Identical exists_probability -> no structural uncertainty -> overconfident results
- Higher std -> wider outcome distributions -> appropriate uncertainty shown

CONSEQUENCE: If you assign 0.5 to all edges, every option produces the same result. The analysis becomes worthless.
</INFERENCE_CONTEXT>

<TOPOLOGY>
Graphs follow this directed flow:

  Decision -> Options -> Factors -> Outcomes/Risks -> Goal

NODE TYPES AND EDGE RULES:

| Node | Count | Incoming From | Outgoing To |
|------|-------|---------------|-------------|
| decision | exactly 1 | none | options only |
| option | >=2 | decision only | controllable factors only |
| factor (controllable) | >=1 | options | factors, outcomes, risks |
| factor (uncontrollable) | any | none or factors | factors, outcomes, risks |
| outcome | >=1 (or risk) | factors | goal only (label positively: "Revenue Growth" not "Reduced Losses") |
| risk | >=0 | factors | goal only (label negatively: "Customer Churn" not "Customer Retention") |
| goal | exactly 1 | outcomes, risks | none |

CRITICAL CONSTRAINTS:
- Controllable factors: receive option edges, MUST have data.value
- Uncontrollable factors: NO option edges, NO data field (may be exogenous roots with no incoming edges)
- Intermediate variables (influenced by factors but not by options): model as uncontrollable factors
- factor->factor: only when target is uncontrollable
- Bridge layer mandatory: at least 1 outcome OR 1 risk
- No shortcuts: option->outcome, option->risk, option->goal, factor->goal, decision->factor, decision->outcome are INVALID
- Also invalid: outcome->outcome, risk->risk, outcome->risk, goal->anything
</TOPOLOGY>

<PARAMETER_GUIDANCE>
STRENGTH.MEAN - Effect coefficient [-1, +1]:

| Value | Meaning | Example |
|-------|---------|---------|
| 0.7-0.9 | Strong direct effect | "Market size directly drives revenue potential" |
| 0.4-0.6 | Moderate influence | "Brand awareness noticeably affects conversion" |
| 0.1-0.3 | Weak/indirect effect | "Weather slightly impacts foot traffic" |

Sign encodes direction: positive = same direction, negative = inverse.

STRENGTH.STD - Epistemic uncertainty:

| Value | Confidence Level | Use When |
|-------|------------------|----------|
| 0.05-0.10 | High | Direct mechanical relationships |
| 0.10-0.20 | Moderate | Empirically observed |
| 0.20-0.30 | Low | Hypothesised effects |
| 0.30-0.50 | Very uncertain | Speculative |

EXISTS_PROBABILITY - Structural uncertainty:

| Value | Meaning | Use When |
|-------|---------|----------|
| 1.0 | Certain | Structural edges (decision->option) |
| 0.85-0.95 | Near-certain | Well-documented causal links |
| 0.65-0.85 | Likely | Observed but variable |
| 0.45-0.65 | Uncertain | Hypothesised relationships |

UNREASONABLE PATTERNS (from Schema B.4):

| Pattern | Problem | Fix |
|---------|---------|-----|
| All causal edges mean=0.5 | No differentiation | Rank relationships by strength |
| All causal edges same std | Ignores evidence quality | Vary by confidence |
| All causal edges exists_probability=1.0 | Ignores structural uncertainty | Some edges should be <0.9 |
| std > |mean| | Sign may flip across samples | Reduce std or increase |mean| |
| exists_probability<0.3 | Why include doubtful edge? | Strengthen evidence or remove |
</PARAMETER_GUIDANCE>

<EXTRACTION_RULES>
BASELINE VALUES:
- Explicit: "from £49 to £59" -> data.value: 49, extractionType: "explicit"
- Inferred: no value stated -> data.value: 1.0, extractionType: "inferred"
- Strip symbols: £59->59, $10k->10000, 4%->0.04

BINARY/CATEGORICAL:
- Two choices: use 0/1 encoding. Baseline typically 0.
- Three+ choices: USE one-hot binary factors unless node limits prevent it.
  Example: {UK, US, EU} -> fac_market_uk(0/1), fac_market_us(0/1), fac_market_eu(0/1)
  Interventions set exactly one to 1.
  WARNING: Integer encoding (0/1/2) implies ordering - value 2 propagates twice the effect of 1.

STATUS QUO: If brief implies only one option, add "Status Quo" option setting factors to baseline values.

SCALE DISCIPLINE (REQUIRED):
Intervention values must be on comparable scales so edge strengths (0–1) determine influence, not raw magnitudes.

WHEN TO NORMALISE:
- Normalise if any intervention value would exceed ~10
- Always normalise: cost, revenue, salary, users, time, headcount beyond small teams
- Small counts (0–10) are acceptable without normalisation

HOW TO REPRESENT:
| Type | Range | Example |
| Binary | 0 or 1 | Tech lead hired: 1 |
| Small count | 0–10 | Developer hires: 2 |
| Percentage/ratio | 0–1 decimal | Conversion rate: 0.15 |
| Large quantity | 0–1 proportion | Cost pressure: 0.6 |

Percentages must be 0–1 decimals (15% → 0.15), never 0–100.

CAP SELECTION (for large quantities):
1. Use cap explicitly stated by user (e.g., "budget is £300k")
2. If user provides any numeric anchor, derive a round plausible cap from it
3. Otherwise, use qualitative scale: Low=0.2, Medium=0.5, High=0.8
   Label must state: "Cost pressure (0–1 qualitative scale)"

CONSISTENCY:
If ANY factor requires normalisation, normalise ALL large-quantity factors in the model. Partial normalisation recreates the scale mismatch problem.

FACTOR ID RULE:
Do not change factor IDs. Use exactly the factor IDs derived from the scenario. Normalisation is expressed via value and label only.

EXAMPLES:
WRONG: label="Compensation Cost", value=180000
WRONG: label="Conversion Rate", value=15 (should be 0.15)
WRONG: Normalising cost (0.6) but leaving revenue as 50000
RIGHT: label="Compensation Cost Pressure (0–1, share of £300k cap)", value=0.6

WHY:
This PoC treats edge strengths as unitless (0–1). Mixing binary (0–1) factors with raw large values (180000) causes the largest magnitude to dominate outcomes regardless of causal strength, making results unreliable.
</EXTRACTION_RULES>

<OUTPUT_SCHEMA>
NODES - only these fields:
{
  "id": "prefix_name",      // dec_, opt_, fac_, out_, risk_, goal_
  "kind": "factor",         // decision|option|factor|outcome|risk|goal
  "label": "Human Label",
  "data": {...}             // options and controllable factors only
}

Option data:
  "data": { "interventions": { "fac_id": 123 } }

Controllable factor data:
  "data": { "value": 50, "unit": "£", "extractionType": "explicit" }

Uncontrollable factors, decision, goal, outcome, risk: NO data field.

EDGES - all edges use this structure:
{
  "from": "source_id",
  "to": "target_id",
  "strength": { "mean": 0.7, "std": 0.15 },
  "exists_probability": 0.85,
  "effect_direction": "positive"
}

effect_direction MUST match sign of strength.mean.
Structural edges (decision->option, option->factor): mean=1.0, std=0.01, exists_probability=1.0

If uncertain about a value, infer conservatively rather than omitting required fields.
</OUTPUT_SCHEMA>

<ANNOTATED_EXAMPLE>
This example is illustrative only. The same structure applies to personal, career, health, and non-business decisions.

Brief: "Should we expand into the European market given our goal of doubling annual revenue while keeping operational risk manageable?"

{
  "nodes": [
    {"id": "dec_expansion", "kind": "decision", "label": "European Market Expansion"},
    {"id": "opt_expand", "kind": "option", "label": "Enter European Market", "data": {"interventions": {"fac_europe_entry": 1, "fac_investment_pressure": 0.5}}},
    {"id": "opt_hold", "kind": "option", "label": "Focus on Domestic", "data": {"interventions": {"fac_europe_entry": 0, "fac_investment_pressure": 0.1}}},
    {"id": "fac_europe_entry", "kind": "factor", "label": "Europe Market Entry (0/1)", "data": {"value": 0, "extractionType": "inferred"}},
    {"id": "fac_investment_pressure", "kind": "factor", "label": "Investment Pressure (0-1, share of £1M cap)", "data": {"value": 0.1, "extractionType": "inferred"}},
    {"id": "fac_competition", "kind": "factor", "label": "Competitive Intensity"},
    {"id": "fac_regulations", "kind": "factor", "label": "Regulatory Complexity"},
    {"id": "out_revenue", "kind": "outcome", "label": "Revenue Growth"},
    {"id": "out_market_share", "kind": "outcome", "label": "Market Share Gain"},
    {"id": "risk_operational", "kind": "risk", "label": "Operational Complexity"},
    {"id": "risk_financial", "kind": "risk", "label": "Financial Exposure"},
    {"id": "goal_growth", "kind": "goal", "label": "Double Revenue with Manageable Risk"}
  ],
  "edges": [
    {"from": "dec_expansion", "to": "opt_expand", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "dec_expansion", "to": "opt_hold", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_expand", "to": "fac_europe_entry", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_expand", "to": "fac_investment_pressure", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_hold", "to": "fac_europe_entry", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_hold", "to": "fac_investment_pressure", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "fac_europe_entry", "to": "out_revenue", "strength": {"mean": 0.8, "std": 0.15}, "exists_probability": 0.90, "effect_direction": "positive"},
    {"from": "fac_europe_entry", "to": "out_market_share", "strength": {"mean": 0.7, "std": 0.20}, "exists_probability": 0.85, "effect_direction": "positive"},
    {"from": "fac_europe_entry", "to": "risk_operational", "strength": {"mean": 0.6, "std": 0.18}, "exists_probability": 0.88, "effect_direction": "positive"},
    {"from": "fac_investment_pressure", "to": "out_revenue", "strength": {"mean": 0.5, "std": 0.20}, "exists_probability": 0.80, "effect_direction": "positive"},
    {"from": "fac_investment_pressure", "to": "risk_financial", "strength": {"mean": 0.7, "std": 0.15}, "exists_probability": 0.92, "effect_direction": "positive"},
    {"from": "fac_competition", "to": "out_market_share", "strength": {"mean": -0.4, "std": 0.22}, "exists_probability": 0.75, "effect_direction": "negative"},
    {"from": "fac_regulations", "to": "risk_operational", "strength": {"mean": 0.5, "std": 0.25}, "exists_probability": 0.70, "effect_direction": "positive"},
    {"from": "out_revenue", "to": "goal_growth", "strength": {"mean": 0.85, "std": 0.10}, "exists_probability": 0.95, "effect_direction": "positive"},
    {"from": "out_market_share", "to": "goal_growth", "strength": {"mean": 0.4, "std": 0.15}, "exists_probability": 0.80, "effect_direction": "positive"},
    {"from": "risk_operational", "to": "goal_growth", "strength": {"mean": -0.5, "std": 0.18}, "exists_probability": 0.85, "effect_direction": "negative"},
    {"from": "risk_financial", "to": "goal_growth", "strength": {"mean": -0.6, "std": 0.15}, "exists_probability": 0.90, "effect_direction": "negative"}
  ]
}

KEY PATTERNS DEMONSTRATED:
- Coefficient variation: strongest=0.85, weakest=0.4 (not uniform)
- exists_probability variation: 0.70 to 0.95 (reflects confidence differences)
- Options differ: fac_europe_entry 1 vs 0, fac_investment_pressure 0.5 vs 0.1 (share of £1M cap)
- Controllable factors have data.value; uncontrollable factors have none
- outcome->goal positive strength; risk->goal negative strength (MANDATORY)
</ANNOTATED_EXAMPLE>

<CONSTRUCTION_FLOW>
Build in this order:

1. GOAL - What does the user ultimately want? Create one goal node.

2. BRIDGE - What does success look like? What could go wrong?
   Create outcomes (positive results) and risks (negative consequences).
   Require at least one.

3. FACTORS - What variables influence those outcomes/risks?
   Controllable (user can change) need data.value.
   Uncontrollable (external) have no data field.

4. OPTIONS - What choices exist? Each must set controllable factors to different values.
   If only one option implied, add Status Quo.

5. DECISION - Frame the choice. Connect to all options.

6. EDGES - Connect following TOPOLOGY rules. Cross-check each edge type is valid.
   Verify every factor has a causal path to goal (via outcomes/risks). Remove or reconnect isolated factors.

7. VARY PARAMETERS - Review causal edges. Ensure:
   - At least 3 distinct |strength.mean| values
   - At least 2 distinct exists_probability values
   - std varies by confidence level

For simple briefs (binary choices, few factors), aim for 6-10 nodes. Don't over-elaborate.
</CONSTRUCTION_FLOW>

<HARD_CONSTRAINTS>
LIMITS:
- Maximum {{maxNodes}} nodes
- Maximum {{maxEdges}} edges

ABSOLUTE RULES:
- Exactly 1 decision, exactly 1 goal
- At least 2 options with different interventions
- At least 1 outcome or risk (bridge layer mandatory)
- No factor->goal edges (must flow through outcomes/risks)
- Graph must be connected DAG (no cycles, no orphans)
- Edge from/to must exactly match node IDs
- effect_direction must match sign of strength.mean
- outcome->goal edges MUST have positive strength.mean
- risk->goal edges MUST have negative strength.mean

OUTPUT: Valid JSON with "nodes" and "edges" keys only.
</HARD_CONSTRAINTS>`;

// ============================================================================
// JSON Schema for OpenAI Structured Outputs
// ============================================================================

export const GRAPH_OUTPUT_SCHEMA_V8 = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          kind: {
            type: 'string',
            enum: ['decision', 'option', 'factor', 'outcome', 'risk', 'goal'],
          },
          label: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              interventions: {
                type: 'object',
                additionalProperties: { type: 'number' },
              },
              value: { type: 'number' },
              unit: { type: 'string' },
              extractionType: { type: 'string', enum: ['explicit', 'inferred'] },
            },
            additionalProperties: false,
          },
        },
        required: ['id', 'kind', 'label'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          to: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          strength: {
            type: 'object',
            properties: {
              mean: { type: 'number', minimum: -1, maximum: 1 },
              std: { type: 'number', minimum: 0.001 },
            },
            required: ['mean', 'std'],
            additionalProperties: false,
          },
          exists_probability: { type: 'number', minimum: 0, maximum: 1 },
          effect_direction: { type: 'string', enum: ['positive', 'negative'] },
        },
        required: [
          'from',
          'to',
          'strength',
          'exists_probability',
          'effect_direction',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['nodes', 'edges'],
  additionalProperties: false,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the v8 draft graph prompt with caps interpolated.
 */
export function getDraftGraphPromptV8(): string {
  return DRAFT_GRAPH_PROMPT_V8.replace(/\{\{maxNodes\}\}/g, String(GRAPH_MAX_NODES)).replace(
    /\{\{maxEdges\}\}/g,
    String(GRAPH_MAX_EDGES)
  );
}

/**
 * OpenAI API configuration for structured outputs.
 *
 * NOTE: This configuration is specific to OpenAI's API.
 * Anthropic uses a different approach for structured outputs - see anthropic adapter
 * for Claude-specific implementation details.
 */
export const OPENAI_STRUCTURED_CONFIG_V8 = {
  model: 'gpt-4o',
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'draft_graph',
      strict: true,
      schema: GRAPH_OUTPUT_SCHEMA_V8,
    },
  },
} as const;
