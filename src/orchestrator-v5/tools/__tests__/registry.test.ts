/**
 * Handler registry unit tests (slice C1).
 *
 * Focus: resolve-hit, resolve-miss, immutability of the canonical empty
 * registry. Handler invocation semantics (signal propagation, outcome
 * shape) are tested end-to-end in dispatch.test.ts + turn-executor.test.ts
 * with mocked handlers.
 */

import { describe, it, expect } from 'vitest';

import type { V5ActionType } from '@talchain/schemas/orchestrator';

import {
  EMPTY_HANDLER_REGISTRY,
  resolveHandler,
  type HandlerFn,
  type HandlerInvocation,
  type HandlerOutcome,
  type HandlerRegistry,
} from '../registry.js';

const noopHandler: HandlerFn = async (_: HandlerInvocation): Promise<HandlerOutcome> => ({
  assistant_text: 'test',
  handler_facts: [],
  llm_calls_used: 0,
});

describe('EMPTY_HANDLER_REGISTRY', () => {
  it('has size 0 (Slice C1 by design — no handlers registered)', () => {
    expect(EMPTY_HANDLER_REGISTRY.size).toBe(0);
  });

  it('returns undefined for every V5ActionType key (raw Map API)', () => {
    const allHandlerIds: readonly V5ActionType[] = [
      'run_analysis',
      'set_factor_value',
      'add_constraint',
      'adjust_edge_strength',
      'explain_result',
      'compare_options',
      'what_would_flip',
    ];
    for (const id of allHandlerIds) {
      expect(EMPTY_HANDLER_REGISTRY.get(id)).toBeUndefined();
    }
  });
});

describe('resolveHandler', () => {
  it('returns null when the handler id is not registered', () => {
    expect(resolveHandler(EMPTY_HANDLER_REGISTRY, 'run_analysis')).toBeNull();
  });

  it('returns the HandlerFn when the handler id is registered', () => {
    const populated: HandlerRegistry = new Map([['run_analysis', noopHandler]]);
    const resolved = resolveHandler(populated, 'run_analysis');
    expect(resolved).toBe(noopHandler);
  });

  it('returns null for a different id when only one handler is registered', () => {
    const populated: HandlerRegistry = new Map([['run_analysis', noopHandler]]);
    expect(resolveHandler(populated, 'explain_result')).toBeNull();
  });

  it('returns null on the canonical empty registry across every V5ActionType', () => {
    const allHandlerIds: readonly V5ActionType[] = [
      'run_analysis',
      'set_factor_value',
      'add_constraint',
      'adjust_edge_strength',
      'explain_result',
      'compare_options',
      'what_would_flip',
    ];
    for (const id of allHandlerIds) {
      expect(resolveHandler(EMPTY_HANDLER_REGISTRY, id)).toBeNull();
    }
  });
});
