/**
 * T1 constraint-gap disclosure — EGRESS survival (the layer the user receives).
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT ANOTHER `outcome.assistant_text`
 * TEST. #703 composes the T1 disclosure into the run_analysis summary and its
 * acceptance tests assert on `outcome.assistant_text` — which is UPSTREAM of
 * the registry forwarder. Between the handler and the wire sits
 * `renderConfirmation` (turn-executor.ts), which calls
 * `HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template` and
 * returns its result VERBATIM. That forwarder runs the composed text through
 * `isAllowedRunAnalysisAssistantText` and substitutes a locked literal when the
 * text is not on the allowlist.
 *
 * So a test upstream of the forwarder cannot observe this class of defect AT
 * ALL — it is green-by-fixture. This file asserts on the bytes that LEAVE the
 * forwarder, which is the only layer that answers "did the user see it".
 *
 * The same failure mode is documented verbatim in analysis-result-headline.ts:
 * an honest override headline that "was silently replaced by the locked
 * template at the wire". This is that, again, for the T1 disclosure.
 */
import { describe, it, expect } from 'vitest';

import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { RUN_ANALYSIS_ASSISTANT_TEMPLATES } from '../../tools/handlers/run-analysis.js';
import { buildConstraintDisclosure } from '../constraint-gap-disclosure.js';
import {
  isAllowedRunAnalysisAssistantText,
  MAX_ASSISTANT_TEXT_CHARS,
} from '../analysis-result-headline.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import { buildScaffoldDisclosureSuffix } from '../scaffold-disclosure.js';
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

/**
 * The live staging case, composed exactly as `run-analysis.ts:918` does:
 * `${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}`.
 * On the T1 path the headline is WITHHELD (null) — that is the whole point —
 * so the leading segment is the locked template.
 */
const RATIFIED: readonly RatifiedConstraint[] = [
  { constraint_id: 'c_total_cost', label: 'Total three-year cost' },
];

/**
 * A verdict in the shape the handler passes to the builder. Only `state` and
 * `constraints` steer the copy; the rest is filled from the state's own
 * declaration so a fixture can never claim a leading option the state forbids.
 */
function verdictOf(
  state: ConstraintVerdictState,
  constraints: readonly RatifiedConstraint[],
): ConstraintVerdict {
  return {
    state,
    mayNameLeadingOption: MAY_NAME_LEADING_OPTION[state],
    codes: [],
    constraints,
    leaderInfeasibility: null,
  };
}

function composeSummary(
  constraints: readonly RatifiedConstraint[],
  state: ConstraintVerdictState = 'unevaluated',
): string {
  return `${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${''}${buildConstraintDisclosure(verdictOf(state, constraints))}`;
}

describe('T1 gap disclosure — POSITIVE CONTROLS (the probe can see survival)', () => {
  // Before asserting that the T1 disclosure is STRIPPED, prove this probe can
  // observe a disclosure that SURVIVES. Without these, the assertions below
  // would pass even if the forwarder stripped everything unconditionally.

  it('POSITIVE CONTROL: a bare locked template passes through unchanged', () => {
    expect(throughForwarder(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT)).toBe(
      RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT,
    );
  });

  it('POSITIVE CONTROL: template + SCAFFOLD disclosure survives the forwarder', () => {
    // The scaffold disclosure is the sibling disclosure that DID get its
    // grammar, its length budget and its build-time survival probe wired into
    // the egress. It is the worked example the T1 disclosure was meant to
    // follow, and it proves the forwarder passes disclosure-bearing text when
    // the plumbing exists.
    const scaffold = buildScaffoldDisclosureSuffix([
      // TYPED against `ScaffoldedOptionRecord` (scaffold-disclosure.ts): the
      // field is `label`, not `option_label`, and `value_defaulted: true` is
      // required. The first version of this fixture used `option_label` and
      // omitted `value_defaulted`; it compiled only because excess-property
      // checking reported it as an error the required-gate never runs (
      // tsconfig.build.json excludes tests), and at RUNTIME it silently fed the
      // builder a record with NO label — so this "labelled scaffold survives"
      // control was actually exercising the GENERIC form. Fixing the type
      // restores what the test claims to prove.
      {
        option_id: 'opt_a',
        label: 'Buy the MacBook Pro',
        factor_ids: ['fac_1'],
        value_defaulted: true,
      },
    ]);
    expect(scaffold.length).toBeGreaterThan(0);
    const composed = `${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${scaffold}`;
    const out = throughForwarder(composed);
    expect(out).toBe(composed);
    expect(out).toContain('Placeholder values were used for');
  });
});

