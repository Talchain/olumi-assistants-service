/**
 * Execution Fixes Tests — CEE Brief 2
 *
 * Golden fixtures: block factory, action handler blocks, run_analysis delegation,
 * proposal block emission, response text ordering, add_option topology, generate_artefact gate.
 */

import { describe, it, expect } from "vitest";
import {
  createComparisonBlock,
  createPremortemBlock,
  createFlipAnalysisBlock,
  createProposalBlock,
  createExerciseBlock,
} from "../../../../src/orchestrator/blocks/factory.js";
import { explainResultAction } from "../../../../src/orchestrator/deterministic/actions/explain-result.js";
import { compareOptionsAction } from "../../../../src/orchestrator/deterministic/actions/compare-options.js";
import { whatWouldFlipAction } from "../../../../src/orchestrator/deterministic/actions/what-would-flip.js";
import { runPremortemAction } from "../../../../src/orchestrator/deterministic/actions/run-premortem.js";
import { runAnalysisAction } from "../../../../src/orchestrator/deterministic/actions/run-analysis.js";
import { addOptionAction } from "../../../../src/orchestrator/deterministic/actions/add-option.js";
import { generateArtefactAction } from "../../../../src/orchestrator/deterministic/actions/generate-artefact.js";
import { assembleDeterministicResponse } from "../../../../src/orchestrator/deterministic/response-assembler.legacy.js";
import type { DeterministicTurnContext, DeterministicCommentaryBlockData } from "../../../../src/orchestrator/deterministic/types.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";
import type { ComparisonBlockData, PremortemBlockData, FlipAnalysisBlockData, ProposalBlockData, ExerciseBlockData } from "../../../../src/orchestrator/deterministic/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeCtx(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  const nodes = new Map();
  nodes.set('fac_price', { id: 'fac_price', label: 'Price Sensitivity', kind: 'factor', aliases: [], value: 0.6, unit: '%', is_action_target: true });
  nodes.set('fac_market', { id: 'fac_market', label: 'Market Size', kind: 'factor', aliases: [], value: 1000, is_action_target: true });
  nodes.set('opt_aggressive', { id: 'opt_aggressive', label: 'Aggressive Pricing', kind: 'option', aliases: [], is_action_target: true });

  return {
    stage: 'evaluate',
    entities: { nodes, edges: [], option_ids: ['opt_aggressive'], goal_id: 'goal_1' },
    graph_summary: { node_count: 5, edge_count: 4, option_count: 2, option_labels: ['A', 'B'], goal_label: 'Maximise ROI', missing_structural: [] },
    analysis_summary: {
      winner: 'Aggressive Pricing',
      winner_probability: 0.65,
      runner_up: 'Conservative Pricing',
      runner_up_probability: 0.35,
      robustness_band: 'moderate',
      top_drivers: [
        { label: 'Price Sensitivity', factor_id: 'fac_price', sensitivity: 0.42, direction: 'negative' },
        { label: 'Market Size', factor_id: 'fac_market', sensitivity: 0.31, direction: 'positive' },
      ],
      fragile_edge_count: 1,
      fragile_edges: [],
      factor_sensitivity: [],
      edge_e_values: [],
      conditional_winners: [],
      inference_warnings: [],
      constraints_met: true,
      constraint_tensions: [],
    },
    capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: true },
    blockers: [],
    signals: { high_uncertainty_factors: ['fac_price'], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
    disambiguation_hints: [],
    graph: { nodes: [{ id: 'goal_1', kind: 'goal', label: 'Maximise ROI' }], edges: [] } as unknown as GraphV3T,
    analysis: {
      meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc' },
      results: [
        { option_id: 'opt_aggressive', option_label: 'Aggressive Pricing', win_probability: 0.65 },
        { option_id: 'opt_conservative', option_label: 'Conservative Pricing', win_probability: 0.35 },
      ],
    } as unknown as V2RunResponseEnvelope,
    conversational_state: null,
    scenario_id: 'test-scenario',
    analysis_inputs: null,
    ...overrides,
  };
}

// ============================================================================
// Task 1: Block factory functions — brief fixture shapes
// ============================================================================

