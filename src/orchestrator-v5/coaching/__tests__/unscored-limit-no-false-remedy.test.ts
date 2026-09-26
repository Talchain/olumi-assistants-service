/**
 * ⛔ A LIMIT NOTHING SCORED IS NOT PROMISED A REPAIR NOBODY CAN PROVE (R&C, 25 Sep 2026).
 *
 * THE DEFECT (AI Quality, #69 5831581140; source trace at `48092035`). On the
 * agent lane a stated cap attaches, then ISL refuses it at Run
 * (`CONSTRAINT_FRAME_UNSPECIFIED`: the row carries no value frame). PLoT passes
 * that warning on without its `detail.constraint_id`, and the code is not in
 * CEE's not-decision-grade set, so the verdict arrives by precedence RULE 3,
 * "nothing scored", with `codes: []` (R&C trace 5831686178). The summary then
 * said, verbatim:
 *
 *   "One limit on your model could not be checked: “…”. We could not line it
 *    up with anything this analysis measures, so it was not part of the
 *    comparison. Tell me the limit you meant in your own words and I will
 *    record it; this one stays on the model. Then run the analysis again."
 *
 * Two false things. The restated limit goes back through the same admission,
 * which stamps no frame, so ISL refuses it again: the loop never closes. And
 * "could not line it up" names a cause the inputs cannot establish.
 *
 * THE AGREED RULE (independent review 5831708206, adopted by AI Quality
 * 5831722994). Fail closed. A verdict with NO actionable code says only that
 * the limit could not be checked in this model yet, for EVERY such row, and
 * makes no restate-and-rerun promise. A specific remedy is kept only for a
 * code whose producer PROVES that restating can change the next Run.
 *
 * PER-CODE DECISION (see `constraint-gap-disclosure.ts`, the docblock on
 * `UNEVALUATED_REPAIR_STEP`): neither code the verdict can carry proves it.
 * Both drop the promise, and T2 pins that. No row keeps the remedy.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It does not reach `compose/withheld-reason-
 * tail.ts:352` (the UNLABELLED reply-side copy, which still carries the
 * promise and is outside this lease), and it witnesses nothing on the wire.
 * Status rung: TESTED.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  buildConstraintDisclosure,
  buildConstraintDisclosureFromState,
  CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS,
  CONSTRAINT_GAP_DISCLOSURE_RE_SRC,
} from '../constraint-gap-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';
import {
  createRunAnalysisHandler,
  RUN_ANALYSIS_ASSISTANT_TEMPLATES,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient, PLoTClientRunOpts } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  deriveConstraintVerdict,
  MAY_NAME_LEADING_OPTION,
  type ConstraintVerdict,
  type ConstraintVerdictState,
  type RatifiedConstraint,
} from '../../../orchestrator/context/constraint-feasibility.js';

/* ─────────────────────────────── fixtures ─────────────────────────────── */

/** The agent-lane cap as AI Quality's trace records it (label as admitted today). */
const CAP: RatifiedConstraint = {
  constraint_id: 'gc-agent-cap',
  label: 'Total first-year cost < 250000GBP',
  node_id: 'fac_first_year_cost',
};
const MARGIN: RatifiedConstraint = {
  constraint_id: 'gc-margin',
  label: 'Keep gross margin at or above 78%',
  node_id: 'fac_margin',
};
const UNLABELLED: RatifiedConstraint = { constraint_id: 'gc-x', label: null };

/**
 * The ISL frame refusal as PLoT forwards it (`run.ts:3967-4017` at `b09c0f2e`,
 * per 5831686178): the code survives, `detail.constraint_id` does not, and only
 * a positional `field` remains. Nothing in it is read by the verdict.
 */
const FRAME_REFUSAL = {
  code: 'CONSTRAINT_FRAME_UNSPECIFIED',
  severity: 'warning',
  message: 'Constraint has no value frame; refusing to compare it.',
  field: 'goal_constraints[0]',
};

function verdictFor(
  envelope: Record<string, unknown>,
  ratified: readonly RatifiedConstraint[],
): ConstraintVerdict {
  return deriveConstraintVerdict(envelope, ratified, 'opt_a');
}

function handBuilt(
  state: ConstraintVerdictState,
  constraints: readonly RatifiedConstraint[],
  extra: Partial<ConstraintVerdict> = {},
): ConstraintVerdict {
  return {
    state,
    mayNameLeadingOption: MAY_NAME_LEADING_OPTION[state],
    codes: [],
    constraints,
    leaderInfeasibility: null,
    outOfScopeConstraints: [],
    ...extra,
  };
}

