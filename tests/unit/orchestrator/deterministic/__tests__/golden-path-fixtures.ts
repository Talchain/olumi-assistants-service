/**
 * Golden Path Test Fixtures
 *
 * Realistic graph, analysis, and Anthropic tool-use response fixtures
 * for the v4 pipeline integration test. Based on the hiring scenario.
 */

import type { GraphV3T } from "../../../../../src/schemas/cee-v3.js";
import type { OrchestratorTurnRequest } from "../../../../../src/orchestrator/types.js";
import type { ChatWithToolsStreamEvent } from "../../../../../src/adapters/llm/types.js";

// ============================================================================
// Graph fixture (10 nodes, 3 options, hiring scenario)
// ============================================================================

function edge(from: string, to: string, mean: number): Record<string, unknown> {
  return {
    from, to,
    strength: { mean, std: 0.1 },
    exists_probability: 1.0,
    effect_direction: mean >= 0 ? 'positive' : 'negative',
  };
}

export function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue Growth Strategy' },
      { id: 'fac_market_size', kind: 'factor', label: 'Market Size', observed_state: { value: 500, unit: 'million' } },
      { id: 'fac_team_capacity', kind: 'factor', label: 'Team Capacity', observed_state: { value: 0.7, unit: '%' } },
      { id: 'fac_cost', kind: 'factor', label: 'Implementation Cost', observed_state: { value: 200000, unit: 'GBP' } },
      { id: 'fac_time_to_market', kind: 'factor', label: 'Time to Market', observed_state: { value: 6, unit: 'months' } },
      { id: 'fac_risk_level', kind: 'factor', label: 'Risk Level', observed_state: { value: 0.3 } },
      { id: 'opt_raise_prices', kind: 'option', label: 'Raise Prices', interventions: { fac_market_size: 450, fac_cost: 50000 } },
      { id: 'opt_new_market', kind: 'option', label: 'Enter New Market', interventions: { fac_market_size: 800, fac_cost: 500000, fac_time_to_market: 12 } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status Quo', interventions: { fac_market_size: 500, fac_cost: 0 } },
      { id: 'out_revenue', kind: 'outcome', label: 'Revenue Outcome' },
    ],
    edges: [
      edge('fac_market_size', 'out_revenue', 0.8),
      edge('fac_team_capacity', 'out_revenue', 0.5),
      edge('fac_cost', 'out_revenue', -0.4),
      edge('fac_time_to_market', 'out_revenue', -0.3),
      edge('fac_risk_level', 'out_revenue', -0.2),
      edge('opt_raise_prices', 'fac_market_size', 0.6),
      edge('opt_new_market', 'fac_market_size', 0.7),
      edge('opt_status_quo', 'fac_market_size', 0.3),
    ],
  } as unknown as GraphV3T;
}

// ============================================================================
// Analysis response fixture
// ============================================================================

export function makeAnalysisResponse() {
  return {
    analysis_status: 'completed',
    meta: {
      response_hash: 'analysis-hash-001',
      seed_used: 42,
      n_samples: 1000,
    },
    results: [
      {
        option_id: 'opt_raise_prices',
        option_label: 'Raise Prices',
        overall_score: 0.72,
        rank: 1,
      },
      {
        option_id: 'opt_new_market',
        option_label: 'Enter New Market',
        overall_score: 0.65,
        rank: 2,
      },
      {
        option_id: 'opt_status_quo',
        option_label: 'Status Quo',
        overall_score: 0.45,
        rank: 3,
      },
    ],
    option_comparison: {
      winner: 'opt_raise_prices',
      winner_label: 'Raise Prices',
      runner_up: 'opt_new_market',
      runner_up_label: 'Enter New Market',
      margin: 0.07,
      robustness: 'moderate',
    },
    factor_sensitivity: [
      { factor_id: 'fac_market_size', factor_label: 'Market Size', influence_percent: 35, confidence_band: 'high' },
      { factor_id: 'fac_cost', factor_label: 'Implementation Cost', influence_percent: 25, confidence_band: 'moderate' },
      { factor_id: 'fac_team_capacity', factor_label: 'Team Capacity', influence_percent: 20, confidence_band: 'moderate' },
      { factor_id: 'fac_time_to_market', factor_label: 'Time to Market', influence_percent: 12, confidence_band: 'low' },
      { factor_id: 'fac_risk_level', factor_label: 'Risk Level', influence_percent: 8, confidence_band: 'low' },
    ],
  };
}

