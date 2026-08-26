/**
 * RUN ADMISSION ↔ PLoT PREFLIGHT CONFORMANCE — the contract invariant.
 *
 * ## The invariant
 *
 *     RunAdmission.may_run === true
 *       ⟹ PLoT's compute path accepts the SAME SNAPSHOT
 *
 * "The same snapshot" is load-bearing and is NOT the graph handed to
 * `resolveRunAdmission`. It is what CEE actually sends: the admitted options
 * MINUS the ones the run excludes (`waivedOptionIds` / `plan.scaffolded_option_ids`).
 * An admission that waives an option is not claiming PLoT accepts that option —
 * it is claiming PLoT accepts what remains.
 *
 * ## ⭐ THE DEFECT THIS SPEC PINS (measured 2026-08-26, both tips, both sides run)
 *
 * CEE `d80e8133` · PLoT `3a3bee58`. A graph whose options are STRICTLY READY but
 * carry the SAME intervention map:
 *
 *   - CEE  `resolveRunAdmission(...)` → `willProceed: TRUE`, `waivedOptionIds: []`,
 *     assessment `status: "ready"`, `blockerCount: 0`.
 *   - PLoT `runPreflightValidation(...)` on that exact snapshot →
 *     `blockers: ["IDENTICAL_OPTIONS"]` → the run 422s a network hop away.
 *   - CONTRAST, same probe, distinct values → `blockers: []`. The measurement
 *     discriminates; it is not an instrument agreeing with itself.
 *
 * ⚠ THE CAUSE IS NOT FINGERPRINT DRIFT, AND A LANE LOOKING FOR DRIFT WILL MISS IT.
 * CEE's inline fingerprint and PLoT's `canonicaliseInterventions` AGREE — both
 * produced `"fac_velocity:0.5"` for both options in the probe. The distinct-map
 * floor is simply **unreachable on this path**: it lives inside the
 * `strict.status === 'unrecoverable'` waiver branch, and a strictly-ready graph
 * returns at `analysis-ready-core.ts:587-595` before ever reaching it.
 *
 * ## ⛔ DECLARED SCOPE — read this before extending the spec
 *
 * This pins the PREFLIGHT half only, and says so rather than implying more:
 *
 *  - **COVERED**: the 14 blocker codes emitted inside `runPreflightValidation`
 *    (`plot-lite-service` `src/validation/preflight-v2.ts:861`, staging `3a3bee58`).
 *  - **OUT OF SCOPE BY DESIGN**: `GRAPH_TOO_COMPLEX`. It is produced by
 *    `planSampleDepth` (`src/config/sampling.ts:970`) against a LIVE, VERSIONED
 *    `ISLComputeAdmission` ceiling. CEE holds no copy of that ceiling and MUST NOT
 *    acquire one — a CEE-side mirror of a ceiling that moves without telling us is
 *    the defect class this estate pays for most. So `may_run=true` followed by a
 *    `GRAPH_TOO_COMPLEX` refusal remains possible. That hole is REAL, it is
 *    user-facing (admitted-then-refused), and it is stated here rather than left
 *    as an absence — an unstated scope limit reads as coverage.
 *
 *    WHAT WOULD CLOSE IT, so the gap carries its own exit: PLoT — which already
 *    holds the live ceiling — answering a cheap pre-run admissibility question
 *    for a given node/edge count, and CEE gating on that ANSWER. The authority
 *    stays with the service that owns it and CEE stores no copy. CEE currently
 *    knows the NAME `GRAPH_TOO_COMPLEX` (18 references in `src/`) but holds
 *    nothing to predict it with: `ISLComputeAdmission`, `admission_ceiling`,
 *    `ADAPTIVE_N_SAMPLES_FLOOR` and `planSampleDepth` are all 0 references in
 *    CEE `src/` (contrast, same sweep: 3931 for `plot`).
 *  - **NOT COVERED, NOT BY DESIGN**: the 4 blocker-severity codes from
 *    `validateGoalConstraints`, and the 4 v2-run-path codes emitted OUTSIDE
 *    preflight (`GOAL_NODE_NOT_CAUSAL` at `routes/v2/run.ts:5519`; the three
 *    categorical codes via `validation/categorical-detector.ts`).
 *
 * ⚠ THIS SPEC CANNOT VERIFY ITSELF AGAINST PLoT. CEE cannot import
 * `plot-lite-service`, and `@talchain/schemas` carries NO blocker authority at any
 * version (0 blocker codes in `schemas/src`, contrast 273 `z.object`) — so the
 * PLoT-side expectations below were derived by RUNNING PLoT's real predicates at
 * `3a3bee58` and are recorded, not re-verified in CI. Re-derive at PLoT's tip
 * before trusting them; do not inherit.
 *
 * ⚠ `wouldPreflightPass` (`preflight-v2.ts:1060`) is NOT the oracle and must not
 * be used as one — it is a 4-check approximation of a 14-code validator.
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

const factorNode = (id: string) => ({
  id,
  kind: 'factor',
  label: `Factor ${id}`,
  category: 'controllable',
  observed_state: { value: 0.5, cap: 1 },
});

/** Exactly the factors the options intervene on — no dangling nodes. */
const baseNodes = (factorIds: string[]) => [
  { id: 'goal', kind: 'goal', label: 'Goal' },
  { id: 'decision', kind: 'decision', label: 'Hiring' },
  ...factorIds.map(factorNode),
];

