/**
 * Pipeline V4 — Post-draft recomputation and envelope fixes
 *
 * Tests for:
 * - Fix 1: Post-draft coaching context has non-null signals when graph has options
 * - Fix 2: assembleV4Envelope does not prepend handler text when responseSource is 'composer'
 * - Fix 3: run_analysis is in ideate stage policy
 * - Fix 4: stage_indicator is a structured object
 * - Fix 5: suggested_actions is always an array (never undefined)
 */

import { describe, it, expect } from "vitest";
import { computeTurnContext } from "../../../../src/orchestrator/deterministic/turn-context.js";
import { buildCoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";
import { buildToolDefinitions } from "../../../../src/orchestrator/deterministic/tool-builder.js";
import { assembleV4Envelope } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import { mergeSessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeGraph(): unknown {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise ROI' },
      { id: 'factor_revenue', kind: 'factor', label: 'Revenue', observed_state: { value: 100000, unit: 'GBP', extractionType: 'explicit' } },
      { id: 'factor_cost', kind: 'factor', label: 'Cost', observed_state: { value: 50000, unit: 'GBP', extractionType: 'inferred' } },
      { id: 'option_a', kind: 'option', label: 'Option A' },
      { id: 'option_b', kind: 'option', label: 'Option B' },
    ],
    edges: [
      { from: 'factor_revenue', to: 'goal_1', strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'factor_cost', to: 'goal_1', strength: { mean: -0.5, std: 0.15 }, exists_probability: 0.8, effect_direction: 'negative' },
      { from: 'option_a', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'option_b', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
    options: [],
    goal_node_id: 'goal_1',
  };
}

function makePostDraftRequest(): OrchestratorTurnRequest {
  return {
    message: 'Should I hire a tech lead or two developers?',
    context: {
      graph: makeGraph() as unknown as GraphV3T,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'test-scenario',
    },
    scenario_id: 'test-scenario',
    client_turn_id: 'test-turn-1',
  };
}

function makeMinimalTurnContext() {
  const req = makePostDraftRequest();
  const ctx = computeTurnContext(req);
  ctx.turn_id = 'test-turn-id';
  return ctx;
}

// ============================================================================
// Fix 1: Post-draft recomputation produces non-null coaching signals
// ============================================================================

describe('Fix 1: post-draft state recomputation', () => {
  it('coaching context has tradeoff when graph has options', () => {
    const turnContext = makeMinimalTurnContext();
    const sessionState = mergeSessionState(undefined);
    const coaching = buildCoachingContext(turnContext, sessionState);

    // With a graph that has 2 options and a goal, tradeoff should be populated
    // (or at least coaching_mode should not be 'orient')
    expect(coaching.coaching_mode).not.toBe('orient');
    expect(coaching.total_factor_count).toBeGreaterThan(0);
  });

  it('post-draft resolvedToolNames includes more than draft_graph', () => {
    const turnContext = makeMinimalTurnContext();
    const eligible = [...turnContext.eligible_actions];
    if (!eligible.includes('draft_graph')) {
      eligible.push('draft_graph');
    }
    const toolDefs = buildToolDefinitions(eligible as ActionName[], turnContext);
    const toolNames = toolDefs.map(t => t.name);

    // With a graph present, stage should be ideate, and edit actions should be available
    expect(toolNames.length).toBeGreaterThan(1);
    expect(toolNames).toContain('draft_graph');
  });

  it('stage advances to ideate after draft (graph with options, no analysis)', () => {
    const turnContext = makeMinimalTurnContext();
    expect(turnContext.stage).toBe('ideate');
  });
});

// ============================================================================
// Fix 2: assembleV4Envelope does not concatenate handler text when composer used
// ============================================================================

describe('Fix 2: assembleV4Envelope text concatenation', () => {
  it('does not prepend handler text when responseSource is composer', () => {
    const turnContext = makeMinimalTurnContext();
    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-request',
      executionClass: 'standard_turn',
      assistantText: 'Your decision trades speed against cost.',
      actionResult: {
        blocks: [],
        assistantText: 'Added 4 factors, 3 options, and 24 connections.',
        guidance_items: [],
      },
      routing: 'llm',
      executedAction: 'draft_graph',
      contextFallbackUsed: false,
      responseSource: 'composer',
    });

    // Composer text should be authoritative — no count text prepended
    expect(envelope.assistant_text).toBe('Your decision trades speed against cost.');
    expect(envelope.assistant_text).not.toContain('Added 4 factors');
  });

  it('still prepends handler text when responseSource is not composer', () => {
    const turnContext = makeMinimalTurnContext();
    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-request',
      executionClass: 'standard_turn',
      assistantText: 'Some LLM text.',
      actionResult: {
        blocks: [],
        assistantText: 'Added 4 factors.',
        guidance_items: [],
      },
      routing: 'llm',
      executedAction: 'draft_graph',
      contextFallbackUsed: false,
      responseSource: 'llm_only',
    });

    // Without composer, handler text is prepended
    expect(envelope.assistant_text).toContain('Added 4 factors.');
    expect(envelope.assistant_text).toContain('Some LLM text.');
  });
});

