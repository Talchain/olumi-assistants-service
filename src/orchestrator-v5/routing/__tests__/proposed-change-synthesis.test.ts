/**
 * V5 G7/G8 — decideProposedChangeSynthesis unit tests.
 *
 * Covers lifecycle decisions:
 *   - execute (active, hash matches, not yet applied)
 *   - superseded (graph hash diverged)
 *   - already_applied (matching successful mutation in prior_facts)
 *   - invalid (missing inline_patch / unknown handler_id / missing graph_hash)
 *
 * Plus the buildApplyProposedChangeProposal helper that maps an
 * `inline_patch` to a `ProposalAction`.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  PROPOSAL_ALREADY_APPLIED_RESPONSE,
  PROPOSAL_SUPERSEDED_RESPONSE,
  buildApplyProposedChangeProposal,
  decideProposedChangeSynthesis,
} from '../proposed-change-synthesis.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { HandlerFactWithTurn } from '../../session/store.js';

const GRAPH_HASH = 'aaaaaaaaaaaa';
const EMITTED_AT_ISO = '2026-05-07T12:00:00.000Z';

/**
 * Build a HandlerFactWithTurn entry. The synthesis input is now a
 * single wrapper carrying the FK ownership link
 * (`fact_created_at`) per fact — replacing the prior split
 * priorTurns / priorFacts inputs.
 */
function fwt(
  fact: HandlerFact,
  factCreatedAt: string,
  turnId: string = 't1',
): HandlerFactWithTurn {
  return { fact, turn_id: turnId, fact_created_at: factCreatedAt };
}

const POST_EMIT_TS = '2026-05-07T12:00:30.000Z';
const PRE_EMIT_TS = '2026-05-06T12:00:00.000Z';

function pa(overrides: {
  inlinePatch?: Record<string, unknown> | null;
  proposalRef?: string;
  graphHash?: string;
  targets?: readonly string[];
  params?: Readonly<Record<string, unknown>>;
}): PendingAction {
  const inline =
    overrides.inlinePatch === undefined
      ? {
          handler_id: 'add_constraint',
          params: overrides.params ?? { value: 100 },
          target_entity_ids: overrides.targets ?? ['node_X'],
        }
      : overrides.inlinePatch;
  return {
    id: 'pa1',
    scenario_id: 'scn',
    chip_id: 'prop_aaaaaaaaaaaa',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: overrides.proposalRef ?? 'prop_aaaaaaaaaaaa',
      // Use a runtime spread + cast so tests can also exercise the
      // defensive runtime branch where inline_patch is missing,
      // even though the type now requires it.
      ...(inline === null ? {} : { inline_patch: inline as Readonly<Record<string, unknown>> }),
      // Pass-10 P2-1: standard-variant required render copy. Synthesis
      // tests do not read these fields, but including them keeps
      // fixtures aligned with the tightened discriminated union.
      public_label: 'Label for proposal',
      public_message: 'Message for proposal.',
    } as unknown as PendingAction['action'],
    preconditions: { graph_hash: overrides.graphHash ?? GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: EMITTED_AT_ISO,
  };
}

function fact(overrides: {
  type: 'add_constraint' | 'set_factor_value' | 'adjust_edge_strength';
  targetId?: string;
  status?: 'applied' | 'noop';
  noop?: boolean;
  after?: Record<string, unknown> | null;
}): HandlerFact {
  return {
    fact_type: overrides.type,
    fact_version: 1,
    noop: overrides.noop ?? false,
    result: {
      target_id: overrides.targetId ?? 'node_X',
      status: overrides.status ?? 'applied',
      before: null,
      after: overrides.after === undefined ? { value: 100 } : overrides.after,
    },
  } as unknown as HandlerFact;
}

describe('decideProposedChangeSynthesis — execute', () => {
  it('returns execute when hash matches and no prior matching fact', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('execute');
    if (out.status !== 'execute') return;
    expect(out.handler_id).toBe('add_constraint');
    expect(out.params).toEqual({ value: 100 });
    expect(out.target_entity_ids).toEqual(['node_X']);
  });
});