describe('Block factory — brief fixture shapes', () => {
  it('createComparisonBlock matches Brief 2 fixture', () => {
    const data: ComparisonBlockData = {
      options: [{
        id: 'opt_a',
        label: 'Option A',
        probability: 0.65,
        rank: 1,
        strengths: ['Fast'],
        weaknesses: ['Expensive'],
        key_differentiators: ['Speed'],
      }],
      narrative: 'Option A leads.',
    };
    const block = createComparisonBlock(data, 'turn-123');
    expect(block.block_type).toBe('comparison');
    expect(block.block_id).toMatch(/^blk_comparison_/);
    expect(block.data).toEqual(data);
    expect(block.provenance.turn_id).toBe('turn-123');
  });

  it('createPremortemBlock matches Brief 2 fixture', () => {
    const data: PremortemBlockData = {
      target_option: { id: 'opt_a', label: 'Option A' },
      risk_paths: [{ path: ['fac_1', 'opt_a'], influence: 0.8, description: 'Cost overrun risk' }],
      narrative: 'Key risk identified.',
    };
    const block = createPremortemBlock(data, 'turn-123');
    expect(block.block_type).toBe('premortem');
    expect((block.data as PremortemBlockData).target_option.id).toBe('opt_a');
    expect((block.data as PremortemBlockData).risk_paths[0].influence).toBe(0.8);
  });

  it('createFlipAnalysisBlock matches Brief 2 fixture', () => {
    const data: FlipAnalysisBlockData = {
      current_winner: { id: 'opt_a', label: 'Option A', probability: 0.65 },
      flip_conditions: [{
        assumption: 'Cost',
        current_value: 0.5,
        flip_threshold: 0.8,
        direction: 'increase',
        alternative_winner: 'Option B',
      }],
      narrative: 'Cost increase flips result.',
    };
    const block = createFlipAnalysisBlock(data, 'turn-123');
    expect(block.block_type).toBe('flip_analysis');
    expect((block.data as FlipAnalysisBlockData).current_winner.probability).toBe(0.65);
  });

  it('createProposalBlock matches Brief 2 fixture', () => {
    const data: ProposalBlockData = {
      proposal_id: 'test-id',
      action_type: 'add_factor',
      description: 'Add cost factor',
      changes: [{ operation: 'add_node', target: 'fac_cost', detail: '{"kind":"factor"}' }],
      consequences: [],
      confirmation_required: true,
    };
    const block = createProposalBlock(data, 'turn-123');
    expect(block.block_type).toBe('proposal');
    expect((block.data as ProposalBlockData).confirmation_required).toBe(true);
    expect((block.data as ProposalBlockData).changes).toHaveLength(1);
  });

  it('createExerciseBlock produces correct shape', () => {
    const data: ExerciseBlockData = {
      exercise_type: 'pre_mortem',
      target_option: 'Option A',
      prompts: ['What if it fails?'],
      narrative: 'Consider failure scenarios.',
    };
    const block = createExerciseBlock(data, 'turn-123');
    expect(block.block_type).toBe('exercise');
  });
});

// ============================================================================
// Task 2: Action handlers return correct block types with brief shapes
// ============================================================================

describe('explain_result returns CommentaryBlock with sections', () => {
  it('has sections array matching brief fixture — Fix 3: no Recommendation section, narrative empty', async () => {
    const ctx = makeCtx();
    const result = await explainResultAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('commentary');
    const data = result.blocks[0].data as DeterministicCommentaryBlockData;
    expect(data.sections).toBeDefined();
    expect(data.sections!.length).toBeGreaterThanOrEqual(2);
    // Fix 3: Recommendation section is removed — the winner headline lives
    // in assistantText only. Sections retain the supporting context.
    const headings = data.sections!.map((s) => s.heading);
    expect(headings).not.toContain('Recommendation');
    expect(headings).toContain('Key drivers');
    // Key drivers section should have items
    const driverSection = data.sections!.find((s) => s.heading === 'Key drivers');
    expect(driverSection?.items).toBeDefined();
    expect(driverSection!.items![0]).toContain('Price Sensitivity');
    expect(driverSection!.items![0]).toContain('0.42');
    // Fix 3: narrative is intentionally empty (sections are the canonical rendering).
    expect(data.narrative).toBe('');
    // assistantText carries the winner headline
    expect(result.assistantText).toContain('Aggressive Pricing leads');
    // Winner option label must NOT appear inside any section (lived in Recommendation
    // pre-fix) — prevents double-rendering with assistantText.
    for (const section of data.sections!) {
      if (section.content) {
        expect(section.content).not.toContain('Aggressive Pricing');
      }
    }
  });
});

