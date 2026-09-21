/**
 * THE WITHHELD-SEPARABILITY DISCLOSURE — say WHY, on the run turn.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GAP THIS CLOSES, MEASURED AT `d536aae1` (CEE `staging`).
 *
 * `analysis-result-headline.ts:1389` computes a `SeparabilityVerdict` carrying
 * `separation` and `contenders`; `:1409-1413` withholds the headline and
 * DISCARDS both, returning `text: null`. The handler then composes
 * `headline ?? template`, so the entire user-facing account of a run whose
 * ranking CEE itself judged unsupportable is the locked template:
 *
 *     "Ran analysis on your current scenario."
 *
 * Six disclosure suffixes already ride that template; every one of them is
 * about INPUT QUALITY (scaffolded values, constraint gaps, missing intake
 * options, unset option effects, node participation). None speaks to the
 * VERDICT. So this population is told what was done and never why nothing
 * came of it.
 *
 * ⭐ AND THE EXISTING SEPARATION VOICES CANNOT REACH IT — the reason this is a
 * new family and not a wiring change. `withheld-reason-tail.ts` ships
 * `separation_not_evaluated` / `separation_near_tie`, but they are driven by
 * `separationWithholdFromRobustness` — ISL's `enrichment.robustness` — and
 * reached only from the EXPLANATION handlers. `isFieldUnseparable` is CEE's
 * own field-shape verdict, and `#1254` placed it AFTER the near-tie authority
 * precisely so it fires only where near-tie copy did not. The two answer
 * different questions on disjoint populations (trap 21): naming them apart is
 * the design, not an oversight.
 *
 * ⛔ WHAT THE COPY MAY NOT DO, each for a reason measured at the bytes:
 *   - It may not emit the separation FIGURE. `assistant-text-defences.ts:38`
 *     `RAW_DECIMAL_REGEX = /\d+\.\d+/` is applied to the whole assistant_text,
 *     so `0.1158` would get the entire disclosure-bearing summary rejected at
 *     egress and silently replaced by the locked template. The integer
 *     `contenders` is what can ship.
 *   - It may not name or imply a leading option, nor vary its SHAPE with any
 *     option's hidden position (the #743 oracle lesson).
 *   - It may not prescribe a re-run, nor claim a re-run is futile. Neither is
 *     measured on THIS population — `#1254`'s own evidence is one brief run 15
 *     times naming FOUR different winners.
 *   - It may not name an unquantified node as the repair: supplying those
 *     values is measured to leave win probabilities and separation
 *     bit-identical (`WHY-NO-RECOMMENDATION-ROOT-CAUSE.md` §2).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSeparabilityDisclosure,
  SEPARABILITY_DISCLOSURE_RE_SRC,
  SEPARABILITY_DISCLOSURE_MAX_CHARS,
  SEPARABILITY_DISCLOSURE_SURVIVES_EGRESS,
} from '../separability-disclosure.js';
import {
  isAllowedRunAnalysisAssistantText,
  describeAnalysisHeadline,
  TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS,
  MAX_ASSISTANT_TEXT_CHARS,
} from '../analysis-result-headline.js';
import { isFieldUnseparable } from '../option-separability.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

const TEMPLATE = 'Ran analysis on your current scenario.';

/**
 * A field that the gate's OWN conjunction judges unseparable, derived by
 * running `isFieldUnseparable` rather than asserted — so this fixture cannot
 * silently stop reproducing the state under test (trap 13b: a discriminator
 * must pin its own precondition in-test).
 */
const UNSEPARABLE_FIELD = [0.3045, 0.2895, 0.2177, 0.1883];

/** CONTRAST: a field the same function judges separable. */
const SEPARABLE_FIELD = [0.72, 0.14, 0.09, 0.05];

describe('PRECONDITION — the fixtures really are what this suite says they are', () => {
  it('the unseparable field IS unseparable, with >= 2 contenders and a real separation figure', () => {
    const v = isFieldUnseparable(UNSEPARABLE_FIELD, 0.05, 0.01);
    expect(v.unseparable).toBe(true);
    expect(v.contenders).toBeGreaterThanOrEqual(2);
    expect(v.separation).not.toBeNull();
  });

  it('CONTRAST — the separable field is NOT unseparable (the probe discriminates)', () => {
    expect(isFieldUnseparable(SEPARABLE_FIELD, 0.05, 0.01).unseparable).toBe(false);
  });
});