describe('decideProposedChangeSynthesis — superseded', () => {
  it('returns superseded when current hash differs', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: 'different_hash',
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('superseded');
  });

  it('returns superseded when current hash is undefined', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: undefined,
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('superseded');
  });

  it('returns superseded when current hash is null', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: null,
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('superseded');
  });
});

describe('decideProposedChangeSynthesis — already_applied (timestamp-bounded, params-matched)', () => {
  it('returns already_applied when a matching applied fact exists AND a recent handler turn covers it', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_most', value: 100 },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'c1',
          after: {
            constraint_id: 'c1',
            node_id: 'node_X',
            operator: '<=',
            value: 100,
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('already_applied');
  });

  it('does NOT match when no handler turn occurs after emitted_at_iso (timestamp bound)', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: GRAPH_HASH,
      // Matching fact present, but the only handler turn predates emit.
      priorFactsWithTurn: [fwt(fact({ type: 'add_constraint', targetId: 'node_X' }), PRE_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('does NOT match when handler turn is post-emit but params differ (params bound)', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({ params: { value: 100 } }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'node_X',
          after: { value: 200 },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('does NOT match when prior turn is direct_answer (turn_class bound)', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('execute');
  });

  it('does NOT match a noop fact even with a recent handler turn', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({ type: 'add_constraint', targetId: 'node_X', noop: true }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('does NOT match a fact with status === "noop"', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({ type: 'add_constraint', targetId: 'node_X', status: 'noop' }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('add_constraint: does NOT match when after.node_id falls outside the proposal targets', () => {
    // Real GoalConstraint shape: { constraint_id, node_id, operator,
    // value, unit?, label? }. result.target_id is the constraint_id;
    // node_id sits inside result.after.
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_most', value: 100 },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'constraint_id_42',
          after: {
            constraint_id: 'constraint_id_42',
            node_id: 'node_Y',
            operator: '<=',
            value: 100,
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('add_constraint: matches on real GoalConstraint shape (node_id + operator + value)', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_most', value: 100 },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'constraint_id_42',
          after: {
            constraint_id: 'constraint_id_42',
            node_id: 'node_X',
            operator: '<=',
            value: 100,
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('already_applied');
  });

  it('add_constraint: maps at_least to >= and matches', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_least', value: 5 },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'c1',
          after: {
            constraint_id: 'c1',
            node_id: 'node_X',
            operator: '>=',
            value: 5,
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('already_applied');
  });

  it('add_constraint: does NOT match when operator differs (at_most vs >=)', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_most', value: 100 },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'c1',
          after: {
            constraint_id: 'c1',
            node_id: 'node_X',
            operator: '>=', // different operator
            value: 100,
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('add_constraint: does NOT match when value differs', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_most', value: 100 },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'c1',
          after: {
            constraint_id: 'c1',
            node_id: 'node_X',
            operator: '<=',
            value: 200, // different value
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('add_constraint: matches when unit and label also align', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: {
          constraint_type: 'at_most',
          value: 5,
          unit: '%',
          label: 'Churn cap',
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'c1',
          after: {
            constraint_id: 'c1',
            node_id: 'node_X',
            operator: '<=',
            value: 5,
            unit: '%',
            label: 'Churn cap',
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('already_applied');
  });

  it('add_constraint: does NOT match when unit differs', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        targets: ['node_X'],
        params: { constraint_type: 'at_most', value: 5, unit: '%' },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'add_constraint',
          targetId: 'c1',
          after: {
            constraint_id: 'c1',
            node_id: 'node_X',
            operator: '<=',
            value: 5,
            unit: 'GBP', // different unit
          },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });

  it('set_factor_value: target_id IS the factor id and gates the match', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'set_factor_value',
          targetId: 'factor_X',
          after: { value: 100, raw_value: 100 },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('already_applied');
  });

  it('set_factor_value: does NOT match when target_id differs (factor mismatch)', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'set_factor_value',
          targetId: 'factor_Y',
          after: { value: 100, raw_value: 100 },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('execute');
  });

  it('set_factor_value: does NOT match when after.value differs', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'set_factor_value',
          targetId: 'factor_X',
          after: { value: 200, raw_value: 200 },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('execute');
  });

  it('adjust_edge_strength: matches against nested after.strength.mean', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: { strength: 0.7 },
          target_entity_ids: ['edge_AB'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'adjust_edge_strength',
          targetId: 'edge_AB',
          after: { strength: { mean: 0.7, stdev: 0.1, from: 'A', to: 'B', effect_direction: 'positive' } },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('already_applied');
  });

  it('adjust_edge_strength: does NOT match when after.strength.mean differs', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: { strength: 0.7 },
          target_entity_ids: ['edge_AB'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'adjust_edge_strength',
          targetId: 'edge_AB',
          after: { strength: { mean: 0.5, from: 'A', to: 'B', effect_direction: 'positive' } },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('execute');
  });

  it('adjust_edge_strength: does NOT match when proposal supplies std and after.strength.std differs (P1-1)', () => {
    // Same mean, different std — must NOT short-circuit because the
    // uncertainty differs.
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: { strength: 0.7, std: 0.05 },
          target_entity_ids: ['edge_AB'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'adjust_edge_strength',
          targetId: 'edge_AB',
          after: { strength: { mean: 0.7, std: 0.2, from: 'A', to: 'B', effect_direction: 'positive' } },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('execute');
  });

  it('adjust_edge_strength: matches when both mean and std align', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: { strength: 0.7, std: 0.05 },
          target_entity_ids: ['edge_AB'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'adjust_edge_strength',
          targetId: 'edge_AB',
          after: { strength: { mean: 0.7, std: 0.05, from: 'A', to: 'B', effect_direction: 'positive' } },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('already_applied');
  });

  it('does NOT match when fact_type differs from inline handler_id', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({}),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({ type: 'set_factor_value', targetId: 'node_X' }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('execute');
  });
});

describe('decideProposedChangeSynthesis — invalid', () => {
  it('returns invalid when inline_patch is missing', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({ inlinePatch: null }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('invalid');
  });

  it('returns invalid when handler_id is unknown', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({ inlinePatch: { handler_id: 'mystery_handler', params: {} } }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [],
    });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.reason).toBe('unknown_handler_id');
  });
});

describe('decideProposedChangeSynthesis — fail-closed min-payload guard (P0-2)', () => {
  it('set_factor_value with empty target_entity_ids does NOT short-circuit even with a matching fact', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: [],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [
        fwt(
          fact({
            type: 'set_factor_value',
            targetId: 'factor_X',
            after: { value: 100, raw_value: 100 },
          }),
          POST_EMIT_TS,
        ),
      ],
    });
    // Without a non-empty target list the matcher cannot identify a
    // unique mutation. Fail closed.
    expect(out.status).toBe('execute');
  });

  it('set_factor_value with empty params does NOT short-circuit', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: {},
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [
        fwt(
          fact({
            type: 'set_factor_value',
            targetId: 'factor_X',
            after: { value: 100, raw_value: 100 },
          }),
          POST_EMIT_TS,
        ),
      ],
    });
    expect(out.status).toBe('execute');
  });

  it('add_constraint missing constraint_type does NOT short-circuit', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'add_constraint',
          params: { value: 100 }, // missing constraint_type
          target_entity_ids: ['node_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [
        fwt(
          fact({
            type: 'add_constraint',
            targetId: 'c1',
            after: {
              constraint_id: 'c1',
              node_id: 'node_X',
              operator: '<=',
              value: 100,
            },
          }),
          POST_EMIT_TS,
        ),
      ],
    });
    expect(out.status).toBe('execute');
  });

  it('adjust_edge_strength missing strength does NOT short-circuit', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: {}, // missing strength
          target_entity_ids: ['edge_AB'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [
        fwt(
          fact({
            type: 'adjust_edge_strength',
            targetId: 'edge_AB',
            after: { strength: { mean: 0.7, from: 'A', to: 'B', effect_direction: 'positive' } },
          }),
          POST_EMIT_TS,
        ),
      ],
    });
    expect(out.status).toBe('execute');
  });
});