describe('T1 gap disclosure — reaches the wire', () => {
  it('the disclosure the handler composed is what the forwarder emits', () => {
    const composed = composeSummary(RATIFIED);
    // Requirement (b) of #703: the message names the condition that was not
    // evaluated. Requirement (c): it offers a repair step. Both are composed
    // by the handler; this asserts they are still present AFTER the forwarder.
    expect(composed).toContain('Total three-year cost');

    const out = throughForwarder(composed);

    expect(out).not.toBe(FALLBACK);
    // (b) the condition is named
    expect(out).toContain('Total three-year cost');
    // (c) the repair step is present
    expect(out).toContain('Re-state that limit against a measure recorded in the same units');
    // and the withheld-recommendation statement survives
    expect(out).toContain('conditions you set');
  });

  it('the count-only form (label unusable) also reaches the wire', () => {
    // A constraint with no usable label degrades to the count phrasing. That
    // form carries requirement (c) and the "not checked" statement, so it must
    // survive too — otherwise an unlabelled constraint discloses nothing.
    const composed = composeSummary([{ constraint_id: 'c_x', label: null }]);
    const out = throughForwarder(composed);
    expect(out).not.toBe(FALLBACK);
    expect(out).toContain('was not checked');
    expect(out).toContain('Re-state that limit');
  });

  it('the composed summary is on the egress allowlist', () => {
    // The forwarder's verdict, stated directly against the predicate, so a
    // failure here localises the defect to the allowlist rather than the
    // forwarder's salvage branch.
    expect(isAllowedRunAnalysisAssistantText(composeSummary(RATIFIED))).toBe(true);
  });
});

