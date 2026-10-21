/**
 * V5 — `recent_changes` projector branch for `edit_graph` facts (DL-7 PR B).
 *
 * Pins:
 *  - `EditGraphHandlerFact` with `noop: false` projects to a valid
 *    `RecentMutation` with `action: 'graph_edited'`.
 *  - `EditGraphHandlerFact` with `noop: true` is filtered (returns null
 *    via the existing line 134 noop filter).
 *  - The projection reads `safe_summary` verbatim and uses the first
 *    `affected_entities[].label` as `target_label`.
 *  - Empty `affected_entities` array (rare structural edit without a
 *    single target) falls back to a generic `target_label`.
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  RECENT_CHANGES_SUMMARY_MAX_CHARS,
  projectRecentChanges,
  type RecentChangeAction,
  type RecentMutation,
} from '../recent-changes.js';

function makeEditGraphFact(overrides: {
  noop?: boolean;
  status?: 'applied' | 'noop';
  safe_summary?: string;
  affected_entities?: Array<{ kind: string; label: string }>;
} = {}): HandlerFact {
  return {
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: overrides.noop ?? false,
    result: {
      edit_kind: 'parameter_update',
      status: overrides.status ?? 'applied',
      operations_count: 1,
      affected_entities:
        overrides.affected_entities ?? [{ kind: 'factor' as const, label: 'Price' }],
      graph_hash_before: 'hash_before',
      graph_hash_after: 'hash_after',
      safe_summary: overrides.safe_summary ?? 'Renamed Price factor.',
      impact: 'low' as const,
      rerun_recommended: false,
    },
  } as unknown as HandlerFact;
}

describe('projectRecentChanges — edit_graph branch', () => {
  it('R1 successful edit_graph fact projects to a graph_edited entry', () => {
    const facts = [makeEditGraphFact()];
    const out = projectRecentChanges(facts);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe('graph_edited');
    expect(out[0].summary).toBe('Renamed Price factor.');
    expect(out[0].target_label).toBe('Price');
  });

  it('R2 noop=true edit_graph fact is filtered (existing line 134 filter)', () => {
    const facts = [makeEditGraphFact({ noop: true })];
    const out = projectRecentChanges(facts);
    expect(out).toHaveLength(0);
  });

  it('R3 status=noop edit_graph fact is filtered (defence-in-depth at branch level)', () => {
    // The schema permits noop=false + status='noop' (cross-field
    // invariants are emitter-enforced). The projector defends against
    // this combination by also checking status.
    const facts = [makeEditGraphFact({ noop: false, status: 'noop' })];
    const out = projectRecentChanges(facts);
    expect(out).toHaveLength(0);
  });

  it("R3' status='rejected' edit_graph fact is filtered (defence-in-depth, Codex round-3 Improvement 3)", () => {
    // EditGraphHandlerFactSchema's status enum is `'applied' | 'noop'`
    // today, AND isSuccessfulAppliedMutation upstream excludes
    // rejected results from emitting a fact at all — so this code
    // path is unreachable in practice. The defence-in-depth filter
    // is here so that if a future schema bump adds 'rejected' (or
    // any non-applied status), the projector continues to refuse
    // to surface it as a recent change. The TypeScript cast widens
    // the typed `status` field to accept the test value.
    const facts = [
      makeEditGraphFact({
        noop: false,
        status: 'rejected' as unknown as 'applied' | 'noop',
      }),
    ];
    const out = projectRecentChanges(facts);
    expect(out).toHaveLength(0);
  });

  it('R4 empty affected_entities falls back to generic target_label', () => {
    const facts = [makeEditGraphFact({ affected_entities: [] })];
    const out = projectRecentChanges(facts);
    expect(out).toHaveLength(1);
    expect(out[0].target_label).toBe('the decision model');
  });

  it('R5 first affected entity wins when multiple are present', () => {
    const facts = [
      makeEditGraphFact({
        affected_entities: [
          { kind: 'factor', label: 'First' },
          { kind: 'option', label: 'Second' },
          { kind: 'edge', label: 'Third' },
        ],
      }),
    ];
    const out = projectRecentChanges(facts);
    expect(out[0].target_label).toBe('First');
  });

  it('R5b bounds a pathological producer-attested target label visibly', () => {
    const out = projectRecentChanges([
      makeEditGraphFact({
        affected_entities: [{ kind: 'factor', label: 'L'.repeat(60_000) }],
      }),
    ]);

    expect(out[0].target_label).toHaveLength(
      RECENT_CHANGES_SUMMARY_MAX_CHARS,
    );
    expect(out[0].target_label).toMatch(/…$/);
  });

  it('R6 multiple edit_graph facts in newest-first order populate the cap', () => {
    const facts = [
      makeEditGraphFact({ safe_summary: 'Newest edit.' }),
      makeEditGraphFact({ safe_summary: 'Middle edit.' }),
      makeEditGraphFact({ safe_summary: 'Oldest edit.' }),
    ];
    const out = projectRecentChanges(facts);
    expect(out).toHaveLength(3);
    expect(out[0].summary).toBe('Newest edit.');
    expect(out[2].summary).toBe('Oldest edit.');
  });

  it('R7 mixed edit_graph + D1 facts coexist in the projection', () => {
    const editFact = makeEditGraphFact({ safe_summary: 'Renamed Price factor.' });
    const setFactorFact: HandlerFact = {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop: false,
      result: {
        target_id: 'fac_churn',
        status: 'applied',
        before: { value: 0.04, raw_value: 4, unit: 'percent', label: 'Customer churn' },
        after: { value: 0.05, raw_value: 5, unit: 'percent', label: 'Customer churn' },
      },
    } as unknown as HandlerFact;
    const out = projectRecentChanges([editFact, setFactorFact]);
    expect(out).toHaveLength(2);
    expect(out[0].action).toBe('graph_edited');
    expect(out[1].action).toBe('factor_value_updated');
  });
});

// ---------------------------------------------------------------------------
// V5 stale-aware explain recovery — the projection's output shape.
//
// These rows once validated each projection against `RecentMutationSchema`
// (`context-pack-schema.ts`). That schema was deleted with the rest of the
// ContextPack schema (Track 2 deletion 9), so the same three properties are
// now asserted DIRECTLY on the live projector's output: the action enum, the
// summary/target_label length bound and a strict key set.
// ---------------------------------------------------------------------------

/**
 * The action enum, DERIVED from the live union: adding a member to
 * `RecentChangeAction` without listing it here fails typecheck.
 */
