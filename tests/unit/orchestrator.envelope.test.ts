/**
 * Tests for Orchestrator Envelope Assembly
 *
 * Verifies assembleEnvelope():
 * - Transforms inputs into correctly shaped OrchestratorResponseEnvelope
 * - turn_id is a valid UUID
 * - Diagnostics and parse_warnings conditionally included via include_debug
 * - context_hash is deterministic
 * - Server blocks and AI blocks merge correctly
 * - Stage indicator and labels
 * - Lineage construction
 */

import { describe, it, expect } from 'vitest';
import { assembleEnvelope, buildTurnPlan } from '../../src/orchestrator/envelope.js';
import type { EnvelopeInput } from '../../src/orchestrator/envelope.js';
import type { ConversationContext, ConversationBlock } from '../../src/orchestrator/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: { stage: 'frame', goal: '' },
    messages: [],
    scenario_id: 'test-scenario',
    ...overrides,
  } as ConversationContext;
}

function makeServerBlock(blockType: 'fact' | 'graph_patch' = 'fact'): ConversationBlock {
  return {
    block_id: `blk_${blockType}_server_001`,
    block_type: blockType,
    data: blockType === 'fact'
      ? { fact_type: 'test', facts: [] }
      : { patch_type: 'full_draft', operations: [], status: 'proposed' },
    provenance: { trigger: 'tool:run_analysis', turn_id: 'test-turn', timestamp: new Date().toISOString() },
  } as ConversationBlock;
}

function makeAIBlock(blockType: 'commentary' | 'review_card' = 'commentary'): ConversationBlock {
  return {
    block_id: `blk_${blockType}_ai_001`,
    block_type: blockType,
    data: blockType === 'commentary'
      ? { narrative: 'AI commentary', supporting_refs: [] }
      : { card: { tone: 'facilitator', title: 'Review', content: 'Review content' } },
    provenance: { trigger: 'llm:xml', turn_id: 'test-turn', timestamp: new Date().toISOString() },
  } as ConversationBlock;
}

function makeInput(overrides?: Partial<EnvelopeInput>): EnvelopeInput {
  return {
    turnId: 'test-turn-id',
    assistantText: 'Hello from the assistant',
    blocks: [],
    context: makeContext(),
    ...overrides,
  };
}

// ============================================================================
// assembleEnvelope
// ============================================================================

