/**
 * Pipeline-level integration test: chip-tool availability contract.
 *
 * Guarantees that every chip in the final envelope maps to a tool that
 * is present in the resolved tool definitions. This is the top-level
 * contract that prevents "That action isn't available right now" failures.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: { pipelineV4Enabled: true, deterministicOrchestratorEnabled: true },
    llm: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
    promptCache: { anthropicEnabled: true },
    cee: {
      coachingContextEnabled: true,
      chipEngineEnabled: true,
    },
  },
  shouldUseStagingPrompts: () => false,
}));

vi.mock("../../../../src/orchestrator/context/context-hash.js", () => ({
  computeContextHash: () => 'abc123',
}));

vi.mock("../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: () => [],
}));

import { assembleV4Envelope } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import { buildToolDefinitions } from "../../../../src/orchestrator/deterministic/tool-builder.js";
import { chipActionToTool, getMappedActionTypes } from "../../../../src/orchestrator/deterministic/action-tool-mapping.js";
import { ACTION_NAMES } from "../../../../src/orchestrator/deterministic/actions/types.js";
import type { DeterministicTurnContext, AnalysisSummary } from "../../../../src/orchestrator/deterministic/types.js";
import type { CoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";
import { defaultSessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

function makeAnalysisSummary(): AnalysisSummary {
  return {
    winner: 'option_a',
    winner_probability: 0.65,
    runner_up: 'option_b',
    runner_up_probability: 0.35,
    robustness_band: 'fragile',
    top_drivers: [
      { label: 'Cost', factor_id: 'f_cost', sensitivity: 0.42, is_ai_estimated: true, confidence_band: 'medium' },
    ],
    fragile_edge_count: 1,
    fragile_edges: [],
    factor_sensitivity: [],
    edge_e_values: [],
    conditional_winners: [],
    inference_warnings: [],
    constraints_met: true,
    constraint_tensions: [],
  };
}

function makeTurnContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 5, edge_count: 3, option_count: 2, option_labels: ['A', 'B'], goal_label: 'Goal', missing_structural: [] },
    analysis_summary: makeAnalysisSummary(),
    capabilities: {
      can_run_analysis: true,
      can_explain_results: true,
      can_edit_graph: true,
      can_compare_options: true,
      can_challenge: true,
      can_generate_artefact: false,
    },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 3, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [
      'run_analysis', 'explain_result', 'compare_options', 'what_would_flip',
      'challenge_assumption', 'run_premortem', 'set_factor_value', 'adjust_edge_strength', 'add_constraint',
    ],
    disambiguation_hints: [],
    graph: { nodes: [], edges: [] } as unknown as DeterministicTurnContext['graph'],
    analysis: null,
    conversational_state: null,
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    analysis_inputs: null,
    ...overrides,
  };
}

function makeCoaching(overrides: Partial<CoachingContext> = {}): CoachingContext {
  return {
    coaching_mode: 'calibrate',
    primary_move: 'surface_assumption',
    ask_question_now: false,
    challenge_now: false,
    response_posture: 'exploratory',
    headline: null,
    tradeoff: null,
    biggest_inference: null,
    calibration_target: null,
    ai_estimated_count: 0,
    user_provided_count: 0,
    total_factor_count: 5,
    drivers: [
      { factor_label: 'Cost', factor_id: 'f_cost', sensitivity: 0.42, is_ai_estimated: true, confidence_band: 'medium' },
    ],
    top_fragile: null,
    triggered_plays: [],
    cta: null,
    risk_factor_count: 1,
    option_mechanism_overlap: false,
    critical_gap: null,
    prediction_state: 'none',
    chip_inputs: {
      stage: 'evaluate',
      has_analysis: true,
      analysis_fresh: true,
      top_uncalibrated_factor: 'f_cost',
      has_risk_factors: true,
      option_mechanism_overlap: false,
      stability_band: 'fragile',
      dominant_factor_label: null,
    },
    ...overrides,
  } as CoachingContext;
}

describe("chip-tool availability contract (pipeline-level)", () => {
  it("EVALUATE turn with analysis: every chip maps to a tool in the final toolDefs", () => {
    const turnContext = makeTurnContext();
    const eligibleActions = [...turnContext.eligible_actions] as ActionName[];

    // Build tool definitions the same way pipeline-v4 does
    const toolDefs = buildToolDefinitions(eligibleActions, turnContext, false);
    const resolvedToolNames = toolDefs.map(t => t.name);

    // Assemble envelope — this internally calls computeChips with availableTools
    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-req',
      executionClass: 'llm',
      assistantText: 'Here is the analysis breakdown.',
      actionResult: null,
      routing: 'llm',
      executedAction: null,
      contextFallbackUsed: false,
      coachingContext: makeCoaching(),
      sessionState: defaultSessionState(),
      availableTools: resolvedToolNames,
    });

    const chips = envelope.suggested_actions ?? [];
    const toolSet = new Set(resolvedToolNames);

    // Contract: every chip that maps to a tool must reference an available tool
    for (const chip of chips) {
      const tool = chipActionToTool(chip.action_type!);
      if (tool) {
        expect(
          toolSet.has(tool),
          `chip action_type="${chip.action_type}" maps to tool "${tool}" which is NOT in toolDefs: [${resolvedToolNames.join(', ')}]`,
        ).toBe(true);
      }
    }
  });

  it("EVALUATE turn with analysis: explain_result IS in available tools", () => {
    const turnContext = makeTurnContext();
    const eligibleActions = [...turnContext.eligible_actions] as ActionName[];
    const toolDefs = buildToolDefinitions(eligibleActions, turnContext, false);
    const resolvedToolNames = toolDefs.map(t => t.name);

    expect(resolvedToolNames).toContain('explain_result');
    expect(resolvedToolNames).toContain('compare_options');
    expect(resolvedToolNames).toContain('what_would_flip');
  });

  it("EVALUATE turn with analysis: run_analysis is NOT in available tools (staleness suppression)", () => {
    const turnContext = makeTurnContext();
    const eligibleActions = [...turnContext.eligible_actions] as ActionName[];
    const toolDefs = buildToolDefinitions(eligibleActions, turnContext, false);
    const resolvedToolNames = toolDefs.map(t => t.name);

    expect(resolvedToolNames).not.toContain('run_analysis');
  });

  it("EVALUATE turn with stale analysis: run_analysis IS in available tools", () => {
    // Stale analysis = analysis_summary is null (UI clears it on graph edit)
    const turnContext = makeTurnContext({ analysis_summary: null });
    const eligibleActions = [...turnContext.eligible_actions] as ActionName[];
    const toolDefs = buildToolDefinitions(eligibleActions, turnContext, false);
    const resolvedToolNames = toolDefs.map(t => t.name);

    expect(resolvedToolNames).toContain('run_analysis');
  });

  it("chip engine produces what_would_flip chip and it passes availability filter", () => {
    const turnContext = makeTurnContext();
    const eligibleActions = [...turnContext.eligible_actions] as ActionName[];
    const toolDefs = buildToolDefinitions(eligibleActions, turnContext, false);
    const resolvedToolNames = toolDefs.map(t => t.name);

    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-req',
      executionClass: 'llm',
      assistantText: 'Analysis complete.',
      actionResult: null,
      routing: 'llm',
      executedAction: null,
      contextFallbackUsed: false,
      coachingContext: makeCoaching(),
      sessionState: defaultSessionState(),
      availableTools: resolvedToolNames,
    });

    const chips = envelope.suggested_actions ?? [];
    // Fragile stability band should produce what_would_flip chip
    expect(chips.some(c => c.action_type === 'what_would_flip')).toBe(true);
    // And it should be available
    expect(resolvedToolNames).toContain('what_would_flip');
  });
});

describe("action-tool-mapping exhaustiveness", () => {
  it("every key in the mapping is a valid ActionName", () => {
    const validNames = new Set<string>(ACTION_NAMES);
    const mappedTypes = getMappedActionTypes();
    for (const key of mappedTypes) {
      expect(
        validNames.has(key),
        `action-tool-mapping key "${key}" is not a valid ActionName — possible typo or renamed action`,
      ).toBe(true);
    }
  });

  it("every ActionName that appears as a chip action_type has a mapping entry", () => {
    // These are the action_types used by chip factory functions in chip-engine.ts.
    // If a new chip factory is added with a new action_type, add it here.
    const chipActionTypes = [
      'set_factor_value', 'challenge_assumption', 'add_option', 'run_analysis',
      'what_would_flip', 'compare_options', 'run_premortem', 'generate_artefact',
      'explain_result', 'adjust_edge_strength',
    ];
    const mappedTypes = getMappedActionTypes();
    for (const actionType of chipActionTypes) {
      expect(
        mappedTypes.has(actionType),
        `chip action_type "${actionType}" has no entry in action-tool-mapping — chips with this action will bypass availability filtering`,
      ).toBe(true);
    }
  });
});

describe("generate_artefact chip regression", () => {
  it("generate_artefact maps to 'generate_artefact' tool (not generate_brief)", () => {
    expect(chipActionToTool('generate_artefact')).toBe('generate_artefact');
    // generate_brief is not a valid ActionName — must not exist in the mapping
    expect(chipActionToTool('generate_brief')).toBeNull();
  });

  it("'Generate a decision brief' chip is filtered when generate_artefact is not in available tools", () => {
    // generate_artefact is in EXCLUDED_ACTIONS and never in eligible_actions,
    // so the chip engine should filter it out.
    const turnContext = makeTurnContext();
    const eligibleActions = [...turnContext.eligible_actions] as ActionName[];
    const toolDefs = buildToolDefinitions(eligibleActions, turnContext, false);
    const resolvedToolNames = toolDefs.map(t => t.name);

    // generate_artefact should NOT be in the resolved tool names
    expect(resolvedToolNames).not.toContain('generate_artefact');

    // Use a coaching context that would produce a generate_artefact chip
    // (stable result with dominant factor → confidence + flip + brief)
    const stableCoaching = makeCoaching({
      chip_inputs: {
        stage: 'evaluate',
        has_analysis: true,
        analysis_fresh: true,
        top_uncalibrated_factor: null,
        has_risk_factors: true,
        option_mechanism_overlap: false,
        stability_band: 'stable',
        dominant_factor_label: 'Cost',
      },
    });

    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-req',
      executionClass: 'llm',
      assistantText: 'Analysis complete.',
      actionResult: null,
      routing: 'llm',
      executedAction: null,
      contextFallbackUsed: false,
      coachingContext: stableCoaching,
      sessionState: defaultSessionState(),
      availableTools: resolvedToolNames,
    });

    const chips = envelope.suggested_actions ?? [];
    // The "Generate a decision brief" chip must NOT appear since
    // generate_artefact is not in the available tool set.
    expect(chips.some(c => c.action_type === 'generate_artefact')).toBe(false);
  });
});
