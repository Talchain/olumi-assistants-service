/**
 * ⛔ ABSENT STAYS ABSENT (AIQ 5886457733; DL 5886379820; R3-B's census 5886351619). Step 1 of 3: CEE first, then
 * PLoT #417 withholds the goal's per-option win % / means on #416's predicate, then the UI drops its fallbacks.
 *
 * `compactAnalysis` turned a missing win % or mean into 0 and `deriveWinner` then crowned the lowest option id "at 0%"
 * — a claim manufactured from absence. The rule, in every CEE reader: an absent figure is never 0 and never ranks; no
 * leader is derived from absent figures; the run's typed reason (#416's `GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED`)
 * travels instead.
 *
 * Corpus: AI Quality's served witness of PLoT #416 on `261d8c2` (case U, the cloud graph), kept as served. The #417
 * shape is that response with the figures #417 withholds removed (win %, outcome mean/std/p10/p50/p90, downside; the
 * sample counts stay; `decision_brief.options` empties).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compactAnalysis } from '../../../orchestrator/context/analysis-compact.js';
import { winnerOptionResultSource } from '../../../orchestrator/context/option-result-source.js';
import { detectGoalAttainmentContradiction, readObjectiveOptionViews } from '../../coaching/objective-contradiction.js';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-w416-cloud-U-261d8c2.json', import.meta.url), 'utf8')) as { U: Json };
const SERVED = FX.U; // #416 served: P(goal) withheld, win % and means still present, the typed warning carried
const CODE = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';
const REASON = "'Monthly cloud cost savings' depends on GCP workload share × GCP unit-cost saving × AWS workload spend, but this "
  + "run couldn't calculate it that way, so the figures for each option would be wrong.";

/** The #417 shape: the goal's per-option figures withheld on every option, the sample counts kept. */
function withheld417(r: Json = SERVED): Json {
  const x = structuredClone(r);
  for (const o of x.option_comparison as Json[]) {
    delete o.win_probability; delete o.downside;
    for (const k of ['mean', 'std', 'p10', 'p50', 'p90']) delete o.outcome[k];
  }
  x.decision_brief = { ...x.decision_brief, options: [] };
  return x;
}
const withoutWarning = (r: Json): Json => ({ ...r, inference_warnings: (r.inference_warnings as Json[]).filter((w) => w.code !== CODE) });

describe('compactAnalysis — an absent figure is never 0 and never crowned', () => {
  it('precondition: the served corpus carries #416\'s typed warning and every option\'s win % (the #416-only window)', () => {
    expect((SERVED.inference_warnings as Json[]).map((w) => w.code)).toContain(CODE);
    expect((SERVED.option_comparison as Json[]).every((o) => typeof o.win_probability === 'number')).toBe(true);
  });

  it('RED (#417 shape): every option\'s win % and mean are ABSENT (null), never 0; no winner; no margin', () => {
    const s = compactAnalysis(withheld417() as never)!;
    expect(s.options).toHaveLength(3);
    for (const o of s.options) {
      expect(o.win_probability, o.option_id).toBeNull();
      expect(o.outcome_mean, o.option_id).toBeNull();
    }
    expect(s.winner.option_id).toBe('');
    expect(s.winner.win_probability).toBeNull();
    expect(s.margin).toBeNull();
    expect(s.margin_pp).toBeNull();
  });

  it('the typed reason travels in place of a winner: code, node ids and PLoT\'s own words', () => {
    const s = compactAnalysis(withheld417() as never)!;
    expect(s.figures_withheld).toEqual({ code: CODE, node_ids: ['monthly_cloud_cost_savings'], message: `Not shown. ${REASON}` });
  });

  it('ONE absent option crowns nothing (no partial winner), and the absent option sorts last', () => {
    const partial = structuredClone(SERVED);
    delete (partial.option_comparison as Json[])[0].win_probability; // the served leader loses its figure
    const s = compactAnalysis(withoutWarning(partial) as never)!;
    expect(s.winner.option_id).toBe('');
    expect(s.margin).toBeNull();
    expect(s.options.at(-1)!.option_id).toBe((SERVED.option_comparison as Json[])[0].option_id);
    expect(s.options.at(-1)!.win_probability).toBeNull();
  });

  it('CONTROL (served, figures present): the winner is the served leader, as today; the reason still travels', () => {
    const s = compactAnalysis(SERVED as never)!;
    expect(s.winner.option_id).toBe('remain_on_aws');
    expect(s.winner.win_probability).toBeCloseTo(0.5033666666666663, 12);
    expect(s.margin).not.toBeNull();
    expect(s.figures_withheld?.code).toBe(CODE);
    expect(compactAnalysis(withoutWarning(SERVED) as never)!).not.toHaveProperty('figures_withheld');
  });
});

