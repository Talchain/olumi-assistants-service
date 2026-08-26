/**
 * REPAIR MONOTONICITY — adding valid information must never make a model LESS
 * analysable.
 *
 * ## The ruling this encodes (founder, 2026-08-25)
 *
 * > Analysis over a partially-valued model is legitimate where the scientific
 * > compute supports it and uncertainty is represented honestly. Therefore
 * > admission should require only inputs the compute genuinely consumes. [...]
 * > **Repair must be monotone: adding valid information cannot make the model
 * > less analysable.**
 *
 * ## The defect measured at pristine `staging` 7401725f (2026-08-25)
 *
 * `resolveRunAdmission` over ONE option wired to three controllable factors,
 * beside two fully-configured siblings. Sweeping the number of valued
 * option×factor pairs on that option:
 *
 *   | valued pairs | willProceed |
 *   |--------------|-------------|
 *   | 0            | **true**    |
 *   | 1            | **false**   |
 *   | 2            | false       |
 *   | 3            | true        |
 *
 * A **V-shaped** curve. The user is told "choose the missing effect value",
 * supplies ONE, and the model goes from analysable to BLOCKED. Following
 * Olumi's own repair advice is what breaks it.
 *
 * ## The mechanism (two questions under one key — CLAUDE.md trap 21)
 *
 * `analysable-option-gate.ts` gated on `hasEmptyInterventions` — PLoT's
 * `EMPTY_INTERVENTIONS` predicate, i.e. *"will PLoT refuse this option?"*. Only
 * a WHOLLY empty option was therefore HELD (baseline) or EXCLUDED, and only
 * those ids reached `scaffold_plan.scaffolded_option_ids`. But the blockers are
 * minted by a DIFFERENT question — *"is this option fully specified relative to
 * the option→factor edges drawn for it?"* (`analysis-ready.ts`). Admission
 * waives a blocker only when `isWaivableByExclusion` finds its option in that
 * id set, so the moment an option stopped being EMPTY its remaining
 * `MISSING_OPTION_VALUE` blockers became **unwaivable**.
 *
 * ## Why the corpus is a lattice, not an example
 *
 * The state of a graph under repair is a VECTOR — how many pairs each option
 * has valued. Repair moves that vector UP. Monotonicity is a statement about
 * every covering pair in the lattice, so the corpus enumerates the whole
 * product space and checks every single-increment edge. One example would have
 * pinned one edge of it, and the pristine defect is invisible on most edges.
 *
 * ⭐ The corpus is asserted to DISCRIMINATE (both verdicts occur). A
 * monotonicity property over a corpus that is uniformly admitted — or
 * uniformly blocked — is vacuously true and would pass against any
 * implementation, including one that waives everything.
 */

import { describe, it, expect } from 'vitest';

import { resolveRunAdmission } from '../analysis-ready-core.js';

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const ALL_FACTORS = ['fac_a', 'fac_b', 'fac_c'] as const;

interface OptionSpec {
  /** how many option→factor edges this option carries (its DEMAND) */
  readonly demand: number;
  /** how many of those pairs currently carry a value */
  readonly valued: number;
  readonly isBaseline?: boolean;
}

function buildGraph(specs: readonly OptionSpec[]) {
  const options = specs.map((spec, i) => {
    const interventions: Record<string, number> = {};
    for (let f = 0; f < spec.valued; f += 1) {
      interventions[ALL_FACTORS[f]] = 0.25 + f * 0.15 + i * 0.02;
    }
    return {
      id: `opt${i}`,
      kind: 'option' as const,
      label: `Option ${i}`,
      demand: spec.demand,
      ...(spec.isBaseline ? { is_baseline: true } : {}),
      ...(spec.valued > 0 ? { interventions } : {}),
    };
  });

  const factorEdges = options.flatMap((o) =>
    ALL_FACTORS.slice(0, o.demand).map((f) => v3Edge(`ef_${o.id}_${f}`, o.id, f)),
  );

  return {
    version: '1',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Grow revenue without burning the team' },
      { id: 'decision', kind: 'decision', label: 'Which way forward' },
      ...ALL_FACTORS.map((f, i) => ({
        id: f,
        kind: 'factor',
        label: `Factor ${i}`,
        category: 'controllable',
        observed_state: { value: 0.4 + i * 0.1, cap: 1 },
      })),
      ...options.map(({ demand: _demand, ...node }) => node),
    ],
    edges: [
      ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
      ...factorEdges,
      ...ALL_FACTORS.map((f, i) => v3Edge(`eg${i}`, f, 'goal')),
    ],
  };
}

/** `true` when the whole model can be analysed at this repair state. */
function analysable(specs: readonly OptionSpec[]): boolean {
  return resolveRunAdmission(buildGraph(specs)).willProceed;
}

/** Every valued-count vector over the given demands (the repair lattice). */
function enumerateStates(demands: readonly number[]): number[][] {
  return demands.reduce<number[][]>(
    (acc, d) => acc.flatMap((prefix) => Array.from({ length: d + 1 }, (_, v) => [...prefix, v])),
    [[]],
  );
}

