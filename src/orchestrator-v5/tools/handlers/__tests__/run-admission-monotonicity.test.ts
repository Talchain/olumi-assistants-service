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

    /**
     * ⭐ THE BOUNDARY IS INCLUSIVE, AND IT WAS AN UNCOVERED BRANCH. A mutant
     * changing `valued.size >= PLOT_MIN_COMPARISON_OPTIONS` to `>` moved 111 of
     * 409 lattice verdicts and the suite stayed GREEN — the lattice checks
     * MONOTONICITY, and `>` is monotone, just wrong. A property can be true of
     * an implementation that refuses far too much.
     *
     * TWO partly-valued options are exactly what PLoT's `options.minItems: 2`
     * admits (`plot-lite-service` `src/routes/v2/run.ts:1455`), so this is the
     * smallest graph that must run.
     */
    it('the two-option minimum is INCLUSIVE: exactly two partly-valued options admit', () => {
      expect(analysable([{ demand: 3, valued: 1 }, { demand: 3, valued: 1 }])).toBe(true);
      // Its opposite-direction twin: drop to ONE option carrying a value and the
      // comparison no longer exists, so the refusal returns.
      expect(analysable([{ demand: 3, valued: 1 }, { demand: 3, valued: 0 }])).toBe(false);
    });

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

/**
 * ⚠⚠ KNOWN-OPEN — REPAIR IS STILL NON-MONOTONE OVER `user_stated` STRUCTURE.
 *
 * The fix above makes repair monotone where the gap is `offered` (0 violations
 * over the lattice). It does NOT reach structure the USER authored, and this
 * suite says so out loud rather than leaving the gap invisible.
 *
 * ## Measured, not assumed (CEE `11a990c3`, 281 lattice states per axis)
 *
 *   | axis          | admitted | blocked | monotonicity violations |
 *   |---------------|----------|---------|-------------------------|
 *   | `ai_drafted`  | 166      | 115     | **0**                   |
 *   | `user_stated` | 20       | 261     | **17**                  |
 *
 * ## The mechanism, and it is UPSTREAM of the waiver
 *
 * `structureProvenance` (`cee/graph-readiness/obligation-provenance.ts`) says, in
 * its own words, *"An option is user-stated when ANY of its stated effects is."*
 * So an option with NO values has no stated effects, falls to `unattributed`,
 * and its gaps are `offered` — waivable, and the model runs.
 *
 * **Supplying the FIRST value promotes the whole OPTION to `user_stated`, which
 * promotes every REMAINING gap on it from `offered` to `required`.** The user
 * answers one question and the other two turn into demands. That is the same
 * V-shape, one level up, and no waiver in `analysis-ready-core.ts` can reach it:
 * under the estate's single obligation authority those blockers really are
 * `required`.
 *
 * Whether "any effect" is the right promotion rule for a gap the user has NOT
 * touched is an architectural question about that authority, and it is not this
 * module's to answer unilaterally.
 *
 * ## Why an exact SET and not a count
 *
 * Pinned by membership so it REDs if the set GROWS (a regression) or SHRINKS (a
 * fix landed and this note is now stale). A count would hide a swap. Recorded
 * per CLAUDE.md trap 22f: a gap recorded in the suite is honest; a gap invisible
 * to it is how four rounds happen.
 */
const KNOWN_OPEN_USER_STATED_VIOLATIONS: readonly string[] = [
  '1+2+3:1,0,3->1,1,3',
  '1+2+3:1,2,0->1,2,1',
  '1+3+2+3:0,0,2,3->0,1,2,3',
  '1+3+2+3:0,3,0,3->0,3,1,3',
  '1+3+2+3:0,3,2,0->0,3,2,1',
  '1+3+2+3:1,0,0,3->1,0,1,3',
  '1+3+2+3:1,0,0,3->1,1,0,3',
  '1+3+2+3:1,0,2,0->1,0,2,1',
  '1+3+2+3:1,0,2,0->1,1,2,0',
  '1+3+2+3:1,0,2,3->1,1,2,3',
  '1+3+2+3:1,3,0,0->1,3,0,1',
  '1+3+2+3:1,3,0,0->1,3,1,0',
  '1+3+2+3:1,3,0,3->1,3,1,3',
  '1+3+2+3:1,3,2,0->1,3,2,1',
  '3+3+3:0,3,3->1,3,3',
  '3+3+3:3,0,3->3,1,3',
  '3+3+3:3,3,0->3,3,1',
];

/** Same corpus, but every value carries a declared USER provenance stamp. */
function buildUserStated(specs: readonly OptionSpec[]) {
  const options = specs.map((spec, i) => {
    const interventions: Record<string, unknown> = {};
    for (let f = 0; f < spec.valued; f += 1) {
      // `explicit` is a DECLARED member of the observed-state source vocabulary
      // (`obligation-provenance.ts`), which maps to `user_stated`. An undeclared
      // stamp parses as SCHEMA_INVALID — a different mechanism entirely, and the
      // reason an earlier attempt at this fixture was reported unbuildable.
      interventions[ALL_FACTORS[f]] = { value: 0.25 + f * 0.15 + i * 0.02, source: 'explicit' };
    }
    return {
      id: `opt${i}`, kind: 'option' as const, label: `Option ${i}`, demand: spec.demand,
      ...(spec.valued > 0 ? { interventions } : {}),
    };
  });
  return {
    version: '1',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Grow revenue without burning the team' },
      { id: 'decision', kind: 'decision', label: 'Which way forward' },
      ...ALL_FACTORS.map((f, i) => ({
        id: f, kind: 'factor', label: `Factor ${i}`, category: 'controllable',
        observed_state: { value: 0.4 + i * 0.1, cap: 1, source: 'explicit' },
      })),
      ...options.map(({ demand: _demand, ...node }) => node),
    ],
    edges: [
      ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
      ...options.flatMap((o) => ALL_FACTORS.slice(0, o.demand).map((f) => v3Edge(`ef_${o.id}_${f}`, o.id, f))),
      ...ALL_FACTORS.map((f, i) => v3Edge(`eg${i}`, f, 'goal')),
    ],
  };
}

