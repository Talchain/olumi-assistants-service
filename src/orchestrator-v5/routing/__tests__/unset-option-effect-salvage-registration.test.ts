/**
 * ⭐ THE UNSET-OPTION-EFFECT FAMILY IS REGISTERED ON THE TEMPLATE BRANCH —
 * pinned by BEHAVIOUR and by IDENTITY, because bookkeeping alone cannot see it.
 *
 * ## Why this file exists
 *
 * #1179 registered `UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC` on the WITHHELD
 * egress branch by editing the `TEMPLATE_SUFFIX_ONLY_REGEX` regex LITERAL. This
 * PR replaced that literal with an expression derived from
 * `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS`. The two changes conflicted on exactly
 * that line, and **resolving the conflict by taking the derived expression alone
 * silently un-registers the family** — the withheld branch stops admitting the
 * sentence, and the run_analysis salvage stops rescuing it.
 *
 * ## What was ALREADY guarded, and what was not — MEASURED, not assumed
 *
 * The brief for this lane said #1179's own specs pass regardless of the
 * resolution. **Mutation testing refuted that, in one direction and confirmed it
 * in the other**, and the distinction is the reason this file is scoped the way
 * it is:
 *
 *   - **The EGRESS/admission half was already guarded.** `unset-option-effect-
 *     egress.test.ts` asserts `LOCKED_TEMPLATE + disclosure` is admissible, so
 *     BOTH wrong resolutions — dropping the entry, and moving it to the
 *     exclusion list — RED it (2/9 each). The un-registration would have been
 *     caught. That claim is withdrawn, and this file does not rest on it.
 *
 *   - **The SALVAGE half was guarded by NOTHING.** Breaking the salvage for this
 *     family alone leaves `unset-option-effect-egress.test.ts` (9), `unset-
 *     option-effect-disclosure.test.ts` (24), `run-analysis-unset-option-effect-
 *     wiring.test.ts` (4), the completeness spec (10) and the sibling salvage
 *     spec (10) **all green**. Only the SALVAGE assertions below go red.
 *
 * That gap is not hypothetical: on pristine staging a rejected summary carrying
 * this disclosure returns the bare `"Ran analysis on your current scenario."`
 * while the disclosure is independently admissible — a run rendered with no
 * indication its compared options had no effects set.
 *
 * ## Why the completeness guard is NOT sufficient either
 *
 * `template-suffix-disclosure-registry-completeness.test.ts` asserts every
 * exported `*_RE_SRC` is EITHER registered OR reasoned-excluded. That is
 * BOOKKEEPING, and bookkeeping has a green wrong answer: moving this entry from
 * `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS` to
 * `TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS` with any plausible 30-character reason
 * satisfies the union assertion, the both-lists assertion, the exported-name
 * assertions and the identity binding — **all ten green** (measured). The guards
 * are complementary, not redundant (CLAUDE.md trap 12d): the union assertion
 * notices a family nobody accounted for; only the assertions below notice a
 * family accounted for WRONGLY, and only they name the SALVAGE as the loss.
 *
 * ## What is bound, and how
 *
 * Every assertion binds to the unset-option-effect family BY IDENTITY — its own
 * builder's output, its own published grammar source, its own registry entry
 * name — never by "some disclosure survived", a predicate the other three
 * families satisfy (trap 19).
 *
 * ## Both directions, in this one file
 *
 * This change WIDENS what reaches the user, so the counterpart is proven in the
 * same run: the objective-contradiction tail is still refused, is still not
 * smuggled alongside a salvaged family, and a poisoned unset-SHAPED slice is
 * still rejected by the salvage's re-check without costing the other families
 * theirs.
 */
import { describe, it, expect } from 'vitest';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import {
  isAllowedRunAnalysisAssistantText,
  TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS,
  TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS,
} from '../../coaching/analysis-result-headline.js';
import {
  buildUnsetOptionEffectDisclosure,
  UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC,
} from '../../coaching/unset-option-effect-disclosure.js';
import {
  buildIntakeOptionDisclosure,
  INTAKE_OPTION_DISCLOSURE_RE_SRC,
} from '../../coaching/intake-option-disclosure.js';
import { buildScaffoldDisclosureSuffix } from '../../coaching/scaffold-disclosure.js';
import { OBJECTIVE_CONTRADICTION_RE_SRC } from '../../coaching/objective-contradiction.js';
import type { IntakeOptionReconciliation } from '../../../orchestrator/context/intake-option-reconciliation.js';

const FALLBACK = 'Ran analysis on your current scenario.';
const REGISTERED_NAME = 'UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC';

const template = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
if (typeof template !== 'function') {
  throw new Error('expected function-form confirmation_template');
}
const fwd = template;

/** A summary the allowlist rejects: a raw decimal in improvised free text. */
const REJECTED_HEAD = 'Leading option sits at 0.6234 exactly.';

