/**
 * challenge_assumption Action
 *
 * Code extracts weak edge / dominant factor data.
 * LLM narrates the challenge with science concept.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";

export const challengeAssumptionAction: ActionDefinition = {
  action_type: 'challenge_assumption',
  description: 'Challenge a specific assumption in the model with data and science.',
  stage_eligibility: new Set(['evaluate', 'decide', 'optimise']),
  requires_target: true,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'inline',
  role: 'challenger',
  cooldown: 'suppress_same_turn',

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results to challenge. Run analysis first.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const targetRef = params.target_id as string | undefined;

    // If no specific target, pick the dominant factor or a weak edge
    let targetId: string | null = targetRef ?? null;
    let targetLabel: string | null = null;

    if (targetRef) {
      const resolution = resolveEntity(targetRef, ctx.entities, 'none');
      if (resolution.status === 'resolved') {
        targetId = resolution.entity!.id;
        targetLabel = resolution.entity!.label;
      }
    }

    if (!targetId) {
      // Auto-select: dominant factor or weakest assumption
      if (ctx.signals.dominant_factor) {
        targetId = ctx.signals.dominant_factor;
        targetLabel = ctx.entities.nodes.get(targetId)?.label ?? targetId;
      } else if (ctx.signals.weak_edges.length > 0) {
        const weakEdge = ctx.signals.weak_edges[0];
        const [fromId] = weakEdge.split('→');
        targetId = fromId;
        targetLabel = ctx.entities.nodes.get(fromId)?.label ?? fromId;
      } else {
        return {
          blocks: [],
          assistantText: 'Which assumption would you like me to challenge? Specify a factor or edge.',
          guidance_items: [],
        };
      }
    }

    if (!targetLabel) {
      targetLabel = ctx.entities.nodes.get(targetId)?.label ?? targetId;
    }

    const sections: string[] = [];
    sections.push(`**Challenging: ${targetLabel}**`);

    // Find connected edges and their strengths
    const connectedEdges = ctx.entities.edges.filter(
      (e) => e.from === targetId || e.to === targetId,
    );

    if (connectedEdges.length > 0) {
      const weakConnections = connectedEdges.filter((e) => Math.abs(e.strength_mean) < 0.5);
      if (weakConnections.length > 0) {
        sections.push(
          `This factor has ${weakConnections.length} weak connection${weakConnections.length > 1 ? 's' : ''} — the assumed relationship may not hold.`,
        );
      }
    }

    // Check if it's a driver
    const driver = ctx.analysis_summary?.top_drivers.find((d) => d.factor_id === targetId);
    if (driver) {
      sections.push(
        `This is a top driver with sensitivity ${driver.sensitivity.toFixed(2)}. If the assumed value is wrong, the recommendation could change.`,
      );
    }

    // Science concept
    sections.push(
      '\n*Confirmation bias* — we tend to seek evidence that supports existing beliefs. Consider what evidence would disprove this assumption.',
    );

    return {
      blocks: [],
      assistantText: sections.join('\n\n'),
      guidance_items: [],
    };
  },

  chipLabel(rec) {
    return rec.target_id ? `Challenge ${rec.target_id}` : 'Challenge assumption';
  },
  chipPrompt(rec) {
    return rec.target_id ? `Challenge the assumption about ${rec.target_id}` : 'Challenge an assumption';
  },
};
