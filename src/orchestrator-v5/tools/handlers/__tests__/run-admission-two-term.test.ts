/**
 * RUN ADMISSION — the two-term gate (row 2.1235 / NEW-1 / L-63).
 *
 * ## The defect these specs pin
 *
 * F4 (21 Jul) closed a readiness↔run disagreement in ONE direction: the run
 * proceeded on a partly-configured model while the pre-run panel said
 * "blocked". Its cure was `scaffold_plan.will_scaffold_options`, a projection of
 * what `gateAnalysableOptions` would do, which the deployed UI composes as
 *     allowed = can_run_analysis || scaffold_plan.will_scaffold_options
 * (`DecisionGuideAI@f15bccaf canRunAnalysis.ts:230-232`, `:255`).
 *
 * **#983 then moved the RUN's admission UPSTREAM of that gate and the drift
 * flipped direction.** `build-turn-context.ts` refused on the strict verdict
 * alone and threw before `run-analysis.ts` §2.55 could exclude anything — so the
 * panel offered a Run the server refused. A simulated first-time user spent 24
 * minutes and 9 turns on deployed CEE `bacf35d` and reached ZERO analyses.
 *
 * ## The measurement these specs encode (deployed CEE `2988eac`, 2026-08-16)
 *
 * `/assist/v1/graph-readiness`, three arms of ONE graph. The arms give three
 * DIFFERENT answers, so the probe discriminates — this is not an instrument
 * agreeing with itself:
 *
 *   | options configured | can_run_analysis | will_scaffold_options | diverges |
 *   |--------------------|------------------|-----------------------|----------|
 *   | 4 of 4             | true             | false                 | no       |
 *   | **2 of 4**         | **false**        | **true**              | **YES**  |
 *   | 0 of 4             | false            | false                 | no       |
 *
 * The mixed arm is what a FRESH DRAFT produces. That is the whole P0.
 *
 * ## What must NOT regress
 *
 * Admission may only waive a blocker the exclusion actually answers. A
 * structural blocker on the same graph keeps the refusal — otherwise the run is
 * admitted and then fails downstream, which is F4's symptom in the other
 * direction and strictly worse than refusing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  stripComments,
  GUARD_WALK_TIMEOUT_MS,
} from '../../../../../scripts/ci/strip-source-comments.mjs';

import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { assessAnalysisReadiness, resolveRunAdmission } from '../analysis-ready-core.js';
import { blockerIssue } from '../../../../orchestrator/tools/analysis-ready-helper.js';

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const baseNodes = () => [
  { id: 'goal', kind: 'goal', label: 'Bridge the sales/engineering gap' },
  { id: 'decision', kind: 'decision', label: 'Hiring' },
  {
    id: 'fac_velocity',
    kind: 'factor',
    label: 'Engineering Delivery Velocity',
    category: 'controllable',
    observed_state: { value: 0.5, cap: 1 },
  },
];

const option = (id: string, label: string, interventions?: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  ...(interventions ? { interventions } : {}),
});

/**
 * `configuredCount` options carry effect values; `unconfiguredCount` do not.
 * Every option is structurally linked to the factor, so the ONLY thing that
 * varies across arms is whether a value is present.
 */
function graphWith(configuredCount: number, unconfiguredCount: number) {
  const options: ReturnType<typeof option>[] = [];
  for (let i = 0; i < configuredCount; i += 1) {
    options.push(option(`opt_c${i}`, `Configured ${i}`, { fac_velocity: 0.3 + i * 0.2 }));
  }
  for (let i = 0; i < unconfiguredCount; i += 1) {
    options.push(option(`opt_u${i}`, `Unconfigured ${i}`));
  }
  return {
    version: '1',
    nodes: [...baseNodes(), ...options],
    edges: [
      ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
      ...options.map((o, i) => v3Edge(`ef${i}`, o.id, 'fac_velocity')),
      v3Edge('eg', 'fac_velocity', 'goal'),
    ],
  };
}

/** The witnessed state: a fresh draft with some options valued and some not. */
const MIXED = graphWith(2, 2);
const FULLY_CONFIGURED = graphWith(4, 0);
const NONE_CONFIGURED = graphWith(0, 4);