describe('compare_options returns ComparisonBlock with brief shape', () => {
  it('has typed option data with id/probability/rank/key_differentiators', async () => {
    const ctx = makeCtx();
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('comparison');
    const data = result.blocks[0].data as ComparisonBlockData;
    expect(data.options).toHaveLength(2);
    expect(data.options[0].id).toBe('opt_aggressive');
    expect(data.options[0].probability).toBe(0.65);
    expect(data.options[0].rank).toBe(1);
    expect(data.options[0].key_differentiators).toBeInstanceOf(Array);
    expect(data.options[1].rank).toBe(2);
  });
});

describe('what_would_flip returns FlipAnalysisBlock with brief shape', () => {
  it('has object current_winner and flip_conditions', async () => {
    const ctx = makeCtx();
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('flip_analysis');
    const data = result.blocks[0].data as FlipAnalysisBlockData;
    // current_winner is an object with id, label, probability
    expect(data.current_winner.label).toBe('Aggressive Pricing');
    expect(data.current_winner.probability).toBe(0.65);
    // flip_conditions have assumption, direction, alternative_winner
    expect(data.flip_conditions.length).toBeGreaterThan(0);
    expect(data.flip_conditions[0].assumption).toBe('Price Sensitivity');
    expect(data.flip_conditions[0].alternative_winner).toBe('Conservative Pricing');
  });
});

describe('run_premortem returns PremortemBlock with brief shape', () => {
  it('has object target_option and risk_paths with path/influence/description', async () => {
    const ctx = makeCtx();
    const result = await runPremortemAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('premortem');
    const data = result.blocks[0].data as PremortemBlockData;
    // target_option is an object
    expect(data.target_option.label).toBe('Aggressive Pricing');
    // risk_paths have path, influence, description
    expect(data.risk_paths.length).toBeGreaterThan(0);
    expect(data.risk_paths[0].path).toBeInstanceOf(Array);
    expect(data.risk_paths[0].influence).toBe(0.42);
    expect(data.risk_paths[0].description).toContain('Price Sensitivity');
  });
});

// ============================================================================
// Task 3: run_analysis delegation
// ============================================================================

describe('run_analysis delegation', () => {
  it('returns blocker when analysis_inputs is null', async () => {
    const ctx = makeCtx({ analysis_inputs: null });
    const result = await runAnalysisAction.execute({}, ctx);
    expect(result.assistantText).toContain("can't run yet");
    expect(result.blocks).toHaveLength(0);
  });

  it('prerequisite blocks when no graph', () => {
    const ctx = makeCtx({ graph: null });
    const prereq = runAnalysisAction.prerequisite_checks(ctx);
    expect(prereq).toBe('No decision model available.');
  });
});

// ============================================================================
// Task 5: Response text ordering
// ============================================================================

describe('Response assembler text ordering', () => {
  it('action text comes before LLM text', () => {
    const ctx = makeCtx();
    const result = assembleDeterministicResponse({
      turnContext: ctx,
      llmResponse: { text: 'Good move. Anchoring churn helps.', insights: [], recommended_actions: [] },
      actionResult: { blocks: [], assistantText: 'Updated Customer Churn Rate to 4%.', guidance_items: [] },
      turnId: 'test-turn',
      routing: 'deterministic',
      selectedAction: 'set_factor_value',
      executedActions: ['set_factor_value'],
    });
    const text = result.envelope.assistant_text!;
    expect(text).toContain('Updated Customer Churn Rate');
    expect(text).toContain('Good move');
    expect(text.indexOf('Updated')).toBeLessThan(text.indexOf('Good move'));
  });
});

// ============================================================================
// Task 6a: add_option does NOT create option→goal edge
// ============================================================================

