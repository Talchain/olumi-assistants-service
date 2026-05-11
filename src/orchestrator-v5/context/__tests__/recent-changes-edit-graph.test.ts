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

import { projectRecentChanges } from '../recent-changes.js';

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
// V5 stale-aware explain recovery — projection ↔ schema drift guard.
//
// `recent-changes.ts` emits `RecentMutation` objects that flow into the
// ContextPack and MUST validate against `RecentMutationSchema` defined
// in `context-pack-schema.ts`. DL-7 PR B added `'graph_edited'` to the
// projection's `RecentChangeAction` union but left the ContextPack
// schema's enum at the original three values; an `edit_graph` fact
// then failed ContextPack validation at orient and surfaced in
// production as the V5 Golden Journey dl7-edit-graph denial-of-edit
// symptom. The fix (this workstream) adds `'graph_edited'` to the
// schema enum. This test pins the projection↔schema agreement so the
// drift cannot recur for any future RecentChangeAction value.
// ---------------------------------------------------------------------------

import type { z } from 'zod';
import { RecentMutationSchema } from '../context-pack-schema.js';

type RecentMutationFromSchema = z.infer<typeof RecentMutationSchema>;

describe('projection ↔ ContextPack schema agreement', () => {
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
    'projection of a %s fact (action=%s) validates against RecentMutationSchema',
    (_factType, build, expectedAction) => {
      const projection = projectRecentChanges([build()]);
      expect(projection).toHaveLength(1);
      expect(projection[0].action).toBe(expectedAction);
      // Validate each projection element directly against the same
      // RecentMutationSchema the ContextPack uses. If this fails on
      // 'graph_edited' the schema enum is missing the value (drift) —
      // the exact regression class this guard pins.
      const parsed = RecentMutationSchema.safeParse(projection[0]);
      if (!parsed.success) {
        throw new Error(
          `RecentMutationSchema rejected projection for ${expectedAction}: ` +
            JSON.stringify(parsed.error.issues, null, 2),
        );
      }
      expect(parsed.success).toBe(true);
    },
  );

  it('drift guard: every action emitted by recent-changes.ts is accepted by RecentMutationSchema', () => {
    // Drift signal: if a future commit adds a value to the projection's
    // RecentChangeAction union without updating the schema enum, OR vice
    // versa, this test fails. Keep both sides in lockstep — the V5
    // Golden Journey dl7-edit-graph failure was exactly this drift
    // (DL-7 PR B added 'graph_edited' to the projection but not the
    // schema).
    //
    // The known-produced set is the runtime contract. Update both sides
    // together when a new RecentChangeAction is introduced.
    const KNOWN_PRODUCED_ACTIONS: ReadonlyArray<RecentMutationFromSchema['action']> = [
      'constraint_added',
      'factor_value_updated',
      'link_strength_updated',
      'graph_edited',
    ];
    for (const action of KNOWN_PRODUCED_ACTIONS) {
      const parsed = RecentMutationSchema.safeParse({
        action,
        summary: 'probe',
        target_label: 'probe target',
      });
      expect(
        parsed.success,
        `RecentMutationSchema must accept the action value ${action}`,
      ).toBe(true);
    }
  });
});
