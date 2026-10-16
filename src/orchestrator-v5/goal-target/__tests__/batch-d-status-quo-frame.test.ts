/**
 * ⭐ D2: THE STATUS QUO IS READ IN THE FRAME THE RUN WAS SCORED IN (DL ruling 12 Oct, recovery Batch D; PL 6128510916).
 *
 * Served run 3 (2026-10-12T153555Z, capacity, CEE 3fdf0f38): "Not shown: this run’s result for carrying on as now doesn’t
 * match ‘Weekly support capacity’ as it stands today in the model". The status-quo row sat exactly at today's level, on the
 * Run's normalised scale (0.16 = 80/500), and was compared with `raw_value` 80: a units mismatch, not a disagreement
 * (`decisive-link/DIAGNOSIS.md` §3). The fixture is that served envelope and graph (wire-shaped: the row is normalised, never a
 * self-authored raw row). The Run's own recorded threshold field names the frame; with none, the reading is unknown, never
 * "moved". The forecast, moved, positive-std and unequal-decile controls stay.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, sentGoalThresholdOf, type SentGoalThreshold } from '../goal-chance-licence.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-d/served-capacity-run3-20261012T153555Z.json', 'utf8')) as {
  envelope: Rec; graph: Rec; served_licence: Rec;
  recorded_field_on_a_licensed_capacity_run: { sent_threshold: SentGoalThreshold } };
const GOAL = 'weekly_support_capacity';
const SQ = 'keep_current_staffing';
const SPECIALIST = 'add_one_specialist';
const SERVED_LINE = (FX.served_licence.withheld_reason_by_option as Record<string, { line: string }>)[SQ]!.line;
/**
 * AMENDED (AIE #94 6163023819, packet fc17c200; was #94 6160089127's "Carrying on as now: this Run uses …" lines): the
 * status-quo row's LEVEL line. This goal holds today's 80 and a target of at least 100 in one unit, spelt as each served graph
 * holds it. These rows are about the Run's frame; the words are pinned in `status-quo-row-words.test.ts`.
 */
const byAssumptionIn = (unit: string): string => `This Run can’t give a chance for carrying on as now, because it treats ‘Weekly support capacity’ `
  + `as unchanged from today’s 80 ${unit} (your target is at least 100 ${unit}). Worth checking: how ‘Weekly support capacity’ could change `
  + `over the goal period if nothing is done, including any forecast or range already in the model.`;
const BY_ASSUMPTION = byAssumptionIn('tickets per week');
/** The run-4 served graph (`FLOAT`) spells the same unit "tickets / week". */
const FLOAT_BY_ASSUMPTION = byAssumptionIn('tickets / week');
const RECORDED = FX.recorded_field_on_a_licensed_capacity_run.sent_threshold;

/**
 * The envelope as the Run's licence reads it, before transport: the served licence removed (it is this code's output), and
 * the status quo's exact 0 restored (the transport strips an unearned 0; the Run's own row carries it, as the 11 Oct
 * capacity Run's licence shows).
 */