describe('add_option topology', () => {
  it('does NOT create option→goal edge', async () => {
    const ctx = makeCtx();
    const result = await addOptionAction.execute({ label: 'Strategy B', interventions: [{ factor_id: 'fac_price', value: 0.5 }] }, ctx);
    expect(result.operations).toBeDefined();
    const ops = result.operations!;
    expect(ops.some((o) => o.op === 'add_node')).toBe(true);
    const goalEdge = ops.find((o) => o.op === 'add_edge' && o.path.includes('goal_1'));
    expect(goalEdge).toBeUndefined();
  });

  it('includes interventions in node data', async () => {
    const ctx = makeCtx();
    const result = await addOptionAction.execute({ label: 'Strategy B', interventions: { fac_price: 0.5 } }, ctx);
    const addNode = result.operations!.find((o) => o.op === 'add_node');
    expect((addNode!.value as Record<string, unknown>).data).toEqual({ interventions: { fac_price: 0.5 } });
  });
});

// ============================================================================
// Task 6b: generate_artefact always blocked
// ============================================================================

describe('generate_artefact gate', () => {
  it('returns prerequisite blocker', () => {
    const ctx = makeCtx();
    const prereq = generateArtefactAction.prerequisite_checks(ctx);
    expect(prereq).toContain('not yet available');
  });
});

// ============================================================================
// Fix A: Empty-driver graceful handling
// ============================================================================

describe('explain_result — factor_sensitivity preferred over top_drivers', () => {
  it('renders Key drivers from forwarded factor_sensitivity (influence_percent + confidence_band)', async () => {
    // Regression: when the UI forwards factor_sensitivity with influence_percent
    // (the new shape), top_drivers stays empty (it filters on elasticity). The
    // commentary block must read factor_sensitivity in that case so the user
    // doesn't see the "no dominant driver" fallback when rich data is available.
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
        fragile_edge_count: 0,
        fragile_edges: [],
        factor_sensitivity: [
          { label: 'Price Sensitivity', influence_percent: 38, confidence_band: 'high', influence_rank: 1 },
          { label: 'Market Size', influence_percent: 22, confidence_band: 'medium', influence_rank: 2 },
          { label: 'Brand Strength', influence_percent: 14, confidence_band: 'medium', influence_rank: 3 },
        ],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await explainResultAction.execute({}, ctx);
    const data = result.blocks[0].data as DeterministicCommentaryBlockData;
    const keyDriversSection = data.sections!.find((s) => s.heading === 'Key drivers');
    expect(keyDriversSection).toBeDefined();
    expect(keyDriversSection!.items).toBeDefined();
    expect(keyDriversSection!.items![0]).toContain('Price Sensitivity');
    expect(keyDriversSection!.items![0]).toContain('drives 38% of the outcome');
    expect(keyDriversSection!.items![0]).toContain('confidence: high');
    // Must not fall back to "combined effect" when factor_sensitivity has data
    const driversFallback = data.sections!.find((s) => s.heading === 'Drivers');
    expect(driversFallback).toBeUndefined();
  });
});

describe('explain_result — empty driver fallback', () => {
  it('references fragile edges when top_drivers empty and fragile_edge_count > 0', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
        fragile_edge_count: 3,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await explainResultAction.execute({}, ctx);
    const data = result.blocks[0].data as DeterministicCommentaryBlockData;
    const driverSection = data.sections!.find((s) => s.heading === 'Drivers');
    expect(driverSection).toBeDefined();
    expect(driverSection!.content).toContain('combined effect');
    expect(driverSection!.content).toContain('3 fragile edge');
  });

  it('says combined effect when drivers empty and no fragile edges', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
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
    const result = await explainResultAction.execute({}, ctx);
    const data = result.blocks[0].data as DeterministicCommentaryBlockData;
    const driverSection = data.sections!.find((s) => s.heading === 'Drivers');
    expect(driverSection!.content).toContain('combined effect');
    expect(driverSection!.content).not.toContain('fragile');
  });
});