describe('resolveRunAdmission — the mixed arm is the P0', () => {
  it('the strict verdict REFUSES the mixed graph (the pre-fix behaviour, still true)', () => {
    const strict = assessAnalysisReadiness(MIXED);
    expect(strict.status).toBe('unrecoverable');
    expect(strict.safeToAnalyse).toBe(false);
    // Bound by IDENTITY: the blockers name the UNCONFIGURED options, and only
    // those. A value predicate ("some blocker exists") would pass on a
    // completely different defect.
    const blockedOptionIds = (strict.issues ?? [])
      .map((i) => i.option_id)
      .filter((id): id is string => typeof id === 'string');
    expect([...new Set(blockedOptionIds)].sort()).toEqual(['opt_u0', 'opt_u1']);
  });

  it('ADMITS the mixed graph — the run proceeds by excluding the unconfigured options', () => {
    const admission = resolveRunAdmission(MIXED);
    expect(admission.willProceed).toBe(true);
    expect(admission.plan.will_scaffold_options).toBe(true);
    // The waived options are EXACTLY the unconfigured ones, by id.
    expect([...admission.waivedOptionIds].sort()).toEqual(['opt_u0', 'opt_u1']);
    // And the strict verdict is preserved unchanged alongside it — admitting
    // must not erase the record of what is unset.
    expect(admission.strict.status).toBe('unrecoverable');
  });

  it('CONTRAST — a fully-configured graph is admitted with nothing waived', () => {
    const admission = resolveRunAdmission(FULLY_CONFIGURED);
    expect(admission.willProceed).toBe(true);
    expect(admission.plan.will_scaffold_options).toBe(false);
    expect(admission.waivedOptionIds).toEqual([]);
  });

  it('CONTRAST — an all-unconfigured graph is still REFUSED', () => {
    const admission = resolveRunAdmission(NONE_CONFIGURED);
    expect(admission.willProceed).toBe(false);
    expect(admission.plan.will_scaffold_options).toBe(false);
    expect(admission.waivedOptionIds).toEqual([]);
  });
});

describe('resolveRunAdmission — a blocker the exclusion cannot answer keeps the refusal', () => {
  /**
   * The mixed graph with the factor→goal edge removed, so the model has NO path
   * to its goal. That is a `graph_structure` blocker: dropping the unconfigured
   * options cannot fix it, so admitting would hand PLoT a run that fails.
   */
  const STRUCTURALLY_BROKEN = {
    ...MIXED,
    edges: MIXED.edges.filter((e) => e.id !== 'eg'),
  };

  it('refuses when a structural blocker co-exists with a waivable one', () => {
    const admission = resolveRunAdmission(STRUCTURALLY_BROKEN);
    // PRECONDITION PINNED IN-TEST (trap 13b): this fixture must genuinely still
    // produce the waivable half, or the spec would pass for the wrong reason —
    // a graph with no scaffoldable options refuses trivially and proves nothing.
    expect(admission.plan.will_scaffold_options).toBe(true);
    const categories = new Set((admission.strict.issues ?? []).map((i) => i.category));
    expect(categories.has('graph_structure')).toBe(true);
    // The verdict under test.
    expect(admission.willProceed).toBe(false);
    expect(admission.waivedOptionIds).toEqual([]);
  });
});

