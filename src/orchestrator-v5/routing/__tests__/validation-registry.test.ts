/**
 * Unit tests for Phase 1.5 run_analysis precondition — plan correction #4.
 *
 * The precondition distinguishes two blockers, each with a distinct `reason`
 * so user-facing responses can offer specific recovery paths:
 *   • no_options_defined
 *   • options_lack_intervention_data
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { ProposalAction } from '../types.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall } from '../validator.js';

function mkGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  options?: Array<Record<string, unknown>>,
): GraphV3T {
  const g = { nodes, edges: [] } as unknown as Record<string, unknown>;
  if (options) g.options = options;
  return g as unknown as GraphV3T;
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
    const lookup = buildGraphLookup(graph)!;
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
    const lookup = buildGraphLookup(graph)!;
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
    const lookup = buildGraphLookup(graph)!;
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

  it('passes when at least one option has a configured intervention', () => {
    const graph = mkGraph(
      [
        { id: 'g1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      [
        {
          id: 'opt_a',
          interventions: { fac_1: { value: 0.8, source: 'user_specified' } },
        },
      ],
    );
    const lookup = buildGraphLookup(graph)!;
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
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
    const lookup = buildGraphLookup(graph)!;
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