describe('assembleEnvelope', () => {
  it('produces a correctly shaped envelope', () => {
    const envelope = assembleEnvelope(makeInput());

    expect(envelope).toHaveProperty('turn_id');
    expect(envelope).toHaveProperty('assistant_text');
    expect(envelope).toHaveProperty('blocks');
    expect(envelope).toHaveProperty('lineage');
    expect(envelope.lineage).toHaveProperty('context_hash');
  });

  it('turn_id is a valid UUID when not provided', () => {
    const envelope = assembleEnvelope(makeInput({ turnId: undefined }));

    expect(envelope.turn_id).toMatch(UUID_RE);
  });

  it('uses provided turn_id when specified', () => {
    const envelope = assembleEnvelope(makeInput({ turnId: 'custom-turn-123' }));

    expect(envelope.turn_id).toBe('custom-turn-123');
  });

  it('sets assistant_text from input', () => {
    const envelope = assembleEnvelope(makeInput({
      assistantText: 'The analysis suggests...',
    }));

    expect(envelope.assistant_text).toBe('The analysis suggests...');
  });

  it('handles null assistant_text — contract validator injects stage-aware fallback', () => {
    const envelope = assembleEnvelope(makeInput({
      assistantText: null,
    }));

    // Contract validator: null assistant_text + no blocks + no error → fallback injected
    expect(envelope.assistant_text).not.toBeNull();
    expect(typeof envelope.assistant_text).toBe('string');
    expect((envelope.assistant_text as string).length).toBeGreaterThan(0);
  });

  it('handles null assistant_text with error set — no fallback injection', () => {
    const envelope = assembleEnvelope(makeInput({
      assistantText: null,
      error: { code: 'UNKNOWN', message: 'Pipeline failed', recoverable: false },
    }));

    // Contract validator skips fallback when error is set
    expect(envelope.assistant_text).toBeNull();
    expect(envelope.error?.code).toBe('UNKNOWN');
  });

  // ---------- include_debug ----------

  it('excludes diagnostics when includeDebug is false', () => {
    const envelope = assembleEnvelope(makeInput({
      diagnostics: 'Route: explain_results',
      includeDebug: false,
    }));

    expect(envelope.diagnostics).toBeUndefined();
  });

  it('excludes parse_warnings when includeDebug is false', () => {
    const envelope = assembleEnvelope(makeInput({
      parseWarnings: ['Some warning'],
      includeDebug: false,
    }));

    expect(envelope.parse_warnings).toBeUndefined();
  });

  it('excludes diagnostics when includeDebug is not set', () => {
    const envelope = assembleEnvelope(makeInput({
      diagnostics: 'Route: explain_results',
    }));

    expect(envelope.diagnostics).toBeUndefined();
  });

  it('includes diagnostics when includeDebug is true', () => {
    const envelope = assembleEnvelope(makeInput({
      diagnostics: 'Route: explain_results',
      includeDebug: true,
    }));

    expect(envelope.diagnostics).toBe('Route: explain_results');
  });

  it('includes parse_warnings when includeDebug is true', () => {
    const envelope = assembleEnvelope(makeInput({
      parseWarnings: ['Missing field', 'Unknown type'],
      includeDebug: true,
    }));

    expect(envelope.parse_warnings).toEqual(['Missing field', 'Unknown type']);
  });

  it('excludes parse_warnings from debug when array is empty', () => {
    const envelope = assembleEnvelope(makeInput({
      parseWarnings: [],
      includeDebug: true,
    }));

    expect(envelope.parse_warnings).toBeUndefined();
  });

  it('excludes diagnostics from debug when null', () => {
    const envelope = assembleEnvelope(makeInput({
      diagnostics: null,
      includeDebug: true,
    }));

    expect(envelope.diagnostics).toBeUndefined();
  });

  it('adds structured debug summary fields when includeDebug is true', () => {
    const envelope = assembleEnvelope(makeInput({
      assistantText: 'Hello from the assistant',
      blocks: [makeServerBlock('fact'), makeAIBlock('commentary')],
      suggestedActions: [
        { label: 'Explore', prompt: 'Show me more', role: 'facilitator' },
        { label: 'Challenge', prompt: 'Stress test this', role: 'challenger' },
      ],
      diagnostics: 'Route: explain_results',
      parseWarnings: ['Missing field'],
      includeDebug: true,
      debugSummary: {
        stage: 'evaluate',
        response_mode_declared: 'tool',
        response_mode_inferred: 'tool',
        tool_selected: 'run_analysis',
        tool_permitted: true,
      },
    }));

    expect(envelope.diagnostics).toBe('Route: explain_results');
    expect(envelope.parse_warnings).toEqual(['Missing field']);
    expect(envelope.debug).toEqual({
      response_summary: {
        assistant_text_present: true,
        assistant_text_length: 'Hello from the assistant'.length,
        block_count_by_type: { fact: 1, commentary: 1 },
        suggested_action_count: 2,
        error_present: false,
      },
      turn_summary: {
        stage: 'evaluate',
        response_mode_declared: 'tool',
        response_mode_inferred: 'tool',
        tool_selected: 'run_analysis',
        tool_permitted: true,
      },
      fallback_summary: {
        fallback_injected: false,
        fallback_reason: null,
      },
      contract_summary: {
        contract_violations_count: 0,
        contract_violation_codes: [],
      },
    });
  });

  it('reports empty assistant text in debug summary', () => {
    const envelope = assembleEnvelope(makeInput({
      assistantText: '',
      blocks: [makeServerBlock('fact')],
      includeDebug: true,
    }));

    expect(envelope.assistant_text).toBe('');
    expect(envelope.debug?.response_summary.assistant_text_present).toBe(false);
    expect(envelope.debug?.response_summary.assistant_text_length).toBe(0);
    expect(envelope.debug?.response_summary.block_count_by_type).toEqual({ fact: 1 });
    expect(envelope.debug?.response_summary.suggested_action_count).toBe(0);
    expect(envelope.debug?.turn_summary).toEqual({
      stage: null,
      response_mode_declared: null,
      response_mode_inferred: null,
      tool_selected: null,
      tool_permitted: null,
    });
  });

  it('reports fallback and contract summary when fallback is injected', () => {
    const envelope = assembleEnvelope(makeInput({
      assistantText: null,
      blocks: [],
      includeDebug: true,
    }));

    expect(envelope.debug?.fallback_summary).toEqual({
      fallback_injected: true,
      fallback_reason: 'empty_response_fallback',
    });
    expect(envelope.debug?.contract_summary).toEqual({
      contract_violations_count: 1,
      contract_violation_codes: ['empty_response_fallback'],
    });
    expect(envelope.debug?.response_summary.assistant_text_present).toBe(true);
  });

  // ---------- context_hash ----------

  it('context_hash is deterministic (same input → same hash)', () => {
    const context = makeContext({ scenario_id: 'determinism-test' });
    const input1 = makeInput({ context });
    const input2 = makeInput({ context });

    const envelope1 = assembleEnvelope(input1);
    const envelope2 = assembleEnvelope(input2);

    expect(envelope1.lineage.context_hash).toBe(envelope2.lineage.context_hash);
  });

  it('context_hash is a 32-char hex string', () => {
    const envelope = assembleEnvelope(makeInput());

    expect(envelope.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('context_hash changes with different context', () => {
    const envelope1 = assembleEnvelope(makeInput({
      context: makeContext({ scenario_id: 'scenario-a' }),
    }));
    const envelope2 = assembleEnvelope(makeInput({
      context: makeContext({ scenario_id: 'scenario-b' }),
    }));

    expect(envelope1.lineage.context_hash).not.toBe(envelope2.lineage.context_hash);
  });

  // ---------- Block merging ----------

  it('passes blocks array through directly', () => {
    const serverBlock = makeServerBlock('fact');
    const aiBlock = makeAIBlock('commentary');
    // Server blocks first, then AI blocks (ordering enforced by caller)
    const blocks = [serverBlock, aiBlock];

    const envelope = assembleEnvelope(makeInput({ blocks }));

    expect(envelope.blocks).toHaveLength(2);
    expect(envelope.blocks[0].block_id).toBe(serverBlock.block_id);
    expect(envelope.blocks[1].block_id).toBe(aiBlock.block_id);
  });

  it('handles empty blocks array', () => {
    const envelope = assembleEnvelope(makeInput({ blocks: [] }));

    expect(envelope.blocks).toHaveLength(0);
  });

  // ---------- Suggested actions ----------

  it('includes suggested_actions when provided', () => {
    const envelope = assembleEnvelope(makeInput({
      suggestedActions: [
        { label: 'Explore', prompt: 'Show me more', role: 'facilitator' },
      ],
    }));

    expect(envelope.suggested_actions).toHaveLength(1);
    expect(envelope.suggested_actions![0].label).toBe('Explore');
  });

  it('omits suggested_actions when empty', () => {
    const envelope = assembleEnvelope(makeInput({
      suggestedActions: [],
    }));

    expect(envelope.suggested_actions).toBeUndefined();
  });

  // ---------- Stage indicator ----------

  it('sets stage_indicator from context framing', () => {
    const envelope = assembleEnvelope(makeInput({
      context: makeContext({ framing: { stage: 'evaluate' } }),
    }));

    expect(envelope.stage_indicator).toBe('evaluate');
    expect(envelope.stage_label).toBe('Evaluating options');
  });

  it('omits stage_indicator when framing is null', () => {
    const envelope = assembleEnvelope(makeInput({
      context: makeContext({ framing: null }),
    }));

    expect(envelope.stage_indicator).toBeUndefined();
    expect(envelope.stage_label).toBeUndefined();
  });

  // ---------- Turn plan ----------

  it('includes turn_plan when provided', () => {
    const turnPlan = buildTurnPlan('draft_graph', 'llm', true, 1500);

    const envelope = assembleEnvelope(makeInput({ turnPlan }));

    expect(envelope.turn_plan).toBeDefined();
    expect(envelope.turn_plan!.selected_tool).toBe('draft_graph');
    expect(envelope.turn_plan!.routing).toBe('llm');
    expect(envelope.turn_plan!.long_running).toBe(true);
    expect(envelope.turn_plan!.tool_latency_ms).toBe(1500);
  });

  // ---------- Error ----------

  it('includes error when provided', () => {
    const envelope = assembleEnvelope(makeInput({
      error: {
        code: 'LLM_TIMEOUT',
        message: 'Request timed out',
        recoverable: true,
      },
    }));

    expect(envelope.error).toBeDefined();
    expect(envelope.error!.code).toBe('LLM_TIMEOUT');
  });
});

// ============================================================================
// buildTurnPlan
// ============================================================================

describe('buildTurnPlan', () => {
  it('creates a plan with all fields', () => {
    const plan = buildTurnPlan('run_analysis', 'deterministic', true, 2000);

    expect(plan.selected_tool).toBe('run_analysis');
    expect(plan.routing).toBe('deterministic');
    expect(plan.long_running).toBe(true);
    expect(plan.tool_latency_ms).toBe(2000);
  });

  it('omits tool_latency_ms when undefined', () => {
    const plan = buildTurnPlan(null, 'llm', false);

    expect(plan.selected_tool).toBeNull();
    expect(plan.tool_latency_ms).toBeUndefined();
  });
});
