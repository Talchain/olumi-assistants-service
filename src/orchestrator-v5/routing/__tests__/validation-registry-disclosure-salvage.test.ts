/**
 * The run_analysis confirmation salvage, per DISCLOSURE FAMILY.
 *
 * `runAnalysisConfirmationTemplate` rescues disclosure sentences onto the locked
 * fallback when the composed summary is rejected by
 * `isAllowedRunAnalysisAssistantText`, so "a run may never render undisclosed"
 * survives an egress rejection. It used to extract a HAND-LISTED PAIR of
 * grammars (scaffold + constraint-gap) while the allowlist's own template branch
 * admitted THREE — FOUR by the time this landed, #1179 having added the
 * unset-option-effect family meanwhile — so the intake-option disclosure was
 * composed by the handler, rejected as part of the whole summary, and then
 * silently dropped. CLAUDE.md trap 12: a list a human must remember to sync WILL
 * drift, and the drift reads as green.
 *
 * The unset-option-effect family gets its own file,
 * `unset-option-effect-salvage-registration.test.ts`, because its registration
 * is what the rebase conflict put at risk and the completeness guard's union
 * assertion cannot see a family that is accounted for WRONGLY.
 *
 * These tests bind to each family BY IDENTITY (its own builder's output, and its
 * own published grammar), never by "some disclosure-shaped text survived" — a
 * predicate the other two families would satisfy (trap 19).
 */
import { describe, it, expect } from 'vitest';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { isAllowedRunAnalysisAssistantText } from '../../coaching/analysis-result-headline.js';
import { buildScaffoldDisclosureSuffix } from '../../coaching/scaffold-disclosure.js';
import {
  buildIntakeOptionDisclosure,
  INTAKE_OPTION_DISCLOSURE_RE_SRC,
} from '../../coaching/intake-option-disclosure.js';
import { OBJECTIVE_CONTRADICTION_RE_SRC } from '../../coaching/objective-contradiction.js';
import type { IntakeOptionReconciliation } from '../../../orchestrator/context/intake-option-reconciliation.js';

const FALLBACK = 'Ran analysis on your current scenario.';

const template = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
if (typeof template !== 'function') {
  throw new Error('expected function-form confirmation_template');
}
const fwd = template;

/** A summary the allowlist rejects: a raw decimal in improvised free text. */
const REJECTED_HEAD = 'Leading option sits at 0.6234 exactly.';

// ---------------------------------------------------------------------------
// Fixtures, each built by its family's OWN producer and then PINNED against
// that family's OWN published grammar. Pinning the precondition in-test is what
// stops a fixture that quietly stopped being a real disclosure from turning
// these assertions into tautologies (trap 13b).
// ---------------------------------------------------------------------------

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
 * A REAL objective-contradiction tail, taken verbatim from the arm the wiring
 * test pins (`run-analysis-objective-contradiction-wiring.test.ts`). It NAMES AN
 * OPTION AS LEADING, which is the whole reason it is excluded from the template
 * branch.
 */
const OBJECTIVE_CONTRADICTION_TAIL =
  ' “Hold at £49 Per Seat (Status Quo)” came out ahead most often without moving' +
  ' “Seat Price Level” the way your goal asks. Among the options that do,' +
  ' “Raise to £59 Per Seat” came out ahead in 28% of runs.';

