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
