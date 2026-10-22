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
const marginsOf = (f: Json, current = true) => goalMarginsOf(f.analysis_result, f.graph, current, readRunEvidence(f.analysis_run_evidence));
const row = (f: Json, id: string): Json => f.analysis_result.enrichment.option_comparison.find((r: Json) => r.option_id === id);
const link = (f: Json, id: string): Json => f.graph.living_model.links.find((l: Json) => l.id === id);
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
    const facts = runFactsOf(f.analysis_result, f.graph, true, { runEvidence: readRunEvidence(f.analysis_run_evidence) });
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

  it('a strict target: a level exactly at it does not meet it', () => {
    const f = fresh();
    Object.assign(row(f, 'night').outcome, { p10: 400, p50: 400, p90: 400, mean: 400 });
    link(f, 'night_output').effect.value = 200;
    f.analysis_run_evidence.input_snapshot.goal.operator = '>';
    const m = marginsOf(f);
    // The licence's own side must agree with ours, or nothing is said; either way "meets" is never claimed at the boundary.
    expect(m === undefined || m.options.find((o) => o.option_id === 'night')!.meets === false).toBe(true);
  });
});
