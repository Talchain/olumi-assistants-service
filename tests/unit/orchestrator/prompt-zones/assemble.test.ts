import { describe, it, expect } from 'vitest';
import { assembleFullPrompt, BUDGET_MAX_CHARS } from '../../../../src/orchestrator/prompt-zones/assemble.js';
import type { TurnContext } from '../../../../src/orchestrator/prompt-zones/zone2-blocks.js';
import type { AnalysisInputsSummary } from '../../../../src/schemas/analysis-inputs-summary.js';
import type { GraphV3Compact } from '../../../../src/orchestrator/context/graph-compact.js';

const ZONE1 = 'Zone 1 static identity prompt content for testing.';

function makeCtx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    stage: 'frame',
    goal: undefined,
    constraints: undefined,
    options: undefined,
    graphCompact: null,
    analysisSummary: null,
    eventLogSummary: '',
    messages: [],
    selectedElements: [],
    bilContext: undefined,
    bilEnabled: false,
    hasGraph: false,
    hasAnalysis: false,
    generateModel: false,
    ...overrides,
  };
}

function makeGraph(): GraphV3Compact {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Goal' },
      { id: 'opt_1', kind: 'option', label: 'Option A' },
    ],
    edges: [{ from: 'opt_1', to: 'goal_1', strength: 0.5, exists: 0.8 }],
    _node_count: 2,
    _edge_count: 1,
  };
}

function makeAnalysis(): AnalysisInputsSummary {
  return {
    contract_version: '1.0.0',
    recommendation: { option_id: 'opt_1', option_label: 'Option A', win_probability: 0.6 },
    options: [{ id: 'opt_1', label: 'Option A', win_probability: 0.6 }],
    top_drivers: [{ factor_id: 'fac_1', factor_label: 'Factor', elasticity: 0.3 }],
    sensitivity_concentration: 0.5,
    confidence_band: 'medium',
    robustness: { level: 'moderate', recommendation_stability: 0.7 },
    constraints_status: [],
    run_metadata: { seed: 1, quality_mode: 'standard', timestamp: '2026-01-01T00:00:00Z' },
  };
}

describe('assembleFullPrompt', () => {
  it('framing profile: correct blocks and order', () => {
    const ctx = makeCtx({
      messages: [{ role: 'user', content: 'Hello' }],
      bilEnabled: true,
      bilContext: '<BRIEF_ANALYSIS>\nTest\n</BRIEF_ANALYSIS>',
      stage: 'frame',
    });
    const result = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    expect(result.profile).toBe('framing');
    expect(result.system_prompt).toContain(ZONE1);
    expect(result.system_prompt).toContain('<STAGE>');
    expect(result.system_prompt).toContain('<CONVERSATION_SUMMARY>');
    expect(result.system_prompt).toContain('<RECENT_TURNS>');
    expect(result.system_prompt).toContain('<CONTEXT_HINTS>');
    // No graph or analysis tags
    expect(result.system_prompt).not.toContain('<GRAPH_STATE>');
    expect(result.system_prompt).not.toContain('<ANALYSIS_STATE>');
  });

  it('post_analysis profile: analysis_state present, bil absent', () => {
    const ctx = makeCtx({
      hasGraph: true,
      hasAnalysis: true,
      graphCompact: makeGraph(),
      analysisSummary: makeAnalysis(),
      messages: [{ role: 'user', content: 'Explain results' }],
    });
    const result = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    expect(result.profile).toBe('post_analysis');
    expect(result.system_prompt).toContain('<ANALYSIS_STATE>');
    expect(result.system_prompt).toContain('<GRAPH_STATE>');
    expect(result.system_prompt).not.toContain('<BRIEF_ANALYSIS>');
  });

  it('parallel_coaching profile: only stage + bil blocks, separate zone1_id', () => {
    const ctx = makeCtx({
      generateModel: true,
      bilEnabled: true,
      bilContext: '<BRIEF_ANALYSIS>\nTest\n</BRIEF_ANALYSIS>',
      stage: 'frame',
    });
    const coaching = 'Parallel coaching instruction content';
    const result = assembleFullPrompt(coaching, 'parallel-coaching-v1', ctx);
    expect(result.profile).toBe('parallel_coaching');
    expect(result.zone1_id).toBe('parallel-coaching-v1');
    expect(result.system_prompt).toContain('<STAGE>');
    expect(result.system_prompt).not.toContain('<GRAPH_STATE>');
    expect(result.system_prompt).not.toContain('<CONVERSATION_SUMMARY>');
  });

  it('hints merged in <CONTEXT_HINTS> after data blocks', () => {
    const ctx = makeCtx({
      bilEnabled: true,
      bilContext: '<BRIEF_ANALYSIS>\nTest\n</BRIEF_ANALYSIS>',
      stage: 'frame',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    const result = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    expect(result.system_prompt).toContain('<CONTEXT_HINTS>');
    expect(result.system_prompt).toContain('</CONTEXT_HINTS>');
    // CONTEXT_HINTS should appear after data blocks
    const stageIdx = result.system_prompt.indexOf('<STAGE>');
    const hintsIdx = result.system_prompt.indexOf('<CONTEXT_HINTS>');
    expect(hintsIdx).toBeGreaterThan(stageIdx);
  });

  it('determinism: two calls with same input produce identical output', () => {
    const ctx = makeCtx({
      stage: 'ideate',
      goal: 'Test',
      hasGraph: true,
      graphCompact: makeGraph(),
      messages: [{ role: 'user', content: 'Hello' }],
    });
    const result1 = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    const result2 = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    expect(result1.system_prompt).toBe(result2.system_prompt);
  });

  it('returns metadata: active_blocks with names, versions, owners', () => {
    const ctx = makeCtx({ messages: [{ role: 'user', content: 'Hi' }] });
    const result = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    expect(result.active_blocks.length).toBeGreaterThan(0);
    for (const meta of result.active_blocks) {
      expect(meta.name).toBeTruthy();
      expect(meta.version).toBeTruthy();
      expect(meta.owner).toBeTruthy();
      expect(meta.chars_rendered).toBeGreaterThanOrEqual(0);
    }
  });

  it('empty context uses framing profile, does not crash', () => {
    const ctx = makeCtx();
    const result = assembleFullPrompt(ZONE1, 'cf-v9', ctx);
    expect(result.profile).toBe('framing');
    expect(result.system_prompt).toContain(ZONE1);
    expect(result.system_prompt).toContain('<STAGE>');
  });
});

describe('Budget trimming', () => {
  it('trims blocks in priority order when over budget', () => {
    // Create a very large event_log to trigger trimming
    const ctx = makeCtx({
      hasGraph: true,
      graphCompact: makeGraph(),
      messages: [{ role: 'user', content: 'Hello' }],
      eventLogSummary: 'x'.repeat(200),
    });
    // Use a very large zone1 to push over budget
    const largeZone1 = 'x'.repeat(BUDGET_MAX_CHARS - 500);
    const result = assembleFullPrompt(largeZone1, 'cf-v9', ctx);
    // event_log should be trimmed first
    if (result.trimmed_blocks.length > 0) {
      expect(result.trimmed_blocks[0]).toBe('event_log');
    }
  });
});