/** Every form of the promise, and of the asserted cause, this voice has ever used. */
const PROMISE = [
  'Tell me the limit you meant',
  'I will record it',
  'run the analysis again',
  'Re-state',
];
const ASSERTED_CAUSE = ['could not line', 'anything this analysis measures'];

function expectNoPromiseAndNoAssertedCause(text: string): void {
  for (const p of PROMISE) expect(text, `promise "${p}" is back`).not.toMatch(new RegExp(p, 'i'));
  for (const c of ASSERTED_CAUSE) expect(text, `asserted cause "${c}" is back`).not.toContain(c);
}

/* The exact bytes this change ships, for the three shapes of the no-remedy arm. */
const EXPECT_ONE_CAP =
  ' One limit on your model could not be checked: “Total first-year cost < 250000GBP”.' +
  ' This model could not check it yet, so it was not part of the comparison.' +
  ' It stays on the model.';
const EXPECT_TWO =
  ' 2 limits on your model could not be checked, including “Total first-year cost < 250000GBP” and “Keep gross margin at or above 78%”.' +
  ' This model could not check them yet, so they were not part of the comparison.' +
  ' They stay on the model.';
const EXPECT_ONE_UNLABELLED =
  ' One limit on your model could not be checked.' +
  ' This model could not check it yet, so it was not part of the comparison.' +
  ' It stays on the model.';

/* ───────────────────────────────── T1 ─────────────────────────────────── */

describe('T1 — the unframed agent-lane cap (rule 3, codes []) is promised nothing', () => {
  const verdict = verdictFor({ inference_warnings: [FRAME_REFUSAL] }, [CAP]);

  it('PRECONDITION: the served shape really is rule 3 with no actionable code', () => {
    // Pinned in-test, so a verdict change cannot turn every assertion below
    // vacuous (a disclosure that stopped speaking would pass "no promise").
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.codes).toEqual([]);
    expect(verdict.constraints.map((c) => c.constraint_id)).toEqual([CAP.constraint_id]);
  });

  it('keeps "could not be checked" and the label, and says nothing more than it can prove', () => {
    const text = buildConstraintDisclosure(verdict, 'Keep first-year cost under £250,000.');
    expect(text).toContain('One limit on your model could not be checked');
    expect(text).toContain('“Total first-year cost < 250000GBP”');
    expectNoPromiseAndNoAssertedCause(text);
    // Bound by identity: the whole message, byte for byte.
    expect(text).toBe(EXPECT_ONE_CAP);
  });

  it('the plural and the count-only forms make the same (lack of) promise', () => {
    const two = buildConstraintDisclosure(verdictFor({ inference_warnings: [FRAME_REFUSAL] }, [CAP, MARGIN]));
    const unlabelled = buildConstraintDisclosure(
      verdictFor({ inference_warnings: [FRAME_REFUSAL] }, [UNLABELLED]),
    );
    expect(two).toBe(EXPECT_TWO);
    expect(unlabelled).toBe(EXPECT_ONE_UNLABELLED);
    expectNoPromiseAndNoAssertedCause(two);
    expectNoPromiseAndNoAssertedCause(unlabelled);
  });

  it('"nothing scored" with NO warning at all is the same unknown-cause row', () => {
    const bare = verdictFor({}, [CAP]);
    expect(bare.state).toBe('unevaluated');
    expect(bare.codes).toEqual([]);
    expect(buildConstraintDisclosure(bare)).toBe(EXPECT_ONE_CAP);
  });

  it('rule 1 by `constraints_status: unavailable` ALONE also has no actionable code', () => {
    // The "more generally, NO actionable code" half of the rule: the status
    // condemns the block without saying why, so it is an unknown cause too.
    const statusOnly = verdictFor({ constraints_status: 'unavailable' }, [CAP]);
    expect(statusOnly.state).toBe('unevaluated');
    expect(statusOnly.codes).toEqual([]);
    expect(buildConstraintDisclosure(statusOnly)).toBe(EXPECT_ONE_CAP);
  });

  it('the read-back entry point (the labelled reply-side tail) says the same thing', () => {
    // `compose/withheld-reason-tail.ts` ships this builder's output VERBATIM
    // when it can name the row, so the reply side cannot keep the old promise.
    expect(buildConstraintDisclosureFromState('unevaluated', [CAP])).toBe(EXPECT_ONE_CAP);
  });
});

/* ───────────────────────────────── T2 ─────────────────────────────────── */

