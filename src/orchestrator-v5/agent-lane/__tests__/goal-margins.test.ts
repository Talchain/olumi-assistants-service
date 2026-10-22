/**
 * DL brief 23 Oct (Track 3 R2 c1: 0 full / 3 half / 5 zero): with every input the person's own exact figure, the core reply
 * closed on "which of your stated figures are you least sure of?", naming no dependency and no test, because the Run payload
 * carried no margin. These rows bind the Run's own facts at source (`goalMarginsOf`, via the ONE run-facts packet and the
 * Run tool): each option's margin, and the input a result rests on with its boundary only where the mapper's exact sum makes
 * it so. The fixture is a served core Run's stored read (cee 03b03b1), every label and unit renamed to synthetic words.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalMarginsOf } from '../goal-margins.js';
import { runFactsOf } from '../run-facts.js';
import { readRunEvidence } from '../run-evidence.js';
import { GOAL_FIGURES_USER_EFFECT_CLAMPED } from '../../../orchestrator/context/option-result-source.js';
import { runAnalysis } from '../../path-b/tools/run-tool.js';
import { read } from '../../path-b/tools/__tests__/fixtures.js';
import { CORE_REPLY_INSTRUCTION } from '../../../routes/agent-v1-turn.js';

type Json = Record<string, any>;
// Read via fs, not a JSON import attribute (TS2823 under the ratchet's config; precedent in run-analysis-brief-to-plot.test.ts).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/exact-figures-run.json', import.meta.url), 'utf8')) as Json;
const fresh = (): Json => structuredClone(fixture) as Json;
const marginsOf = (f: Json, current = true, selected: string | null = f.analysis_run_evidence.run_id) =>
  goalMarginsOf(f.analysis_result, f.graph, current, readRunEvidence(f.analysis_run_evidence), selected);
const row = (f: Json, id: string): Json => f.analysis_result.enrichment.option_comparison.find((r: Json) => r.option_id === id);
const link = (f: Json, id: string): Json => f.graph.living_model.links.find((l: Json) => l.id === id);
const licence = (f: Json): Json => f.analysis_result.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
/** The Run's own target moved: the snapshot's raw target, the threshold it sent (encoded) and the licence's display. */
const retarget = (f: Json, raw: number, encoded: number, baseline?: { raw: number; encoded: number }): Json => {
  const snap = f.analysis_run_evidence.input_snapshot;
  snap.goal.target_raw = raw;
  licence(f).target.value = raw;
  licence(f).sent_threshold.value = encoded;
  if (baseline !== undefined) {
    Object.assign(snap.factors.find((x: Json) => x.factor_id === snap.goal.node_id), { raw: baseline.raw, encoded: baseline.encoded });
    licence(f).sent_threshold.baseline = baseline.encoded;
  }
  return f;
};
const levels = (f: Json, by: Readonly<Record<string, number>>): Json => {
  for (const [id, v] of Object.entries(by)) Object.assign(row(f, id).outcome, { p10: v, p50: v, p90: v, mean: v });
  return f;
};
/** Every option's recorded level in the encoded frame (the Run's own scale: 0.8 encodes the target 400). */
const encode = (f: Json, sq = 0.4): Json => {
  for (const [id, v] of [['night', 1.1], ['sorter', 0.5], ['loop', 1.04], ['status_quo', sq]] as const) {
    Object.assign(row(f, id).outcome, { p10: v, p50: v, p90: v, mean: v });
  }
  return f;
};
const EXPECTED = {
  target: 400, comparator: '>=', unit: 'crates per shift', baseline: 200,
  options: [
    { option_id: 'night', label: 'Night crew', level: 550, margin: 150, meets: true, rests_on: { link_id: 'night_output', saved: 350, boundary: 200 } },
    { option_id: 'sorter', label: 'Second sorter', level: 250, margin: -150, meets: false, rests_on: { link_id: 'sorter_output', saved: 50, boundary: 200 } },
    { option_id: 'loop', label: 'Extra loop', level: 520, margin: 120, meets: true, rests_on: { link_id: 'loop_output', saved: 320, boundary: 200 } },
    { option_id: 'status_quo', label: 'Carry on as now', level: 200, margin: -200, meets: false },
  ],
};