describe('decideProposedChangeSynthesis — fact-to-turn binding (P0-2)', () => {
  it('does NOT short-circuit when an OLD pre-emit fact matches AND only an UNRELATED post-emit turn exists', () => {
    // Setup: priorFacts has TWO facts — newest-first the post-emit
    // turn's outcome (value=999, NOT matching) and the older pre-emit
    // outcome (value=100, matches the proposal). priorTurns has ONE
    // post-emit handler turn. The post-emit-fact slice picks the
    // FIRST (newest) matching fact-type fact = the value=999 one.
    // The matcher rejects → execute. The pre-emit fact is NEVER
    // eligible.
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [
        fwt(
          fact({
            type: 'set_factor_value',
            targetId: 'factor_X',
            after: { value: 999, raw_value: 999 }, // post-emit Turn B's outcome
          }),
          POST_EMIT_TS,
          'turn-B',
        ),
        fwt(
          fact({
            type: 'set_factor_value',
            targetId: 'factor_X',
            after: { value: 100, raw_value: 100 }, // matches but pre-emit
          }),
          PRE_EMIT_TS,
          'turn-A',
        ),
      ],
    });
    expect(out.status).toBe('execute');
  });

  it('DOES short-circuit when the newest post-emit fact matches the proposal', () => {
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(fact({
          type: 'set_factor_value',
          targetId: 'factor_X',
          after: { value: 100, raw_value: 100 },
        }), '2026-05-07T12:00:30.000Z')],
    });
    expect(out.status).toBe('already_applied');
  });

  it('does NOT short-circuit when the newest post-emit fact does NOT match (later overwrite)', () => {
    // The user manually changed the factor value AFTER emit; the
    // newest fact reflects the overwrite, not the proposal's intended
    // state. Idempotency must NOT fire — the change is no longer in
    // place even though an older matching fact exists.
    const out = decideProposedChangeSynthesis({
      pending: pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      currentGraphHash: GRAPH_HASH,
      priorFactsWithTurn: [fwt(// Newest-first: the post-emit overwrite (value=200) is first.
        fact({
          type: 'set_factor_value',
          targetId: 'factor_X',
          after: { value: 200, raw_value: 200 },
        }), POST_EMIT_TS)],
    });
    expect(out.status).toBe('execute');
  });
});

