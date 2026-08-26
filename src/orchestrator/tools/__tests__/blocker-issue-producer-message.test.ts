/**
 * THE PRODUCER'S OWN SENTENCE REACHES THE USER — FOR THE PAIR-SCOPED CASE, AND
 * ONLY FOR THAT CASE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CLOSES
 *
 * `blockerIssue` is the single mapper behind THREE live surfaces:
 *   1. `mapWireBlockers` (`compose/analysis-state-v1.ts:462`)
 *        → `analysis_state.readiness.blockers` → the V3 footer, which renders
 *          `blocker.message` VERBATIM as its FIRST rung
 *          (`DecisionGuideAI` `composeBlockedReason.ts:662`, vetted by
 *          `isSafeCeeText`; the label/count rungs are the explicit degrade).
 *   2. `appendSemanticIssues` (`analysis-ready-helper.ts:923`)
 *        → `blockingIssues` → `toBlocker` → the `blocker_reason` headline.
 *   3. `requiredInputForIssue` `{ prompt: issue.message }`
 *        → `repairProposal.unresolved_inputs[].prompt` → `readinessQuestions()`
 *        → THE CHAT'S REFUSAL QUESTIONS (the 20 Aug carry-through capability).
 *
 * It was DISCARDING the producer's message and synthesising a substitute — the
 * exact behaviour the shared contract forbids ("rendered VERBATIM … a consumer
 * must not rewrite, summarise … or SYNTHESISE A SUBSTITUTE WHEN IT DISLIKES THE
 * WORDING"). So CEE composed a sentence naming the option, the factor and the
 * factor's current value, and the product showed a generic instruction instead.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ WHY THIS IS NARROW BY MEASUREMENT, NOT BY TIMIDITY
 *
 * A BLANKET "render the producer verbatim" TRADES ONE TRUTHFULNESS DEFECT FOR
 * THREE. Measured across all four producers of `AnalysisBlocker`:
 *
 *   producer                              | (A) message                        | verdict
 *   :817  missing_value  (option+factor)  | Factor "X" is currently 50,000.    | (A) WINS —
 *                                         | What should option "Y" set it to?  | names the pair,
 *                                         |                                    | gives the value,
 *                                         |                                    | asks the question
 *   :867  ambiguous_value                 | …its analysis-scale source binding | (C) WINS — that is
 *                                         | is unresolved                      | internal jargon
 *   :1124 missing_value  (factor only)    | Factor "X" is not connected to     | (C) WINS — a
 *                                         | any option                         | DIAGNOSIS, no remedy
 *   :1685 constraint_dropped              | Constraint dropped (<id>): <reason>| (C) WINS — leaks an
 *                                         |                                    | internal id
 *
 * **(A)'s messages were never written to be the live user-facing sentence.**
 * Only one of the four classes authors prose fit for a user, so the preference
 * is scoped to that class. The canned copy is at least written for a human;
 * replacing it with jargon would be worse than the defect being fixed.
 *
 * ⚠ THE CONTRACT QUESTION THIS RAISES IS DELIBERATELY NOT RESOLVED HERE: the
 * shared contract obliges consumers to render the message VERBATIM, but only
 * one of four classes authors a sentence fit for that obligation. Either the
 * obligation is scoped narrower than the field, or the other three messages
 * need rewriting. Reported, not decided — see the PR body.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DISCRIMINATOR IS STRUCTURAL, NEVER PROSE (trap 22f)
 *
 * The two `missing_value` producers are told apart by whether the blocker names
 * an OPTION — `:817` always sets `option_id`, `:1124` never does. That is a
 * field-presence test on the payload, not a predicate over natural language, so
 * it cannot oscillate the way a prose classifier would.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names the blocker it reads.
 * `fac_untested` carries a full producer message and is deliberately NEVER
 * asserted, so a mutation scoped to it must leave this suite GREEN.
 */

import { describe, it, expect } from 'vitest';

import { blockerIssue } from '../analysis-ready-helper.js';

const PRODUCER_PAIR_SENTENCE =
  'Factor "CRM Annual Licence Cost" is currently 50,000. What should option "Switch to HubSpot" set it to?';

