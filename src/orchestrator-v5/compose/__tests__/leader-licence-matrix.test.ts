/**
 * ⭐ THE ONE LEADER-PERMISSION MATRIX (P0 SHARED DATA, #85 5963281356; DL ruling via PTL 5963175273 §3).
 * Matrix: programme-docs `output/p0-shared-data/AUDIT.md` §1b. One row per admission cell × claim (A = `leader_claim.
 * permitted`, the composed entitled ∧ separated verdict), both directions, through the ONE entry point
 * `leaderLicenceFromState`, plus the Agent wrapper `claimPermissionsFrom` pinned to it.
 *
 * Admissions are the PRODUCER's (`buildCanonicalAnalysisReadyFromGraph`) over served / fixture graphs wherever the
 * producer mints the cell from a graph in this repo; M4 (refused-but-safe `exploratory`) is the one `deriveMode` cell
 * no fixture graph reaches, so it is written as `analysisAdmissionFrom` mints it.
 *
 * RE-PINNED, RT-10 B′ R2 (Science #87 5999608477; DL e8 CONFIRMED): M3's served cold graph was `exploratory` ONLY through
 * the untestable-target cap, which R2 retired; the producer now mints it `quantified_provisional` (the target withholds
 * only the claims against it, in the Run). No producer path mints an analysable `exploratory` any more (`deriveMode`:
 * proceed → comparative_leader | quantified_provisional), so that cell's rule stays pinned on `M3_projection`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { leaderLicenceFromState, type LeaderLicence } from '../leader-licence.js';
import { claimPermissionsFrom } from '../../agent-lane/first-analysis.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { BLOCKED_GRAPH } from '../../agent-lane/__tests__/fixtures/first-analysis-graphs.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../agent-lane/__tests__/fixtures/${name}`, import.meta.url)), 'utf8'));
const m1 = fixture('m1-s1-served-graphs.json') as { cases: { graph: unknown }[] };
const admissionOf = (ready: unknown) => (ready as { analysis_admission?: { structurally_analysable?: unknown; permitted_analysis_mode?: unknown } }).analysis_admission;

/**
 * C1 (#2678, founder trace Q4): admission now caps at `quantified_provisional` while `unsizedLeaderGoalPaths` is non-empty,
 * the same walk the post-Run licence withholds on. The served M1 graph reaches its goal through Olumi-sized links, so the
 * comparative_leader cell is that SAME served graph with every link user-sized; `M1_unsized` pins the served graph as is.
 */
const userSized = (graph: unknown): unknown => {
  const g = structuredClone(graph) as { edges?: Array<Record<string, unknown>> };
  for (const e of g.edges ?? []) {
    const p = (e.provenance !== null && typeof e.provenance === 'object' ? e.provenance : {}) as Record<string, unknown>;
    e.provenance = { ...p, magnitude: 'user_stated' };
  }
  return g;
};

const CELLS = {
  M1: buildCanonicalAnalysisReadyFromGraph(userSized(m1.cases[0]!.graph)),
  M1_unsized: buildCanonicalAnalysisReadyFromGraph(m1.cases[0]!.graph),
  M2: buildCanonicalAnalysisReadyFromGraph(m1.cases[1]!.graph),
  M3: buildCanonicalAnalysisReadyFromGraph((fixture('served-799d1a5d-cold-s1-graph.json') as { graph: unknown }).graph),
  M4: { status: 'blocked', may_run: false, analysis_admission: { structurally_analysable: false, permitted_analysis_mode: 'exploratory', missing_important_inputs: [], semantic_quality_sufficient: false, reasons: [] } },
  M5: buildCanonicalAnalysisReadyFromGraph(BLOCKED_GRAPH),
  M6_absent: { status: 'ready', may_run: true },
  M6_malformed: { status: 'ready', may_run: true, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'leader_please' } },
  M6_no_ready: undefined,
  /** The `/graph` read's top-level projection spells the run-axis flag `admitted` (`analysis-admission-projection.ts`). */
  M1_projection: { analysis_admission: { admitted: true, permitted_analysis_mode: 'comparative_leader', semantic_quality_sufficient: true } },
  M2_projection: { analysis_admission: { admitted: true, permitted_analysis_mode: 'quantified_provisional' } },
  M3_projection: { analysis_admission: { admitted: true, permitted_analysis_mode: 'exploratory' } },
  M5_admitted_none: { analysis_admission: { admitted: true, permitted_analysis_mode: 'none' } },
  M6_projection_malformed: { analysis_admission: { admitted: true, permitted_analysis_mode: 'leader_please' } },
  M6_projection_non_boolean: { analysis_admission: { admitted: 'true', permitted_analysis_mode: 'comparative_leader' } },
  M6_canonical_false_precedes_alias: { analysis_admission: { structurally_analysable: false, admitted: true, permitted_analysis_mode: 'comparative_leader' } },
  M6_canonical_undefined_precedes_alias: { analysis_admission: { structurally_analysable: undefined, admitted: true, permitted_analysis_mode: 'comparative_leader' } },
  M5_projection: { analysis_admission: { admitted: false, permitted_analysis_mode: 'none', semantic_quality_sufficient: false } },
} as const;

