/**
 * ⭐⭐ THE FIRST RESPONSE OPENS WITH WHAT WAS BUILT. THE STATED-LIMIT QUESTION
 * IS KEPT, AND IT IS KEPT BELOW THE MODEL.
 *
 * ── WHAT THIS FILE REPLACES, AND WHY ───────────────────────────────────────
 * It was `first-response-lead-clarification.test.ts`, landed with #1409, and it
 * pinned the OPPOSITE order: the clarification ahead of the confirm sentence.
 * #1409's reasoning is not withdrawn — a limit the user stated and the product
 * declined to enforce IS the highest-value coaching line in the reply, and it
 * still leads the coaching section for exactly that reason.
 *
 * What is withdrawn is PROMOTING IT ABOVE THE MODEL. Reviewed on the served
 * build by the product owner: the reply now opens by reporting the product's
 * own failure before it has said what it built, and that was the single
 * loudest complaint about the first message. Position is not priority — the
 * line keeps its dedicated slot, its rank at the head of the coaching bullets,
 * and its protection from the word budget. It simply no longer opens the reply.
 *
 * ── WHAT IS PINNED HERE ────────────────────────────────────────────────────
 *   · the confirm sentence is the first thing read;
 *   · the limit question is STILL SERVED, after the model, once;
 *   · it is the FIRST bullet of the coaching section, ahead of trade-off and
 *     assumption;
 *   · it is raised as a question, never asserted as captured;
 *   · with no clarification nothing moves;
 *   · a ready first draft with an accepted summary is untouched;
 *   · the word budget sheds the option inventory before it sheds the limit.
 *
 * The direction items come from the REAL producer,
 * `renderDirectionClarifications`, not hand-authored copy, and the non-ready
 * status is the live one (`needs_user_input`).
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

const COACHING_HEADING = 'What the model is weighing';

/** Two unresolved limits from one brief — enough content to force rung 3c. */
const TWO_PRODUCER_DIRECTION_ITEMS = renderDirectionClarifications([
  {
    metric_text: 'monthly churn',
    amount_text: '4%',
    value: 4,
    unit: '%',
    reason: 'target_unmatched',
    question: 'Which part of the model should the monthly churn limit apply to?',
    options: ['Pro Plan Churn Rate', 'Overall churn'],
  },
  {
    metric_text: 'customer acquisition cost',
    amount_text: '£320',
    value: 320,
    unit: 'GBP',
    reason: 'target_unmatched',
    question: 'Which part of the model should the acquisition cost limit apply to?',
    options: ['Blended CAC', 'Paid CAC'],
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

/** The rendered coaching section, or null when the budget shed it. */
function coachingSection(text: string): string | null {
  return text.split('\n\n').find((b) => b.startsWith(COACHING_HEADING)) ?? null;
}

describe('the first response opens with the model, and still asks about the stated limit', () => {
  it('the confirm sentence is the FIRST thing read, not the failure report', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    expect(text.indexOf("I've built a first")).toBe(0);
    // PRECONDITION PIN (trap 13b): the limit question IS on this input, so the
    // position assertion above is the composer's doing and not a fixture that
    // quietly produced no clarification at all.
    expect(text, 'PRECONDITION: the clarification must be servable here').toContain(
      'Limit to confirm:',
    );
    expect(text.indexOf('Limit to confirm:')).toBeGreaterThan(
      text.indexOf('Options compared'),
    );
  });

  it('the limit question leads the coaching section — position moved, rank kept', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    const section = coachingSection(text);
    expect(section, 'the coaching section must survive on this input').not.toBeNull();
    const bullets = section!.split('\n').slice(1);
    expect(bullets.length).toBeGreaterThan(1);
    expect(bullets[0]).toMatch(/^• Limit to confirm: /);
    // CONTRAST: a bullet that is NOT the limit exists below it, so "first"
    // is a real ordering claim and not a section of one.
    expect(bullets[1]).not.toContain('Limit to confirm:');
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
    // A first draft CAN be ready, and then the composer never reaches the
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

  /**
   * ⭐⭐ RUNG 3c, EXERCISED. The option inventory is capped at four bullets, so
   * options alone can never overrun the budget — this rung is reached by TWO
   * unresolved limits in one brief, which is the real population it exists for
   * (`MAX_DIRECTION_BULLETS` is 2). Without the rung the ladder falls straight
   * to "drop the whole weighing block" and BOTH limits vanish, which is the
   * silent loss that returning the line to the coaching section would otherwise
   * have bought.
   */
  it('rung 3c — with two limits over budget, the options are shed and both limits stay', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `o${i + 3}`,
      kind: 'option',
      label: `Alternative pricing route number ${i + 1} with a deliberately long label`,
    }));
    const text = narrative({
      graph: { nodes: [GOAL, OPTION_A, OPTION_B, ...many], edges: [] } as never,
      strengthenItems: TWO_PRODUCER_DIRECTION_ITEMS,
    });
    // PRECONDITION PIN: this input really is over budget with the inventory in,
    // so the assertions below are the ladder's doing and not a short fixture.
    expect(text, 'the inventory must have been shed here').not.toContain(
      'Options compared',
    );
    const section = coachingSection(text);
    expect(section).not.toBeNull();
    const bullets = section!.split('\n').slice(1);
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toContain('4%');
    expect(bullets[1]).toContain('£320');
    expect(text.indexOf("I've built a first")).toBe(0);
  });

  it('the word budget sheds the option inventory before it sheds the limit', () => {
    // Demoting the line from the opener must not expose it to the budget. The
    // ladder reduces the coaching section to the limit alone, then drops the
    // inventory, before the limit itself can go.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `o${i + 3}`,
      kind: 'option',
      label: `Alternative pricing route number ${i + 1} with a deliberately long label`,
    }));
    const text = narrative({
      graph: { nodes: [GOAL, OPTION_A, OPTION_B, ...many], edges: [] } as never,
      strengthenItems: PRODUCER_DIRECTION_ITEMS,
    });
    expect(text).toContain('Limit to confirm:');
    expect(text).toContain('add it as a constraint on the right factor to make it binding.');
    expect(text.indexOf("I've built a first")).toBe(0);
  });
});
