/**
 * Unit tests for Phase 1.5 run_analysis precondition — plan correction #4.
 *
 * The precondition distinguishes two blockers, each with a distinct `reason`
 * so user-facing responses can offer specific recovery paths:
 *   • no_options_defined
 *   • options_lack_intervention_data
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

  it('rejects with options_lack_intervention_data when option nodes exist but options[] is empty', () => {
    // Option nodes present in graph but no canonical options[] array (and so
    // no interventions). This is the "user added options but never configured
    // effects" state.
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
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PRECONDITION_UNMET');
      expect(result.error.details?.reason).toBe('options_lack_intervention_data');
    }
  });

  it('rejects with options_lack_intervention_data when options[] entries have empty interventions', () => {
    const graph = mkGraph(
      [
        { id: 'g1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      [{ id: 'opt_a', interventions: {} }],
    );
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.details?.reason).toBe('options_lack_intervention_data');
    }
  });

  it('passes when an option has status="ready" AND a configured intervention (P1-3)', () => {
    const graph = mkGraph(
      [
        { id: 'g1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      [
        {
          id: 'opt_a',
          status: 'ready',
          interventions: { fac_1: { value: 0.8, source: 'user_specified' } },
        },
      ],
    );
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('P1-3: rejects when option has interventions but status is not "ready"', () => {
    // Canonical isOptionReady() requires BOTH status === 'ready' and
    // non-empty interventions. An option in needs_user_mapping with a
    // stray intervention is not analysis-ready.
    const graph = mkGraph(
      [{ id: 'opt_a', kind: 'option', label: 'A' }],
      [
        {
          id: 'opt_a',
          status: 'needs_user_mapping',
          interventions: { fac_1: { value: 1 } },
        },
      ],
    );
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PRECONDITION_UNMET');
      expect(result.error.details?.reason).toBe('options_lack_intervention_data');
    }
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