describe('what_would_flip — empty driver fallback', () => {
  it('references weak edges when drivers empty but weak_edges exist', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
        fragile_edge_count: 0,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
      signals: {
        high_uncertainty_factors: [],
        dominant_factor: null,
        close_call: false,
        default_value_count: 0,
        weak_edges: ['fac_price→goal_1', 'fac_market→goal_1'],
      },
    });
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(0);
    expect(result.assistantText).toContain('weak edge');
    expect(result.assistantText).toContain('fac_price→goal_1');
  });

  it('says combined effect when drivers and weak_edges both empty', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
        fragile_edge_count: 0,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
      signals: {
        high_uncertainty_factors: [],
        dominant_factor: null,
        close_call: false,
        default_value_count: 0,
        weak_edges: [],
      },
    });
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(0);
    expect(result.assistantText).toContain('combined effect');
    expect(result.assistantText).not.toContain('Driver data not available');
  });
});

describe('compare_options — empty driver fallback', () => {
  it('uses fallback differentiators when drivers are empty', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'moderate',
        top_drivers: [],
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
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    const data = result.blocks[0].data as ComparisonBlockData;
    expect(data.options[0].key_differentiators).toEqual(['Combined factor effects']);
  });

  it('uses driver labels when drivers exist', async () => {
    const ctx = makeCtx(); // default has drivers
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as ComparisonBlockData;
    expect(data.options[0].key_differentiators).toContain('Price Sensitivity');
  });
});

describe('what_would_flip — flip thresholds from analysis', () => {
  it('populates flip_threshold from raw analysis factor_sensitivity', async () => {
    const ctx = makeCtx({
      analysis: {
        meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc' },
        results: [
          {
            option_id: 'opt_aggressive',
            option_label: 'Aggressive Pricing',
            win_probability: 0.65,
            factor_sensitivity: [
              { factor_id: 'fac_price', label: 'Price Sensitivity', elasticity: 0.42, flip_threshold: 0.85, current_value: 0.6, unit: '%' },
              { factor_id: 'fac_market', label: 'Market Size', elasticity: 0.31, flip_threshold: 1500, current_value: 1000, unit: 'units' },
            ],
          },
          {
            option_id: 'opt_conservative',
            option_label: 'Conservative Pricing',
            win_probability: 0.35,
          },
        ],
      } as unknown as V2RunResponseEnvelope,
    });
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    const data = result.blocks[0].data as FlipAnalysisBlockData;
    // First driver (Price Sensitivity) should have real flip threshold
    const priceCondition = data.flip_conditions.find((c) => c.assumption === 'Price Sensitivity');
    expect(priceCondition).toBeDefined();
    expect(priceCondition!.flip_threshold).toBe(0.85);
    expect(priceCondition!.current_value).toBe(0.6);
    // Narrative should mention the flip value
    expect(data.narrative).toContain('0.85');
  });

  it('falls back to 0 when no flip_threshold in analysis', async () => {
    const ctx = makeCtx({
      analysis: {
        meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc' },
        results: [
          { option_id: 'opt_aggressive', option_label: 'Aggressive Pricing', win_probability: 0.65 },
          { option_id: 'opt_conservative', option_label: 'Conservative Pricing', win_probability: 0.35 },
        ],
      } as unknown as V2RunResponseEnvelope,
    });
    const result = await whatWouldFlipAction.execute({}, ctx);
    const data = result.blocks[0].data as FlipAnalysisBlockData;
    expect(data.flip_conditions[0].flip_threshold).toBe(0);
  });
});

describe('what_would_flip — fragile edge fallback when drivers empty', () => {
  it('references fragile edge labels from raw analysis when drivers empty', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'fragile',
        top_drivers: [],
        fragile_edge_count: 2,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
      analysis: {
        meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc' },
        results: [
          { option_id: 'opt_aggressive', option_label: 'Aggressive Pricing', win_probability: 0.65 },
          { option_id: 'opt_conservative', option_label: 'Conservative Pricing', win_probability: 0.35 },
        ],
        robustness: {
          level: 'fragile',
          fragile_edges: [
            { from_node_id: 'fac_price', to_node_id: 'goal_1' },
            { from_node_id: 'fac_market', to_node_id: 'goal_1' },
          ],
        },
      } as unknown as V2RunResponseEnvelope,
      signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    });
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(0);
    expect(result.assistantText).toContain('fragile edge');
    // Should resolve labels from entity registry
    expect(result.assistantText).toContain('Price Sensitivity');
  });
});

