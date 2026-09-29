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
import { projectAnalysis, FIGURES_ABSENT_NOTE, FIGURES_WITHHELD_BY_RUN_NOTE } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { formatAnalysisForContext } from '../../format/format-analysis-for-context.js';
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
const pack = (r: Json) => projectAnalysis(compactAnalysis(r as never) as never, null);
const digitsPct = /\b0(\.0+)?\s*%|\b0% /;

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

describe('the context pack: no leader, no ranking, no 0% — the typed reason instead', () => {
  it('RED (#417 shape): no leading option, no runner-up, no margin, nothing ranked; `figures_withheld` with the reason', () => {
    const p = pack(withheld417())!;
    expect(p.leading_option).toBeNull();
    expect(p.runner_up).toBeNull();
    expect(p.margin_pp).toBeNull();
    expect(p.options).toEqual([]);
    expect(p.figures_withheld?.reason_code).toBe(CODE);
    expect(p.figures_withheld?.note).toBe(`${FIGURES_WITHHELD_BY_RUN_NOTE} ${FIGURES_ABSENT_NOTE} Why: ${REASON}`);
    expect(JSON.stringify(p)).not.toMatch(digitsPct);
    // The note names no option (it stands where a winner would have been).
    for (const o of SERVED.option_comparison as Json[]) expect(p.figures_withheld!.note).not.toContain(o.option_label);
  });

  it('the pack\'s strict schema admits it', () => {
    expect(ContextPackSchema.shape.analysis.safeParse(pack(withheld417())).success).toBe(true);
    const bad = { ...pack(withheld417())!, figures_withheld: { reason_code: CODE, note: 'x', leader: 'remain_on_aws' } };
    expect(ContextPackSchema.shape.analysis.safeParse(bad).success, 'strict: no extra key rides in it').toBe(false);
  });

  it('ONE absent option and no typed warning → still no leader and nothing ranked; the reason code is null', () => {
    const partial = structuredClone(SERVED);
    delete (partial.option_comparison as Json[])[1].win_probability;
    const p = pack(withoutWarning(partial))!;
    expect(p.leading_option).toBeNull();
    expect(p.options).toEqual([]);
    expect(p.figures_withheld).toEqual({ reason_code: null, note: FIGURES_ABSENT_NOTE });
  });

  it('the #416-only window (served today): the ranking stands on present win %, and the reason travels beside it', () => {
    const p = pack(SERVED)!;
    expect(p.leading_option?.label).toBe('Remain on AWS');
    expect(p.figures_withheld).toEqual({ reason_code: CODE, note: `${FIGURES_WITHHELD_BY_RUN_NOTE} Why: ${REASON}` });
  });

  it('CONTROL: figures present and no warning → the pack is as today, with no `figures_withheld` key', () => {
    const p = pack(withoutWarning(SERVED))!;
    expect(p.leading_option?.label).toBe('Remain on AWS');
    expect(p).not.toHaveProperty('figures_withheld');
  });

  it('the display projection the model reads carries the note verbatim, and no 0%', () => {
    const d = formatAnalysisForContext(pack(withheld417()), { analysisFreshness: 'fresh' })!;
    expect(d.figures_withheld_note).toBe(pack(withheld417())!.figures_withheld!.note);
    expect(d).not.toHaveProperty('leading_option');
    expect(JSON.stringify(d)).not.toMatch(digitsPct);
    expect(formatAnalysisForContext(pack(withoutWarning(SERVED)), { analysisFreshness: 'fresh' })).not.toHaveProperty('figures_withheld_note');
  });
});

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
import { deriveGoalFitFromEnrichment, deriveOptionGoalFitsFromEnrichment } from '../analysis-signals.js';
import { analysisResultForAgent, ALL_LIMITS_HOLD_NOTE } from '../../agent-lane/decision-sensitivity.js';
import { GOAL_FIT_NOT_SCORED_LINE } from '../../format/format-analysis-for-context.js';

const TF = JSON.parse(readFileSync(new URL('./fixtures/served-target-fit-S3-E-20260929.json', import.meta.url), 'utf8')) as { S3: Json; E: Json };
const withSignals = (e: Json) => ({ ...compactAnalysis(e as never)!, option_goal_fits: deriveOptionGoalFitsFromEnrichment(e), goal_fit: deriveGoalFitFromEnrichment(e) });
const display = (e: Json) => formatAnalysisForContext(projectAnalysis(withSignals(e) as never, null), { analysisFreshness: 'fresh' })!;

describe('target_fit is P(goal) ONLY — the limits-only joint never refills it', () => {
  it('precondition (served S3): P(goal) absent on every option, the joint present', () => {
    for (const o of TF.S3.option_comparison as Json[]) {
      expect(o.probability_of_goal).toBeUndefined();
      expect(typeof o.probability_of_joint_goal).toBe('number');
    }
  });

  it('R1 (served S3): no option carries a goal fit, and the "target-fit not scored" line is said', () => {
    const p = projectAnalysis(withSignals(TF.S3) as never, null)!;
    for (const o of [p.leading_option, p.runner_up, ...(p.options ?? [])].filter(Boolean)) expect(o).not.toHaveProperty('goal_fit_probability');
    const d = display(TF.S3);
    expect(JSON.stringify(d)).not.toContain('target_fit');
    expect(d.goal_fit).toBe(GOAL_FIT_NOT_SCORED_LINE);
  });

  it('R2 CONTROL (served E, Paul\'s P1): P(goal) present → target_fit IS P(goal) (0%), never the joint (100%)', () => {
    const p = projectAnalysis(withSignals(TF.E) as never, null)!;
    expect(p.options!.every((o) => o.goal_fit_probability === 0)).toBe(true);
    expect(JSON.stringify(display(TF.E))).toContain('target_fit');
  });

  it('R1b: a run that says it scored a "goal fit" (PLoT\'s `goal_fit_basis` rides the joint) but gives no P(goal) → still NOT scored', () => {
    const basis = { ...TF.S3, goal_fit_basis: { scored_from: 'modelled_outcome_distribution' } };
    expect(deriveGoalFitFromEnrichment(basis), 'precondition: the signal says scored').toEqual(expect.objectContaining({ scored: true }));
    expect(display(basis).goal_fit).toBe(GOAL_FIT_NOT_SCORED_LINE);
    // Contrast: with a real P(goal) on an option, the scored basis is said.
    const withP = structuredClone(basis); (withP.option_comparison as Json[])[0].probability_of_goal = 0.4;
    expect(display(withP).goal_fit).not.toBe(GOAL_FIT_NOT_SCORED_LINE);
  });

  it('R3: #416\'s withhold + a limit off the identity path → no target_fit', () => {
    const withheld = { ...TF.S3, inference_warnings: [...((TF.S3.inference_warnings as Json[]) ?? []), { code: CODE, message: `Not shown. ${REASON}`, node_ids: ['x'] }] };
    const p = projectAnalysis(withSignals(withheld) as never, null)!;
    for (const o of p.options ?? []) expect(o).not.toHaveProperty('goal_fit_probability');
    expect(display(withheld).goal_fit).toBe(GOAL_FIT_NOT_SCORED_LINE);
  });
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
