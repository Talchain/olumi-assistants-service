/**
 * Deterministic LLM Prompt Builder — Layer 1
 *
 * Builds the system prompt for the JSON output contract.
 * The LLM receives TurnContext + user message and returns
 * { text, insights[], recommended_actions[] }.
 *
 * Static sections (identity, response contract, science triggers)
 * are loaded from PMS when available; falls back to hardcoded defaults.
 */

import type { DeterministicTurnContext, DisambiguationHint } from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";
import { loadPrompt } from "../../prompts/loader.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// PMS Cache
// ============================================================================

/** Cached PMS prompt (loaded once, refreshed on miss). */
let cachedPmsPrompt: string | null = null;
let pmsLoadAttempted = false;

/**
 * Attempt to load the static prompt sections from PMS.
 * Returns null if PMS is unavailable or the prompt is not configured.
 */
async function loadStaticPromptFromPms(): Promise<string | null> {
  try {
    const result = await loadPrompt('orchestrator', { forceDefault: false });
    if (result.source === 'store') {
      return result.content;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Warm the PMS cache. Call during startup or first prompt build.
 */
export async function warmPromptCache(): Promise<void> {
  pmsLoadAttempted = true;
  const content = await loadStaticPromptFromPms();
  if (content) {
    cachedPmsPrompt = content;
    log.info('deterministic.prompt.pms_loaded');
  } else {
    log.warn('deterministic.prompt.pms_unavailable_using_hardcoded');
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the system prompt for the deterministic orchestrator.
 *
 * Static sections come from PMS when available; dynamic sections
 * (state + action vocabulary) are always code-generated from TurnContext.
 */
export function buildDeterministicPrompt(ctx: DeterministicTurnContext): string {
  const sections: string[] = [];

  if (cachedPmsPrompt) {
    // PMS provides the static prompt (identity + contract + science)
    sections.push(cachedPmsPrompt);
  } else {
    // Trigger async load for next call if not yet attempted
    if (!pmsLoadAttempted) {
      pmsLoadAttempted = true;
      warmPromptCache().catch(() => { /* non-fatal */ });
    }
    // Fallback to hardcoded static sections
    sections.push(IDENTITY_SECTION);
    sections.push(RESPONSE_CONTRACT);
    sections.push(SCIENCE_TRIGGERS);
  }

  // Dynamic sections — always code-generated
  sections.push(buildStateSection(ctx));
  sections.push(buildActionVocabulary(ctx.eligible_actions));

  // Disambiguation section — only when hints are non-empty
  if (ctx.disambiguation_hints.length > 0) {
    sections.push(buildDisambiguationSection(ctx.disambiguation_hints));
  }

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
      "type": "bias_detected|missing_perspective|assumption_risk|opportunity|calibration_concern|structural_gap",
      "description": "A specific insight about the decision.",
      "severity": "info|warning|important",
      "target_id": "optional — ID of the factor/edge this relates to",
      "science_concept": "optional — relevant behavioural science concept"
    }
  ],
  "recommended_actions": [
    {
      "action_type": "one of the eligible actions listed above",
      "priority": "high|medium|low",
      "rationale": "optional — why this action is useful now",
      "...action-specific fields (target_id, value, label, etc.)"
    }
  ]
}

Rules:
- "text" is REQUIRED and must be non-empty
- 0-3 insights, each referencing specific decision elements
- "severity" is REQUIRED on every insight: "info", "warning", or "important"
- "priority" is REQUIRED on every recommended_action: "high", "medium", or "low"
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

  // Entity list for target_id references
  if (ctx.entities.nodes.size > 0) {
    const factorDescs: string[] = [];
    const optionDescs: string[] = [];
    for (const [id, entry] of ctx.entities.nodes) {
      if (entry.kind === 'factor') {
        const segs = [id, `(${entry.label}`];
        if (entry.category) segs.push(`, ${entry.category}`);
        if (entry.value != null) segs.push(`, value: ${entry.value}`);
        if (entry.unit) segs.push(` ${entry.unit}`);
        segs.push(')');
        factorDescs.push(segs.join(''));
      } else if (entry.kind === 'option') {
        optionDescs.push(`${id} (${entry.label})`);
      }
    }
    if (factorDescs.length > 0) parts.push(`Factors: ${factorDescs.join(', ')}`);
    if (optionDescs.length > 0) parts.push(`Options: ${optionDescs.join(', ')}`);
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

/** Parameter schema hints per action type — injected into the prompt. Must match Zod discriminated union. */
const ACTION_PARAM_SCHEMAS: Partial<Record<ActionName, string>> = {
  set_factor_value: '{ target_id: "factor ID", value: number, unit?: string }',
  add_constraint: '{ target_id: "factor ID", operator: "<="|">=", value: number, label: "constraint name", unit?: string }',
  add_factor: '{ label: "factor name", category?: "controllable"|"observable"|"external", connect_to?: ["target_id"] }',
  adjust_edge_strength: '{ from_id: "source factor ID", to_id: "target factor ID", direction: "strengthen"|"weaken" }',
  add_option: '{ label: "option name" }',
  remove_factor: '{ target_id: "factor ID" }',
  set_goal_target: '{ value: number, unit?: string, cap?: number }',
  run_analysis: '{}',
  explain_result: '{ focus?: "aspect to focus on" }',
  compare_options: '{}',
  challenge_assumption: '{ target_id?: "factor or edge to challenge" }',
  run_premortem: '{ target_id: "option ID to pre-mortem" }',
  what_would_flip: '{}',
  generate_artefact: '{ artefact_type: "decision_matrix"|"sensitivity_explorer"|"comparison_table"|"premortem_worksheet"|"assumption_map" }',
};

function buildActionVocabulary(eligibleActions: ActionName[]): string {
  if (eligibleActions.length === 0) {
    return '## Eligible Actions\n\nNo actions available at this stage. Suggest what the user should do to unblock actions (e.g., add factors to the model, draft a new model, provide more detail about their decision).';
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

function buildDisambiguationSection(hints: DisambiguationHint[]): string {
  const lines: string[] = ['## Disambiguation\n\nThe user\'s message may reference these similar elements. Ask the user to clarify which they mean before acting:'];

  for (const hint of hints) {
    const candidates = hint.candidates.map((c) => `${c.id} (${c.label})`).join(' or ');
    lines.push(`- "${hint.term}" could mean: ${candidates}`);
  }

  return lines.join('\n');
}