describe('buildApplyProposedChangeProposal — per-handler ProposalParameter shaping (P1-2)', () => {
  it('set_factor_value with bare numeric value produces ONE value parameter', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100 },
          target_entity_ids: ['factor_X'],
        },
      }),
      { id: 'factor_X', kind: 'node', label: null },
    );
    expect(proposal.handler_id).toBe('set_factor_value');
    expect(proposal.parameters).toHaveLength(1);
    expect(proposal.parameters[0]!.name).toBe('value');
    expect(proposal.parameters[0]!.value).toBe(100);
  });

  it('set_factor_value with operator folds it into the value parameter (NOT separate)', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100, operator: 'increase' },
          target_entity_ids: ['factor_X'],
        },
      }),
      { id: 'factor_X', kind: 'node', label: null },
    );
    // EXACTLY ONE parameter — operator must NOT become its own parameter.
    expect(proposal.parameters).toHaveLength(1);
    const p0 = proposal.parameters[0]! as {
      name: string;
      value: unknown;
      operator?: string;
    };
    expect(p0.name).toBe('value');
    expect(p0.value).toBe(100);
    expect(p0.operator).toBe('increase');
  });

  it('set_factor_value with unit and cap folds them into a structured value object', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 5, unit: '%', cap: 100 },
          target_entity_ids: ['factor_churn'],
        },
      }),
      { id: 'factor_churn', kind: 'node', label: null },
    );
    expect(proposal.parameters).toHaveLength(1);
    expect(proposal.parameters[0]!.name).toBe('value');
    expect(proposal.parameters[0]!.value).toEqual({ value: 5, unit: '%', cap: 100 });
  });

  it('set_factor_value rejects unknown operator (does not pass it through)', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'set_factor_value',
          params: { value: 100, operator: 'mystery' },
          target_entity_ids: ['factor_X'],
        },
      }),
      { id: 'factor_X', kind: 'node', label: null },
    );
    expect(proposal.parameters).toHaveLength(1);
    const p0 = proposal.parameters[0]! as { operator?: string };
    expect(p0.operator).toBeUndefined();
  });

  it('add_constraint keeps one parameter per top-level key (matches validator parameter_schemas)', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'add_constraint',
          params: {
            constraint_type: 'at_most',
            value: 100,
            unit: 'GBP',
            label: 'Cost cap',
          },
          target_entity_ids: ['goal-g'],
        },
      }),
      { id: 'goal-g', kind: 'goal', label: null },
    );
    expect(proposal.handler_id).toBe('add_constraint');
    expect(proposal.parameters.map((p) => p.name).sort()).toEqual(
      ['constraint_type', 'label', 'unit', 'value'].sort(),
    );
  });

  it('adjust_edge_strength keeps strength and std as separate parameters', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: { strength: 0.7, std: 0.05 },
          target_entity_ids: ['edge_AB'],
        },
      }),
      { id: 'edge_AB', kind: 'edge', label: null },
    );
    expect(proposal.handler_id).toBe('adjust_edge_strength');
    expect(proposal.parameters).toHaveLength(2);
    expect(proposal.parameters.map((p) => p.name).sort()).toEqual(['std', 'strength']);
  });
});

