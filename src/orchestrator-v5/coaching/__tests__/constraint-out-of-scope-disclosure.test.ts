/**
 * ROADMAP 2.349 — the OUT_OF_SCOPE disclosure voice, and its survival to the
 * bytes the user receives.
 *
 * WHAT IT REPLACES. On every walk run carrying a time phrase the user was told:
 *
 *   "One of the conditions you set could not be checked: “Delivery deadline”. The
 *    analysis engine could not evaluate it against this model, so no option
 *    can be put forward yet. Tell me the limit you meant against a measure recorded in
 *    the same units as the limit, then run the analysis again."
 *
 * — verbatim from `journey-witness-2026-08-04b-raw/p3b/wire-run1-4-res.txt`.
 * Three untruths in one paragraph: the condition was INFERRED by CEE, not set
 * by the user; it was not "not checked" by accident but deliberately removed
 * and disclosed as removed; and the repair step is structurally a no-op — no
 * restatement in any units can make a dimension the model does not carry
 * testable. Diagnosis: `diagnosis-gap5-leader-null.md` §3.
 *
 * WHY EGRESS IS THE ONLY LAYER THAT COUNTS. Between the builder and the wire
 * sits `renderConfirmation` → `runAnalysisConfirmationTemplate` →
 * `isAllowedRunAnalysisAssistantText`, which replaces anything not matching the
 * published grammar with a locked literal. #703 shipped a correct disclosure
 * that never reached a user for exactly this reason. A new voice therefore
 * needs all three pieces of plumbing — grammar, length budget, build-time
 * probe — and this file asserts on the output of the forwarder, not on the
 * builder's return value.
 */
import { describe, it, expect } from 'vitest';

import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { RUN_ANALYSIS_ASSISTANT_TEMPLATES } from '../../tools/handlers/run-analysis.js';
import {
  buildConstraintDisclosure,
  CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS,
  CONSTRAINT_GAP_LABEL_MAX_CHARS,
  DISCLOSURE_VOICES_FOR_BUDGET,
  MAX_NAMED_CONSTRAINTS_FOR_TEST,
} from '../constraint-gap-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import type {
  ConstraintVerdict,
  ConstraintVerdictState,
  RatifiedConstraint,
} from '../../../orchestrator/context/constraint-feasibility.js';
import { MAY_NAME_LEADING_OPTION } from '../../../orchestrator/context/constraint-feasibility.js';

/** The forwarder `renderConfirmation` actually invokes, called the same way. */
function throughForwarder(assistantText: string): string {
  const tmpl = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
  if (typeof tmpl !== 'function') throw new Error('expected a function template');
  return tmpl({ assistant_text: assistantText });
}

const FALLBACK = 'Ran analysis on your current scenario.';

/** The walk's own constraint, label verbatim from the captured draft wire. */
const DEADLINE: RatifiedConstraint = {
  constraint_id: 'constraint_goal_arr_max',
  label: 'Delivery deadline',
};
const BUDGET: RatifiedConstraint = {
  constraint_id: 'constraint_out_total_cost_max',
  label: 'Total three-year cost',
};

function verdictOf(
  state: ConstraintVerdictState,
  constraints: readonly RatifiedConstraint[],
  outOfScopeConstraints: readonly RatifiedConstraint[] = [],
): ConstraintVerdict {
  return {
    state,
    mayNameLeadingOption: MAY_NAME_LEADING_OPTION[state],
    codes: [],
    constraints,
    leaderInfeasibility: null,
    outOfScopeConstraints,
  };
}

/**
 * A leader-NAMING headline, in the exact shape the deterministic builder emits
 * (Case B with margin). The out-of-scope voice's whole purpose is to ride on a
 * turn where a leader IS named, so composing it onto the locked template alone
 * would never exercise the shape the user actually receives.
 */
const LEADER_HEADLINE =
  'Hire Two Sales Reps came out ahead in 27% of runs of this model because Sales capacity is the strongest driver.';

describe('2.349 — the out-of-scope voice says the true thing and none of the false ones', () => {
  const suffix = buildConstraintDisclosure(verdictOf('not_applicable', [], [DEADLINE]));

  it('names the condition and states the model scope', () => {
    expect(suffix).toContain('Delivery deadline');
    expect(suffix).toContain('This analysis does not test');
    expect(suffix).toContain('not part of the comparison');
    expect(suffix).toContain('stays recorded on your scenario');
  });

  it('does NOT say the engine failed to check it', () => {
    // Untruth #2. The removal was deliberate and disclosed; framing it as an
    // engine anomaly is the sentence gap 5 put on screen.
    expect(suffix).not.toContain('could not be checked');
    expect(suffix).not.toContain('could not evaluate');
  });

  it('does NOT offer the units repair step', () => {
    // Untruth #3, and the one that cost users real effort: following it can
    // never change the outcome for this class.
    expect(suffix).not.toContain('Tell me the limit you meant');
    expect(suffix).not.toContain('same units');
  });

  it('does NOT claim the leading option is withheld', () => {
    // The comparison DID run on every dimension the model carries. Repeating
    // "no option can be put forward yet" here would re-assert the defect's
    // central falsehood on a turn that legitimately names a leader.
    expect(suffix).not.toContain('no option can be put forward');
  });

  it('emits NOTHING when there is nothing out of scope', () => {
    expect(buildConstraintDisclosure(verdictOf('not_applicable', [], []))).toBe('');
    expect(buildConstraintDisclosure(verdictOf('evaluated_feasible', [], []))).toBe('');
  });
});

