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
import { STRUCTURAL_EDGE_DEFAULTS } from "../../context/constants.js";
import { config } from "../../../config/index.js";

export const addOptionAction: ActionDefinition = {
  action_type: 'add_option',
  description:
    'Add a NEW option to the decision model. Do not use for options that already exist — to update an existing option\'s effects on factors (intervention mapping), use edit_graph instead.',
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

    // Normalise interventions FIRST so the duplicate-redirect path can decide
    // whether the caller actually has anything to update on the existing option.
    const interventions = normaliseInterventions(params.interventions);

    // Duplicate detection — case-insensitive, whitespace-normalised comparison.
    // Mirrors findExistingFactor in add-factor.ts. Two paths:
    //   1. Caller passed real interventions → repair redirect: build update_node
    //      patch on the existing option (with structural edges + analysis_ready)
    //      via buildOptionConfigurationResult.
    //   2. No interventions → conversational nudge toward the existing option.
    //
    // findExistingOption uses the EXACT same matching contract as the Tier 1
    // duplicate guard. Do not introduce a second matching rule.
    const normalisedLabel = label.toLowerCase().replace(/\s+/g, ' ').trim();
    const existingOption = findExistingOption(ctx, normalisedLabel);
    if (existingOption) {
      // Empty interventions → fall to nudge. An empty object after normalisation
      // means the caller did NOT supply any factor mappings (or they all failed
      // type validation), so there is nothing to repair.
      if (Object.keys(interventions).length === 0) {
        return {
          blocks: [],
          assistantText: `Option **${existingOption.label}** already exists. Would you like to update its effects instead of creating a duplicate?`,
          guidance_items: [],
        };
      }
      log.info(
        {
          event: 'v4.option_repair_redirect',
          option_id: existingOption.id,
          intervention_count: Object.keys(interventions).length,
        },
        'add_option: redirecting to option repair on existing option',
      );
      return buildOptionConfigurationResult(ctx, existingOption, interventions);
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
          is_baseline: false,
          data: { interventions },
        },
      },
    ];

    // No option→goal edge — forbidden by platform STRUCTURAL_RULES.
    // Options connect to factors only; factor→outcome→goal paths already exist.

    // Intervention edges to factors. Use the canonical STRUCTURAL_EDGE_DEFAULTS
    // (shared with edit_graph.enforceStructuralEdgeDefaults) — never hand-roll
    // these values. Drift between handlers silently distorts analysis.
    if (Object.keys(interventions).length > 0) {
      for (const factorId of Object.keys(interventions)) {
        operations.push({
          op: 'add_edge',
          path: `${nodeId}->${factorId}`,
          value: {
            from: nodeId,
            to: factorId,
            ...STRUCTURAL_EDGE_DEFAULTS,
          },
        });
      }
    }

    const interventionCount = Object.keys(interventions).length;
    const summary = interventionCount > 0
      ? ` with ${interventionCount} intervention${interventionCount > 1 ? 's' : ''}`
      : '';

    // Build synthetic post-patch graph for analysis_ready computation.
    // Delegates to the shared helper used by both the new-option and the
    // repair-redirect paths so the logic stays in one place.
    const analysisReady = ctx.graph
      ? computeSyntheticOptionReadiness(ctx.graph, {
          id: nodeId,
          label,
          interventions,
        })
      : undefined;

    return {
      blocks: [],
      assistantText: `Option **${label}**${summary} would be added.`,
      guidance_items: [],
      operations,
      ...(analysisReady ? { analysis_ready: analysisReady } : {}),
      fact: {
        action: 'option_added',
        entities_affected: [{ id: nodeId, label, kind: 'option' }],
        what_changed: interventionCount > 0
          ? `new option with ${interventionCount} effect${interventionCount === 1 ? '' : 's'}`
          : 'new option',
        stale_analysis: ctx.analysis_summary != null,
        auto_apply: false,
        data: {
          intervention_count: interventionCount,
        },
      },
    };
  },

  chipLabel() { return 'Add option'; },
  chipPrompt(rec) {
    return rec.parameters?.label ? `Add option: ${rec.parameters.label}` : 'Add a new option';
  },
};

/**
 * Find an existing option node whose label matches the given normalised label.
 * Uses case-insensitive, whitespace-normalised comparison. Mirrors
 * `findExistingFactor` in add-factor.ts so both action handlers apply
 * identical duplicate-detection semantics.
 */
