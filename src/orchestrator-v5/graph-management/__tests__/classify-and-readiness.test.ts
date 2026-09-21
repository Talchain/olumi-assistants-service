/**
 * Track 3 — structural/tunable classifier + R6 EP2 readiness parity units.
 */
import { describe, it, expect } from 'vitest';
import { classifyMutation } from '../classify-mutation.js';
import { CANDIDATE_KINDS } from '../types.js';
import { assessCandidate, ep2Rank, readinessDowngraded, representableVerdict } from '../readiness-parity.js';
import { buildReadyGraph, buildUnconfiguredGraph } from './fixtures.js';

describe('classifyMutation — mechanical taxonomy (exhaustive)', () => {
  const expected: Record<string, 'structural' | 'tunable' | 'non_mutating'> = {
    add_node: 'structural',
    add_edge: 'structural',
    add_option: 'structural',
    remove_node: 'structural',
    remove_edge: 'structural',
    rename_node: 'tunable',
    update_node_field: 'tunable',
    update_edge_field: 'tunable',
    flag_uncertainty: 'non_mutating',
    clarification: 'non_mutating',
  };
  for (const kind of CANDIDATE_KINDS) {
    it(`${kind} → ${expected[kind]}`, () => {
      expect(classifyMutation(kind)).toBe(expected[kind]);
    });
  }
});

describe('R6 EP2 readiness parity', () => {
  const ready = assessCandidate(buildReadyGraph());
  const blocked = assessCandidate(buildUnconfiguredGraph());

  it('EP2 delegates: ready graph is ready, unconfigured graph is blocked', () => {
    expect(ready.state).toBe('ready');
    expect(blocked.state).toBe('blocked');
  });

  it('ep2Rank orders ready > repaired > blocked', () => {
    expect(ep2Rank('ready')).toBeGreaterThan(ep2Rank('repaired_for_analysis'));
    expect(ep2Rank('repaired_for_analysis')).toBeGreaterThan(ep2Rank('blocked'));
  });

  it('readinessDowngraded is true when the candidate is strictly worse than the base', () => {
    expect(readinessDowngraded(ready, blocked)).toBe(true);
    expect(readinessDowngraded(ready, ready)).toBe(false);
    expect(readinessDowngraded(blocked, ready)).toBe(false);
  });

  it('representableVerdict: ready→ready = would_apply; ready→blocked = held(downgrade); blocked→blocked = would_apply (neutral)', () => {
    expect(representableVerdict(ready, ready)).toEqual({ verdict: 'would_apply' });
    expect(representableVerdict(ready, blocked)).toEqual({ verdict: 'held', downgrade: true });
    expect(representableVerdict(blocked, blocked)).toEqual({ verdict: 'would_apply' });
  });
});