const option = (id: string, label: string, interventions?: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  ...(interventions ? { interventions } : {}),
});

/** A strictly-ready graph whose options carry the intervention maps given. */
function graphWithMaps(maps: Array<Record<string, number>>) {
  const options = maps.map((m, i) => option(`opt_${i}`, `Option ${i}`, m));
  const factorIds = [...new Set(maps.flatMap((m) => Object.keys(m)))];
  return {
    version: '1',
    nodes: [...baseNodes(factorIds), ...options],
    edges: [
      ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
      // An option is linked to exactly the factors it actually intervenes on, so
      // the only thing varying across cases is the intervention MAP itself.
      ...options.flatMap((o, i) =>
        Object.keys(maps[i]).map((factorId) => v3Edge(`ef${i}_${factorId}`, o.id, factorId)),
      ),
      ...[...new Set(maps.flatMap((m) => Object.keys(m)))].map((factorId) =>
        v3Edge(`eg_${factorId}`, factorId, 'goal'),
      ),
    ],
  };
}

/**
 * The snapshot CEE would actually send: admitted options minus the excluded ones.
 * Bound by IDENTITY (option id), never by a value predicate another option could
 * satisfy.
 */
function submittedOptionIds(graph: unknown): string[] {
  const admission = resolveRunAdmission(graph);
  const waived = new Set<string>([
    ...admission.waivedOptionIds,
    ...admission.plan.scaffolded_option_ids,
  ]);
  const all = (admission.assessment.analysisReady?.options ?? []) as Array<{ option_id?: string }>;
  return all
    .map((o) => o.option_id)
    .filter((id): id is string => typeof id === 'string' && !waived.has(id));
}