describe('exact results carry their margins and the input each rests on, from the Run itself', () => {
  it('the run-facts packet of a served exact-figure Run: each margin, and each own link\'s boundary', () => {
    const f = fresh();
    const facts = runFactsOf(f.analysis_result, f.graph, true, { runEvidence: readRunEvidence(f.analysis_run_evidence), selectedRunId: f.analysis_run_evidence.run_id });
    expect(facts.margins).toEqual(EXPECTED);
  });

  it('the Run tool forwards the same margins to the reply (goal_margins), from the read of THAT Run', async () => {
    const f = fresh();
    const runId = f.analysis_run_evidence.run_id as string;
    const at = '2026-10-22T04:11:34.831Z';
    const after = { status: 200, json: read({ graph: f.graph, analysis_result: f.analysis_result, analysis_run_evidence: f.analysis_run_evidence,
      canonical_analysis_view: { staleness: { revision: 3, stale: false }, run: { run_id: runId, graph_hash_at_run: 'h_one' } },
      analysis_state: { run_state: { kind: 'complete_current', computed_at: at } } }) };
    const ran = { ok: true, mutated: false, ran: true, status: 'ready', result: {}, run_identity: { scenario_id: 'scn_1', graph_hash_at_run: 'h_one', computed_at: at } };
    const dispatch = vi.fn(async () => after);
    const out = await runAnalysis({ dispatch, runAnalysis: async () => ran }, { scenario_id: 'scn_1' },
      { reason: 'Run it.', effects_timing: 'not_stated' }, { approvalApplied: false });
    expect(out.status).toBe('ok');
    expect(out.status === 'ok' ? out.data.goal_margins : undefined).toEqual(EXPECTED);
  });

  it('the core reply is told to say each margin as stated and to offer the test at the boundary, never a claim', () => {
    expect(CORE_REPLY_INSTRUCTION).toContain('as goal_margins states it');
    expect(CORE_REPLY_INSTRUCTION).toContain('offer one stress_test of that link at its boundary');
    expect(CORE_REPLY_INSTRUCTION).toContain('never as a claim about what will happen');
    // #3625's negatives stay.
    expect(CORE_REPLY_INSTRUCTION).toContain('never worked out from the inputs');
    expect(CORE_REPLY_INSTRUCTION).toContain('without ranking them or saying which matters most');
  });

  it('NEGATIVE: a Run that is not current says nothing', () => {
    expect(marginsOf(fresh(), false)).toBeUndefined();
  });

  it('NEGATIVE: any spread on any option (a chance or range is the headline there) says nothing', () => {
    const f = fresh();
    Object.assign(row(f, 'loop').outcome, { p10: 500, p90: 540, std: 12 });
    expect(marginsOf(f)).toBeUndefined();
  });

  it('NEGATIVE: equal deciles with a recorded spread are not an exact result (Codex)', () => {
    const f = fresh();
    row(f, 'night').outcome.std = 5;
    expect(marginsOf(f)).toBeUndefined();
  });

  it('NEGATIVE: the frame is unproven when the status quo\'s row is neither today\'s level nor its encoded value', () => {
    const f = fresh();
    Object.assign(row(f, 'status_quo').outcome, { p10: 210, p50: 210, p90: 210, mean: 210 });
    expect(marginsOf(f)).toBeUndefined();
  });

  it('a Run that recorded its levels in the encoded frame: the same margins, in the target\'s unit', () => {
    expect(marginsOf(encode(fresh()))).toEqual(EXPECTED);
  });

  it('NEGATIVE: encoded levels with the status quo off both frames: the frame is unproven, nothing is said', () => {
    expect(marginsOf(encode(fresh(), 0.41))).toBeUndefined();
  });

  it('a strict target (above): a level exactly at the target misses it, with the licence\'s own side', () => {
    const f = fresh();
    f.analysis_run_evidence.input_snapshot.goal.operator = '>';
    licence(f).target.comparator = 'above';
    licence(f).withheld_reason_by_option.night.side = 'falls_short';
    Object.assign(row(f, 'night').outcome, { p10: 400, p50: 400, p90: 400, mean: 400 });
    link(f, 'night_output').effect.value = 200;
    expect(marginsOf(f)!.options.find((o) => o.option_id === 'night')).toEqual({ option_id: 'night', label: 'Night crew', level: 400, margin: 0, meets: false });
  });

  it('NEGATIVE: an outcome the Run keeps from the AI is never reconstructed as a margin (Codex)', () => {
    const f = fresh();
    f.analysis_result.enrichment.inference_warnings.push({ code: GOAL_FIGURES_USER_EFFECT_CLAMPED, option_ids: ['night'], withheld_claims: ['goal_probability'] });
    expect(marginsOf(f)).toBeUndefined();
  });

  it('NEGATIVE: evidence of another Run is never borrowed', () => {
    const f = fresh();
    f.analysis_result.run_id = 'another_run';
    expect(marginsOf(f)).toBeUndefined();
  });

  it('NEGATIVE (Codex r1): a stored result with no id of its own, and evidence of another Run than the one selected', () => {
    const f = fresh();
    expect(f.analysis_result.run_id).toBeUndefined();
    f.analysis_run_evidence.run_id = 'foreign';
    expect(marginsOf(f, true, '9848593d6dbc5d4d62fcbd210e9bd2c5fc712801bca143fae404b52a07ea7abb')).toBeUndefined();
    expect(marginsOf(fresh(), true, null)).toBeUndefined();
  });

  it('NEGATIVE (Codex r1): a tiny encoding scale with today\'s level at 0 is two frames that agree only at 0: nothing is said', () => {
    const f = levels(retarget(fresh(), 1e-10, 1e-12, { raw: 0, encoded: 0 }), { status_quo: 0 });
    for (const id of ['night', 'sorter', 'loop']) licence(f).withheld_reason_by_option[id].side = 'meets';
    expect(marginsOf(f)).toBeUndefined();
  });

  it('NEGATIVE (Codex r1): a small recorded spread is still a spread', () => {
    const f = fresh();
    row(f, 'night').outcome.std = 1e-7;
    expect(marginsOf(f)).toBeUndefined();
  });

  it('Codex r1: a level is never rounded away (only float noise is cleared)', () => {
    const f = levels(fresh(), { night: 550.0000000001 });
    const night = marginsOf(f)!.options.find((o) => o.option_id === 'night')!;
    expect(night.margin).toBe(150.0000000001);
    expect(night.rests_on).toBeUndefined();
  });

  it('Codex r2: an exactly held 16-digit level keeps its last digit; a decimal margin is the decimal', () => {
    expect(marginsOf(levels(fresh(), { night: 1000000000000001 }))!.options[0]!.margin).toBe(999999999999601);
    expect(marginsOf(levels(fresh(), { night: 400.3 }))!.options[0]!.margin).toBe(0.3);
  });

  it('float noise in a recorded level is cleared, so the identity and its boundary still hold', () => {
    const night = marginsOf(levels(fresh(), { night: 549.9999999999999 }))!.options[0]!;
    expect(night).toEqual(EXPECTED.options[0]);
  });

  it('NEGATIVE (Codex r2): evidence with no selected Run id to match says nothing (every caller passes the canonical id)', () => {
    const f = fresh();
    expect(runFactsOf(f.analysis_result, f.graph, true, { runEvidence: readRunEvidence(f.analysis_run_evidence) }).margins).toBeUndefined();
  });

  it('Codex r1: the status quo is the Run\'s reference, so it is never given a boundary, even with a link of its own', () => {
    const f = fresh();
    f.graph.living_model.links.push({ ...link(f, 'night_output'), id: 'sq_output', from: 'status_quo', effect: { ...link(f, 'night_output').effect, value: 0 } });
    expect(marginsOf(f)!.options.find((o) => o.option_id === 'status_quo')!.rests_on).toBeUndefined();
  });

  it('Codex r1: a target equal to today\'s level offers no test at a zero effect (another "carry on as now")', () => {
    const f = retarget(fresh(), 200, 0.4);
    licence(f).withheld_reason_by_option.sorter.side = 'meets';
    const m = marginsOf(f)!;
    expect(m.options.map((o) => o.margin)).toEqual([350, 50, 320, 0]);
    expect(m.options.some((o) => o.rests_on !== undefined)).toBe(false);
  });

  it('no exact sum on the goal: margins, but no input is said to tip a result', () => {
    const f = fresh();
    const goal = f.graph.nodes.find((n: Json) => n.nonlinear_identity !== undefined);
    delete goal.nonlinear_identity;
    const m = marginsOf(f)!;
    expect(m.options.map((o) => o.margin)).toEqual([150, -150, 120, -200]);
    expect(m.options.some((o) => o.rests_on !== undefined)).toBe(false);
  });

  it('the identity is checked on THIS Run: a level that is not today\'s level plus the effect names no boundary', () => {
    const f = fresh();
    link(f, 'night_output').effect.value = 340;
    const night = marginsOf(f)!.options.find((o) => o.option_id === 'night')!;
    expect(night).toMatchObject({ level: 550, margin: 150 });
    expect(night.rests_on).toBeUndefined();
  });

  it('an option acting through settings names no boundary (only its own exact link to the goal can)', () => {
    const f = fresh();
    f.graph.living_model.options.find((o: Json) => o.id === 'sorter').settings = [{ factor_id: 'x', value: 1 }];
    expect(marginsOf(f)!.options.find((o) => o.option_id === 'sorter')!.rests_on).toBeUndefined();
  });
});