// ---------------------------------------------------------------------------
// Fixtures from each family's OWN producer. A fixture the test author wrote by
// hand is not evidence about what the handler composes (trap 16-inverse), so
// every one of these is built and then PINNED against its own published grammar
// before it is used to prove anything.
// ---------------------------------------------------------------------------

const UNSET_DISCLOSURE = buildUnsetOptionEffectDisclosure([
  {
    option_id: 'opt_hold',
    option_label: 'Keep what we have',
    factor_id: 'fac_adoption',
    factor_label: 'Sales Rep Adoption Rate',
  },
]);

const SCAFFOLD_DISCLOSURE = buildScaffoldDisclosureSuffix([
  { option_id: 'opt_new', label: 'New option', factor_ids: ['fac_a'], value_defaulted: true },
]);

function intakeReconciliation(texts: readonly string[]): IntakeOptionReconciliation {
  const options = texts.map((text) => ({ text, tokens: text.toLowerCase().split(/\s+/) }));
  return {
    state: 'options_missing',
    mayNameLeadingOption: false,
    enumerated: options,
    missing: options,
  } as IntakeOptionReconciliation;
}

const INTAKE_DISCLOSURE = buildIntakeOptionDisclosure(
  intakeReconciliation(['a new retail concession']),
);

/**
 * A REAL objective-contradiction tail, verbatim from the arm
 * `run-analysis-objective-contradiction-wiring.test.ts` pins. It NAMES AN OPTION
 * AS LEADING, which is exactly why it is excluded from the withheld branch.
 */
const OBJECTIVE_CONTRADICTION_TAIL =
  ' “Hold at £49 Per Seat (Status Quo)” came out ahead most often without moving' +
  ' “Seat Price Level” the way your goal asks. Among the options that do,' +
  ' “Raise to £59 Per Seat” came out ahead in 28% of runs.';

describe('preconditions — the fixtures are real, and the salvage path is the one under test', () => {
  it('the unset fixture is non-empty AND matches the unset grammar exactly', () => {
    expect(UNSET_DISCLOSURE).not.toBe('');
    expect(
      new RegExp(`^(?:${UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC})$`).test(UNSET_DISCLOSURE),
    ).toBe(true);
  });

  it('the unset fixture is the NAMED form, so it is a fixture with something to lose', () => {
    // Pins the fixture's own precondition: if `safeLabel` ever started rejecting
    // these labels the builder would degrade to the count-only sentence and the
    // assertions below would still pass, testing a weaker string than intended
    // (trap 13b — a discriminator whose power depends on an unpinned fixture).
    expect(UNSET_DISCLOSURE).toContain('Keep what we have');
    expect(UNSET_DISCLOSURE).toContain('Sales Rep Adoption Rate');
  });

  it('the sibling fixtures are real too (contrast — they are NOT the family under test)', () => {
    expect(SCAFFOLD_DISCLOSURE).not.toBe('');
    expect(INTAKE_DISCLOSURE).not.toBe('');
    expect(new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`).test(INTAKE_DISCLOSURE)).toBe(
      true,
    );
    expect(
      new RegExp(`^(?:${OBJECTIVE_CONTRADICTION_RE_SRC})$`).test(OBJECTIVE_CONTRADICTION_TAIL),
    ).toBe(true);
    // The unset fixture is not merely "disclosure-shaped": the other families'
    // grammars must NOT match it, or an assertion about it could be satisfied by
    // any of them.
    expect(new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`).test(UNSET_DISCLOSURE)).toBe(
      false,
    );
    expect(
      new RegExp(`^(?:${UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC})$`).test(INTAKE_DISCLOSURE),
    ).toBe(false);
  });

  it('every head used below is genuinely REJECTED, so the salvage runs at all', () => {
    expect(isAllowedRunAnalysisAssistantText(REJECTED_HEAD)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`${REJECTED_HEAD}${UNSET_DISCLOSURE}`)).toBe(false);
  });
});

describe('⭐ REGISTRATION — the unset family is in the GRAMMARS array, by identity', () => {
  /**
   * These three assertions are what a green-but-wrong conflict resolution has to
   * get past. The union assertion in the completeness spec does not: moving the
   * entry to the exclusion list keeps THAT spec green.
   */
  it('an entry exists whose name AND source are the module’s own export', () => {
    const entry = TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.find((g) => g.name === REGISTERED_NAME);
    expect(
      entry,
      `${REGISTERED_NAME} is not registered in TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS. #1179 put ` +
        `this family on the withheld egress branch; dropping it here un-registers it and the ` +
        `run_analysis salvage silently stops rescuing the sentence.`,
    ).toBeDefined();
    // Bound by IDENTITY, not by label: the source must BE the module's export,
    // so a plausible-looking name over the wrong grammar cannot pass.
    expect((entry as { source: string }).source).toBe(UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC);
  });

  it('it is NOT on the reasoned-exclusion list (the green wrong answer)', () => {
    expect(
      TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS.map((e) => e.name),
      `${REGISTERED_NAME} must not be EXCLUDED. Excluding it satisfies the completeness ` +
        `guard's union assertion while regressing #1179 — bookkeeping green, behaviour wrong.`,
    ).not.toContain(REGISTERED_NAME);
  });

  it('it composes AFTER the intake family, matching the handler’s append order', () => {
    const names = TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.map((g) => g.name);
    expect(names.indexOf(REGISTERED_NAME)).toBeGreaterThan(
      names.indexOf('INTAKE_OPTION_DISCLOSURE_RE_SRC'),
    );
  });
});

