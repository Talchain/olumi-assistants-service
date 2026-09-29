/**
 * Unit tests for the R7 edit_graph turn-event helpers.
 *
 * Locks the failure-code mapping (structural, never message-string parsing),
 * the outcome derivation, and the default-filling — independently of the
 * dispatcher so the contract is pinned at the leaf level.
 */
import { describe, it, expect } from 'vitest';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import {
  classifyThrownFailureCode,
  deriveEditTurnFieldsFromResult,
  finaliseEditTurnEvent,
  type EditTurnEventAccumulator,
} from '../edit-graph-turn-event.js';

function makeResult(overrides: Partial<EditGraphResult> = {}): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'x',
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: false,
    ...overrides,
  };
}

const GRAPH_2N_1E = {
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ from: 'a', to: 'b' }],
} as unknown as EditGraphResult['appliedGraph'];

describe('classifyThrownFailureCode (structural, no message parsing)', () => {
  it('reads the parse_fail discriminator', () => {
    expect(classifyThrownFailureCode({ editTurnFailureCode: 'parse_fail' })).toBe('parse_fail');
  });

  it('reads the llm_call_failed discriminator', () => {
    expect(classifyThrownFailureCode({ editTurnFailureCode: 'llm_call_failed' })).toBe('llm_call_failed');
  });

  it('prefers the discriminator over the (identical) orchestratorError.code', () => {
    const err = Object.assign(new Error('Failed to parse edit operations from LLM response: ...'), {
      editTurnFailureCode: 'parse_fail' as const,
      orchestratorError: { code: 'TOOL_EXECUTION_FAILED' },
    });
    // The message says "parse" and the code is the generic TOOL_EXECUTION_FAILED;
    // classification must come from the structured discriminator, lower-cased.
    expect(classifyThrownFailureCode(err)).toBe('parse_fail');
  });

  it('falls back to the structured orchestratorError.code (lower-cased) when no discriminator', () => {
    expect(classifyThrownFailureCode({ orchestratorError: { code: 'TOOL_EXECUTION_FAILED' } })).toBe(
      'tool_execution_failed',
    );
  });

  it('falls back to tool_execution_failed for a bare error', () => {
    expect(classifyThrownFailureCode(new Error('boom'))).toBe('tool_execution_failed');
    expect(classifyThrownFailureCode(undefined)).toBe('tool_execution_failed');
  });
});

