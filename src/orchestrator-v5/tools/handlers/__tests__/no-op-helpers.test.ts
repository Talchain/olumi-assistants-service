/**
 * Unit tests for the shared no-op handler helpers.
 *
 * `resolveOptionCount` and `buildAnalysisAbsentTemplate` are imported by
 * all three V5 no-op explanation handlers (explain_from_structure,
 * explain_results, what_would_flip). Tests live here so the contract is
 * tested once rather than three times.
 */

import { describe, it, expect } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import {
  buildAnalysisAbsentTemplate,
  resolveOptionCount,
} from '../no-op-helpers.js';

function makeInvocation(overrides: {
  optionIds?: readonly string[];
  analysisReady?: HandlerInvocation['analysisReady'];
}): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: {
        option_ids: overrides.optionIds ?? [],
        goal_id: 'g',
      },
      capabilities: {},
      messages: [],
      session_id: 's',
      request_id: 'r',
      budgets: { turn_ms: 1000, llm_narrate_ms: 500 },
      prior_turns: [],
      prior_facts: [],
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't',
      scenario_id: 's',
      message: 'm',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'r',
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: overrides.analysisReady,
  };
}

function makeAnalysisReady(
  optionCount: number,
  status: string,
): HandlerInvocation['analysisReady'] {
  return {
    options: Array.from({ length: optionCount }, (_, i) => ({
      option_id: `opt_${i + 1}`,
      label: `Option ${i + 1}`,
      status,
      interventions: { f: 1 },
    })),
    goal_node_id: 'g',
    status,
  };
}

describe('resolveOptionCount', () => {
  it('returns analysisReady.options.length when analysisReady is present', () => {
    const inv = makeInvocation({
      analysisReady: makeAnalysisReady(3, 'ready'),
      optionIds: [], // entity_registry stub deliberately empty
    });
    expect(resolveOptionCount(inv)).toBe(3);
  });

  it('preserves analysisReady count even when entity_registry stub is non-empty (analysisReady wins)', () => {
    const inv = makeInvocation({
      analysisReady: makeAnalysisReady(2, 'ready'),
      optionIds: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(resolveOptionCount(inv)).toBe(2);
  });

  it('falls back to entity_registry.option_ids.length when analysisReady is undefined', () => {
    const inv = makeInvocation({
      analysisReady: undefined,
      optionIds: ['opt_1', 'opt_2', 'opt_3'],
    });
    expect(resolveOptionCount(inv)).toBe(3);
  });

  it('returns 0 when both sources are empty', () => {
    const inv = makeInvocation({ analysisReady: undefined, optionIds: [] });
    expect(resolveOptionCount(inv)).toBe(0);
  });
});

describe('buildAnalysisAbsentTemplate', () => {
  it('uses singular "option" wording when option_count === 1', () => {
    const text = buildAnalysisAbsentTemplate(1, 'ready');
    expect(text).toContain('1 option configured');
    expect(text).not.toContain('1 options');
  });

  it('uses plural "options" wording when option_count !== 1', () => {
    expect(buildAnalysisAbsentTemplate(0, 'ready')).toContain('0 options configured');
    expect(buildAnalysisAbsentTemplate(2, 'ready')).toContain('2 options configured');
    expect(buildAnalysisAbsentTemplate(7, 'ready')).toContain('7 options configured');
  });

  it('uses "ready to analyse" copy when readinessStatus === "ready"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'ready');
    expect(text).toContain('ready to analyse');
    expect(text).toContain('Would you like me to run the analysis?');
  });

  it('uses "options still need to be set up" copy when readinessStatus === "needs_user_input"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'needs_user_input');
    expect(text).toContain('still need to be set up');
    expect(text).not.toContain('ready to analyse');
  });

  it('uses "options still need to be set up" copy when readinessStatus === "needs_user_mapping"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'needs_user_mapping');
    expect(text).toContain('still need to be set up');
  });

  it('uses "options still need to be set up" copy when readinessStatus === "needs_encoding"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'needs_encoding');
    expect(text).toContain('still need to be set up');
  });

  it('falls back to "ready to analyse" wording when readinessStatus is undefined', () => {
    // Undefined readiness implies the chip generator's own readiness gate
    // will suppress the executable run-analysis chip, so the user is not
    // misled into clicking a chip that won't fire. Keeping the neutral
    // wording here preserves the existing UX.
    const text = buildAnalysisAbsentTemplate(2, undefined);
    expect(text).toContain('ready to analyse');
  });

  it('falls back to "ready to analyse" wording for unknown readiness literals', () => {
    const text = buildAnalysisAbsentTemplate(2, 'some_future_status');
    expect(text).toContain('ready to analyse');
  });
});
