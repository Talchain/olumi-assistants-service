/**
 * ⭐⭐ THE FIRST RESPONSE OPENS WITH WHAT WAS BUILT. THE STATED-LIMIT QUESTION
 * IS KEPT, IT IS KEPT DIRECTLY BENEATH THE MODEL, AND NO INPUT CAN SHED IT.
 *
 * ── WHAT THIS FILE REPLACES, AND WHY ───────────────────────────────────────
 * It was `first-response-lead-clarification.test.ts`, landed with #1409, and it
 * pinned the OPPOSITE order: the clarification ahead of the confirm sentence.
 * #1409's reasoning is not withdrawn — a limit the user stated and the product
 * declined to enforce IS the highest-value coaching line in the reply, and it
 * still holds a dedicated slot for exactly that reason.
 *
 * What is withdrawn is PROMOTING IT ABOVE THE MODEL. Reviewed on the served
 * build by the product owner: the reply then opened by reporting the product's
 * own failure before it had said what it built, and that was the single
 * loudest complaint about the first message. Position is not priority — the
 * line keeps its dedicated slot, its rank directly beneath the confirm
 * sentence, and its exemption from the word budget. It simply no longer opens
 * the reply.
 *
 * ── ⛔ AND WHAT THE FIRST ATTEMPT AT THAT MOVE COST ─────────────────────────
 * The first version of #1428 demoted the line INTO the coaching section and
 * added two ladder rungs to protect it there. That put it inside the word
 * budget for the first time, and `assembleSectionedNarrative` has a rung that
 * sheds the whole weighing block — so on inputs that overrun, the limit
 * question DISAPPEARED and the option inventory came back in its place.
 * Measured by execution on this file's own fixture: at three outstanding
 * effect values the limit was served; at four it was gone, and the base branch
 * served it on the identical input. `assistant_text` is the ONLY carrier for a
 * direction clarification (`route-v2-direction-clarification-served.test.ts`),
 * so shedding the block does not demote the question — the user is told
 * nothing at all.
 *
 * ── WHAT IS PINNED HERE ────────────────────────────────────────────────────
 *   · the confirm sentence is the first thing read;
 *   · the limit question is STILL SERVED, directly after the model, once;
 *   · it sits ABOVE the option inventory — rank kept, position moved;
 *   · it is raised as a question, never asserted as captured;
 *   · with no clarification nothing moves;
 *   · a ready first draft with an accepted summary is untouched;
 *   · ⭐ ON AN INPUT THAT PROVABLY CANNOT FIT BOTH, the ladder keeps the LIMIT
 *     and sheds the INVENTORY — and the over-budget precondition is COMPUTED
 *     from the product's own output against the exported budget, so the case
 *     cannot silently stop being exercised;
 *   · ⭐ MONOTONICITY: as the next-step nudge grows, content only ever leaves.
 *     A shed inventory never returns, and the limit never leaves at all.
 *
 * The direction items come from the REAL producer,
 * `renderDirectionClarifications`, not hand-authored copy; the non-ready status
 * is the live one (`needs_user_input`); and the `missing_value` blockers are
 * the shape `deriveMissingEffectPairs` reads, in the population
 * `readiness-recovery.ts` records as measured live ("drafts carry 3, 4, 4, 5, 7
 * and 8 missing effect values").
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_WORDS,
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
/**
 * ⚠ THE FULL LABEL IS LOAD-BEARING, NOT DECORATION. It is the option the
 * product owner's own transcript carried, and the F1 population is defined by
 * WORD COUNT: shortening it to "Raise Pro to £59" buys back enough budget that
 * the over-budget rung is never reached and this whole file stops exercising
 * the defect — measured, on the head this repair replaces.
 */
const OPTION_A = {
  id: 'o1',
  kind: 'option',
  label: 'Increase the Pro plan price from £49 to £59',
};
const OPTION_B = { id: 'o2', kind: 'option', label: 'Hold at £49' };
/** The factor the product owner's own transcript named for this brief. */
const FACTOR = { id: 'f1', kind: 'factor', label: 'Pro Plan Churn Rate' };

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
const LIMIT_MARKER = 'Limit to confirm:';
const INVENTORY_MARKER = 'Options compared';