describe('deriveEditTurnFieldsFromResult', () => {
  const base = { graphNodesBefore: 2, graphEdgesBefore: 1 };

  it('success: applied mutation → outcome=success, graph_after reflects applied graph', () => {
    const r = makeResult({
      appliedGraph: GRAPH_2N_1E,
      operations: [{ op: 'update_edge', path: 'a->b', value: 0.7 }] as unknown as EditGraphResult['operations'],
    });
    const f = deriveEditTurnFieldsFromResult(r, { ...base, successfulAppliedMutation: true });
    expect(f.outcome).toBe('success');
    expect(f.operations_count).toBe(1);
    expect(f.graph_nodes_after).toBe(2);
    expect(f.graph_edges_after).toBe(1);
  });

  it('rejected: wasRejected → outcome=rejected, failure_code from diagnostics', () => {
    const r = makeResult({
      wasRejected: true,
      diagnostics: { failure_code: 'PLOT_SEMANTIC_REJECTED' } as unknown as EditGraphResult['diagnostics'],
    });
    const f = deriveEditTurnFieldsFromResult(r, { ...base, successfulAppliedMutation: false });
    expect(f.outcome).toBe('rejected');
    expect(f.failure_code).toBe('PLOT_SEMANTIC_REJECTED');
  });

  it('no_op: zero operations, not rejected → outcome=no_op, graph_after===before', () => {
    const r = makeResult({ wasRejected: false });
    const f = deriveEditTurnFieldsFromResult(r, { ...base, successfulAppliedMutation: false });
    expect(f.outcome).toBe('no_op');
    expect(f.graph_nodes_after).toBe(2);
    expect(f.graph_edges_after).toBe(1);
    expect(f.operations_count).toBe(0);
  });

  it('proposal: proposalEarlyEmitted flag wins over the no-op shape', () => {
    const r = makeResult({ wasRejected: false });
    const f = deriveEditTurnFieldsFromResult(r, {
      ...base,
      successfulAppliedMutation: false,
      proposalEarlyEmitted: true,
    });
    expect(f.outcome).toBe('proposal');
  });

  it('clarify: deterministicClarify + zero operations → outcome=clarify (not no_op)', () => {
    const r = makeResult({ wasRejected: false });
    const f = deriveEditTurnFieldsFromResult(r, {
      ...base,
      successfulAppliedMutation: false,
      deterministicClarify: true,
    });
    expect(f.outcome).toBe('clarify');
  });

  it('clarify flag does NOT override a rejection — wasRejected wins (add-risk preflight)', () => {
    const r = makeResult({ wasRejected: true });
    const f = deriveEditTurnFieldsFromResult(r, {
      ...base,
      successfulAppliedMutation: false,
      deterministicClarify: true,
    });
    expect(f.outcome).toBe('rejected');
  });

  it('threads tokens / stop_reason / model / repair_attempts / plot_outcome / branch from diagnostics', () => {
    const r = makeResult({
      appliedGraph: GRAPH_2N_1E,
      operations: [{ op: 'update_edge', path: 'a->b', value: 0.7 }] as unknown as EditGraphResult['operations'],
      diagnostics: {
        branch_taken: 'apply',
        model: 'claude-test',
        input_tokens_est: 222,
        output_tokens: 44,
        stop_reason: 'end_turn',
        repair_attempts: 2,
        plot_outcome: 'pass',
      } as unknown as EditGraphResult['diagnostics'],
    });
    const f = deriveEditTurnFieldsFromResult(r, { ...base, successfulAppliedMutation: true });
    expect(f.model).toBe('claude-test');
    expect(f.input_tokens_est).toBe(222);
    expect(f.output_tokens).toBe(44);
    expect(f.stop_reason).toBe('end_turn');
    expect(f.repair_attempts).toBe(2);
    expect(f.plot_outcome).toBe('pass');
    expect(f.branch).toBe('apply');
  });
});

describe('finaliseEditTurnEvent (defaults)', () => {
  const seed: EditTurnEventAccumulator = {
    scenario_id: 's',
    turn_id: 't',
    graph_nodes_before: 5,
    graph_edges_before: 4,
  };

  it('fills honest defaults for a minimally-populated accumulator', () => {
    const e = finaliseEditTurnEvent(seed);
    expect(e.outcome).toBe('error');
    expect(e.failure_code).toBeNull();
    expect(e.branch).toBeNull();
    expect(e.stop_reason).toBe('unknown');
    expect(e.plot_outcome).toBe('skipped');
    expect(e.model).toBeNull();
    expect(e.input_tokens_est).toBe(0);
    expect(e.output_tokens).toBe(0);
    expect(e.repair_attempts).toBe(0);
    expect(e.prompt_fallback_used).toBe(false);
    expect(e.latency_ms).toBe(0);
    // graph_after defaults to graph_before when a branch never set it.
    expect(e.graph_nodes_after).toBe(5);
    expect(e.graph_edges_after).toBe(4);
  });

  it('passes through any field a branch set', () => {
    const e = finaliseEditTurnEvent({
      ...seed,
      outcome: 'success',
      stop_reason: 'max_tokens',
      input_tokens_est: 10,
      graph_nodes_after: 6,
    });
    expect(e.outcome).toBe('success');
    expect(e.stop_reason).toBe('max_tokens');
    expect(e.input_tokens_est).toBe(10);
    expect(e.graph_nodes_after).toBe(6);
  });
});
