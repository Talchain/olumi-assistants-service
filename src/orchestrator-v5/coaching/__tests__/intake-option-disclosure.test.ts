/**
 * ROADMAP 2.579 — the withheld-ranking disclosure.
 *
 * The three properties a run_analysis suffix has to have, each of which has
 * silently failed for a sibling disclosure before: it must SURVIVE the egress
 * allowlist (or the user gets the locked template with no error anywhere), it
 * must NOT trip the shared leader vocabulary (or it is replaced wholesale on
 * exactly the withheld turns it exists to serve), and it must NAME the gap and
 * the repair (or it is the generic hedge the ruling forbids).
 */

import { describe, expect, it } from 'vitest';
import {
  INTAKE_OPTION_DISCLOSURE_MAX_CHARS,
  INTAKE_OPTION_DISCLOSURE_RE_SRC,
  INTAKE_OPTION_LABEL_MAX_CHARS,
  buildIntakeOptionDisclosure,
} from '../intake-option-disclosure.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';
import {
  RUN_ANALYSIS_LOCKED_TEMPLATES,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';
import {
  deriveIntakeOptionReconciliation,
  type IntakeOptionReconciliation,
} from '../../../orchestrator/context/intake-option-reconciliation.js';

const BAKERY_BRIEF =
  'The options are a second production oven line, an automated packing cell, refrigerated ' +
  'delivery vans, a new retail concession, or an energy-efficiency retrofit.';
// Synthetic explicit lineage controls, not provenance recovered from the old capture.
const FOUR_OPTIONS = [
  { id: 'oven', source_quote: 'a second production oven line' },
  { id: 'packing', source_quote: 'an automated packing cell' },
  { id: 'vans', source_quote: 'refrigerated delivery vans' },
  { id: 'retrofit', source_quote: 'an energy-efficiency retrofit' },
];
const missingOne = (): IntakeOptionReconciliation =>
  deriveIntakeOptionReconciliation(BAKERY_BRIEF, FOUR_OPTIONS);
const missingTwo = (): IntakeOptionReconciliation =>
  deriveIntakeOptionReconciliation(BAKERY_BRIEF, FOUR_OPTIONS.slice(0, 3));

describe('2.579 disclosure — names the gap and both repairs', () => {
  it('QUOTES the missing option from the real capture, not a count', () => {
    const text = buildIntakeOptionDisclosure(missingOne());
    // Identity-bound (trap 19): the assertion is about THE CONCESSION. A
    // `toContain('option')` here would pass on a disclosure naming the oven
    // line, which is a different and false claim.
    expect(text).toContain('“a new retail concession”');
    expect(text).not.toContain('“a second production oven line”');
  });

  it('offers BOTH repairs — add it, or confirm the omission was deliberate', () => {
    const text = buildIntakeOptionDisclosure(missingOne());
    expect(text).toContain('Check whether it should be included');
    expect(text).toContain('confirm you meant to leave it out');
  });

  it('scopes the consequence to the RANKING, never to the analysis', () => {
    const text = buildIntakeOptionDisclosure(missingOne());
    expect(text).toContain('no option can be put forward from this result');
    // The ruling is "block the ranking, not the analysis". Copy that voided the
    // computed numbers would be false about numbers that are correct.
    expect(text).not.toMatch(/invalid|cannot be trusted|discard|unreliable/i);
  });

  it('pluralises against the number of MISSING options', () => {
    const text = buildIntakeOptionDisclosure(missingTwo());
    expect(text).toContain('options that are not included in this comparison');
    expect(text).toContain('Check whether they should be included');
    expect(text).toContain('“a new retail concession”');
    expect(text).toContain('“an energy-efficiency retrofit”');
  });

  it('is silent for no enumeration and reconciled source bindings', () => {
    expect(
      buildIntakeOptionDisclosure(deriveIntakeOptionReconciliation('no cue here', FOUR_OPTIONS)),
    ).toBe('');
    expect(
      buildIntakeOptionDisclosure(
        deriveIntakeOptionReconciliation(BAKERY_BRIEF, [...FOUR_OPTIONS, { id: 'concession', source_quote: 'a new retail concession' }]),
      ),
    ).toBe('');
  });

  it('is SILENT rather than hedging when it has no name to give', () => {
    // A hand-built impossible input: the producer guarantees `missing` is
    // non-empty on this state. If that guarantee ever breaks, the honest
    // outcome is silence — "an option is missing, I cannot say which" is the
    // generic hedge 2.579's ruling forbids by name.
    const hollow = {
      state: 'options_missing',
      mayNameLeadingOption: false,
      enumerated: [],
      missing: [],
    } as const satisfies IntakeOptionReconciliation;
    expect(buildIntakeOptionDisclosure(hollow)).toBe('');
  });
});

describe('2.579 disclosure — the three pieces of plumbing', () => {
  it('matches its OWN published grammar exactly, on every shape it emits', () => {
    const exact = new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`);
    for (const reconciliation of [missingOne(), missingTwo()]) {
      const text = buildIntakeOptionDisclosure(reconciliation);
      expect(text.length).toBeGreaterThan(0);
      expect(exact.test(text)).toBe(true);
    }
  });

  it('fits inside its own DERIVED budget', () => {
    for (const reconciliation of [missingOne(), missingTwo()]) {
      expect(buildIntakeOptionDisclosure(reconciliation).length).toBeLessThanOrEqual(
        INTAKE_OPTION_DISCLOSURE_MAX_CHARS,
      );
    }
  });

  it('degrades an over-long label to the count-only form rather than losing the disclosure', () => {
    const longText = 'x'.repeat(INTAKE_OPTION_LABEL_MAX_CHARS + 40);
    const reconciliation = {
      state: 'options_missing',
      mayNameLeadingOption: false,
      enumerated: [],
      missing: [{ text: longText, tokens: ['x'] }],
    } as const satisfies IntakeOptionReconciliation;
    const text = buildIntakeOptionDisclosure(reconciliation);
    expect(text).not.toContain(longText);
    expect(text).toContain('not included in this comparison.');
    expect(new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`).test(text)).toBe(true);
  });

  it('does NOT trip the shared leader vocabulary', () => {
    // The failure this prevents is invisible: copy reaching for the natural
    // word ("…the option that leads cannot be named") is replaced wholesale by
    // `projectExplanationAnswerForWithheldClaim` on every withheld turn, and
    // the only symptom is a telemetry rate nobody looks at.
    for (const reconciliation of [missingOne(), missingTwo()]) {
      expect(textNamesLeadingOption(buildIntakeOptionDisclosure(reconciliation))).toBe(false);
    }
  });
});

