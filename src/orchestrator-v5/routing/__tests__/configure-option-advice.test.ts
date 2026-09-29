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

import {
  extractAdvisedExemplars,
  findNonRoutableConfigureAdvice,
} from '../configure-option-advice.js';
import { detectConfigureOptionIntent } from '../configure-option-intent.js';
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';

const OPTION_LABELS = ['Cloud-Native CRM', 'Acquire Small German Competitor'];

// ---------------------------------------------------------------------------
// Positive control for the extractor (trap 13 — an absence assertion is
// vacuous until the mechanism provably sees a presence).
// ---------------------------------------------------------------------------

describe('extractAdvisedExemplars — positive control', () => {
  it('sees single-quoted, double-quoted and multiple exemplars', () => {
    expect(
      extractAdvisedExemplars("Nothing changed. Say 'configure the X option' and go."),
    ).toEqual(['configure the X option']);
    expect(
      extractAdvisedExemplars('Try it, for example "configure my option: set Cost to 5".'),
    ).toEqual(['configure my option: set Cost to 5']);
    expect(extractAdvisedExemplars('No advice here at all.')).toEqual([]);
  });

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
  it('does not terminate a single-quoted exemplar on a possessive apostrophe', () => {
    const advised = buildConfigureOptionAdvisedFormat('Cloud-Native CRM', 'Adoption Complexity', '0.7');
    expect(advised).toContain("option's"); // the precondition that makes this bite
    expect(extractAdvisedExemplars(`Say '${advised}'.`)).toEqual([advised]);
  });

  /**
   * Smart quotes, handled rather than documented (adversarial review of
   * `572f7ea9`). LLM prose routinely emits typographic quotes, and an extractor
   * blind to them would go silent on exactly the copy this guard polices —
   * the failure direction where broken advice ships unnoticed.
   */
  it('sees typographic single and double quotes', () => {
    expect(extractAdvisedExemplars('Say \u2018configure the X option\u2019 to go.')).toEqual([
      'configure the X option',
    ]);
    expect(extractAdvisedExemplars('For example \u201Cconfigure my option\u201D.')).toEqual([
      'configure my option',
    ]);
  });

  it('does not terminate a curly-quoted exemplar on a typographic apostrophe', () => {
    // U+2019 is BOTH the closing curly quote and the correct apostrophe, so
    // this is the ambiguous case — resolved the way a reader resolves it.
    const advised = "Set the Cloud-Native CRM option\u2019s effect on Adoption Complexity to 0.7";
    expect(extractAdvisedExemplars(`Say \u2018${advised}\u2019.`)).toEqual([advised]);
  });

  it('sees a REAL captured advice sentence', () => {
    // Deployed CEE `98f2476`, capture `P2_2_confirm.json` — the only quoted
    // advice the 71-capture set actually contains. Extractor must see it, and
    // (below) the detector must accept it.
    const captured =
      "If you want to set them now, say 'configure the Cloud-Native CRM option' and I'll walk through each one.";
    expect(extractAdvisedExemplars(captured)).toEqual(['configure the Cloud-Native CRM option']);
  });
});

// ---------------------------------------------------------------------------
// MUST CATCH — option-referring advice the product would then refuse.
// ---------------------------------------------------------------------------

describe('findNonRoutableConfigureAdvice — the closed loop', () => {
  /**
   * NOT INVENTED. This is the exact phrasing PR #487's round-3 review caught
   * the misroute clarify shipping, recorded verbatim in the header of
   * `configure-option-copy-detector-contract.test.ts`: it names an option and
   * the detector does NOT match it, so a user who typed it back would be
   * refused by the same product that suggested it.
   */
  const HISTORICAL_BROKEN_ADVICE = 'the acquisition option sets Setup Cost to £2m';

  it('catches the historically-shipped non-routable advice', () => {
    // Precondition pinned in-test (trap 13b): this case only discriminates
    // while the detector genuinely rejects the exemplar. If a future widening
    // makes it route, this test must say so rather than keep passing.
    expect(
      detectConfigureOptionIntent(HISTORICAL_BROKEN_ADVICE, OPTION_LABELS).matched,
      'precondition broken: the exemplar now routes, so it can no longer prove the loop',
    ).toBe(false);

    expect(
      findNonRoutableConfigureAdvice(
        `Nothing was changed. Say '${HISTORICAL_BROKEN_ADVICE}' to proceed.`,
        OPTION_LABELS,
      ),
    ).toBe(HISTORICAL_BROKEN_ADVICE);
  });

  it('catches advice anchored on an option LABEL rather than the word "option"', () => {
    const byLabel = 'Cloud-Native CRM should be stronger on cost';
    expect(detectConfigureOptionIntent(byLabel, OPTION_LABELS).matched).toBe(false);
    expect(
      findNonRoutableConfigureAdvice(`For example "${byLabel}".`, OPTION_LABELS),
    ).toBe(byLabel);
  });
});

// ---------------------------------------------------------------------------
// MUST LEAVE ALONE — everything outside the class it can prove is broken.
// ---------------------------------------------------------------------------

describe('findNonRoutableConfigureAdvice — deliberate non-reach', () => {
  it('passes the advised format the product itself sanctions', () => {
    const advised = buildConfigureOptionAdvisedFormat(
      'Cloud-Native CRM',
      'Adoption Complexity',
      '0.7',
    );
    expect(findNonRoutableConfigureAdvice(`Say '${advised}'.`, OPTION_LABELS)).toBeNull();
  });

  it('passes the real captured advice sentence', () => {
    expect(
      findNonRoutableConfigureAdvice(
        "If you want to set them now, say 'configure the Cloud-Native CRM option'.",
        OPTION_LABELS,
      ),
    ).toBeNull();
  });

  it('ignores quoted advice that names no option (a clarifying question stays preserved)', () => {
    // ⚠ THE SCOPE DECISION, pinned. Factor-only advice such as
    // "Set Customer Retention Investment to £40,000" is NOT claimed here. The
    // 2.11 diagnosis refused to make that shape route — claiming it would
    // reroute every plain "set X to N" off `set_factor_value` into the edit
    // LLM, a blast radius that diagnosis explicitly declined. So this predicate
    // stays inside the class where a non-routing suggestion is unambiguously
    // broken. Widening it is a separate, rowed decision — not a tidy-up.
    expect(
      findNonRoutableConfigureAdvice(
        'Say "Set Customer Retention Investment to £40,000" when you know the number.',
        OPTION_LABELS,
      ),
    ).toBeNull();
    expect(findNonRoutableConfigureAdvice('Just say "yes" to confirm.', OPTION_LABELS)).toBeNull();
  });

  it('ignores prose with no quoted advice at all', () => {
    expect(
      findNonRoutableConfigureAdvice(
        'Which option did you mean — the Cloud-Native CRM one, or the other?',
        OPTION_LABELS,
      ),
    ).toBeNull();
  });

  it('degrades safely on non-string input', () => {
    expect(extractAdvisedExemplars(undefined as unknown as string)).toEqual([]);
    expect(
      findNonRoutableConfigureAdvice(undefined as unknown as string, OPTION_LABELS),
    ).toBeNull();
  });
});