describe('T2 — the coded rows: decided per code, from source, and neither keeps the promise', () => {
  // Each code arrives on the channel PLoT uses for it: OUT_OF_DOMAIN is a
  // preflight warning, which PLoT returns as a `critique` (plot-lite-service
  // `src/routes/v2/run.ts:7096-7104` → `:7717`); TARGET_UNRELIABLE is an
  // `inference_warning` and withholds the whole block (`:3829-3840`,
  // `constraints_status: 'unavailable'`).
  const CODED: Array<[string, Record<string, unknown>]> = [
    ['CONSTRAINT_OUT_OF_DOMAIN', { critiques: [{ code: 'CONSTRAINT_OUT_OF_DOMAIN' }] }],
    [
      'CONSTRAINT_TARGET_UNRELIABLE',
      {
        constraints_status: 'unavailable',
        inference_warnings: [{ code: 'CONSTRAINT_TARGET_UNRELIABLE', severity: 'warning' }],
      },
    ],
  ];

  it.each(CODED)('%s: the verdict carries the code (precondition) and the copy promises nothing', (code, envelope) => {
    const verdict = verdictFor(envelope, [CAP]);
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.codes).toEqual([code]);
    const text = buildConstraintDisclosure(verdict);
    expectNoPromiseAndNoAssertedCause(text);
    expect(text).toBe(EXPECT_ONE_CAP);
  });

  it('both codes on one run: still no promise, and a sibling row the code may not be about is not blamed', () => {
    // The codes carry no constraint identity (`collectNotDecisionGradeCodes`
    // reads `.code` only) and rule 1 condemns EVERY row, so the disclosure names
    // rows the code may not be about. That is exactly why no cause is asserted.
    const verdict = verdictFor(
      {
        constraints_status: 'unavailable',
        critiques: [{ code: 'CONSTRAINT_OUT_OF_DOMAIN' }],
        inference_warnings: [{ code: 'CONSTRAINT_TARGET_UNRELIABLE' }],
      },
      [CAP, MARGIN],
    );
    expect(verdict.codes).toEqual(['CONSTRAINT_OUT_OF_DOMAIN', 'CONSTRAINT_TARGET_UNRELIABLE']);
    expect(buildConstraintDisclosure(verdict)).toBe(EXPECT_TWO);
  });
});

/* ───────────────────────────────── T3 ─────────────────────────────────── */

describe('T3 — the PROVED-unanchored arm is byte-identical to base', () => {
  // Literals captured at base `c74a4327` from this same builder. Not re-typed
  // from the source, so a drift in either the arm or its consequence REDs here.
  const BASE_UNANCHORED_ONE =
    ' One limit on your model could not be checked: “Total first-year cost < 250000GBP”.' +
    ' We could not line it up with anything this analysis measures, so it was not part of the comparison.' +
    ' The part of your model it points at is worked out from other parts, and Olumi cannot yet test a limit on a quantity like that, so it cannot be checked in this model yet; this one stays on the model unchecked.';
  const BASE_UNANCHORED_TWO =
    ' 2 limits on your model could not be checked, including “Total first-year cost < 250000GBP” and “Keep gross margin at or above 78%”.' +
    ' We could not line them up with anything this analysis measures, so they were not part of the comparison.' +
    ' The parts of your model they point at are worked out from other parts, and Olumi cannot yet test a limit on quantities like those, so they cannot be checked in this model yet; these stay on the model unchecked.';

  it('singular', () => {
    const v = verdictFor({ inference_warnings: [FRAME_REFUSAL] }, [CAP]);
    expect(buildConstraintDisclosure(v, null, new Set([CAP.constraint_id]))).toBe(BASE_UNANCHORED_ONE);
  });

  it('plural, every row proved', () => {
    const v = verdictFor({}, [CAP, MARGIN]);
    expect(
      buildConstraintDisclosure(v, null, new Set([CAP.constraint_id, MARGIN.constraint_id])),
    ).toBe(BASE_UNANCHORED_TWO);
  });

  it('a MIXED set is not proved, so it takes the no-remedy arm (never the unanchored claim)', () => {
    const v = verdictFor({}, [CAP, MARGIN]);
    expect(buildConstraintDisclosure(v, null, new Set([CAP.constraint_id]))).toBe(EXPECT_TWO);
  });
});

/* ───────────────────────────────── T4 ─────────────────────────────────── */