describe('⭐ EGRESS — the WITHHELD template branch still admits it (#1179’s property)', () => {
  /**
   * The reason this family is admitted on a branch that refuses the
   * objective-contradiction tail: it asserts only that a value the user did not
   * set was not set. That is true on a withheld turn, and a withheld turn is
   * exactly where a user who ran past unset option effects most needs to be told.
   */
  it('fallback + unset disclosure is ADMISSIBLE', () => {
    expect(isAllowedRunAnalysisAssistantText(`${FALLBACK}${UNSET_DISCLOSURE}`)).toBe(true);
  });

  it('fallback + intake + unset is admissible in the handler’s append order', () => {
    expect(
      isAllowedRunAnalysisAssistantText(`${FALLBACK}${INTAKE_DISCLOSURE}${UNSET_DISCLOSURE}`),
    ).toBe(true);
  });
});

describe('⭐ SALVAGE — a rejected summary carrying it keeps the sentence', () => {
  it('rejected summary carrying ONLY the unset disclosure → fallback KEEPS it', () => {
    const out = fwd({ assistant_text: `${REJECTED_HEAD}${UNSET_DISCLOSURE}` });
    expect(out).toBe(`${FALLBACK}${UNSET_DISCLOSURE}`);
    expect(out).not.toContain('0.6234');
  });

  it('all four families on one rejected summary → all four retained, in append order', () => {
    const composed =
      `${REJECTED_HEAD}${SCAFFOLD_DISCLOSURE}${INTAKE_DISCLOSURE}${UNSET_DISCLOSURE}`;
    const out = fwd({ assistant_text: composed });
    expect(out).toBe(`${FALLBACK}${SCAFFOLD_DISCLOSURE}${INTAKE_DISCLOSURE}${UNSET_DISCLOSURE}`);
    expect(out.indexOf(INTAKE_DISCLOSURE)).toBeLessThan(out.indexOf(UNSET_DISCLOSURE));
  });
});

describe('counterpart direction — the salvage still refuses what it must', () => {
  /**
   * A salvage that leaks unvetted assistant text is a worse defect than the one
   * being fixed, so the gate is proven in the same run as the widening.
   */
  it('the objective-contradiction tail is not smuggled alongside the unset family', () => {
    const out = fwd({
      assistant_text: `${REJECTED_HEAD}${UNSET_DISCLOSURE}${OBJECTIVE_CONTRADICTION_TAIL}`,
    });
    expect(out).toBe(`${FALLBACK}${UNSET_DISCLOSURE}`);
    expect(out).not.toContain('came out ahead');
    expect(out).not.toContain('Hold at £49 Per Seat');
  });

  it('a poisoned unset-SHAPED slice is rejected, and does not cost the intake one', () => {
    // ⚠ HAND-CRAFTED AND IT HAS TO BE. Feeding a poisoned label to the real
    // builder does NOT produce a poisoned disclosure — `survivesEgress` degrades
    // it to the count-only sentence (pinned as the first line of defence below).
    // This slice never came from the builder: it is the upstream-regression case
    // the salvage's own re-check exists to catch, and the label slot accepts
    // digits so a raw decimal rides the grammar right up to that re-check.
    const poisonedUnset = UNSET_DISCLOSURE.replace(
      'Sales Rep Adoption Rate',
      'Adoption at 0.6234',
    );
    // Precondition pins: really unset-SHAPED, really inadmissible.
    expect(poisonedUnset).not.toBe(UNSET_DISCLOSURE);
    expect(new RegExp(`^(?:${UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC})$`).test(poisonedUnset)).toBe(
      true,
    );
    expect(isAllowedRunAnalysisAssistantText(`${FALLBACK}${poisonedUnset}`)).toBe(false);

    const out = fwd({ assistant_text: `${REJECTED_HEAD}${INTAKE_DISCLOSURE}${poisonedUnset}` });
    expect(out).toBe(`${FALLBACK}${INTAKE_DISCLOSURE}`);
    expect(out).not.toContain('0.6234');
  });

  it('the real builder DEGRADES a poisoned label rather than emitting one (first line of defence)', () => {
    const degraded = buildUnsetOptionEffectDisclosure([
      {
        option_id: 'opt_hold',
        option_label: 'Keep what we have',
        factor_id: 'fac_adoption',
        factor_label: 'Adoption at 0.6234',
      },
    ]);
    expect(degraded).not.toBe('');
    expect(degraded).not.toContain('0.6234');
    expect(isAllowedRunAnalysisAssistantText(`${FALLBACK}${degraded}`)).toBe(true);
  });
});