describe('the winner source never falls through to a downstream copy under the run\'s withhold', () => {
  // A downstream copy that still carries figures (a legacy `results[]` from an older writer).
  const withStaleCopy = (r: Json): Json => ({ ...r, results: (SERVED.option_comparison as Json[]).map((o) => ({ option_id: o.option_id, option_label: o.option_label, win_probability: o.win_probability })) });

  it('RED: #417 shape + a figure-carrying `results[]` → the current source only; nothing crowned from the copy', () => {
    const r = withStaleCopy(withheld417());
    expect(winnerOptionResultSource(r).every((o) => o.win_probability === undefined)).toBe(true);
    expect(compactAnalysis(r as never)!.winner.option_id).toBe('');
  });

  it('CONTRAST: the same envelope WITHOUT the typed warning keeps today\'s fall-through (the copy supplies the winner)', () => {
    const r = withoutWarning(withStaleCopy(withheld417()));
    expect(winnerOptionResultSource(r).some((o) => typeof o.win_probability === 'number')).toBe(true);
    expect(compactAnalysis(r as never)!.winner.option_id).toBe('remain_on_aws');
  });
});

// Deletion 8: the six `projectAnalysis` / context-pack rows that stood here were removed with
// `context-pack-assembler.ts` (no served caller). The absent-stays-absent rule is still pinned above on
// `compactAnalysis` and `winnerOptionResultSource`, the live readers.

describe('objective contradiction: an absent win % is not 0 and names no leader', () => {
  it('RED: the #417 shape reads as ABSENT, and the detector makes no claim from it', () => {
    const views = readObjectiveOptionViews(withheld417().option_comparison as Json[]);
    for (const v of views) expect(v.win_probability).toBeNull();
    const withGoal = views.map((v, i) => ({ ...v, probability_of_goal: i === 0 ? 0 : 1 }));
    expect(detectGoalAttainmentContradiction(withGoal)).toBeNull();
  });
});

/**
 * ⛔ GOAL CHANCE AND THE LIMITS-ONLY JOINT NEVER SHARE `target_fit` (AIQ 5887531086; DL 5887546998). PLoT's
 * `probability_of_joint_goal` is "jointly satisfying all goal_constraints" — the user's LIMITS, never the goal's target.
 * It refilled an absent P(goal) as `target_fit` ("the modelled probability it meets your target"), and served w2285 S3
 * said a downtime-only 100% as savings. Corpus: S3 as served (P(goal) absent, the joint 1 / 0.981 / 1) and AIQ's w416 E
 * (Paul's P1: P(goal) 0 everywhere, the joint 1).
 */
import { analysisResultForAgent, ALL_LIMITS_HOLD_NOTE } from '../../agent-lane/decision-sensitivity.js';

const TF = JSON.parse(readFileSync(new URL('./fixtures/served-target-fit-S3-E-20260929.json', import.meta.url), 'utf8')) as { S3: Json; E: Json };

