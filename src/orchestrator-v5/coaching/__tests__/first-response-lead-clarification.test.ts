/**
 * ⭐⭐ A STATED LIMIT THE PRODUCT DID NOT ENFORCE OPENS THE FIRST RESPONSE.
 *
 * Measured on native request `3d5ce286-9804-4a59-ad4e-d6921d31141f` (9 Sep 2026,
 * CEE `a03ead1a`): the person read "I've built a first model", then an option
 * inventory, and only then anything about the limit they had stated. Their brief
 * said "keeping monthly churn under 4%"; the server captured zero constraints.
 * Full narrative — including what this does NOT close — is in the receipt,
 * `output/olumi-delivery-heartbeat/F361-FIRST-RESPONSE-20260909.md`.
 *
 * ⛔ WITHDRAWN CLAIM, kept here because the control below exists to prevent it
 *    recurring: I wrote that a first draft can never use the model summary,
 *    because `:590` requires `analysisReady.status === 'ready'` and analysis has
 *    not run. `analysisReady` means ready TO ANALYSE, not already analysed — a
 *    READY FIRST DRAFT can ship an accepted summary, and `:548-635` permits it.
 *
 * The direction items here come from the REAL producer,
 * `renderDirectionClarifications`, not hand-authored copy, and the non-ready
 * status is the live one (`needs_user_input`), not an invented `not_ready`.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPostDraftNarrative,
  type BuildPostDraftNarrativeInput,
} from '../post-draft-narrative.js';
import { renderDirectionClarifications } from '../../../cee/compound-goal/direction-gate.js';

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';

const GOAL = {
  id: 'g1',
  kind: 'goal',
  provenance: 'from_brief',
  label: 'Reach £20k MRR within 12 months',
};
const OPTION_A = { id: 'o1', kind: 'option', label: 'Raise Pro to £59' };
const OPTION_B = { id: 'o2', kind: 'option', label: 'Hold at £49' };

/** The producer's own output for the captured unresolved churn limit. */
const PRODUCER_DIRECTION_ITEMS = renderDirectionClarifications([
  {
    metric_text: 'monthly churn',
    amount_text: '4%',
    value: 4,
    unit: '%',
    reason: 'target_unmatched',
    question: 'Which part of the model should the monthly churn limit apply to?',
    options: ['Pro Plan Churn Rate', 'Overall churn'],
  },
]);

function narrative(overrides: Partial<BuildPostDraftNarrativeInput>): string {
  return buildPostDraftNarrative({
    graph: { nodes: [GOAL, OPTION_A, OPTION_B], edges: [] } as never,
    // The live first-draft status: ready to analyse is NOT what this turn had.
    analysisReady: { status: 'needs_user_input' } as never,
    briefText: BRIEF,
    ...overrides,
  }).text;
}

describe('the first response opens with the stated limit, not the changelog', () => {
  it('the producer clarification is the FIRST thing read', () => {
    // The acceptance the review named: not merely before "Options compared",
    // but before the "I've built a first model" confirm sentence.
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    const confirm = text.indexOf("I've built a first");
    expect(confirm).toBeGreaterThan(0);
    expect(text.indexOf('churn')).toBeLessThan(confirm);
    expect(text.indexOf('Options compared')).toBeGreaterThan(confirm);
  });

  it('it is MOVED, not duplicated — the person reads the limit once', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    const detail = PRODUCER_DIRECTION_ITEMS[0]!.detail;
    const firstSentence = detail.split('. ')[0]!;
    expect(text.split(firstSentence)).toHaveLength(2);
  });

  it('the limit is raised as a question, never asserted as captured', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    expect(text).toContain('?');
    expect(text).not.toContain('constraint has been applied');
    expect(text).not.toContain('4% has been set');
  });

  it('NEGATIVE — no clarification: confirm still opens, order unchanged', () => {
    // Every ordinary first draft, including the served #1395 cases, must not
    // move. If this fails, the change widened beyond its population.
    const text = narrative({});
    expect(text.indexOf("I've built a first")).toBe(0);
    expect(text.indexOf('Options compared')).toBeGreaterThan(0);
  });

  it('⭐ READY FIRST DRAFT + accepted summary ships that summary, untouched by this change', () => {
    // The counterexample to my withdrawn claim, and the guard against widening:
    // a first draft CAN be ready, and then the composer never reaches the
    // sectioned builder at all.
    const accepted =
      'This decision comes down to one trade-off: raising the price protects margin while the churn limit is the constraint to weigh against it. Next, set that limit so the model can test it.';
    const text = narrative({
      analysisReady: { status: 'ready' } as never,
      coachingSummary: accepted,
      strengthenItems: PRODUCER_DIRECTION_ITEMS,
    });
    expect(text).toContain('one trade-off');
    expect(text).not.toContain('Options compared');
    expect(text).not.toContain("I've built a first");
  });

  it('the promoted line survives the word budget rather than displacing coaching', () => {
    // Rung 3b already ranks a stated limit above the coaching around it. With
    // many options the inventory may shed; the limit must not.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `o${i + 3}`,
      kind: 'option',
      label: `Alternative pricing route number ${i + 1} with a deliberately long label`,
    }));
    const text = narrative({
      graph: { nodes: [GOAL, OPTION_A, OPTION_B, ...many], edges: [] } as never,
      strengthenItems: PRODUCER_DIRECTION_ITEMS,
    });
    expect(text.indexOf('churn')).toBeLessThan(text.indexOf("I've built a first"));
  });
});
