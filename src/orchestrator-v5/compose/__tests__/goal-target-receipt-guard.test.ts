/**
 * Lane 20 — pure-logic pins for the goal-target receipt honesty guard.
 *
 * The integration altitude (real dispatch / executor seams) lives in
 * edit-graph-dispatch-goal-target-receipt.test.ts and
 * turn-executor-goal-target-commit-honesty.test.ts; this file pins the
 * predicate boundary so failures point at the guard module directly, and
 * sweeps the honest-fallback copy against the egress guards (a fallback
 * that the forbidden-phrase guard erases, or that reads as a success
 * claim, would be its own honesty failure).
 */

import { describe, it, expect } from 'vitest';

import {
  GOAL_TARGET_NOT_SAVED_TEXT,
  claimsGoalTargetRegistration,
  decideGoalTargetReceipt,
  graphRegistersGoalTarget,
} from '../goal-target-receipt-guard.js';
import { formatGoalTargetSet } from '../../tools/handlers/d1-shared/format-confirmation.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../forbidden-user-facing-phrases.js';

const LIVE_FALSE_RECEIPT =
  'Success target of 15% cost reduction set on the Reduce Operating Costs ' +
  'goal. Rerun the simulation to evaluate which options meet this threshold.';

describe('claimsGoalTargetRegistration', () => {
  it('matches both live emitters (formatGoalTargetSet and the captured edit_graph LLM ack)', () => {
    expect(
      claimsGoalTargetRegistration(
        formatGoalTargetSet({ goalLabel: 'Reduce Operating Costs', value: 15, unit: '%' }),
      ),
    ).toBe(true);
    expect(claimsGoalTargetRegistration(LIVE_FALSE_RECEIPT)).toBe(true);
  });

  it('matches state-descriptions of a registered target (verb after noun)', () => {
    expect(
      claimsGoalTargetRegistration('Your success target is set at 15% on this goal.'),
    ).toBe(true);
  });

  it('does NOT match offers, suggestions, or questions', () => {
    expect(
      claimsGoalTargetRegistration('Would you like to set a success target?'),
    ).toBe(false);
    expect(
      claimsGoalTargetRegistration(
        'You could set a success target of 15% to see your chances.',
      ),
    ).toBe(false);
    expect(
      claimsGoalTargetRegistration('Should the success target be set to 15%?'),
    ).toBe(false);
    expect(claimsGoalTargetRegistration('')).toBe(false);
    expect(claimsGoalTargetRegistration(null)).toBe(false);
    expect(claimsGoalTargetRegistration(undefined)).toBe(false);
  });

  it('the honest fallback is itself NOT a registration claim (no swap loop)', () => {
    expect(claimsGoalTargetRegistration(GOAL_TARGET_NOT_SAVED_TEXT)).toBe(false);
  });
});

describe('graphRegistersGoalTarget', () => {
  const goalWith = (extra: Record<string, unknown>) => ({
    nodes: [
      { id: 'g', kind: 'goal', label: 'G', ...extra },
      { id: 'f', kind: 'factor', label: 'F' },
    ],
    edges: [],
  });

  it('true only for a goal node carrying a finite goal_threshold_raw', () => {
    expect(graphRegistersGoalTarget(goalWith({ goal_threshold_raw: 15 }))).toBe(true);
    // The registration marker is _raw — the field has_goal_target /
    // decision-context key on. Normalised-only does not register.
    expect(graphRegistersGoalTarget(goalWith({ goal_threshold: 0.15 }))).toBe(false);
    // The live leak shape: non-contract `value` on the goal node.
    expect(
      graphRegistersGoalTarget(goalWith({ value: 0.15, type: 'percentage_reduction' })),
    ).toBe(false);
    expect(graphRegistersGoalTarget(goalWith({ goal_threshold_raw: NaN }))).toBe(false);
    expect(graphRegistersGoalTarget(goalWith({}))).toBe(false);
  });

  it('a threshold on a NON-goal node does not register', () => {
    expect(
      graphRegistersGoalTarget({
        nodes: [
          { id: 'g', kind: 'goal', label: 'G' },
          { id: 'f', kind: 'factor', label: 'F', goal_threshold_raw: 15 },
        ],
        edges: [],
      }),
    ).toBe(false);
  });

  it('tolerates non-graph shapes without throwing', () => {
    expect(graphRegistersGoalTarget(null)).toBe(false);
    expect(graphRegistersGoalTarget(undefined)).toBe(false);
    expect(graphRegistersGoalTarget('graph')).toBe(false);
    expect(graphRegistersGoalTarget({ nodes: 'not-an-array' })).toBe(false);
    expect(graphRegistersGoalTarget([])).toBe(false);
  });
});

describe('decideGoalTargetReceipt', () => {
  const registeringGraph = {
    nodes: [{ id: 'g', kind: 'goal', label: 'G', goal_threshold_raw: 15 }],
    edges: [],
  };
  const bareGraph = {
    nodes: [{ id: 'g', kind: 'goal', label: 'G' }],
    edges: [],
  };

  it('passes non-claims untouched', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: 'The analysis is ready to run.',
        commitGraph: null,
        persistedGraph: null,
      }),
    ).toEqual({ verdict: 'pass', reason: 'no_claim' });
  });

  it('a claim backed by THIS turn\'s commit graph passes', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: LIVE_FALSE_RECEIPT,
        commitGraph: registeringGraph,
        persistedGraph: bareGraph,
      }).verdict,
    ).toBe('pass');
  });

  it('a claim on a mutating turn whose commit graph does NOT register swaps — stale persisted state cannot lend honesty to a failed write', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: LIVE_FALSE_RECEIPT,
        commitGraph: bareGraph,
        persistedGraph: registeringGraph,
      }),
    ).toEqual({ verdict: 'swap', reason: 'unbacked_claim' });
  });

  it('a claim on a NON-mutating turn passes iff the persisted graph registers (honest state descriptions survive)', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: 'Your success target is set at 15%.',
        commitGraph: null,
        persistedGraph: registeringGraph,
      }).verdict,
    ).toBe('pass');
    expect(
      decideGoalTargetReceipt({
        assistantText: 'Your success target is set at 15%.',
        commitGraph: undefined,
        persistedGraph: bareGraph,
      }).verdict,
    ).toBe('swap');
  });
});

describe('GOAL_TARGET_NOT_SAVED_TEXT copy safety', () => {
  it('survives the egress forbidden-phrase guard', () => {
    expect(findForbiddenPhraseHit(GOAL_TARGET_NOT_SAVED_TEXT)).toBeNull();
  });
  it('does not read as a success claim', () => {
    expect(findSuccessClaimHit(GOAL_TARGET_NOT_SAVED_TEXT)).toBeNull();
  });
  it('asks for value + goal together in ONE message (the clarify-resume residual doctrine: no pending context exists, so the restatement must be self-contained)', () => {
    expect(GOAL_TARGET_NOT_SAVED_TEXT).toMatch(/one\s+message/i);
    expect(GOAL_TARGET_NOT_SAVED_TEXT).toMatch(/value/i);
    expect(GOAL_TARGET_NOT_SAVED_TEXT).toMatch(/goal/i);
  });
});
