/**
 * ⭐⭐ THE BUNDLED FALLBACK MUST CARRY THE SAME CLAIM DOCTRINE AS THE LIVE PROMPT.
 *
 * MEASURED ON STAGING, 21 Sep 2026, against the real prompt store
 * (`/v1/prompts/status` + `/admin/prompts`): `orchestrator` and
 * `decision_review` are served with `source: "store"`, NOT from this file —
 * 9 of 23 cached tasks come from the store and these are two of them. So the
 * live text already bans the worst wording.
 *
 * ⛔ THE FALLBACK DID NOT. This 1,400-line file carried NO terminology ban at
 * all — its only `recommend` match was a field name — while instructing the
 * model to "name the leading option, its win probability". The store is a
 * runtime dependency (`isDbBackedStoreHealthy`); when it is unhealthy CEE
 * serves THIS file. The degraded path was therefore the one most willing to
 * pick a winner, which is the exact inversion of what a fallback should be.
 *
 * ⚠ AND BANNING THE WORD IS NOT ENOUGH. The live prompt bans "winner" but
 * PRESCRIBES "performs best" / "comes out ahead" as the approved phrasing.
 * Those assert that an OPTION is superior. Olumi may only rank the LIKELIHOOD
 * of a stated outcome — most likely to achieve the user's goal, to reach a
 * named outcome, or to occur. This suite pins the distinction, because a
 * synonym that survives a word-ban is how the doctrine leaks back in.
 */
import { describe, expect, it } from 'vitest';

import { getDefaultPrompts } from '../loader.js';
import { registerAllDefaultPrompts } from '../defaults.js';

/**
 * ⭐ READS THE REGISTERED DEFAULT, NOT THE CONSTANT. `defaults.ts` registers
 * `getOrchestratorPromptV28()` — a function's OUTPUT — so asserting against
 * the exported `ORCHESTRATOR_PROMPT_CF_V28` string would prove nothing about
 * what the loader actually serves if the two ever diverge. Same binding the
 * sibling `decision-review-race-framing.test.ts` uses, for the same reason.
 */
registerAllDefaultPrompts();
const PROMPT = getDefaultPrompts().orchestrator;

describe('the bundled fallback prompt never licenses a winner or a recommendation', () => {
  it('is the prompt actually exported (guards against an empty/renamed constant)', () => {
    expect(typeof PROMPT).toBe('string');
    expect(PROMPT.length).toBeGreaterThan(5000);
  });

  it('forbids every adjudicating phrase, by name', () => {
    for (const banned of [
      'winner',
      'win rate',
      'the best choice',
      'you should choose',
      'I recommend',
    ]) {
      expect(
        PROMPT.includes(`"${banned}"`),
        `the ban list must name ${JSON.stringify(banned)} explicitly`,
      ).toBe(true);
    }
  });

  /**
   * ⭐ THE DISCRIMINATING CASE. A word-ban alone passes the test above and
   * still lets the model say "performs best", which is the same claim. The
   * prompt must reject the SUBSTITUTION, not just the vocabulary.
   */
  it('rejects superiority SYNONYMS, not just the banned vocabulary', () => {
    expect(PROMPT).toContain('performs best');
    expect(PROMPT).toContain('comes out ahead');
    expect(PROMPT.toLowerCase()).toContain('rank the outcome');
  });

  it('states the permitted claim — likelihood of a named outcome', () => {
    expect(PROMPT.toLowerCase()).toContain('most likely to achieve');
    expect(PROMPT.toLowerCase()).toContain('most likely to occur');
  });

  it('does NOT instruct the model to name a leading option as a headline', () => {
    expect(
      PROMPT,
      'the EVALUATE lead-in must rank the outcome, not the option',
    ).not.toContain('name the leading option, its win probability');
  });

  it('says plainly that the user decides', () => {
    expect(PROMPT.toLowerCase()).toContain('the user decides');
  });
});
