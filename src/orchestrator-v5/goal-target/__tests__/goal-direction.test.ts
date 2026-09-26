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
  judgeStampAgainstLabel,
  readGoalLabel,
  readGoalLabelForStamp,
} from '../goal-direction.js';
import { deriveGoalIntent, GOAL_LABEL_LEXICON } from '../../coaching/objective-contradiction.js';

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

/**
 * #1971, FAIL CLOSED (verify of 27c4e0ac): the stamp's judge reads a label as NEUTRAL only
 * when it carries NO word from the classifier's own lexicons and no negation word. These
 * pin that the judge is built from THOSE lexicons — every stem of every family, every
 * negation cue source and particle — rather than from a list of its own.
 */
describe('readGoalLabelForStamp: neutral means no word from the classifier\'s lexicons', () => {
  /** One real word per stem source: the stem plus its first inflection ('increas(?:e|…)?' → 'increase'). */
  const wordOf = (stem: string): string => stem.replace(/\(\?:([^|)]*)[^)]*\)\??/g, '$1');

  const families = [
    ['increase', GOAL_LABEL_LEXICON.increaseStems],
    ['decrease', GOAL_LABEL_LEXICON.decreaseStems],
    ['stasis', GOAL_LABEL_LEXICON.stasisStems],
    ['ambiguous', GOAL_LABEL_LEXICON.ambiguousStems],
  ] as const;
  for (const [family, stems] of families) {
    it(`every ${family} stem (${stems.length}) makes a label non-neutral, and the classifier's own regex agrees it is a word`, () => {
      expect(stems.length).toBeGreaterThan(0);
      const neutral = stems.map(wordOf).filter((word) => {
        expect(new RegExp(`^(?:${stems.join('|')})$`, 'i').test(word), word).toBe(true);
        return readGoalLabelForStamp(`${word} monthly churn`) === 'neutral';
      });
      expect(neutral).toEqual([]);
    });
  }

  it.each([
    'Avoid churn', 'Never churn', 'Stop churn', 'Prevent churn', 'Refuse churn', 'Churn without discounts',
    "Don't churn", 'Do not churn', 'Cannot churn', "Can't churn", 'No longer churn', 'Steer clear of churn',
    'Refrain from churn', 'Resist churn',
  ])('a negation cue of the classifier ("%s") makes a label unreadable', (label) => {
    expect(new RegExp(GOAL_LABEL_LEXICON.negationCueSource, 'i').test(label)).toBe(true);
    expect(readGoalLabelForStamp(label)).toBe('unreadable');
  });

  it.each([
    ['not', 'Not increase costs', 'Revenue not churn'],
    ['no', 'No churn increase', 'No churn'],
    ["n't", "Won't grow headcount", "Churn we shouldn't see"],
  ])('the particle %s (of "do not" / "no longer" / "don\'t") makes a label unreadable, with or without a stem', (_p, withStem, withoutStem) => {
    expect(readGoalLabelForStamp(withStem)).toBe('unreadable');
    expect(readGoalLabelForStamp(withoutStem)).toBe('unreadable');
  });

  it('the particles are the ones the classifier\'s multi-word cues are built from', () => {
    expect(GOAL_LABEL_LEXICON.negationParticleSources).toEqual(['not', 'no', "[a-z]*n['’]t"]);
    for (const cue of ['do not', 'no longer', "don't", "can't"]) {
      expect(new RegExp(GOAL_LABEL_LEXICON.negationCueSource, 'i').test(cue), cue).toBe(true);
    }
  });

  it.each([
    ['Monthly churn rate', 'neutral'],
    ['Pro MRR', 'neutral'],
    // A hyphen-joined particle is a compound noun, not a negation.
    ['No-show rate', 'neutral'],
    ['Not-for-profit revenue', 'neutral'],
    // A hyphen-joined STEM is still a word the classifier declines as a compound: fail closed.
    ['Reduce-churn', 'unreadable'],
    ['Lower-funnel conversion rate', 'unreadable'],
    ['Reduce monthly churn', 'minimise'],
    ['Grow revenue', 'maximise'],
    ['Revenue increased', 'unreadable'],
    ['Improve conversion rate', 'unreadable'],
    ['Keep churn at or below 5%', 'unreadable'],
  ] as const)('"%s" reads %s', (label, reading) => {
    expect(readGoalLabelForStamp(label)).toBe(reading);
  });

  it('a missing or blank label attests nothing (unreadable), never "neutral"', () => {
    expect(readGoalLabelForStamp(null)).toBe('unreadable');
    expect(readGoalLabelForStamp('   ')).toBe('unreadable');
    expect(judgeStampAgainstLabel(null, 'minimise')).toBe('label_unreadable');
  });

  it('the verdict: neutral or same sense attests; the other sense contradicts; the rest is unreadable', () => {
    expect(judgeStampAgainstLabel('Monthly churn rate', 'minimise')).toBe('attested');
    expect(judgeStampAgainstLabel('Monthly churn rate', 'maximise')).toBe('attested');
    expect(judgeStampAgainstLabel('Reduce churn', 'minimise')).toBe('attested');
    expect(judgeStampAgainstLabel('Reduce churn', 'maximise')).toBe('label_contradicts');
    expect(judgeStampAgainstLabel('Grow revenue', 'minimise')).toBe('label_contradicts');
    expect(judgeStampAgainstLabel('Churn reduced', 'maximise')).toBe('label_unreadable');
    expect(judgeStampAgainstLabel('Churn reduced', 'minimise')).toBe('label_unreadable');
  });
});
