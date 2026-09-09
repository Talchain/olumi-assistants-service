/**
 * THE PRECEDENCE CONFLICT BETWEEN TWO SIMULTANEOUSLY-LIVE BARE-NUMBER ASKS.
 *
 * THE DEFECT, wire-witnessed on the deployed build. The product asks "Roughly
 * what percentage is <target> at right now?" while a second question about an
 * option effect is still live. The user answers. The sole-pending gate refuses
 * (correctly: a bare number is genuinely ambiguous between the two asks) and
 * the turn then fell through IN SILENCE to a lane that does not refuse, which
 * wrote the number as an effect value on a node the user was never asked about
 * and disclosed it only in the receipt.
 *
 * ⚠ THE NUMERAL FORM WAS A CONFOUND, and this suite is built to keep it dead.
 * The original observation recorded "30" and "roughly 30" binding while "30%",
 * "30 percent" and "0.6" were stolen, which reads as a grammar problem. Measured
 * across BOTH axes at the pristine tip it is not: `classifyElicitedBaselineAnswer`
 * returns an IDENTICAL verdict for every form whether or not a competitor is
 * live, and every form — "30" and "roughly 30" included — collapsed to the same
 * silent fall-through the moment a competing ask existed. The competing pending
 * decides everything; the form decides nothing. So every case here is run on
 * BOTH axes, and the `withoutCompetitor` column is what stops a future reader
 * re-deriving the confound.
 *
 * THE INVARIANT, written against the SPEC and not against the failure in hand:
 * while a baseline elicitation pending is live, a message shaped like a reply to
 * it resolves AT THE BASELINE PATH — binding, re-asking, or asking which
 * question was meant — and never mints an unrelated edit.
 *
 * THE COUNTERPART HARM this must not cause: a user with a live baseline question
 * may legitimately want an option effect set. "Set the pilot's effect on cost to
 * 0.3" must still reach the edit lane. Both directions are proven in the same
 * run, and the `stillReachesTheEditLane` cases are the ones that fail if this
 * fix is over-applied into "baseline always wins".
 */
import { describe, expect, it } from 'vitest';
import {
  findBaselineAskCollision,
  findSoleLiveElicitBaselinePending,
  type PendingAction,
} from '../../session/pending-action.js';
import { tryBaselineElicitationResume } from '../clarification-resume.js';
import { formatBaselineAskCollision } from '../../tools/handlers/d1-shared/format-confirmation.js';

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

/** The competing ask — the one the witnessed turn had live alongside the baseline. */
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