function pairBlocker(overrides: Record<string, unknown> = {}) {
  return {
    option_id: 'opt_hubspot',
    option_label: 'Switch to HubSpot',
    factor_id: 'fac_licence_cost',
    factor_label: 'CRM Annual Licence Cost',
    blocker_type: 'missing_value',
    message: PRODUCER_PAIR_SENTENCE,
    suggested_action: 'add_value',
    ...overrides,
  };
}

describe('blockerIssue — the producer authored the sentence, so the producer keeps it', () => {
  it('carries the pair-scoped missing_value message through verbatim', () => {
    const issue = blockerIssue(pairBlocker(), 0, 'needs_user_input');

    // PRECONDITION PINNED IN-TEST (trap 13b): this blocker really does name BOTH
    // scopes, so a green result cannot come from a fixture that never exercised
    // the discriminator.
    expect(issue?.option_id).toBe('opt_hubspot');
    expect(issue?.factor_id).toBe('fac_licence_cost');

    expect(issue?.code).toBe('MISSING_OPTION_VALUE');
    expect(issue?.message).toBe(PRODUCER_PAIR_SENTENCE);
    // …and the synthesised substitute is unreachable for this class.
    expect(issue?.message).not.toContain('Choose the missing effect value');
  });

  it('falls back to the composed remedy when the producer authored no message', () => {
    // Honest at the bottom rung: the sentence is SAID, never omitted.
    const issue = blockerIssue(pairBlocker({ message: '   ' }), 0, 'needs_user_input');
    expect(issue?.message).toBe(
      'Choose the missing effect value for "Switch to HubSpot" on "CRM Annual Licence Cost".',
    );
  });

  it('KEEPS the composed remedy for a factor-only missing_value — a diagnosis is not a remedy', () => {
    // `:1124`'s producer message is "Factor … is not connected to any option":
    // true, and useless as the sentence a blocked user is handed.
    const issue = blockerIssue(
      {
        factor_id: 'fac_orphan',
        factor_label: 'Support Response Time',
        blocker_type: 'missing_value',
        message: 'Factor "Support Response Time" is not connected to any option',
      },
      0,
      'needs_user_input',
    );

    expect(issue?.option_id).toBeUndefined(); // the discriminator, pinned
    expect(issue?.message).toBe('Choose the missing effect value for "Support Response Time".');
    expect(issue?.message).not.toContain('is not connected to any option');
  });

  it('KEEPS the unreachable-factor remedy, which is the actionable one', () => {
    const issue = blockerIssue(
      {
        factor_id: 'fac_orphan',
        factor_label: 'Support Response Time',
        blocker_type: 'missing_value',
        message: 'Factor "Support Response Time" is not connected to any option',
      },
      0,
      'needs_user_mapping',
    );

    expect(issue?.code).toBe('UNREACHABLE_CONTROLLABLE_FACTOR');
    expect(issue?.message).toBe(
      'Choose which option changes for "Support Response Time" and by how much.',
    );
  });

  it('KEEPS the composed remedy for ambiguous_value — the producer emits internal jargon there', () => {
    const issue = blockerIssue(
      pairBlocker({
        blocker_type: 'ambiguous_value',
        message:
          'Option "Switch to HubSpot" states 50000 for "CRM Annual Licence Cost", but its analysis-scale source binding is unresolved',
      }),
      0,
      'needs_user_input',
    );

    expect(issue?.code).toBe('AMBIGUOUS_OPTION_VALUE');
    expect(issue?.message).toBe(
      'Confirm the effect value for "Switch to HubSpot" on "CRM Annual Licence Cost".',
    );
    expect(issue?.message).not.toContain('analysis-scale source binding');
  });

  it('KEEPS the composed remedy for missing_connection', () => {
    const issue = blockerIssue(
      pairBlocker({
        blocker_type: 'missing_connection',
        message: 'some producer prose for a connection gap',
      }),
      0,
      'needs_user_input',
    );

    expect(issue?.code).toBe('MISSING_OPTION_CONNECTION');
    expect(issue?.message).toBe(
      'Choose the missing connection for "Switch to HubSpot" on "CRM Annual Licence Cost".',
    );
  });
});