function findExistingOption(
  ctx: DeterministicTurnContext,
  normalisedLabel: string,
): { id: string; label: string } | null {
  for (const [id, entry] of ctx.entities.nodes) {
    if (entry.kind !== 'option') continue;
    const entryNormalised = entry.label.toLowerCase().replace(/\s+/g, ' ').trim();
    if (entryNormalised === normalisedLabel) {
      return { id, label: entry.label };
    }
  }
  return null;
}

/**
 * Normalise raw `params.interventions` into a `Record<string, number>`.
 * Accepts both the new array format (`[{ factor_id, value }, ...]`) and the
 * legacy object format (`{ factor_id: value, ... }`). Items that fail type
 * validation are dropped silently — callers must check the resulting object's
 * size before relying on it (`Object.keys(...).length === 0` → no usable input).
 */
function normaliseInterventions(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const factorId = (item as Record<string, unknown>).factor_id;
        const value = (item as Record<string, unknown>).value;
        if (typeof factorId === 'string' && typeof value === 'number') {
          out[factorId] = value;
        }
      }
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = v;
    }
  }
  return out;
}

/**
 * Compute analysis_ready against a synthetic post-patch graph that contains
 * the given option (added or updated) with the given interventions.
 *
 * Shared by both the new-option path and the repair-redirect path so the two
 * never drift. The synthetic graph is READ-ONLY input to
 * `computeStructuralReadiness` — never mutates `baseGraph`.
 *
 * Why mirror interventions on BOTH `data.interventions` and top-level
 * `interventions`: `mergeInterventionSources` reads `data.interventions`
 * (canonical) only when `CEE_EDIT_INTERVENTION_ROUTING_ENABLED` is true; the
 * top-level `interventions` field is the always-on fallback. Mirroring on both
 * makes the synthetic node robust to the flag being toggled in tests/staging.
 *
 * Returns undefined when `computeStructuralReadiness` returns nothing
 * (e.g. graph has no goal yet). Schema validation failure is logged but
 * non-fatal — the payload is still returned to mirror draft_graph.
 */
function computeSyntheticOptionReadiness(
  baseGraph: GraphV3T,
  option: { id: string; label: string; interventions: Record<string, number> },
): ActionResult['analysis_ready'] {
  const newOptionNode = {
    id: option.id,
    kind: 'option' as const,
    label: option.label,
    data: { interventions: option.interventions },
    interventions: option.interventions,
  };

  // Replace if an option with the same id already exists; append otherwise.
  // Replacement matters for the repair-redirect path AND for re-add scenarios
  // — duplicates would skew status counts in computeStructuralReadiness.
  const existingIdx = baseGraph.nodes.findIndex((n) => n.id === option.id);
  const syntheticNodes = existingIdx >= 0
    ? [
        ...baseGraph.nodes.slice(0, existingIdx),
        newOptionNode,
        ...baseGraph.nodes.slice(existingIdx + 1),
      ]
    : [...baseGraph.nodes, newOptionNode];

  // Filter pre-existing edges FROM this option, then re-add the canonical
  // intervention edges. Avoids stale targets accumulating when an option is
  // replaced (would otherwise bias status toward needs_encoding).
  const baseEdges = baseGraph.edges.filter((e) => e.from !== option.id);
  const newEdges = Object.keys(option.interventions).map((factorId) => ({
    from: option.id,
    to: factorId,
    ...STRUCTURAL_EDGE_DEFAULTS,
  }));
  const syntheticEdges = [...baseEdges, ...newEdges];

  const syntheticGraph: GraphV3T = {
    ...baseGraph,
    nodes: syntheticNodes as GraphV3T['nodes'],
    edges: syntheticEdges as GraphV3T['edges'],
  };

  const rawReadiness = computeStructuralReadiness(syntheticGraph);
  if (!rawReadiness) return undefined;

  // Validate against the canonical Zod schema. The payload uses option_id
  // (outward contract) while the schema expects id — re-map for validation
  // only, then return the option_id version unchanged. Mirrors the non-fatal
  // pattern in draft_graph.ts.
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
        error_paths: parseResult.error.issues
          .slice(0, 3)
          .map((i) => ({ path: i.path, message: i.message })),
      },
      'add_option: analysis_ready failed Zod contract validation — emitting anyway (non-fatal)',
    );
  }
  return rawReadiness;
}