describe('T4 — every other voice and state is byte-identical to base', () => {
  const BASE_IDENTITY_ONE =
    ' The analysis engine returned condition results that could not be matched to the condition on your model: “Total first-year cost < 250000GBP”.' +
    ' So it cannot be confirmed whether it was checked, and it cannot be counted as part of the comparison.' +
    ' State the condition in your own words and run the analysis again.';
  const BASE_OUT_OF_SCOPE_ONE =
    ' This analysis does not test one of the conditions on your model: “Total first-year cost < 250000GBP”.' +
    ' It was not part of the comparison. It stays recorded on your scenario.';
  const BASE_UNMEASURED_ONE =
    ' Your model records no value to test one of the limits on your model: “Total first-year cost < 250000GBP”.' +
    ' It was not part of the comparison.' +
    ' Tell me which part of your model it applies to and I will record it there; this one stays on the model.' +
    ' Then run the analysis again.';

  it.each(['not_applicable', 'evaluated_feasible', 'evaluated_infeasible'] as const)(
    '%s (a met or evaluated constraint) discloses nothing',
    (state) => {
      expect(buildConstraintDisclosure(handBuilt(state, []))).toBe('');
      expect(buildConstraintDisclosureFromState(state, [CAP])).toBe('');
    },
  );

  it('an evaluated, met constraint on a real envelope discloses nothing', () => {
    // b09c0f2 wire shape: a certified row AND the leader's own per-option score.
    const v = verdictFor(
      {
        constraints_status: 'computed',
        constraint_results: [
          {
            constraint_id: CAP.constraint_id,
            node_id: 'fac_cost',
            operator: '<=',
            value: 250000,
            probability: 0.91,
            scale_provenance: { source: 'explicit_cap', range_unified: true, decision_grade: true },
          },
        ],
        option_comparison: [
          { option_id: 'opt_a', win_probability: 0.6, constraint_probabilities: { [CAP.constraint_id]: 0.91 }, probability_of_joint_goal: 0.9 },
        ],
      },
      [CAP],
    );
    expect(['evaluated_feasible', 'not_applicable']).toContain(v.state);
    expect(buildConstraintDisclosure(v)).toBe('');
  });

  it('identity_unresolved keeps its own repair step', () => {
    expect(buildConstraintDisclosure(handBuilt('identity_unresolved', [CAP]))).toBe(BASE_IDENTITY_ONE);
  });

  it('out_of_scope and unmeasured_target are untouched', () => {
    expect(
      buildConstraintDisclosure(handBuilt('not_applicable', [], { outOfScopeConstraints: [CAP] })),
    ).toBe(BASE_OUT_OF_SCOPE_ONE);
    expect(
      buildConstraintDisclosure(handBuilt('not_applicable', [], { unmeasuredTargetConstraints: [CAP] })),
    ).toBe(BASE_UNMEASURED_ONE);
  });
});

/* ───────────────────────────────── T5 ─────────────────────────────────── */

function throughForwarder(assistantText: string): string {
  const tmpl = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
  if (typeof tmpl !== 'function') throw new Error('expected a function template');
  return tmpl({ assistant_text: assistantText });
}

function expectPassesEveryGate(summary: string): void {
  expect(isAllowedRunAnalysisAssistantText(summary), 'egress allowlist').toBe(true);
  expect(throughForwarder(summary), 'the forwarder must ship it unchanged').toBe(summary);
  expect(passesAssistantTextContentDefences(summary), 'content defences').toBe(true);
  expect(findForbiddenPhraseHit(summary), 'forbidden user-facing phrase').toBeNull();
  expect(findSuccessClaimHit(summary), 'false success claim').toBeNull();
  expect(textNamesLeadingOption(summary), 'names a leading option').toBe(false);
  expect(summary, 'no em dash in product copy').not.toContain('—');
  expect(summary).not.toContain('\n');
}

const GRAMMAR = (): RegExp => new RegExp(`^(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})$`);