const current = { run_state: { kind: 'complete_current', computed_at: '2026-10-03T00:00:00.000Z' } };
const A_TRUE = { ...current, leader_claim: { permitted: true, separation: 'separated' } };
const A_FALSE = [
  ['near tie', { ...current, leader_claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } }],
  ['every option likely breaks a limit', { ...current, leader_claim: { permitted: false, withheld_reason: 'every_option_likely_breaks_limit', separation: 'separated' } }],
  ['no claim at all', current],
] as const;

describe('PRECONDITION: each cell is the admission it is named for', () => {
  it.each([
    ['M1', true, 'comparative_leader'],
    ['M1_unsized', true, 'quantified_provisional'],
    ['M2', true, 'quantified_provisional'],
    ['M3', true, 'quantified_provisional'],
    ['M4', false, 'exploratory'],
    ['M5', false, 'none'],
  ] as const)('%s → structurally_analysable %s, mode %s', (cell, analysable, mode) => {
    expect(admissionOf(CELLS[cell])).toMatchObject({ structurally_analysable: analysable, permitted_analysis_mode: mode });
  });
});

const EXPECTED_WHEN_A_TRUE: Record<keyof typeof CELLS, LeaderLicence> = {
  M1: 'permitted',
  M1_unsized: 'permitted_with_caveat',
  M2: 'permitted_with_caveat',
  M3: 'permitted_with_caveat',
  M4: 'withheld',
  M5: 'withheld',
  M6_absent: 'withheld',
  M6_malformed: 'withheld',
  M6_no_ready: 'withheld',
  M1_projection: 'permitted',
  M2_projection: 'permitted_with_caveat',
  M3_projection: 'withheld',
  M5_admitted_none: 'withheld',
  M6_projection_malformed: 'withheld',
  M6_projection_non_boolean: 'withheld',
  M6_canonical_false_precedes_alias: 'withheld',
  M6_canonical_undefined_precedes_alias: 'withheld',
  M5_projection: 'withheld',
};

describe('RED: the matrix through the ONE entry point (A = true: entitled, separated)', () => {
  it.each(Object.entries(EXPECTED_WHEN_A_TRUE))('%s → %s', (cell, licence) => {
    expect(leaderLicenceFromState(A_TRUE, CELLS[cell as keyof typeof CELLS])).toBe(licence);
  });
});

describe('CONTROL: A = false withholds in every cell', () => {
  for (const [why, state] of A_FALSE) {
    it.each(Object.keys(CELLS))(`${why} × %s → withheld`, (cell) => {
      expect(leaderLicenceFromState(state, CELLS[cell as keyof typeof CELLS])).toBe('withheld');
    });
  }
});

describe('RED: the Agent wrapper is a pure function of the licence (one answer, two spellings retired)', () => {
  const states = [A_TRUE, ...A_FALSE.map(([, s]) => s)];
  it.each(Object.keys(CELLS))('%s: leader_may_be_named ⇔ licence permitted, or caveated on a requested Run', (cell) => {
    for (const state of states) {
      const ready = CELLS[cell as keyof typeof CELLS];
      const licence = leaderLicenceFromState(state, ready);
      expect(claimPermissionsFrom(state, ready, { requested: true }).leader_may_be_named).toBe(licence !== 'withheld');
      expect(claimPermissionsFrom(state, ready).leader_may_be_named).toBe(licence === 'permitted');
    }
  });
});

it('a separated provisional caveat cannot override an unresolved scope restriction', () => {
  const state = { ...A_TRUE, leader_claim: { ...A_TRUE.leader_claim, withheld_reason: 'goal_scope_unresolved' } };
  expect(leaderLicenceFromState(state, CELLS.M2_projection)).toBe('withheld');
  expect(claimPermissionsFrom(state, CELLS.M2_projection, { requested: true })).toMatchObject({
    leader_may_be_named: false, total_goal_claims_allowed: false, exploratory_work_allowed: true,
  });
});