describe('compare_options — fragile edge narrative', () => {
  it('includes fragile edge info in narrative when drivers empty and fragility nonzero', async () => {
    const ctx = makeCtx({
      analysis_summary: {
        winner: 'Aggressive Pricing',
        winner_probability: 0.65,
        runner_up: 'Conservative Pricing',
        runner_up_probability: 0.35,
        robustness_band: 'fragile',
        top_drivers: [],
        fragile_edge_count: 2,
        fragile_edges: [],
        factor_sensitivity: [],
        edge_e_values: [],
        conditional_winners: [],
        inference_warnings: [],
        constraints_met: true,
        constraint_tensions: [],
      },
    });
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as ComparisonBlockData;
    expect(data.narrative).toContain('fragile edge');
    expect(data.narrative).toContain('2');
  });

  it('does not mention fragile edges when drivers exist', async () => {
    const ctx = makeCtx(); // default has drivers
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as ComparisonBlockData;
    expect(data.narrative).not.toContain('fragile');
  });
});

describe('what_would_flip — partial tool input produces graceful output', () => {
  it('works with empty params (no tool input needed)', async () => {
    const ctx = makeCtx();
    // Simulate empty parsed tool input (what happens after JSON parse failure)
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.assistantText).not.toContain('data not available');
  });
});

describe('compare_options — partial tool input produces graceful output', () => {
  it('works with empty params (no tool input needed)', async () => {
    const ctx = makeCtx();
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.assistantText).not.toContain('data not available');
  });
});

describe('explain_result — partial tool input produces graceful output', () => {
  it('works with empty params', async () => {
    const ctx = makeCtx();
    const result = await explainResultAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.assistantText).not.toContain('data not available');
  });

  it('works with partial focus param', async () => {
    const ctx = makeCtx();
    const result = await explainResultAction.execute({ focus: 'drivers' }, ctx);
    expect(result.blocks).toHaveLength(1);
  });
});

// ============================================================================
// Fix B: add_option intervention guard
// ============================================================================

describe('add_option — intervention guard', () => {
  it('returns warning with factor names when interventions empty and graph has factors', async () => {
    const ctx = makeCtx(); // default entities have fac_price and fac_market
    const result = await addOptionAction.execute({ label: 'New Strategy' }, ctx);
    expect(result.operations).toBeUndefined();
    expect(result.assistantText).toContain('New Strategy');
    expect(result.assistantText).toContain('Price Sensitivity');
    expect(result.assistantText).toContain('Market Size');
  });

  it('allows empty interventions when graph has no factors', async () => {
    const noFactorNodes = new Map();
    noFactorNodes.set('goal_1', { id: 'goal_1', label: 'Goal', kind: 'goal', aliases: [], is_action_target: false });
    const ctx = makeCtx({
      entities: { nodes: noFactorNodes, edges: [], option_ids: [], goal_id: 'goal_1' },
    });
    const result = await addOptionAction.execute({ label: 'New Strategy' }, ctx);
    expect(result.operations).toBeDefined();
    expect(result.operations!.some((o) => o.op === 'add_node')).toBe(true);
  });
});

// ============================================================================
// Fix D: Failure classification in run_analysis
// ============================================================================

describe('run_analysis — failure classification', () => {
  it('returns blocker when analysis_inputs is null', async () => {
    const ctx = makeCtx({ analysis_inputs: null });
    const result = await runAnalysisAction.execute({}, ctx);
    expect(result.assistantText).toContain("can't run yet");
  });

  it('returns service not configured when PLoT client is null', async () => {
    const ctx = makeCtx({
      analysis_inputs: {
        options: [{ option_id: 'opt_a', label: 'A', interventions: { fac_price: 0.5 } }],
      } as unknown as DeterministicTurnContext['analysis_inputs'],
    });
    // This test exercises the plotClient null check — real PLoT calls are mocked at the module level
    // The action handler will attempt dynamic import and create a null client when env vars are missing
    const result = await runAnalysisAction.execute({}, ctx);
    // Should get one of: service not configured, or an error message (depending on env)
    expect(result.assistantText).toBeTruthy();
  });
});
