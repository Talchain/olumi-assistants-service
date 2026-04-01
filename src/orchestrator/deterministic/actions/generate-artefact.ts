/**
 * generate_artefact Action
 *
 * LLM generates HTML/React content for sandboxed rendering.
 * Gated behind CEE_ARTEFACT_RENDERING_ENABLED.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";

const VALID_ARTEFACT_TYPES = new Set([
  'decision_matrix',
  'sensitivity_explorer',
  'comparison_table',
  'premortem_worksheet',
  'assumption_map',
  'custom',
]);

export const generateArtefactAction: ActionDefinition = {
  action_type: 'generate_artefact',
  description: 'Generate an interactive artefact (chart, matrix, or worksheet).',
  stage_eligibility: new Set(['evaluate', 'decide', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'artefact',
  role: 'scientist',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {
      artefact_type: {
        type: 'string',
        enum: ['decision_matrix', 'sensitivity_explorer', 'comparison_table', 'premortem_worksheet', 'assumption_map'],
        description: 'Type of artefact to generate',
      },
    },
    required: ['artefact_type'],
    additionalProperties: false,
  },

  prerequisite_checks(_ctx: DeterministicTurnContext): string | null {
    return 'Interactive artefact generation is not yet available. Use compare_options or what_would_flip for analysis visualisations.';
  },

  async execute(params: Record<string, unknown>, _ctx: DeterministicTurnContext): Promise<ActionResult> {
    const artefactType = (params.artefact_type as string) ?? 'custom';

    if (!VALID_ARTEFACT_TYPES.has(artefactType)) {
      return {
        blocks: [],
        assistantText: `Unknown artefact type "${artefactType}". Valid types: ${[...VALID_ARTEFACT_TYPES].join(', ')}.`,
        guidance_items: [],
      };
    }

    // Execution delegated to pipeline — LLM generates artefact content
    // The pipeline will create the ArtefactBlock with the generated content
    return {
      blocks: [],
      assistantText: null,
      guidance_items: [],
    };
  },

  chipLabel(rec) {
    const type = rec.parameters?.artefact_type as string | undefined;
    if (type === 'decision_matrix') return 'Decision matrix';
    if (type === 'comparison_table') return 'Comparison table';
    return 'Generate artefact';
  },
  chipPrompt(rec) {
    const type = rec.parameters?.artefact_type as string | undefined;
    return type ? `Generate a ${type.replace(/_/g, ' ')}` : 'Generate an artefact';
  },
};
