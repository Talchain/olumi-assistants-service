/**
 * Unit tests for Phase 1.5 run_analysis precondition.
 *
 * After review P0-1, the precondition is WIRE-CHECKABLE ONLY — it asserts
 * "at least one option node exists in graph.nodes". Intervention-readiness
 * (status === 'ready' + non-empty interventions) lives in the scenario
 * store, which only the handler has async access to; the handler produces
 * typed HANDLER_INVOCATION_FAILED when options lack configuration. A prior
 * revision attempted to check readiness at the validator layer and would
 * have failed every production run_analysis turn because the real wire
 * does not carry the canonical options array.
 */
import { describe, it, expect } from 'vitest';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { ProposalAction } from '../types.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall, type GraphLookup } from '../validator.js';

function mkGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  options?: Array<Record<string, unknown>>,
): GraphStateIngress {
  const g: Record<string, unknown> = { nodes, edges: [] };
  if (options) g.options = options;
  return g as GraphStateIngress;
}

function lookupFor(graph: GraphStateIngress): GraphLookup {
  const r = buildGraphLookup(graph);
  if (r.kind !== 'ok') throw new Error(`expected ok adapter result, got ${r.kind}`);
  return r.lookup;
}

function runAnalysisProposal(entityId: string, entityKind: 'option' | 'goal'): ProposalAction {
  return {
    handler_id: 'run_analysis',
    entity: {
      id: entityId,
      kind: entityKind,
      label: entityId,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  };
}

describe('run_analysis precondition', () => {
  it('rejects with no_options_defined when graph has neither option-nodes nor options[]', () => {
    const graph = mkGraph([{ id: 'g1', kind: 'goal', label: 'Profit' }]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('g1', 'goal'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PRECONDITION_UNMET');
      expect(result.error.details?.reason).toBe('no_options_defined');
    }
  });

  it('passes when at least one option node exists — even without canonical options[] on wire (P0-1)', () => {
    // This is the real-wire happy path: UI sends graph_state with an option
    // node but no top-level options[] array. The validator PASSES this; the
    // handler reads scenario data async and enforces intervention readiness.
    const graph = mkGraph([
      { id: 'g1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
    ]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('passes regardless of options[] readiness — that check moved to handler', () => {
    // Whether options[] has status='ready' or status='needs_user_mapping',
    // the validator is agnostic. The wire doesn't carry canonical options,
    // so this layer cannot judge readiness without breaking every real turn.
    const graph = mkGraph(
      [{ id: 'opt_a', kind: 'option', label: 'A' }],
      [{ id: 'opt_a', status: 'needs_user_mapping', interventions: {} }],
    );
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('P0-1: rejects ENTITY_KIND_MISMATCH when proposal.kind differs from graph kind', () => {
    // LLM hallucination guard: if Sonnet proposes kind='option' but the id
    // resolves to a factor, validator must reject with ENTITY_KIND_MISMATCH.
    // (Here we use a 'goal' proposed kind with an option id, to hit the cross-
    // check without accepted_entity_kinds also rejecting it — run_analysis
    // accepts both option and goal.)
    const graph = mkGraph([{ id: 'opt_a', kind: 'option', label: 'A' }]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'goal'), // proposed goal, graph says option
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
      expect(result.error.details?.proposed_kind).toBe('goal');
      expect(result.error.details?.resolved_kind).toBe('option');
    }
  });

  it('precondition does not run when no graph lookup is available (frame stage)', () => {
    // Without a graph, graph-dependent checks + preconditions both skip.
    // Structural checks still happen — this proposal passes them all.
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('precondition failure produces typed reason suitable for user-facing response', () => {
    // Regression guard: the reason strings are machine-stable so compose can
    // choose the right fix-path language.
    const graph = mkGraph([{ id: 'g1', kind: 'goal', label: 'Profit' }]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('g1', 'goal'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    if (!result.valid) {
      const reason = String(result.error.details?.reason);
      expect(reason === 'no_options_defined' || reason === 'options_lack_intervention_data').toBe(true);
    }
  });
});
