/**
 * ROADMAP 2.920 — `goal_direction` is emitted for REDUCE goals and for nothing else.
 *
 * The asymmetry under test is the whole safety argument: `maximise` is
 * byte-identical to sending nothing on the wire (measured on isl-staging), so
 * emitting it could never improve an answer while a misclassification would
 * newly break an increase-goal that is correct today. Silence must therefore be
 * the outcome for EVERY class except `decrease`.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveEmittedGoalDirection,
  readGoalLabel,
} from '../goal-direction.js';
import { deriveGoalIntent } from '../../coaching/objective-contradiction.js';

const graph = (label: unknown, id = 'g1') => ({
  nodes: [
    { id: 'f1', kind: 'factor', label: 'Some input' },
    { id, kind: 'goal', label },
  ],
  edges: [],
});

describe('a REDUCE goal is attested as minimise', () => {
  // Labels are routed through deriveGoalIntent, whose own corpus suite owns
  // classification accuracy. These pin the MAPPING, and each asserts the
  // classifier's verdict alongside so a drift in either shows up here as a
  // disagreement rather than a silent pass.
  it.each([
    'Reduce monthly churn',
    'Cut operating cost',
    'Lower customer acquisition cost',
  ])('%s → minimise', (label) => {
    expect(deriveGoalIntent(label).direction).toBe('decrease');
    expect(deriveEmittedGoalDirection(graph(label), 'g1')).toBe('minimise');
  });
});

describe("'maximise' is NEVER emitted", () => {
  // ⭐ THE LOAD-BEARING CASE. An increase goal is ranked CORRECTLY today by
  // ISL's default maximiser. Emitting 'maximise' would change nothing on the
  // wire but would put a classifier in the path of an answer that is already
  // right — pure downside. Silence here is the feature, not an omission.
  it.each([
    'Increase monthly recurring revenue',
    'Grow retained revenue',
    'Raise average order value',
  ])('%s → nothing is emitted', (label) => {
    expect(deriveGoalIntent(label).direction).toBe('increase');
    expect(deriveEmittedGoalDirection(graph(label), 'g1')).toBeUndefined();
  });

  it('no label in the whole corpus of senses can produce maximise', () => {
    const senses = [
      'Reduce churn', 'Increase revenue', 'Keep churn steady',
      'Pick a pricing approach', '', 'Revenue',
    ];
    const emitted = senses.map((l) => deriveEmittedGoalDirection(graph(l), 'g1'));
    expect(emitted).not.toContain('maximise');
    expect(new Set(emitted.filter((e) => e !== undefined))).toEqual(new Set(['minimise']));
  });
});

describe('undetermined and unreadable inputs emit nothing (today behaviour, byte-for-byte)', () => {
  // ⭐ 'Improve conversion rate' is the instructive one: it LOOKS like an
  // increase goal to a human skimming, and the classifier declines it — because
  // "improve" states no direction over a quantity (improving churn means
  // lowering it, improving revenue means raising it). Declining is correct, and
  // it is the behaviour that keeps a false 'minimise' off the wire.
  it.each([
    'Pick a pricing approach',
    'Improve conversion rate',
  ])('%s is undetermined → nothing is emitted', (label) => {
    expect(deriveGoalIntent(label).direction).toBe('undetermined');
    expect(deriveEmittedGoalDirection(graph(label), 'g1')).toBeUndefined();
  });

  it.each([
    ['goal node absent from the graph', graph('Reduce churn', 'other'), 'g1'],
    ['a non-string label', graph(42), 'g1'],
    ['a whitespace-only label', graph('   '), 'g1'],
    ['a null label', graph(null), 'g1'],
    ['an empty goal id', graph('Reduce churn'), ''],
    ['a non-string goal id', graph('Reduce churn'), 42],
    ['a null graph', null, 'g1'],
    ['a graph with no nodes array', { edges: [] }, 'g1'],
    ['a graph whose nodes are not objects', { nodes: ['x', null, 7] }, 'g1'],
  ])('%s → undefined, never a throw', (_n, g, id) => {
    expect(() => deriveEmittedGoalDirection(g, id)).not.toThrow();
    expect(deriveEmittedGoalDirection(g, id)).toBeUndefined();
  });

  // A reduce goal must still resolve through the SAME defensive reader, or the
  // guards above would be passing for the wrong reason (nothing ever resolves).
  it('CONTROL: the defensive reader still finds a real label', () => {
    expect(readGoalLabel(graph('Reduce churn'), 'g1')).toBe('Reduce churn');
    expect(deriveEmittedGoalDirection(graph('Reduce churn'), 'g1')).toBe('minimise');
  });
});

describe('readGoalLabel honours its own contract, not merely its caller', () => {
  /**
   * ⚠ ADDED AFTER A SURVIVED MUTANT. Dropping the `.trim() !== ''` guard left
   * every `deriveEmittedGoalDirection` assertion GREEN, because a blank label
   * reaches `deriveGoalIntent`, classifies as `undetermined`, and washes out to
   * the same `undefined`. The end-to-end assertions genuinely could not see it.
   *
   * `readGoalLabel` is EXPORTED and promises "the label, or null". A blank
   * string is not a label, and any future caller that tests it for presence
   * rather than direction would read `'   '` as one. Pinned at the boundary
   * that makes the promise, not only through the caller that currently hides it.
   */
  it.each([
    ['whitespace-only', '   '],
    ['empty string', ''],
    ['tab and newline', '\t\n'],
  ])('a %s label is null, not a blank string', (_n, label) => {
    expect(readGoalLabel(graph(label), 'g1')).toBeNull();
  });

  it('CONTROL: a label with real content survives trimming untouched', () => {
    expect(readGoalLabel(graph('Reduce churn'), 'g1')).toBe('Reduce churn');
  });
});
