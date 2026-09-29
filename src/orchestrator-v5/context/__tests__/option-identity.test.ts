/**
 * Unit tests for the V5 option-identity comparison module (the freshness guard
 * helper). Covers ID extraction from the RAW graph + the real persisted-fact
 * shape, and the fail-closed comparison rules.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  compareAnalysedOptionIdentity,
  extractAnalysedLeaderId,
  extractAnalysedOptionIds,
  extractGraphOptionIds,
} from '../option-identity.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Build a run_analysis fact with a chosen option_comparison + leader shape. */
function mkFact(opts: {
  leadingOptionId?: string | null;
  optionComparison?: ReadonlyArray<Record<string, unknown>>;
  // When set, override enrichment entirely (e.g. to omit option_comparison).
  enrichment?: Record<string, unknown>;
  winProbabilities?: Record<string, number>;
}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> =
    opts.enrichment ??
    (opts.optionComparison !== undefined
      ? { option_comparison: opts.optionComparison }
      : {});
  const result: Record<string, unknown> = {
    scenario_id: SCENARIO_ID,
    leading_option_id: opts.leadingOptionId ?? 'opt_a',
    summary: 'Ran analysis.',
    enrichment,
  };
  if (opts.winProbabilities !== undefined) result.win_probabilities = opts.winProbabilities;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as RunAnalysisHandlerFact;
}

describe('extractGraphOptionIds', () => {
  it('reads option IDs from a raw (unparsed) graph object', () => {
    const graph = { options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] };
    expect(extractGraphOptionIds(graph)).toEqual(['A', 'B', 'C']);
  });

  it('returns null when options is absent (indeterminate)', () => {
    expect(extractGraphOptionIds({ nodes: [], edges: [] })).toBeNull();
    expect(extractGraphOptionIds(null)).toBeNull();
    expect(extractGraphOptionIds(undefined)).toBeNull();
    expect(extractGraphOptionIds('not-an-object')).toBeNull();
  });

  it('preserves an empty options array as [] (a real zero-option graph)', () => {
    expect(extractGraphOptionIds({ options: [] })).toEqual([]);
  });

  it('skips non-string / empty ids and de-dupes', () => {
    const graph = {
      options: [{ id: 'A' }, { id: '' }, { id: 42 }, null, { id: 'A' }, { id: 'B' }],
    };
    expect(extractGraphOptionIds(graph)).toEqual(['A', 'B']);
  });

  it('reads from a raw graph even when it would fail a strict schema parse', () => {
    // Missing required nodes/edges etc. — extraction does NOT require a parse.
    const unparseable = { options: [{ id: 'X' }, { id: 'Y' }], garbage: true };
    expect(extractGraphOptionIds(unparseable)).toEqual(['X', 'Y']);
  });

  it('reads option-kind NODES (GraphV3 / canvas representation)', () => {
    const graph = {
      nodes: [
        { id: 'goal', kind: 'goal' },
        { id: 'opt_a', kind: 'option' },
        { id: 'fac', kind: 'factor' },
        { id: 'opt_b', kind: 'option' },
      ],
      edges: [],
    };
    expect(extractGraphOptionIds(graph)).toEqual(['opt_a', 'opt_b']);
  });

  it('unions top-level options[] and option nodes in one ID namespace', () => {
    const graph = {
      options: [{ id: 'opt_a' }],
      nodes: [{ id: 'opt_a', kind: 'option' }, { id: 'opt_b', kind: 'option' }],
    };
    expect(extractGraphOptionIds(graph)).toEqual(['opt_a', 'opt_b']);
  });

  it('returns null when there are nodes but none are options and no options[] array', () => {
    const graph = { nodes: [{ id: 'g', kind: 'goal' }, { id: 'f', kind: 'factor' }], edges: [] };
    expect(extractGraphOptionIds(graph)).toBeNull();
  });
});

