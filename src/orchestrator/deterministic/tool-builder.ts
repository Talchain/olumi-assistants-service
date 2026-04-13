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
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Constants
// ============================================================================

/** Actions excluded from tool definitions (stubs or non-LLM-callable). */
const EXCLUDED_ACTIONS: ReadonlySet<ActionName> = new Set(['generate_artefact']);

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
export const AMBIGUITY_STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'or', 'of', 'a', 'an', 'in', 'on', 'to', 'for', 'by',
  'is', 'at', 'it', 'its', 'per', 'vs', 'with', 'from', 'as', 'into',
  'rate', 'cost', 'time', 'total', 'value', 'factor', 'score', 'level',
  'high', 'low', 'new', 'old', 'net', 'max', 'min', 'avg', 'mean',
  // Generic modelling terms that appear frequently but rarely create real ambiguity
  'growth', 'risk', 'impact', 'change', 'performance',
]);

/**
 * Minimum number of shared non-stop-words between same-kind entities
 * required to trigger target_id tool suppression. A threshold of 2
 * prevents common single-word overlaps (e.g. "revenue") from
 * disabling most edit tools on typical graphs.
 */
const AMBIGUITY_SHARED_WORD_THRESHOLD = 2;

// ============================================================================
// Schema Validation
// ============================================================================

export interface SchemaViolation {
  path: string;
  message: string;
}

/**
 * Recursively validate a JSON Schema object for Anthropic tool compatibility.
 * Returns an array of violations (empty = valid).
 *
 * Rules:
 * - Root must be `type: 'object'`
 * - Every `type: 'object'` node must have `additionalProperties` (false or schema object)
 * - Every `required` entry must reference a key in `properties`
 */
export function validateToolSchema(schema: Record<string, unknown>): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  if (schema.type !== 'object') {
    violations.push({ path: '(root)', message: 'root schema must have type: "object"' });
    return violations;
  }

  walkSchema(schema, '', violations);
  return violations;
}

function walkSchema(
  node: Record<string, unknown>,
  path: string,
  violations: SchemaViolation[],
): void {
  // Validate object-type nodes
  if (node.type === 'object') {
    // Every object must declare additionalProperties: false (strict requirement for Anthropic)
    const ap = node.additionalProperties;
    if (ap !== false) {
      violations.push({
        path: path || '(root)',
        message: `additionalProperties must be exactly false (got ${JSON.stringify(ap)})`,
      });
    }

    // Required entries must exist in properties
    const props = node.properties as Record<string, unknown> | undefined;
    const required = node.required as string[] | undefined;
    if (required && Array.isArray(required) && required.length > 0) {
      if (!props) {
        violations.push({
          path: `${path || '(root)'}`,
          message: `required array present but properties is missing`,
        });
      } else {
        for (const key of required) {
          if (!(key in props)) {
            violations.push({
              path: `${path || '(root)'}.required`,
              message: `required key "${key}" not found in properties`,
            });
          }
        }
      }
    }

    // Recurse into properties
    if (props && typeof props === 'object') {
      for (const [key, value] of Object.entries(props)) {
        if (value && typeof value === 'object') {
          walkSchema(value as Record<string, unknown>, `${path}.properties.${key}`, violations);
        }
      }
    }
  }

  // Recurse into additionalProperties when it's a schema object (not null/boolean)
  if (node.additionalProperties && typeof node.additionalProperties === 'object' && !Array.isArray(node.additionalProperties)) {
    walkSchema(
      node.additionalProperties as Record<string, unknown>,
      `${path}.additionalProperties`,
      violations,
    );
  }

  // Recurse into array items (regardless of current node type)
  const items = node.items as Record<string, unknown> | undefined;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    walkSchema(items as Record<string, unknown>, `${path}.items`, violations);
  }
}

/** Cache: once a schema is validated, skip re-validation on subsequent calls. */
const schemaValidationCache = new Map<string, boolean>();

/** @internal Reset cache — test-only. */
export function _resetSchemaCache(): void {
  schemaValidationCache.clear();
}