describe('admission absorbs an ABSENCE, never a value it cannot read', () => {
  /**
   * ⚠ THIS CASE WAS FOUND BY A SURVIVING MUTANT, AND IT WAS A DEFECT IN THE FIX.
   *
   * The first version of `isWaivableByExclusion` keyed on issue CATEGORY. A
   * mutant deleting the category check survived — which said the category was
   * not discriminating — and probing why produced this graph:
   *
   * `opt_unreadable` carries a REAL user value (`raw_value: 250000`) on a
   * CAPLESS factor. That raises `NO_CAP_UNRECOVERABLE`, whose category is
   * `option_values`, and whose WIRE projection has EMPTY interventions — so the
   * exclusion plan "touches" it and the category rule waived it.
   *
   * The run would then proceed and the existing disclosure would say the option
   * was *"left out of this comparison because it has no values set"*. It has a
   * value. Telling a user who entered £250,000 that they entered nothing is a
   * fabrication, and it is exactly the class the no-rank ruling exists to stop.
   */
  const UNREADABLE_VALUE = {
    version: '1',
    nodes: [
      ...baseNodes(),
      { id: 'fac_budget', kind: 'factor', label: 'Budget', category: 'controllable' },
      option('opt_c0', 'Configured 0', { fac_velocity: 0.4 }),
      option('opt_c1', 'Configured 1', { fac_velocity: 0.8 }),
      {
        id: 'opt_unreadable',
        kind: 'option',
        label: 'Unreadable',
        data: { interventions: { fac_budget: { raw_value: 250000 } } },
      },
    ],
    edges: [
      v3Edge('e1', 'decision', 'opt_c0'),
      v3Edge('e2', 'decision', 'opt_c1'),
      v3Edge('e3', 'decision', 'opt_unreadable'),
      v3Edge('e4', 'opt_c0', 'fac_velocity'),
      v3Edge('e5', 'opt_c1', 'fac_velocity'),
      v3Edge('e6', 'opt_unreadable', 'fac_budget'),
      v3Edge('e7', 'fac_velocity', 'goal'),
      v3Edge('e8', 'fac_budget', 'goal'),
    ],
  };

  it('REFUSES when an option holds a value the model cannot read', () => {
    const admission = resolveRunAdmission(UNREADABLE_VALUE);

    // PRECONDITIONS PINNED IN-TEST — without these the spec could pass because
    // the fixture stopped reproducing the state, not because the rule holds.
    // (1) The exclusion really does want to drop it: it is touched.
    expect(admission.plan.scaffolded_option_ids).toContain('opt_unreadable');
    // (2) Its blocker really is in the category the broken rule waived.
    const issue = (admission.strict.issues ?? []).find((i) => i.option_id === 'opt_unreadable');
    expect(issue?.code).toBe('NO_CAP_UNRECOVERABLE');
    expect(issue?.category).toBe('option_values');

    // The verdict under test: a value we cannot read keeps the refusal.
    expect(admission.willProceed).toBe(false);
    expect(admission.waivedOptionIds).toEqual([]);
  });

  it('DISCRIMINATING TWIN — the same graph with that option genuinely EMPTY is admitted', () => {
    // Identical in every respect except that the value is gone. If the spec
    // above passed because of the extra factor, the edge count, or anything
    // else structural, this twin would fail too.
    const emptied = {
      ...UNREADABLE_VALUE,
      nodes: UNREADABLE_VALUE.nodes.map((n) =>
        n.id === 'opt_unreadable' ? { id: n.id, kind: n.kind, label: n.label } : n,
      ),
    };
    const admission = resolveRunAdmission(emptied);
    expect(admission.willProceed).toBe(true);
    expect(admission.waivedOptionIds).toEqual(['opt_unreadable']);
  });
});