describe('KNOWN-OPEN: monotonicity over user-authored structure', () => {
  const SHAPES_US: readonly number[][] = [[3, 3], [3, 3, 3], [1, 2, 3], [2, 2, 2, 2], [1, 3, 2, 3]];

  it('the open set is EXACTLY the recorded one — REDs if it grows OR shrinks', { timeout: 300_000 }, () => {
    const verdict = new Map<string, boolean>();
    const obligations = new Set<string>();
    for (const demands of SHAPES_US) {
      for (const state of enumerateStates(demands)) {
        const specs = demands.map((demand, i) => ({ demand, valued: state[i] }));
        const admission = resolveRunAdmission(buildUserStated(specs));
        verdict.set(`${demands.join('+')}:${state.join(',')}`, admission.willProceed);
        for (const issue of admission.assessment.blockingIssues ?? []) {
          if (issue.code === 'MISSING_OPTION_VALUE') obligations.add(String(issue.obligation));
        }
      }
    }
    // PRECONDITION: the fixture really does produce `required` obligations, or
    // this whole block is measuring the `offered` axis over again.
    expect(obligations.has('required')).toBe(true);

    const violations: string[] = [];
    for (const demands of SHAPES_US) {
      for (const state of enumerateStates(demands)) {
        for (let i = 0; i < state.length; i += 1) {
          if (state[i] >= demands[i]) continue;
          const next = [...state];
          next[i] += 1;
          const before = verdict.get(`${demands.join('+')}:${state.join(',')}`)!;
          const after = verdict.get(`${demands.join('+')}:${next.join(',')}`)!;
          if (before && !after) {
            violations.push(`${demands.join('+')}:${state.join(',')}->${next.join(',')}`);
          }
        }
      }
    }
    expect(violations.sort()).toEqual([...KNOWN_OPEN_USER_STATED_VIOLATIONS]);
  });

  /**
   * The mechanism itself, bound directly so it REDs if the promotion rule
   * changes even where the lattice membership happens to stay the same.
   */
  it('supplying the FIRST value promotes the option\'s remaining gaps to `required`', () => {
    const gaps = (valued: number) =>
      (resolveRunAdmission(
        buildUserStated([{ demand: 3, valued: 3 }, { demand: 3, valued: 3 }, { demand: 3, valued }]),
      ).assessment.blockingIssues ?? []).filter(
        (i) => i.code === 'MISSING_OPTION_VALUE' && i.option_id === 'opt2',
      );
    // No values: the option has no stated effect, so its gaps are only OFFERED.
    expect(gaps(0).every((i) => i.obligation === 'offered')).toBe(true);
    // One value: the SAME untouched gaps are now DEMANDED of the user.
    expect(gaps(1).length).toBeGreaterThan(0);
    expect(gaps(1).every((i) => i.obligation === 'required')).toBe(true);
  });
});

/**
 * ⭐⭐ WHAT THE LATTICE IS STRUCTURALLY BLIND TO — and the guard that covers the
 * most dangerous part of it.
 *
 * The monotonicity property observes ONE BOOLEAN per state. It therefore cannot
 * distinguish a fix from an over-admission: **monotonicity can be bought either
 * by removing a false demand or by waiving a real one, and only the first is a
 * fix.** The M5 mutant proved the method has this hole in the other direction —
 * tightening the two-option floor to `>` moved 111 of 409 verdicts and the
 * lattice stayed green, because refusing everything is perfectly monotone.
 *
 * So the lattice needs a companion that checks WHAT was admitted, not just that
 * the shape of the admitted set is monotone. The load-bearing safety property is
 * PLoT's, and it is exact: `/v2/run` declares `options.minItems: 2`
 * (`plot-lite-service/src/routes/v2/run.ts:1455`) and preflight raises
 * `EMPTY_INTERVENTIONS` for any option whose interventions map is empty
 * (`validation/preflight-v2.ts:184-187`). An admitted run that cannot satisfy
 * both is admitted straight into a refusal — the false-admission direction.
 *
 * ⚠ STILL BLIND, stated rather than implied: this pair says nothing about WHICH
 * options are ranked, about the honesty of the offer copy, about value MUTATION
 * (the lattice only ever ADDS), about non-`controllable` factors, about
 * repair-authored edges, about options with no factor edge at all, or about
 * topologies where options intervene on disjoint factor sets.
 */
describe('nothing is admitted that PLoT would refuse', () => {
  it('every ADMITTED state carries at least two options with non-empty interventions', { timeout: 300_000 }, () => {
    let admitted = 0;
    let blocked = 0;
    const unsafe: string[] = [];
    for (const shape of SHAPES) {
      for (const state of enumerateStates(shape.demands)) {
        const specs = specsFor(shape.demands, state, shape.baselineIndex);
        if (!analysable(specs)) { blocked += 1; continue; }
        admitted += 1;
        // The submitted set PLoT would receive: an option is submittable exactly
        // when its interventions are non-empty, which is PLoT's own predicate.
        const submittable = specs.filter((sp) => sp.valued > 0).length;
        if (submittable < 2) {
          unsafe.push(`${shape.name} [${state.join(',')}] admitted with ${submittable} submittable option(s)`);
        }
      }
    }
    // Discrimination: the corpus must contain both verdicts, or this is vacuous.
    expect(admitted).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    expect(unsafe).toEqual([]);
  });
});
