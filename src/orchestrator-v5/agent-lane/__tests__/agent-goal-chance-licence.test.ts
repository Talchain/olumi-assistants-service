import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { goalChanceRangeDisplayForAgent } from '../../goal-target/goal-chance-range-agent.js';
import {
  GOAL_CHANCE_COMPANION_KEYS, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_USER_EFFECT_CLAMPED,
  GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
} from '../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const served = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const ctx = { scenario_id: '520aab46-9ed5-4819-9d7f-498d16603943', authenticated_user_id: null, request_id: 's2-licence' };
const [A, B, C] = ['keep_49_price', 'raise_to_54', 'raise_to_59'] as const;
const licence = {
  code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'licensed', form: 'each',
  option_ids: [A, B, C], withheld_option_ids: [C], pct_by_option: { [A]: 45, [B]: 50 },
  display_rounding_by_option: { [A]: 'nearest_5', [B]: 'nearest_5' },
};
const horizonLine = 'This model doesn\'t yet say whether any option gets there within 12 months.';
const horizon = { code: 'GOAL_HORIZON_NOT_TESTED', severity: 'info', message: horizonLine, node_ids: ['mrr'] };
const rangeRecord = {
  code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'ranges', option_ids: [A, B],
  range_by_option: {
    [A]: { low_pct: 20, high_pct: 65, low_rounding: 'nearest_5', high_rounding: 'whole', kind: 'link_strength', from: 'pro_plan_price', to: 'mrr', among: 'unsized_links' },
    [B]: { low_pct: 31, high_pct: 72, low_rounding: 'whole', high_rounding: 'whole', kind: 'link_existence', from: 'missing_source', to: 'mrr', among: 'all' },
  },
};
const expectedRanges = {
  [A]: { range: 'between about 20% and 65%', depends_on: { kind: 'link_strength', from_label: 'Pro plan price', to_label: 'Monthly recurring revenue', among: 'unsized_links' } },
  [B]: { range: 'between about 31% and 72%', depends_on: { kind: 'link_existence', from_label: 'missing_source', to_label: 'Monthly recurring revenue', among: 'all' } },
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture(warnings: Json[] = [licence]): Json {
  const read = clone(served);
  read.analysis_state.leader_claim = { permitted: false, withheld_reason: 'constraint_verdict_withheld' };
  read.analysis_goal_certainty = [];
  read.analysis_result.enrichment.inference_warnings = clone(warnings);
  read.analysis_result.enrichment.option_comparison = [A, B, C].map((option_id, index) => ({
    option_id, option_label: ['Keep £49 price', 'Raise to £54', 'Raise to £59'][index],
    probability_of_goal: [0.441, 0.481, 0.254][index],
    probability_of_goal_precision: { n_met: 441, n_informative: 1000 },
    probability_of_goal_drivers: { rows: [{ figure: 0.254 }] },
  }));
  // The ids bind the range to graph labels, independently of the order of graph nodes.
  read.graph.nodes.find((n: Json) => n.id === 'pro_plan_price').label = 'Pro plan price';
  read.graph.nodes.find((n: Json) => n.id === 'mrr').label = 'Monthly recurring revenue';
  return read;
}
function capabilities(read: Json) {
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph') ? { status: 200, json: read }
    : path === '/orchestrate/v2/turn' ? { status: 200, json: {
      blocks: [{ ...read.analysis_result, type: 'analysis_result' }], analysis_state: read.analysis_state,
      analysis_ready: read.analysis_ready,
    } } : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore());
}
async function saved(read: Json): Promise<Json> {
  return (await capabilities(read).getCanonicalState(ctx) as Json).analysis;
}
async function run(read: Json): Promise<Json> {
  return (await capabilities(read).runAnalysis(ctx, { reason: 'Run the analysis' }) as Json).result;
}
function noCompanions(row: Json) {
  for (const key of GOAL_CHANCE_COMPANION_KEYS) expect(row).not.toHaveProperty(key);
}
function noChance(view: Json) {
  for (const key of ['goal_chance_display', 'goal_chance_licence', 'goal_chance_range_display', 'goal_horizon_line']) expect(view).not.toHaveProperty(key);
  for (const row of view.saved_run_options ?? view.enrichment?.option_comparison ?? []) {
    expect(row).not.toHaveProperty('probability_of_goal');
    noCompanions(row);
  }
}