describe('may_run=true ⟹ PLoT preflight accepts the submitted snapshot', () => {
  it('REFUSES two strictly-ready options carrying the SAME intervention map (PLoT: IDENTICAL_OPTIONS)', () => {
    const graph = graphWithMaps([{ fac_velocity: 0.5 }, { fac_velocity: 0.5 }]);
    const admission = resolveRunAdmission(graph);

    // Pin the PRECONDITION in-test, so this cannot pass by accident on a graph
    // that was refused for some unrelated reason: the two options must really be
    // strictly ready and really be fingerprint-identical.
    expect(admission.strict.status).not.toBe('unrecoverable');
    expect(admission.waivedOptionIds).toEqual([]);
    expect(submittedOptionIds(graph).sort()).toEqual(['opt_0', 'opt_1']);

    // PLoT `3a3bee58` on this exact snapshot: blockers = ["IDENTICAL_OPTIONS"].
    // Fewer than two DISTINCT maps survive deduplication, so the comparison the
    // run exists to make does not exist.
    expect(admission.willProceed).toBe(false);
  });

  it('CONTRAST — two DISTINCT maps are admitted (PLoT: blockers = [])', () => {
    const graph = graphWithMaps([{ fac_velocity: 0.3 }, { fac_velocity: 0.7 }]);
    const admission = resolveRunAdmission(graph);

    expect(admission.strict.status).not.toBe('unrecoverable');
    expect(admission.willProceed).toBe(true);
    expect(submittedOptionIds(graph).sort()).toEqual(['opt_0', 'opt_1']);
  });

  it('CONTRAST — three options collapsing to ONE distinct map are refused', () => {
    const graph = graphWithMaps([
      { fac_velocity: 0.5 },
      { fac_velocity: 0.5 },
      { fac_velocity: 0.5 },
    ]);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
  });

  it('CONTRAST — three options collapsing to TWO distinct maps are admitted', () => {
    const graph = graphWithMaps([
      { fac_velocity: 0.5 },
      { fac_velocity: 0.5 },
      { fac_velocity: 0.9 },
    ]);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
  });

  /**
   * ⭐⭐ MODE-INVARIANCE, ASSERTED STRUCTURALLY — NEVER BY SAMPLING MODES.
   *
   * The founder's invariant has a second conjunct: PLoT accepts the same snapshot
   * AND THE SAME COMPUTE MODE. Derived 2026-08-26, it costs nothing, because both
   * of PLoT's refusal gates are mode-invariant BY CONSTRUCTION:
   *
   *   1. `runPreflightValidation(graph, options, goalNodeId, stats)`
   *      (`preflight-v2.ts:861`) HAS NO MODE PARAMETER. It cannot read
   *      `detail_level`, `n_samples`, or any `include_*` flag — measured: 0
   *      references to all six in `preflight-v2.ts` and `identical-options.ts`,
   *      against same-file contrasts of 32 (`blockers`) and 31 (`option`).
   *   2. `planSampleDepth` (`config/sampling.ts:970`) refuses AT THE FLOOR — its
   *      own words, *"Even ADAPTIVE_N_SAMPLES_FLOOR samples exceed the budget"*.
   *      So a run refused at `quick` is refused at `deep`; asking for less cannot
   *      rescue it.
   *
   * Therefore `RunAdmission` does NOT need to carry compute mode, and no
   * cross-repo schema change is required. `@talchain/schemas` is untouched.
   *
   * ⚠ A SAMPLED PROOF WOULD DECAY THE DAY A MODE IS ADDED. This asserts the
   * ARITY instead: admission is a pure function of ONE argument, the snapshot. If
   * someone gives it a second parameter, this REDs — and that is precisely the
   * moment the invariant would stop holding for free.
   */
  it('admission is a pure function of the snapshot alone — no mode parameter', () => {
    expect(resolveRunAdmission.length).toBe(1);
    // And the returned admission exposes no compute-mode field to gate on.
    const admission = resolveRunAdmission(
      graphWithMaps([{ fac_velocity: 0.3 }, { fac_velocity: 0.7 }]),
    );
    expect(Object.keys(admission)).not.toContain('compute_mode');
    expect(Object.keys(admission)).not.toContain('computeMode');
  });

  it('multi-factor maps differing in ONE factor are distinct (order-independent)', () => {
    const graph = graphWithMaps([
      { fac_velocity: 0.5, fac_b: 0.2 },
      { fac_velocity: 0.5, fac_b: 0.4 },
    ]);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
  });
});