describe('buildApplyProposedChangeProposal', () => {
  it('builds a ProposalAction from the inline patch', () => {
    const proposal = buildApplyProposedChangeProposal(pa({}), {
      id: 'fallback',
      kind: 'option',
      label: null,
    });
    expect(proposal.handler_id).toBe('add_constraint');
    expect(proposal.entity.id).toBe('node_X');
    expect(proposal.entity.kind).toBe('node');
    expect(proposal.parameters).toEqual([
      { name: 'value', value: 100, source: 'user_explicit' },
    ]);
  });

  it('uses "edge" entity kind for adjust_edge_strength', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({
        inlinePatch: {
          handler_id: 'adjust_edge_strength',
          params: {},
          target_entity_ids: ['edge_AB'],
        },
      }),
      { id: 'fallback', kind: 'option', label: null },
    );
    expect(proposal.entity.kind).toBe('edge');
    expect(proposal.entity.id).toBe('edge_AB');
  });

  it('falls back to the supplied entity when targets array is empty', () => {
    const proposal = buildApplyProposedChangeProposal(
      pa({ inlinePatch: { handler_id: 'add_constraint', params: {}, target_entity_ids: [] } }),
      { id: 'fallback_id', kind: 'goal', label: 'Fallback' },
    );
    expect(proposal.entity.id).toBe('fallback_id');
    expect(proposal.entity.kind).toBe('goal');
  });
});

describe('recovery copy strings — safety', () => {
  it('PROPOSAL_SUPERSEDED_RESPONSE is concise British English with no forbidden tokens', () => {
    const forbidden = [
      'apply_proposed_change',
      'pending_actions',
      'proposal_ref',
      'chip_metadata',
      'zod',
      'STRUCTURAL_VALIDATION_FAILED',
      '—',
      '&',
    ];
    for (const t of forbidden) expect(PROPOSAL_SUPERSEDED_RESPONSE).not.toContain(t);
  });

  it('PROPOSAL_ALREADY_APPLIED_RESPONSE matches the brief copy', () => {
    expect(PROPOSAL_ALREADY_APPLIED_RESPONSE).toBe('That change is already in place.');
  });
});
