/**
 * Tool Registry
 *
 * Returns the 5 LLM-visible tool definitions for the orchestrator.
 * undo_patch exists as a tool handler but is NOT in the LLM tool registry
 * and is NOT routed deterministically (removed in v2). Handler kept for
 * graceful fallback.
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
 * undo_patch is intentionally excluded — it's deterministic-only.
 */
export function getToolDefinitions(): OrchestratorToolDefinition[] {
  return TOOL_DEFINITIONS;
}

/**
 * Get a specific tool definition by name.
 * Returns undefined if not found (including undo_patch).
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