/**
 * Build a repair-redirect ActionResult: an `update_node` patch on the existing
 * option that writes interventions to all canonical paths, plus structural
 * edges for any factors not already connected from the option.
 *
 * Writes interventions to:
 *   - `data.interventions` (primary store, prompt-taught canonical location)
 *   - top-level `interventions` (fallback read by mergeInterventionSources)
 *   - `data/interventions/<factor_id>` slash-keyed entries IFF
 *     `CEE_EDIT_INTERVENTION_ROUTING_ENABLED` is true
 *
 * See `Docs/intervention-authority-contract.md` for the storage contract.
 */
function buildOptionConfigurationResult(
  ctx: DeterministicTurnContext,
  existingOption: { id: string; label: string },
  interventions: Record<string, number>,
): ActionResult {
  // 1. Build update_node operation for the existing option.
  const updateValue: Record<string, unknown> = {
    data: { interventions },
    interventions, // fallback path read by mergeInterventionSources
  };
  if (config.cee.editInterventionRoutingEnabled) {
    for (const [fid, v] of Object.entries(interventions)) {
      updateValue[`data/interventions/${fid}`] = v;
    }
  }
  const operations: PatchOperation[] = [
    { op: 'update_node', path: existingOption.id, value: updateValue },
  ];

  // 2. Add structural edges only for factors not already connected from
  //    this option. Use the canonical defaults (never hand-roll).
  const graph = ctx.graph;
  if (graph) {
    const existingEdgeTargets = new Set(
      graph.edges.filter((e) => e.from === existingOption.id).map((e) => e.to),
    );
    for (const factorId of Object.keys(interventions)) {
      if (existingEdgeTargets.has(factorId)) continue;
      operations.push({
        op: 'add_edge',
        path: `${existingOption.id}->${factorId}`,
        value: {
          from: existingOption.id,
          to: factorId,
          ...STRUCTURAL_EDGE_DEFAULTS,
        },
      });
    }
  }

  // 3. Compute analysis_ready against a synthetic post-patch graph.
  const analysisReady = graph
    ? computeSyntheticOptionReadiness(graph, {
        id: existingOption.id,
        label: existingOption.label,
        interventions,
      })
    : undefined;

  // 4. Human-facing assistant text describing the change in decision terms.
  // F5: drop unresolvable factor ids rather than leaking raw `factor_x` /
  // `fac_x` strings into user-facing text. The LLM may hallucinate factor
  // ids; if any can't be resolved to a label, prefer a neutral phrasing.
  const factorIds = Object.keys(interventions);
  const resolvedLabels: string[] = [];
  let unresolvedCount = 0;
  for (const fid of factorIds) {
    const label = ctx.entities.nodes.get(fid)?.label;
    if (label) {
      resolvedLabels.push(label);
    } else {
      unresolvedCount++;
    }
  }

  let effectsPhrase: string;
  if (resolvedLabels.length === 0) {
    // Every factor id was unresolvable — fall back to a generic phrasing.
    effectsPhrase = `${factorIds.length} ${factorIds.length === 1 ? 'factor' : 'factors'}`;
  } else {
    const visibleLabels = resolvedLabels.slice(0, 3);
    const joined =
      visibleLabels.length === 1
        ? visibleLabels[0]
        : visibleLabels.length === 2
          ? `${visibleLabels[0]} and ${visibleLabels[1]}`
          : `${visibleLabels.slice(0, -1).join(', ')}, and ${visibleLabels[visibleLabels.length - 1]}`;
    // Append "and N other(s)" only when there are unresolved or trimmed extras
    // we deliberately did not name. Keep the sentence in plain English.
    const overflow = (resolvedLabels.length - visibleLabels.length) + unresolvedCount;
    effectsPhrase = overflow > 0
      ? `${joined} and ${overflow} other${overflow === 1 ? '' : 's'}`
      : joined;
  }

  return {
    blocks: [],
    assistantText: `**${existingOption.label}**'s effects on ${effectsPhrase} would be updated.`,
    guidance_items: [],
    operations,
    ...(analysisReady ? { analysis_ready: analysisReady } : {}),
  };
}
