/**
 * C1 "why it moved" — seed reuse on a rerun of the same DRAW STRUCTURE (design programme-docs
 * `c1-why-it-moved/C1-DESIGN.md`; science R3 #75 5920656318 S1–S4 + ruling 5920859011; lease 5920739086).
 *
 * Rows (R3's, one each):
 *   R-a  a link mean +0.4 → +0.6 (same side), same id sets → same draw structure → the seed is reused → C1.
 *   R-b  a link mean +0.4 → 0 → a draw-structure change → no reuse, and C2 even on an equal seed.
 *   R-c  a pinning change (an option newly sets a factor) → a draw-structure change → C2.
 *   R-d  (the identity row) lives in the handler file: same graph, reused seed → the same seed reaches PLoT.
 * Plus: an `exists_probability` change shifts ISL's draws (Bernoulli then a conditional Normal, ISL
 * `robustness_analyzer_v2.py:1027-1037`) → C2 even though the derived seed never moved (today's mislabel); a value
 * crossing 0 → C2; a legacy pair (no recorded inputs) keeps exactly today's classification.
 */
import { describe, expect, it } from 'vitest';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

import { buildRunDelta } from '../build-run-delta.js';
import { drawStructureKey, islDrawStructureKey } from '../draw-structure.js';
import { decideSeedReuse, priorRunForSeed } from '../seed-reuse.js';

const snap = (edit: (s: RunInputSnapshot) => void = () => {}): RunInputSnapshot => {
  const s: RunInputSnapshot = {
    snapshot_version: 1,
    sent_digest: 'a'.repeat(64),
    goal: { node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 55000, unit: 'GBP per month', operator: '>=' },
    options: [
      { option_id: 'opt-a', label: 'Raise price', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 59, unit: 'GBP', encoded: 59 }] },
      { option_id: 'opt-b', label: 'Hold', is_baseline: true,
        settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
    ],
    options_not_sent: [],
    factors: [{ factor_id: 'fac_churn', label: 'Monthly churn', raw: 3.7, unit: '%', encoded: 0.037, source: 'user_override' }],
    constraints: [],
    links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.4, exists_probability: 0.8 }],
  } as unknown as RunInputSnapshot;
  edit(s);
  return s;
};
type Mut = Record<string, any>;
const link = (s: RunInputSnapshot) => ((s as unknown as Mut).links as Mut[])[0]!;
const churn = (s: RunInputSnapshot) => ((s as unknown as Mut).factors as Mut[])[0]!;

/** PLoT's recorded ISL request (the served shape of `enrichment._meta.payloads.isl_request`), with one edit applied. */
const isl = (edit: (r: Mut) => void = () => {}): Mut => {
  const r: Mut = {
    seed: '777', n_samples: 10_000, analysis_types: ['comparison', 'sensitivity', 'robustness'], include_voi: true, include_e_values: true,
    graph: {
      nodes: [
        { id: 'fac_price', kind: 'factor', epsilon_std: 0 }, { id: 'fac_churn', kind: 'factor', epsilon_std: 0 },
        { id: 'fac_ads', kind: 'factor', epsilon_std: 0 }, { id: 'goal_mrr', kind: 'goal', epsilon_std: 0 },
      ],
      edges: [{ from: 'fac_price', to: 'fac_churn', exists_probability: 0.8, strength: { mean: 0.4, std: 0.1 } }],
    },
    options: [{ id: 'opt-a', interventions: { fac_price: 0.59 } }, { id: 'opt-b', interventions: { fac_price: 0.49 } }],
    parameter_uncertainties: [{ node_id: 'fac_churn', distribution: 'normal', std: 0.01 }],
  };
  edit(r);
  return r;
};

function fact(o: { seed: string; hash: string; at: string; runId: string; snapshot?: RunInputSnapshot; islRequest?: Mut | null; underscoreMeta?: Mut }): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: [
          { option_id: 'opt-a', option_label: 'Raise price', win_probability: 0.45 },
          { option_id: 'opt-b', option_label: 'Hold', win_probability: 0.55 },
        ],
        meta: { seed_used: o.seed, n_samples: 10_000 },
        _meta: o.underscoreMeta ?? { builds: { plot: 'p1', isl: 'i1' }, ...(o.islRequest === null ? {} : { payloads: { isl_request: o.islRequest ?? isl() } }) },
      },
      computed_at: o.at,
      graph_hash_at_run: o.hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      run_id: o.runId,
      ...(o.snapshot !== undefined ? { input_snapshot: o.snapshot } : {}),
    },
  } as unknown as HandlerFact;
}
const A_AT = '2026-09-30T22:00:00.000Z';
const B_AT = '2026-09-30T22:05:00.000Z';
const caseOf = (prior: HandlerFact, current: HandlerFact) => {
  const built = buildRunDelta({ priorFacts: [prior, current], mayNameLeadingOption: true });
  expect(built.kind, JSON.stringify(built)).toBe('ok');
  const delta = (built as { delta: Mut }).delta;
  expect(RunDeltaSchema.safeParse(delta).success, 'the emitted block parses under the vendored contract').toBe(true);
  return delta.attribution_case as string;
};