describe('T1 gap disclosure — the three INDEPENDENT blockers, named separately', () => {
  // Each of these would alone be sufficient to strip the disclosure, so each
  // gets its own assertion: a fix that closes only one leaves the defect live,
  // and a single "is it allowed" assertion could not tell us which.

  it('BLOCKER 1 — content defences: the disclosure must not use banned vocabulary', () => {
    // `FORBIDDEN_HEADLINE_VOCABULARY_REGEX` bans
    // /recommend(s|ed|ation|ations)?/i. Any disclosure wording containing
    // "recommended" is rejected AFTER a structural match, so adding grammar
    // alone cannot fix this.
    const disclosure = buildConstraintDisclosure(verdictOf('unevaluated', RATIFIED));
    expect(passesAssistantTextContentDefences(disclosure)).toBe(true);
    // Pin the specific word, so a copy edit that reintroduces it fails HERE
    // (loudly) rather than silently reverting the user-facing message.
    expect(disclosure).not.toMatch(/recommend/i);
  });

  it('a long label degrades to the count-only form rather than losing the disclosure', () => {
    // `sanitiseLabel` has no length bound, so an over-long label would blow the
    // grammar slot. The builder must degrade, not go silent.
    const composed = composeSummary([
      { constraint_id: 'c_long', label: 'L'.repeat(400) },
    ]);
    const out = throughForwarder(composed);
    expect(out).not.toBe(FALLBACK);
    expect(out).toContain('was not checked');
    expect(out).toContain('Re-state that limit');
    expect(out).not.toContain('LLLL');
  });

  it('BLOCKER 2 — length budget: the composed summary must fit the egress cap', () => {
    // MAX_ASSISTANT_TEXT_CHARS budgets the headline + each tail + the SCAFFOLD
    // disclosure. If the T1 disclosure has no budget line, a long-but-honest
    // disclosure is rejected on length with no other signal.
    const composed = composeSummary([
      { constraint_id: 'c_1', label: 'Total three-year cost' },
      { constraint_id: 'c_2', label: 'Minimum battery life' },
      { constraint_id: 'c_3', label: 'Maximum delivery lead time' },
    ]);
    expect(composed.length).toBeLessThanOrEqual(MAX_ASSISTANT_TEXT_CHARS);
  });

  it('BLOCKER 3 — grammar: a template-shaped text may carry the gap suffix', () => {
    // The locked-template branch of the allowlist accepts a suffix only when it
    // matches the scaffold grammar. The T1 sentence is not scaffold-shaped, so
    // without its own published grammar the whole summary is rejected.
    const composed = composeSummary(RATIFIED);
    expect(composed.startsWith(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(composed)).toBe(true);
  });
});

describe('identity_unresolved — its OWN wording, and it reaches the wire too', () => {
  // The state has no boolean and must not borrow the other voice's sentence.
  // These assertions are about what the copy MUST NOT say as much as what it
  // must: a disclosure that survives the egress and still makes a false
  // statement is worse than one that is stripped.

  const UNRESOLVED = composeSummary(RATIFIED, 'identity_unresolved');

  it('survives the forwarder — the disclosure is not stripped', () => {
    const out = throughForwarder(UNRESOLVED);
    expect(out).not.toBe(FALLBACK);
    expect(out).toBe(UNRESOLVED);
  });

  it('does NOT claim the condition went unchecked', () => {
    // The #703 false statement. "Was not checked" is assertable only in the
    // `unevaluated` state, and this is not that state.
    expect(UNRESOLVED).not.toContain('was not checked');
    expect(UNRESOLVED).not.toContain('were not checked');
    expect(UNRESOLVED).not.toContain('could not evaluate');
  });

  it('does NOT certify constraint-safety — it still withholds the option', () => {
    // The #707 false statement, in copy form: a disclosure that reassured the
    // user here would pair with a named leader on the same screen.
    expect(UNRESOLVED).toContain('no option can be put forward yet');
  });

  it('says what actually happened: the results could not be matched', () => {
    expect(UNRESOLVED).toContain('could not be matched to the condition you set');
    expect(UNRESOLVED).toContain('Total three-year cost');
    expect(UNRESOLVED).toContain('cannot be confirmed whether it was checked');
  });

  it('offers the repair step that matches ITS diagnosis, not the units one', () => {
    // Telling the user to fix their units here would assert a cause this state
    // exists precisely because CEE cannot determine.
    expect(UNRESOLVED).toContain('Re-state the condition and run the analysis again');
    expect(UNRESOLVED).not.toContain('recorded in the same units');
  });

  it('passes the content defences and the allowlist in its own right', () => {
    expect(passesAssistantTextContentDefences(UNRESOLVED)).toBe(true);
    expect(UNRESOLVED).not.toMatch(/recommend/i);
    expect(isAllowedRunAnalysisAssistantText(UNRESOLVED)).toBe(true);
  });

  it('the plural form survives too', () => {
    const composed = composeSummary(
      [
        { constraint_id: 'c_1', label: 'Total three-year cost' },
        { constraint_id: 'c_2', label: 'Minimum battery life' },
      ],
      'identity_unresolved',
    );
    expect(throughForwarder(composed)).toBe(composed);
    expect(composed).toContain('the 2 conditions you set');
    expect(composed).toContain('Re-state the conditions and run the analysis again');
  });

  it('is budgeted: the worst case fits the egress cap', () => {
    const composed = composeSummary(
      [
        { constraint_id: 'c_1', label: 'Total three-year cost' },
        { constraint_id: 'c_2', label: 'Minimum battery life' },
        { constraint_id: 'c_3', label: 'Maximum delivery lead time' },
      ],
      'identity_unresolved',
    );
    expect(composed.length).toBeLessThanOrEqual(MAX_ASSISTANT_TEXT_CHARS);
    expect(throughForwarder(composed)).toBe(composed);
  });

  it('a long label degrades to the count-only form rather than losing the disclosure', () => {
    const composed = composeSummary(
      [{ constraint_id: 'c_long', label: 'L'.repeat(400) }],
      'identity_unresolved',
    );
    expect(throughForwarder(composed)).toBe(composed);
    expect(composed).not.toContain('LLLL');
    expect(composed).toContain('could not be matched to the condition you set.');
  });
});

describe('the silent states disclose NOTHING', () => {
  // The builder is the single owner of "is there anything to say", so a state
  // that must not speak has to be pinned here rather than at the call site.
  for (const state of ['not_applicable', 'evaluated_feasible', 'evaluated_infeasible'] as const) {
    it(`${state} appends no disclosure`, () => {
      expect(buildConstraintDisclosure(verdictOf(state, RATIFIED))).toBe('');
    });
  }

  it('evaluated_feasible leaves the summary byte-identical to the bare template', () => {
    // The false-positive direction at the EGRESS layer: a healthy run must not
    // pick up a disclosure, and must not be knocked to the fallback either.
    const composed = composeSummary(RATIFIED, 'evaluated_feasible');
    expect(composed).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
    expect(throughForwarder(composed)).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
  });
});

describe('the forwarder honesty floor — a REJECTED summary still discloses', () => {
  /**
   * `runAnalysisConfirmationTemplate` has a salvage branch: when the composed
   * summary is not on the allowlist it extracts the disclosure suffixes by
   * their published grammar and re-appends them to the locked fallback,
   * re-checking the combined string. A run whose ratified condition was never
   * evaluated must not render UNDISCLOSED just because something else in the
   * summary was rejected.
   *
   * Found by mutation: deleting the gap arm of that branch changed NOTHING in
   * either suite, because every other test composes a summary the allowlist
   * ACCEPTS, so the salvage never ran. An untested defence is not a defence.
   */
  const REJECTED_HEAD = 'MacBook Pro leads by 18 percentage points and is the best pick.';

  it('a rejected headline still ships the unevaluated disclosure, not the bare fallback', () => {
    const gap = buildConstraintDisclosure(verdictOf('unevaluated', RATIFIED));
    const out = throughForwarder(`${REJECTED_HEAD}${gap}`);
    expect(out).not.toBe(FALLBACK);
    expect(out).toBe(`${FALLBACK}${gap}`);
    // The rejected claim itself is gone — salvage rescues the disclosure, not
    // the prose the allowlist just refused.
    expect(out).not.toContain('MacBook Pro');
    expect(out).toContain('Total three-year cost');
  });

  it('a rejected headline still ships the identity_unresolved disclosure', () => {
    const gap = buildConstraintDisclosure(verdictOf('identity_unresolved', RATIFIED));
    const out = throughForwarder(`${REJECTED_HEAD}${gap}`);
    expect(out).toBe(`${FALLBACK}${gap}`);
    expect(out).toContain('could not be matched');
  });

  it('salvage cannot smuggle a POISONED disclosure through', () => {
    // The combined string is re-checked, so a disclosure-shaped slice carrying
    // banned content falls back bare rather than riding the salvage path.
    const poisoned =
      ' One of the conditions you set was not checked: “the best option”.' +
      ' The analysis engine could not evaluate it against this model, so no option can be put forward yet.' +
      ' Re-state that limit against a measure recorded in the same units as the limit, then run the analysis again.';
    expect(throughForwarder(`${REJECTED_HEAD}${poisoned}`)).toBe(FALLBACK);
  });
});
