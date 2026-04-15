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
import type { CoachingContext } from "./coaching-context-builder.js";
import { loadPrompt } from "../../prompts/loader.js";
import { shouldUseStagingPrompts } from "../../config/index.js";
import { auditPromptForV4, RUNTIME_TOOL_USE_SUFFIX } from "./prompt-audit.js";
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
export async function buildDeterministicPromptV2(
  ctx: DeterministicTurnContext,
  coaching?: CoachingContext | null,
  /** Pre-computed chip labels — injected into the coaching section so the
   *  LLM knows exactly which suggestions the UI renders and doesn't duplicate
   *  them as inline quoted text in its response (Task 6 / P1.2). */
  chipLabels?: string[],
): Promise<DeterministicPromptV2> {
  // Refresh cache if missing or expired.
  //
  // We pass `useStaging` so that when the deployment is configured for staging
  // prompts (DD_ENV=staging, PROMPTS_USE_STAGING=true, etc., resolved by
  // shouldUseStagingPrompts) the loader picks `stagingVersion` instead of the
  // default `activeVersion`. Without this, every v4 turn loads the production
  // pin even on the staging server, which silently masks staged prompt rollouts
  // (e.g. v32a uploaded as stagingVersion would never reach the LLM).
  //
  // Concurrency note: this is a module-level singleton with no in-flight dedupe.
  // Two parallel turns hitting an expired cache will both call loadPrompt and
  // both write `promptCache`. The writes carry the same content for the same
  // TTL window, so the only cost is one extra PMS call — acceptable for now.
  // useStaging is resolved from process env at startup and does not change at
  // runtime, so it is safe to omit from the cache key.
  const now = Date.now();
  if (!promptCache || (now - promptCache.loadedAt) > PROMPT_CACHE_TTL_MS) {
    try {
      const result = await loadPrompt('orchestrator', {
        forceDefault: false,
        useStaging: shouldUseStagingPrompts(),
      });
      if (result.source === 'store') {
        promptCache = { content: result.content, loadedAt: now };
        log.info({
          prompt_id: result.promptId,
          version: result.version,
          is_staging: result.isStaging ?? false,
        }, 'v4.prompt.pms_loaded');
        // Audit fires on cache miss only (every 5 min per process), not per
        // turn. Logging-only — never mutates the prompt content.
        const audit = auditPromptForV4(result.content);
        log.info({
          event: 'v4.prompt.audit',
          prompt_id: result.promptId,
          version: result.version,
          total_chars: audit.totalChars,
          dead_section_count: audit.deadSectionCount,
          estimated_dead_chars: audit.estimatedDeadChars,
          sentinels_found: audit.sentinelsFound,
          sentinels_not_found: audit.sentinelsNotFound,
          prompt_hash: audit.promptHash,
        }, 'v4.prompt.audit');
      }
    } catch (error) {
      // Non-fatal — we fall through to STATIC_PROMPT_FALLBACK below and emit
      // v4.pms_fallback_used. We log the error here so ops can see WHY the
      // fallback was used (network, parse error, etc.) instead of having to
      // hunt for it elsewhere.
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'v4.prompt.pms_load_failed',
      );
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

  // Append the runtime tool-use suffix to the cached static block. The suffix
  // tells the LLM that v4 uses native tool calling, so the dead JSON/XML
  // envelope instructions still in the cf-v28 prompt body have an explicit
  // counter-instruction. Stays in the static block so it's covered by the
  // ephemeral cache_control marker — never put this in the dynamic block.
  staticBlock = staticBlock + RUNTIME_TOOL_USE_SUFFIX;

  const dynamicSections: string[] = [];
  dynamicSections.push(buildStateSection(ctx));

  if (ctx.disambiguation_hints.length > 0) {
    dynamicSections.push(buildDisambiguationSection(ctx.disambiguation_hints));
  }

  if (coaching) {
    dynamicSections.push(buildCoachingSection(coaching, chipLabels));
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
  //   - If analysis_summary is null, we render NOTHING about analysis. We do not
  //     say "not yet run", "no results available", or "stale" — the prompt itself
  //     (v32a+) owns the rules for what to do when analysis data is absent. The
  //     dynamic block must not contradict or pre-empt those rules.
  // Diagnostic: visibility into analysis presence on every evaluate-stage
  // turn. When the client drops analysis_state on an explain turn, this log
  // shows `has_analysis_summary: false` and the post-rehydration path can be
  // verified via the paired `v4.analysis_state_rehydrated_from_session` log.
  if (ctx.stage === 'evaluate') {
    log.info({
      event: 'v4.prompt_builder_analysis_presence',
      has_analysis_summary: ctx.analysis_summary != null,
      factor_sensitivity_count: ctx.analysis_summary?.factor_sensitivity?.length ?? 0,
      top_drivers_count: ctx.analysis_summary?.top_drivers?.length ?? 0,
    }, 'prompt-builder analysis presence on evaluate-stage turn');
  }

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
  }
  // No `else` branch on purpose — see staleness contract above. When
  // analysis_summary is null, the dynamic block says nothing about analysis.

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

// ============================================================================
// Coaching Context Section (WS8)
// ============================================================================

/**
 * Render coaching context into the dynamic block.
 * Stage-aware: FRAME, IDEATE, and EVALUATE each get a tailored section.
 *
 * When `chipLabels` is provided, they are listed in the "Suggested actions"
 * subsection so the LLM knows exactly which chips the UI will render and
 * does not need to duplicate them as inline quoted text (Task 6 / P1.2).
 */
function buildCoachingSection(coaching: CoachingContext, chipLabels?: string[]): string {
  const parts: string[] = ['## Coaching Context'];

  parts.push(`Mode: ${coaching.coaching_mode}`);
  parts.push(`Move: ${coaching.primary_move}`);
  parts.push(`Posture: ${coaching.response_posture}`);

  // Headline (EVALUATE / DECIDE)
  if (coaching.headline) {
    const h = coaching.headline;
    parts.push('');
    parts.push('### Analysis');
    parts.push(`Leading: ${h.leading_option} (${h.leading_probability}%)`);
    parts.push(`Runner-up: ${h.runner_up} (${h.runner_up_probability}%)`);
    parts.push(`Stability: ${h.stability_band} (${h.stability_pct}%)`);
  }

  // Top drivers
  if (coaching.drivers.length > 0) {
    parts.push('');
    parts.push('### Top drivers');
    for (const d of coaching.drivers) {
      const aiTag = d.is_ai_estimated ? ' (AI estimated)' : '';
      parts.push(`- ${d.factor_label}: sensitivity ${Math.round(d.sensitivity * 100)}%, confidence: ${d.confidence_band}${aiTag}`);
    }
  }

  // Tradeoff (IDEATE post-draft)
  if (coaching.tradeoff) {
    const t = coaching.tradeoff;
    parts.push(`Trade-off: ${t.option_a} offers ${t.benefit_a}; ${t.option_b} offers ${t.benefit_b}`);
  }

  // Biggest inference
  if (coaching.biggest_inference) {
    const bi = coaching.biggest_inference;
    parts.push(`Biggest inference: ${bi.factor_label} (${bi.source}, ${bi.reason})`);
  }

  // Calibration target
  if (coaching.calibration_target) {
    const ct = coaching.calibration_target;
    parts.push(`Calibration target: How strong is the effect of ${ct.source_label} on ${ct.target_label}?`);
  }

  // Provenance
  parts.push(`Provenance: ${coaching.user_provided_count} from brief, ${coaching.ai_estimated_count} inferred by Olumi (${coaching.total_factor_count} total)`);

  // Risk + overlap
  if (coaching.risk_factor_count === 0 && coaching.total_factor_count > 3) {
    parts.push('Risk factors: 0');
  }
  if (coaching.option_mechanism_overlap) {
    parts.push('Option mechanism overlap: true (all options act through same factors)');
  }

  // Fragile edge
  if (coaching.top_fragile) {
    const f = coaching.top_fragile;
    parts.push(`Fragile link: ${f.source_label} to ${f.target_label} (${Math.round(f.flip_probability * 100)}% flip)`);
  }

  // Triggered plays
  if (coaching.triggered_plays.length > 0) {
    parts.push('');
    parts.push('### Active coaching plays');
    for (const p of coaching.triggered_plays) {
      parts.push(`- ${p.play}: ${p.trigger_reason} (angle: ${p.recommended_angle})`);
    }
  }

  // Challenge / question gates
  if (coaching.challenge_now) {
    parts.push('Challenge now: true');
  }
  if (coaching.ask_question_now) {
    parts.push('Ask question now: true');
  }

  // Prediction state
  if (coaching.prediction_state !== 'none') {
    parts.push(`Prediction: ${coaching.prediction_state}`);
  }

  // Critical gap
  if (coaching.critical_gap) {
    parts.push(`Critical gap: ${coaching.critical_gap.detail}`);
  }

  // CTA
  if (coaching.cta) {
    parts.push(`Decision readiness: ${coaching.cta.readiness}`);
    parts.push(`CTA: ${coaching.cta.guidance}`);
  }

  // Task 6 / P1.2: chip-format guard + label list.
  // Suggested next steps are rendered by the UI as clickable chips from the
  // envelope's suggested_actions field. When we have the computed chip labels
  // (pre-execution), list them so the LLM sees exactly what the user will
  // see. The LLM must NOT duplicate these as quoted chip-like lines in its
  // response body (e.g. `"Challenge the Cost driver" (challenger)`).
  parts.push('');
  parts.push('### Suggested actions');
  if (chipLabels && chipLabels.length > 0) {
    parts.push(`The user will see these clickable actions below your response: ${chipLabels.map(l => `"${l}"`).join(', ')}.`);
    parts.push('Do not repeat them as quoted lines with role tags in your message.');
  } else {
    parts.push(
      'Suggested next steps are provided to the user as clickable actions below your response. Do not list them as quoted lines with role tags in your message.',
    );
  }

  return parts.join('\n');
}
