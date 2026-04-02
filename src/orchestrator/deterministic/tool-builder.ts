/**
 * Tool Definition Builder
 *
 * Converts eligible actions from the ACTION_CATALOGUE into Anthropic
 * ToolDefinition objects for native tool calling. Each action's input_schema
 * is the single source of truth.
 *
 * Context-aware filtering (v31):
 * - Data-availability: suppresses tools the LLM cannot use productively
 * - Entity disambiguation: removes target_id tools when ambiguous labels exist
 * - Dynamic descriptions: enriches tool descriptions with actual model state
 */

import type { ToolDefinition } from "../../adapters/llm/types.js";
import type { ActionName } from "./actions/types.js";
import type { DeterministicTurnContext } from "./types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";

// ============================================================================
// Constants
// ============================================================================

/** Actions excluded from tool definitions (stubs or non-LLM-callable). */
const EXCLUDED_ACTIONS: ReadonlySet<ActionName> = new Set(['generate_artefact']);

/** Actions that require analysis data to be useful. */
const ANALYSIS_REQUIRED_ACTIONS: ReadonlySet<ActionName> = new Set([
  'explain_result',
  'compare_options',
  'what_would_flip',
]);

/** Graph-editing actions that require a non-empty graph. */
const GRAPH_EDIT_ACTIONS: ReadonlySet<ActionName> = new Set([
  'set_factor_value',
  'add_factor',
  'add_option',
  'add_constraint',
  'adjust_edge_strength',
  'remove_factor',
  'set_goal_target',
]);

/** Stop words excluded from entity ambiguity detection. */
const AMBIGUITY_STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'or', 'of', 'a', 'an', 'in', 'on', 'to', 'for', 'by',
  'is', 'at', 'it', 'its', 'per', 'vs', 'with', 'from', 'as', 'into',
  'rate', 'cost', 'time', 'total', 'value', 'factor', 'score', 'level',
  'high', 'low', 'new', 'old', 'net', 'max', 'min', 'avg', 'mean',
]);

// ============================================================================
// Public API
// ============================================================================

/**
 * Build Anthropic tool definitions from the action catalogue.
 *
 * Only includes actions in `eligibleActions` that have a valid input_schema
 * and are not in the exclusion list.
 *
 * When `ctx` is provided, applies data-availability filtering, entity
 * disambiguation, and dynamic description enrichment.
 */
export function buildToolDefinitions(
  eligibleActions: ActionName[],
  ctx?: DeterministicTurnContext,
): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  const excluded = ctx ? computeContextExclusions(ctx) : new Set<ActionName>();
  const ambiguousTargetIds = ctx ? detectAmbiguousEntities(ctx) : false;

  for (const name of eligibleActions) {
    if (EXCLUDED_ACTIONS.has(name)) continue;
    if (excluded.has(name)) continue;

    const action = ACTION_CATALOGUE.get(name);
    if (!action) continue;

    // Entity disambiguation: remove tools with target_id when ambiguous
    if (ambiguousTargetIds && hasTargetIdParam(action.input_schema)) continue;

    // Dynamic description enrichment
    const description = ctx
      ? enrichDescription(name, action.description, ctx)
      : action.description;

    definitions.push({
      name: action.action_type,
      description,
      input_schema: action.input_schema,
    });
  }

  return definitions;
}

// ============================================================================
// Context-Aware Filtering (Task 1)
// ============================================================================

/**
 * Compute which actions to exclude based on data availability in TurnContext.
 */
function computeContextExclusions(ctx: DeterministicTurnContext): Set<ActionName> {
  const excluded = new Set<ActionName>();
  const hasGraph = !!ctx.graph && ctx.graph_summary.node_count > 0;
  const hasAnalysis = !!ctx.analysis_summary;

  // No analysis data → suppress analysis-dependent tools
  if (!hasAnalysis) {
    for (const action of ANALYSIS_REQUIRED_ACTIONS) {
      excluded.add(action);
    }
  }

  // Analysis exists and is current → suppress run_analysis
  // NOTE: No explicit staleness signal exists on DeterministicTurnContext yet.
  // When one is added (e.g. ctx.analysis_stale or ctx.analysis.staleness_reason),
  // use it here: only exclude run_analysis when analysis is confirmed fresh.
  // For now, we do NOT exclude run_analysis when analysis exists — erring on
  // the side of keeping the tool available.

  // No graph or empty graph → suppress edit tools and run_analysis
  if (!hasGraph) {
    for (const action of GRAPH_EDIT_ACTIONS) {
      excluded.add(action);
    }
    excluded.add('run_analysis');
  }

  return excluded;
}

