/**
 * explain_result Action
 *
 * Code templates structured sections from analysis data.
 * Returns a CommentaryBlock with sections, not just inline text.
 */

import { randomUUID } from "node:crypto";
import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, DeterministicCommentaryBlockData } from "../types.js";
import type { TypedConversationBlock } from "../../types.js";

export const explainResultAction: ActionDefinition = {
  action_type: 'explain_result',
  description: 'Explain the analysis results in plain language.',
  stage_eligibility: new Set(['evaluate', 'decide', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'inline',
  role: 'scientist',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {
      focus: { type: 'string', description: 'Aspect of the results to focus on' },
    },
    required: [],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results available. Run analysis first.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    // focus is unused today but kept on the schema so callers can pass it.
    void params;
    const summary = ctx.analysis_summary!;
    const sections: DeterministicCommentaryBlockData['sections'] = [];

    // ── Winner headline → assistantText ONLY ───────────────────────────
    // Fix 3 acceptance criterion: no duplicate winner statement across
    // assistantText, block sections, and block narrative. The winner line
    // lives in exactly one place — assistantText. The block carries the
    // supporting structure (Stability, Key drivers, Constraints) without
    // restating the recommendation.
    const winnerHeadline = summary.winner
      ? `${summary.winner} leads the analysis${summary.winner_probability != null ? ` at ${(summary.winner_probability * 100).toFixed(0)}%` : ''}.`
      : 'Analysis results are ready.';

    // Stability
    if (summary.robustness_band) {
      sections.push({
        heading: 'Stability',
        content: `Robustness: ${summary.robustness_band}.`,
      });
    }

    // Key drivers — prefer the UI-forwarded factor_sensitivity (carries
    // influence_percent + confidence_band) over the legacy elasticity-based
    // top_drivers. Mirrors prompt-builder-v2's ### Key drivers fallback chain
    // so the commentary block stays in sync with what the LLM sees in Zone 2.
    if (summary.factor_sensitivity.length > 0) {
      sections.push({
        heading: 'Key drivers',
        items: summary.factor_sensitivity.slice(0, 3).map((f) => {
          const segs: string[] = [f.label];
          if (f.influence_percent != null) segs.push(`influence ${f.influence_percent.toFixed(0)}%`);
          if (f.confidence_band) segs.push(`confidence: ${f.confidence_band}`);
          return segs.join(' — ');
        }),
      });
    } else if (summary.top_drivers.length > 0) {
      sections.push({
        heading: 'Key drivers',
        items: summary.top_drivers
          .slice(0, 3)
          .map((d) => `${d.label} (${d.sensitivity.toFixed(2)})`),
      });
    } else {
      // No individual driver dominated — build informative fallback
      let content = 'No single dominant driver — the outcome is shaped by the combined effect of multiple factors.';
      if (summary.fragile_edge_count > 0) {
        content += ` ${summary.fragile_edge_count} fragile edge${summary.fragile_edge_count > 1 ? 's' : ''} detected — small changes in those connections could shift results.`;
      }
      sections.push({ heading: 'Drivers', content });
    }

    // Constraint tensions
    if (summary.constraint_tensions.length > 0) {
      sections.push({
        heading: 'Constraints',
        content: `Tensions: ${summary.constraint_tensions.join('; ')}.`,
      });
    }

    // Fix 3: narrative is intentionally empty. The UI renders `sections`
    // when they are present; the previous implementation also re-rendered
    // sections as markdown into `narrative`, causing the UI (which renders
    // both) to display each heading twice. The narrative key is kept on the
    // block because DeterministicCommentaryBlockData.narrative is required.
    const block: TypedConversationBlock = {
      block_id: `blk_commentary_${randomUUID().replace(/-/g, '').substring(0, 16)}`,
      block_type: 'commentary',
      data: { narrative: '', sections, supporting_refs: [] },
      provenance: { trigger: 'deterministic:explain_result', turn_id: ctx.turn_id, timestamp: new Date().toISOString() },
    };

    return {
      blocks: [block],
      assistantText: winnerHeadline,
      guidance_items: [],
    };
  },

  chipLabel() { return 'Explain results'; },
  chipPrompt() { return 'Explain the results'; },
};