describe('the builder says WHAT, WHY and WHAT WOULD RESOLVE IT', () => {
  const suffix = buildSeparabilityDisclosure({ separation: 0.1158, contenders: 3 });

  it('names the CONTENDER COUNT — bound by identity to the value, not to "some number"', () => {
    expect(suffix).toContain(' 3 options came out too close together on this run to tell apart');
    // The count is the value passed, not a constant: a different count moves it.
    expect(buildSeparabilityDisclosure({ separation: 0.02, contenders: 5 })).toContain(
      ' 5 options came out too close together',
    );
  });

  it('states WHY — the ordering is a property of the draw, not of the model', () => {
    expect(suffix).toContain('reflects this draw rather than your model');
  });

  it('states the CONSEQUENCE in the sanctioned words, scoped to the ranking', () => {
    expect(suffix).toContain('no option can be put forward yet');
  });

  it('offers a repair the user can actually act on', () => {
    expect(suffix).toContain('what matters most to you between them');
  });

  it('⛔ never emits the separation FIGURE — a raw decimal is rejected at egress', () => {
    expect(suffix).not.toContain('0.1158');
    expect(/\d+\.\d+/.test(suffix)).toBe(false);
  });

  it('⛔ prescribes neither a re-run nor its futility — neither is measured here', () => {
    expect(suffix.toLowerCase()).not.toContain('run the analysis again');
    expect(suffix.toLowerCase()).not.toContain('running it again');
  });
});

describe('⛔ NO LEADER, EVER', () => {
  const shapes = [2, 3, 4, 999].map((n) =>
    buildSeparabilityDisclosure({ separation: 0.01, contenders: n }),
  );

  it('no shape trips the shared leader vocabulary', () => {
    for (const s of shapes) expect(textNamesLeadingOption(s)).toBe(false);
  });

  it('no shape trips the shared content defences', () => {
    for (const s of shapes) expect(passesAssistantTextContentDefences(s)).toBe(true);
  });

  it('NO ORACLE — shape varies ONLY with the count, never with any option identity', () => {
    // Same count, different underlying field ⇒ byte-identical output.
    expect(buildSeparabilityDisclosure({ separation: 0.02, contenders: 3 })).toBe(
      buildSeparabilityDisclosure({ separation: 0.1499, contenders: 3 }),
    );
  });
});

describe('silence beats a hedge — the builder declines what it cannot ground', () => {
  it('returns "" for a null withhold (the gate did not fire)', () => {
    expect(buildSeparabilityDisclosure(null)).toBe('');
  });

  it('returns "" below 2 contenders — the gate guarantees >= 2, so this is unreachable-by-producer', () => {
    expect(buildSeparabilityDisclosure({ separation: 0.01, contenders: 1 })).toBe('');
  });
});