// ============================================================================
// Entity Disambiguation (Task 2)
// ============================================================================

/**
 * Detect whether entity labels create target_id ambiguity for the LLM.
 *
 * Two-tier detection:
 * 1. Message-level: `ctx.disambiguation_hints` (computed from the user's
 *    actual message in turn-context.ts) — strongest signal.
 * 2. Label-level: global scan for same-kind entities sharing significant
 *    non-stop-word terms. Only compares entities within the same `kind`
 *    (e.g. two factors sharing "churn" is ambiguous; a factor and an option
 *    sharing "growth" is not — the LLM can distinguish by type).
 *
 * Either tier triggering means the LLM may pick the wrong entity,
 * so target_id tools are suppressed to force natural-language clarification.
 */
function detectAmbiguousEntities(ctx: DeterministicTurnContext): boolean {
  // Tier 1: message-level disambiguation hints from turn-context
  if (ctx.disambiguation_hints.length > 0) return true;

  // Tier 2: same-kind label collision
  // Group labels by entity kind
  const labelsByKind = new Map<string, string[]>();
  for (const entity of ctx.entities.nodes.values()) {
    const existing = labelsByKind.get(entity.kind);
    if (existing) {
      existing.push(entity.label);
    } else {
      labelsByKind.set(entity.kind, [entity.label]);
    }
  }

  for (const labels of labelsByKind.values()) {
    if (labels.length < 2) continue;

    const wordCounts = new Map<string, number>();
    for (const label of labels) {
      const words = new Set(
        label.toLowerCase().split(/\s+/).filter(w => w.length > 1 && !AMBIGUITY_STOP_WORDS.has(w)),
      );
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }

    for (const count of wordCounts.values()) {
      if (count >= 2) return true;
    }
  }

  return false;
}

/**
 * Check whether an action's input_schema has a `target_id` parameter.
 */
function hasTargetIdParam(schema: Record<string, unknown>): boolean {
  const props = schema.properties as Record<string, unknown> | undefined;
  return !!props && 'target_id' in props;
}

// ============================================================================
// Dynamic Description Enrichment (Task 4)
// ============================================================================

/**
 * Enrich a tool description with actual model state when available.
 * Falls back to the static description when data is missing.
 */
function enrichDescription(
  name: ActionName,
  staticDesc: string,
  ctx: DeterministicTurnContext,
): string {
  const summary = ctx.analysis_summary;
  if (!summary) return staticDesc;

  switch (name) {
    case 'explain_result': {
      if (!summary.winner || summary.winner_probability == null) return staticDesc;
      const drivers = summary.top_drivers.slice(0, 3)
        .map(d => `${d.label} (${d.sensitivity.toFixed(1)})`)
        .join(', ');
      const driverSuffix = drivers ? ` Top drivers: ${drivers}.` : '';
      const pct = Math.round(summary.winner_probability * 100);
      return `Explain why ${summary.winner} leads at ${pct}%.${driverSuffix}`;
    }

    case 'compare_options': {
      const optionCount = ctx.graph_summary.option_count;
      if (!summary.winner || summary.winner_probability == null || optionCount < 2) return staticDesc;
      const pct = Math.round(summary.winner_probability * 100);
      return `Compare ${optionCount} options. Current leader: ${summary.winner} at ${pct}%.`;
    }

    case 'what_would_flip': {
      if (!summary.winner || summary.winner_probability == null) return staticDesc;
      if (summary.runner_up && summary.runner_up_probability != null) {
        const winnerPct = Math.round(summary.winner_probability * 100);
        const runnerPct = Math.round(summary.runner_up_probability * 100);
        return `Show what changes would flip the winner from ${summary.winner} (${winnerPct}%) to ${summary.runner_up} (${runnerPct}%).`;
      }
      return staticDesc;
    }

    case 'set_factor_value': {
      // List factors still using default values (capped to avoid bloated descriptions)
      const defaults: string[] = [];
      for (const entity of ctx.entities.nodes.values()) {
        if (entity.kind === 'factor' && entity.value == null) {
          defaults.push(entity.label);
        }
      }
      if (defaults.length > 0) {
        const MAX_DEFAULT_LABELS = 5;
        const shown = defaults.slice(0, MAX_DEFAULT_LABELS);
        const suffix = defaults.length > MAX_DEFAULT_LABELS
          ? ` (+${defaults.length - MAX_DEFAULT_LABELS} more)`
          : '';
        return `${staticDesc} Factors with default values: ${shown.join(', ')}${suffix}.`;
      }
      return staticDesc;
    }

    default:
      return staticDesc;
  }
}