describe('draw-structure key — what lines two Runs\' draws up (R3 5920859011)', () => {
  const base = drawStructureKey(snap());
  it('a value edit off 0 (churn 3.7 → 4.2 %) is NOT a structure change — that is the edit C1 attributes', () => {
    expect(drawStructureKey(snap((s) => { churn(s).raw = 4.2; churn(s).encoded = 0.042; }))).toBe(base);
  });
  it('R-a: a link mean +0.4 → +0.6 is not a structure change', () => {
    expect(drawStructureKey(snap((s) => { link(s).mean = 0.6; }))).toBe(base);
  });
  it('R-b: a link mean +0.4 → 0 IS a structure change', () => {
    expect(drawStructureKey(snap((s) => { link(s).mean = 0; }))).not.toBe(base);
  });
  it('R-c: a pinning change (Hold newly sets churn) IS a structure change', () => {
    expect(drawStructureKey(snap((s) => {
      ((s as unknown as Mut).options as Mut[])[1]!.settings.push({ factor_id: 'fac_churn', raw: 3.7, unit: '%', encoded: 0.037 });
    }))).not.toBe(base);
  });
  it('an exists_probability change (0.8 → 0.9) IS a structure change — which samples draw a strength moves', () => {
    expect(drawStructureKey(snap((s) => { link(s).exists_probability = 0.9; }))).not.toBe(base);
  });
  it('a factor value crossing 0 IS a structure change (point_mass draws nothing)', () => {
    expect(drawStructureKey(snap((s) => { churn(s).raw = 0; churn(s).encoded = 0; }))).not.toBe(base);
  });
  it('a stated range on a setting (added, or its bounds moved) IS a structure change — its draws are not verified here', () => {
    const withRange = (low: number, high: number) => snap((s) => {
      ((s as unknown as Mut).options as Mut[])[0]!.settings[0].range = { low, high, meaning: 'likely_range', source: 'user_stated' };
    });
    expect(drawStructureKey(withRange(50, 70))).not.toBe(base);
    expect(drawStructureKey(withRange(50, 80))).not.toBe(drawStructureKey(withRange(50, 70)));
    expect(drawStructureKey(withRange(50, 70)), 'CONTROL: the same range twice is the same structure').toBe(drawStructureKey(withRange(50, 70)));
  });
  it('ORDER IS STRUCTURE: the same links in another order ARE a structure change (ISL draws in list order)', () => {
    const twoLinks = (reverse: boolean) => snap((s) => {
      const links = [...((s as unknown as Mut).links as Mut[]), { from: 'fac_churn', to: 'goal_mrr', mean: -0.3, exists_probability: 1 }];
      (s as unknown as Mut).links = reverse ? links.reverse() : links;
    });
    expect(drawStructureKey(twoLinks(true))).not.toBe(drawStructureKey(twoLinks(false)));
    expect(drawStructureKey(twoLinks(false)), 'CONTROL: the identical input twice is the same structure').toBe(drawStructureKey(twoLinks(false)));
  });
});

describe('the seed decision', () => {
  const prior = { seedUsed: '1234567', structureKey: drawStructureKey(snap()) };
  it('same draw structure → the prior Run\'s own echo, verbatim', () => {
    expect(decideSeedReuse({ prior, current: snap((s) => { link(s).mean = 0.6; }), explicitSeed: undefined }))
      .toEqual({ seed: '1234567', reason: 'reused' });
  });
  it('structure changed → no seed (PLoT derives one, as today)', () => {
    expect(decideSeedReuse({ prior, current: snap((s) => { link(s).exists_probability = 0.9; }), explicitSeed: undefined }))
      .toEqual({ reason: 'structure_changed' });
  });
  it('an explicit seed is never overridden; no binding / no prior / legacy prior / unrecorded current → no seed', () => {
    expect(decideSeedReuse({ prior, current: snap(), explicitSeed: 9 })).toEqual({ reason: 'explicit_seed' });
    expect(decideSeedReuse({ prior: undefined, current: snap(), explicitSeed: undefined })).toEqual({ reason: 'no_prior_run' });
    expect(decideSeedReuse({ prior: 'prior_not_recorded', current: snap(), explicitSeed: undefined })).toEqual({ reason: 'prior_not_recorded' });
    expect(decideSeedReuse({ prior, current: null, explicitSeed: undefined })).toEqual({ reason: 'current_not_recorded' });
  });
});

