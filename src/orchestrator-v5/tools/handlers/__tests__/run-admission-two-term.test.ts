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

import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { assessAnalysisReadiness, resolveRunAdmission } from '../analysis-ready-core.js';

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