const runEnvelope = (row?: Rec): Rec => {
  const env = structuredClone(FX.envelope);
  env.inference_warnings = (env.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_CHANCE_LICENSED');
  const sq = (env.option_comparison as Rec[]).find((o) => o.option_id === SQ)!;
  sq.probability_of_goal = 0;
  if (row !== undefined) sq.outcome = { ...(sq.outcome as Rec), ...row };
  return env;
};
const earned = () => false;
const licence = (env: Rec, sent?: SentGoalThreshold) => goalChanceLicenceOf(env, FX.graph, GOAL, earned, sent, FX.graph, {});
const reasonOf = (l: ReturnType<typeof licence>): Rec | undefined =>
  (l?.withheld_reason_by_option as Record<string, Rec> | undefined)?.[SQ];

describe('D2: the served capacity status quo, read in its own frame (run 3, normalised row)', () => {
  it('precondition: the wire row is normalised and sits exactly at today\'s level; the goal holds both frames', () => {
    const sq = (FX.envelope.option_comparison as Rec[]).find((o) => o.option_id === SQ)!;
    expect(sq.outcome).toMatchObject({ p10: 0.16, p50: 0.16, p90: 0.16, mean: 0.16, std: 0 });
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;
    expect(goal.observed_state).toMatchObject({ value: 0.16, raw_value: 80, cap: 500 });
    expect(goal).toMatchObject({ goal_threshold: 0.2, goal_threshold_raw: 100 });
    expect(reasonOf(FX.served_licence as never)).toMatchObject({ reason: 'reference_moved' });
  });

  it('RED (served): with no field recorded, the status quo is never said to "not match" today — the frame is unknown', () => {
    const env = runEnvelope();
    // Bound to the Run's own recorder: nothing is licensed, so this Run records no threshold field.
    expect(sentGoalThresholdOf(env, FX.graph, GOAL, earned)).toBeUndefined();
    const l = licence(env);
    expect(l).not.toBeNull();
    expect(reasonOf(l)?.reason).not.toBe('reference_moved');
    expect(JSON.stringify(l)).not.toContain(SERVED_LINE);
    // Unknown stays unknown: no "by assumption" is claimed either.
    expect(l!.status_quo).toBeUndefined();
    // Never declared cleared: the specialist option stays withheld (its decisive links are unsized).
    expect(l!.withheld_option_ids).toContain(SPECIALIST);
    expect(l!.pct_by_option).not.toHaveProperty(SPECIALIST);
  });

  it('RED → GREEN: in the frame the Run records (goal_threshold, the normalised value), carrying on is "No change, by assumption"', () => {
    const l = licence(runEnvelope(), RECORDED);
    expect(reasonOf(l)?.reason).not.toBe('reference_moved');
    expect(l!.status_quo).toEqual({ option_id: SQ, line: BY_ASSUMPTION });
    const env = { ...runEnvelope(), inference_warnings: [...(runEnvelope().inference_warnings as Rec[]), l] };
    const cells = Object.fromEntries(projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, FX.graph)
      .map((c) => [c.option_id, c.cell as Rec]));
    expect(cells[SQ]).toMatchObject({ kind: 'withheld', face: 'No change, by assumption', why: BY_ASSUMPTION });
    expect(l!.withheld_option_ids).toContain(SPECIALIST);
    expect(l!.pct_by_option).not.toHaveProperty(SPECIALIST);
  });

  it('CONTRAST: a genuinely moved row still says it moved, in the recorded frame (zero spread, away from today\'s 0.16)', () => {
    const l = licence(runEnvelope({ p10: 0.18, p50: 0.18, p90: 0.18, mean: 0.18 }), RECORDED);
    expect(reasonOf(l)).toMatchObject({ reason: 'reference_moved', line: SERVED_LINE });
    expect(l!.status_quo).toBeUndefined();
  });

  it('CONTROLS stay: a positive std or unequal deciles is "moved" whatever the frame, recorded or not', () => {
    for (const sent of [RECORDED, undefined]) {
      expect(reasonOf(licence(runEnvelope({ std: 0.01 }), sent)), `std, ${String(sent?.field)}`).toMatchObject({ reason: 'reference_moved' });
      expect(reasonOf(licence(runEnvelope({ p10: 0.15, p90: 0.17 }), sent)), `deciles, ${String(sent?.field)}`).toMatchObject({ reason: 'reference_moved' });
    }
  });

  it('GUARD: the dispatched LEVEL frame carries its explicit same-frame baseline; legacy delta never means a reference of 0', () => {
    // A licensed capacity Run (the 11 Oct served row for ‘Add one specialist’, verbatim): the recorder names goal_threshold.
    const env = runEnvelope();
    Object.assign((env.option_comparison as Rec[]).find((o) => o.option_id === SPECIALIST)!, { probability_of_goal: 0.3508,
      outcome: { p10: 0.16, p50: 0.1868588715621866, p90: 0.23487797617727985, mean: 0.19215858672280697, std: 0.03154728778563835 } });
    const sentGraph = structuredClone(FX.graph);
    const sentGoal = (sentGraph.nodes as Rec[]).find(n => n.id === GOAL)!;
    sentGoal.goal_threshold_frame = 'level';
    sentGoal.observed_state = { ...(sentGoal.observed_state as Rec), baseline: 0.16 };
    const sentRun = { graph: sentGraph, goal_node_id: GOAL, options: [{ option_id: SQ, is_baseline: true }, { option_id: SPECIALIST }] };
    const recorded = sentGoalThresholdOf(env, FX.graph, GOAL, earned, { sentRun });
    expect(recorded).toEqual({ value: 0.2, field: 'goal_threshold', frame: 'level', baseline: 0.16, status_quo_option_id: SQ });
    expect(recorded).toMatchObject({ value: RECORDED.value, field: RECORDED.field });
    expect(sentGoalThresholdOf(env, FX.graph, GOAL, earned), 'legacy outputs cannot attest the dispatched frame').toBeUndefined();
    // Read as 0, today's 0.16 would be "moved" again; read in its field's frame it is today.
    const l = licence(env, recorded);
    expect(l!.status_quo).toEqual({ option_id: SQ, line: BY_ASSUMPTION });
    expect(reasonOf(l)?.reason).not.toBe('reference_moved');
  });

  it('UNKNOWN stays unknown: a record that names another goal value, or a level-offset frame, is never compared', () => {
    for (const sent of [{ ...RECORDED, value: 0.3 }, { ...RECORDED, frame: 'level' as const }]) {
      const l = licence(runEnvelope(), sent);
      expect(reasonOf(l)?.reason, JSON.stringify(sent)).not.toBe('reference_moved');
      expect(l!.status_quo, JSON.stringify(sent)).toBeUndefined();
    }
  });

  it('the raw frame is the raw_value: a raw row the Run recorded against goal_threshold_raw is compared with 80, not 0.16', () => {
    const raw = { value: 100, field: 'goal_threshold_raw', frame: 'delta' } as const;
    expect(licence(runEnvelope({ p10: 80, p50: 80, p90: 80, mean: 80 }), raw)!.status_quo).toEqual({ option_id: SQ, line: BY_ASSUMPTION });
    expect(reasonOf(licence(runEnvelope({ p10: 80, p50: 80, p90: 80, mean: 80 }), RECORDED))).toMatchObject({ reason: 'reference_moved' });
  });
});

