/**
 * Prompt Builder v2 — Static/Dynamic Split for Prompt Caching
 *
 * Returns two blocks: a cacheable static block (identity + response rules)
 * and a per-turn dynamic block (TurnContext state + signals).
 *
 * No action vocabulary — tool definitions carry action descriptions natively.
 * No JSON contract — the model uses tools for structural actions and responds
 * with conversational text otherwise.
 *
 * FLAG FOR PAUL (v31 prompt): The PMS prompt must be updated to:
 * 1. Remove the JSON response contract ({ text, insights[], recommended_actions[] })
 * 2. Remove action vocabulary section
 * 3. Add tool-use instruction: use tools for structural actions, respond with
 *    conversational text for questions/analysis
 * 4. Remove "Respond with valid JSON only" suffix
 */

import type { DeterministicTurnContext, DisambiguationHint } from "./types.js";
import { loadPrompt } from "../../prompts/loader.js";
import { log, emit } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export interface DeterministicPromptV2 {
  /** Identity + response rules. Cacheable — identical across turns in a session. */
  static_block: string;
  /** TurnContext state, signals, blockers, disambiguation. Varies per turn. */
  dynamic_block: string;
}

// ============================================================================
// PMS Cache (TTL-gated, refreshed inline)
// ============================================================================

interface CachedPrompt { content: string; loadedAt: number; }
let promptCache: CachedPrompt | null = null;
const PROMPT_CACHE_TTL_MS = 300_000; // 5 minutes, matches prompt-loader.ts

/** @internal Test-only: reset the module-level cache. */
export function _resetPromptCacheForTesting(): void { promptCache = null; }

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the system prompt in two blocks for the v4 native tool-use pipeline.
 *
 * The static block is identical across turns and marked with cache_control
 * by the caller. The dynamic block varies per turn.
 */
export async function buildDeterministicPromptV2(ctx: DeterministicTurnContext): Promise<DeterministicPromptV2> {
  // Refresh cache if missing or expired
  const now = Date.now();
  if (!promptCache || (now - promptCache.loadedAt) > PROMPT_CACHE_TTL_MS) {
    try {
      const result = await loadPrompt('orchestrator', { forceDefault: false });
      if (result.source === 'store') {
        promptCache = { content: result.content, loadedAt: now };
        log.info('v4.prompt.pms_loaded');
      }
    } catch {
      // non-fatal — fall through to fallback
    }
  }

  let staticBlock: string;
  if (promptCache) {
    staticBlock = promptCache.content;
  } else {
    staticBlock = STATIC_PROMPT_FALLBACK;
    const fallbackMeta = { task: 'orchestrator', env: process.env.NODE_ENV ?? 'unknown' };
    emit('v4.pms_fallback_used', fallbackMeta);
    log.warn(fallbackMeta, 'v4.pms_fallback_used');
  }

  const dynamicSections: string[] = [];
  dynamicSections.push(buildStateSection(ctx));

  if (ctx.disambiguation_hints.length > 0) {
    dynamicSections.push(buildDisambiguationSection(ctx.disambiguation_hints));
  }

  return {
    static_block: staticBlock,
    dynamic_block: dynamicSections.join('\n\n---\n\n'),
  };
}

// ============================================================================
// Static Prompt Fallback
// ============================================================================

const STATIC_PROMPT_FALLBACK = `You are Olumi, a science-powered decision coach. You help people make better decisions using causal modelling, Monte Carlo simulation, and behavioural science.

Your role is conversational partner, not tool operator. You provide insight, ask clarifying questions, challenge assumptions, and recommend next steps.

When a structural change to the model is needed (adding factors, running analysis, editing edges, etc.), use the appropriate tool. Do not describe the change in text — call the tool.

When the user asks a question, wants an explanation, or needs coaching, respond with conversational text. Keep responses under 200 words unless more detail is requested.

Communication style:
- Plain language, bold-lead paragraphs
- No markdown headers (##, ###)
- No XML tags
- Reference specific elements by name (factors, options, edges)
- Ground all numeric claims in the analysis data provided

Apply behavioural science concepts when genuinely relevant:
- Confirmation bias: when the user ignores disconfirming evidence
- Anchoring: when a single number dominates reasoning
- Overconfidence: when many values are inferred but results treated as certain
- Sunk cost: when the user resists removing something they invested in
- Status quo bias: when the user avoids analysis or alternatives
- Base rate neglect: when focusing on specific scenarios over population data

Only mention a concept when it is genuinely relevant — don't force science into every response.`;

// ============================================================================
// Dynamic Sections (shared with llm-prompt.ts — same TurnContext structure)
// ============================================================================

