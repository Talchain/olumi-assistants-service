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
  createRegistry,
  EMPTY_HANDLER_REGISTRY,
  resolveHandler,
  type HandlerFn,
  type HandlerInvocation,
  type HandlerOutcome,
  type HandlerRegistry,
} from '../registry.js';
import type { ScenarioReader } from '../handlers/run-analysis.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';

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
      'explain_results',
      'explain_from_structure',
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
      'explain_results',
      'explain_from_structure',
      'compare_options',
      'what_would_flip',
    ];
    for (const id of allHandlerIds) {
      expect(resolveHandler(EMPTY_HANDLER_REGISTRY, id)).toBeNull();
    }
  });
});

describe('createRegistry — V5 0.9.0 handler set', () => {
  // Stubs for createRegistry's required deps. These never run because the
  // tests only assert presence in the registry map, not handler invocation.
  const stubScenarioReader: ScenarioReader = () =>
    Promise.reject(new Error('scenario reader not exercised in this test'));
  const stubPlotClient: PLoTClient = {
    run: () => Promise.reject(new Error('plot client not exercised')),
    validatePatch: () => Promise.reject(new Error('plot client not exercised')),
  } as unknown as PLoTClient;

  it('registers run_analysis plus the V5 no-op + D1 mutation handlers', () => {
    const registry = createRegistry({
      scenarioReader: stubScenarioReader,
      plotClient: stubPlotClient,
    });
    expect(registry.size).toBe(6);
    expect(resolveHandler(registry, 'run_analysis')).not.toBeNull();
    expect(resolveHandler(registry, 'explain_from_structure')).not.toBeNull();
    expect(resolveHandler(registry, 'explain_results')).not.toBeNull();
    expect(resolveHandler(registry, 'what_would_flip')).not.toBeNull();
    // D1 (Brief: D1 deterministic handlers).
    expect(resolveHandler(registry, 'set_factor_value')).not.toBeNull();
    expect(resolveHandler(registry, 'add_constraint')).not.toBeNull();
  });

  it('does not register the deprecated explain_result literal', () => {
    const registry = createRegistry({
      scenarioReader: stubScenarioReader,
      plotClient: stubPlotClient,
    });
    expect(resolveHandler(registry, 'explain_result')).toBeNull();
  });

  it('does not register handler ids without a backing handler', () => {
    const registry = createRegistry({
      scenarioReader: stubScenarioReader,
      plotClient: stubPlotClient,
    });
    // adjust_edge_strength lands in the final D1 commit; compare_options
    // is E1 brief scope, not D1.
    expect(resolveHandler(registry, 'compare_options')).toBeNull();
    expect(resolveHandler(registry, 'adjust_edge_strength')).toBeNull();
  });
});
