/**
 * Pin the harness's canonical step list. The brief specifies exactly 10
 * steps in a fixed order; this test fails if any are added, removed, or
 * renamed without a conscious update here.
 */

import { describe, expect, it } from 'vitest';

import { CANONICAL_STEPS } from '../../../tools/v5-journey-replay/steps.js';

const EXPECTED_STEP_NAMES = [
  '1_draft_graph',
  '1a_assist_draft_graph',
  '2_weakest_option',
  '3_add_option',
  '4_run_analysis',
  '5_explain_leader',
  '6_edit_budget',
  '7_stale_explanation',
  '8_rerun_via_chip',
  '9_what_would_flip',
] as const;

describe('CANONICAL_STEPS — pinned list', () => {
  it('exposes exactly the 10 expected step names in the expected order', () => {
    const actualNames = CANONICAL_STEPS.map((s) => s.name);
    expect(actualNames).toEqual(EXPECTED_STEP_NAMES);
  });

  it('contains exactly 10 entries — no more, no fewer', () => {
    expect(CANONICAL_STEPS).toHaveLength(EXPECTED_STEP_NAMES.length);
  });

  it('every step name is unique', () => {
    const names = CANONICAL_STEPS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
