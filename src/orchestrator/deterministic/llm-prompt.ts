/**
 * Deterministic LLM Prompt Builder — Layer 1
 *
 * Builds the system prompt for the JSON output contract.
 * The LLM receives TurnContext + user message and returns
 * { text, insights[], recommended_actions[] }.
 */

import type { DeterministicTurnContext } from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the system prompt for the deterministic orchestrator.
 */
export function buildDeterministicPrompt(ctx: DeterministicTurnContext): string {
  const sections: string[] = [];

  // Identity
  sections.push(IDENTITY_SECTION);

  // Decision state
  sections.push(buildStateSection(ctx));

  // Action vocabulary
  sections.push(buildActionVocabulary(ctx.eligible_actions));

  // Response contract
  sections.push(RESPONSE_CONTRACT);

  // Science coaching triggers
  sections.push(SCIENCE_TRIGGERS);

  return sections.join('\n\n---\n\n');
}

// ============================================================================
// Static Sections
// ============================================================================

const IDENTITY_SECTION = `You are Olumi, a science-powered decision coach. You help people make better decisions using causal modelling, Monte Carlo simulation, and behavioural science.

Your role is conversational partner, not tool operator. You provide insight, ask clarifying questions, challenge assumptions, and recommend next steps. All structural changes (graph edits, analysis runs) are handled by code — you recommend actions, you don't execute them.

Communication style:
- Plain language, bold-lead paragraphs
- No markdown headers (##, ###)
- No XML tags
- Under 200 words unless the user asks for detail
- Reference specific elements by name (factors, options, edges)
- Ground all numeric claims in the analysis data provided`;

const RESPONSE_CONTRACT = `## Response Format

You MUST respond with valid JSON matching this schema:

{
  "text": "Your conversational response in plain language.",
  "insights": [
    {
      "type": "observation|suggestion|warning|question",
      "description": "A specific insight about the decision.",
      "target_id": "optional — ID of the factor/edge this relates to",
      "science_concept": "optional — relevant behavioural science concept"
    }
  ],
  "recommended_actions": [
    {
      "action_type": "one of the eligible actions listed above",
      "target_id": "optional — entity to act on",
      "parameters": {},
      "rationale": "optional — why this action is useful now"
    }
  ]
}

Rules:
- "text" is REQUIRED and must be non-empty
- 0-3 insights, each referencing specific decision elements
- 0-3 recommended_actions, ONLY from the eligible_actions list
- Never output XML, HTML, or markdown headers
- Never fabricate numbers — only reference data from the analysis
- When top_drivers is empty, say "Driver data not available"`;

const SCIENCE_TRIGGERS = `## Science Coaching

Apply these behavioural science concepts when relevant:
- **Confirmation bias**: When the user ignores disconfirming evidence or only considers one option
- **Anchoring**: When a single number dominates reasoning (e.g., dominant factor)
- **Overconfidence**: When the model has many inferred/default values but the user treats results as certain
- **Sunk cost**: When the user resists removing a factor or option they invested effort in
- **Status quo bias**: When the user avoids running analysis or exploring alternatives
- **Base rate neglect**: When the user focuses on a specific scenario ignoring population-level data

Only mention a concept when it's genuinely relevant — don't force science into every response.`;

// ============================================================================
// Dynamic Sections
// ============================================================================

