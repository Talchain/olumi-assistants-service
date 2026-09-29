/**
 * Overnight review F10 — GOAL_TARGET_NOT_SAVED_TEXT falsely asserts "no
 * target" when an earlier-registered target survives the withheld write.
 *
 * With a previously persisted `goal_threshold_raw=20`, a failed
 * re-registration ("change it to 15") triggers swap + withhold; the
 * withheld write leaves the OLD target intact (the append RPC skips the
 * graph UPDATE on a null graph), so the analysis will still score against
 * 20 — while the fallback copy told the user "the model still has no
 * target… tell me it again", which is false: a target survives, just not
 * the one they wanted.
 *
 * Fix: `formatGoalTargetNotSavedText(persistedGraph)` branches on
 * persisted-target-present — names the surviving target instead of
 * claiming none exists.
 */
import { describe, it, expect } from 'vitest';

import {
  GOAL_TARGET_NOT_SAVED_TEXT,
  formatGoalTargetNotSavedText,
} from '../goal-target-receipt-guard.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../forbidden-user-facing-phrases.js';

describe('formatGoalTargetNotSavedText', () => {
  it('no previously-registered target: falls back to the generic honest "no target" copy, unchanged', () => {
    const bareGraph = {
      nodes: [{ id: 'g', kind: 'goal', label: 'Reduce Operating Costs' }],
      edges: [],
    };
    expect(formatGoalTargetNotSavedText(bareGraph)).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
  });

  it('a previously-registered target survives the withheld write: names the SURVIVING target instead of falsely claiming none exists', () => {
    const registeringGraph = {
      nodes: [
        {
          id: 'g',
          kind: 'goal',
          label: 'Reduce Operating Costs',
          goal_threshold_raw: 20,
          goal_threshold_unit: '%',
        },
      ],
      edges: [],
    };
    const text = formatGoalTargetNotSavedText(registeringGraph);
    expect(text).not.toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(text).not.toMatch(/still has no\s*(target|success target)/i);
    expect(text).toMatch(/20%/);
    expect(text).toMatch(/still registered|previous target/i);
    // Must still survive the egress safety guards.
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(findSuccessClaimHit(text)).toBeNull();
  });

  it('tolerates non-graph shapes without throwing (fails closed to the generic copy)', () => {
    expect(formatGoalTargetNotSavedText(null)).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(formatGoalTargetNotSavedText(undefined)).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(formatGoalTargetNotSavedText('not-a-graph')).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
  });
});
