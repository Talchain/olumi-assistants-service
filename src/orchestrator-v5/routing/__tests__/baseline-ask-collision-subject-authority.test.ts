/**
 * ⭐⭐ SOLE-PENDING PERMISSION IS FOR ELLIPTICAL CARRY, NOT FOR EVERY ANSWER.
 *
 * THE REGRESSION THIS SUITE EXISTS TO CLOSE, and it was worse for a user than
 * the defect it came from. The collision fix intercepted EVERY answer-shaped
 * reply while two bare-number questions were open. But the product's own
 * disambiguation copy ends:
 *
 *     Naming it is enough, for example "Churn rate is 30%".
 *
 * and that exact sentence was then refused too, repeating the same warning. The
 * product told the user what to say and rejected it. The pre-existing
 * external-corpus sentence "Churn is about 12%." was blocked the same way,
 * although the existing classifier resolves its subject with no pending
 * question in play at all.
 *
 * TWO CONCEPTS THAT ARE NOT ONE, named apart rather than tuned against each
 * other (CLAUDE.md trap 21):
 *
 *   1. ELLIPTICAL CARRY — "30%", "about 12%". The reply has no subject and must
 *      BORROW the pending question's. Two open questions genuinely make that
 *      ambiguous, so it may bind only when exactly one can claim it. This is
 *      where sole-pending permission belongs, and it stays.
 *   2. INDEPENDENT SUBJECT AUTHORITY — "Churn rate is 30%", "Churn is about
 *      12%.". The reply NAMES what it is about and binds by identity against
 *      the label with competitor unanimity, exactly as it would on any other
 *      turn. It borrows nothing, so a competing question cannot make it
 *      ambiguous, and refusing it DROPS a legitimate answer.
 *
 * A false positive that drops a real answer is a gap; one that invents a
 * binding is a lie. They cannot share one window, so this suite proves BOTH
 * DIRECTIONS IN THE SAME RUN, with a competing effect ask live in BOTH of its
 * persisted spellings.
 *
 * ⚠ THE DISCRIMINATOR IS NOT "bound". A bare "30%" is ALSO `bound` — bound
 * ELLIPTICALLY. What separates the two is WHICH LIMB of the existing classifier
 * produced the value, which the classifier now records as `authority`. No new
 * predicate over user text exists here and no threshold is tuned; "accept every
 * bound result" is the over-correction this suite pins against.
 *
 * ⚠ CORPUS PROVENANCE — the reviewer's core criticism was that the author's
 * corpus EXCLUDED this distinction: it held no reply that was answer-shaped AND
 * independently subject-bound. Every case below is sourced from OUTSIDE the
 * predicate under test:
 *   - the offered example is EXTRACTED AT RUNTIME from the product's own
 *     `formatBaselineAskCollision` output, so it cannot drift from what the
 *     product actually says (a hardcoded copy of it would be a guard agreeing
 *     with itself);
 *   - the subject-bound sentences are verbatim from the pre-existing
 *     stated-level / elicited-answer suites;
 *   - the elliptical answers are the ask's own invited forms.
 *
 * Assertions bind by IDENTITY — node id, exact percent, the exact quoted
 * sentence — never by a value predicate another object could satisfy.
 */
import { describe, expect, it } from 'vitest';

import { type PendingAction } from '../../session/pending-action.js';
import { tryBaselineElicitationResume } from '../clarification-resume.js';
import { formatBaselineAskCollision } from '../../tools/handlers/d1-shared/format-confirmation.js';
import { classifyElicitedBaselineAnswer } from '../../../cee/factor-extraction/stated-level.js';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const LIVE_UNTIL = new Date(NOW + 600_000).toISOString();
const EMITTED = new Date(NOW).toISOString();
const GRAPH_HASH = 'graph-hash-unchanged';

const TARGET_ID = 'node-churn-rate';
const TARGET_LABEL = 'Churn rate';
const OPTION_ID = 'node-annual-contracts';
const OPTION_LABEL = 'introduce annual contracts with a discount to lock customers in';
const FACTOR_ID = 'node-acar';
const FACTOR_LABEL = 'Annual Contract Adoption Rate';

const baselinePending = {
  id: 'pending-baseline',
  scenario_id: 'scenario-1',
  chip_id: 'chip_elicit_target_baseline',
  action: {
    kind: 'elicit_target_baseline',
    target_id: TARGET_ID,
    target_label: TARGET_LABEL,
    constraint_type: 'at_most',
    value: 0.3,
  },
  preconditions: { graph_hash: GRAPH_HASH },
  expires_at_turn_count: 3,
  expires_at_iso: LIVE_UNTIL,
  emitted_at_iso: EMITTED,
} as unknown as PendingAction;