describe('the EXCLUSION waiver never answers a blocker on a SUBMITTED option', () => {
  /**
   * ⚠ ALSO FOUND BY A SURVIVING MUTANT (drop the touched-option identity check).
   *
   * The waiver has two conjuncts — the blocker's CODE must mean "nothing is
   * set", AND it must name an option the exclusion is about to drop. Every
   * earlier fixture satisfied both together, so nothing bound the second one.
   *
   * `opt_partial` is linked to TWO factors and valued on ONE. Its interventions
   * are non-empty, so the gate SUBMITS it — it is not touched — yet it still
   * raises `MISSING_OPTION_VALUE` for the unvalued factor.
   *
   * ## ⚠⚠ THIS SPEC'S VERDICT CHANGED ON 2026-08-25, AND THE REASON MATTERS
   *
   * It previously asserted `willProceed === false` for this graph. That was
   * correct about the EXCLUSION — exclusion answers nothing about an option
   * being submitted, and that conjunct is UNCHANGED and still pinned below —
   * but it used the whole-graph verdict to bind it, and the verdict now has a
   * SECOND legitimate cause.
   *
   * The founder ruling (2026-08-25): *"admission should require only inputs the
   * compute genuinely consumes. A missing option×factor value that downstream
   * compute discards must not block analysis. [...] Repair must be monotone:
   * adding valid information cannot make the model less analysable."*
   *
   * Blocking this graph broke monotonicity outright: `opt_partial` valued on
   * ZERO factors is excluded and waived (admitted), and valuing ONE factor
   * blocked it. Measured on pristine `staging` 7401725f; the lattice is in
   * `run-admission-monotonicity.test.ts`. And the obligation itself is minted
   * from an option→factor EDGE that **PLoT strips before the engine ever sees
   * it** (`plot-lite-service` `src/normalisation/option-filter.ts:93-97`,
   * staging `3a3bee58`) — `option.interventions` is the only channel by which an
   * option touches a factor, so the unvalued pair is a no-op at the compute.
   *
   * So the blocker on `opt_partial` is now answered by
   * `isWaivableByComputeDiscard`, which is a DIFFERENT predicate answering a
   * DIFFERENT question. The assertions below therefore bind the exclusion
   * conjunct DIRECTLY — `opt_partial` must not appear in `waivedOptionIds` and
   * must not be stamped `waived_by_exclusion` — which is what the surviving
   * mutant would violate. Dropping the identity check still REDs this spec.
   *
   * ⚠ WHAT THIS DOES NOT DISCHARGE: the ruling licenses this only where
   * "uncertainty is represented honestly". The run now goes out carrying an
   * option CEE has said is incomplete, and there is no carrier marking it as
   * such — `waived_by_exclusion` would be a lie here, and a truthful
   * `waived_by_compute_discard` needs a new member on
   * `CanonicalReadinessIssue`. The blockers do remain visible in
   * `assessment.blockingIssues`, so the gap is in the OFFER COPY, not in
   * whether the user can see the missing value. Tracked as a follow-up.
   */
  const PARTIAL_PLUS_EMPTY = {
    version: '1',
    nodes: [
      ...baseNodes(),
      { id: 'fac_ramp', kind: 'factor', label: 'Ramp Delay', category: 'controllable', observed_state: { value: 0.5, cap: 1 } },
      option('opt_c0', 'Configured 0', { fac_velocity: 0.4 }),
      option('opt_c1', 'Configured 1', { fac_velocity: 0.8 }),
      option('opt_partial', 'Partial', { fac_velocity: 0.6 }),
      option('opt_empty', 'Empty'),
    ],
    edges: [
      v3Edge('e1', 'decision', 'opt_c0'),
      v3Edge('e2', 'decision', 'opt_c1'),
      v3Edge('e3', 'decision', 'opt_partial'),
      v3Edge('e4', 'decision', 'opt_empty'),
      v3Edge('e5', 'opt_c0', 'fac_velocity'),
      v3Edge('e6', 'opt_c1', 'fac_velocity'),
      v3Edge('e7', 'opt_partial', 'fac_velocity'),
      v3Edge('e8', 'opt_partial', 'fac_ramp'),
      v3Edge('e9', 'opt_empty', 'fac_velocity'),
      v3Edge('e10', 'fac_velocity', 'goal'),
      v3Edge('e11', 'fac_ramp', 'goal'),
    ],
  };

  it('does not exclusion-waive a submitted option, even on an identical code', () => {
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);

    // PRECONDITIONS PINNED IN-TEST — the fixture must genuinely present BOTH
    // halves, or this passes for the wrong reason.
    // (1) the exclusion has something to do, so the plan conjunct is satisfied;
    expect(admission.plan.will_scaffold_options).toBe(true);
    expect(admission.plan.scaffolded_option_ids).toEqual(['opt_empty']);
    // (2) and there is a blocker with a WAIVABLE CODE on an option NOT touched.
    const blockers = (admission.strict.issues ?? []).filter(
      (i) => i.code === 'MISSING_OPTION_VALUE',
    );
    expect(blockers.map((i) => i.option_id).sort()).toEqual(['opt_empty', 'opt_partial']);

    // ⭐ THE CLAIM UNDER TEST, bound DIRECTLY rather than through the verdict:
    // identical code, different option ⇒ the EXCLUSION does not answer it.
    // Dropping the touched-option identity conjunct makes `opt_partial` appear
    // in both of these, so the surviving mutant still REDs here.
    expect(admission.waivedOptionIds).toEqual(['opt_empty']);
    const partialBlocker = (admission.assessment.blockingIssues ?? []).find(
      (i) => i.option_id === 'opt_partial' && i.code === 'MISSING_OPTION_VALUE',
    );
    expect(partialBlocker).toBeDefined();
    expect(partialBlocker?.waived_by_exclusion).toBeUndefined();

    // The graph is nonetheless ADMITTED — by the compute-discard waiver, not by
    // the exclusion. See the adjudication above: refusing it broke repair
    // monotonicity, and the obligation is minted from an edge PLoT strips.
    expect(admission.willProceed).toBe(true);
  });

  it('DISCRIMINATING TWIN — completing that option admits the run', () => {
    const completed = {
      ...PARTIAL_PLUS_EMPTY,
      nodes: PARTIAL_PLUS_EMPTY.nodes.map((n) =>
        n.id === 'opt_partial'
          ? { ...n, interventions: { fac_velocity: 0.6, fac_ramp: 0.2 } }
          : n,
      ),
    };
    const admission = resolveRunAdmission(completed);
    expect(admission.willProceed).toBe(true);
    expect(admission.waivedOptionIds).toEqual(['opt_empty']);
  });
});