describe('2.579 disclosure — SURVIVES the registry egress it is appended to', () => {
  // THE INTEGRATION PROPERTY, and the one a unit test of the builder alone
  // cannot see: the disclosure is appended to a run_analysis summary and then
  // re-checked by `isAllowedRunAnalysisAssistantText`. The sibling constraint
  // disclosure shipped WITHOUT this and was rejected at the wire — the
  // withheld-claim half of the fix survived while the "which condition, and how
  // to repair it" half never reached a user.
  // DERIVED from the registry's own set, never re-typed (trap 12): a template
  // string that drifted from the allowlist would make every assertion below
  // pass or fail for a reason that has nothing to do with this disclosure.
  const LOCKED_TEMPLATE = [...RUN_ANALYSIS_LOCKED_TEMPLATES][0] as string;

  it('is admitted on the locked template the withhold falls back to', () => {
    const suffix = buildIntakeOptionDisclosure(missingOne());
    expect(isAllowedRunAnalysisAssistantText(`${LOCKED_TEMPLATE}${suffix}`)).toBe(true);
  });

  it('is admitted in the plural form too', () => {
    const suffix = buildIntakeOptionDisclosure(missingTwo());
    expect(isAllowedRunAnalysisAssistantText(`${LOCKED_TEMPLATE}${suffix}`)).toBe(true);
  });

  it('POSITIVE CONTROL — the allowlist is not simply passing everything', () => {
    // Trap 13: an absence assertion must first prove it can see a presence.
    // Without this, "the disclosure is admitted" would pass against an
    // allowlist that had been accidentally disabled.
    expect(
      isAllowedRunAnalysisAssistantText(
        `${LOCKED_TEMPLATE} An option your brief listed is missing, probably.`,
      ),
    ).toBe(false);
  });
});

describe('unverified identity disclosure at the actual egress grammar', () => {
  it('survives the allowlist without a false omission or instruction to add a duplicate', () => {
    const intake = deriveIntakeOptionReconciliation(BAKERY_BRIEF, [{ id: 'oven', label: 'Oven line' }]);
    expect(intake.state).toBe('identity_unverified');
    const suffix = buildIntakeOptionDisclosure(intake);
    expect(suffix).toContain('does not establish which options correspond');
    expect(suffix).not.toMatch(/missing|not in the model|add it|add them|complete/i);
    expect(textNamesLeadingOption(suffix)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`${[...RUN_ANALYSIS_LOCKED_TEMPLATES][0]}${suffix}`)).toBe(true);
  });
});

it('does not tell the user to recreate a canonical option excluded from this comparison', () => {
  const canonical = { options: [...FOUR_OPTIONS, { id: 'concession', source_quote: 'a new retail concession' }] };
  const analysed = FOUR_OPTIONS.map(({ id }) => ({ id }));
  const intake = deriveIntakeOptionReconciliation(BAKERY_BRIEF, analysed, canonical);
  expect(intake.state).toBe('options_missing');
  expect(intake.missing.map((option) => option.text)).toEqual(['a new retail concession']);
  const summary = `${[...RUN_ANALYSIS_LOCKED_TEMPLATES][0]}${buildIntakeOptionDisclosure(intake)}`;
  expect(summary).toContain('not included in this comparison: “a new retail concession”');
  expect(summary).toContain('Check whether it should be included');
  expect(summary).not.toMatch(/not in the model|Add it|Add them/);
  expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
});
