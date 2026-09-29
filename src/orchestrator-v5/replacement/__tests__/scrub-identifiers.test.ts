/**
 * The scrub. Its regression corpus is not from my head: these sentences were
 * produced by EXECUTING the shared egress scrub's own extracted regexes on
 * 20 Sep, and each one is a sentence that scrub demonstrably mangles.
 */

import { describe, expect, it } from 'vitest';

import { scrubKnownIdentifiers, type ScrubbableGraph } from '../scrub-identifiers.js';

const GRAPH: ScrubbableGraph = {
  nodes: [
    { id: 'opt-1', label: 'Full Parity' },
    { id: 'opt-12', label: 'Hold Prices' },
    { id: 'f1', label: 'Monthly Churn Rate' },
    { id: 'dec-2024', label: 'The pricing decision' },
    { id: 'orphan' },
  ],
};

describe('it removes identifiers that really exist', () => {
  it('replaces an id with its label', () => {
    expect(scrubKnownIdentifiers('I have set opt-1 against f1.', GRAPH))
      .toBe('I have set Full Parity against Monthly Churn Rate.');
  });

  it('does not let a shorter id eat a longer one', () => {
    expect(scrubKnownIdentifiers('Compare opt-1 with opt-12.', GRAPH))
      .toBe('Compare Full Parity with Hold Prices.');
  });

  it('never matches inside a longer token', () => {
    // `\b` would treat the hyphen as a boundary and corrupt both of these.
    expect(scrubKnownIdentifiers('The f1-draft and opt-1-variant are separate.', GRAPH))
      .toBe('The f1-draft and opt-1-variant are separate.');
  });

  it('uses a neutral phrase when a node has no label, rather than leaving the id', () => {
    expect(scrubKnownIdentifiers('Look at orphan.', GRAPH)).toBe('Look at that item.');
  });

  it('handles an id at the very start and very end', () => {
    expect(scrubKnownIdentifiers('opt-1', GRAPH)).toBe('Full Parity');
    expect(scrubKnownIdentifiers('Start with opt-1', GRAPH)).toBe('Start with Full Parity');
  });
});

describe('it leaves ordinary English alone — the measured failures of the shared scrub', () => {
  /**
   * Every line here is a sentence the shared egress scrub was OBSERVED to
   * rewrite, by running its own regexes. This corpus therefore comes from
   * outside the author's head, which is the whole point of it.
   */
  const MANGLED_BY_THE_SHARED_SCRUB = [
    'Improve the decision-making-process across teams.',
    'Compare risk-adjusted-returns for each fund.',
    'Refer to Decision-2024 and Option-B2.',
    'We need outcome-based-pricing before the renewal.',
    'The constraint-driven-design worked last time.',
    'Their option-heavy-strategy is the risk.',
    'A factor-by-factor-review would take a week.',
    'Run a goal-setting-workshop in Q3.',
    'This is a risk-free-rate question, not a pricing one.',
  ];

  it('passes all nine through untouched', () => {
    for (const sentence of MANGLED_BY_THE_SHARED_SCRUB) {
      expect(scrubKnownIdentifiers(sentence, GRAPH)).toBe(sentence);
    }
  });

  it('leaves figures, currency and punctuation exactly as written', () => {
    const t = 'Churn is 3.2% and the ceiling is £1.5 million — do not round it.';
    expect(scrubKnownIdentifiers(t, GRAPH)).toBe(t);
  });

  /**
   * The discriminating half. Without this, a function that simply returned
   * its input would pass every case above.
   */
  it('CONTRAST: the same corpus, with a real id added, IS scrubbed', () => {
    const withId = 'Improve the decision-making-process, starting with opt-1.';
    expect(scrubKnownIdentifiers(withId, GRAPH))
      .toBe('Improve the decision-making-process, starting with Full Parity.');
  });
});

describe('it cannot invent a replacement', () => {
  it('returns the text unchanged when there is no graph', () => {
    const t = 'Look at opt-1 and f1.';
    expect(scrubKnownIdentifiers(t, null)).toBe(t);
    expect(scrubKnownIdentifiers(t, { nodes: [] })).toBe(t);
    expect(scrubKnownIdentifiers(t, {})).toBe(t);
  });

  it('ignores nodes with no usable id rather than matching an empty string everywhere', () => {
    const g: ScrubbableGraph = { nodes: [{ id: '   ', label: 'X' }, { id: 'f1', label: 'Churn' }] };
    expect(scrubKnownIdentifiers('The f1 value.', g)).toBe('The Churn value.');
  });

  it('is deterministic', () => {
    const t = 'opt-1 beats opt-12 on f1.';
    expect(scrubKnownIdentifiers(t, GRAPH)).toBe(scrubKnownIdentifiers(t, GRAPH));
  });

  it('is a no-op on empty text', () => {
    expect(scrubKnownIdentifiers('', GRAPH)).toBe('');
  });
});