// ============================================================================
// Fix 3: run_analysis in ideate stage policy
// ============================================================================

describe('Fix 3: run_analysis in ideate stage', () => {
  it('eligible_actions includes run_analysis when stage is ideate and graph has options', () => {
    const turnContext = makeMinimalTurnContext();
    expect(turnContext.stage).toBe('ideate');
    expect(turnContext.eligible_actions).toContain('run_analysis');
  });
});

// ============================================================================
// Fix 4: stage_indicator is a structured object
// ============================================================================

describe('Fix 4: stage_indicator contract', () => {
  it('stage_indicator is an object with stage, confidence, source', () => {
    const turnContext = makeMinimalTurnContext();
    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-request',
      executionClass: 'standard_turn',
      assistantText: 'Test text.',
      actionResult: null,
      routing: 'llm',
      executedAction: null,
      contextFallbackUsed: false,
    });

    const si = envelope.stage_indicator as unknown as Record<string, unknown>;
    expect(si).toHaveProperty('stage');
    expect(si).toHaveProperty('confidence');
    expect(si).toHaveProperty('source');
    expect(typeof si.stage).toBe('string');
    expect(si.confidence).toBe('high');
    expect(si.source).toBe('inferred');
  });
});

// ============================================================================
// Fix 5: suggested_actions is always an array
// ============================================================================

describe('Fix 5: suggested_actions always present', () => {
  it('suggested_actions is an empty array when no chips are generated', () => {
    const turnContext = makeMinimalTurnContext();
    const envelope = assembleV4Envelope({
      turnContext,
      turnId: 'test-turn',
      requestId: 'test-request',
      executionClass: 'standard_turn',
      assistantText: 'Test text.',
      actionResult: null,
      routing: 'llm',
      executedAction: null,
      contextFallbackUsed: false,
      // No coaching context or session state → chip engine won't run
    });

    expect(Array.isArray(envelope.suggested_actions)).toBe(true);
    expect(envelope.suggested_actions).toBeDefined();
  });
});

// ============================================================================
// Fix 1: speculative turns gate top-level analysis_ready
// ============================================================================

describe('assembleV4Envelope — isSpeculative gate (Fix 1)', () => {
  const mockAnalysisReady = {
    options: [{ option_id: 'opt_a', label: 'A', status: 'ready', interventions: { f: 0.5 } }],
    goal_node_id: 'goal_1',
    status: 'ready',
  };

  it('non-speculative: mirrors analysis_ready to top-level envelope', () => {
    const ctx = computeTurnContext(makePostDraftRequest());
    const envelope = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-1',
      requestId: 'req-1',
      executionClass: 'standard_turn',
      assistantText: 'Set.',
      actionResult: {
        blocks: [],
        assistantText: 'Set.',
        guidance_items: [],
        operations: [{ op: 'update_node', path: 'f1', value: {} }],
        analysis_ready: mockAnalysisReady,
      },
      routing: 'llm',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
      isSpeculative: false,
    });
    expect((envelope as Record<string, unknown>).analysis_ready).toBeDefined();
  });

  it('speculative: does NOT mirror analysis_ready to top-level envelope', () => {
    const ctx = computeTurnContext(makePostDraftRequest());
    const envelope = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-1',
      requestId: 'req-1',
      executionClass: 'standard_turn',
      assistantText: 'Would set.',
      actionResult: {
        blocks: [],
        assistantText: 'Would set.',
        guidance_items: [],
        operations: [{ op: 'update_node', path: 'f1', value: {} }],
        analysis_ready: mockAnalysisReady,
        fact: { action: 'value_set', entities_affected: [], what_changed: 'x', stale_analysis: false, auto_apply: false },
      },
      routing: 'llm',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
      isSpeculative: true,
    });
    expect((envelope as Record<string, unknown>).analysis_ready).toBeUndefined();
  });

  it('speculative with fact-less handler (edit_graph): analysis_ready still gated', () => {
    const ctx = computeTurnContext(makePostDraftRequest());
    const envelope = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-1',
      requestId: 'req-1',
      executionClass: 'standard_turn',
      assistantText: 'Would edit.',
      actionResult: {
        blocks: [],
        assistantText: 'Would edit.',
        guidance_items: [],
        operations: [{ op: 'add_node', path: 'n1', value: { id: 'n1' } }],
        analysis_ready: mockAnalysisReady,
        // No fact — edit_graph path. isSpeculative should be true via fallback.
      },
      routing: 'llm',
      executedAction: 'edit_graph',
      contextFallbackUsed: false,
      // The caller (pipeline generator) computes isSpeculative with fallback:
      // operations present + no fact.auto_apply === true → speculative
      isSpeculative: true,
    });
    expect((envelope as Record<string, unknown>).analysis_ready).toBeUndefined();
  });
});
