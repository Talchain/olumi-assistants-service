/**
 * Contract Alignment Tests — CEE Brief 1
 *
 * Golden fixtures: Zod schema validation, chip transport, pipeline chip_metadata,
 * TurnContext analysis_inputs, and missing_structural.
 */

import { describe, it, expect } from "vitest";
import { LLMResponseSchema, InsightSchema, RecommendedActionSchema } from "../../../../src/orchestrator/deterministic/llm-response-schema.js";
import { buildChipsFromRecommendations } from "../../../../src/orchestrator/deterministic/chip-assembler.js";
import { computeTurnContext } from "../../../../src/orchestrator/deterministic/turn-context.js";
import type { OrchestratorTurnRequest, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";
import type { DeterministicTurnContext, LLMRecommendedAction } from "../../../../src/orchestrator/deterministic/types.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

// ============================================================================
// Task 1: Zod schema golden fixtures
// ============================================================================

describe('LLM Zod schema — canonical enums', () => {
  it('accepts valid insight with canonical type and severity', () => {
    const input = {
      text: 'The churn rate is your biggest risk.',
      insights: [{
        type: 'assumption_risk',
        description: 'Churn baseline is inferred, not measured.',
        severity: 'warning',
        target_id: 'fac_churn',
      }],
      recommended_actions: [{
        action_type: 'set_factor_value',
        target_id: 'fac_churn',
        value: 0.04,
        priority: 'high',
        rationale: 'Ground the churn assumption.',
      }],
    };

    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insights[0].type).toBe('assumption_risk');
      expect(result.data.insights[0].severity).toBe('warning');
      expect(result.data.recommended_actions[0].action_type).toBe('set_factor_value');
      expect(result.data.recommended_actions[0].priority).toBe('high');
    }
  });

  it('rejects old insight type "observation"', () => {
    const input = {
      text: 'Hello',
      insights: [{ type: 'observation', description: 'test', severity: 'medium' }],
    };

    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects old severity "medium"', () => {
    const input = {
      text: 'Hello',
      insights: [{ type: 'assumption_risk', description: 'test', severity: 'medium' }],
    };

    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects action_type not in ACTION_NAMES', () => {
    const input = {
      text: 'Hello',
      insights: [],
      recommended_actions: [{ action_type: 'invalid_action', priority: 'high' }],
    };

    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects action missing priority', () => {
    const input = {
      text: 'Hello',
      insights: [],
      recommended_actions: [{ action_type: 'run_analysis' }],
    };

    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts all 6 canonical insight types', () => {
    const types = ['bias_detected', 'missing_perspective', 'assumption_risk', 'opportunity', 'calibration_concern', 'structural_gap'] as const;
    for (const type of types) {
      const result = InsightSchema.safeParse({ type, description: 'test', severity: 'info' });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all 3 severity levels', () => {
    const severities = ['info', 'warning', 'important'] as const;
    for (const severity of severities) {
      const result = InsightSchema.safeParse({ type: 'opportunity', description: 'test', severity });
      expect(result.success).toBe(true);
    }
  });

  it('enforces max 3 insights', () => {
    const input = {
      text: 'Hello',
      insights: Array.from({ length: 4 }, () => ({ type: 'opportunity', description: 'x', severity: 'info' })),
      recommended_actions: [],
    };
    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('enforces max 3 recommended_actions', () => {
    const input = {
      text: 'Hello',
      insights: [],
      recommended_actions: Array.from({ length: 4 }, () => ({ action_type: 'run_analysis', priority: 'high' })),
    };
    const result = LLMResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('validates discriminated union per action_type', () => {
    // set_factor_value requires target_id and value
    const valid = RecommendedActionSchema.safeParse({
      action_type: 'set_factor_value',
      target_id: 'fac_churn',
      value: 0.04,
      priority: 'high',
    });
    expect(valid.success).toBe(true);

    // add_constraint requires operator, value, label
    const constraint = RecommendedActionSchema.safeParse({
      action_type: 'add_constraint',
      target_id: 'fac_budget',
      operator: '<=',
      value: 100000,
      label: 'Budget cap',
      priority: 'medium',
    });
    expect(constraint.success).toBe(true);

    // add_factor requires label
    const factor = RecommendedActionSchema.safeParse({
      action_type: 'add_factor',
      label: 'Customer Satisfaction',
      category: 'observable',
      priority: 'low',
    });
    expect(factor.success).toBe(true);
  });
});

// ============================================================================
// Task 2 + 3: Chip assembler — action_type, parameters, scientist role
// ============================================================================

describe('Chip assembler — deterministic transport', () => {
  function makeCtx(eligibleActions: ActionName[]): DeterministicTurnContext {
    return {
      stage: 'evaluate',
      entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
      graph_summary: { node_count: 5, edge_count: 4, option_count: 2, option_labels: [], goal_label: null, missing_structural: [] },
      analysis_summary: null,
      capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: true },
      blockers: [],
      signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
      conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
      eligible_actions: eligibleActions,
      graph: null,
      analysis: null,
      conversational_state: null,
      scenario_id: 'test',
      analysis_inputs: null,
    };
  }

  it('includes action_type and parameters on chips', () => {
    const ctx = makeCtx(['challenge_assumption']);
    const recs: LLMRecommendedAction[] = [{
      action_type: 'challenge_assumption',
      target_id: 'fac_churn',
      priority: 'high',
      rationale: 'Churn is inferred.',
    }];

    const chips = buildChipsFromRecommendations(recs, ctx);
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('challenge_assumption');
    expect(chips[0].parameters).toEqual({ target_id: 'fac_churn' });
    expect(chips[0].role).toBe('challenger');
  });

  it('preserves scientist role (does NOT remap to facilitator)', () => {
    const ctx = makeCtx(['what_would_flip']);
    const recs: LLMRecommendedAction[] = [{
      action_type: 'what_would_flip',
      priority: 'medium',
    }];

    const chips = buildChipsFromRecommendations(recs, ctx);
    expect(chips).toHaveLength(1);
    expect(chips[0].role).toBe('scientist');
  });

  it('extracts typed set_factor_value parameters correctly', () => {
    const ctx = makeCtx(['set_factor_value']);
    const recs: LLMRecommendedAction[] = [{
      action_type: 'set_factor_value',
      target_id: 'fac_churn',
      value: 0.04,
      priority: 'high',
    }];

    const chips = buildChipsFromRecommendations(recs, ctx);
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('set_factor_value');
    expect(chips[0].parameters).toEqual({ target_id: 'fac_churn', value: 0.04 });
  });
});

// ============================================================================
// Task 6: TurnContext — is_action_target, missing_structural, analysis_inputs
// ============================================================================

describe('TurnContext — Task 6 fixes', () => {
  function makeRequest(graph: unknown, analysisInputs?: unknown): OrchestratorTurnRequest {
    return {
      message: 'test',
      context: {
        graph: graph as GraphV3T | null,
        analysis_response: null,
        framing: { stage: 'evaluate' as const },
        messages: [],
        scenario_id: 'test-scenario',
        ...(analysisInputs !== undefined ? { analysis_inputs: analysisInputs } : {}),
      },
      scenario_id: 'test-scenario',
      client_turn_id: 'test-turn',
    };
  }

  it('6a: is_action_target is true for factors, false for decision', () => {
    const graph = {
      nodes: [
        { id: 'fac_churn', kind: 'factor', label: 'Customer Churn Rate', category: 'controllable' },
        { id: 'dec_pricing', kind: 'decision', label: 'Pricing Strategy' },
        { id: 'goal_1', kind: 'goal', label: 'Maximise Revenue' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      edges: [],
    };

    const ctx = computeTurnContext(makeRequest(graph));
    expect(ctx.entities.nodes.get('fac_churn')!.is_action_target).toBe(true);
    expect(ctx.entities.nodes.get('dec_pricing')!.is_action_target).toBe(false);
    expect(ctx.entities.nodes.get('goal_1')!.is_action_target).toBe(true);
    expect(ctx.entities.nodes.get('opt_a')!.is_action_target).toBe(true);
  });

  it('6b: missing_structural returns string[] with specific messages', () => {
    // No goal node
    const graphNoGoal = { nodes: [{ id: 'fac_1', kind: 'factor', label: 'F1' }], edges: [] };
    const ctx1 = computeTurnContext(makeRequest(graphNoGoal));
    expect(ctx1.graph_summary.missing_structural).toContain('no goal node');

    // No graph at all
    const ctx2 = computeTurnContext(makeRequest(null));
    expect(ctx2.graph_summary.missing_structural).toContain('no goal node');
  });

  it('6b: detects option with no path to goal', () => {
    const graph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Goal' },
        { id: 'opt_orphan', kind: 'option', label: 'Orphan Option' },
      ],
      edges: [],
    };

    const ctx = computeTurnContext(makeRequest(graph));
    expect(ctx.graph_summary.missing_structural).toContain('option Orphan Option has no path to goal');
  });

  it('6c: analysis_inputs extracted from context', () => {
    const analysisInputs = {
      options: [{ option_id: 'opt_a', label: 'A', interventions: { fac_1: 0.5 } }],
    };
    const graph = {
      nodes: [{ id: 'goal_1', kind: 'goal', label: 'Goal' }],
      edges: [],
    };

    const ctx = computeTurnContext(makeRequest(graph, analysisInputs));
    expect(ctx.analysis_inputs).not.toBeNull();
    expect(ctx.analysis_inputs!.options).toHaveLength(1);
  });

  it('6c: analysis_inputs is null when not provided', () => {
    const ctx = computeTurnContext(makeRequest(null));
    expect(ctx.analysis_inputs).toBeNull();
  });
});