/**
 * Shapes chosen to span what a fresh Olumi draft produces: 2–4 options, options
 * demanding 1–3 factors, with and without a detected status-quo baseline, and
 * uneven demands across siblings.
 *
 * ⚠ WHAT THIS CORPUS EXCLUDES, stated rather than implied: factors that are not
 * `controllable`; repair-authored option→factor edges; options with NO factor
 * edge at all (`OPTION_NO_FACTOR_EDGES`); graphs with no goal; and value
 * MUTATION (a value changed rather than added). Those are separate claims and
 * this corpus supports none of them.
 */
const SHAPES: ReadonlyArray<{ name: string; demands: number[]; baselineIndex?: number }> = [
  { name: '2 options, demands 3+3', demands: [3, 3] },
  { name: '3 options, demands 3+3+3', demands: [3, 3, 3] },
  { name: '3 options, demands 3+3+3, opt0 baseline', demands: [3, 3, 3], baselineIndex: 0 },
  { name: '3 options, demands 3+3+3, opt2 baseline', demands: [3, 3, 3], baselineIndex: 2 },
  { name: '3 options, uneven demands 1+2+3', demands: [1, 2, 3] },
  { name: '4 options, demands 2+2+2+2', demands: [2, 2, 2, 2] },
  { name: '4 options, uneven 1+3+2+3, opt1 baseline', demands: [1, 3, 2, 3], baselineIndex: 1 },
];

function specsFor(
  demands: readonly number[],
  state: readonly number[],
  baselineIndex: number | undefined,
): OptionSpec[] {
  return demands.map((demand, i) => ({
    demand,
    valued: state[i],
    ...(baselineIndex === i ? { isBaseline: true } : {}),
  }));
}