function buildStateSection(ctx: DeterministicTurnContext): string {
  const parts: string[] = ['## Current Decision State'];

  parts.push(`Stage: **${ctx.stage}**`);

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

  if (ctx.entities.nodes.size > 0) {
    const factorDescs: string[] = [];
    const optionDescs: string[] = [];
    for (const [id, entry] of ctx.entities.nodes) {
      if (entry.kind === 'factor') {
        const segs = [`${entry.label} (${id}`];
        if (entry.category) segs.push(`, ${entry.category}`);
        if (entry.value != null) segs.push(`, value: ${entry.value}`);
        if (entry.unit) segs.push(` ${entry.unit}`);
        segs.push(')');
        factorDescs.push(segs.join(''));
      } else if (entry.kind === 'option') {
        optionDescs.push(`${entry.label} (${id})`);
      }
    }
    if (factorDescs.length > 0) parts.push(`Factors: ${factorDescs.join(', ')}`);
    if (optionDescs.length > 0) parts.push(`Options: ${optionDescs.join(', ')}`);
  }

  // Analysis state rendering.
  //
  // Staleness contract (do not change without coordinating with the UI):
  //   - If analysis_state is present on the request, it is current. The UI strips
  //     analysis_state to undefined whenever store.graphEditedSinceLastRun is true,
  //     so by the time it reaches CEE either the analysis matches the current graph
  //     or it is absent entirely.
  //   - If analysis_summary is null AND the graph is non-empty, no analysis exists
  //     yet (or the previous one was invalidated by an edit). We must say "not yet
  //     run" — never "stale" — because CEE has no way to distinguish those cases.
  //   - If analysis_summary is null AND the graph is empty, we say nothing about
  //     analysis at all (covered by the absent branch below).
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
    if (a.constraint_tensions.length > 0) {
      parts.push(`Constraint tensions: ${a.constraint_tensions.join('; ')}`);
    }

    // ── Headed sections — these are the field names the prompt navigates by ──

    // ### Key drivers — top 3 by influence_rank from forwarded factor_sensitivity.
    // Falls back to legacy top_drivers when factor_sensitivity is not forwarded.
    if (a.factor_sensitivity.length > 0) {
      parts.push('\n### Key drivers');
      for (const f of a.factor_sensitivity.slice(0, 3)) {
        const segs: string[] = [`- ${f.label}`];
        if (f.influence_percent != null) segs.push(`influence ${f.influence_percent.toFixed(0)}%`);
        if (f.confidence_band) segs.push(`confidence: ${f.confidence_band}`);
        parts.push(segs.join(' — '));
      }
    } else if (a.top_drivers.length > 0) {
      parts.push('\n### Key drivers');
      for (const d of a.top_drivers.slice(0, 3)) {
        parts.push(`- ${d.label} (sensitivity ${d.sensitivity.toFixed(2)})`);
      }
    }

    // ### Fragile relationships — top 3 fragile edges by switch_probability desc.
    if (a.fragile_edges.length > 0) {
      parts.push('\n### Fragile relationships');
      for (const e of a.fragile_edges.slice(0, 3)) {
        parts.push(`- ${e.label} — switch probability ${(e.switch_probability * 100).toFixed(0)}%`);
      }
    }

    // ### Robustness detail — top 2 most fragile + top 1 most robust by e_value.
    if (a.edge_e_values.length > 0) {
      parts.push('\n### Robustness detail');
      for (const e of a.edge_e_values) {
        const tag = e.fragile ? 'fragile' : 'robust';
        parts.push(`- ${e.label} — e-value ${e.e_value.toFixed(2)} (${tag})`);
      }
    }

    // ### Conditional results — scenarios where the winner flips.
    if (a.conditional_winners.length > 0) {
      parts.push('\n### Conditional results');
      for (const c of a.conditional_winners) {
        const probSeg = c.probability != null ? ` (${(c.probability * 100).toFixed(0)}%)` : '';
        parts.push(`- Under ${c.scenario}: ${c.winner_label}${probSeg}`);
      }
    }

    // ### Inference warnings — one bullet per warning, max 5.
    if (a.inference_warnings.length > 0) {
      parts.push('\n### Inference warnings');
      for (const w of a.inference_warnings) {
        parts.push(`- ${w}`);
      }
    }
  } else if (ctx.graph_summary.node_count > 0) {
    parts.push('\n**Analysis:** Not yet run. No results are available. Do not reference winners, probabilities, or analysis findings.');
  }

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

  if (ctx.blockers.length > 0) {
    parts.push(`\nBlockers: ${ctx.blockers.map((b) => b.reason).join('; ')}`);
  }

  if (ctx.conversation.turn_count > 0) {
    parts.push(`\nConversation: ${ctx.conversation.turn_count} messages`);
  }
  if (ctx.conversation.pending_confirmation) {
    parts.push(`Pending confirmation: ${ctx.conversation.pending_confirmation}`);
  }

  return parts.join('\n');
}

function buildDisambiguationSection(hints: DisambiguationHint[]): string {
  const lines: string[] = ['## Disambiguation\n\nThe user\'s message may reference these similar elements. Ask the user to clarify which they mean before acting:'];

  for (const hint of hints) {
    const candidates = hint.candidates.map((c) => `${c.id} (${c.label})`).join(' or ');
    lines.push(`- "${hint.term}" could mean: ${candidates}`);
  }

  return lines.join('\n');
}