const GRAPH_NODES = [
  { id: TARGET_ID, label: TARGET_LABEL },
  { id: OPTION_ID, label: OPTION_LABEL },
  { id: FACTOR_ID, label: FACTOR_LABEL },
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
 * ⚠ PIN THE PRECONDITION IN-TEST, ALWAYS.
 *
 * The live witness's own named control ("30%") failed to fire TWICE, because it
 * was itself captured by the competing pending — so a green assertion about
 * "what the answer did" can silently be an assertion about a different pending
 * entirely. These two helpers assert WHICH claim is live before any case asserts
 * what an answer did to it. A fixture that stopped reproducing the collision
 * (an expiry, a renamed kind, a dropped field) REDs here instead of passing
 * every case for the wrong reason.
 */
function assertCollisionIsLive(pendings: readonly PendingAction[]): void {
  const collision = findBaselineAskCollision(pendings, NOW);
  expect(collision).not.toBeNull();
  expect(collision?.baseline.id).toBe('pending-baseline');
  expect(collision?.competing.map((p) => p.id)).toEqual(['pending-effect']);
  // ...and the sole-pending gate genuinely refuses, which is what made the
  // fall-through reachable. Without this the collision case could pass while
  // the ordinary bind path was quietly handling it.
  expect(findSoleLiveElicitBaselinePending(pendings, NOW)).toBeNull();
}

function assertBaselineIsSoleClaim(pendings: readonly PendingAction[]): void {
  expect(findBaselineAskCollision(pendings, NOW)).toBeNull();
  expect(findSoleLiveElicitBaselinePending(pendings, NOW)?.id).toBe('pending-baseline');
}

/**
 * The two-axis corpus: FORM × COMPETING-PENDING. `withoutCompetitor` is the
 * behaviour that must not regress; `withCompetitor` is the behaviour under
 * repair. Every row is asserted on both axes in the same run.
 */
const ANSWER_SHAPED: ReadonlyArray<{
  readonly message: string;
  readonly withoutCompetitor: 'MATCHED' | 'unreadable_answer';
}> = [
  // Confirmed binding on the deployed build — these must keep binding.
  { message: '30', withoutCompetitor: 'MATCHED' },
  { message: 'roughly 30', withoutCompetitor: 'MATCHED' },
  // Recorded as "consumed as an option effect"; they bind fine when the
  // baseline ask is the sole claim, which is what made the form look causal.
  { message: '30 percent', withoutCompetitor: 'MATCHED' },
  { message: '30%', withoutCompetitor: 'MATCHED' },
  { message: '0', withoutCompetitor: 'MATCHED' },
  // Answer-shaped but unusable as a level: the baseline path OWNS the refusal.
  // "0.6" is the sharpest case — it was written as an effect value of 0.6 on
  // another node, while the baseline path would have said it could not tell
  // which scale it was on.
  { message: '0.6', withoutCompetitor: 'unreadable_answer' },
  { message: '.6', withoutCompetitor: 'unreadable_answer' },
  { message: '0.3', withoutCompetitor: 'unreadable_answer' },
  { message: '120', withoutCompetitor: 'unreadable_answer' },
  { message: '10-15%', withoutCompetitor: 'unreadable_answer' },
  { message: 'it is 0.6', withoutCompetitor: 'unreadable_answer' },
];

/**
 * NOT answers to the question asked — a new INSTRUCTION that happens to carry a
 * number, or an unrelated command. These must fall through untouched on BOTH
 * axes so the edit lane keeps them.
 */
const STILL_REACHES_THE_EDIT_LANE: readonly string[] = [
  "set the pilot's effect on cost to 0.3",
  'set the effect of annual contracts on adoption to 0.3',
  'run the analysis',
];

describe('baseline elicitation — precedence against a competing bare-number ask', () => {
  describe('an answer-shaped reply resolves at the baseline path, never as an unrelated edit', () => {
    it.each(ANSWER_SHAPED)(
      'resolves $message at the baseline path when another bare-number ask is live',
      ({ message }) => {
        const pendings = [baselinePending, effectPending];
        assertCollisionIsLive(pendings);

        const verdict = resume(message, pendings);

        // THE INVARIANT. Not "it asks" — that is one legal resolution among
        // three. What must never happen is the SILENT fall-through, because
        // that is the whole mechanism by which the number reached a lane that
        // wrote it somewhere else.
        expect(verdict.matched).toBe(false);
        expect(verdict).not.toMatchObject({ skip_reason: 'no_pending_question' });
        expect(verdict).toMatchObject({
          skip_reason: 'competing_ask',
          targetLabel: TARGET_LABEL,
        });
        // The ask can name the other question, so the user can actually choose.
        expect(
          verdict.matched === false && verdict.skip_reason === 'competing_ask'
            ? verdict.competing.map((p) => p.id)
            : null,
        ).toEqual(['pending-effect']);
      },
    );

    it.each(ANSWER_SHAPED)(
      'keeps $message behaving exactly as it does today when the baseline ask is the sole claim',
      ({ message, withoutCompetitor }) => {
        const pendings = [baselinePending];
        assertBaselineIsSoleClaim(pendings);

        const verdict = resume(message, pendings);

        if (withoutCompetitor === 'MATCHED') {
          expect(verdict).toMatchObject({ matched: true, targetLabel: TARGET_LABEL });
        } else {
          expect(verdict).toMatchObject({
            matched: false,
            skip_reason: 'unreadable_answer',
            targetLabel: TARGET_LABEL,
          });
        }
      },
    );
  });

  describe('the counterpart harm — a new instruction still reaches the edit lane', () => {
    it.each(STILL_REACHES_THE_EDIT_LANE)(
      'leaves %s untouched even with both asks live',
      (message) => {
        const pendings = [baselinePending, effectPending];
        assertCollisionIsLive(pendings);

        const verdict = resume(message, pendings);

        // Untouched means UNCLAIMED: no ask, no bind, no re-ask. The edit lane
        // owns the turn exactly as it did before this fix.
        expect(verdict).toEqual({ matched: false, skip_reason: 'no_pending_question' });
      },
    );

    it.each(STILL_REACHES_THE_EDIT_LANE)(
      'leaves %s untouched when the baseline ask is the sole claim',
      (message) => {
        const pendings = [baselinePending];
        assertBaselineIsSoleClaim(pendings);

        expect(resume(message, pendings)).toEqual({
          matched: false,
          skip_reason: 'not_an_answer',
        });
      },
    );
  });

  describe('the collision derivation is bound to the collision, not to "two pendings"', () => {
    it('does not claim a lone baseline ask', () => {
      expect(findBaselineAskCollision([baselinePending], NOW)).toBeNull();
    });

    it('does not claim a lone competing ask (there is no baseline question to protect)', () => {
      expect(findBaselineAskCollision([effectPending], NOW)).toBeNull();
    });

    it('does not claim a competitor whose kind cannot take a bare number', () => {
      const runAnalysis = {
        ...effectPending,
        id: 'pending-run',
        chip_id: 'chip_run_analysis',
        action: { kind: 'run_analysis' },
      } as unknown as PendingAction;
      // The ask turn routinely ships a "Run the analysis" chip in the same
      // commit. If that counted as a competitor the feature would be
      // unreachable — the sole-pending gate's own reason for not being
      // "sole among ALL live pendings".
      expect(findBaselineAskCollision([baselinePending, runAnalysis], NOW)).toBeNull();
      expect(resume('30', [baselinePending, runAnalysis])).toMatchObject({ matched: true });
    });

    it('does not claim an EXPIRED competitor', () => {
      const expired = {
        ...effectPending,
        expires_at_iso: new Date(NOW - 1000).toISOString(),
      } as unknown as PendingAction;
      expect(findBaselineAskCollision([baselinePending, expired], NOW)).toBeNull();
      expect(resume('30', [baselinePending, expired])).toMatchObject({ matched: true });
    });

    it('leaves two live baseline questions on the pre-existing silent fall-through', () => {
      const second = {
        ...baselinePending,
        id: 'pending-baseline-2',
        action: { ...(baselinePending.action as object), target_id: 'node-other' },
      } as unknown as PendingAction;
      expect(findBaselineAskCollision([baselinePending, second], NOW)).toBeNull();
      expect(resume('30', [baselinePending, second])).toEqual({
        matched: false,
        skip_reason: 'no_pending_question',
      });
    });

    it('stays silent when the question target has left the graph (nothing truthful to ask)', () => {
      expect(
        tryBaselineElicitationResume({
          message: '30%',
          pendingActions: [baselinePending, effectPending],
          nowMs: NOW,
          currentGraphHash: GRAPH_HASH,
          graphNodes: GRAPH_NODES.filter((n) => n.id !== TARGET_ID),
        }),
      ).toEqual({ matched: false, skip_reason: 'no_pending_question' });
    });
  });

  describe('the disambiguation copy', () => {
    it('names BOTH questions, so the reply can choose between them', () => {
      const text = formatBaselineAskCollision({
        targetLabel: TARGET_LABEL,
        competing: [effectPending],
      });
      expect(text).toContain(TARGET_LABEL);
      expect(text).toContain(OPTION_LABEL);
      expect(text).toContain(FACTOR_LABEL);
      // It states that nothing changed, which is true by construction on this
      // path: the caller returns before any handler runs.
      expect(text).toContain('Nothing has changed.');
      // Leak-safe on the same terms as the ask and the re-ask.
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/\belicit_|pending_action|handler_id|add_constraint\b/);
    });

    it('stays truthful, not stale, for a competing kind it cannot name', () => {
      const otherKind = {
        ...effectPending,
        action: { kind: 'elicit_edit_target' },
      } as unknown as PendingAction;
      const text = formatBaselineAskCollision({
        targetLabel: TARGET_LABEL,
        competing: [otherKind],
      });
      expect(text).toContain('the other question I asked just before this');
      expect(text).not.toMatch(/undefined/);
    });
  });
});