function buildStateSection(ctx: DeterministicTurnContext): string {
  const parts: string[] = ['## Current Decision State'];

  parts.push(`Stage: **${ctx.stage}**`);

  // Graph summary
  if (ctx.graph_summary.node_count > 0) {
    parts.push(`Model: ${ctx.graph_summary.node_count} nodes, ${ctx.graph_summary.edge_count} edges, ${ctx.graph_summary.option_count} options`);
    if (ctx.graph_summary.goal_label) {
      parts.push(`Goal: ${ctx.graph_summary.goal_label}`);
    }
    if (ctx.graph_summary.option_labels.length > 0) {
      parts.push(`Options: ${ctx.graph_summary.option_labels.join(', ')}`);
    }
  } else {
    parts.push('Model: not yet created');
  }

  // Analysis summary
  if (ctx.analysis_summary) {
    const a = ctx.analysis_summary;
    parts.push('\n**Analysis Results:**');
    if (a.winner) {
      parts.push(`Winner: ${a.winner} (${a.winner_probability != null ? (a.winner_probability * 100).toFixed(0) + '%' : 'N/A'})`);
    }
    if (a.runner_up) {
      parts.push(`Runner-up: ${a.runner_up} (${a.runner_up_probability != null ? (a.runner_up_probability * 100).toFixed(0) + '%' : 'N/A'})`);
    }
    if (a.robustness_band) {
      parts.push(`Robustness: ${a.robustness_band}`);
    }
    if (a.top_drivers.length > 0) {
      const drivers = a.top_drivers.slice(0, 3).map((d) => `${d.label} (${d.sensitivity.toFixed(2)})`).join(', ');
      parts.push(`Top drivers: ${drivers}`);
    }
    if (a.constraint_tensions.length > 0) {
      parts.push(`Constraint tensions: ${a.constraint_tensions.join('; ')}`);
    }
  }

  // Signals
  const signalParts: string[] = [];
  if (ctx.signals.close_call) signalParts.push('close call (tight margin)');
  if (ctx.signals.dominant_factor) {
    const label = ctx.entities.nodes.get(ctx.signals.dominant_factor)?.label ?? ctx.signals.dominant_factor;
    signalParts.push(`dominant factor: ${label}`);
  }
  if (ctx.signals.default_value_count > 0) signalParts.push(`${ctx.signals.default_value_count} default values`);
  if (ctx.signals.weak_edges.length > 0) signalParts.push(`${ctx.signals.weak_edges.length} weak edges`);
  if (ctx.signals.high_uncertainty_factors.length > 0) signalParts.push(`${ctx.signals.high_uncertainty_factors.length} high-uncertainty factors`);

  if (signalParts.length > 0) {
    parts.push(`\nSignals: ${signalParts.join(', ')}`);
  }

  // Blockers
  if (ctx.blockers.length > 0) {
    parts.push(`\nBlockers: ${ctx.blockers.map((b) => b.reason).join('; ')}`);
  }

  // Conversation context
  if (ctx.conversation.turn_count > 0) {
    parts.push(`\nConversation: ${ctx.conversation.turn_count} messages`);
  }
  if (ctx.conversation.pending_confirmation) {
    parts.push(`Pending confirmation: ${ctx.conversation.pending_confirmation}`);
  }

  return parts.join('\n');
}

/** Parameter schema hints per action type — injected into the prompt. */
const ACTION_PARAM_SCHEMAS: Partial<Record<ActionName, string>> = {
  set_factor_value: '{ target_id: "factor label or ID", value: number }',
  add_constraint: '{ target_id: "factor to constrain", constraint_type?: "threshold"|"budget"|"timeline", threshold?: number }',
  add_factor: '{ label: "factor name", value?: number, unit?: string, category?: "controllable"|"observable" }',
  adjust_edge_strength: '{ from: "source factor", to: "target factor", strength_mean: number }',
  add_option: '{ label: "option name", interventions?: { factor_id: value } }',
  remove_factor: '{ target_id: "factor label or ID" }',
  set_goal_target: '{ threshold: number }',
  run_analysis: '{}',
  explain_result: '{}',
  compare_options: '{}',
  challenge_assumption: '{ target_id?: "factor or edge to challenge" }',
  run_premortem: '{ target_id?: "option to pre-mortem" }',
  what_would_flip: '{}',
  generate_artefact: '{ artefact_type: "decision_matrix"|"sensitivity_explorer"|"comparison_table"|"premortem_worksheet"|"assumption_map" }',
};

function buildActionVocabulary(eligibleActions: ActionName[]): string {
  if (eligibleActions.length === 0) {
    return '## Eligible Actions\n\nNo actions available at this stage.';
  }

  const lines: string[] = ['## Eligible Actions\n\nYou may recommend these actions (0-3). Include target_id and parameters as shown:'];

  for (const name of eligibleActions) {
    const def = ACTION_CATALOGUE.get(name);
    if (!def) continue;
    const confirm = def.requires_confirmation ? ' [needs confirmation]' : '';
    const schema = ACTION_PARAM_SCHEMAS[name];
    const schemaStr = schema ? ` — params: ${schema}` : '';
    lines.push(`- \`${name}\`: ${def.description}${confirm}${schemaStr}`);
  }

  return lines.join('\n');
}