describe('salvage fixtures are the real thing (precondition pins)', () => {
  it('the scaffold fixture is a non-empty scaffold disclosure', () => {
    expect(SCAFFOLD_DISCLOSURE).not.toBe('');
  });

  it('the intake fixture is non-empty AND matches the intake grammar exactly', () => {
    expect(INTAKE_DISCLOSURE).not.toBe('');
    expect(new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`).test(INTAKE_DISCLOSURE)).toBe(
      true,
    );
  });

  it('the objective-contradiction fixture matches ITS grammar exactly', () => {
    expect(
      new RegExp(`^(?:${OBJECTIVE_CONTRADICTION_RE_SRC})$`).test(OBJECTIVE_CONTRADICTION_TAIL),
    ).toBe(true);
  });

  it('every fixture head is genuinely REJECTED, so the salvage path is the one under test', () => {
    expect(isAllowedRunAnalysisAssistantText(REJECTED_HEAD)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`${REJECTED_HEAD}${INTAKE_DISCLOSURE}`)).toBe(false);
  });
});

describe('T2 — the salvage covers the INTAKE-OPTION family', () => {
  /**
   * The honesty argument that justifies salvaging the scaffold disclosure is "a
   * scaffolded run may never render undisclosed". It transfers here verbatim and
   * arguably harder: this sentence says THE SET BEING RANKED IS NOT THE SET THE
   * USER DESCRIBED. A ranking of the wrong option set, rendered with no mention
   * that options are missing, is a stronger misrepresentation than a ranking
   * over placeholder values.
   */
  it('rejected summary carrying an INTAKE disclosure → fallback KEEPS the intake sentence', () => {
    const out = fwd({ assistant_text: `${REJECTED_HEAD}${INTAKE_DISCLOSURE}` });
    expect(out).toBe(`${FALLBACK}${INTAKE_DISCLOSURE}`);
    expect(out).not.toContain('0.6234');
  });

  it('all three families on one rejected summary → all three retained, in append order', () => {
    const composed = `${REJECTED_HEAD}${SCAFFOLD_DISCLOSURE}${INTAKE_DISCLOSURE}`;
    const out = fwd({ assistant_text: composed });
    expect(out).toBe(`${FALLBACK}${SCAFFOLD_DISCLOSURE}${INTAKE_DISCLOSURE}`);
    expect(out.indexOf(SCAFFOLD_DISCLOSURE)).toBeLessThan(out.indexOf(INTAKE_DISCLOSURE));
  });

  it('a poisoned INTAKE-shaped slice is not smuggled, and does not cost the scaffold one', () => {
    // ⚠ HAND-CRAFTED, and it has to be. Feeding a poisoned LABEL to the real
    // builder does NOT produce a poisoned disclosure: `buildIntakeOptionDisclosure`
    // runs its own `survivesEgress` probe and DEGRADES to the count-only sentence
    // instead, which is honest and admissible. That is the builder working as
    // designed, and it is why this case must bypass it — the salvage's re-check
    // is the SECOND line of defence, against a slice that never came from the
    // builder at all (an upstream regression, or a mock).
    //
    // The slice below is grammar-valid and content-poisoned: the intake label
    // slot accepts digits, so a raw decimal rides the shape past the extraction
    // and is caught only by the combined re-check.
    const poisonedIntake = INTAKE_DISCLOSURE.replace(
      'a new retail concession',
      'a concession at 0.6234',
    );
    // Precondition pins: it really is intake-SHAPED, and really is inadmissible.
    expect(poisonedIntake).not.toBe(INTAKE_DISCLOSURE);
    expect(new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`).test(poisonedIntake)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(`${FALLBACK}${poisonedIntake}`)).toBe(false);

    const out = fwd({ assistant_text: `${REJECTED_HEAD}${SCAFFOLD_DISCLOSURE}${poisonedIntake}` });
    expect(out).toBe(`${FALLBACK}${SCAFFOLD_DISCLOSURE}`);
    expect(out).not.toContain('0.6234');
  });

  it('the real builder DEGRADES a poisoned label rather than emitting one (first line of defence)', () => {
    // Kept explicit so the bypass above is not mistaken for the builder being
    // unguarded: this is the producer's own survival probe doing its job.
    const degraded = buildIntakeOptionDisclosure(
      intakeReconciliation(['a concession at 0.6234']),
    );
    expect(degraded).not.toBe('');
    expect(degraded).not.toContain('0.6234');
    expect(isAllowedRunAnalysisAssistantText(`${FALLBACK}${degraded}`)).toBe(true);
  });
});

describe('T2 — the OBJECTIVE-CONTRADICTION family is deliberately NOT salvaged', () => {
  /**
   * ⚠ This is an EXCLUSION, not an omission. The tail names a leading option and
   * ships only when `headline !== null` (run-analysis.ts passes `headline !==
   * null` as the leader permission). The salvage's output is the locked
   * fallback — a WITHHELD shape — so appending this tail there would assert the
   * very leader the withhold denied: the G-CEE-1 defect class.
   */
  it('a rejected summary carrying ONLY the objective-contradiction tail → BARE fallback', () => {
    const out = fwd({ assistant_text: `${REJECTED_HEAD}${OBJECTIVE_CONTRADICTION_TAIL}` });
    expect(out).toBe(FALLBACK);
    expect(out).not.toContain('came out ahead');
    expect(out).not.toContain('Hold at £49 Per Seat');
  });

  it('it is not smuggled alongside a family that IS salvaged', () => {
    const out = fwd({
      assistant_text: `${REJECTED_HEAD}${INTAKE_DISCLOSURE}${OBJECTIVE_CONTRADICTION_TAIL}`,
    });
    expect(out).toBe(`${FALLBACK}${INTAKE_DISCLOSURE}`);
    expect(out).not.toContain('Hold at £49 Per Seat');
  });

});