describe('PR-S2: same-Run per-option chance, range and deadline licences', () => {
  it('(1) saved each/no leader: licensed chances match the display (RED on base: the leader gate drops them)', async () => {
    const view = await saved(fixture());
    expect(view.claim_permissions.leader_may_be_named).toBe(false);
    expect(view.goal_chance_licence).toEqual({ form: 'each', option_ids: [A, B, C], withheld_option_ids: [C] });
    expect(view.goal_chance_display).toEqual({ [A]: 'about 45%', [B]: 'about 50%' });
    for (const [id, probability] of [[A, 0.45], [B, 0.5]] as const) {
      const row = view.saved_run_options.find((r: Json) => r.option_id === id);
      expect(row.probability_of_goal).toBe(probability);
      noCompanions(row);
    }
  });
  it('(2) the same Run gives the withheld option no figure, precision or drivers', async () => {
    const view = await saved(fixture());
    const row = view.saved_run_options.find((r: Json) => r.option_id === C);
    expect(row).not.toHaveProperty('probability_of_goal');
    noCompanions(row);
    expect(view.goal_chance_display).not.toHaveProperty(C);
  });
  it('(3) a stale saved Run gives no chance, range or deadline', async () => {
    const read = fixture([licence, rangeRecord, horizon]);
    read.analysis_state.run_state.kind = 'complete_stale';
    noChance(await saved(read));
    noChance(await run(read));
  });
  it('(4) no licence gives no point chance on either path', async () => {
    const read = fixture([horizon]);
    noChance(await saved(read));
    noChance(await run(read));
  });
  it('(5) a scoped placeholder withhold keeps the other licensed displays (RED on base: the run-wide gate drops all)', async () => {
    const read = fixture([licence, { code: GOAL_FIGURES_PLACEHOLDER_PATH, severity: 'info', message: 'A link needs sizing.', option_ids: [C] }]);
    const view = await run(read);
    expect(view.goal_chance_display).toEqual({ [A]: 'about 45%', [B]: 'about 50%' });
    expect(view.goal_chance_licence).toEqual({ form: 'each', option_ids: [A, B, C], withheld_option_ids: [C] });
    expect(view.enrichment.option_comparison.find((r: Json) => r.option_id === A).probability_of_goal).toBe(0.45);
    const hidden = view.enrichment.option_comparison.find((r: Json) => r.option_id === C);
    expect(hidden).not.toHaveProperty('probability_of_goal');
    for (const row of view.enrichment.option_comparison) noCompanions(row);
    // The saved-Run door must honour the same scope even though goal_chance is present.
    expect((await saved(read)).goal_chance_display).toEqual(view.goal_chance_display);
  });
  it.each([GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, GOAL_FIGURES_USER_EFFECT_CLAMPED])('(6) PLoT run-wide %s withholds both doors, even with an option list', async (code) => {
    const read = fixture([licence, rangeRecord, horizon, { code, severity: 'info', message: 'Not shown.', option_ids: [C] }]);
    noChance(await saved(read));
    noChance(await run(read));
  });
  it('(7) ranges use exact words and graph labels on both doors, with no point for those options', async () => {
    const read = fixture([licence, rangeRecord]);
    const before = clone(read);
    const views = [await saved(read), await run(read)];
    for (const view of views) {
      expect(view.goal_chance_range_display).toEqual(expectedRanges);
      expect(view).not.toHaveProperty('goal_chance_display');
      for (const row of view.saved_run_options ?? view.enrichment.option_comparison) {
        expect(row).not.toHaveProperty('probability_of_goal');
        noCompanions(row);
      }
    }
    expect(read).toEqual(before);
  });
  it.each([
    { low_pct: 65, high_pct: 65 }, { low_pct: 70, high_pct: 65 }, { low_pct: 20.5 }, { high_pct: 65.5 },
    { low_pct: -1 }, { high_pct: 101 }, { kind: 'factor_value' }, { among: 'some' }, { from: 3 },
    { low_rounding: 'nearest_10' }, { low_pct: 21, low_rounding: 'nearest_5' },
  ])('(8) malformed range %j is absent on both paths', async (bad) => {
    const warning = clone(rangeRecord);
    Object.assign(warning.range_by_option[A], bad);
    const read = fixture([warning]);
    expect(await saved(read)).not.toHaveProperty('goal_chance_range_display');
    expect(await run(read)).not.toHaveProperty('goal_chance_range_display');
  });
  it('(8) contradictory ids, duplicate records and inconsistent horizon metadata fail closed', () => {
    for (const warning of [
      { ...rangeRecord, option_ids: [A, A] }, { ...rangeRecord, option_ids: [A] },
      { ...rangeRecord, option_ids: [A, 3] }, { ...rangeRecord, horizon_line: horizonLine },
      { ...rangeRecord, horizon_untested: true, horizon_line: 'Different deadline.' },
    ]) expect(goalChanceRangeDisplayForAgent({ inference_warnings: [warning, horizon] }, fixture().graph)).toBeUndefined();
    expect(goalChanceRangeDisplayForAgent({ inference_warnings: [rangeRecord, rangeRecord] }, fixture().graph)).toBeUndefined();
  });
  it('(9) the deadline travels verbatim with a chance or a range, and otherwise stays absent', async () => {
    for (const warning of [licence, rangeRecord]) {
      const read = fixture([warning, horizon]);
      expect((await saved(read)).goal_horizon_line).toBe(horizonLine);
      expect((await run(read)).goal_horizon_line).toBe(horizonLine);
    }
    noChance(await saved(fixture([horizon])));
    noChance(await run(fixture([horizon])));
    expect(await saved(fixture())).not.toHaveProperty('goal_horizon_line');
    expect(await run(fixture())).not.toHaveProperty('goal_horizon_line');
  });
  it('(10) both reporting rules add the exact range/deadline words and retain the existing bans', () => {
    const rangeRule = 'For an option in goal_chance_range_display, say its range exactly as given: “between about L% and H% chance of meeting your goal, in this model”. Then state what it depends on: for link_strength, “It depends most on how strongly ‘{from}’ affects ‘{to}’, which isn\'t sized in the model yet.”; for link_existence, “It depends most on whether ‘{from}’ affects ‘{to}’ at all, which Olumi assumed.” Use depends_on.from_label and depends_on.to_label for {from} and {to}. Prefix “Of the links not sized yet, ” when depends_on.among is unsized_links. Never state a single figure for that option, and never compare or order ranges.';
    const horizonRule = 'When goal_horizon_line is present and you state any goal chance or range, add that sentence verbatim once, right after the chance or range.';
    const runRule = HOST_TOOL_CONTRACT.slice(HOST_TOOL_CONTRACT.indexOf('When you report an analysis,'), HOST_TOOL_CONTRACT.indexOf('For a CURRENT saved Run,'));
    const savedRule = HOST_TOOL_CONTRACT.slice(HOST_TOOL_CONTRACT.indexOf('For a CURRENT saved Run,'), HOST_TOOL_CONTRACT.indexOf('Earlier assistant replies can describe a Run'));
    for (const rule of [runRule, savedRule]) {
      expect(rule).toContain(rangeRule);
      expect(rule).toContain(horizonRule);
    }
    expect(HOST_TOOL_CONTRACT).toContain('never express the chance as a percentage of model runs');
    expect(HOST_TOOL_CONTRACT).toContain('Never call an option the winner, the best option or the recommended one.');
    expect(HOST_TOOL_CONTRACT).toContain('Otherwise do not name, rank or hint at one');
    expect(HOST_TOOL_CONTRACT).toContain('Leader permission still governs ranking and naming a leader; never turn per-option facts into a ranking.');
  });
  it('CONTROL: similar licences and whole-percentage displays also work without a leader', async () => {
    const read = fixture([{ ...licence, withheld_option_ids: undefined, form: 'similar', similar_option_ids: [A, B], pct_by_option: { [A]: 44, [B]: 48, [C]: 25 }, display_rounding_by_option: undefined }]);
    const view = await saved(read);
    expect(view.goal_chance_display).toEqual({ [A]: 'about 44%', [B]: 'about 48%', [C]: 'about 25%' });
    expect(view.saved_run_options.find((r: Json) => r.option_id === A).probability_of_goal).toBe(0.44);
  });
  it('CONTROL: a conflicting licence and a missing displayed percentage permit no point figure', async () => {
    noChance(await saved(fixture([licence, licence])));
    noChance(await run(fixture([licence, licence])));
    const read = fixture([{ ...licence, pct_by_option: {} }]);
    noChance(await saved(read));
    noChance(await run(read));
  });
  it('CONTROL: legacy copies never restore a withheld chance or its companions', () => {
    const read = fixture([licence, { code: GOAL_FIGURES_PLACEHOLDER_PATH, option_ids: [C] }]);
    read.analysis_result.enrichment.results = { options: clone(read.analysis_result.enrichment.option_comparison) };
    const view = analysisResultForAgent(read.analysis_result, read.graph) as Json;
    expect(view.enrichment.results).not.toHaveProperty('options');
    expect(view.goal_chance_display).toEqual({ [A]: 'about 45%', [B]: 'about 50%' });
  });
});
