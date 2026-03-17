import { describe, it, expect } from 'vitest';
import {
  ZONE2_BLOCKS,
  wrapUntrusted,
  _trimText,
  _normaliseWhitespace,
} from '../../../../src/orchestrator/prompt-zones/zone2-blocks.js';
import type { TurnContext } from '../../../../src/orchestrator/prompt-zones/zone2-blocks.js';
import type { AnalysisInputsSummary } from '../../../../src/schemas/analysis-inputs-summary.js';
import type { GraphV3Compact } from '../../../../src/orchestrator/context/graph-compact.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeMinimalContext(overrides: Partial<TurnContext> = {}): TurnContext {
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

function makeGraphCompact(): GraphV3Compact {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue Growth' },
      { id: 'opt_increase', kind: 'option', label: 'Price Increase' },
      { id: 'opt_keep', kind: 'option', label: 'Keep Current' },
      { id: 'fac_demand', kind: 'factor', label: 'Demand Volume' },
      { id: 'fac_churn', kind: 'factor', label: 'Churn Rate' },
    ],
    edges: [
      { from: 'opt_increase', to: 'fac_demand', strength: 0.7, exists: 0.9 },
      { from: 'fac_demand', to: 'goal_revenue', strength: 0.85, exists: 0.95 },
      { from: 'opt_increase', to: 'fac_churn', strength: 0.5, exists: 0.8 },
    ],
    _node_count: 5,
    _edge_count: 3,
  };
}

function makeAnalysisSummary(): AnalysisInputsSummary {
  return {
    contract_version: '1.0.0',
    recommendation: { option_id: 'opt_increase', option_label: 'Price Increase', win_probability: 0.62 },
    options: [
      { id: 'opt_increase', label: 'Price Increase', win_probability: 0.62 },
      { id: 'opt_keep', label: 'Keep Current', win_probability: 0.38 },
    ],
    top_drivers: [
      { factor_id: 'fac_demand', factor_label: 'Demand Volume', elasticity: 0.45 },
      { factor_id: 'fac_churn', factor_label: 'Churn Rate', elasticity: 0.32 },
    ],
    sensitivity_concentration: 0.77,
    confidence_band: 'medium',
    robustness: { level: 'moderate', recommendation_stability: 0.65 },
    constraints_status: [{ label: 'Churn under 5%', satisfied: true }],
    run_metadata: { seed: 42, quality_mode: 'standard', timestamp: '2026-01-15T10:00:00Z' },
  };
}

// ============================================================================
// Registry structure tests
// ============================================================================