describe('T5 — the composed summary passes the egress and every copy gate', () => {
  it.each([
    ['singular', EXPECT_ONE_CAP],
    ['plural', EXPECT_TWO],
    ['count-only', EXPECT_ONE_UNLABELLED],
  ])('%s: template + disclosure passes', (_name, disclosure) => {
    expectPassesEveryGate(`${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${disclosure}`);
  });

  it('the no-remedy arm rides beside the out-of-scope voice in the one slot', () => {
    const d = buildConstraintDisclosure(
      handBuilt('unevaluated', [CAP], { outOfScopeConstraints: [MARGIN] }),
    );
    expect(d.startsWith(EXPECT_ONE_CAP)).toBe(true);
    expect(d).toContain('This analysis does not test');
    expectPassesEveryGate(`${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${d}`);
  });

  it('the OLD shapes are still admitted (nothing already composed is knocked to the fallback)', () => {
    // Captured at base `c74a4327`: the restate arm, singular, plural and count-only.
    const OLD = [
      ' One limit on your model could not be checked: “Total first-year cost < 250000GBP”. We could not line it up with anything this analysis measures, so it was not part of the comparison. Tell me the limit you meant in your own words and I will record it; this one stays on the model. Then run the analysis again.',
      ' 2 limits on your model could not be checked, including “Total first-year cost < 250000GBP” and “Keep gross margin at or above 78%”. We could not line them up with anything this analysis measures, so they were not part of the comparison. Tell me the limit you meant in your own words and I will record it; this one stays on the model. Then run the analysis again.',
      ' One limit on your model could not be checked. We could not line it up with anything this analysis measures, so it was not part of the comparison. Tell me the limit you meant in your own words and I will record it; this one stays on the model. Then run the analysis again.',
    ];
    for (const old of OLD) {
      expect(GRAMMAR().test(old)).toBe(true);
      expect(isAllowedRunAnalysisAssistantText(`${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${old}`)).toBe(true);
    }
  });

  it('the grammar does NOT admit the neutral cause glued to the old promise', () => {
    // The two arms are paired in the grammar, so a hybrid that says "we do not
    // know why" and then promises a fix cannot reach the user by any path.
    const hybrid =
      ' One limit on your model could not be checked: “Total first-year cost < 250000GBP”.' +
      ' This model could not check it yet, so it was not part of the comparison.' +
      ' Tell me the limit you meant in your own words and I will record it; this one stays on the model. Then run the analysis again.';
    expect(GRAMMAR().test(hybrid)).toBe(false);
  });

  it('the egress budget did not shrink (the longest arm is unchanged)', () => {
    // 1498 is the value at base `c74a4327`. The new arm is SHORTER than both
    // arms it sits beside, so the derived worst case must not move.
    expect(CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS).toBe(1498);
  });
});

/* ── T5, through the REAL handler: run-analysis.ts composes the summary ── */

const happyFixture = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'req-unscored-limit-no-false-remedy';
const GOAL_ID = 'goal_profit';
const TARGET_ID = 'fac_first_year_cost';
const BRIEF = 'Pick a supplier. Keep first-year cost under £250,000.';

/** A ROOT target carrying a value, so the proved-unanchored arm cannot be taken. */
const GRAPH = {
  nodes: [
    { id: GOAL_ID, kind: 'goal', label: 'Profit' },
    { id: TARGET_ID, kind: 'factor', label: 'First-year cost', observed_state: 0.6 },
  ],
  edges: [{ from: TARGET_ID, to: GOAL_ID }],
  goal_constraints: [
    {
      constraint_id: CAP.constraint_id,
      node_id: TARGET_ID,
      operator: '<=',
      value: 250000,
      label: CAP.label,
      unit: 'GBP',
    },
  ],
};

async function realSummary(): Promise<{ summary: string; state: unknown }> {
  const envelope = {
    ...(JSON.parse(JSON.stringify(happyFixture)) as Record<string, unknown>),
    inference_warnings: [FRAME_REFUSAL],
  };
  const plotClient = {
    run: vi.fn<
      (p: Record<string, unknown>, r: string, o?: PLoTClientRunOpts) => Promise<V2RunResponseEnvelope>
    >(() => Promise.resolve(JSON.parse(JSON.stringify(envelope)) as V2RunResponseEnvelope)),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
  const snapshot = {
    graph: GRAPH,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { [TARGET_ID]: 0.5 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { [TARGET_ID]: 0.7 } },
    ],
    goal_node_id: GOAL_ID,
    rawPersistedGraph: GRAPH,
    briefText: BRIEF,
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: vi.fn<ScenarioReader>(() => Promise.resolve(snapshot)),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: BRIEF,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as unknown as HandlerInvocation);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  const cv = fact.result.constraint_verdict as { constraint_verdict_state?: unknown } | undefined;
  return { summary: fact.result.summary, state: cv?.constraint_verdict_state };
}

describe('T5 — the summary the real run_analysis handler composes (run-analysis.ts:2199)', () => {
  it('carries the no-remedy disclosure and passes every gate', async () => {
    const { summary, state } = await realSummary();
    // PRECONDITION: the handler really reached the unknown-cause state.
    expect(state).toBe('unevaluated');
    expect(summary).toContain(EXPECT_ONE_CAP);
    expectNoPromiseAndNoAssertedCause(summary);
    expectPassesEveryGate(summary);
  });
});