describe('2.349 — EGRESS: the voice reaches the bytes the user receives', () => {
  it('POSITIVE CONTROL: the probe can see a plain leader headline survive', () => {
    // Trap 13. Before asserting that the disclosure SURVIVES, prove the
    // forwarder passes this file's carrier text at all — otherwise a green
    // assertion below could mean "everything survives", and a red one could
    // mean "the carrier was the problem".
    expect(throughForwarder(LEADER_HEADLINE)).toBe(LEADER_HEADLINE);
  });

  it('NEGATIVE CONTROL: an off-grammar suffix is still replaced by the locked literal', () => {
    // The complement of the control above: the forwarder must still be
    // rejecting things. A grammar that admitted everything would make every
    // survival assertion in this file vacuous.
    expect(throughForwarder(`${LEADER_HEADLINE} And here is some improvised prose.`)).toBe(
      FALLBACK,
    );
  });

  it('leader headline + out-of-scope disclosure survives the forwarder INTACT', () => {
    const composed = `${LEADER_HEADLINE}${buildConstraintDisclosure(
      verdictOf('not_applicable', [], [DEADLINE]),
    )}`;
    expect(isAllowedRunAnalysisAssistantText(composed)).toBe(true);
    expect(throughForwarder(composed)).toBe(composed);
    expect(throughForwarder(composed)).toContain('Delivery deadline');
  });

  it('locked template + out-of-scope disclosure survives too (the salvage shape)', () => {
    const composed = `${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${buildConstraintDisclosure(
      verdictOf('not_applicable', [], [DEADLINE]),
    )}`;
    expect(throughForwarder(composed)).toBe(composed);
  });

  it('BOTH voices together survive, in the handler’s composition order', () => {
    // A turn can carry a removed constraint AND a genuinely unscored one. The
    // allowlist gives this module ONE slot, so the pair has to be admitted by
    // the slot itself; if it were not, the whole summary would silently revert
    // to the locked template and BOTH disclosures would be lost.
    const composed = `${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${buildConstraintDisclosure(
      verdictOf('unevaluated', [BUDGET], [DEADLINE]),
    )}`;
    // Composition order: the more serious state voice leads.
    expect(composed.indexOf('could not be checked')).toBeLessThan(
      composed.indexOf('This analysis does not test'),
    );
    expect(isAllowedRunAnalysisAssistantText(composed)).toBe(true);
    expect(throughForwarder(composed)).toBe(composed);
    expect(throughForwarder(composed)).toContain('Total three-year cost');
    expect(throughForwarder(composed)).toContain('Delivery deadline');
  });

  it('identity_unresolved + out-of-scope survives as well', () => {
    const composed = `${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${buildConstraintDisclosure(
      verdictOf('identity_unresolved', [BUDGET], [DEADLINE]),
    )}`;
    expect(throughForwarder(composed)).toBe(composed);
  });

  it('passes the shared content defences on every shape it can emit', () => {
    for (const n of [1, 2, 4]) {
      const many = Array.from({ length: n }, (_, i) => ({
        constraint_id: `c_${i}`,
        label: `Condition number ${i}`,
      }));
      const s = buildConstraintDisclosure(verdictOf('not_applicable', [], many));
      expect(passesAssistantTextContentDefences(s), `n=${n}`).toBe(true);
      expect(s.includes('\n'), `n=${n}`).toBe(false);
    }
  });

  it('degrades to the COUNT-ONLY form rather than losing the disclosure', () => {
    // A label that cannot survive the egress must cost specificity, never the
    // whole sentence. `sanitiseLabel` imposes no length bound, so an
    // over-long label is the reachable case.
    const long = { constraint_id: 'c_long', label: 'x'.repeat(CONSTRAINT_GAP_LABEL_MAX_CHARS + 40) };
    const s = buildConstraintDisclosure(verdictOf('not_applicable', [], [long]));
    expect(s).toContain('This analysis does not test');
    expect(s).not.toContain('xxxxx');
    expect(
      throughForwarder(`${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${s}`),
    ).toContain('This analysis does not test');
  });
});

describe('2.349 — the length budget covers the COMBINED shape', () => {
  it('the budget is at least the worst combined suffix the builder can emit', () => {
    // Deriving the budget as a plain max over the three voices would
    // under-count the pair by the whole length of the second sentence, and the
    // summary would revert to the locked template with no error anywhere —
    // the exact silent failure #703 shipped.
    const many = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({
        constraint_id: `${prefix}_${i}`,
        label: 'x'.repeat(CONSTRAINT_GAP_LABEL_MAX_CHARS),
      }));
    const worst = buildConstraintDisclosure(
      verdictOf('unevaluated', many(999, 'a'), many(999, 'b')),
    );
    expect(worst.length).toBeGreaterThan(0);
    expect(CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS).toBeGreaterThanOrEqual(worst.length);
  });

  it('the budget accounts for EVERY declared voice (trap 12d — the list itself)', () => {
    // Derivation proves the copies agree; it can never prove the LIST is
    // complete. This is the union check: a fourth voice added to the type and
    // to `ALL_VOICES` without a decision about how it composes fails here.
    expect([...DISCLOSURE_VOICES_FOR_BUDGET].sort()).toEqual(
      ['identity_unresolved', 'out_of_scope', 'unevaluated'].sort(),
    );
  });

  it('MAX_NAMED_CONSTRAINTS is what the worst case was computed from', () => {
    expect(MAX_NAMED_CONSTRAINTS_FOR_TEST).toBe(3);
  });
});
