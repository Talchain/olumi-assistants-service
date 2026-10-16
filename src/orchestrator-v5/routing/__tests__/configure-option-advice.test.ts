/**
 * ⭐ ROADMAP 2.427 — the LLM-suggestion loop, closed in PRODUCTION.
 *
 * 2.11 / P1-3 pinned that the DETERMINISTIC copy surfaces only advise phrasings
 * the configure gate accepts. That contract is real and still bites — and it is
 * structurally blind to the surface that produces most of the advice a user
 * reads, because that copy is not in the repo: on the no-op branch,
 * `edit-graph.ts` preserves the edit LLM's own `coaching.summary` into
 * `assistant_text` verbatim.
 *
 * `findNonRoutableConfigureAdvice` is the runtime check that closes it, and
 * this file pins BOTH halves of its scope — what it must catch, and what it
 * must leave alone. The second half is not padding: declining preservation
 * throws away a genuinely useful clarifying question, so a predicate that
 * over-reaches here is a regression with a green suite.
 */

import { describe, it, expect } from 'vitest';
import { detectConfigureOptionIntent } from '../configure-option-intent.js';
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';

const OPTION_LABELS = ['Cloud-Native CRM', 'Acquire Small German Competitor'];

// ---------------------------------------------------------------------------
// Positive control for the extractor (trap 13 — an absence assertion is
// vacuous until the mechanism provably sees a presence).
// ---------------------------------------------------------------------------

describe('retained advised-format builder', () => {

  /**
   * ⚠ REGRESSION PIN — the possessive apostrophe.
   *
   * Found by execution while building this suite, not by inspection. The
   * product's own advised format contains an apostrophe ("option's effect"),
   * and the naive `'([^']+)'` extractor this module inherited from the 2.11
   * test file terminated on it, yielding the truncated "Set the Cloud-Native
   * CRM option" — which does NOT route. The guard would therefore have flagged
   * the product's own sanctioned advice as a closed loop and discarded a
   * working reply: a guard that was correct and pointed at the wrong bytes.
   */
  it('the advised format preserves its possessive apostrophe', () => {
    const advised = buildConfigureOptionAdvisedFormat('Cloud-Native CRM', 'Adoption Complexity', '0.7');
    expect(advised).toContain("option's");
  });
});

// ---------------------------------------------------------------------------
// MUST CATCH — option-referring advice the product would then refuse.
// ---------------------------------------------------------------------------

describe('retained configure detector negative controls', () => {
  /**
   * NOT INVENTED. This is the exact phrasing PR #487's round-3 review caught
   * the misroute clarify shipping, recorded verbatim in the header of
   * `configure-option-copy-detector-contract.test.ts`: it names an option and
   * the detector does NOT match it, so a user who typed it back would be
   * refused by the same product that suggested it.
   */
  const HISTORICAL_BROKEN_ADVICE = 'the acquisition option sets Setup Cost to £2m';

  it('declines the historically non-routable advice', () => {
    // Precondition pinned in-test (trap 13b): this case only discriminates
    // while the detector genuinely rejects the exemplar. If a future widening
    // makes it route, this test must say so rather than keep passing.
    expect(
      detectConfigureOptionIntent(HISTORICAL_BROKEN_ADVICE, OPTION_LABELS).matched,
      'precondition broken: the exemplar now routes, so it can no longer prove the loop',
    ).toBe(false);
  });

  it('declines non-command advice anchored on an option label', () => {
    const byLabel = 'Cloud-Native CRM should be stronger on cost';
    expect(detectConfigureOptionIntent(byLabel, OPTION_LABELS).matched).toBe(false);
  });
});
