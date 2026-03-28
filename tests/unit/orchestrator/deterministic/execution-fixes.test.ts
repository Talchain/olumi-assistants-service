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
import { assembleDeterministicResponse } from "../../../../src/orchestrator/deterministic/response-assembler.js";
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
      constraints_met: true,
      constraint_tensions: [],
    },
    capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: true },
    blockers: [],
    signals: { high_uncertainty_factors: ['fac_price'], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
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
  it('has sections array matching brief fixture', async () => {
    const ctx = makeCtx();
    const result = await explainResultAction.execute({}, ctx);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('commentary');
    const data = result.blocks[0].data as DeterministicCommentaryBlockData;
    expect(data.sections).toBeDefined();
    expect(data.sections!.length).toBeGreaterThanOrEqual(2);
    // Verify section headings
    const headings = data.sections!.map((s) => s.heading);
    expect(headings).toContain('Recommendation');
    // Key drivers section should have items
    const driverSection = data.sections!.find((s) => s.heading === 'Key drivers');
    expect(driverSection?.items).toBeDefined();
    expect(driverSection!.items![0]).toContain('Price Sensitivity');
    expect(driverSection!.items![0]).toContain('0.42');
    // assistantText is a 1-sentence summary
    expect(result.assistantText).toContain('Aggressive Pricing leads');
    expect(result.assistantText!.length).toBeLessThan(data.narrative.length);
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
    const result = await addOptionAction.execute({ label: 'Strategy B' }, ctx);
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