describe('extractAnalysedOptionIds / extractAnalysedLeaderId', () => {
  it('reads analysed IDs from enrichment.option_comparison[].option_id (∪ .id fallback)', () => {
    const fact = mkFact({
      leadingOptionId: 'opt_a',
      optionComparison: [
        { option_id: 'opt_a', win_probability: 0.6 },
        { id: 'opt_b', win_probability: 0.4 }, // id fallback when option_id absent
      ],
    });
    expect(extractAnalysedOptionIds(fact)).toEqual(['opt_a', 'opt_b']);
    expect(extractAnalysedLeaderId(fact)).toBe('opt_a');
  });

  it('does NOT treat win_probabilities keys (labels) as option IDs', () => {
    // win_probabilities is keyed by LABEL in production; option_comparison is absent.
    const fact = mkFact({
      enrichment: {}, // no option_comparison
      winProbabilities: { 'Hire Locally': 0.7, 'Go Offshore': 0.3 },
    });
    // No option_comparison ⇒ analysed IDs indeterminate (null), NOT the labels.
    expect(extractAnalysedOptionIds(fact)).toBeNull();
  });

  it('returns null when option_comparison has no usable option_id', () => {
    const fact = mkFact({ optionComparison: [{ win_probability: 0.5 }, { label: 'X' }] });
    expect(extractAnalysedOptionIds(fact)).toBeNull();
  });

  it('returns null leader for an empty leading_option_id', () => {
    const fact = mkFact({ leadingOptionId: '', optionComparison: [{ option_id: 'opt_a' }] });
    expect(extractAnalysedLeaderId(fact)).toBeNull();
  });

  it('returns null for a non-run_analysis fact', () => {
    const other = { fact_type: 'edit_graph', noop: false, result: {} } as unknown as HandlerFact;
    expect(extractAnalysedOptionIds(other)).toBeNull();
    expect(extractAnalysedLeaderId(other)).toBeNull();
  });

  it('REGRESSION: extracts the option IDs from the REAL captured staging fact shape', () => {
    // The authoritative carrier — verified against the captured staging payload.
    const fixture = JSON.parse(
      readFileSync(
        new URL('../../../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.json', import.meta.url),
        'utf-8',
      ),
    ) as { blocks: Array<{ leading_option_id?: string; enrichment: Record<string, unknown> }> };
    const block = fixture.blocks[0]!;
    // Reconstruct a persisted fact from the real wire enrichment + leader.
    const fact = mkFact({
      leadingOptionId: block.leading_option_id ?? null,
      enrichment: block.enrichment,
    });
    expect(extractAnalysedOptionIds(fact)).toEqual([
      'opt_hire_local',
      'opt_offshore',
      'opt_status_quo',
      'opt_tiered_pricing',
    ]);
    expect(extractAnalysedLeaderId(fact)).toBe('opt_hire_local');
  });
});

describe('compareAnalysedOptionIdentity', () => {
  it('matches when analysed IDs + leader are all present in the current graph', () => {
    const v = compareAnalysedOptionIdentity(['A', 'B', 'C'], 'A', ['A', 'B', 'C']);
    expect(v).toEqual({ match: true, reason: 'match' });
  });

  it('fails closed: recovered-session leader absent (A/B/C analysed leader A vs current X/Y/C)', () => {
    // Analysed X/Y/C, leader X; current graph A/B/C — the brief's failure class.
    const v = compareAnalysedOptionIdentity(['X', 'Y', 'C'], 'X', ['A', 'B', 'C']);
    expect(v.match).toBe(false);
    expect(v.reason).toBe('leader_absent');
  });

  it('fails closed: an analysed option absent from the current graph', () => {
    // Leader is present, but Y was analysed and no longer exists on the canvas.
    const v = compareAnalysedOptionIdentity(['A', 'Y'], 'A', ['A', 'B', 'C']);
    expect(v.match).toBe(false);
    expect(v.reason).toBe('analysed_option_absent');
  });

  it('fails closed: the current graph added an option the analysis never saw', () => {
    const v = compareAnalysedOptionIdentity(['A', 'B'], 'A', ['A', 'B', 'D']);
    expect(v.match).toBe(false);
    expect(v.reason).toBe('current_option_added');
  });

  it('indeterminate (match) when the current graph has no options to compare', () => {
    expect(compareAnalysedOptionIdentity(['A'], 'A', null)).toEqual({
      match: true,
      reason: 'indeterminate',
    });
    expect(compareAnalysedOptionIdentity(['A'], 'A', [])).toEqual({
      match: true,
      reason: 'indeterminate',
    });
  });

  it('indeterminate (match) when there are no analysed IDs and no leader', () => {
    expect(compareAnalysedOptionIdentity(null, null, ['A', 'B'])).toEqual({
      match: true,
      reason: 'indeterminate',
    });
  });

  it('leader-only (no option_comparison set): runs ONLY the leader check, no false current_option_added', () => {
    // Leader present in current graph; no analysed set known ⇒ cannot assert
    // added/removed options ⇒ match (avoids a false positive).
    expect(compareAnalysedOptionIdentity(null, 'A', ['A', 'B', 'C'])).toEqual({
      match: true,
      reason: 'match',
    });
    // Leader absent ⇒ fail closed even without the analysed set.
    expect(compareAnalysedOptionIdentity(null, 'Z', ['A', 'B', 'C'])).toEqual({
      match: false,
      reason: 'leader_absent',
    });
  });

  it('does no label-based blocking — comparison is IDs only', () => {
    // Same IDs, different labels would be irrelevant here (no labels passed).
    expect(compareAnalysedOptionIdentity(['opt_a'], 'opt_a', ['opt_a']).match).toBe(true);
  });
});
