/**
 * ROADMAP 2.1003 — the no-change verdict.
 *
 * RED-first. At pristine `6b8698a4` this module does not exist and every test
 * here fails at import.
 *
 * The oracle is derived from the PRODUCER's declared semantics, not from my
 * reading of what the fields ought to mean (trap 13c): `graph-hash.ts`'s own
 * doc-comment enumerates exactly which fields `computeAnalysisAffectingGraphHash`
 * includes and excludes, and the tests below assert against that list.
 */
import { describe, it, expect } from 'vitest';

import {
  computeUserMeaningfulModelHash,
  evaluateEditModelChange,
} from '../edit-outcome-binding.js';

function graph(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      {
        id: 'fac_cs_coverage_depth',
        kind: 'factor',
        label: 'Customer Success Coverage Depth',
        display_value: '20%',
        observed_state: { value: 20, baseline: 20, unit: '%' },
      },
      {
        id: 'fac_onboarding',
        kind: 'factor',
        label: 'Onboarding Quality',
        display_value: '35%',
        observed_state: { value: 35, unit: '%' },
      },
      { id: 'goal_1', kind: 'goal', label: 'Improve NRR' },
    ],
    edges: [
      {
        from: 'fac_cs_coverage_depth',
        to: 'goal_1',
        edge_type: 'causal',
        strength: { mean: 0.4, std: 0.1 },
        effect_direction: 'positive',
      },
    ],
    ...overrides,
  };
}

/** Deep clone with the SAME content but a different key order at every level. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderKeys) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = reorderKeys(v);
    return out as T;
  }
  return value;
}

describe('computeUserMeaningfulModelHash', () => {
  it('is stable across a pure key-order re-serialisation (the PLoT round-trip case)', () => {
    const a = graph();
    const b = reorderKeys(graph());
    // PRECONDITION PINNED IN-TEST (trap 13b, third face): the fixture must
    // ACTUALLY have a different key order, or this test proves nothing.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(computeUserMeaningfulModelHash(a)).toBe(computeUserMeaningfulModelHash(b));
  });

  it('is stable when a producer annotates passthrough fields the user never sees', () => {
    const before = graph();
    const after = graph();
    // PLoT legitimately annotates these; they are not the user's model.
    (after.edges[0] as Record<string, unknown>).validation = { ok: true };
    (after.edges[0] as Record<string, unknown>).defaulted = ['std'];
    (after.nodes[0] as Record<string, unknown>).provenance_display = 'AI inferred';
    expect(computeUserMeaningfulModelHash(before)).toBe(computeUserMeaningfulModelHash(after));
  });

  it('MOVES when observed_state.value moves — the measured 20 -> 40 case', () => {
    const before = graph();
    const after = graph();
    (after.nodes[0].observed_state as Record<string, unknown>).value = 40;
    expect(computeUserMeaningfulModelHash(before)).not.toBe(computeUserMeaningfulModelHash(after));
  });

  it('MOVES on a rename — the field the analysis-affecting hash deliberately excludes', () => {
    const before = graph();
    const after = graph();
    after.nodes[0].label = 'CS Coverage Depth (renamed)';
    // This is the reason a bare `computeAnalysisAffectingGraphHash` is not
    // sufficient here: it excludes labels so a rename does not falsely stale
    // an analysis. Correct for freshness, wrong for "did the user change
    // anything" — a rename IS a change the user made.
    expect(computeUserMeaningfulModelHash(before)).not.toBe(computeUserMeaningfulModelHash(after));
  });

  it('does NOT move when only display_value moves (a display-anchor repair is not a second change)', () => {
    const before = graph();
    const after = graph();
    after.nodes[0].display_value = '40%';
    expect(computeUserMeaningfulModelHash(before)).toBe(computeUserMeaningfulModelHash(after));
  });

  it('MOVES on an edge strength change', () => {
    const before = graph();
    const after = graph();
    (after.edges[0].strength as Record<string, unknown>).mean = 0.8;
    expect(computeUserMeaningfulModelHash(before)).not.toBe(computeUserMeaningfulModelHash(after));
  });

  it('returns null only for a null/undefined graph', () => {
    expect(computeUserMeaningfulModelHash(null)).toBeNull();
    expect(computeUserMeaningfulModelHash(undefined)).toBeNull();
  });

  it('IS TOTAL — a malformed graph yields null, never a throw', () => {
    // MEASURED, by calling it: `computeAnalysisAffectingGraphHash` throws when
    // `edges` is absent ("Cannot read properties of undefined (reading 'map')").
    // This helper sits on the critical path of every edit, so an uncaught
    // throw would cost the user an edit that otherwise succeeded.
    // ⚠ Not claimed: that any existing test reaches it. A mutant removing the
    // guard leaves the V3-invalid-base integration case GREEN — these
    // assertions are the ONLY thing holding the guard in place.
    expect(computeUserMeaningfulModelHash({ nodes: [{ id: 'a' }] })).toBeNull();
    expect(computeUserMeaningfulModelHash({ edges: [] })).toBeNull();
    expect(computeUserMeaningfulModelHash('not a graph')).toBeNull();
    expect(computeUserMeaningfulModelHash(42)).toBeNull();
  });

  it('a graph whose hash cannot be computed produces NO VERDICT, never "unchanged"', () => {
    // The dangerous failure mode would be two nulls comparing equal and
    // reading as "unchanged" — the product would then tell the user nothing
    // happened on a turn that did change the model.
    const malformed = { nodes: [{ id: 'a' }] };
    expect(evaluateEditModelChange(malformed, malformed).verdict).toBe('not_applicable');
  });
});

describe('evaluateEditModelChange', () => {
  it('the identical-replay case reads UNCHANGED', () => {
    const before = graph();
    const after = reorderKeys(graph());
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('the real 20 -> 40 edit reads CHANGED', () => {
    const before = graph();
    const after = graph();
    (after.nodes[0].observed_state as Record<string, unknown>).value = 40;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('A GUESS IS NOT A VERDICT: a missing applied graph is not_applicable, never "unchanged"', () => {
    expect(evaluateEditModelChange(graph(), null).verdict).toBe('not_applicable');
    expect(evaluateEditModelChange(null, graph()).verdict).toBe('not_applicable');
    expect(evaluateEditModelChange(undefined, undefined).verdict).toBe('not_applicable');
  });

  it('NEVER reads a producer-supplied graph_hash — the §3.3 landmine, as an explicit case', () => {
    // The applied graph carries a PLoT-format `graph_hash` in a DIFFERENT
    // format from anything we compute. If the predicate ever read it, the
    // verdict would flip to `changed` here. It must stay `unchanged`.
    const before = graph();
    const after = graph({ graph_hash: 'plot-format-hash-not-ours-0123456789abcdef' });
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });
});
