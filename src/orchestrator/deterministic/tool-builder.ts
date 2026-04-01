/**
 * Tool Definition Builder
 *
 * Converts eligible actions from the ACTION_CATALOGUE into Anthropic
 * ToolDefinition objects for native tool calling. Each action's input_schema
 * is the single source of truth.
 */

import type { ToolDefinition } from "../../adapters/llm/types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";

/** Actions excluded from tool definitions (stubs or non-LLM-callable). */
const EXCLUDED_ACTIONS: ReadonlySet<ActionName> = new Set(['generate_artefact']);

/**
 * Build Anthropic tool definitions from the action catalogue.
 *
 * Only includes actions in `eligibleActions` that have a valid input_schema
 * and are not in the exclusion list.
 */
export function buildToolDefinitions(eligibleActions: ActionName[]): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];

  for (const name of eligibleActions) {
    if (EXCLUDED_ACTIONS.has(name)) continue;

    const action = ACTION_CATALOGUE.get(name);
    if (!action) continue;

    definitions.push({
      name: action.action_type,
      description: action.description,
      input_schema: action.input_schema,
    });
  }

  return definitions;
}