describe('the waivable-code set carries no unreachable entries', () => {
  /**
   * Two codes were removed from `WAIVABLE_BY_EXCLUSION` as dead. An allowlist
   * entry that can never match reads as coverage it does not provide — these
   * specs pin the REACHABILITY FACTS the removal rests on, so if either code
   * ever becomes waivable-shaped, this REDs and the decision is revisited.
   */
  it('UNREACHABLE_CONTROLLABLE_FACTOR can never carry an option_id, so it could never have been waived', () => {
    // Derived from the producer, not from its name: `blockerIssue` emits this
    // code only inside a branch guarded by `!optionId`.
    const issue = blockerIssue(
      { blocker_type: 'missing_value', factor_id: 'fac_x', factor_label: 'X' },
      0,
      'needs_user_mapping',
    );
    expect(issue?.code).toBe('UNREACHABLE_CONTROLLABLE_FACTOR');
    expect(issue?.option_id).toBeUndefined();

    // POSITIVE CONTROL — the same producer DOES attach option_id on the codes
    // that keep it, so the assertion above measures the branch, not the mapper.
    const withOption = blockerIssue(
      { blocker_type: 'missing_value', option_id: 'opt_a', factor_id: 'fac_x' },
      0,
      'needs_encoding',
    );
    expect(withOption?.code).toBe('MISSING_OPTION_VALUE');
    expect(withOption?.option_id).toBe('opt_a');
  });

  it('MISSING_OPTION_CONNECTION has no producer in this repo', () => {
    // The mapper can build it — so the absence claim is about PRODUCERS, not
    // about the mapper being incapable.
    expect(
      blockerIssue({ blocker_type: 'missing_connection', option_id: 'opt_a' }, 0, 'needs_encoding')
        ?.code,
    ).toBe('MISSING_OPTION_CONNECTION');

    // Sweep the source for writes of `blocker_type`, with a CONTRAST CONTROL in
    // the same sweep: absence is only proven when the target reads zero AND a
    // same-family symbol reads non-zero.
    const root = join(process.cwd(), 'src');
    const writes: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(p);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        // STRIP COMMENTS FIRST. Without this the sweep matched THIS PR own doc
        // comment describing the absence — a probe reading its own description
        // and reporting it as evidence. Caught by the test itself.
        const src = stripComments(readFileSync(p, "utf8"));
        for (const m of src.matchAll(/blocker_type:\s*["']([a-z_]+)["']/g)) {
          writes.push(m[1]);
        }
      }
    };
    walk(root);
    expect(writes.length, 'sweep found no producers at all — the probe is blind').toBeGreaterThan(0);
    expect(writes).toContain('missing_value'); // contrast: present
    expect(writes).not.toContain('missing_connection'); // target: absent
  }, GUARD_WALK_TIMEOUT_MS);
});

