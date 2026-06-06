/**
 * V5 replay harness — Branch A journey registry/shape pin.
 *
 * Locks the `branch-a-canonical` journey definition: step order, which
 * steps run today vs. which are gated behind PR #236 (`requires_branch_a`),
 * and the two no-HTTP step kinds (assert-only proposal check, DB
 * read-back). A regression that drops a step, reorders the chain, or
 * flips a pending flag fails here.
 */

import { describe, it, expect } from 'vitest';

import {
  JOURNEY_IDS,
  JOURNEY_REGISTRY,
  type JourneyStep,
} from '../../../tools/v5-journey-replay/steps.js';

const steps: readonly JourneyStep[] = JOURNEY_REGISTRY['branch-a-canonical'];
const byName = (name: string): JourneyStep => {
  const s = steps.find((st) => st.name === name);
  if (s === undefined) throw new Error(`missing step ${name}`);
  return s;
};

describe('branch-a-canonical journey registration', () => {
  it('is a selectable journey id', () => {
    expect(JOURNEY_IDS).toContain('branch-a-canonical');
  });

  it('has the full 8-step flip → propose → apply → stale → what-changed chain', () => {
    expect(steps.map((s) => s.name)).toEqual([
      '1_draft_graph',
      '2_run_analysis',
      '3_what_would_flip',
      '4_flip_proposal_present',
      '5_accept_proposal',
      '6_db_readback',
      '7_explain_leader_stale',
      '8_what_changed',
    ]);
  });

  it('runs steps 1-3 today (no Branch A gate)', () => {
    for (const name of ['1_draft_graph', '2_run_analysis', '3_what_would_flip']) {
      expect(byName(name).requires_branch_a ?? false).toBe(false);
    }
  });

  it('gates steps 4-8 behind PR #236 (requires_branch_a)', () => {
    for (const name of [
      '4_flip_proposal_present',
      '5_accept_proposal',
      '6_db_readback',
      '7_explain_leader_stale',
      '8_what_changed',
    ]) {
      expect(byName(name).requires_branch_a).toBe(true);
    }
  });

  it('marks the proposal-present step assert-only and the read-back step db_readback', () => {
    expect(byName('4_flip_proposal_present').assert_only).toBe(true);
    expect(byName('4_flip_proposal_present').db_readback ?? false).toBe(false);
    expect(byName('6_db_readback').db_readback).toBe(true);
    expect(byName('6_db_readback').assert_only ?? false).toBe(false);
  });

  it('chains post-mutation steps off the accept-proposal step', () => {
    expect(byName('5_accept_proposal').depends_on).toBe('4_flip_proposal_present');
    expect(byName('6_db_readback').depends_on).toBe('5_accept_proposal');
    expect(byName('7_explain_leader_stale').depends_on).toBe('5_accept_proposal');
    expect(byName('8_what_changed').depends_on).toBe('5_accept_proposal');
  });
});