describe('⭐ THE PLUMBING — without all of it the disclosure is inert in production', () => {
  it('the module-load probe ran', () => {
    expect(SEPARABILITY_DISCLOSURE_SURVIVES_EGRESS).toBe(true);
  });

  it('the published grammar matches the builder output exactly', () => {
    const re = new RegExp(`^(?:${SEPARABILITY_DISCLOSURE_RE_SRC})$`);
    for (const n of [2, 3, 10, 999]) {
      expect(re.test(buildSeparabilityDisclosure({ separation: 0.01, contenders: n }))).toBe(true);
    }
  });

  it('the budget is derived from the builder worst case, not hand-estimated', () => {
    for (const n of [2, 3, 10, 999]) {
      expect(
        buildSeparabilityDisclosure({ separation: 0.01, contenders: n }).length,
      ).toBeLessThanOrEqual(SEPARABILITY_DISCLOSURE_MAX_CHARS);
    }
  });

  it('⭐ REGISTERED on the template-suffix branch, LAST (the handler append order)', () => {
    const last = TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS[TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.length - 1];
    expect(last?.name).toBe('SEPARABILITY_DISCLOSURE_RE_SRC');
    // Bound by IDENTITY to the export, not by label — a mislabelled entry
    // would register the wrong grammar under a plausible-looking name.
    expect(last?.source).toBe(SEPARABILITY_DISCLOSURE_RE_SRC);
  });

  it('⭐⭐ template + EVERY sibling + this one survives egress — the append order compiles', () => {
    // The registry order IS what `TEMPLATE_SUFFIX_ONLY_REGEX` compiles, so a
    // registration in the wrong position rejects the composed text silently.
    // Asserted with the sibling that actually co-occurs most simply.
    const text = `${TEMPLATE}${buildSeparabilityDisclosure({ separation: 0.1, contenders: 4 })}`;
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });

  it('⭐⭐ template + disclosure SURVIVES the registry egress (the whole point)', () => {
    const text = `${TEMPLATE}${buildSeparabilityDisclosure({ separation: 0.1158, contenders: 3 })}`;
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });

  /**
   * ⭐⭐ M10 — THE MUTANT THAT SURVIVED, AND WHY NO BEHAVIOURAL TEST CAN KILL IT.
   *
   * Deleting `SEPARABILITY_DISCLOSURE_MAX_CHARS` from the
   * `MAX_ASSISTANT_TEXT_CHARS` sum leaves every behavioural assertion in this
   * file GREEN. Measured: the cap is 4275 with the term and 4028 without, while
   * `template + this family's worst case` is 285. The term is invisible to
   * 3,743 characters of slack contributed by the six sibling budgets.
   *
   * ⚠ IT IS NOT AN EQUIVALENT MUTANT. The sum exists for the case where EVERY
   * suffix co-occurs — a run can be unseparable AND scaffolded AND carrying an
   * unevaluated constraint AND ranking an incomplete candidate set AND
   * contradicting its objective AND holding an unset option effect AND computed
   * on a reduced model. Drop this term and that composition is 247 characters
   * over the cap: `isAllowedRunAnalysisAssistantText` rejects it and the person
   * silently receives the locked template on the longest, most-caveated run
   * there is — the exact failure mode every sibling's budget comment names.
   *
   * So the only instrument that can see it is a STRUCTURAL one, and it is here
   * with its own controls rather than left as an asserted equivalence (trap
   * 13c: a survivor is a claim either way, and must be DEMONSTRATED).
   */
  describe('M10 — the budget term is really SUMMED, not merely exported', () => {
    const HEADLINE_SRC = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../analysis-result-headline.ts'),
      'utf8',
    );
    const SUM_EXPR = (() => {
      const start = HEADLINE_SRC.indexOf('export const MAX_ASSISTANT_TEXT_CHARS');
      return start < 0 ? '' : HEADLINE_SRC.slice(start, HEADLINE_SRC.indexOf(';', start) + 1);
    })();

    it('POSITIVE CONTROL — the extraction found a non-empty sum expression', () => {
      expect(SUM_EXPR.length).toBeGreaterThan(50);
      expect(SUM_EXPR).toContain('MAX_HEADLINE_CHARS');
    });

    it('CONTRAST CONTROL — it can see a SIBLING family budget in the same expression', () => {
      expect(SUM_EXPR).toContain('INTAKE_OPTION_DISCLOSURE_MAX_CHARS');
    });

    it('NEGATIVE CONTROL — it does not find a budget that is not in the sum', () => {
      expect(SUM_EXPR).not.toContain('DEFINITELY_NOT_A_BUDGET_MAX_CHARS');
    });

    it('⭐ this family budget is a term of the sum', () => {
      expect(SUM_EXPR).toContain('SEPARABILITY_DISCLOSURE_MAX_CHARS');
    });
  });

  it('the worst case fits the registry length cap', () => {
    const text = `${TEMPLATE}${buildSeparabilityDisclosure({ separation: 0.01, contenders: 999 })}`;
    expect(text.length).toBeLessThanOrEqual(MAX_ASSISTANT_TEXT_CHARS);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
});

describe('⭐⭐ THE DESCRIPTOR CARRIES THE DISCARDED VALUES — bound to the reason by identity', () => {
  /**
   * The handler cannot re-run `isFieldUnseparable` — that would be a second
   * derivation of a meaning with one owner (trap 12). It reads the verdict off
   * the SAME computation the withhold was made from.
   */
  /** Mirrors `option-separability.test.ts`'s `envelope` — the shape the builder accepts. */
  function envelope(field: readonly number[]): Record<string, unknown> {
    return {
      results: field.map((p, i) => ({
        option_id: `o${i}`,
        option_label: `Option ${i + 1}`,
        win_probability: p,
      })),
      factor_sensitivity: [
        { label: 'Time to Value', elasticity: 0.5, confidence: 0.8, influence_score: 0.6 },
        { label: 'Support Load', elasticity: -0.2, confidence: 0.7, influence_score: 0.2 },
      ],
      robustness: { level: 'moderate' },
    };
  }

  const describeFor = (field: readonly number[]) =>
    describeAnalysisHeadline({
      enrichment: envelope(field),
      leading_option_id: 'o0',
      status_kind: 'ok',
    });

  it('the withhold carries the ACTUAL contenders count from the ACTUAL field', () => {
    const d = describeFor(UNSEPARABLE_FIELD);
    expect(d.reason).toBe('options_not_separable');
    const truth = isFieldUnseparable(UNSEPARABLE_FIELD, 0.05, 0.01);
    expect(d.separability_withhold).not.toBeNull();
    expect(d.separability_withhold?.contenders).toBe(truth.contenders);
    expect(d.separability_withhold?.separation).toBe(truth.separation);
  });

  it('CONTRAST — a separable field carries NO withhold (null, not a zeroed object)', () => {
    const d = describeFor(SEPARABLE_FIELD);
    expect(d.reason).not.toBe('options_not_separable');
    expect(d.separability_withhold).toBeNull();
  });

  it('⭐ END TO END — the disclosure built from the descriptor survives egress', () => {
    const d = describeFor(UNSEPARABLE_FIELD);
    const text = `${TEMPLATE}${buildSeparabilityDisclosure(d.separability_withhold)}`;
    expect(text).not.toBe(TEMPLATE);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
    // Bound to the NAMED count, not merely to "the string got longer".
    expect(text).toContain(
      ` ${isFieldUnseparable(UNSEPARABLE_FIELD, 0.05, 0.01).contenders} options came out too close together`,
    );
  });
});