// ============================================================================
// Turn request builder
// ============================================================================

export function buildTestTurnRequest(overrides: Partial<OrchestratorTurnRequest> = {}): OrchestratorTurnRequest {
  return {
    message: 'What are the key factors?',
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: 'frame' },
      messages: [],
      scenario_id: 'golden-path-test',
    },
    scenario_id: 'golden-path-test',
    client_turn_id: `turn-${Date.now()}`,
    ...overrides,
  };
}

// ============================================================================
// Anthropic stream response builders
// ============================================================================

/** Text-only response (no tool call). */
export function makeTextStream(text: string): ChatWithToolsStreamEvent[] {
  const chunks = text.match(/.{1,40}/g) ?? [text];
  const events: ChatWithToolsStreamEvent[] = chunks.map((chunk) => ({
    type: 'text_delta' as const,
    delta: chunk,
  }));
  events.push({
    type: 'message_complete' as const,
    result: {
      content: [{ type: 'text' as const, text }],
      stop_reason: 'end_turn',
      model: 'claude-sonnet-4-6',
      latencyMs: 300,
      usage: {},
    },
  } as ChatWithToolsStreamEvent);
  return events;
}

/** Tool-use response (LLM calls a tool). Text optional. */
export function makeToolUseStream(
  toolName: string,
  toolInput: Record<string, unknown>,
  assistantText = '',
): ChatWithToolsStreamEvent[] {
  const events: ChatWithToolsStreamEvent[] = [];

  if (assistantText) {
    events.push({ type: 'text_delta' as const, delta: assistantText });
  }

  events.push(
    { type: 'tool_input_start' as const, tool_id: 'toolu_1', tool_name: toolName } as ChatWithToolsStreamEvent,
    { type: 'tool_input_complete' as const, tool_id: 'toolu_1', tool_name: toolName, input: toolInput } as ChatWithToolsStreamEvent,
  );

  const content: Array<Record<string, unknown>> = [];
  if (assistantText) {
    content.push({ type: 'text', text: assistantText });
  }
  content.push({ type: 'tool_use', id: 'toolu_1', name: toolName, input: toolInput });

  events.push({
    type: 'message_complete' as const,
    result: {
      content,
      stop_reason: 'tool_use',
      model: 'claude-sonnet-4-6',
      latencyMs: 400,
      usage: {},
    },
  } as ChatWithToolsStreamEvent);

  return events;
}

// ============================================================================
// Analysis inputs fixture (required by run_analysis handler)
// ============================================================================

export function makeAnalysisInputs() {
  return {
    options: [
      { option_id: 'opt_raise_prices', label: 'Raise Prices', interventions: { fac_market_size: 450, fac_cost: 50000 } },
      { option_id: 'opt_new_market', label: 'Enter New Market', interventions: { fac_market_size: 800, fac_cost: 500000, fac_time_to_market: 12 } },
      { option_id: 'opt_status_quo', label: 'Status Quo', interventions: { fac_market_size: 500, fac_cost: 0 } },
    ],
  };
}

// ============================================================================
// Entity ID leak regex (same as patch-summary.ts ENTITY_ID_LEAK_RE)
// ============================================================================

export const ENTITY_ID_RE = /\b(?:fac_|opt_|dec_|goal_|out_|risk_|con_|factor_|option_|decision_|outcome_|constraint_)\w+/;

// ============================================================================
// Internal jargon patterns (should not appear in user-facing text)
// ============================================================================

export const JARGON_PATTERNS = [
  /\bnode\b/i,
  /\bedge\b/i,
  /\bpatch\b/i,
  /\boperation\b/i,
  /\binterventions?\b/i,
  /\benvelope\b/i,
  /\bturn_id\b/i,
  /\bblock_type\b/i,
];