describe('the route and the run give ONE answer', () => {
  /**
   * The anti-drift property. The panel's offer is
   * `can_run_analysis || scaffold_plan.will_scaffold_options`; the run admits on
   * `resolveRunAdmission().willProceed`. For EVERY graph these must agree —
   * that equality IS the fix, and it is what the P0 violated.
   */
  const corpus: ReadonlyArray<readonly [string, unknown]> = [
    ['mixed 2/4', MIXED],
    ['fully configured', FULLY_CONFIGURED],
    ['none configured', NONE_CONFIGURED],
    ['structurally broken + mixed', { ...MIXED, edges: MIXED.edges.filter((e) => e.id !== 'eg') }],
    ['single configured + single unconfigured', graphWith(1, 1)],
    ['three configured + one unconfigured', graphWith(3, 1)],
  ];

  it.each(corpus)('%s — panel offer === run admission', (_name, graph) => {
    const route = assessRouteAdmission(graph);
    const panelOffersRun =
      route.can_run_analysis || route.scaffold_plan.will_scaffold_options === true;
    const runAdmits = resolveRunAdmission(graph).willProceed;
    expect(panelOffersRun).toBe(runAdmits);
  });

  it('the mixed arm reproduces the WITNESSED divergence inputs before agreeing', () => {
    // Pins that this corpus still contains the state the P0 lived in. If a
    // future change makes the mixed graph strictly ready, the agreement above
    // becomes vacuous and this REDs to say so.
    const route = assessRouteAdmission(MIXED);
    expect(route.can_run_analysis).toBe(false);
    expect(route.scaffold_plan.will_scaffold_options).toBe(true);
    expect(route.readiness_issues.length).toBeGreaterThan(0);
  });
});

/**
 * ⭐ GATE 1 (PR #1129 review) — THE COMPARISON FLOOR COUNTS *DISTINCT* MAPS,
 * NOT VALUED ONES.
 *
 * PLoT does not need two VALUED options; it needs two DISTINGUISHABLE ones.
 * `identical-options.ts:102-119` fingerprints an option as its sorted
 * `nodeId:value` pairs (snapped to 1e-9) and DEDUPLICATES; when fewer than two
 * unique fingerprints remain, `preflight-v2.ts:443-449` raises the
 * `IDENTICAL_OPTIONS` BLOCKER and the v2 run 422s.
 *
 * ⚠ WHY NEITHER EXISTING CORPUS COULD SEE THIS — check what a corpus EXCLUDES,
 * not what it covers. Both builders give every option a DIFFERENT value by
 * construction: `buildStamped` uses `0.25 + f * 0.15 + i * 0.02` and `graphWith`
 * uses `0.3 + i * 0.2`, and in both the `i` term makes a collision unreachable.
 * The collision class is not under-tested here, it is STRUCTURALLY ABSENT — so a
 * fully green lattice was fully consistent with this admission being wrong.
 *
 * Direction, which is what makes it a defect rather than a preference: a false
 * ADMISSION here dies as an opaque HTTP 422 one network hop away, on the
 * two-option minimum — the commonest shape there is. A local refusal is
 * immediate and explicable.
 */
/**
 * ⚠ PARTLY valued, deliberately — and my first attempt at this fixture got it
 * wrong in a way worth recording. Two options valued on EVERY connected factor
 * raise no `MISSING_OPTION_VALUE` at all, so the waiver path is never entered
 * and `comparisonSurvives` never consulted: the graph admits for a reason that
 * has nothing to do with this floor. The floor gates the WAIVER
 * (`comparisonSurvives && isWaivableByComputeDiscard(...)`), so the case must be
 * one where a waiver is actually being asked for. Both options are therefore
 * connected to TWO factors and valued on ONE.
 */