/** The competing ask, spelling 1 — the one the witnessed turn carried. */
const effectPending = {
  id: 'pending-effect',
  scenario_id: 'scenario-1',
  chip_id: 'chip_configure_option_clarify',
  action: {
    kind: 'elicit_option_effect',
    option_id: OPTION_ID,
    option_label: OPTION_LABEL,
    factor_id: FACTOR_ID,
    factor_label: FACTOR_LABEL,
  },
  preconditions: { graph_hash: GRAPH_HASH },
  expires_at_turn_count: 3,
  expires_at_iso: LIVE_UNTIL,
  emitted_at_iso: EMITTED,
} as unknown as PendingAction;

/** The competing ask, spelling 2. Both are claimants; both must behave alike. */
const effectTargetPending = {
  id: 'pending-effect-target',
  scenario_id: 'scenario-1',
  chip_id: 'chip_configure_option_clarify',
  action: {
    kind: 'elicit_effect_target',
    option_id: OPTION_ID,
    option_label: OPTION_LABEL,
    value: 0.3,
  },
  preconditions: { graph_hash: GRAPH_HASH },
  expires_at_turn_count: 3,
  expires_at_iso: LIVE_UNTIL,
  emitted_at_iso: EMITTED,
} as unknown as PendingAction;

const GRAPH_NODES = [
  { id: TARGET_ID, label: TARGET_LABEL },
  { id: OPTION_ID, label: OPTION_LABEL },
  { id: FACTOR_ID, label: FACTOR_LABEL },
];

const COMPETING_SPELLINGS: ReadonlyArray<readonly [string, PendingAction]> = [
  ['elicit_option_effect', effectPending],
  ['elicit_effect_target', effectTargetPending],
];

function resume(message: string, pendings: readonly PendingAction[]) {
  return tryBaselineElicitationResume({
    message,
    pendingActions: pendings,
    nowMs: NOW,
    currentGraphHash: GRAPH_HASH,
    graphNodes: GRAPH_NODES,
  });
}

/**
 * THE PRODUCT'S OWN OFFERED ANSWER, extracted from the copy it actually emits.
 * Derived from the producer rather than transcribed: if the example in
 * `formatBaselineAskCollision` ever changes, this case follows it, and a copy
 * change that stopped offering an example at all fails here rather than
 * silently leaving the promise untested.
 */
function extractOfferedExample(): string {
  const copy = formatBaselineAskCollision({
    targetLabel: TARGET_LABEL,
    competing: [effectPending],
  });
  const m = /for example "([^"]+)"/.exec(copy);
  expect(m, `the collision copy no longer offers a quoted example:\n${copy}`).not.toBeNull();
  return m![1]!;
}

describe('the product must not refuse its own offered disambiguating answer', () => {
  it('offers a concrete example, and that example is subject-bearing by construction', () => {
    const offered = extractOfferedExample();
    // Bound to the target BY IDENTITY: the example names the node it is about.
    expect(offered).toBe(`${TARGET_LABEL} is 30%`);
    // And it carries its OWN subject — the property that entitles it to bind
    // without borrowing the question's. This pins the precondition in-test, so
    // the cases below cannot pass because the fixture stopped discriminating.
    const verdict = classifyElicitedBaselineAnswer(offered, TARGET_LABEL, [
      OPTION_LABEL,
      FACTOR_LABEL,
    ]);
    expect(verdict).toEqual({ outcome: 'bound', percent: 30, authority: 'subject' });
  });

  for (const [spelling, competitor] of COMPETING_SPELLINGS) {
    it(`accepts its own offered example with a competing ${spelling} live`, () => {
      const offered = extractOfferedExample();
      const dispatch = resume(offered, [baselinePending, competitor]);
      expect(dispatch.matched).toBe(false);
      // NOT intercepted as a collision: it resolves its own subject, so it
      // continues to the handler that records the baseline (proven end-to-end
      // in the handler suite alongside this one).
      expect((dispatch as { skip_reason: string }).skip_reason).toBe('subject_bound_answer');
    });
  }
});

