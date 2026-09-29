/**
 * Deterministic Context Hashing
 *
 * SHA-256 hash of conversation context for lineage tracking.
 *
 * Ordering rules:
 * - Messages ordered by sequence
 * - Options sorted by option_id
 * - Constraints sorted by constraint_id or derived key (node_id|operator|value|unit)
 * - Selected element IDs sorted bytewise
 *
 * Excludes: timestamps, UI state, panel positions, client_turn_id
 *
 * Output: 32-char hex string
 */

import { createHash } from "node:crypto";
import type { ConversationContext } from "../types.js";

/**
 * Sorted JSON replacer for deterministic serialisation.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((sorted: Record<string, unknown>, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}

/**
 * Derive sort key for a constraint object.
 */
function constraintSortKey(constraint: unknown): string {
  const c = constraint as Record<string, unknown>;
  if (typeof c.constraint_id === 'string') return c.constraint_id;
  // Derive key from fields
  return `${c.node_id ?? ''}|${c.operator ?? ''}|${c.value ?? ''}|${c.unit ?? ''}`;
}

/**
 * Compute deterministic SHA-256 hash of conversation context.
 *
 * @returns 32-char hex string
 */
export function hashContext(context: ConversationContext): string {
  // Build canonical representation
  const canonical: Record<string, unknown> = {
    scenario_id: context.scenario_id,
    stage: context.framing?.stage ?? null,
    goal: context.framing?.goal ?? null,
  };

  // Graph — full stable JSON (sorted keys)
  if (context.graph) {
    canonical.graph = context.graph;
  }

  // Messages — preserve sequence order, include content and role
  canonical.messages = context.messages.map((m) => ({
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls ?? null,
  }));

  // Analysis inputs — sort options by option_id, constraints by derived key
  if (context.analysis_inputs) {
    const inputs = context.analysis_inputs;

    const sortedOptions = [...inputs.options].sort((a, b) =>
      a.option_id.localeCompare(b.option_id),
    );

    const sortedConstraints = inputs.constraints
      ? [...inputs.constraints].sort((a, b) =>
          constraintSortKey(a).localeCompare(constraintSortKey(b)),
        )
      : null;

    canonical.analysis_inputs = {
      options: sortedOptions,
      constraints: sortedConstraints,
      seed: inputs.seed,
      n_samples: inputs.n_samples,
    };
  }

  // Constraints from framing (sorted)
  if (context.framing?.constraints) {
    canonical.framing_constraints = [...context.framing.constraints].sort((a, b) =>
      constraintSortKey(a).localeCompare(constraintSortKey(b)),
    );
  }

  // Selected elements — sorted bytewise
  if (context.selected_elements) {
    canonical.selected_elements = [...context.selected_elements].sort();
  }

  // Analysis response hash (not full response — just presence indicator)
  canonical.has_analysis_response = context.analysis_response !== null;

  // Serialise with sorted keys and hash
  const serialised = JSON.stringify(canonical, sortedReplacer);

  return createHash('sha256')
    .update(serialised)
    .digest('hex')
    .substring(0, 32);
}