/** Two unresolved limits from one brief (`MAX_DIRECTION_BULLETS` is 2). */
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

/**
 * ⭐ A DRAFT SMALL ENOUGH THAT THE COACHING SECTION ACTUALLY SURVIVES.
 *
 * The F1 fixtures above are all over budget by construction, so on every one of
 * them the weighing block is shed and a defect that only shows up INSIDE that
 * block is invisible. This one is deliberately short — a two-word goal, two
 * short options, no readiness blockers — and lands with ~41 words of slack, so
 * the block is served and can be inspected. Measured at the bytes: 99 words of
 * priced content against a 140-word budget.
 */
const SMALL_GRAPH = {
  nodes: [
    { id: 'g1', kind: 'goal', provenance: 'from_brief', label: 'Grow MRR' },
    { id: 'o1', kind: 'option', label: 'Raise price' },
    { id: 'o2', kind: 'option', label: 'Hold price' },
  ],
  edges: [],
};
const SMALL_BRIEF =
  'Grow MRR while keeping monthly churn under 4%. Raise price or hold price?';
const SMALL_TWO_DIRECTION_ITEMS = renderDirectionClarifications([
  {
    metric_text: 'monthly churn',
    amount_text: '4%',
    value: 4,
    unit: '%',
    reason: 'target_unmatched',
    question: 'Which part of the model should this apply to?',
    options: ['Churn rate', 'Overall churn'],
  },
  {
    metric_text: 'acquisition cost',
    amount_text: '£320',
    value: 320,
    unit: 'GBP',
    reason: 'target_unmatched',
    question: 'Which part of the model should this apply to?',
    options: ['Blended CAC', 'Paid CAC'],
  },
]);
const SMALL_TWO_BRIEF =
  'Grow MRR while keeping monthly churn under 4% and acquisition cost under £320. Raise price or hold price?';

const SMALL_DIRECTION_ITEMS = renderDirectionClarifications([
  {
    metric_text: 'monthly churn',
    amount_text: '4%',
    value: 4,
    unit: '%',
    reason: 'target_unmatched',
    question: 'Which part of the model should this apply to?',
    options: ['Churn rate', 'Overall churn'],
  },
]);

/**
 * `missing_value` readiness blockers in the shape `deriveMissingEffectPairs`
 * reads (`option_id` + `option_label` + `factor_id` + `factor_label`, deduped
 * on the pair). The COUNT is what lengthens the next-step nudge:
 * `describeRemainingEffectValues` appends "There are N more effect values to
 * set after this one…" for every value beyond the first.
 */
function missingEffectValueBlockers(count: number): ReadonlyArray<unknown> {
  return Array.from({ length: count }, (_, i) => ({
    blocker_type: 'missing_value',
    option_id: i % 2 === 0 ? 'o1' : 'o2',
    option_label: i % 2 === 0 ? 'Increase the Pro plan price from £49 to £59' : 'Hold at £49',
    factor_id: `f${i + 1}`,
    factor_label: i === 0 ? 'Pro Plan Churn Rate' : `Driver number ${i + 1}`,
  }));
}

function build(overrides: Partial<BuildPostDraftNarrativeInput>) {
  return buildPostDraftNarrative({
    graph: { nodes: [GOAL, OPTION_A, OPTION_B, FACTOR], edges: [] } as never,
    // The live first-draft status: ready to analyse is NOT what this turn had.
    analysisReady: { status: 'needs_user_input' } as never,
    briefText: BRIEF,
    ...overrides,
  });
}

function narrative(overrides: Partial<BuildPostDraftNarrativeInput>): string {
  return build(overrides).text;
}

