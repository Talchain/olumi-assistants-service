/**
 * Captured-session corpus: an advice question is not an edit instruction.
 *
 * ORACLE: the 14 user turns of hiring scenario 82f31082-6c38-47be-9550-cf465d0b7d4b,
 * read from the user's own debug export olumi-debug-2ac23ec6-20260915.json
 * (22:32:50 UTC, 15 Sep 2026) and assessed in
 * `.codex/olumi-evidence/20260915/manual-hiring-82f31082/ASSESSMENT.md` finding 1.
 * The strings below are the user's, transcribed from that export — NOT authored
 * here. A fixture written by the author of the fix is not evidence about the wire.
 *
 * WHAT THIS PINS: the three-predicate chain route-v2 gates `edit_graph` dispatch
 * on — EDIT_GRAPH_POSITIVE_REGEX && !EDIT_GRAPH_NEGATIVE_REGEX &&
 * !isAnalyticalQuestion. Route-v2 assembles edit intent from further detectors;
 * this suite is scoped to THIS chain and claims nothing about the others.
 *
 * BOTH DIRECTIONS ARE ASSERTED. A corpus that only proves questions stop
 * dispatching is a guard watching one door: the same widening that frees an
 * advice question can silently swallow the explicit edit and the confirmation
 * the user typed minutes earlier. Every suppression case below is paired with a
 * captured turn that MUST still dispatch.
 */

import { describe, expect, it } from 'vitest';

import { isAnalyticalQuestion } from '../analytical-question-guard.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';

/** The exact gate route-v2 applies before dispatching the V4 edit_graph LLM. */
function dispatchesEditGraph(message: string): boolean {
  return (
    EDIT_GRAPH_POSITIVE_REGEX.test(message) &&
    !EDIT_GRAPH_NEGATIVE_REGEX.test(message) &&
    !isAnalyticalQuestion(message)
  );
}

/** Captured turn 9 — the witnessed misroute (CEE request 8a366af6). */
const CAPTURED_ADVICE_QUESTION =
  'How do you recommend we add it to the decision?';

/** Captured turns 12/13 — the user's central decision question, asked twice. */
const CAPTURED_DECISION_QUESTION =
  'Should I hire a Tech lead or two developers to increase productivity?';

/** Captured turn 3 — an explicit, itemised edit the user authorised. */
const CAPTURED_EXPLICIT_EDIT =
  "Yes, add factor 'Senior Developer Morale', add risk 'Team Disruption from Tech Lead Hire'";

/** Captured turn 4 — an edit stated as a first-person intention. */
const CAPTURED_INTENDED_EDIT =
  "I want to add the risk that I've just told you about.";

/** Captured turn 6 — the confirmation that must still reach the edit path. */
const CAPTURED_CONFIRMATION = 'Okay, add this, and then we can rerun the analysis.';

describe('an advice question containing an edit verb is not an edit instruction', () => {
  it('captured turn 9 asks for a recommendation and must not dispatch edit_graph', () => {
    // The verb "add" is the OBJECT of the recommendation being sought, not an
    // instruction. Before this guard extension the bare verb carried the turn
    // into the V4 edit LLM, which returned no operations and asked the user for
    // a factor and a value instead of answering.
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(CAPTURED_ADVICE_QUESTION)).toBe(true);
    expect(isAnalyticalQuestion(CAPTURED_ADVICE_QUESTION)).toBe(true);
    expect(dispatchesEditGraph(CAPTURED_ADVICE_QUESTION)).toBe(false);
  });

  it('the captured hiring question must not dispatch edit_graph when asked mid-session', () => {
    // Turns 12/13 opened the session, so the draft path owned them and this gate
    // was not what answered. The defect is latent, not hypothetical: the same
    // sentence asked again after the scenario exists reaches this chain, and
    // "increase" carries the user's central decision question into the editor.
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(CAPTURED_DECISION_QUESTION)).toBe(true);
    expect(dispatchesEditGraph(CAPTURED_DECISION_QUESTION)).toBe(false);
  });
});

describe('the opposite direction: captured edit intent still dispatches', () => {
  it.each([
    ['explicit itemised edit (turn 3)', CAPTURED_EXPLICIT_EDIT],
    ['first-person intended edit (turn 4)', CAPTURED_INTENDED_EDIT],
    ['confirmation of a held proposal (turn 6)', CAPTURED_CONFIRMATION],
  ])('%s still reaches edit_graph', (_name, message) => {
    expect(dispatchesEditGraph(message)).toBe(true);
  });

  it('an explicit command MIXED with a question is an instruction, not a question', () => {
    // ⚠ THESE THREE ARE REGRESSIONS THIS CHANGE SHIPPED AND AN INDEPENDENT
    // ROUTE-LEVEL COMPARISON CAUGHT — not cases imagined here.
    //
    // CX-20260916-42 ran them through the real Fastify route against a control
    // built from the previous routing files, and all three newly LOST the edit
    // lane: a user issued a real instruction and would have watched it do
    // nothing. The first hides "Should we" inside a QUOTED FACTOR NAME; the
    // other two put a command and a question in one message, in both orders.
    //
    // My own suite claimed "both directions asserted" and still missed them,
    // because its opposite-direction half held pure edits and polite requests
    // and no message that MIXED the two — the obvious adversarial class, and
    // exactly the one a corpus written beside the fix does not think of. Pinned
    // by name so a future widening of the advice patterns REDs here.
    for (const message of [
      'Add a factor called "Should we hire contractors?"',
      'Add a risk for churn. Should we hire a tech lead?',
      'How do you recommend we manage morale? Add a factor for staff morale.',
    ]) {
      expect(isAnalyticalQuestion(message), `newly suppressed: ${message}`).toBe(false);
      expect(dispatchesEditGraph(message), `lost the edit lane: ${message}`).toBe(true);
    }
  });

  it('a polite request that the assistant perform the edit still dispatches', () => {
    // The dangerous over-reach for this change. "Can you add X?" is an
    // interrogative AND an instruction; suppressing it would convert a working
    // edit into a conversation. These pass BEFORE the change as well as after —
    // that is the point. They are not new capability, they are the ratchet that
    // catches a future widening of the advice patterns, which is the direction
    // this predicate has historically drifted. No veto mechanism is relied on:
    // both new patterns are anchored on an advice verb or the deliberative
    // "should I / should we", neither of which these four messages contain.
    for (const message of [
      'Can you add a risk for staff churn?',
      'Could you set the budget to £200,000?',
      'Would you remove the Status Quo option?',
      'Please add a factor for onboarding time.',
    ]) {
      expect(dispatchesEditGraph(message)).toBe(true);
    }
  });
});
