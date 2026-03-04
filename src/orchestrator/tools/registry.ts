/**
 * Tool Registry
 *
 * Returns the 5 LLM-visible tool definitions for the orchestrator.
 * Gate-only tools (run_exercise) are registered in GATE_ONLY_TOOL_NAMES
 * but are NOT in TOOL_DEFINITIONS (invisible to LLM). This ensures:
 * - validateGatePatternsAgainstRegistry() passes (gate names are known)
 * - Prompt-registry alignment test passes (LLM only sees TOOL_DEFINITIONS)
 *
 * Max one long-running tool per turn (draft_graph, run_analysis)
 * + optional lightweight follow-up (explain_results).
 */

import type { OrchestratorToolDefinition, BlockType } from "../types.js";

// ============================================================================
// Tool Definitions (LLM-visible)
// ============================================================================

const TOOL_DEFINITIONS: OrchestratorToolDefinition[] = [
  {
    name: 'draft_graph',
    description: 'Draft a new causal decision graph from the user\'s decision brief. Use when the user wants to create or re-draft their decision model.',
    input_schema: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          description: 'The decision brief describing the decision problem. Minimum 30 characters.',
        },
      },
      required: ['brief'],
    },
    output_block_types: ['graph_patch'] as BlockType[],
    requires: [],
    long_running: true,
  },
  {
    name: 'edit_graph',
    description: 'Edit the existing causal decision graph based on user instructions. Use when the user wants to add, remove, or modify nodes or edges.',
    input_schema: {
      type: 'object',
      properties: {
        edit_description: {
          type: 'string',
          description: 'Natural language description of the edit to make to the graph.',
        },
      },
      required: ['edit_description'],
    },
    output_block_types: ['graph_patch'] as BlockType[],
    requires: ['graph'],
    long_running: false,
  },
  {
    name: 'run_analysis',
    description: 'Run Monte Carlo analysis on the current graph and options. Use when the user wants to analyse, compare options, or see results.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    output_block_types: ['fact', 'review_card'] as BlockType[],
    requires: ['graph', 'analysis_inputs'],
    long_running: true,
  },
  {
    name: 'explain_results',
    description: 'Explain the analysis results in plain language with citations. Use after analysis to help the user understand the findings.',
    input_schema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Optional focus area for the explanation (e.g., "sensitivity", "robustness", "comparison").',
        },
      },
    },
    output_block_types: ['commentary'] as BlockType[],
    requires: ['analysis_response'],
    long_running: false,
  },
  {
    name: 'generate_brief',
    description: 'Generate a decision brief summarising the analysis findings and recommendation. Use when the user wants a brief or summary document.',
    input_schema: {
      type: 'object',
      properties: {},
    },
    output_block_types: ['brief'] as BlockType[],
    requires: ['analysis_response'],
    long_running: false,
  },
];

// ============================================================================
// Registry API
// ============================================================================

/**
 * Get all LLM-visible tool definitions.
 * undo_patch is intentionally excluded — it is a latent LLM-invocable stub with no gate patterns.
 */
export function getToolDefinitions(): OrchestratorToolDefinition[] {
  return TOOL_DEFINITIONS;
}

/**
 * Get a specific tool definition by name.
 * Returns undefined if not found (undo_patch is a latent stub, not in TOOL_DEFINITIONS).
 */
export function getToolDefinition(name: string): OrchestratorToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

/**
 * Check if a tool is long-running (should be the only tool per turn).
 */
export function isLongRunningTool(name: string): boolean {
  return TOOL_DEFINITIONS.find((t) => t.name === name)?.long_running ?? false;
}

/**
 * Get tool names for the Anthropic tools parameter.
 */
export function getToolNames(): string[] {
  return TOOL_DEFINITIONS.map((t) => t.name);
}

/**
 * Gate-only tool names — handled by the intent gate but NOT visible to the LLM.
 * These tools have dispatch handlers but are not in TOOL_DEFINITIONS.
 * validateGatePatternsAgainstRegistry accepts names from either set.
 *
 * undo_patch: removed in v2, handler exists as latent LLM-invocable stub only
 * (no gate patterns). Not listed here because it is not gate-routed.
 */
export const GATE_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'run_exercise',
]);

/**
 * Validate that all tool names referenced by the deterministic intent gate patterns
 * exist in this registry (TOOL_DEFINITIONS or GATE_ONLY_TOOL_NAMES).
 * Called at startup to fail fast on rename drift.
 *
 * Throws if any gate pattern references a tool not in the registry.
 */
export function validateGatePatternsAgainstRegistry(gateToolNames: string[]): void {
  const registryNames = new Set(getToolNames());
  const missing: string[] = [];

  for (const toolName of gateToolNames) {
    if (!registryNames.has(toolName) && !GATE_ONLY_TOOL_NAMES.has(toolName)) {
      missing.push(toolName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Intent gate startup validation failed: the following tool names are referenced by gate patterns but are not in the tool registry: ${missing.join(', ')}. ` +
      `Update the registry or the gate patterns to resolve.`,
    );
  }
}
