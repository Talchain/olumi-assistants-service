/**
 * Validator — unit tests.
 *
 * Floor per brief §4 D4: 15 tests; target 20. Covers handler lookup, entity
 * kind / existence, Dice-based label-match suspicion, parameter schemas,
 * preconditions, plus two behavioural cases (right-tool-for-job, blocked
 * state).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ProposalAction } from '../types.js';
import {
  SUSPICIOUS_DICE_THRESHOLD,
  bigramDice,
  validateToolCall,
  type GraphLookup,
  type HandlerValidationRegistry,
} from '../validator.js';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function makeGraph(
  entries: ReadonlyArray<{ id: string; kind: string; label: string }>,
): GraphLookup {
  return {
    findEntityById(id) {
      const hit = entries.find((e) => e.id === id);
      if (!hit) return null;
      return { id: hit.id, kind: hit.kind as never, label: hit.label };
    },
    listEntitiesByKind(kind) {
      return entries.filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: e.label }));
    },
  };
}

const RUN_ANALYSIS_DECL: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'Ran analysis on your current scenario.',
  },
};

const SET_FACTOR_VALUE_DECL: HandlerValidationRegistry = {
  set_factor_value: {
    handler_id: 'set_factor_value',
    accepted_entity_kinds: ['node'],
    parameter_schemas: {
      value: z.number().min(0).max(1),
    },
    preconditions: ({ entity }) => {
      if (entity.label === 'Blocked Factor') {
        return { ok: false, reason: 'factor is currently frozen by the user' };
      }
      return { ok: true };
    },
    confirmation_template: 'Updated the factor value.',
  },
  edit_graph: {
    handler_id: 'edit_graph',
    accepted_entity_kinds: ['node', 'edge'],
    confirmation_template: 'Updated the graph.',
  },
};

function makeRunAnalysisProposal(overrides: Partial<ProposalAction> = {}): ProposalAction {
  return {
    handler_id: overrides.handler_id ?? 'run_analysis',
    entity: overrides.entity ?? {
      id: 'opt-a',
      kind: 'option',
      label: 'Expand EU',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: overrides.parameters ?? [],
    cited_context_fields: overrides.cited_context_fields ?? [],
  };
}

// ---------------------------------------------------------------------
// bigramDice
// ---------------------------------------------------------------------

describe('bigramDice', () => {
  it('returns 1 for equal strings', () => {
    expect(bigramDice('Marketing Cost', 'Marketing Cost')).toBe(1);
  });

  it('returns 0 for non-overlapping strings', () => {
    expect(bigramDice('abc', 'xyz')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(bigramDice('Marketing', 'MARKETING')).toBe(1);
  });

  it('gives high score to shared-prefix multi-word labels', () => {
    const high = bigramDice('Marketing Cost', 'Marketing');
    const low = bigramDice('Marketing Cost', 'Customer Churn');
    expect(high).toBeGreaterThan(0.4);
    expect(high - low).toBeGreaterThan(SUSPICIOUS_DICE_THRESHOLD);
    expect(high).toBeGreaterThan(low);
  });

  it('handles short strings by equality fallback', () => {
    expect(bigramDice('a', 'a')).toBe(1);
    expect(bigramDice('a', 'b')).toBe(0);
  });
});

// ---------------------------------------------------------------------
// validateToolCall
// ---------------------------------------------------------------------

describe('validateToolCall — happy path', () => {
  it('accepts a resolved run_analysis proposal with a matching option entity', () => {
    const graph = makeGraph([{ id: 'opt-a', kind: 'option', label: 'Expand EU' }]);
    const result = validateToolCall(makeRunAnalysisProposal(), graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.proposal.handler_id).toBe('run_analysis');
    }
  });
});

describe('validateToolCall — typed failures', () => {
  it('returns HANDLER_NOT_FOUND when handler_id is unknown', () => {
    const graph = makeGraph([]);
    const proposal = makeRunAnalysisProposal({ handler_id: 'no_such_handler' });
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('HANDLER_NOT_FOUND');
      expect(result.error.details?.handler_id).toBe('no_such_handler');
    }
  });

  it('returns ENTITY_KIND_MISMATCH when proposed kind is not accepted', () => {
    const graph = makeGraph([{ id: 'n-1', kind: 'factor', label: 'Cost' }]);
    const proposal = makeRunAnalysisProposal({
      entity: {
        id: 'n-1',
        kind: 'node',
        label: 'Cost',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
    });
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
  });

  it('returns ENTITY_NOT_FOUND when entity.id is absent from graph', () => {
    const graph = makeGraph([{ id: 'opt-a', kind: 'option', label: 'Expand EU' }]);
    const proposal = makeRunAnalysisProposal({
      entity: {
        id: 'opt-missing',
        kind: 'option',
        label: 'Missing',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
    });
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_NOT_FOUND');
      expect(result.error.details?.entity_id).toBe('opt-missing');
    }
  });

  it('returns ENTITY_RESOLUTION_SUSPICIOUS when a closer label-match exists (Δ ≥ 0.15)', () => {
    // Sonnet's chosen label "Cost" label-matches to "Customer Churn" id c-1,
    // but "Marketing Cost" at c-2 is a much closer match. The validator
    // flags this and returns candidates so the UI can ask to clarify.
    const graph = makeGraph([
      { id: 'c-1', kind: 'node', label: 'Customer Churn' },
      { id: 'c-2', kind: 'node', label: 'Marketing Cost' },
    ]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'c-1', // Sonnet picked the wrong id
        kind: 'node',
        label: 'Marketing Cost',
        resolution_status: 'resolved',
        resolution_method: 'label_match',
      },
      parameters: [{ name: 'value', value: 0.5, source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_RESOLUTION_SUSPICIOUS');
      const details = result.error.details as {
        closer_candidate: { id: string; label: string };
        delta: number;
      };
      expect(details.closer_candidate.id).toBe('c-2');
      expect(details.closer_candidate.label).toBe('Marketing Cost');
      expect(details.delta).toBeGreaterThanOrEqual(SUSPICIOUS_DICE_THRESHOLD);
    }
  });

  it('does NOT flag suspicion when the chosen label is already the closest match', () => {
    const graph = makeGraph([
      { id: 'c-1', kind: 'node', label: 'Marketing Cost' },
      { id: 'c-2', kind: 'node', label: 'Customer Churn' },
    ]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'c-1',
        kind: 'node',
        label: 'Marketing Cost',
        resolution_status: 'resolved',
        resolution_method: 'label_match',
      },
      parameters: [{ name: 'value', value: 0.5, source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(true);
  });

  it('does NOT run Dice check when resolution_method !== "label_match"', () => {
    // id_match: Sonnet claims it knows the exact id. Dice is bypassed even
    // if there's a closer label on another node.
    const graph = makeGraph([
      { id: 'c-1', kind: 'node', label: 'Customer Churn' },
      { id: 'c-2', kind: 'node', label: 'Marketing Cost' },
    ]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'c-1',
        kind: 'node',
        label: 'Marketing Cost', // mismatched label — but resolution says id_match
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value: 0.5, source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(true);
  });

  it('returns PARAMETER_INVALID when a parameter fails its schema bound', () => {
    const graph = makeGraph([{ id: 'n-1', kind: 'node', label: 'Factor' }]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'n-1',
        kind: 'node',
        label: 'Factor',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value: 1.5, source: 'user_explicit' }], // > 1, out of bounds
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('PARAMETER_INVALID');
  });

  it('silently skips unknown parameters that are not in the handler schema (when required `value` is also present)', () => {
    // Review feedback (2026-05-20, Blocking #2): for set_factor_value,
    // the structural precheck requires `value` to be present.
    // Unknown parameters alongside a valid `value` are still silently
    // skipped — that's the contract this case pins. The previous
    // version of this test passed an empty-of-`value` parameters
    // array, which now correctly rejects via `missing_value`; the
    // case has been refined rather than removed.
    const graph = makeGraph([{ id: 'n-1', kind: 'node', label: 'Factor' }]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'n-1',
        kind: 'node',
        label: 'Factor',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'value', value: 0.5, source: 'user_explicit' },
        { name: 'bogus_param', value: 9999, source: 'inferred' },
      ],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(true);
  });

  it('returns PRECONDITION_UNMET when the handler precondition fails', () => {
    // Sonnet picks "Blocked Factor". Handler's precondition says it's frozen.
    const graph = makeGraph([{ id: 'n-blk', kind: 'node', label: 'Blocked Factor' }]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'n-blk',
        kind: 'node',
        label: 'Blocked Factor',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value: 0.3, source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PRECONDITION_UNMET');
      expect(result.error.details?.reason).toMatch(/frozen/);
    }
  });

  it('returns ENTITY_RESOLUTION_AMBIGUOUS when resolution_status === "ambiguous", surfacing candidates', () => {
    const graph = makeGraph([
      { id: 'opt-a', kind: 'option', label: 'Expand EU' },
      { id: 'opt-b', kind: 'option', label: 'Expand US' },
    ]);
    const proposal = makeRunAnalysisProposal({
      entity: {
        id: 'opt-a',
        kind: 'option',
        label: 'Expand',
        resolution_status: 'ambiguous',
        resolution_method: 'label_match',
        candidates: [
          { id: 'opt-a', label: 'Expand EU' },
          { id: 'opt-b', label: 'Expand US' },
        ],
      },
    });
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
      const details = result.error.details as { resolution_status: string; candidates?: unknown[] };
      expect(details.resolution_status).toBe('ambiguous');
      expect(details.candidates).toHaveLength(2);
    }
  });

  it('returns ENTITY_RESOLUTION_AMBIGUOUS when resolution_status === "unresolved"', () => {
    const graph = makeGraph([{ id: 'opt-a', kind: 'option', label: 'Expand EU' }]);
    const proposal = makeRunAnalysisProposal({
      entity: {
        id: 'opt-a',
        kind: 'option',
        resolution_status: 'unresolved',
        resolution_method: 'context_inference',
      },
    });
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
    }
  });

  it('resolution check fires BEFORE entity-kind mismatch — clarification supersedes structural error', () => {
    // Even when both resolution is ambiguous AND kind is wrong, the
    // resolution issue dominates because the user-facing recovery is
    // "pick one of these" not "pick a different handler".
    const graph = makeGraph([{ id: 'n-1', kind: 'factor', label: 'Cost' }]);
    const proposal = makeRunAnalysisProposal({
      entity: {
        id: 'n-1',
        kind: 'node',
        resolution_status: 'ambiguous',
        resolution_method: 'label_match',
      },
    });
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
  });

  it('checks fail in the documented order — handler miss precedes entity mismatch', () => {
    // If handler is wrong AND entity is wrong, the handler error wins.
    const graph = makeGraph([]);
    const proposal = makeRunAnalysisProposal({ handler_id: 'ghost', entity: undefined as never });
    const result = validateToolCall(
      { ...proposal, entity: { id: 'x', kind: 'goal', label: 'g', resolution_status: 'resolved', resolution_method: 'id_match' } },
      graph,
      RUN_ANALYSIS_DECL,
    );
    if (!result.valid) expect(result.error.code).toBe('HANDLER_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------
// Behavioural tests per brief §4 D4
// ---------------------------------------------------------------------

describe('validateToolCall — behavioural guarantees', () => {
  it('right-tool-for-job pressure lives in handler declarations, not validator control flow', () => {
    // Validates that the validator is a structural safety net governed by
    // each handler's declaration — accepted_entity_kinds, parameter_schemas,
    // preconditions. "Right tool" routing correctness is a routing-layer
    // concern (Sonnet's prompt + telemetry-driven evals), not validator code.
    //
    // Demonstration: a parameter-bearing proposal on edit_graph (no param
    // schema declared) passes structurally, while the same proposal on
    // set_factor_value (param schema present) also passes. If Phase 2
    // wants to harden "set churn → must go to set_factor_value", the
    // mechanism is to declare a param schema on edit_graph that REJECTS
    // scalar value updates — a registry-declaration change, not a
    // validator code change.
    const graph = makeGraph([{ id: 'n-churn', kind: 'node', label: 'Churn' }]);
    const proposal: ProposalAction = {
      handler_id: 'edit_graph',
      entity: {
        id: 'n-churn',
        kind: 'node',
        label: 'Churn',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value: 0.05, source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(true);

    // Same proposal on set_factor_value also validates — its richer schema
    // would catch out-of-bounds values (covered separately above).
    const correctProposal: ProposalAction = { ...proposal, handler_id: 'set_factor_value' };
    const correct = validateToolCall(correctProposal, graph, SET_FACTOR_VALUE_DECL);
    expect(correct.valid).toBe(true);
  });

  it('action on non-existent entity produces typed ENTITY_NOT_FOUND with recovery path, never silent execution', () => {
    const graph = makeGraph([]);
    const proposal = makeRunAnalysisProposal();
    const result = validateToolCall(proposal, graph, RUN_ANALYSIS_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_NOT_FOUND');
      // Recovery path: details contain entity_id + entity_kind so compose
      // can render "We couldn't find option 'opt-a' in your graph." with a
      // specific fix path.
      expect(result.error.details?.entity_id).toBe('opt-a');
      expect(result.error.details?.entity_kind).toBe('option');
    }
  });

  it('blocked state (precondition unmet) produces RECOVER with a specific fix path, not a generic error', () => {
    const graph = makeGraph([{ id: 'n-blk', kind: 'node', label: 'Blocked Factor' }]);
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'n-blk',
        kind: 'node',
        label: 'Blocked Factor',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value: 0.5, source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, graph, SET_FACTOR_VALUE_DECL);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PRECONDITION_UNMET');
      // Specific, not generic: message contains the precondition's own reason
      expect(result.error.message).toMatch(/frozen/);
      expect(result.error.details?.reason).toMatch(/frozen/);
      // And identifies the handler so compose can render a handler-specific chip
      expect(result.error.details?.handler_id).toBe('set_factor_value');
    }
  });
});