const RECENT_CHANGE_ACTIONS = Object.keys({
  constraint_added: true,
  factor_value_updated: true,
  link_strength_updated: true,
  graph_edited: true,
} satisfies Record<RecentChangeAction, true>) as readonly RecentChangeAction[];

/** Every key a `RecentMutation` may carry; anything else is a leak. */
const RECENT_MUTATION_KEYS: ReadonlySet<string> = new Set([
  'action',
  'summary',
  'target_label',
  'transition',
  'constraint_not_checkable',
]);

function expectLiveRecentMutationShape(m: RecentMutation): void {
  expect(Object.keys(m).filter((k) => !RECENT_MUTATION_KEYS.has(k))).toEqual([]);
  expect(RECENT_CHANGE_ACTIONS).toContain(m.action);
  expect(typeof m.summary).toBe('string');
  expect(m.summary.length).toBeLessThanOrEqual(RECENT_CHANGES_SUMMARY_MAX_CHARS);
  expect(typeof m.target_label).toBe('string');
  expect(m.target_label.length).toBeLessThanOrEqual(RECENT_CHANGES_SUMMARY_MAX_CHARS);
}

describe('projection output shape (rebound from the deleted RecentMutationSchema)', () => {
  // Fact builders for each `RecentChangeAction` the projection can emit.
  function makeAddConstraintFact(): HandlerFact {
    return {
      fact_type: 'add_constraint',
      fact_version: 1,
      noop: false,
      result: {
        target_id: 'gc-1',
        status: 'applied',
        before: null,
        after: {
          constraint_id: 'gc-1',
          node_id: 'fac_cost',
          operator: '<=',
          value: 50000,
          label: 'Total cost',
          unit: '£',
          provenance: 'explicit',
        },
      },
    } as unknown as HandlerFact;
  }

  function makeSetFactorValueFact(): HandlerFact {
    return {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop: false,
      result: {
        target_id: 'fac_churn',
        status: 'applied',
        before: { value: 0.04, raw_value: 4, unit: 'percent', label: 'Customer churn' },
        after: { value: 0.05, raw_value: 5, unit: 'percent', label: 'Customer churn' },
      },
    } as unknown as HandlerFact;
  }

  function makeAdjustEdgeStrengthFact(): HandlerFact {
    return {
      fact_type: 'adjust_edge_strength',
      fact_version: 1,
      noop: false,
      result: {
        target_id: 'edge_x_y',
        status: 'applied',
        before: { strength: { mean: 0.4 } },
        after: { strength: { mean: 0.6 } },
      },
    } as unknown as HandlerFact;
  }

  function makeEditGraphFactDefault(): HandlerFact {
    return makeEditGraphFact({ safe_summary: 'Strengthened the price → revenue edge.' });
  }

  it.each([
    ['add_constraint', makeAddConstraintFact, 'constraint_added' as const],
    ['set_factor_value', makeSetFactorValueFact, 'factor_value_updated' as const],
    ['adjust_edge_strength', makeAdjustEdgeStrengthFact, 'link_strength_updated' as const],
    ['edit_graph', makeEditGraphFactDefault, 'graph_edited' as const],
  ])(
    'projection of a %s fact (action=%s) has the strict RecentMutation shape',
    (_factType, build, expectedAction) => {
      const projection = projectRecentChanges([build()]);
      expect(projection).toHaveLength(1);
      expect(projection[0].action).toBe(expectedAction);
      expect(Object.keys(projection[0]).sort()).toEqual(['action', 'summary', 'target_label']);
      expectLiveRecentMutationShape(projection[0]);
    },
  );

  it('drift guard: the four fact builders emit EXACTLY the RecentChangeAction enum', () => {
    // Drift signal: a new RecentChangeAction member fails typecheck at
    // RECENT_CHANGE_ACTIONS; a projector that stops emitting one of them, or
    // emits a value outside the union, REDs here.
    const emitted = [
      makeAddConstraintFact,
      makeSetFactorValueFact,
      makeAdjustEdgeStrengthFact,
      makeEditGraphFactDefault,
    ].map((build) => projectRecentChanges([build()])[0]!.action);
    expect([...emitted].sort()).toEqual([...RECENT_CHANGE_ACTIONS].sort());
  });
});
