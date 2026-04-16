/**
 * remove_factor Action
 *
 * Build remove ops (edges first, then node). Requires confirmation.
 *
 * Recomputes analysis_ready against a synthetic post-removal graph so that
 * option intervention maps no longer reference the deleted factor — without
 * this, the prior analysis_ready in the UI store would still target the
 * removed node and the next run_analysis would be rejected by PLoT with
 * INVALID_INTERVENTION_TARGET. See Docs/graph-patch-handler-matrix.md
 * "Real gap: stale analysis_ready after remove_factor" for the original
 * incident analysis.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { PatchOperation } from "../../types.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";
import { resolveEntity } from "../entity-resolver.js";
import { computeStructuralReadiness } from "../../tools/analysis-ready-helper.js";
import { AnalysisReadyPayload } from "../../../schemas/analysis-ready.js";
import { log } from "../../../utils/telemetry.js";

export const removeFactorAction: ActionDefinition = {
  action_type: 'remove_factor',
  description: 'Remove a factor and all its connected edges from the model.',
  stage_eligibility: new Set(['ideate']),
  requires_target: true,
  requires_confirmation: true,
  execution_risk: 'high',
  reversible: false,
  surface: 'proposal_card',
  role: 'challenger',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'ID of the factor to remove' },
    },
    required: ['target_id'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const targetRef = params.target_id as string | undefined;

    if (!targetRef) {
      return { blocks: [], assistantText: 'Which factor would you like to remove?', guidance_items: [] };
    }

    const resolution = resolveEntity(targetRef, ctx.entities, 'high');
    if (resolution.status === 'not_found') {
      return {
        blocks: [],
        assistantText: `I couldn't find a factor called "${targetRef}" in the model.`,
        guidance_items: [],
      };
    }
    if (resolution.status === 'ambiguous') {
      const names = (resolution.candidates ?? []).map((c) => c.label).join(', ');
      return {
        blocks: [],
        assistantText: `"${targetRef}" could match: ${names}. Which one did you mean?`,
        guidance_items: [],
      };
    }

    const entity = resolution.entity!;
    const operations: PatchOperation[] = [];

    // Remove connected edges first
    const connectedEdges = ctx.entities.edges.filter(
      (e) => e.from === entity.id || e.to === entity.id,
    );
    for (const edge of connectedEdges) {
      operations.push({
        op: 'remove_edge',
        path: `${edge.from}->${edge.to}`,
      });
    }

    // Remove the node
    operations.push({
      op: 'remove_node',
      path: entity.id,
    });

    // Build a synthetic post-removal graph as READ-ONLY input to
    // computeStructuralReadiness. Mirrors add-option's pattern (see
    // add-option.ts:139-228) — we never mutate ctx.graph.
    //
    // Three rewrites against the prior graph:
    //   1. Drop the removed factor node from `nodes`.
    //   2. Drop every edge connected to the removed factor (filtered by
    //      endpoint against `ctx.graph.edges` directly, decoupled from the
    //      `connectedEdges` enumeration above so any drift between
    //      `ctx.entities.edges` and `ctx.graph.edges` cannot leave dangling
    //      edges in the synthetic graph).
    //   3. Walk option nodes and prune any intervention key that targets the
    //      removed factor — this is the bit that prevents stale
    //      analysis_ready leaking into the UI store. Without it,
    //      computeStructuralReadiness would re-emit the factor as part of each
    //      option's intervention map and PLoT would reject the next run with
    //      INVALID_INTERVENTION_TARGET.
    //
    // Step 3 walks all three intervention storage locations
    // (mergeInterventionSources sources 1-3) so the rewritten node remains
    // self-consistent regardless of which write path the original payload used.
    let analysisReady: ActionResult['analysis_ready'];
    if (ctx.graph) {
      const removedFactorId = entity.id;

      const pruneInterventionsObject = (
        obj: Record<string, unknown> | undefined,
      ): Record<string, unknown> | undefined => {
        if (!obj || typeof obj !== 'object') return obj;
        if (!(removedFactorId in obj)) return obj;
        const next: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k !== removedFactorId) next[k] = v;
        }
        return next;
      };

      const syntheticNodes = ctx.graph.nodes
        .filter((n) => n.id !== removedFactorId)
        .map((n) => {
          // Only option-kind nodes carry interventions; everything else is
          // returned by reference to keep the synthetic graph cheap.
          if (n.kind !== 'option') return n;
          const nodeAny = n as Record<string, unknown>;

          // Source 1: node.data.interventions (canonical edit location)
          const dataObj = (nodeAny.data ?? {}) as Record<string, unknown>;
          const dataInterventions = dataObj.interventions as Record<string, unknown> | undefined;
          const prunedDataInterventions = pruneInterventionsObject(dataInterventions);

          // Source 3: top-level node.interventions (pipeline copy / fallback)
          const topInterventions = nodeAny.interventions as Record<string, unknown> | undefined;
          const prunedTopInterventions = pruneInterventionsObject(topInterventions);

          // Source 2: slash-keyed entries like "data/interventions/<fac>".
          // Drop the one matching the removed factor (if any). Other slash
          // keys are passed through unchanged.
          const slashKey = `data/interventions/${removedFactorId}`;
          const hadSlashKey = slashKey in nodeAny;

          if (
            prunedDataInterventions === dataInterventions
            && prunedTopInterventions === topInterventions
            && !hadSlashKey
          ) {
            // Nothing to prune on this option — return original by identity.
            return n;
          }

          // Build a fresh shallow clone with the pruned intervention maps.
          const cloned: Record<string, unknown> = { ...nodeAny };
          if (prunedDataInterventions !== dataInterventions) {
            cloned.data = { ...dataObj, interventions: prunedDataInterventions };
          }
          if (prunedTopInterventions !== topInterventions) {
            cloned.interventions = prunedTopInterventions;
          }
          if (hadSlashKey) {
            delete cloned[slashKey];
          }
          return cloned;
        });

      // Filter the synthetic edges directly by endpoint rather than by the
      // operation-enumeration `removedEdgeKeys`. This protects the synthetic
      // graph from any drift between `ctx.entities.edges` (used to derive the
      // patch operations) and `ctx.graph.edges` (the source
      // computeStructuralReadiness reads). If those two ever disagree — e.g.
      // a stale entity registry — endpoint-based filtering still produces a
      // graph with no dangling edges referencing the removed factor.
      const syntheticEdges = ctx.graph.edges.filter(
        (e) => e.from !== removedFactorId && e.to !== removedFactorId,
      );

      const syntheticGraph: GraphV3T = {
        ...ctx.graph,
        nodes: syntheticNodes as GraphV3T['nodes'],
        edges: syntheticEdges as GraphV3T['edges'],
      };

      const rawReadiness = computeStructuralReadiness(syntheticGraph);
      if (rawReadiness) {
        // Validate against the canonical Zod schema (mirrors add-option.ts:217).
        // The payload uses option_id (outward contract) while the Zod schema
        // expects id — re-map for validation only, then return the option_id
        // version unchanged. Parse failure is non-fatal: emit anyway so the
        // envelope validator surfaces a structured warning.
        const forValidation = {
          ...rawReadiness,
          options: rawReadiness.options.map(({ option_id, ...rest }) => ({
            id: option_id,
            ...rest,
          })),
        };
        const parseResult = AnalysisReadyPayload.safeParse(forValidation);
        if (!parseResult.success) {
          log.warn(
            {
              errors_flat: parseResult.error.flatten(),
              error_paths: parseResult.error.issues.slice(0, 3).map((i) => ({ path: i.path, message: i.message })),
              removed_factor_id: removedFactorId,
            },
            'remove_factor: analysis_ready failed Zod contract validation — emitting anyway (non-fatal)',
          );
        }
        analysisReady = rawReadiness;
      }
    }

    return {
      blocks: [],
      assistantText: `**${entity.label}** and its ${connectedEdges.length} connected edge${connectedEdges.length !== 1 ? 's' : ''} would be removed.`,
      guidance_items: [],
      operations,
      ...(analysisReady ? { analysis_ready: analysisReady } : {}),
      fact: {
        action: 'factor_removed',
        entities_affected: [{ id: entity.id, label: entity.label, kind: entity.kind }],
        what_changed: `${entity.label} and ${connectedEdges.length} edge${connectedEdges.length !== 1 ? 's' : ''}`,
        stale_analysis: ctx.analysis_summary != null,
        auto_apply: false,
      },
    };
  },

  chipLabel(rec) {
    return rec.target_id ? `Remove ${rec.target_id}` : 'Remove factor';
  },
  chipPrompt(rec) {
    return rec.target_id ? `Remove ${rec.target_id} from the model` : 'Remove a factor';
  },
};