describe('repair monotonicity — adding a valid value never reduces analysability', () => {
  /**
   * ⭐ PRECONDITION FOR THE WHOLE CORPUS, PINNED IN-TEST. The waiver consults the
   * `obligation` stamp from `classifyIssueObligation`, so a corpus whose issues
   * were all `required` would exercise none of it and the lattice would pass by
   * testing nothing (CLAUDE.md trap 13b). Assert the fixtures really do produce
   * `offered` obligations — these graphs carry no user-authored provenance, which
   * is what a fresh Olumi draft looks like.
   */
  it('PRECONDITION: the corpus produces `offered` obligations, so the waiver is exercised', () => {
    const admission = resolveRunAdmission(
      buildGraph([
        { demand: 3, valued: 3 },
        { demand: 3, valued: 3 },
        { demand: 3, valued: 1 },
      ]),
    );
    const valueIssues = (admission.assessment.blockingIssues ?? []).filter(
      (i) => i.code === 'MISSING_OPTION_VALUE',
    );
    expect(valueIssues.length).toBeGreaterThan(0);
    expect(valueIssues.every((i) => i.obligation === 'offered')).toBe(true);
  });

  it('INVARIANT over the repair lattice: analysable(G) ⇒ analysable(G + one valid value)', { timeout: 120_000 }, () => {
    const violations: string[] = [];
    let admitted = 0;
    let blocked = 0;
    let coveringPairs = 0;

    for (const shape of SHAPES) {
      const states = enumerateStates(shape.demands);
      const verdict = new Map<string, boolean>();
      for (const state of states) {
        const ok = analysable(specsFor(shape.demands, state, shape.baselineIndex));
        verdict.set(state.join(','), ok);
        if (ok) admitted += 1;
        else blocked += 1;
      }
      // Every covering pair: increment exactly ONE option's valued count by 1.
      for (const state of states) {
        for (let i = 0; i < state.length; i += 1) {
          if (state[i] >= shape.demands[i]) continue;
          const next = [...state];
          next[i] += 1;
          coveringPairs += 1;
          const before = verdict.get(state.join(','))!;
          const after = verdict.get(next.join(','))!;
          if (before && !after) {
            violations.push(
              `${shape.name}: [${state.join(',')}] analysable but [${next.join(',')}] BLOCKED ` +
                `(added one value to option ${i})`,
            );
          }
        }
      }
    }

    // The corpus must be able to observe both outcomes, or the invariant is
    // vacuous (a guard agreeing with itself — CLAUDE.md trap 13b).
    expect(admitted).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    expect(coveringPairs).toBeGreaterThan(100);

    expect(violations.join('\n')).toBe('');
  });

  /**
   * The exact pristine defect, bound BY IDENTITY (this option id, this count)
   * rather than by a value predicate another shape could satisfy — CLAUDE.md
   * trap 19. If the lattice property above were ever narrowed, this still REDs.
   */
  it('the witnessed V-shape: one value added to a 3-factor option keeps the model analysable', () => {
    const shape = (valued: number): OptionSpec[] => [
      { demand: 3, valued: 3 },
      { demand: 3, valued: 3 },
      { demand: 3, valued },
    ];
    expect(analysable(shape(0))).toBe(true);
    expect(analysable(shape(1))).toBe(true); // ← pristine returned FALSE
    expect(analysable(shape(2))).toBe(true); // ← pristine returned FALSE
    expect(analysable(shape(3))).toBe(true);
  });

  describe('opposite-direction twins — what must STILL be refused', () => {
    /**
     * The harm in the other direction is a FALSE ADMISSION: a model admitted by
     * waiving something the exclusion does not actually answer, which then fails
     * downstream. These pin that the fix did not buy monotonicity by waiving
     * everything.
     */
    it('a graph with NO goal stays blocked at every repair state', () => {
      const g = buildGraph([
        { demand: 3, valued: 3 },
        { demand: 3, valued: 1 },
      ]) as { nodes: Array<{ id: string; kind: string }>; edges: Array<{ to: string }> };
      const noGoal = {
        ...g,
        nodes: g.nodes.filter((n) => n.kind !== 'goal'),
        edges: g.edges.filter((e) => e.to !== 'goal'),
      };
      expect(resolveRunAdmission(noGoal).willProceed).toBe(false);
    });

    /**
     * ⚠ THIS TWIN WAS WRONG WHEN FIRST WRITTEN, AND THE CORRECTION IS THE POINT.
     * It originally also asserted that `[valued 3 of 3, valued 1 of 3]` must stay
     * BLOCKED — an expectation copied from PRISTINE BEHAVIOUR rather than derived
     * from the producer's semantics (CLAUDE.md trap 13c). Both of those options
     * carry non-empty `interventions`, so PLoT receives two options it accepts and
     * `options.minItems: 2` is satisfied; refusing that graph IS the over-demand
     * the ruling condemns. It is asserted as ADMITTED in the lattice above.
     *
     * The genuine "too few to compare" case is fewer than two options carrying
     * ANY value — then exclusion really does leave a single arm.
     */
    it('fewer than two options carrying ANY value stays blocked (PLoT needs a comparison)', () => {
      expect(analysable([{ demand: 3, valued: 3 }, { demand: 3, valued: 0 }])).toBe(false);
      expect(analysable([{ demand: 3, valued: 0 }, { demand: 3, valued: 0 }])).toBe(false);
    });

    /**
     * The waiver is scoped to `MISSING_OPTION_VALUE` alone. A blocker of a
     * different code on a fully-valued graph must still refuse — this is what
     * stops "monotone" being bought by waiving everything.
     */
    it('a non-value blocker on an otherwise-valued graph still refuses', () => {
      const g = buildGraph([
        { demand: 3, valued: 3 },
        { demand: 3, valued: 2 },
      ]) as { nodes: Array<{ id: string; kind: string; observed_state?: unknown }> };
      // Break a factor's observed_state so the assessment raises a NON-value
      // blocker on the same graph the value waiver would otherwise admit.
      const broken = {
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === 'fac_a' ? { ...n, observed_state: { value: 'not-a-number' } } : n,
        ),
      };
      const admission = resolveRunAdmission(broken);
      const codes = (admission.assessment.blockingIssues ?? []).map((i) => i.code);
      // Pin the PRECONDITION in-test: this payload really does carry a blocker
      // the waiver does not cover, so a `false` verdict is the code's doing and
      // not the fixture quietly failing to reproduce anything.
      expect(codes.some((c) => c !== 'MISSING_OPTION_VALUE')).toBe(true);
      expect(admission.willProceed).toBe(false);
    });

    /**
     * ⚠⚠ KNOWN GAP, RECORDED RATHER THAN PAPERED OVER — the waiver's
     * `obligation === 'offered'` conjunct is PRESENT BUT NOT COVERED HERE.
     *
     * Every fixture in this file produces `offered` obligations (pinned by the
     * PRECONDITION spec above), so a mutant that deletes that conjunct does NOT
     * bite this corpus. Covering it needs an option→factor effect whose BOTH
     * ends are `user_stated`, and the shapes tried for that — an
     * `observed_state.source` on the factor, and rich
     * `{ value, source }` intervention entries on the option — both make the
     * graph parse as **`SCHEMA_INVALID`**. That refusal is a different
     * mechanism, so a twin built on those shapes would have gone green while
     * testing nothing; it was the in-test precondition that caught it, not
     * inspection.
     *
     * The gap is therefore in the FIXTURE VOCABULARY, not in the rule: building
     * it needs the real `@talchain/schemas` V3 shape for user-stated
     * provenance. Until that exists here, the conjunct's coverage rests on
     * `obligation-provenance.ts`'s own suite, not on this one. Stated so the
     * suite is green for the RIGHT reason and this does not read as coverage it
     * does not provide.
     */

    it('no option specified at all stays blocked', () => {
      expect(
        analysable([
          { demand: 3, valued: 0 },
          { demand: 3, valued: 0 },
          { demand: 3, valued: 0 },
        ]),
      ).toBe(false);
    });
  });
});