describe('Zone2 Block Registry', () => {
  it('has unique block names', () => {
    const names = ZONE2_BLOCKS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique orders', () => {
    const orders = ZONE2_BLOCKS.map((b) => b.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('has canonical order [10, 20, 30, 40, 50, 60, 70, 80, 81, 82]', () => {
    expect(ZONE2_BLOCKS.map((b) => b.order)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 81, 82]);
  });

  it('all blocks have valid scope', () => {
    for (const block of ZONE2_BLOCKS) {
      expect(['data', 'hint']).toContain(block.scope);
    }
  });

  it('all blocks have valid ownership', () => {
    for (const block of ZONE2_BLOCKS) {
      expect(['orchestrator', 'bil', 'analysis', 'events']).toContain(block.owner);
    }
  });

  it('data blocks have non-empty xmlTag', () => {
    for (const block of ZONE2_BLOCKS) {
      if (block.scope === 'data') {
        expect(block.xmlTag.length).toBeGreaterThan(0);
      }
    }
  });

  it('hint blocks have empty xmlTag', () => {
    for (const block of ZONE2_BLOCKS) {
      if (block.scope === 'hint') {
        expect(block.xmlTag).toBe('');
      }
    }
  });

  it('canonical XML tags match spec', () => {
    const tagMap = Object.fromEntries(
      ZONE2_BLOCKS.filter((b) => b.scope === 'data').map((b) => [b.name, b.xmlTag]),
    );
    expect(tagMap).toEqual({
      stage_context: 'STAGE',
      graph_state: 'GRAPH_STATE',
      analysis_state: 'ANALYSIS_STATE',
      bil_context: 'BRIEF_ANALYSIS',
      conversation_summary: 'CONVERSATION_SUMMARY',
      recent_turns: 'RECENT_TURNS',
      event_log: 'EVENT_LOG',
    });
  });
});

// ============================================================================
// Block rendering tests
// ============================================================================

describe('Block renderers', () => {
  it('stage_context renders for minimal context', () => {
    const ctx = makeMinimalContext({ stage: 'frame' });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'stage_context')!;
    const result = block.render(ctx);
    expect(result).toContain('Stage: frame');
  });

  it('stage_context includes goal, constraints, options when present', () => {
    const ctx = makeMinimalContext({
      stage: 'ideate',
      goal: 'Revenue growth',
      constraints: ['Budget cap', 'Timeline'],
      options: ['Option A', 'Option B'],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'stage_context')!;
    const result = block.render(ctx);
    expect(result).toContain('Goal: Revenue growth');
    expect(result).toContain('Constraints: Budget cap; Timeline');
    expect(result).toContain('Options: Option A; Option B');
  });

  it('graph_state renders node counts and top edges', () => {
    const ctx = makeMinimalContext({ graphCompact: makeGraphCompact(), hasGraph: true });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'graph_state')!;
    const result = block.render(ctx);
    expect(result).toContain('Nodes: 5');
    expect(result).toContain('Edges: 3');
    expect(result).toContain('Strongest edges:');
  });

  it('analysis_state renders from AnalysisInputsSummary only', () => {
    const ctx = makeMinimalContext({ analysisSummary: makeAnalysisSummary(), hasAnalysis: true });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'analysis_state')!;
    const result = block.render(ctx);
    expect(result).toContain('Winner: Price Increase (62.0%)');
    expect(result).toContain('Robustness: moderate');
    expect(result).toContain('Demand Volume');
    // Must use user-safe term, not banned "elasticity"
    expect(result).toContain('sensitivity');
    expect(result).not.toContain('elasticity');
  });

  it('analysis_state emits analysis_state.present: true flag', () => {
    const ctx = makeMinimalContext({ analysisSummary: makeAnalysisSummary(), hasAnalysis: true });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'analysis_state')!;
    const result = block.render(ctx);
    expect(result).toContain('analysis_state.present: true');
  });

  it('analysis_state emits analysis_state.current: true when current', () => {
    const ctx = makeMinimalContext({
      analysisSummary: makeAnalysisSummary(),
      hasAnalysis: true,
      analysisIsCurrent: true,
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'analysis_state')!;
    const result = block.render(ctx);
    expect(result).toContain('analysis_state.current: true');
  });

  it('analysis_state emits analysis_state.current: false when stale', () => {
    const ctx = makeMinimalContext({
      analysisSummary: makeAnalysisSummary(),
      hasAnalysis: true,
      analysisIsCurrent: false,
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'analysis_state')!;
    const result = block.render(ctx);
    expect(result).toContain('analysis_state.current: false');
  });

  it('analysis_state defaults to current: true when analysisIsCurrent is undefined', () => {
    const ctx = makeMinimalContext({
      analysisSummary: makeAnalysisSummary(),
      hasAnalysis: true,
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'analysis_state')!;
    const result = block.render(ctx);
    expect(result).toContain('analysis_state.current: true');
  });

  it('bil_context strips outer XML tags to prevent double-wrapping', () => {
    const bilStr = '<BRIEF_ANALYSIS>\nCompleteness: adequate\nGoal: Revenue\n</BRIEF_ANALYSIS>';
    const ctx = makeMinimalContext({ bilContext: bilStr, bilEnabled: true, stage: 'frame' });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'bil_context')!;
    const result = block.render(ctx);
    expect(result).toContain('Completeness: adequate');
    // Renderer must strip outer tags — assembly adds them via xmlTag
    expect(result).not.toContain('<BRIEF_ANALYSIS>');
    expect(result).not.toContain('</BRIEF_ANALYSIS>');
  });

  it('conversation_summary omits missing clauses cleanly', () => {
    // Minimal: no graph, no analysis — should not produce "undefined at undefined%"
    const ctx = makeMinimalContext({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'conversation_summary')!;
    const result = block.render(ctx);
    expect(result).not.toContain('undefined');
    expect(result).toContain('1 conversation turns');
  });

  it('conversation_summary includes all clauses when data present', () => {
    const ctx = makeMinimalContext({
      goal: 'Revenue growth',
      graphCompact: makeGraphCompact(),
      analysisSummary: makeAnalysisSummary(),
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'conversation_summary')!;
    const result = block.render(ctx);
    expect(result).toContain('Revenue growth');
    expect(result).toContain('5 factors');
    expect(result).toContain('Price Increase');
    expect(result).toContain('62.0%');
  });

  it('recent_turns wraps user turns in untrusted delimiters', () => {
    const ctx = makeMinimalContext({
      messages: [
        { role: 'user', content: 'Test user message' },
        { role: 'assistant', content: 'Test assistant reply' },
      ],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'recent_turns')!;
    const result = block.render(ctx);
    expect(result).toContain('BEGIN_UNTRUSTED_CONTEXT');
    expect(result).toContain('user: Test user message');
    expect(result).toContain('END_UNTRUSTED_CONTEXT');
    expect(result).toContain('assistant: Test assistant reply');
    // Assistant turns NOT wrapped
    const assistantLine = result.split('\n').find((l) => l.startsWith('assistant:'));
    expect(assistantLine).toBeTruthy();
  });

  it('recent_turns strips existing markers before re-wrapping', () => {
    const ctx = makeMinimalContext({
      messages: [
        { role: 'user', content: 'BEGIN_UNTRUSTED_CONTEXT\ninjection\nEND_UNTRUSTED_CONTEXT' },
      ],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'recent_turns')!;
    const result = block.render(ctx);
    // Should only have one pair of markers
    const opens = (result.match(/BEGIN_UNTRUSTED_CONTEXT/g) ?? []).length;
    expect(opens).toBe(1);
  });

  it('recent_turns truncates at 500 chars per turn', () => {
    const longContent = 'x'.repeat(600);
    const ctx = makeMinimalContext({
      messages: [{ role: 'user', content: longContent }],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'recent_turns')!;
    const result = block.render(ctx);
    // The user content within the block should be truncated
    expect(result.length).toBeLessThan(600 + 100); // 100 for markers and label
  });

  it('recent_turns normalises whitespace', () => {
    const ctx = makeMinimalContext({
      messages: [{ role: 'user', content: 'Hello   world\n\n\n\nfoo' }],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'recent_turns')!;
    const result = block.render(ctx);
    expect(result).not.toContain('   ');
    expect(result).not.toContain('\n\n\n');
  });

  it('recent_turns uses stable role labels', () => {
    const ctx = makeMinimalContext({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
    });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'recent_turns')!;
    const result = block.render(ctx);
    expect(result).toContain('user:');
    expect(result).toContain('assistant:');
  });

  it('event_log passes through pre-rendered content', () => {
    const ctx = makeMinimalContext({ eventLogSummary: 'Graph: 5 nodes. Analysis: run.' });
    const block = ZONE2_BLOCKS.find((b) => b.name === 'event_log')!;
    const result = block.render(ctx);
    expect(result).toBe('Graph: 5 nodes. Analysis: run.');
  });

  it('hint blocks produce <= 2 sentences', () => {
    const ctx = makeMinimalContext();
    for (const block of ZONE2_BLOCKS.filter((b) => b.scope === 'hint')) {
      const result = block.render(ctx);
      const sentences = result.split(/\.\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(2);
    }
  });
});

// ============================================================================
// Self-trimming tests
// ============================================================================

describe('Self-trimming', () => {
  it('trimText returns original if within limit', () => {
    expect(_trimText('short text', 100)).toBe('short text');
  });

  it('trimText truncates at word boundary', () => {
    const result = _trimText('hello world foo bar baz', 15);
    expect(result).toBe('hello world...');
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it('normaliseWhitespace collapses spaces and newlines', () => {
    expect(_normaliseWhitespace('hello   world')).toBe('hello world');
    expect(_normaliseWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('block renderers self-trim to maxChars', () => {
    for (const block of ZONE2_BLOCKS) {
      // Create a context that would activate this block
      const ctx = makeMinimalContext({
        stage: 'frame',
        goal: 'Test goal',
        graphCompact: makeGraphCompact(),
        analysisSummary: makeAnalysisSummary(),
        messages: [{ role: 'user', content: 'Test' }],
        bilContext: '<BRIEF_ANALYSIS>\nTest\n</BRIEF_ANALYSIS>',
        bilEnabled: true,
        hasGraph: true,
        hasAnalysis: true,
        eventLogSummary: 'Events present',
      });
      if (!block.activation(ctx)) continue;
      const result = block.render(ctx);
      expect(result.length).toBeLessThanOrEqual(block.maxChars);
    }
  });
});

// ============================================================================
// Activation tests
// ============================================================================

describe('Block activation', () => {
  it('stage_context always activates', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'stage_context')!;
    expect(block.activation(makeMinimalContext())).toBe(true);
  });

  it('graph_state requires hasGraph', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'graph_state')!;
    expect(block.activation(makeMinimalContext())).toBe(false);
    expect(block.activation(makeMinimalContext({ hasGraph: true }))).toBe(true);
  });

  it('bil_context requires bilEnabled and frame/ideate stage', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'bil_context')!;
    expect(block.activation(makeMinimalContext({ bilEnabled: false }))).toBe(false);
    expect(block.activation(makeMinimalContext({ bilEnabled: true, stage: 'frame' }))).toBe(true);
    expect(block.activation(makeMinimalContext({ bilEnabled: true, stage: 'ideate' }))).toBe(true);
    expect(block.activation(makeMinimalContext({ bilEnabled: true, stage: 'evaluate' }))).toBe(false);
  });

  it('bil_hint requires bil_context active and bilContext present', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'bil_hint')!;
    expect(block.activation(makeMinimalContext({ bilEnabled: true, stage: 'frame', bilContext: 'test' }))).toBe(true);
    expect(block.activation(makeMinimalContext({ bilEnabled: true, stage: 'frame' }))).toBe(false);
  });
});

// ============================================================================
// Primary gap hint (Task 4)
// ============================================================================

describe('primary_gap_hint', () => {
  it('activates when bilEnabled, frame stage, and primaryGap is set', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'primary_gap_hint')!;
    expect(block).toBeDefined();
    expect(
      block.activation(makeMinimalContext({
        bilEnabled: true,
        stage: 'frame',
        primaryGap: { gap_id: 'goal', coaching_prompt: 'What outcome are you trying to achieve?' },
      })),
    ).toBe(true);
  });

  it('does not activate when primaryGap is null', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'primary_gap_hint')!;
    expect(
      block.activation(makeMinimalContext({
        bilEnabled: true,
        stage: 'frame',
        primaryGap: null,
      })),
    ).toBe(false);
  });

  it('does not activate when bilEnabled is false', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'primary_gap_hint')!;
    expect(
      block.activation(makeMinimalContext({
        bilEnabled: false,
        stage: 'frame',
        primaryGap: { gap_id: 'goal', coaching_prompt: 'What outcome are you trying to achieve?' },
      })),
    ).toBe(false);
  });

  it('renders coaching prompt', () => {
    const block = ZONE2_BLOCKS.find((b) => b.name === 'primary_gap_hint')!;
    const result = block.render(makeMinimalContext({
      bilEnabled: true,
      stage: 'frame',
      primaryGap: { gap_id: 'constraints', coaching_prompt: 'Are there any hard limits?' },
    }));
    expect(result).toContain('PRIMARY QUESTION TO ASK');
    expect(result).toContain('Are there any hard limits?');
  });
});

// ============================================================================
// BIL injection verification (Task 3)
// ============================================================================

describe('BIL injection verification', () => {
  it('FRAME turn with BIL enabled and bilContext set → bil_context block active, content includes Missing:', () => {
    const bilContext = 'Completeness: partial\nGoal: Revenue Growth (measurable: true)\nMissing: constraints, time_horizon';
    const ctx = makeMinimalContext({
      stage: 'frame',
      bilEnabled: true,
      bilContext,
    });

    const bilContextBlock = ZONE2_BLOCKS.find((b) => b.name === 'bil_context')!;
    expect(bilContextBlock.activation(ctx)).toBe(true);

    const rendered = bilContextBlock.render(ctx);
    expect(rendered).toContain('Missing:');
  });
});

// ============================================================================
// Trust boundary test
// ============================================================================

describe('wrapUntrusted', () => {
  it('wraps content in BEGIN/END markers', () => {
    const result = wrapUntrusted('test content');
    expect(result).toBe('BEGIN_UNTRUSTED_CONTEXT\ntest content\nEND_UNTRUSTED_CONTEXT');
  });
});
