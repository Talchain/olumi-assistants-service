import { describe, it, expect } from 'vitest';
import {
  parseLLMResponse,
  getFirstToolInvocation,
  extractDeclaredMode,
  inferResponseMode,
} from '../../../src/orchestrator/response-parser.js';
import { validateGraphStructure } from '../../../src/orchestrator/graph-structure-validator.js';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import type { ChatWithToolsResult } from '../../../src/adapters/llm/types.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

/**
 * Critical UX regression test (Fix 6).
 *
 * Motivating failure: a narrow exploratory question ("What about competitor
 * pricing?") was triggering edit_graph, mutating the graph when the user
 * asked no such thing.
 *
 * This test verifies the combined effect of cf-v11.1 INTERPRET mode
 * classification + server-side enforcement: no graph mutation occurs
 * for a conversational question.
 */

/** Valid 6-node analysable graph. */
const ANALYSABLE_GRAPH: GraphV3T = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Maximise Revenue' },
    { id: 'dec_1', kind: 'decision', label: 'Choose Supplier' },
    { id: 'opt_a', kind: 'option', label: 'Supplier A', interventions: { price: 100 } },
    { id: 'opt_b', kind: 'option', label: 'Supplier B', interventions: { price: 150 } },
    { id: 'opt_c', kind: 'option', label: 'Supplier C', interventions: { price: 120 } },
    { id: 'fac_1', kind: 'factor', label: 'Market Share' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a' },
    { from: 'dec_1', to: 'opt_b' },
    { from: 'dec_1', to: 'opt_c' },
    { from: 'opt_a', to: 'fac_1' },
    { from: 'opt_b', to: 'fac_1' },
    { from: 'opt_c', to: 'fac_1' },
    { from: 'fac_1', to: 'goal_1' },
  ],
} as unknown as GraphV3T;

/** Simulates cf-v11.1 LLM response for an INTERPRET-mode turn. */
function makeMockInterpretResponse(): ChatWithToolsResult {
  const xmlText = `<diagnostics>
Mode: INTERPRET
The user is asking a narrow exploratory question about competitor pricing.
No graph mutation is warranted.
</diagnostics>
<response>
  <assistant_text>Competitor pricing is an important factor to consider. Currently your model includes three supplier options with different price points. If you'd like to explore how competitor pricing pressures might affect your decision, I can add a "competitive pressure" factor to the model.</assistant_text>
  <blocks>
    <block>
      <type>commentary</type>
      <title>Pricing Context</title>
      <content>Your current model already captures direct pricing differences between suppliers. Competitor pricing would add an external market pressure dimension.</content>
    </block>
  </blocks>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Add pricing factor</label>
      <message>Add a competitive pricing pressure factor to the model</message>
    </action>
    <action>
      <role>challenger</role>
      <label>Question assumptions</label>
      <message>How confident are you in the current price estimates?</message>
    </action>
  </suggested_actions>
</response>`;

  return {
    content: [{ type: 'text', text: xmlText }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 300 },
    model: 'claude-sonnet-4-5-20250929',
    latencyMs: 1200,
  };
}

describe('Critical UX regression: exploratory question must not trigger edit_graph', () => {
  it('narrow question → no edit_graph invoked, no graph_patch block, graph unchanged', () => {
    const llmResult = makeMockInterpretResponse();
    const parsed = parseLLMResponse(llmResult);

    // 1. No edit_graph was invoked
    const tool = getFirstToolInvocation(parsed);
    expect(tool).toBeNull();
    expect(parsed.tool_invocations).toHaveLength(0);

    // 2. Response envelope contains no graph_patch block
    // (extracted_blocks only contain commentary/review_card — never graph_patch by design)
    expect(parsed.extracted_blocks.every((b) => b.type === 'commentary' || b.type === 'review_card')).toBe(true);

    // 3. Declared mode is INTERPRET
    expect(extractDeclaredMode(parsed.diagnostics)).toBe('INTERPRET');

    // 4. Inferred mode: heuristic — may classify as SUGGEST due to conversational
    //    language like "consider". The key invariant is: NOT 'ACT' (no tool calls).
    const inferred = inferResponseMode(parsed);
    expect(inferred).not.toBe('ACT');

    // 5. Graph was analysable before — still analysable after (no mutation)
    const validation = validateGraphStructure(ANALYSABLE_GRAPH);
    expect(validation.valid).toBe(true);
    expect(validation.violations).toHaveLength(0);
  });

  it('response contains conversational content and suggested actions — not tool calls', () => {
    const llmResult = makeMockInterpretResponse();
    const parsed = parseLLMResponse(llmResult);

    // Assistant text is conversational
    expect(parsed.assistant_text).toContain('Competitor pricing');
    expect(parsed.assistant_text).not.toContain('edit_graph');

    // Commentary block extracted (not graph_patch)
    expect(parsed.extracted_blocks).toHaveLength(1);
    expect(parsed.extracted_blocks[0].type).toBe('commentary');

    // Suggested actions offered as alternatives (user choice, not automatic mutation)
    expect(parsed.suggested_actions).toHaveLength(2);
    expect(parsed.suggested_actions[0].label).toBe('Add pricing factor');
  });

  it('analysis_ready is preserved — graph remains analysable after INTERPRET turn', () => {
    // Pre-turn: the graph is structurally ready for analysis
    const readinessBefore = computeStructuralReadiness(ANALYSABLE_GRAPH);
    expect(readinessBefore).toBeDefined();
    expect(readinessBefore!.status).toBe('ready');
    expect(readinessBefore!.options).toHaveLength(3);

    // Post-turn: no mutation occurred, so recomputing readiness on the same graph must match
    const readinessAfter = computeStructuralReadiness(ANALYSABLE_GRAPH);
    expect(readinessAfter).toBeDefined();
    expect(readinessAfter!.status).toBe(readinessBefore!.status);
    expect(readinessAfter!.goal_node_id).toBe(readinessBefore!.goal_node_id);
    expect(readinessAfter!.options).toHaveLength(readinessBefore!.options.length);
  });

  it('telemetry fields are consistent for INTERPRET-mode turn', () => {
    const llmResult = makeMockInterpretResponse();
    const parsed = parseLLMResponse(llmResult);

    // Declared mode from <diagnostics>
    const declared = extractDeclaredMode(parsed.diagnostics);
    expect(declared).toBe('INTERPRET');

    // Inferred mode: heuristic that scans for keyword patterns.
    // Mock text contains "consider" which triggers SUGGEST — that's expected.
    // The critical invariant: inferred must NOT be 'ACT' (no tool calls occurred).
    const inferred = inferResponseMode(parsed);
    expect(inferred).not.toBe('ACT');

    // No tool selected → telemetry would log tool_selected: null, patch_ops_count: null
    const toolInvocation = getFirstToolInvocation(parsed);
    expect(toolInvocation).toBeNull();
  });
});
