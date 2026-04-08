/**
 * Tests for the v2 prompt builder.
 * Verifies static/dynamic split and cacheability.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/prompts/loader.js", () => ({
  loadPrompt: vi.fn().mockResolvedValue({ source: 'default', content: '' }),
}));

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { buildDeterministicPromptV2 } from "../../../../src/orchestrator/deterministic/prompt-builder-v2.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";

function makeTurnContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 3, edge_count: 2, option_count: 2, option_labels: ['A', 'B'], goal_label: 'Success', missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: true, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 3, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['run_analysis', 'set_factor_value'],
    disambiguation_hints: [],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    analysis_inputs: null,
    ...overrides,
  };
}

describe("buildDeterministicPromptV2", () => {
  it("returns static and dynamic blocks", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    expect(result).toHaveProperty('static_block');
    expect(result).toHaveProperty('dynamic_block');
    expect(typeof result.static_block).toBe('string');
    expect(typeof result.dynamic_block).toBe('string');
    expect(result.static_block.length).toBeGreaterThan(100);
    expect(result.dynamic_block.length).toBeGreaterThan(10);
  });

  it("static block is identical across turns with different contexts", async () => {
    const ctx1 = makeTurnContext({ stage: 'frame' });
    const ctx2 = makeTurnContext({ stage: 'evaluate' });

    const result1 = await buildDeterministicPromptV2(ctx1);
    const result2 = await buildDeterministicPromptV2(ctx2);

    expect(result1.static_block).toBe(result2.static_block);
  });

  it("dynamic block varies with stage", async () => {
    const ctx1 = makeTurnContext({ stage: 'frame' });
    const ctx2 = makeTurnContext({ stage: 'evaluate' });

    const result1 = await buildDeterministicPromptV2(ctx1);
    const result2 = await buildDeterministicPromptV2(ctx2);

    expect(result1.dynamic_block).not.toBe(result2.dynamic_block);
  });

  it("static block does not contain action vocabulary", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.static_block).not.toContain('Eligible Actions');
    expect(result.static_block).not.toContain('set_factor_value');
    expect(result.static_block).not.toContain('run_analysis');
  });

  it("static block does not contain JSON response contract", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.static_block).not.toContain('"text":');
    expect(result.static_block).not.toContain('"insights":');
    expect(result.static_block).not.toContain('"recommended_actions":');
    expect(result.static_block).not.toContain('valid JSON');
  });

  it("dynamic block contains graph summary", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('3 nodes');
    expect(result.dynamic_block).toContain('2 edges');
  });

  it("dynamic block includes disambiguation when hints present", async () => {
    const ctx = makeTurnContext({
      disambiguation_hints: [
        { term: 'cost', candidates: [{ id: 'fac_cost_a', label: 'Cost A' }, { id: 'fac_cost_b', label: 'Cost B' }] },
      ],
    });
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('Disambiguation');
    expect(result.dynamic_block).toContain('cost');
    expect(result.dynamic_block).toContain('Cost A');
  });

  it("dynamic block says NOTHING about analysis when analysis_summary is null (staleness contract)", async () => {
    const ctx = makeTurnContext({ analysis_summary: null });
    const result = await buildDeterministicPromptV2(ctx);

    // Per the staleness contract: when analysis_state is absent, the dynamic
    // block must not contradict or pre-empt the prompt's own rules. It says
    // nothing about analysis at all — no "not yet run", no "no results", no
    // "stale". The PMS prompt (v32a+) owns those rules.
    expect(result.dynamic_block).not.toContain('Not yet run');
    expect(result.dynamic_block).not.toContain('No results are available');
    expect(result.dynamic_block).not.toContain('Analysis Results');
    expect(result.dynamic_block).not.toContain('### Key drivers');
    expect(result.dynamic_block).not.toContain('### Fragile relationships');
  });

  it("dynamic block includes analysis results and not no-analysis signal when analysis exists", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        winner: 'Option A',
        winner_probability: 0.65,
        runner_up: 'Option B',
        runner_up_probability: 0.35,
        robustness_band: 'high',
        top_drivers: [{ label: 'Cost', factor_id: 'fac_cost', sensitivity: 0.45, direction: 'positive' }],
        fragile_edge_count: 0,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('**Analysis Results:**');
    expect(result.dynamic_block).toContain('Winner: Option A (65%)');
    expect(result.dynamic_block).not.toContain('Not yet run');
  });

  it("dynamic block renders ### Fragile relationships when fragile edges present", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        winner: 'Option A',
        winner_probability: 0.65,
        runner_up: 'Option B',
        runner_up_probability: 0.35,
        robustness_band: 'fragile',
        top_drivers: [],
        fragile_edge_count: 2,
        fragile_edges: [
          { label: 'Price → Demand', switch_probability: 0.42 },
          { label: 'Cost → Margin', switch_probability: 0.31 },
        ],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('### Fragile relationships');
    expect(result.dynamic_block).toContain('Price → Demand');
    expect(result.dynamic_block).toContain('42%');
    expect(result.dynamic_block).toContain('Cost → Margin');
  });

  it("dynamic block renders ### Key drivers from factor_sensitivity when present", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        winner: 'Option A',
        winner_probability: 0.65,
        runner_up: 'Option B',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
        fragile_edge_count: 0,
        fragile_edges: [],
        factor_sensitivity: [
          { label: 'Demand', influence_percent: 38, confidence_band: 'high', influence_rank: 1 },
          { label: 'Cost', influence_percent: 22, confidence_band: 'medium', influence_rank: 2 },
        ],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('### Key drivers');
    expect(result.dynamic_block).toContain('Demand');
    expect(result.dynamic_block).toContain('influence 38%');
    expect(result.dynamic_block).toContain('confidence: high');
  });

  it("dynamic block renders ### Robustness detail, ### Conditional results, ### Inference warnings when present", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        winner: 'Option A',
        winner_probability: 0.6,
        runner_up: 'Option B',
        runner_up_probability: 0.4,
        robustness_band: 'fragile',
        top_drivers: [],
        fragile_edge_count: 0,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [
          { label: 'Price → Demand', e_value: 1.2, fragile: true },
          { label: 'Cost → Margin', e_value: 1.4, fragile: true },
          { label: 'Brand → Loyalty', e_value: 4.5, fragile: false },
        ],
        conditional_winners: [
          { scenario: 'high churn', winner_label: 'Option B', probability: 0.7 },
        ],
        inference_warnings: ['Extrapolation outside training range for Demand'],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('### Robustness detail');
    expect(result.dynamic_block).toContain('Price → Demand');
    expect(result.dynamic_block).toContain('e-value 1.20');
    expect(result.dynamic_block).toContain('(robust)');
    expect(result.dynamic_block).toContain('### Conditional results');
    expect(result.dynamic_block).toContain('Under high churn: Option B');
    expect(result.dynamic_block).toContain('### Inference warnings');
    expect(result.dynamic_block).toContain('Extrapolation outside training range for Demand');
  });

  it("dynamic block omits no-analysis signal when graph is empty", async () => {
    const ctx = makeTurnContext({
      analysis_summary: null,
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0, option_labels: [], goal_label: null, missing_structural: [] },
    });
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.dynamic_block).toContain('Model: not yet created');
    expect(result.dynamic_block).not.toContain('Not yet run');
  });

  it("static block instructs tool use for structural actions", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    expect(result.static_block).toContain('tool');
  });

  it("static block ends with the runtime tool-use suffix (logging/Task 5)", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    // Suffix is the last content in the static block — appended after either
    // PMS content or STATIC_PROMPT_FALLBACK so the LLM sees an unambiguous
    // "respond in plain text" instruction even with the dead JSON/XML
    // sections still present in cf-v28.
    expect(result.static_block).toContain('native tool calling');
    expect(result.static_block).toContain('No XML envelopes');
    expect(result.static_block.trimEnd().endsWith(']')).toBe(true);
  });

  it("dynamic block does NOT contain the runtime tool-use suffix", async () => {
    const ctx = makeTurnContext();
    const result = await buildDeterministicPromptV2(ctx);

    // The suffix lives in the static (cached) block, never the per-turn dynamic
    // block — putting it in the dynamic block would defeat caching.
    expect(result.dynamic_block).not.toContain('native tool calling');
    expect(result.dynamic_block).not.toContain('Runtime context');
  });
});