const identicalMapGraph = (valueA: number, valueB: number) => {
  const options = [
    option('opt_a', 'Option A', { fac_velocity: valueA }),
    option('opt_b', 'Option B', { fac_velocity: valueB }),
  ];
  return {
    version: '1',
    nodes: [
      ...baseNodes(),
      {
        id: 'fac_quality',
        kind: 'factor',
        label: 'Delivery Quality',
        category: 'controllable',
        observed_state: { value: 0.5, cap: 1 },
      },
      ...options,
    ],
    edges: [
      ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
      ...options.map((o, i) => v3Edge(`ef${i}`, o.id, 'fac_velocity')),
      // The SECOND connection is what makes each option partly-valued, so a
      // waiver is genuinely being requested on both.
      ...options.map((o, i) => v3Edge(`efq${i}`, o.id, 'fac_quality')),
      v3Edge('eg', 'fac_velocity', 'goal'),
      v3Edge('egq', 'fac_quality', 'goal'),
    ],
  };
};

describe('the comparison floor counts DISTINCT intervention maps', () => {
  it('2opt_IDENTICAL_partly_valued — REFUSES two options whose maps coincide', () => {
    const graph = identicalMapGraph(0.5, 0.5);

    // PRECONDITION, asserted in-test so a RED is the defect and not a broken
    // fixture: both options ARE valued (so the old `valued.size >= 2` floor is
    // satisfied) and their maps ARE identical (so PLoT would dedupe to one).
    const admission = resolveRunAdmission(graph);
    const wire = admission.assessment.analysisReady?.options ?? [];
    expect(wire).toHaveLength(2);
    const fingerprints = new Set(
      wire.map((o) => JSON.stringify(Object.entries(o.interventions ?? {}).sort())),
    );
    expect(fingerprints.size).toBe(1);
    // ...and a waiver IS being requested, so the floor is genuinely consulted.
    expect(
      (admission.assessment.blockingIssues ?? []).some((i) => i.code === 'MISSING_OPTION_VALUE'),
    ).toBe(true);

    expect(admission.willProceed).toBe(false);
  });

  it('OPPOSITE-DIRECTION TWIN — two DISTINCT maps are still ADMITTED', () => {
    const graph = identicalMapGraph(0.5, 0.7);

    const admission = resolveRunAdmission(graph);
    const wire = admission.assessment.analysisReady?.options ?? [];
    const fingerprints = new Set(
      wire.map((o) => JSON.stringify(Object.entries(o.interventions ?? {}).sort())),
    );
    // The twin's own precondition: this graph differs from the case above in
    // EXACTLY one way — the maps are distinguishable.
    expect(fingerprints.size).toBe(2);

    expect(admission.willProceed).toBe(true);
  });
});

/**
 * ⭐⭐ THE BOUNDARY, PINNED — `collision_2opt`.
 *
 * The distinct-map floor adds EXACTLY ONE monotonicity violation, and it is
 * CORRECT rather than a defect: a value that makes two options identical
 * collapses them into one option, and one option cannot be compared. The scoped
 * invariant — *"user information that keeps the option set DISTINGUISHABLE
 * cannot make the model less analysable"* — does not cover this transition, so
 * the case sits outside the claim rather than contradicting it.
 *
 * ⚠ TWO THINGS THIS FIXTURE HAD TO GET RIGHT, both found by EXECUTION after a
 * first version passed for the wrong reason:
 *
 *  1. The options must be PARTLY valued, because the floor gates the WAIVER
 *     (`comparisonSurvives && isWaivableByComputeDiscard(...)`). Two fully-valued
 *     options raise no `MISSING_OPTION_VALUE`, so no waiver is requested and the
 *     floor is never consulted.
 *  2. A THIRD factor is required, and this is the subtle half. A pure ADDITION
 *     that completes both options also REMOVES the blocker, so the waiver
 *     disappears along with the collision and the graph admits for an unrelated
 *     reason. The third factor keeps a value outstanding on both options AFTER
 *     the addition, so the waiver survives and the floor actually decides.
 *
 * ⚠ AND THE RESIDUAL THIS EXPOSES, recorded rather than quietly fixed: because
 * the floor lives inside the waiver path, a FULLY-VALUED identical pair is still
 * ADMITTED and would still 422 at PLoT with `IDENTICAL_OPTIONS`. That is a real
 * remaining gap, it is OUTSIDE this PR's adjudicated scope, and it is pinned
 * below so it cannot be mistaken for covered.
 */