/**
 * D2 EXACT SAME-FRAME EQUALITY (AIE 6129749753 AMEND, PL 6130375396, 12 Oct; replaces the 16ε float tolerance and C's 1e-9
 * floor, both rejected). The 11 Oct capacity Run (served CEE 50530b5f): carrying on reported std 5.551115123125783e-17 with
 * mean 0.4000000000000001. Nothing shows that producer gave a constant result, so the checking reading stays: it moved.
 * Exactly today's figure, with no spread, is "No change, by assumption" in any unit.
 */
const FLOAT = JSON.parse(readFileSync('tests/fixtures/batch-d/served-capacity-float-std-20261011T233643Z.json', 'utf8')) as {
  envelope: Rec; graph: Rec; served_licence: Rec & { sent_threshold: SentGoalThreshold } };
const floatEnvelope = (outcome?: Rec): Rec => {
  const env = structuredClone(FLOAT.envelope);
  env.inference_warnings = (env.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_CHANCE_LICENSED');
  const sq = (env.option_comparison as Rec[]).find((o) => o.option_id === SQ)!;
  // The Run's own row before transport (the transport strips an unearned exact 0), as above.
  sq.probability_of_goal = 0;
  if (outcome !== undefined) sq.outcome = { ...(sq.outcome as Rec), ...outcome };
  return env;
};
const floatLicence = (env: Rec) => goalChanceLicenceOf(env, FLOAT.graph, GOAL, earned, FLOAT.served_licence.sent_threshold, FLOAT.graph, {});

describe('D2 exact same-frame equality (11 Oct capacity Run, and run 4\'s capacity row)', () => {
  it('precondition: the wire row is 0.4 on every draw with a float-residue std, and the Run recorded its normalised field', () => {
    const sq = (FLOAT.envelope.option_comparison as Rec[]).find((o) => o.option_id === SQ)!;
    expect(sq.outcome).toMatchObject({ p10: 0.4, p50: 0.4, p90: 0.4, mean: 0.4000000000000001, std: 5.551115123125783e-17 });
    expect(FLOAT.served_licence.sent_threshold).toEqual({ field: 'goal_threshold', frame: 'delta', value: 0.5 });
    expect((FLOAT.graph.nodes as Rec[]).find((n) => n.id === GOAL)!.observed_state).toMatchObject({ value: 0.4, raw_value: 80, cap: 200 });
  });

  it('AMENDED: the residue row (std 5.6e-17, mean one ulp above 0.4) reads moved; its exact twin is "No change, by assumption"', () => {
    expect(reasonOf(floatLicence(floatEnvelope()))).toMatchObject({ reason: 'reference_moved' });
    expect(floatLicence(floatEnvelope({ std: 0, mean: 0.4 }))!.status_quo).toEqual({ option_id: SQ, line: FLOAT_BY_ASSUMPTION });
    // Each half on its own: the std alone, and the centre alone.
    expect(reasonOf(floatLicence(floatEnvelope({ mean: 0.4 })))).toMatchObject({ reason: 'reference_moved' });
    expect(reasonOf(floatLicence(floatEnvelope({ std: 0 })))).toMatchObject({ reason: 'reference_moved' });
  });

  it('CONTRAST (the AIE\'s real small spread): std 4ε·|0.4| with split deciles reads moved', () => {
    const tiny = 4 * Number.EPSILON * 0.4;
    expect(reasonOf(floatLicence(floatEnvelope({ std: tiny, mean: 0.4, p10: 0.4 - tiny, p50: 0.4, p90: 0.4 + tiny })))).toMatchObject({ reason: 'reference_moved' });
  });

  it('CONTRAST: a genuinely nonzero std, or deciles genuinely apart, still reads as moved', () => {
    expect(reasonOf(floatLicence(floatEnvelope({ std: 0.001 })))).toMatchObject({ reason: 'reference_moved' });
    expect(reasonOf(floatLicence(floatEnvelope({ std: 1e-12 * 0.4, mean: 0.4, p10: 0.4, p50: 0.4, p90: 0.4 })))).toMatchObject({ reason: 'reference_moved' });
    expect(reasonOf(floatLicence(floatEnvelope({ p10: 0.39, p90: 0.41 })))).toMatchObject({ reason: 'reference_moved' });
  });

  it('a tiny-scale quantity (centre 1e-6): any positive std moves; at std 0 and exactly today it is today', () => {
    const tiny = structuredClone(FLOAT.graph);
    ((tiny.nodes as Rec[]).find((n) => n.id === GOAL)!.observed_state as Rec).value = 1e-6;
    const at = (std: number) => goalChanceLicenceOf(floatEnvelope({ std, mean: 1e-6, p10: 1e-6, p50: 1e-6, p90: 1e-6 }), tiny, GOAL, earned,
      FLOAT.served_licence.sent_threshold, tiny, {});
    expect(reasonOf(at(1e-12))).toMatchObject({ reason: 'reference_moved' });
    expect(reasonOf(at(1e-16))).toMatchObject({ reason: 'reference_moved' });
    expect(at(0)!.status_quo).toEqual({ option_id: SQ, line: FLOAT_BY_ASSUMPTION });
  });

  it('UNIT-RESCALED: in raw units (read against raw_value 80) exactly 80 with no spread is today; the residue row still moves', () => {
    const raw = { value: 100, field: 'goal_threshold_raw', frame: 'delta' } as const;
    const scaled = (outcome: Rec) => goalChanceLicenceOf(floatEnvelope(outcome), FLOAT.graph, GOAL, earned, raw, FLOAT.graph, {});
    expect(scaled({ p10: 80, p50: 80, p90: 80, mean: 80, std: 0 })!.status_quo).toEqual({ option_id: SQ, line: FLOAT_BY_ASSUMPTION });
    const sq = (FLOAT.envelope.option_comparison as Rec[]).find((o) => o.option_id === SQ)!.outcome as Record<string, number>;
    const x200 = Object.fromEntries(['p10', 'p50', 'p90', 'mean', 'std'].map((k) => [k, sq[k]! * 200]));
    expect(reasonOf(scaled(x200))).toMatchObject({ reason: 'reference_moved' });
  });

  it('RUN 4\'s capacity status-quo row (served, exact 0.16 with std 0) is "No change, by assumption" under exact equality', () => {
    const served = JSON.parse(readFileSync('src/orchestrator-v5/compose/__tests__/fixtures/run4-capacity-turn3-response-body.json', 'utf8')) as Rec;
    const row = (((served.blocks as Rec[])[0]!.enrichment as Rec).option_comparison as Rec[]).find((o) => o.option_id === SQ)!.outcome as Rec;
    expect(row).toMatchObject({ p10: 0.16, p50: 0.16, p90: 0.16, mean: 0.16, std: 0 });
    // On run 3's recorded Run fields (the same capacity template; run 4's transport strips the licence's own fields).
    expect(licence(runEnvelope(row), RECORDED)!.status_quo).toEqual({ option_id: SQ, line: BY_ASSUMPTION });
  });
});
