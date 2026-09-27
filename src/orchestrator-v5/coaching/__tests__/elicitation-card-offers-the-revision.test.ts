/**
 * ⭐ AN ELICITATION CARD LEADS TO THE AUTHORISED REVISION, NOT AWAY FROM IT — RED-first (served 27 Sep, R&C dloop-2).
 *
 * THE DEFECT (CEE dfba539, Paul's brief): the user clicked "Give the real figure", answered the Agent's question with
 * "Our monthly churn is actually 12%.", and the Agent replied "The model still holds Olumi's 6% estimate, and I have
 * not changed or re-run anything" — no proposal, so the re-run used 6%. The card's prompt had ended "Don't change the
 * model or re-run anything yet.", and the Agent carried that open-ended "yet" into the user's NEXT turn. (dloop-1 on
 * d591b3e happened to propose; the stickiness is intermittent, which is why the words must not invite it.)
 *
 * THE RULE: a card that ASKS for the user's figure or belief (the estimate card, the assumed-link card) ends by
 * offering to record the answer for the user to approve — and still changes nothing until they do. The click turn
 * itself stays write-free by typed authority (`chip-click-withholds-authority.test.ts`), not by these words. A card
 * that only explains (the fragile-link pressure-test) keeps its no-change clause: its next step is not a revision.
 */
import { describe, it, expect } from 'vitest';
import { composeEstimatedLimitCard } from '../estimated-limit-card.js';
import { composeAssumedLinkChallenge, composeFragileLinkChallenge, RUN_TURN_COACHING_CONTRACT } from '../fragile-link-challenge.js';

const STICKY = /re-run anything yet/;
const OFFERS = /offer to record my answer for me to approve/;
const HOLDS = /change nothing until I do/;

const estimate = (whose: 'olumi' | 'ratified') =>
  composeEstimatedLimitCard({ nodeId: 'monthly_churn', kind: 'factor', label: 'Monthly churn', level: '6% per month', whose });

describe('an elicitation card offers the revision it asks for', () => {
  it.each(['olumi', 'ratified'] as const)('RED: the estimate card (%s) offers to record the answer for approval, with no open-ended "yet"', (whose) => {
    const p = estimate(whose).action_prompt;
    expect(p).not.toMatch(STICKY);
    expect(p).toMatch(OFFERS);
    expect(p).toMatch(HOLDS);
    expect(p.length).toBeLessThanOrEqual(RUN_TURN_COACHING_CONTRACT.limits.action_prompt_max);
    // Positive control: it still asks for the figure and its basis.
    expect(p).toContain('Ask me what the real figure is and what it rests on.');
  });

  it('RED: the assumed-link card offers to record the answer for approval', () => {
    const p = composeAssumedLinkChallenge('AI feature availability', 'Monthly churn', false).action_prompt;
    expect(p).not.toMatch(STICKY);
    expect(p).toMatch(OFFERS);
    expect(p).toMatch(HOLDS);
  });

  it('CONTRAST: the explain-only pressure-test card keeps its no-change clause', () => {
    expect(composeFragileLinkChallenge('Price', 'Monthly churn', false).action_prompt).toMatch(STICKY);
  });
});