/** The rendered coaching section, or null when the budget shed it. */
function coachingSection(text: string): string | null {
  return text.split('\n\n').find((b) => b.startsWith(COACHING_HEADING)) ?? null;
}

/** The assembler's own word count (`countWords` is `trim().split(/\s+/)`). */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * ⭐ One draft of the F1 population: the churn limit the model could not match,
 * plus a `missing_value` recovery carrying `count` outstanding effect values.
 * Only the blocker COUNT varies, so any difference between two of these is the
 * word budget's doing and nothing else.
 */
function draftWithOutstandingEffectValues(count: number) {
  return build({
    analysisReady: {
      status: 'needs_user_input',
      blockers: missingEffectValueBlockers(count),
    } as never,
    strengthenItems: PRODUCER_DIRECTION_ITEMS,
  });
}

describe('the first response opens with the model, and still asks about the stated limit', () => {
  it('the confirm sentence is the FIRST thing read, not the failure report', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    expect(text.indexOf("I've built a first")).toBe(0);
    // PRECONDITION PIN (trap 13b): the limit question IS on this input, so the
    // position assertion above is the composer's doing and not a fixture that
    // quietly produced no clarification at all.
    expect(text, 'PRECONDITION: the clarification must be servable here').toContain(
      LIMIT_MARKER,
    );
  });

  it('the limit question sits DIRECTLY BENEATH the model, above the inventory', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    const blocks = text.split('\n\n');
    // Block 0 is the confirm sentence; block 1 is the promoted clarification.
    expect(blocks[0]).toContain("I've built a first");
    expect(blocks[1]).toContain(LIMIT_MARKER);
    // CONTRAST: the inventory exists on this input and sits BELOW the limit, so
    // "above" is a real ordering claim and not a reply of two blocks.
    expect(text, 'PRECONDITION: the inventory must be present here').toContain(
      INVENTORY_MARKER,
    );
    expect(text.indexOf(LIMIT_MARKER)).toBeLessThan(text.indexOf(INVENTORY_MARKER));
  });

  it('it is MOVED, not duplicated — the person reads the limit once', () => {
    const text = narrative({ strengthenItems: PRODUCER_DIRECTION_ITEMS });
    const detail = PRODUCER_DIRECTION_ITEMS[0]!.detail;
    const firstSentence = detail.split('. ')[0]!;
    expect(text.split(firstSentence)).toHaveLength(2);
  });

  /**
   * ⭐⭐ MOVED, NOT DUPLICATED — CHECKED WHERE IT CAN ACTUALLY BE SEEN.
   *
   * The assertion above is real but weak on its own: every other fixture in
   * this file is over budget, the weighing block is shed on all of them, and a
   * promoted line that ALSO remained in the coaching bullets would therefore be
   * invisible to them. This draft is short enough that the block survives, so
   * the "removed from the core bullets" half of the move is observable — and
   * putting it back is what a tidy-up would do.
   *
   * It is also the only fixture here on which the weighing block is served at
   * all, so it doubles as the pin that a stated limit does not COST the reader
   * the ordinary coaching.
   */
  it('⭐ where the coaching section survives, it carries the OTHER bullets and not the limit again', () => {
    const built = build({
      graph: SMALL_GRAPH as never,
      briefText: SMALL_BRIEF,
      strengthenItems: SMALL_DIRECTION_ITEMS,
    });
    const text = built.text;
    // PRECONDITION: the promoted line is served, in its own slot.
    expect(text.split('\n\n')[1]).toContain(LIMIT_MARKER);
    // PRECONDITION, and the one that makes this fixture worth having: the block
    // is genuinely served here. If a change pushes this draft over budget the
    // block is shed and this test would silently stop checking anything.
    const section = coachingSection(text);
    expect(
      section,
      'PRECONDITION: this fixture must stay inside the budget, or nothing below is exercised',
    ).not.toBeNull();
    expect(section!.split('\n').length, 'the section must carry at least one bullet').toBeGreaterThan(1);
    // THE CLAIM: the limit is not repeated inside it.
    expect(section, 'the promoted line must be removed from the core bullets').not.toContain(
      LIMIT_MARKER,
    );
    // DERIVED CROSS-CHECK: the reader sees it exactly once, and the telemetry
    // agrees with the text rather than with a constant.
    expect(text.split(LIMIT_MARKER).length - 1).toBe(1);
    expect(built.telemetry.direction_clarifications_surfaced).toBe(1);
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
    expect(text.indexOf(INVENTORY_MARKER)).toBeGreaterThan(0);
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
    expect(text).not.toContain(INVENTORY_MARKER);
    expect(text).not.toContain("I've built a first");
  });

  /**
   * ⭐ THE PROMOTED SLOT CARRIES EXACTLY ONE LINE, AND THE SECOND IS STILL
   * PRICED. That is the pre-existing contract (`MAX_DIRECTION_BULLETS` is 2)
   * and this change does not widen it: anything beyond the first keeps #1409's
   * rank at the head of the weighing block, which the budget may shed. What is
   * NOT allowed is the telemetry claiming a line the reader never got — so the
   * count is asserted against the SERVED TEXT rather than against a constant.
   */
  it('a SECOND clarification is still priced by the budget, and the telemetry agrees with the text', () => {
    const built = build({ strengthenItems: TWO_PRODUCER_DIRECTION_ITEMS });
    const text = built.text;
    expect(
      TWO_PRODUCER_DIRECTION_ITEMS,
      'PRECONDITION: two clarifications were composed',
    ).toHaveLength(2);
    // The first holds the promoted slot, unconditionally.
    expect(text.split('\n\n')[1], 'the first limit holds the promoted slot').toContain('4%');
    // DERIVED, not mirrored: however many the ladder served, that is what the
    // telemetry must say. A hardcoded 1 or 2 here would stop discriminating the
    // moment the budget or the copy moved.
    const served = text.split(LIMIT_MARKER).length - 1;
    expect(served, 'PRECONDITION: at least the promoted line is served').toBeGreaterThan(0);
    expect(built.telemetry.direction_clarifications_surfaced).toBe(served);
    // When the second one IS shed, the coaching section goes with it — and the
    // second limit must not be smuggled into the promoted slot instead.
    if (served === 1) {
      expect(text).not.toContain('£320');
      expect(coachingSection(text)).toBeNull();
    }
  });

  /**
   * ⭐⭐⭐ THE F1 GUARANTEE, ON AN INPUT THAT PROVABLY CANNOT FIT BOTH.
   *
   * The precondition is COMPUTED, not asserted: the reply's own confirm
   * sentence, limit block, next-step nudge and the option inventory the
   * product renders for this very graph are reassembled here and counted
   * against the EXPORTED budget. If that ever stops exceeding `MAX_WORDS` this
   * test goes RED rather than quietly passing on a fixture that fits — which
   * is precisely how the predecessor of this test ended up unable to fail
   * (it returned at rung 1, 122 words against a 140 budget, and both of the
   * rungs it was written to exercise could be deleted with it still green).
   */
  it('⭐ when the limit and the inventory provably cannot both fit, the LIMIT is kept', () => {
    // Four outstanding effect values — inside the live population recorded in
    // `readiness-recovery.ts` ("3, 4, 4, 5, 7 and 8").
    const target = draftWithOutstandingEffectValues(4).text;
    // A control draft on the same graph, whose next step is short enough that
    // the inventory survives — this is where the inventory block's REAL text
    // comes from, so the counted precondition uses the product's own bytes.
    const control = draftWithOutstandingEffectValues(1).text;

    const inventoryBlock = control
      .split('\n\n')
      .find((b) => b.startsWith(INVENTORY_MARKER));
    expect(inventoryBlock, 'PRECONDITION: the control must render an inventory').toBeDefined();

    const targetBlocks = target.split('\n\n');
    const confirmBlock = targetBlocks[0]!;
    // `includes`, not `startsWith`: the point of this assertion is whether the
    // limit reached the user AT ALL, and a finder keyed on the block's shape
    // would go red on a mere re-housing instead of on the loss.
    const limitBlock = targetBlocks.find((b) => b.includes(LIMIT_MARKER));
    const nextStepBlock = targetBlocks[targetBlocks.length - 1]!;
    expect(limitBlock, 'PRECONDITION: the limit must be served on the target').toBeDefined();
    expect(nextStepBlock, 'PRECONDITION: the reply ends on the next step').toContain('Next,');

    // The rung that would carry BOTH — confirm + limit + inventory + next step,
    // the fixed footers correctly excluded because they are spliced after the
    // budget check. This is a LOWER BOUND on that rung: any surviving coaching
    // bullets would only add to it.
    const bothTogether = [confirmBlock, limitBlock!, inventoryBlock!, nextStepBlock].join('\n\n');
    expect(
      countWords(bothTogether),
      `COMPUTED PRECONDITION: confirm + limit + inventory + next step must exceed the ${MAX_WORDS}-word budget, or this test is not exercising the shed at all`,
    ).toBeGreaterThan(MAX_WORDS);

    // The guarantee. `assistant_text` is the only carrier: if this block is
    // shed the user is not told about their limit anywhere.
    expect(target, 'the stated limit must reach the user').toContain(LIMIT_MARKER);
    expect(target).toContain('4%');
    expect(target).toContain('it is not being enforced');
    // …and it is the INVENTORY that paid, which the canvas already shows.
    expect(target, 'the inventory is what gives way').not.toContain(INVENTORY_MARKER);
  });

  /**
   * ⭐⭐ MONOTONICITY. Every rung of the ladder serves a strict subset of the
   * rung above it, so growing the reply's fixed content can only ever REMOVE
   * things. The first attempt at #1428 broke this: one rung dropped the
   * inventory to keep the limit and the rung below it dropped the limit and
   * put the inventory BACK, so one extra outstanding effect value flipped a
   * served limit question into a served option list. This is the pair that
   * measured it.
   */
  it('⭐ MONOTONE — as the next step grows, the limit never leaves and a shed inventory never returns', () => {
    const counts = [1, 2, 3, 4, 8];
    const rows = counts.map((n) => {
      const text = draftWithOutstandingEffectValues(n).text;
      return { n, limit: text.includes(LIMIT_MARKER), inventory: text.includes(INVENTORY_MARKER) };
    });

    // PRECONDITION PIN: the range must actually cross the budget, or this is a
    // test that every possible implementation passes.
    expect(
      rows.filter((r) => r.inventory).length,
      'PRECONDITION: the inventory must survive at the short end',
    ).toBeGreaterThan(0);
    expect(
      rows.filter((r) => !r.inventory).length,
      'PRECONDITION: the inventory must be shed at the long end',
    ).toBeGreaterThan(0);

    // THE GUARANTEE: the limit is served at every length.
    expect(rows.filter((r) => !r.limit).map((r) => r.n)).toEqual([]);

    // MONOTONE: once shed, the inventory does not come back.
    const firstShed = rows.findIndex((r) => !r.inventory);
    expect(rows.slice(firstShed).some((r) => r.inventory)).toBe(false);
  });

  /**
   * ⭐⭐⭐ MONOTONICITY, ON THE INPUT CLASS THAT CAN ACTUALLY BREAK IT.
   *
   * The sweep above uses ONE clarification, so `weighingBlockDirectionOnly` is
   * null and the direction-only rungs are never entered — it cannot see a rung
   * inserted between them and "drop the whole weighing block". TWO
   * clarifications can, and this is the pair that measured the first attempt's
   * flip: with a rung that drops the inventory to keep both limits sitting
   * ABOVE a rung that drops a limit and puts the inventory back, ONE extra
   * outstanding effect value took the reply from
   *
   *     no inventory · two limits served
   * to  INVENTORY BACK · one limit served
   *
   * i.e. growing the fixed content ADDED a block. Nothing about that is
   * cosmetic: it is how #1428's first head lost the user's limit question.
   */
  /**
   * ⭐⭐ THE SECOND CLARIFICATION KEEPS #1409's RANK — AND IT IS THE *SECOND*
   * ONE, NOT THE FIRST AGAIN.
   *
   * On a draft short enough for the direction-only rung to fire, both limits
   * are served: the first in its promoted slot, the second at the HEAD of the
   * coaching section, ahead of the ordinary bullets. Building that rung's
   * block from ALL the direction bullets instead of the remainder repeats the
   * promoted line, blows the rung's budget and drops the second limit
   * altogether — invisible on every over-budget fixture in this file, which is
   * why this short one exists.
   */
  it('⭐ both limits are served on a short draft — promoted slot, then the head of the coaching section', () => {
    const built = build({
      graph: SMALL_GRAPH as never,
      briefText: SMALL_TWO_BRIEF,
      strengthenItems: SMALL_TWO_DIRECTION_ITEMS,
    });
    const text = built.text;
    expect(
      SMALL_TWO_DIRECTION_ITEMS,
      'PRECONDITION: two clarifications were composed',
    ).toHaveLength(2);
    // The promoted slot carries the FIRST.
    expect(text.split('\n\n')[1]).toContain(LIMIT_MARKER);
    expect(text.split('\n\n')[1]).toContain('4%');
    expect(text.split('\n\n')[1], 'the promoted slot is the first item, not the second').not.toContain(
      '£320',
    );
    // The coaching section carries the SECOND, at its head.
    const section = coachingSection(text);
    expect(
      section,
      'PRECONDITION: the direction-only rung must fire here, or nothing below is exercised',
    ).not.toBeNull();
    const bullets = section!.split('\n').slice(1);
    expect(bullets[0]).toMatch(/^• Limit to confirm: /);
    expect(bullets[0]).toContain('£320');
    // Exactly two, and the telemetry says two — not the promoted line twice.
    expect(text.split(LIMIT_MARKER).length - 1).toBe(2);
    expect(built.telemetry.direction_clarifications_surfaced).toBe(2);
  });

  it('⭐ MONOTONE with two clarifications — growing the next step never ADDS a block back', () => {
    const rows = [0, 1, 2, 3, 4, 6, 12].map((n) => {
      const text = build({
        graph: { nodes: [GOAL, OPTION_A, OPTION_B, FACTOR], edges: [] } as never,
        analysisReady: {
          status: 'needs_user_input',
          blockers: missingEffectValueBlockers(n),
        } as never,
        strengthenItems: TWO_PRODUCER_DIRECTION_ITEMS,
      }).text;
      return {
        n,
        inventory: text.includes(INVENTORY_MARKER),
        limits: text.split(LIMIT_MARKER).length - 1,
      };
    });

    // PRECONDITION: at least the promoted line is served at every length —
    // without this the monotonicity claim below could hold vacuously on a
    // reply that serves nothing at all.
    expect(rows.filter((r) => r.limits < 1).map((r) => r.n)).toEqual([]);

    // MONOTONE, both observables: once gone, gone.
    const inventoryReturned = rows.some(
      (r, i) => i > 0 && r.inventory && !rows[i - 1]!.inventory,
    );
    expect(
      inventoryReturned,
      'the option inventory came BACK as the next step grew — the ladder is non-monotone',
    ).toBe(false);
    const limitsRose = rows.some((r, i) => i > 0 && r.limits > rows[i - 1]!.limits);
    expect(limitsRose, 'a limit came BACK as the next step grew').toBe(false);
  });

  it('telemetry counts the promoted line as SERVED even when the weighing block is shed', () => {
    const built = draftWithOutstandingEffectValues(4);
    expect(built.text, 'PRECONDITION: the weighing block is gone on this input').not.toContain(
      COACHING_HEADING,
    );
    expect(built.telemetry.direction_clarifications_surfaced).toBe(1);
  });
});