describe('target_fit is P(goal) ONLY — the limits-only joint never refills it', () => {
  it('precondition (served S3): P(goal) absent on every option, the joint present', () => {
    for (const o of TF.S3.option_comparison as Json[]) {
      expect(o.probability_of_goal).toBeUndefined();
      expect(typeof o.probability_of_joint_goal).toBe('number');
    }
  });

  // Deletion 8: R1 / R2 / R1b / R3 asserted on `projectAnalysis` + its display projection (context-pack-assembler,
  // no served caller) and were removed with it. The served-lane counterpart is the Agent block below.
});

describe('the Agent sees the joint only as a LIMITS figure, never as `goal_fit`', () => {
  const block = (e: Json): Json => ({ type: 'analysis_result', summary: 's', enrichment: structuredClone(e) });

  it('RED (served S3): each option\'s joint is `all_limits_hold_probability`; the brief\'s `goal_fit` (the leader\'s joint) is gone; the note says it excludes the goal', () => {
    expect(TF.S3.decision_brief.analysis_summary.goal_fit, 'precondition: the served brief labels the leader\'s joint goal_fit').toBe(0.981);
    const out = analysisResultForAgent(block(TF.S3)) as Json;
    const rows = out.enrichment.option_comparison as Json[];
    expect(rows.map((r) => r.all_limits_hold_probability)).toEqual([1, 0.981, 1]);
    for (const r of rows) expect(r).not.toHaveProperty('probability_of_joint_goal');
    expect(out.enrichment.decision_brief.analysis_summary).not.toHaveProperty('goal_fit');
    expect(JSON.stringify(out)).not.toMatch(/"goal_fit"|probability_of_joint_goal/);
    expect(out.limits_note).toBe(ALL_LIMITS_HOLD_NOTE);
    expect(out.limits_note).toMatch(/does NOT include the goal’s target/);
  });

  it('CONTROL: a run with no joint gets no limits note and is otherwise unchanged', () => {
    const noJoint = structuredClone(TF.S3);
    for (const o of noJoint.option_comparison as Json[]) delete o.probability_of_joint_goal;
    delete noJoint.decision_brief.analysis_summary.goal_fit;
    expect(analysisResultForAgent(block(noJoint))).not.toHaveProperty('limits_note');
  });
});

describe('under #416\'s code, ONLY the current carrier is read — a stale copy is never the first source (PR Review CR @ e4c7f366)', () => {
  // #416's warning, NO current option_comparison, and stale numeric copies in results[] and decision_brief.options.
  const staleOnly = (): Json => {
    const x = withheld417();
    const stale = (SERVED.option_comparison as Json[]).map((o) => ({ option_id: o.option_id, option_label: o.option_label, win_probability: o.win_probability, probability_of_goal: 0.5, outcome_mean: 1 }));
    return { ...x, option_comparison: [], results: stale, decision_brief: { ...x.decision_brief, options: stale } };
  };

  it('RED: no/empty option_comparison + numeric results[] and brief copies → no source, no winner, no margin', () => {
    const r = staleOnly();
    expect(winnerOptionResultSource(r)).toEqual([]);
    const s = compactAnalysis(r as never)!;
    expect(s.winner.option_id).toBe('');
    expect(s.margin).toBeNull();
    expect(s.figures_withheld?.code).toBe(CODE); // the typed reason stays
  });

  it('the UI-nested current carrier (`results.option_comparison`) is still read; its sibling copies are not', () => {
    const x = withheld417();
    const nested = { ...x, option_comparison: undefined, results: { option_comparison: x.option_comparison, options: [{ option_id: 'stale', win_probability: 0.9 }] } };
    expect(winnerOptionResultSource(nested).map((o) => o.option_id)).toEqual((x.option_comparison as Json[]).map((o) => o.option_id));
  });

  it('CONTROL: WITHOUT the typed warning, today\'s walk is unchanged (the copy supplies the winner)', () => {
    const r = withoutWarning(staleOnly());
    expect(winnerOptionResultSource(r).some((o) => typeof o.win_probability === 'number')).toBe(true);
    expect(compactAnalysis(r as never)!.winner.option_id).not.toBe('');
  });
});