describe('collision_2opt — the ONE monotonicity violation the floor adds, and why it is right', () => {
  const threeFactorGraph = (
    aMap: Record<string, number>,
    bMap: Record<string, number>,
  ) => {
    const options = [option('opt_a', 'Option A', aMap), option('opt_b', 'Option B', bMap)];
    const extraFactor = (id: string, label: string) => ({
      id,
      kind: 'factor',
      label,
      category: 'controllable',
      observed_state: { value: 0.5, cap: 1 },
    });
    return {
      version: '1',
      nodes: [
        ...baseNodes(),
        extraFactor('fac_quality', 'Delivery Quality'),
        // The third factor NEITHER option ever values — it keeps a waiver
        // outstanding on both, before and after the addition under test.
        extraFactor('fac_morale', 'Team Morale'),
        ...options,
      ],
      edges: [
        ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
        ...options.map((o, i) => v3Edge(`ef${i}`, o.id, 'fac_velocity')),
        ...options.map((o, i) => v3Edge(`efq${i}`, o.id, 'fac_quality')),
        ...options.map((o, i) => v3Edge(`efm${i}`, o.id, 'fac_morale')),
        v3Edge('eg', 'fac_velocity', 'goal'),
        v3Edge('egq', 'fac_quality', 'goal'),
        v3Edge('egm', 'fac_morale', 'goal'),
      ],
    };
  };

  const BEFORE = threeFactorGraph({ fac_velocity: 0.5, fac_quality: 0.3 }, { fac_velocity: 0.5 });
  const AFTER = threeFactorGraph(
    { fac_velocity: 0.5, fac_quality: 0.3 },
    { fac_velocity: 0.5, fac_quality: 0.3 },
  );

  it('BEFORE — distinguishable maps ADMIT, with a waiver genuinely outstanding', () => {
    const before = resolveRunAdmission(BEFORE);
    // Precondition: a waiver IS being requested, so the floor is consulted.
    expect(
      (before.assessment.blockingIssues ?? []).some((i) => i.code === 'MISSING_OPTION_VALUE'),
    ).toBe(true);
    expect(before.willProceed).toBe(true);
  });

  it('AFTER — the user ADDS one true value, the maps coincide, and the model REFUSES', () => {
    const after = resolveRunAdmission(AFTER);
    // The waiver is STILL outstanding (fac_morale unvalued on both), so this
    // refusal is the floor's doing and not the blocker simply disappearing.
    expect(
      (after.assessment.blockingIssues ?? []).some((i) => i.code === 'MISSING_OPTION_VALUE'),
    ).toBe(true);
    const wire = after.assessment.analysisReady?.options ?? [];
    const fingerprints = new Set(
      wire.map((o) => JSON.stringify(Object.entries(o.interventions ?? {}).sort())),
    );
    expect(wire).toHaveLength(2);
    expect(fingerprints.size).toBe(1);

    expect(after.willProceed).toBe(false);
  });

  it('KNOWN-OPEN — a FULLY-valued identical pair is still admitted (outside this PR)', () => {
    // No third factor: both options complete, so no waiver, so the floor never
    // runs. PLoT would still raise `IDENTICAL_OPTIONS` and 422. Pinned so the
    // gap is visible in the suite; closing it means moving the floor out of the
    // waiver path, which is a behaviour change beyond this PR's scope.
    const options = [
      option('opt_a', 'Option A', { fac_velocity: 0.5 }),
      option('opt_b', 'Option B', { fac_velocity: 0.5 }),
    ];
    const fullyValued = {
      version: '1',
      nodes: [...baseNodes(), ...options],
      edges: [
        ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
        ...options.map((o, i) => v3Edge(`ef${i}`, o.id, 'fac_velocity')),
        v3Edge('eg', 'fac_velocity', 'goal'),
      ],
    };
    const admission = resolveRunAdmission(fullyValued);
    expect(
      (admission.assessment.blockingIssues ?? []).some((i) => i.code === 'MISSING_OPTION_VALUE'),
    ).toBe(false);
    // Documents TODAY's behaviour, not the desired one.
    expect(admission.willProceed).toBe(true);
  });
});
