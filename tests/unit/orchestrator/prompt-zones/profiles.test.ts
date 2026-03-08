import { describe, it, expect } from 'vitest';
import { selectProfile, getProfileBlocks } from '../../../../src/orchestrator/prompt-zones/profiles.js';
import type { TurnContext } from '../../../../src/orchestrator/prompt-zones/zone2-blocks.js';

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

describe('selectProfile', () => {
  it('generateModel=true → parallel_coaching', () => {
    const result = selectProfile(makeCtx({ generateModel: true }));
    expect(result.profile).toBe('parallel_coaching');
  });

  it('analysis present → post_analysis', () => {
    const result = selectProfile(makeCtx({ hasAnalysis: true }));
    expect(result.profile).toBe('post_analysis');
  });

  it('graph present → ideation', () => {
    const result = selectProfile(makeCtx({ hasGraph: true }));
    expect(result.profile).toBe('ideation');
  });

  it('default → framing', () => {
    const result = selectProfile(makeCtx());
    expect(result.profile).toBe('framing');
  });

  it('generateModel=true AND analysis present → parallel_coaching wins', () => {
    const result = selectProfile(makeCtx({ generateModel: true, hasAnalysis: true }));
    expect(result.profile).toBe('parallel_coaching');
  });

  it('generateModel=true AND graph present → parallel_coaching wins', () => {
    const result = selectProfile(makeCtx({ generateModel: true, hasGraph: true }));
    expect(result.profile).toBe('parallel_coaching');
  });

  it('returns a reason string', () => {
    const result = selectProfile(makeCtx());
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe('string');
  });
});

describe('getProfileBlocks', () => {
  it('framing includes expected blocks', () => {
    const blocks = getProfileBlocks('framing');
    expect(blocks).toContain('stage_context');
    expect(blocks).toContain('bil_context');
    expect(blocks).toContain('conversation_summary');
    expect(blocks).toContain('recent_turns');
    expect(blocks).toContain('bil_hint');
    expect(blocks).not.toContain('graph_state');
    expect(blocks).not.toContain('analysis_state');
  });

  it('ideation includes graph_state', () => {
    const blocks = getProfileBlocks('ideation');
    expect(blocks).toContain('graph_state');
    expect(blocks).toContain('event_log');
    expect(blocks).not.toContain('analysis_state');
  });

  it('post_analysis includes analysis_state and analysis_hint', () => {
    const blocks = getProfileBlocks('post_analysis');
    expect(blocks).toContain('analysis_state');
    expect(blocks).toContain('analysis_hint');
    expect(blocks).not.toContain('bil_context');
    expect(blocks).not.toContain('bil_hint');
  });

  it('parallel_coaching is minimal', () => {
    const blocks = getProfileBlocks('parallel_coaching');
    expect(blocks).toEqual(['stage_context', 'bil_context', 'bil_hint']);
  });
});