describe('the Run that lends its seed is the Run the next pair compares against', () => {
  it('the newest successful Run, read by the same echo reader seed_equal compares', () => {
    const older = fact({ seed: '111', hash: 'h1', at: A_AT, runId: 'r1', snapshot: snap() });
    const newer = fact({ seed: '222', hash: 'h2', at: B_AT, runId: 'r2', snapshot: snap() });
    expect(priorRunForSeed([newer, older])).toEqual({ seedUsed: '222', structureKey: drawStructureKey(snap()) });
  });
  it('a legacy newest Run (no recorded inputs) lends nothing; no Run at all → no_prior_run', () => {
    expect(priorRunForSeed([fact({ seed: '111', hash: 'h1', at: A_AT, runId: 'r1' })])).toBe('prior_not_recorded');
    expect(priorRunForSeed([])).toBe('no_prior_run');
  });
});

describe('the classifier: C1 only when both Runs\' RECORDED ISL requests show the same draw structure', () => {
  const pair = (prior: Mut | null, current: Mut | null, snapshots = true, hashes: [string, string] = ['h1', 'h2']) => caseOf(
    fact({ seed: '777', hash: hashes[0], at: A_AT, runId: 'r1', ...(snapshots ? { snapshot: snap() } : {}), islRequest: prior }),
    fact({ seed: '777', hash: hashes[1], at: B_AT, runId: 'r2', ...(snapshots ? { snapshot: snap() } : {}), islRequest: current }),
  );
  it('R-a: equal (reused) seed, a same-side mean edit → C1_attributable', () => {
    expect(pair(isl(), isl((r) => { r.graph.edges[0].strength.mean = 0.6; }))).toBe('C1_attributable');
  });
  it('CR 5921519604: a prior added to a factor with no observed value (PLoT adds a uniform draw) → C2_unpaired', () => {
    expect(pair(isl(), isl((r) => { r.parameter_uncertainties.push({ node_id: 'fac_ads', distribution: 'uniform', range_min: 0.02, range_max: 0.04 }); })))
      .toBe('C2_unpaired');
  });
  it('CONTROL: the same prior on both Runs, only its bounds moved → C1 (a uniform draw either way)', () => {
    const withPrior = (hi: number) => isl((r) => { r.parameter_uncertainties.push({ node_id: 'fac_ads', distribution: 'uniform', range_min: 0.02, range_max: hi }); });
    expect(pair(withPrior(0.04), withPrior(0.06))).toBe('C1_attributable');
  });
  it('a distribution change (normal → point_mass, a value crossing 0) → C2', () => {
    expect(pair(isl(), isl((r) => { r.parameter_uncertainties[0] = { node_id: 'fac_churn', distribution: 'point_mass' }; }))).toBe('C2_unpaired');
  });
  it('an exists_probability edit with an EQUAL seed → C2 (the draws no longer line up)', () => {
    expect(pair(isl(), isl((r) => { r.graph.edges[0].exists_probability = 0.9; }))).toBe('C2_unpaired');
  });
  it('R-b: a link mean to 0 → C2', () => {
    expect(pair(isl(), isl((r) => { r.graph.edges[0].strength.mean = 0; }))).toBe('C2_unpaired');
  });
  it('FAIL CLOSED: a Run with no recorded ISL request cannot show its draws line up → C2, never C1', () => {
    expect(pair(isl(), null)).toBe('C2_unpaired');
    expect(pair(null, isl())).toBe('C2_unpaired');
  });
  it('a legacy pair (no input_snapshot) is judged on the same recorded requests: equal → C1, a p edit → C2 (AIQ 5921107442)', () => {
    expect(pair(isl(), isl((r) => { r.graph.edges[0].strength.mean = 0.6; }), false)).toBe('C1_attributable');
    expect(pair(isl(), isl((r) => { r.graph.edges[0].exists_probability = 0.9; }), false)).toBe('C2_unpaired');
  });
  it('CONTROL: C0 is not downgraded — an equal analysis hash on an equal build is identical, recorded request or not', () => {
    expect(pair(null, null, true, ['h1', 'h1'])).toBe('C0_identical');
  });
  it('the ISL key keeps LIST ORDER and ignores the seed and non-structural values', () => {
    expect(islDrawStructureKey(isl((r) => { r.seed = '999'; r.options[0].interventions.fac_price = 0.6; }))).toBe(islDrawStructureKey(isl()));
    expect(islDrawStructureKey(isl((r) => { r.graph.nodes.reverse(); }))).not.toBe(islDrawStructureKey(isl()));
    expect(islDrawStructureKey({ graph: {} })).toBeNull();
  });
});

