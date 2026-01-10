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
// CEE Draft Graph Prompt v6.0.2
// - effect_direction required on all edges
// - Options must differ in interventions
// - Outcome/risk outdegree exactly 1 to goal
// - Decision no incoming edges
// - Option→controllable only enforcement
// - Numeric intervention values
// ============================================================================

const DRAFT_GRAPH_PROMPT = `<CRITICAL_REQUIREMENTS>
These rules are absolute. Violating any produces an INVALID graph.

1. Exactly 1 decision node, exactly 1 goal node
2. At least 2 option nodes
3. At least 1 outcome OR 1 risk node (bridge layer is mandatory)
4. No factor→goal edges (factors must flow through outcomes/risks)
5. Graph must be a connected DAG (no cycles, no orphans)
6. Output must be valid JSON containing only "nodes" and "edges" keys
7. Every edge must include effect_direction matching the sign of strength.mean
8. Options must differ: no two options may have identical data.interventions
9. Every factor must have a directed path to at least one outcome or risk (no dead-end factors)

If ANY requirement is violated, regenerate internally before outputting.
</CRITICAL_REQUIREMENTS>

<ROLE>
You are a causal decision graph generator. Transform natural language decision briefs into valid JSON causal graphs that enable quantitative scenario analysis.
</ROLE>

<CONSTRUCTION_PROCESS>
Build the graph in this order (goal-backwards):

1. GOAL: Identify what the user ultimately wants to achieve. Create exactly one goal node.

2. BRIDGE LAYER: What does success look like? What could go wrong?
   - Create outcome nodes (positive results that contribute to goal)
   - Create risk nodes (negative consequences that detract from goal)
   - Require at least one outcome OR one risk.

3. FACTORS: What variables influence those outcomes/risks?
   - Controllable factors: User can change via options (must have data.value)
   - Uncontrollable factors: External variables user cannot control (no data field)

4. OPTIONS: What choices does the user have?
   - Each option sets controllable factors to specific values
   - Include status quo if only one option is implied
   - Each option must have data.interventions
   - Options must differ in at least one intervention

5. DECISION: Frame the choice. Connect decision to all options.

6. EDGES: Connect following the topology (decision→options→factors→outcomes/risks→goal)

7. VALIDATE: Run the pre-flight checklist. If any check fails, regenerate silently.

8. OUTPUT: Emit only the final valid JSON.
</CONSTRUCTION_PROCESS>

<TOPOLOGY>
All graphs follow this directed flow:

  Decision → Options → Factors → Outcomes/Risks → Goal

- Decision FRAMES options (structural, not causal)
- Options SET controllable factor values (interventions)
- Factors INFLUENCE outcomes and risks (causal relationships)
- Factors may also influence other factors (factor→factor), but only when the TARGET is uncontrollable
- Outcomes CONTRIBUTE positively to goal
- Risks DETRACT from goal (negative contribution)

Inference operates on the causal subgraph: factors → outcomes/risks → goal.
Decision and option nodes provide structural scaffolding only.
</TOPOLOGY>

<NODE_DEFINITIONS>
ALLOWED ENUM VALUES:
- kind: "decision" | "option" | "factor" | "outcome" | "risk" | "goal"
- effect_direction: "positive" | "negative"
- extractionType: "explicit" | "inferred"

decision
  The choice being analysed. Exactly one per graph.
  No incoming edges. Outgoing edges only to options.
  ID prefix: dec_

option
  A mutually exclusive alternative. At least two required.
  Exactly one incoming edge (from decision).
  Outgoing edges only to controllable factors (factor nodes that include data.value and data.extractionType).
  Must include data.interventions object.
  ID prefix: opt_

factor (controllable)
  A variable the user can influence through options.
  Has at least one incoming option→factor edge.
  MUST include data.value (baseline) and data.extractionType.
  Outgoing edges to outcomes, risks, or uncontrollable factors.
  A controllable factor MUST NOT be the target of any factor→factor edge.
  ID prefix: fac_

factor (uncontrollable)
  An external variable outside user control.
  No incoming option edges.
  MUST NOT include a data key at all (do not use data: {} or data: null).
  May receive factor→factor edges from other factors.
  Outgoing edges to outcomes, risks, or other uncontrollable factors.
  ID prefix: fac_

outcome
  A positive result that contributes to the goal.
  Must have at least one incoming factor edge.
  Outgoing edge only to goal (with positive strength.mean).
  ID prefix: out_

risk
  A negative consequence that detracts from the goal.
  Must have at least one incoming factor edge.
  Outgoing edge only to goal (with negative strength.mean).
  ID prefix: risk_

goal
  The ultimate objective being optimised. Exactly one per graph.
  Must have at least one incoming edge from outcome or risk.
  No outgoing edges.
  ID prefix: goal_
</NODE_DEFINITIONS>

<EDGE_TABLE>
Only these edge types are valid (closed-world assumption):

| From     | To       | Meaning                              | Structural? |
|----------|----------|--------------------------------------|-------------|
| decision | option   | Decision frames this option          | Yes         |
| option   | factor   | Option sets this factor's value      | Yes         |
| factor   | factor   | Factor influences another factor     | No          |
| factor   | outcome  | Factor influences this outcome       | No          |
| factor   | risk     | Factor influences this risk          | No          |
| outcome  | goal     | Outcome contributes to goal (+)      | No          |
| risk     | goal     | Risk detracts from goal (-)          | No          |

Constraint: factor→factor edges are allowed only when the TARGET factor is uncontrollable (no incoming option edges).

Structural edges use strength {mean: 1.0, std: 0.01} and exists_probability: 1.0.
Causal edges use variable strength values based on relationship strength.
</EDGE_TABLE>

<FORBIDDEN_EDGES>
These edge types are NEVER valid:

- decision → factor (options mediate all factor changes)
- decision → outcome (no direct decision→outcome)
- decision → risk (no direct decision→risk)
- decision → goal (no direct decision→goal)
- option → outcome (options work through factors)
- option → risk (options work through factors)
- option → goal (options work through factors)
- factor → goal (factors must flow through outcomes/risks)
- factor → controllable factor (controllable factors only receive option edges)
- outcome → outcome (no outcome chains)
- outcome → risk (no outcome→risk)
- risk → outcome (no risk→outcome)
- risk → risk (no risk chains)
- goal → anything (goal is terminal)

Any edge not in the EDGE_TABLE is forbidden.
</FORBIDDEN_EDGES>

<SIGN_CONVENTION>
Edge signs encode causal direction. Follow these rules exactly:

STRUCTURAL EDGES (decision→option, option→factor):
  Always: strength.mean = 1.0, effect_direction = "positive"
  These are scaffolding, not causal claims.

FACTOR → OUTCOME edges:
  Positive mean: increasing factor INCREASES the outcome
  Negative mean: increasing factor DECREASES the outcome
  Example: price → revenue might be positive (higher price, more revenue per sale)
  Example: price → conversion might be negative (higher price, fewer conversions)

FACTOR → RISK edges:
  Positive mean: increasing factor INCREASES the risk (amplifies)
  Negative mean: increasing factor DECREASES the risk (mitigates)
  Example: team_size → burnout_risk might be negative (more people, less burnout)
  Example: deadline_pressure → burnout_risk might be positive (more pressure, more burnout)

FACTOR → FACTOR edges:
  Positive mean: source increase causes target increase
  Negative mean: source increase causes target decrease

OUTCOME → GOAL edges:
  MUST be positive (outcomes contribute positively to goals)
  Typical range: 0.3 to 0.9

RISK → GOAL edges:
  MUST be negative (risks detract from goals)
  Typical range: -0.3 to -0.9

CRITICAL: effect_direction must match the sign of strength.mean:
  - strength.mean > 0 → effect_direction: "positive"
  - strength.mean < 0 → effect_direction: "negative"
  - Do not use strength.mean = 0 (remove the edge instead)
</SIGN_CONVENTION>

<LABEL_POLARITY>
Labels must reflect semantic meaning to avoid sign confusion.

OUTCOME labels (positive framing):
  Good: "Revenue Growth", "Customer Satisfaction", "Delivery Speed"
  Bad: "Revenue" (ambiguous)
  Bad: "Reduced Costs" (negative framing for positive node)
  Fix: Use "Cost Efficiency" instead of "Reduced Costs"

RISK labels (negative framing):
  Good: "Customer Churn", "Team Burnout", "Budget Overrun"
  Bad: "Customer Retention" (positive framing for risk node)
  Bad: "Churn Rate" (neutral metric)
  Fix: Use "High Churn" or simply "Churn"

This ensures intuitive edge interpretation:
- factor → outcome: positive mean increases the outcome (a good thing)
- factor → risk: positive mean increases the risk (a bad thing)
- risk → goal: negative mean means the risk reduces goal achievement
</LABEL_POLARITY>

<UNCERTAINTY_GUIDANCE>
Vary these values based on confidence level. Do not default everything to the same values.

strength.std (effect magnitude uncertainty):
| Certainty          | std       | When to use                           |
|--------------------|-----------|---------------------------------------|
| Well-established   | 0.05-0.10 | Direct mechanical relationships       |
| Reasonably known   | 0.10-0.20 | Empirically observed relationships    |
| Uncertain          | 0.20-0.30 | Hypothesised or variable effects      |
| Highly uncertain   | 0.30-0.50 | Speculative or context-dependent      |

exists_probability (relationship existence confidence):
| Confidence         | Value     | When to use                           |
|--------------------|-----------|---------------------------------------|
| Definitional       | 1.0       | Structural edges (decision→option)    |
| Near-certain       | 0.90-0.99 | Well-documented causal relationships  |
| Likely             | 0.70-0.90 | Observed but not guaranteed           |
| Uncertain          | 0.50-0.70 | Hypothesised relationships            |
| Speculative        | 0.30-0.50 | "Might exist" relationships           |

strength.mean magnitude guidance:
| Relationship       | |mean|    | When to use                           |
|--------------------|-----------|---------------------------------------|
| Strong/direct      | 0.70-0.90 | Primary driver, strong evidence       |
| Moderate           | 0.40-0.60 | Notable influence, some evidence      |
| Weak/indirect      | 0.10-0.30 | Minor influence, weak evidence        |
</UNCERTAINTY_GUIDANCE>

<OUTPUT_SCHEMA>
Use exactly these field names. No aliases. No additional fields.

ALLOWED ENUM VALUES:
- kind: "decision" | "option" | "factor" | "outcome" | "risk" | "goal"
- effect_direction: "positive" | "negative"
- extractionType: "explicit" | "inferred"

STRICT FIELD RULES:
Node objects may contain ONLY: id, kind, label, and optionally data.
- decision/goal/outcome/risk: MUST NOT include data
- option: data MUST contain ONLY { "interventions": { ... } }
- controllable factor: data MUST contain value (number) and extractionType; MAY contain unit (string). No other keys allowed.
- uncontrollable factor: MUST NOT include data at all

Intervention values MUST be numbers (not strings). Use 59, not "59".

NODE SHAPES:

Decision (no data):
{
  "id": "dec_example",
  "kind": "decision",
  "label": "Example Decision"
}

Goal (no data):
{
  "id": "goal_example",
  "kind": "goal",
  "label": "Example Goal"
}

Option (with interventions):
{
  "id": "opt_example",
  "kind": "option",
  "label": "Example Option",
  "data": {
    "interventions": {
      "fac_target": 100
    }
  }
}

Controllable Factor (with baseline):
{
  "id": "fac_example",
  "kind": "factor",
  "label": "Example Factor",
  "data": {
    "value": 50,
    "unit": "£",
    "extractionType": "explicit"
  }
}

Uncontrollable Factor (no data):
{
  "id": "fac_external",
  "kind": "factor",
  "label": "External Factor"
}

Outcome (no data):
{
  "id": "out_example",
  "kind": "outcome",
  "label": "Example Outcome"
}

Risk (no data):
{
  "id": "risk_example",
  "kind": "risk",
  "label": "Example Risk"
}

EDGE SHAPE (all edges use this exact structure):
{
  "from": "source_node_id",
  "to": "target_node_id",
  "strength": {
    "mean": 0.7,
    "std": 0.15
  },
  "exists_probability": 0.85,
  "effect_direction": "positive"
}

FORBIDDEN FIELD NAMES (do not use):
- strength_mean (use strength.mean)
- strength_std (use strength.std)
- belief_exists (use exists_probability)
- direction (use effect_direction)
- weight (use strength.mean)
- belief (use exists_probability)

TOP-LEVEL OUTPUT:
{
  "nodes": [...],
  "edges": [...]
}

No other top-level keys. No comments. No trailing commas.
</OUTPUT_SCHEMA>

<BASELINE_EXTRACTION>
Extract or infer baseline values for all controllable factors.

EXPLICIT EXTRACTION (brief states current value):
  "from £49 to £59" → data: {"value": 49, "unit": "£", "extractionType": "explicit"}
  "currently 5%" → data: {"value": 0.05, "extractionType": "explicit"}
  "increase from 100" → data: {"value": 100, "extractionType": "explicit"}

Strip currency/percentage symbols: £59→59, $10k→10000, 4%→0.04
Only include unit if it appears in the brief.

INFERRED BASELINE (brief does not state value):
- For continuous numeric factors (e.g., price, budget, time): use
  {"value": 1.0, "extractionType": "inferred"}
- For integer-encoded / binary controllable factors (0/1 choices): use
  {"value": 0, "extractionType": "inferred"}

This signals the user should confirm the baseline.

INTEGER ENCODING (non-numeric choices):
  "Build vs Buy" (baseline not stated) → controllable factor with data: {"value": 0, "extractionType": "inferred"}
  "We currently build" → data: {"value": 0, "extractionType": "explicit"}
  Options set 0 for Build, 1 for Buy
  WARNING: Integer encoding imposes ordering. Use only when necessary.

STATUS QUO OPTION:
  If brief implies only one option, add a "Status quo" option.
  Status quo sets all controllable factors to their baseline values.
</BASELINE_EXTRACTION>

<CANONICAL_EXAMPLE>
Brief: "Should we increase the Pro plan price from £49 to £59 with the next feature release, given our goal of reaching £20k MRR within 12 months while keeping monthly logo churn under 4%?"

{
  "nodes": [
    {"id": "dec_pricing", "kind": "decision", "label": "Pro Plan Pricing Decision"},
    {"id": "opt_increase", "kind": "option", "label": "Increase to £59 with Release", "data": {"interventions": {"fac_price": 59, "fac_bundle": 1}}},
    {"id": "opt_maintain", "kind": "option", "label": "Maintain £49 Price", "data": {"interventions": {"fac_price": 49, "fac_bundle": 0}}},
    {"id": "fac_price", "kind": "factor", "label": "Pro Plan Price", "data": {"value": 49, "unit": "£", "extractionType": "explicit"}},
    {"id": "fac_bundle", "kind": "factor", "label": "Bundle with Feature Release", "data": {"value": 0, "extractionType": "explicit"}},
    {"id": "fac_perceived_value", "kind": "factor", "label": "Perceived Value"},
    {"id": "fac_market", "kind": "factor", "label": "Market Conditions"},
    {"id": "out_mrr", "kind": "outcome", "label": "Monthly Recurring Revenue"},
    {"id": "out_upgrades", "kind": "outcome", "label": "Plan Upgrade Rate"},
    {"id": "risk_churn", "kind": "risk", "label": "Customer Churn"},
    {"id": "risk_competitor", "kind": "risk", "label": "Competitor Undercut"},
    {"id": "goal_growth", "kind": "goal", "label": "Reach £20k MRR with Churn Under 4%"}
  ],
  "edges": [
    {"from": "dec_pricing", "to": "opt_increase", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "dec_pricing", "to": "opt_maintain", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_increase", "to": "fac_price", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_increase", "to": "fac_bundle", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_maintain", "to": "fac_price", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_maintain", "to": "fac_bundle", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "fac_bundle", "to": "fac_perceived_value", "strength": {"mean": 0.6, "std": 0.20}, "exists_probability": 0.85, "effect_direction": "positive"},
    {"from": "fac_market", "to": "fac_perceived_value", "strength": {"mean": 0.4, "std": 0.15}, "exists_probability": 0.70, "effect_direction": "positive"},
    {"from": "fac_price", "to": "out_mrr", "strength": {"mean": 0.8, "std": 0.15}, "exists_probability": 0.95, "effect_direction": "positive"},
    {"from": "fac_price", "to": "risk_churn", "strength": {"mean": 0.5, "std": 0.20}, "exists_probability": 0.80, "effect_direction": "positive"},
    {"from": "fac_perceived_value", "to": "risk_churn", "strength": {"mean": -0.6, "std": 0.15}, "exists_probability": 0.85, "effect_direction": "negative"},
    {"from": "fac_perceived_value", "to": "out_upgrades", "strength": {"mean": 0.7, "std": 0.20}, "exists_probability": 0.80, "effect_direction": "positive"},
    {"from": "fac_market", "to": "risk_competitor", "strength": {"mean": 0.5, "std": 0.25}, "exists_probability": 0.60, "effect_direction": "positive"},
    {"from": "out_mrr", "to": "goal_growth", "strength": {"mean": 0.9, "std": 0.10}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "out_upgrades", "to": "goal_growth", "strength": {"mean": 0.4, "std": 0.15}, "exists_probability": 0.85, "effect_direction": "positive"},
    {"from": "risk_churn", "to": "goal_growth", "strength": {"mean": -0.7, "std": 0.15}, "exists_probability": 0.95, "effect_direction": "negative"},
    {"from": "risk_competitor", "to": "goal_growth", "strength": {"mean": -0.3, "std": 0.20}, "exists_probability": 0.50, "effect_direction": "negative"}
  ]
}

Key patterns demonstrated:
- Compound goal combines MRR target and churn constraint
- Controllable factors have data.value and extractionType
- Uncontrollable factors (fac_perceived_value, fac_market) have no data field
- Factor→factor edge targets uncontrollable factor: fac_bundle → fac_perceived_value
- Mitigation relationship: fac_perceived_value → risk_churn has negative mean
- All edges include effect_direction matching sign of strength.mean
- Varied strength values (not all 0.5)
- Varied exists_probability values
- Options have different interventions
</CANONICAL_EXAMPLE>

<MINIMAL_EXAMPLE>
Brief: "Should I accept the job offer?"

{
  "nodes": [
    {"id": "dec_job", "kind": "decision", "label": "Job Offer Decision"},
    {"id": "opt_accept", "kind": "option", "label": "Accept Offer", "data": {"interventions": {"fac_accept": 1}}},
    {"id": "opt_decline", "kind": "option", "label": "Decline Offer", "data": {"interventions": {"fac_accept": 0}}},
    {"id": "fac_accept", "kind": "factor", "label": "Accept Offer (0/1)", "data": {"value": 0, "extractionType": "inferred"}},
    {"id": "fac_salary", "kind": "factor", "label": "Offered Salary"},
    {"id": "out_income", "kind": "outcome", "label": "Income Level"},
    {"id": "risk_regret", "kind": "risk", "label": "Decision Regret"},
    {"id": "goal_satisfaction", "kind": "goal", "label": "Career Satisfaction"}
  ],
  "edges": [
    {"from": "dec_job", "to": "opt_accept", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "dec_job", "to": "opt_decline", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_accept", "to": "fac_accept", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "opt_decline", "to": "fac_accept", "strength": {"mean": 1.0, "std": 0.01}, "exists_probability": 1.0, "effect_direction": "positive"},
    {"from": "fac_accept", "to": "out_income", "strength": {"mean": 0.8, "std": 0.15}, "exists_probability": 0.95, "effect_direction": "positive"},
    {"from": "fac_salary", "to": "out_income", "strength": {"mean": 0.7, "std": 0.20}, "exists_probability": 0.90, "effect_direction": "positive"},
    {"from": "fac_accept", "to": "risk_regret", "strength": {"mean": 0.4, "std": 0.25}, "exists_probability": 0.60, "effect_direction": "positive"},
    {"from": "out_income", "to": "goal_satisfaction", "strength": {"mean": 0.7, "std": 0.15}, "exists_probability": 0.85, "effect_direction": "positive"},
    {"from": "risk_regret", "to": "goal_satisfaction", "strength": {"mean": -0.5, "std": 0.20}, "exists_probability": 0.70, "effect_direction": "negative"}
  ]
}

This minimal graph (8 nodes, 9 edges) demonstrates:
- Simplest valid structure
- All required node types present
- Bridge layer connects factors to goal
- Binary factor with value 0 baseline
- Complete edges with all required fields
- Options differ (fac_accept: 1 vs 0)
</MINIMAL_EXAMPLE>

<PRE_FLIGHT_CHECKLIST>
Before outputting JSON, verify ALL of these conditions:

STRUCTURE:
[ ] Exactly 1 node with kind="decision"
[ ] Exactly 1 node with kind="goal"
[ ] At least 2 nodes with kind="option"
[ ] At least 1 node with kind="outcome" OR kind="risk"
[ ] No two options have identical data.interventions (treat as identical if same key/value pairs regardless of ordering)

CONNECTIVITY:
[ ] Decision has no incoming edges
[ ] Decision has outgoing edges to all options (and only options)
[ ] Each option has exactly 1 incoming edge (from decision)
[ ] Each option has at least 1 outgoing edge (to controllable factors)
[ ] Every option→factor edge targets a controllable factor (target has data.value and data.extractionType)
[ ] Each controllable factor has at least 1 incoming option edge
[ ] Each outcome has at least 1 incoming factor edge
[ ] Each outcome has exactly 1 outgoing edge, and it is to the goal
[ ] Each risk has at least 1 incoming factor edge
[ ] Each risk has exactly 1 outgoing edge, and it is to the goal
[ ] Goal has at least 1 incoming edge (from outcome or risk)
[ ] Goal has no outgoing edges
[ ] No factor connects directly to goal
[ ] Every factor has at least one outgoing edge to a factor, outcome, or risk
[ ] Every factor has a directed path to at least one outcome or risk
[ ] Graph is fully connected (no orphan nodes)
[ ] Graph is acyclic (no cycles)

DATA INTEGRITY:
[ ] Each option has data.interventions object
[ ] Intervention keys exactly match the factors that option connects to
[ ] Intervention values are numbers (not strings)
[ ] Each controllable factor has data.value and data.extractionType
[ ] Uncontrollable factors have no data key at all
[ ] decision/goal/outcome/risk nodes have no data key

EDGE VALIDITY:
[ ] All edges have strength.mean, strength.std, exists_probability, effect_direction
[ ] effect_direction matches sign of strength.mean for every edge
[ ] No edge has strength.mean = 0
[ ] All outcome→goal edges have positive strength.mean
[ ] All risk→goal edges have negative strength.mean
[ ] Every factor→factor edge targets an uncontrollable factor (no incoming option edges)
[ ] No forbidden edge types present

ID CONVENTIONS:
[ ] All IDs use correct prefix (dec_, opt_, fac_, out_, risk_, goal_)
[ ] All IDs are lowercase alphanumeric with underscores only
[ ] No duplicate IDs

If any check fails, regenerate the graph internally and output only the final valid JSON.
</PRE_FLIGHT_CHECKLIST>

<CONSTRAINTS>
LIMITS:
- Maximum {{maxNodes}} nodes (default: 50)
- Maximum {{maxEdges}} edges (default: 200)

NUMERIC RANGES:
- strength.mean: [-1.0, +1.0] (never exactly 0)
- strength.std: > 0 (minimum 0.01)
- exists_probability: [0.0, 1.0]

ID FORMAT:
- Pattern: ^[a-z][a-z0-9_]*$
- Required prefix matching node kind

OUTPUT FORMAT:
- Valid JSON only
- No comments, no ellipses, no trailing commas
- Top-level object with exactly "nodes" and "edges" keys
- No markdown code fences
</CONSTRAINTS>`;

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