function isSchemaValid(name: string, schema: Record<string, unknown>): boolean {
  const cached = schemaValidationCache.get(name);
  if (cached !== undefined) return cached;

  const violations = validateToolSchema(schema);
  if (violations.length > 0) {
    log.warn({ action: name, violations }, 'tool_builder.schema_validation_failed');
    schemaValidationCache.set(name, false);
    return false;
  }

  schemaValidationCache.set(name, true);
  return true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Options for buildToolDefinitions.
 *
 * `bypassStaleness`: narrow chip-click escape hatch for run_analysis — when
 * set, the staleness suppression that filters run_analysis whenever fresh
 * analysis results exist is skipped. The no-graph exclusion still applies.
 *
 * `bypassDisambiguation`: skip the entity-disambiguation filter. Entity
 * disambiguation exists to protect the LLM from picking the wrong target_id
 * when same-kind entity labels overlap. Chips are pre-computed with explicit
 * target_id parameters by the chip engine and do not suffer from LLM target
 * confusion, so chip tool-availability checks can use the broader pre-
 * disambiguation set. Schema validation, context exclusions, and
 * EXCLUDED_ACTIONS still apply.
 */
export interface BuildToolDefinitionsOptions {
  bypassStaleness?: boolean;
  bypassDisambiguation?: boolean;
}

/**
 * Build Anthropic tool definitions from the action catalogue.
 *
 * Only includes actions in `eligibleActions` that have a valid input_schema
 * and are not in the exclusion list.
 *
 * When `ctx` is provided, applies data-availability filtering, entity
 * disambiguation (unless bypassed), and dynamic description enrichment.
 *
 * Accepts a legacy positional `bypassStaleness` boolean for backward
 * compatibility with existing callers, or an options object for the new
 * bypassDisambiguation flag.
 */
export function buildToolDefinitions(
  eligibleActions: ActionName[],
  ctx?: DeterministicTurnContext,
  bypassStalenessOrOptions?: boolean | BuildToolDefinitionsOptions,
): ToolDefinition[] {
  const options: BuildToolDefinitionsOptions =
    typeof bypassStalenessOrOptions === 'boolean'
      ? { bypassStaleness: bypassStalenessOrOptions }
      : (bypassStalenessOrOptions ?? {});
  const definitions: ToolDefinition[] = [];
  const excluded = ctx ? computeContextExclusions(ctx, options.bypassStaleness === true) : new Set<ActionName>();
  const ambiguousTargetIds = ctx && !options.bypassDisambiguation ? detectAmbiguousEntities(ctx) : false;

  for (const name of eligibleActions) {
    if (EXCLUDED_ACTIONS.has(name)) continue;
    if (excluded.has(name)) continue;

    const action = ACTION_CATALOGUE.get(name);
    if (!action) continue;

    // Entity disambiguation: remove tools with target_id when ambiguous
    if (ambiguousTargetIds && hasTargetIdParam(action.input_schema)) continue;

    // Schema validation gate: exclude tools with invalid schemas (cached after first check)
    if (!isSchemaValid(name, action.input_schema)) continue;

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
 *
 * `bypassStaleness` lets a caller (currently only pipeline-v4 for chip clicks)
 * skip the run_analysis-when-fresh-results-exist suppression. The no-graph
 * exclusion is unaffected — that represents a hard precondition, not
 * staleness, and a chip click against missing prerequisites should still
 * downgrade with a clean message.
 */
function computeContextExclusions(
  ctx: DeterministicTurnContext,
  bypassStaleness = false,
): Set<ActionName> {
  const excluded = new Set<ActionName>();
  const hasGraph = !!ctx.graph && ctx.graph_summary.node_count > 0;
  const hasAnalysis = !!ctx.analysis_summary;

  // Analysis exists and is current → suppress run_analysis only.
  //
  // Explanation tools (explain_result, compare_options, what_would_flip) are
  // read-only queries against existing analysis data. They remain available
  // so the LLM can produce structured explanation responses for both typed
  // messages and chip clicks. Previously these were suppressed to force
  // Zone 2 prose, but that broke chip clicks and typed explanation requests.
  //
  // run_analysis is still suppressed to prevent redundant long-running calls.
  // Chip clicks bypass this via `bypassStaleness` so users can re-run explicitly.
  if (hasAnalysis) {
    if (!bypassStaleness) {
      excluded.add('run_analysis');
    }
  }

  // No graph or empty graph → suppress edit tools and run_analysis.
  // This is a hard prerequisite, not staleness, so bypassStaleness does NOT
  // apply here — clicking run_analysis without a graph still downgrades.
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

    // Tokenise each label into non-stop-word sets (trim punctuation from tokens)
    const tokenSets = labels.map((label) =>
      new Set(
        label.toLowerCase().split(/[\s_-]+/)
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length > 1 && !AMBIGUITY_STOP_WORDS.has(w)),
      ),
    );

    // Check each pair of labels for shared non-stop-word count
    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        let shared = 0;
        for (const word of tokenSets[i]) {
          if (tokenSets[j].has(word)) shared++;
        }
        if (shared >= AMBIGUITY_SHARED_WORD_THRESHOLD) return true;
      }
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