/**
 * 52f8cd adopting #2410 (DL 5934109147).
 *   · P1 (AI EXPERIENCE BUILD CR 5922160590): a KNOWN draw-structure mismatch is an observed divergence. It outranks C0
 *     as well as C1, because an equal analysis hash (which sorts nodes and edges) does not imply an identical,
 *     list-ordered ISL request.
 *   · SCIENCE/DSK 5934059958: adding a link with the SAME seed shifts every later ISL draw → never C1.
 *   · Builds from PLoT's always-on `_meta.evidence` when `_meta.builds` is absent (staging: `UI_CANONICAL_META` off).
 */
describe('#2410 adopted: a known draw mismatch outranks C0; add-a-link is unpaired; builds from _meta.evidence', () => {
  const pairWith = (prior: Mut | null, current: Mut | null, hashes: [string, string] = ['h1', 'h2']) => caseOf(
    fact({ seed: '777', hash: hashes[0], at: A_AT, runId: 'r1', snapshot: snap(), islRequest: prior }),
    fact({ seed: '777', hash: hashes[1], at: B_AT, runId: 'r2', snapshot: snap(), islRequest: current }),
  );

  it('PRECONDITION: reversing the stochastic node list changes the recorded draw structure', () => {
    expect(islDrawStructureKey(isl((r) => { r.graph.nodes.reverse(); }))).not.toBe(islDrawStructureKey(isl()));
  });

  it('RED (P1): equal analysis hashes, equal seed and builds, but the recorded node ORDER differs → C2_unpaired, never C0', () => {
    expect(pairWith(isl(), isl((r) => { r.graph.nodes.reverse(); }), ['h1', 'h1'])).toBe('C2_unpaired');
  });

  it('CONTROL (P1): equal hashes AND the same recorded request → C0_identical', () => {
    expect(pairWith(isl(), isl(), ['h1', 'h1'])).toBe('C0_identical');
  });

  it('SCIENCE/DSK row (already held by #2410): ADD a link with the SAME seed → C2_unpaired, never C1', () => {
    expect(pairWith(isl(), isl((r) => { r.graph.edges.push({ from: 'fac_ads', to: 'goal_mrr', exists_probability: 1, strength: { mean: 0.2, std: 0.1 } }); })))
      .toBe('C2_unpaired');
  });

  it('CONTROL (SCIENCE/DSK): a strength-MEAN-only edit with the same seed → C1_attributable', () => {
    expect(pairWith(isl(), isl((r) => { r.graph.edges[0].strength.mean = 0.6; }))).toBe('C1_attributable');
  });

  const evidenceOnly = (islRequest: Mut, plot: unknown, islBuild: unknown): Mut => ({ evidence: { plot_build: plot, isl_build: islBuild }, payloads: { isl_request: islRequest } });
  const viaEvidence = (prior: Mut, current: Mut) => caseOf(
    fact({ seed: '777', hash: 'h1', at: A_AT, runId: 'r1', snapshot: snap(), underscoreMeta: prior }),
    fact({ seed: '777', hash: 'h2', at: B_AT, runId: 'r2', snapshot: snap(), underscoreMeta: current }),
  );
  const edited = isl((r) => { r.graph.edges[0].strength.mean = 0.6; });

  it('RED (builds, no flag): `_meta.builds` absent, equal PLoT + ISL builds on `_meta.evidence` → C1_attributable', () => {
    expect(viaEvidence(evidenceOnly(isl(), '2f2427f', '04836e2'), evidenceOnly(edited, '2f2427f', '04836e2'))).toBe('C1_attributable');
  });

  it('CONTROL: a different ISL build on `_meta.evidence` → C3_engine_drift', () => {
    expect(viaEvidence(evidenceOnly(isl(), '2f2427f', '04836e2'), evidenceOnly(edited, '2f2427f', 'ffffff0'))).toBe('C3_engine_drift');
  });

  it('CONTROL: PLoT\'s literal "unknown", or no ISL build, never makes two Runs look equal → no C1', () => {
    for (const [plot, islBuild] of [['unknown', '04836e2'], ['2f2427f', null], ['unknown', 'unknown']] as const) {
      const built = buildRunDelta({ priorFacts: [
        fact({ seed: '777', hash: 'h1', at: A_AT, runId: 'r1', snapshot: snap(), underscoreMeta: evidenceOnly(isl(), plot, islBuild) }),
        fact({ seed: '777', hash: 'h2', at: B_AT, runId: 'r2', snapshot: snap(), underscoreMeta: evidenceOnly(edited, plot, islBuild) }),
      ], mayNameLeadingOption: true });
      expect(built.kind === 'ok' ? (built as { delta: Mut }).delta.attribution_case : built.kind, `${plot}/${islBuild}`).not.toBe('C1_attributable');
    }
  });
});

