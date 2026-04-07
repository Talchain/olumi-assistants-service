/**
 * add_option Action
 *
 * Build multi-op patch (add_node + structural edges + interventions).
 * Requires confirmation. Structural edges use fixed params.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { PatchOperation } from "../../types.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";
import { computeStructuralReadiness } from "../../tools/analysis-ready-helper.js";
import { AnalysisReadyPayload } from "../../../schemas/analysis-ready.js";
import { log } from "../../../utils/telemetry.js";

export const addOptionAction: ActionDefinition = {
  action_type: 'add_option',
  description: 'Add a new option to the decision model.',
  stage_eligibility: new Set(['ideate']),
  requires_target: false,
  requires_confirmation: true,
  execution_risk: 'high',
  reversible: true,
  surface: 'proposal_card',
  role: 'facilitator',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Name for the new option' },
      interventions: {
        type: 'array',
        description: 'Factor-level intervention overrides',
        items: {
          type: 'object',
          properties: {
            factor_id: { type: 'string', description: 'Target factor ID' },
            value: { type: 'number', description: 'Numeric intervention value' },
          },
          required: ['factor_id', 'value'],
          additionalProperties: false,
        },
      },
    },
    required: ['label'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const label = params.label as string | undefined;

    if (!label) {
      return { blocks: [], assistantText: 'What should the new option be called?', guidance_items: [] };
    }

    // Normalize interventions: accept both array format (new) and legacy object format
    let interventions: Record<string, number> = {};
    const rawInterventions = params.interventions;

    if (Array.isArray(rawInterventions)) {
      // New array format: [{ factor_id, value }, ...]
      for (const item of rawInterventions) {
        if (item && typeof item === 'object') {
          const factorId = (item as Record<string, unknown>).factor_id;
          const value = (item as Record<string, unknown>).value;
          if (typeof factorId === 'string' && typeof value === 'number') {
            interventions[factorId] = value;
          }
        }
      }
    } else if (rawInterventions && typeof rawInterventions === 'object') {
      // Legacy object format: { factor_id → value }
      interventions = rawInterventions as Record<string, number>;
    }

    // Guard: don't create an empty-intervention option when the graph has factors.
    // This catches cases where streamed tool JSON failed to parse, leaving interventions
    // as {} — the user needs to specify what the option changes.
    if (Object.keys(interventions).length === 0 && ctx.graph) {
      const factorLabels = [...ctx.entities.nodes.values()]
        .filter((n) => n.kind === 'factor')
        .map((n) => n.label);
      if (factorLabels.length > 0) {
        const namedFactors = factorLabels.slice(0, 5).join(', ');
        const suffix = factorLabels.length > 5 ? `, and ${factorLabels.length - 5} more` : '';
        return {
          blocks: [],
          assistantText: `Option **${label}** needs to specify how it changes ${namedFactors}${suffix}. What values would this option set for these factors?`,
          guidance_items: [],
        };
      }
    }

    const nodeId = `option_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`;

    const operations: PatchOperation[] = [
      {
        op: 'add_node',
        path: nodeId,
        value: {
          id: nodeId,
          kind: 'option',
          label,
          data: { interventions },
        },
      },
    ];

    // No option→goal edge — forbidden by platform STRUCTURAL_RULES.
    // Options connect to factors only; factor→outcome→goal paths already exist.

    // Intervention edges to factors
    if (Object.keys(interventions).length > 0) {
      for (const [factorId, value] of Object.entries(interventions)) {
        operations.push({
          op: 'add_edge',
          path: `${nodeId}->${factorId}`,
          value: {
            from: nodeId,
            to: factorId,
            strength: { mean: 1.0, std: 0.01 },
            exists_probability: 1.0,
            effect_direction: 'positive',
          },
        });
      }
    }

    const interventionCount = Object.keys(interventions).length;
    const summary = interventionCount > 0
      ? ` with ${interventionCount} intervention${interventionCount > 1 ? 's' : ''}`
      : '';

    // Build a synthetic post-patch graph as READ-ONLY input to
    // computeStructuralReadiness. This is the same helper draft_graph uses
    // (src/orchestrator/tools/draft-graph.ts:163-165) and handles per-option
    // status derivation, so we never hand-roll status logic here.
    //
    // CRITICAL: this synthetic graph must NOT mutate ctx.graph. We use a
    // shallow clone of nodes/edges arrays and never call .push on the
    // original. Existing entries are referenced by identity (we don't deep
    // clone) which is safe because computeStructuralReadiness only reads.
    // The real graph mutation happens server-side when the patch is applied.
    let analysisReady: ActionResult['analysis_ready'];
    if (ctx.graph) {
      // Mirror interventions on both `data.interventions` (canonical edit
      // location, gated by CEE_EDIT_INTERVENTION_ROUTING_ENABLED) and on
      // top-level `interventions` (always-on fallback per
      // mergeInterventionSources, source 3). This makes the synthetic node
      // robust to the flag being toggled in tests or staging.
      const newOptionNode = {
        id: nodeId,
        kind: 'option' as const,
        label,
        data: { interventions },
        interventions,
      };
      // If an option with the same id already exists, replace it; otherwise append.
      // Replacement matters for re-add scenarios — duplicates would skew status counts.
      const existingIdx = ctx.graph.nodes.findIndex((n) => n.id === nodeId);
      const syntheticNodes = existingIdx >= 0
        ? [
            ...ctx.graph.nodes.slice(0, existingIdx),
            newOptionNode,
            ...ctx.graph.nodes.slice(existingIdx + 1),
          ]
        : [...ctx.graph.nodes, newOptionNode];

      // Append intervention edges (option → factor). The numeric value is
      // encoded on the option node's data.interventions (above), not the
      // edge — mirrors the real patch shape (see operations[] earlier in
      // this function). computeStructuralReadiness reads interventions off
      // the node, so the edges only need to assert connectivity.
      //
      // Filter out any existing edges FROM this nodeId first: when replacing
      // an option (existingIdx >= 0), the old edges would otherwise accumulate
      // in syntheticEdges alongside the new ones, making optionToFactors in
      // computeStructuralReadiness include stale targets and biasing status
      // toward needs_encoding rather than needs_user_mapping.
      const baseEdges = ctx.graph.edges.filter((e) => e.from !== nodeId);
      const newEdges = Object.keys(interventions).map((factorId) => ({
        from: nodeId,
        to: factorId,
        strength: { mean: 1.0, std: 0.01 },
        exists_probability: 1.0,
        effect_direction: 'positive' as const,
      }));
      const syntheticEdges = [...baseEdges, ...newEdges];

      const syntheticGraph: GraphV3T = {
        ...ctx.graph,
        nodes: syntheticNodes as GraphV3T['nodes'],
        edges: syntheticEdges as GraphV3T['edges'],
      };

      const rawReadiness = computeStructuralReadiness(syntheticGraph);
      if (rawReadiness) {
        // Validate against the canonical Zod schema to catch divergence between
        // the local GraphPatchBlockData TS type and AnalysisReadyPayload.
        // Mirrors the non-fatal pattern in draft_graph.ts:545. The payload uses
        // option_id (outward contract) while the Zod schema expects id — re-map
        // for validation only, then return the option_id version unchanged.
        const forValidation = {
          ...rawReadiness,
          options: rawReadiness.options.map((o) => ({
            id: o.option_id,
            label: o.label,
            status: o.status,
            interventions: o.interventions,
          })),
        };
        const parseResult = AnalysisReadyPayload.safeParse(forValidation);
        if (!parseResult.success) {
          log.warn(
            {
              errors_flat: parseResult.error.flatten(),
              error_paths: parseResult.error.issues.slice(0, 3).map((i) => ({ path: i.path, message: i.message })),
            },
            'add_option: analysis_ready failed Zod contract validation — emitting anyway (non-fatal)',
          );
        }
        analysisReady = rawReadiness;
      }
    }

    return {
      blocks: [],
      assistantText: `I'll add option **${label}**${summary}. Please confirm.`,
      guidance_items: [],
      operations,
      ...(analysisReady ? { analysis_ready: analysisReady } : {}),
    };
  },

  chipLabel() { return 'Add option'; },
  chipPrompt(rec) {
    return rec.parameters?.label ? `Add option: ${rec.parameters.label}` : 'Add a new option';
  },
};