describe('DIRECTION 2 — an independently subject-bound answer survives the collision', () => {
  /**
   * Verbatim from the pre-existing stated-level / elicited-answer suites. These
   * are sentences the product already understood on any other turn; the
   * collision fix must not have taken that away.
   */
  const SUBJECT_BOUND: ReadonlyArray<readonly [string, number]> = [
    ['Churn is about 12%.', 12],
    ['Churn rate is about 12%.', 12],
    ['Churn is 12% today.', 12],
    ['Churn is at 12% right now, keep it under 10%.', 12],
    ['Churn is currently 12%; keep churn under 10%.', 12],
    ['Churn sits at 12% at the moment; keep it below 10%.', 12],
    ['Churn stands at 12% today. Keep it under 10%.', 12],
    ['Churn rates are 12% today.', 12],
    ['Churn is 0% today. Keep it under 2%.', 0],
    ['Churn is 12.5% today; keep it under 10%.', 12.5],
  ];

  for (const [spelling, competitor] of COMPETING_SPELLINGS) {
    for (const [message, percent] of SUBJECT_BOUND) {
      it(`"${message}" keeps its own authority with a competing ${spelling} live`, () => {
        // PRECONDITION, pinned in-test: this reply really is subject-bound, so
        // a pass below is the code's doing and not the fixture's failure.
        const verdict = classifyElicitedBaselineAnswer(message, TARGET_LABEL, [
          OPTION_LABEL,
          FACTOR_LABEL,
        ]);
        expect(verdict).toEqual({ outcome: 'bound', percent, authority: 'subject' });

        const dispatch = resume(message, [baselinePending, competitor]);
        expect((dispatch as { skip_reason: string }).skip_reason).toBe('subject_bound_answer');
      });
    }
  }
});

describe('DIRECTION 1 — an elliptical answer with two live claimants still binds nothing', () => {
  /**
   * The harm the transition was written for, and it must stay closed. Every one
   * of these is a form the ask itself invites, and none of them carries a
   * subject: with two questions open, there is no way to tell which one lent it
   * one. The product asks; it does not guess and it does not fall silent.
   */
  const ELLIPTICAL: readonly string[] = [
    '30%',
    '30',
    'roughly 30',
    '30 percent',
    '12%',
    'about 12% right now',
    "it's 12%",
    "we're at 12% today",
    '0.6',
    '0.3',
    '120%',
    '10-15%',
  ];

  for (const [spelling, competitor] of COMPETING_SPELLINGS) {
    for (const message of ELLIPTICAL) {
      it(`"${message}" is asked about, never bound, with a competing ${spelling} live`, () => {
        // PRECONDITION: this reply is NOT subject-bound. If it ever became so,
        // the case below would be asserting the wrong thing silently.
        const verdict = classifyElicitedBaselineAnswer(message, TARGET_LABEL, [
          OPTION_LABEL,
          FACTOR_LABEL,
        ]);
        expect(
          verdict.outcome === 'bound' ? verdict.authority : 'not-subject',
        ).not.toBe('subject');

        const dispatch = resume(message, [baselinePending, competitor]);
        expect(dispatch.matched).toBe(false);
        expect((dispatch as { skip_reason: string }).skip_reason).toBe('competing_ask');
      });
    }
  }
});

describe('the counterpart routes the transition must not have taken', () => {
  for (const [spelling, competitor] of COMPETING_SPELLINGS) {
    it(`an explicit edit instruction still reaches the edit lane past a competing ${spelling}`, () => {
      const dispatch = resume("set the pilot's effect on cost to 0.3", [
        baselinePending,
        competitor,
      ]);
      expect(dispatch.matched).toBe(false);
      // Never claimed by the baseline path at all — the pre-existing route.
      expect((dispatch as { skip_reason: string }).skip_reason).toBe('no_pending_question');
    });
  }

  it('with NO competitor, an elliptical answer still binds through the baseline path', () => {
    const dispatch = resume('30%', [baselinePending]);
    expect(dispatch.matched).toBe(true);
    expect((dispatch as { pending: PendingAction }).pending.id).toBe('pending-baseline');
  });

  it('with NO competitor, a subject-bound answer still binds through the baseline path', () => {
    const dispatch = resume('Churn is about 12%.', [baselinePending]);
    expect(dispatch.matched).toBe(true);
    expect((dispatch as { pending: PendingAction }).pending.id).toBe('pending-baseline');
  });

  it('with no live question at all, silence is preserved for both reply kinds', () => {
    expect((resume('30%', []) as { skip_reason: string }).skip_reason).toBe('no_pending_question');
    expect((resume('Churn is about 12%.', []) as { skip_reason: string }).skip_reason).toBe(
      'no_pending_question',
    );
  });
});
