/**
 * RT-10 B′ follow-through, Science R2 (#87 5999608477; DL e8 CONFIRMED): stating a target never removes a finding the
 * Run shows without one.
 *
 * The served journey (red team #87 5999041843, guest 078e521e, CEE 7b1d8414): the user followed Olumi's own correction,
 * set the goal's target to "at most 400" and re-ran, and every option's win share, the leader and the brief went —
 * "This run doesn't show how often each option reaches the goal's target". The target cannot be TESTED (no level today,
 * P1; links not sized in the goal's unit, P5), but the ORDERING needs neither: the shared offset cancels on each draw.
 *
 * Fixture: the red team's wire, verbatim. `graph_with_target` is the post-edit graph (`<=` 400 row, held `<=`, no
 * baseline); `plot_envelope` is a real PLoT envelope from the same scenario carrying every option's share. Rows bind by
 * option id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withholdGoalFiguresForUntestableTarget } from '../run-analysis.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { analysisAdmissionFrom } from '../../../admission/analysis-admission.js';
import { resolveRunAdmission } from '../analysis-ready-core.js';

type Rec = Record<string, unknown>;
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Rec; graph_with_target: Rec; plot_envelope: Rec;
};
const rows = (env: Rec): Rec[] => env.option_comparison as Rec[];
const byId = (env: Rec): Map<string, Rec> => new Map(rows(env).map((r) => [r.option_id as string, r]));

/** The served envelope, with a goal chance on every row so the target-relative claim has something to withhold. */
const envelopeWithGoalChance = (): Rec => {
  const env = structuredClone(FIXTURE.plot_envelope);
  for (const r of rows(env)) { r.probability_of_goal = 0.3; r.probability_of_joint_goal = 0.2; }
  return env;
};

describe('B′ R2 — "at most" keeps the comparison (the served rt10b journey)', () => {
  it('precondition: the post-edit graph is not_testable on P1 AND P5, and the pre-edit graph has no target', () => {
    const verdict = targetTestabilityOf(FIXTURE.graph_with_target);
    expect(verdict.kind).toBe('not_testable');
    const preconditions = verdict.kind === 'not_testable' ? verdict.failures.map((f) => f.precondition) : [];
    expect(preconditions).toEqual(expect.arrayContaining(['P1', 'P5']));
    expect(targetTestabilityOf(FIXTURE.graph_without_target).kind).toBe('no_target');
  });

  it('row 1: every option keeps its own win share; the leader and the brief stay', () => {
    const before = envelopeWithGoalChance();
    const after = withholdGoalFiguresForUntestableTarget(structuredClone(before), FIXTURE.graph_with_target) as Rec;
    const shares = byId(after);
    expect(shares.size).toBe(4);
    for (const [id, row] of byId(before)) {
      expect(shares.get(id)?.win_probability, id).toBe(row.win_probability);
    }
    const brief = after.decision_brief as Rec;
    expect((brief.analysis_summary as Rec).leading_option).toBe('More Reliable Courier');
    expect(brief.headline).toBe((FIXTURE.plot_envelope.decision_brief as Rec).headline);
    expect(after.flip_thresholds).toEqual(FIXTURE.plot_envelope.flip_thresholds);
  });

  it('row 1: only the claims AGAINST the target go — the goal chance, the joint, and (P1/P5) the outcome', () => {
    const after = withholdGoalFiguresForUntestableTarget(envelopeWithGoalChance(), FIXTURE.graph_with_target) as Rec;
    for (const row of rows(after)) {
      expect(row).not.toHaveProperty('probability_of_goal');
      expect(row).not.toHaveProperty('probability_of_joint_goal');
      expect(row.outcome).not.toHaveProperty('mean');
      expect(row.outcome).not.toHaveProperty('p50');
    }
    const warning = (after.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    expect(warning?.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'outcome']);
    expect(warning).not.toHaveProperty('win_shares_withheld');
  });

  it('row 2 (monotonicity): the admission permits the same analysis mode with the target as without it', () => {
    const withTarget = analysisAdmissionFrom(resolveRunAdmission(FIXTURE.graph_with_target), FIXTURE.graph_with_target);
    const withoutTarget = analysisAdmissionFrom(resolveRunAdmission(FIXTURE.graph_without_target), FIXTURE.graph_without_target);
    expect(withTarget.permitted_analysis_mode).toBe(withoutTarget.permitted_analysis_mode);
    expect(withTarget.permitted_analysis_mode).not.toBe('exploratory');
  });
});
