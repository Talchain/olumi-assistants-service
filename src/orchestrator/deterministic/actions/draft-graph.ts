/**
 * draft_graph Action
 *
 * Wraps the existing handleDraftGraph tool handler as a deterministic action.
 * Calls the unified CEE pipeline to generate a full causal decision model
 * from the user's brief text.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { GuidanceItem } from "../../types/guidance-item.js";
import { handleDraftGraph, type StrengthenItem } from "../../tools/draft-graph.js";
import { SIGNAL_CODES, computeGuidanceItemId } from "../../types/guidance-item.js";
import { log } from "../../../utils/telemetry.js";

export const draftGraphAction: ActionDefinition = {
  action_type: 'draft_graph',
  description: 'Generate a full causal decision model from the user\'s decision brief.',
  stage_eligibility: new Set(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'moderate',
  reversible: true,
  surface: 'proposal_card',
  role: 'scientist',
  cooldown: 'none',
  input_schema: {
    type: 'object',
    properties: {
      brief: { type: 'string', description: 'The decision brief describing the problem. Minimum 30 characters.' },
    },
    required: ['brief'],
    additionalProperties: false,
  },

  prerequisite_checks(_ctx: DeterministicTurnContext): string | null {
    // draft_graph can always run — it creates the initial model
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const brief = params.brief as string | undefined;

    if (!brief || typeof brief !== 'string' || brief.trim().length < 30) {
      return {
        blocks: [],
        assistantText: 'Please provide a decision brief of at least 30 characters describing the decision you want to model.',
        guidance_items: [],
      };
    }

    if (!ctx.request) {
      log.error({ turn_id: ctx.turn_id }, 'draft_graph.missing_request');
      return {
        blocks: [],
        assistantText: 'Unable to generate the decision model right now. Please try again.',
        guidance_items: [],
      };
    }

    const startTime = Date.now();

    try {
      const result = await handleDraftGraph(brief, ctx.request, ctx.turn_id, {
        signal: ctx.signal,
        userCurrencyHint: ctx.user_currency_hint ?? null,
      });
      const durationMs = Date.now() - startTime;

      log.info({
        turn_id: ctx.turn_id,
        brief_length: brief.length,
        duration_ms: durationMs,
        blocks_produced: result.blocks.length,
        has_graph: result.graphOutput != null,
      }, 'draft_graph.action_completed');

      // WS2: Build HandlerFact from the generated graph so the composer can
      // produce decision-language text (leading with options + goal + trade-off).
      const graph = result.graphOutput;
      const optionNodes = graph?.nodes.filter((n) => n.kind === 'option') ?? [];
      const goalNode = graph?.nodes.find((n) => n.kind === 'goal');
      const fact = graph
        ? {
            action: 'draft_created' as const,
            entities_affected: optionNodes.map((n) => ({ id: n.id, label: n.label, kind: 'option' })),
            what_changed: `${optionNodes.length} option${optionNodes.length === 1 ? '' : 's'} captured`,
            stale_analysis: false,
            auto_apply: true,
            data: {
              option_count: optionNodes.length,
              goal_label: goalNode?.label ?? 'your decision',
            },
          }
        : undefined;

      const guidanceFromStrengthen = convertStrengthenToGuidance(result.strengthenItems);

      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        guidance_items: guidanceFromStrengthen,
        applied_graph: result.graphOutput ?? undefined,
        ...(fact ? { fact } : {}),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      log.error({
        turn_id: ctx.turn_id,
        duration_ms: durationMs,
        error: error instanceof Error ? error.message : String(error),
      }, 'draft_graph.action_failed');

      return {
        blocks: [],
        assistantText: 'I wasn\'t able to generate the decision model. Please try rephrasing your brief or try again in a moment.',
        guidance_items: [],
      };
    }
  },

  chipLabel: () => 'Draft model',
  chipPrompt: () => 'Draft a decision model from my brief',
};

/**
 * Convert LLM coaching strengthen_items to GuidanceItems.
 * Each item becomes a `STRENGTHEN_ITEM` guidance signal with `could_fix`
 * category, surfaced in the guidance strip above the composer.
 */
function convertStrengthenToGuidance(items: StrengthenItem[]): GuidanceItem[] {
  return items.map((item) => {
    const item_id = computeGuidanceItemId(
      SIGNAL_CODES.STRENGTHEN_ITEM,
      item.id,
      'analysis',
    );
    return {
      item_id,
      signal_code: SIGNAL_CODES.STRENGTHEN_ITEM,
      category: 'could_fix' as const,
      source: 'analysis' as const,
      title: item.label,
      detail: item.detail,
      primary_action: {
        type: 'discuss' as const,
        prompt: `Tell me more about: ${item.label}`,
      },
      target_object: { type: 'graph' as const },
      priority: 35,
    };
  });
}
