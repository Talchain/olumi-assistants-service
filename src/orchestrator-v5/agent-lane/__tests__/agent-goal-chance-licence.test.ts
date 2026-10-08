import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { goalChanceDriverDisplayForAgent, goalChanceRangeDisplayForAgent } from '../../goal-target/goal-chance-range-agent.js';
import {
  GOAL_CHANCE_COMPANION_KEYS, GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ,
  GOAL_FIGURES_PROBABILITY_UNUSABLE, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_USER_EFFECT_CLAMPED,
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
  [B]: { range: 'between about 31% and 72%', depends_on: { kind: 'link_existence', from_label: 'Support cost', to_label: 'Monthly recurring revenue', among: 'all' } },
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
  read.graph.nodes.push({ id: 'missing_source', kind: 'factor', label: 'Support cost' });
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
  for (const key of ['goal_chance_display', 'goal_chance_licence', 'goal_chance_driver_display', 'goal_chance_range_display', 'goal_horizon_line']) expect(view).not.toHaveProperty(key);
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
  // A Run with NO GOAL_CHANCE_LICENSED record (served before #2625) keeps base behaviour (S2 CI, saved-run-chance 520aab46):
  // no licence facts on either door; the saved door's W3 leader rule (this fixture's leader is withheld → no chance) and the
  // run door's run-wide withhold (none here → the recorded chance stays, as on base).
  it('(4) no licence record: no licence facts; each door keeps its base rule for the raw chance', async () => {
    const read = fixture([horizon]);
    noChance(await saved(read));
    const view = await run(read);
    for (const key of ['goal_chance_display', 'goal_chance_licence', 'goal_chance_driver_display', 'goal_chance_range_display', 'goal_horizon_line']) expect(view).not.toHaveProperty(key);
    expect(view.enrichment.option_comparison.find((r: Json) => r.option_id === A)).toHaveProperty('probability_of_goal');
    for (const row of view.enrichment.option_comparison) noCompanions(row);
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
    // S1 review r1 #4 × S2: the ruled display reaches the model while the raw record it is read from does not.
    expect(JSON.stringify(read)).toContain('"code":"GOAL_CHANCE_RANGE"');
    expect(JSON.stringify(views[1])).not.toContain('"code":"GOAL_CHANCE_RANGE"');
    expect(read).toEqual(before);
  });
  // Codex AMEND (#87 6028220756): a REAL range sits beside the withhold that made it (PR-S1 writes one only there). RED at
  // b0955242: the point predicate barred both codes, so the range never reached the chat.
  const rangeRun = (code: string, withheldBy: string = code): Json => fixture([
    { ...licence, withheld_option_ids: [A, B], pct_by_option: { [C]: 25 }, display_rounding_by_option: { [C]: 'whole' } },
    rangeRecord, { code: withheldBy, severity: 'info', message: 'Withheld for this option.', option_ids: [A, B] },
  ]);
  it.each([GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE])('(7b) the range shows beside its own %s withhold, on both doors', async (code) => {
    const read = rangeRun(code);
    for (const view of [await saved(read), await run(read)]) {
      expect(view.goal_chance_range_display).toEqual(expectedRanges);
      expect(view.goal_chance_display).toEqual({ [C]: 'about 25%' });
    }
  });
  it.each([GOAL_FIGURES_PRODUCT_NOT_READ, GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PROBABILITY_UNUSABLE])('(7c) CONTROL: %s on the same options still bars their range, on both doors', async (code) => {
    const read = fixture([
      { ...licence, withheld_option_ids: [A, B], pct_by_option: { [C]: 25 }, display_rounding_by_option: { [C]: 'whole' } },
      rangeRecord, { code: GOAL_FIGURES_PLACEHOLDER_PATH, severity: 'info', message: 'Withheld.', option_ids: [A, B] },
      { code, severity: 'info', message: 'Not shown.', option_ids: [A, B] },
    ]);
    for (const view of [await saved(read), await run(read)]) expect(view).not.toHaveProperty('goal_chance_range_display');
  });
  // S2 review r1 #1 (Codex AMEND #87 6028260969): the chat's range words are the SCREEN's (DGAI goalChanceRangeLine).
  it.each([
    [0, 40, 'between less than 1% and 40%'], [0, 100, 'between less than 1% and more than 99%'],
    [5, 100, 'between about 5% and more than 99%'], [20, 65, 'between about 20% and 65%'],
  ])('(7d) endpoints %i/%i read as the screen: %s, on both doors', async (low, high, words) => {
    const warning = clone(rangeRecord);
    Object.assign(warning.range_by_option[A], { low_pct: low, high_pct: high, low_rounding: 'whole', high_rounding: 'whole' });
    const read = fixture([licence, warning]);
    for (const view of [await saved(read), await run(read)]) expect(view.goal_chance_range_display[A].range).toBe(words);
  });
  it('(7e) a link label that cannot be resolved drops THAT option’s range (the screen drops the line); never a raw id', async () => {
    const read = fixture([licence, rangeRecord]);
    read.graph.nodes = read.graph.nodes.filter((n: Json) => n.id !== 'missing_source');
    for (const view of [await saved(read), await run(read)]) {
      expect(view.goal_chance_range_display).toEqual({ [A]: expectedRanges[A] });
      expect(JSON.stringify(view.goal_chance_range_display)).not.toContain('missing_source');
    }
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
    expect(await run(fixture([horizon]))).not.toHaveProperty('goal_horizon_line');
    expect(await saved(fixture())).not.toHaveProperty('goal_horizon_line');
    expect(await run(fixture())).not.toHaveProperty('goal_horizon_line');
  });
  it('(10) both reporting rules add the exact range/deadline words and retain the existing bans', () => {
    const rangeRule = 'For other options in goal_chance_range_display, say its range text exactly as given, then “ chance of meeting your goal, in this model” (for example “between less than 1% and 40% chance of meeting your goal, in this model”). Then state what it depends on: for link_strength, “It depends most on how strongly ‘{from}’ affects ‘{to}’, which isn\'t sized in the model yet.”; for link_existence, “It depends most on whether ‘{from}’ affects ‘{to}’ at all, which Olumi assumed.” Use depends_on.from_label and depends_on.to_label for {from} and {to}. Prefix “Of the links not sized yet, ” when depends_on.among is unsized_links. Never state a single figure for that option, and never compare or order ranges.';
    const horizonRule = 'When goal_horizon_line is present and you state any goal chance or range, add that sentence verbatim once, right after the chance or range.';
    const runRule = HOST_TOOL_CONTRACT.slice(HOST_TOOL_CONTRACT.indexOf('When you report an analysis,'), HOST_TOOL_CONTRACT.indexOf('For a CURRENT saved Run,'));
    const savedRule = HOST_TOOL_CONTRACT.slice(HOST_TOOL_CONTRACT.indexOf('For a CURRENT saved Run,'), HOST_TOOL_CONTRACT.indexOf('Earlier assistant replies can describe a Run'));
    for (const rule of [runRule, savedRule]) {
      expect(rule).toContain(rangeRule);
      expect(rule).toContain('use goal_chance_words verbatim');
      expect(rule).toContain('stated_time.chance_words verbatim');
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
    // The number handed over is the Run's recorded figure (base W3 rule, served row (a) in same-run-…); the WORDS come
    // only from goal_chance_display. Present here = the similar form permits the chance without a leader.
    const recorded = read.analysis_result.enrichment.option_comparison.find((r: Json) => r.option_id === A).probability_of_goal;
    expect(recorded).toBe(0.441);
    expect(view.saved_run_options.find((r: Json) => r.option_id === A).probability_of_goal).toBe(recorded);
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

const factorDriver = { kind: 'factor_value', quantity_id: 'factor:pro_plan_price', factor_id: 'pro_plan_price',
  authored_by: 'olumi', side: 'low', cut_value: 1200, cut_unit: 'GBP/month', pct_if_side: 20 };
const strengthDriver = { kind: 'link_strength', quantity_id: 'strength:pro_plan_price->mrr',
  from: 'pro_plan_price', to: 'mrr', authored_by: 'olumi', side: 'low', strength: 'weaker' };
const existenceDriver = { kind: 'link_existence', quantity_id: 'existence:pro_plan_price->mrr',
  from: 'pro_plan_price', to: 'mrr', authored_by: 'olumi', side: 'absent', pct_if_side: 20 };
function driven(driver: Json, extra: Json = {}): Json {
  return fixture([{ ...licence, driver_by_option: { [A]: driver }, ...extra }]);
}

describe('PR-S2 Round 2: screen-exact licensed driver sentences', () => {
  it.each([
    ['A: factor, user', { ...factorDriver, authored_by: 'user' },
      'It rests most on ‘Pro plan price’: if it is below 1,200 GBP/month, the chance falls to about 20%.'],
    ['A: factor, unattributed', { ...factorDriver, authored_by: 'unattributed', side: 'high' },
      'It rests most on ‘Pro plan price’: if it is above 1,200 GBP/month, the chance falls to about 20%.'],
    ['B: factor, Olumi', factorDriver,
      'It rests most on ‘Pro plan price’, using a range Olumi assumed: if it is below 1,200 GBP/month, the chance falls to about 20%. Do you know it more precisely?'],
    ['C: strength, Olumi (RED on round-1 HEAD: both doors omit the sentence)', strengthDriver,
      'It rests most on Olumi’s own estimate of how strongly ‘Pro plan price’ affects ‘Monthly recurring revenue’: if that effect is weaker than Olumi assumed, the chance falls. Is that estimate right?'],
    ['C: strength, user', { ...strengthDriver, authored_by: 'user', side: 'high', strength: 'stronger' },
      'It rests most on how strongly ‘Pro plan price’ affects ‘Monthly recurring revenue’, at the size you set: if that effect is stronger than that, the chance falls. How sure are you of that size?'],
    ['C: strength, unattributed', { ...strengthDriver, authored_by: 'unattributed' },
      'It rests most on how strongly ‘Pro plan price’ affects ‘Monthly recurring revenue’: if that effect is weaker than this model assumes, the chance falls.'],
    ['D: existence, Olumi', existenceDriver,
      'It rests most on Olumi’s own assumption that ‘Pro plan price’ affects ‘Monthly recurring revenue’: in the model runs without that link, the chance is about 20%. Is that right?'],
    ['E: existence, user-stated link', { ...existenceDriver, user_stated_link: true },
      'It rests most on your link from ‘Pro plan price’ to ‘Monthly recurring revenue’: Olumi’s model also allows that it does not hold, and in those runs the chance is about 20%.'],
  ])('%s: exact words on both doors, availability unchanged and raw rows still stripped', async (_case, driver, sentence) => {
    const read = driven(driver as Json);
    const before = clone(read);
    expect(goalChanceDriverDisplayForAgent(read.analysis_result, read.graph)).toEqual({ [A]: sentence });
    for (const view of [await saved(read), await run(read)]) {
      expect(view.goal_chance_driver_display).toEqual({ [A]: sentence });
      expect(view.goal_chance_display).toEqual({ [A]: 'about 45%', [B]: 'about 50%' });
      expect(view.goal_chance_driver_availability).toMatchObject({ status: 'available',
        options: [{ option_id: A, status: 'available' }, { option_id: B, status: 'not_recorded' }] });
      for (const row of view.saved_run_options ?? view.enrichment.option_comparison) noCompanions(row);
      const warning = view.enrichment?.inference_warnings?.find((w: Json) => w.code === licence.code);
      if (warning !== undefined) {
        expect(warning).not.toHaveProperty('driver_by_option');
        expect(warning).not.toHaveProperty('no_driver_by_option');
      }
    }
    expect(read).toEqual(before);
  });
  // S2 review r1 #4: a Run whose leader MAY be named skipped the run door's graph read, so the chat lost the screen's
  // "It rests most on …" (RED at e6327125: the run door's driver display was absent).
  it('(F4) a leader-nameable Run still hands the run door its driver sentence', async () => {
    const read = driven(strengthDriver as Json);
    read.analysis_state.leader_claim = { permitted: true, separation: 'separated' };
    read.analysis_ready = { ...read.analysis_ready, analysis_admission: { ...(read.analysis_ready?.analysis_admission ?? {}), admitted: true, permitted_analysis_mode: 'comparative_leader' } };
    const out = await capabilities(read).runAnalysis(ctx, { reason: 'Run the analysis' }) as Json;
    expect(out.claim_permissions?.leader_may_be_named, 'precondition: a leader may be named on this Run').toBe(true);
    expect(out.result.goal_chance_driver_display).toEqual({ [A]: 'It rests most on Olumi’s own estimate of how strongly ‘Pro plan price’ affects ‘Monthly recurring revenue’: if that effect is weaker than Olumi assumed, the chance falls. Is that estimate right?' });
  });

  it.each([factorDriver, strengthDriver, existenceDriver])('asks once per shared $kind driver in licence order, independently of side', async (driver) => {
    const otherSide = driver.kind === 'factor_value' ? { side: 'high' }
      : driver.kind === 'link_strength' ? { side: 'high', strength: 'stronger' } : {};
    const read = driven(driver, { option_ids: [B, A, C], driver_by_option: { [A]: { ...driver, ...otherSide }, [B]: driver, [C]: driver } });
    for (const view of [await saved(read), await run(read)]) {
      expect(Object.keys(view.goal_chance_driver_display)).toEqual([B, A]);
      expect(view.goal_chance_driver_display[B]).toMatch(/\?$/);
      expect(view.goal_chance_driver_display[A]).toMatch(/\.$/);
    }
  });

  it('a withheld first option does not consume the shared question; a scoped withhold affects only its own id', async () => {
    const read = driven(strengthDriver, { option_ids: [C, B, A], driver_by_option: { [C]: strengthDriver, [B]: strengthDriver, [A]: strengthDriver } });
    read.analysis_result.enrichment.inference_warnings.push({ code: GOAL_FIGURES_PLACEHOLDER_PATH, option_ids: [B] });
    for (const view of [await saved(read), await run(read)]) {
      expect(Object.keys(view.goal_chance_driver_display)).toEqual([A]);
      expect(view.goal_chance_driver_display[A]).toMatch(/ Is that estimate right\?$/);
    }
  });

  it.each([0, 100])('factor and existence edge %s use the screen’s non-certainty words', (pct) => {
    for (const driver of [factorDriver, existenceDriver]) {
      const read = driven({ ...driver, pct_if_side: pct });
      expect(goalChanceDriverDisplayForAgent(read.analysis_result, read.graph)[A])
        .toContain(pct === 0 ? 'less than 1%' : 'more than 99%');
    }
  });

  it.each([
    { ...existenceDriver, authored_by: 'user' }, { ...existenceDriver, authored_by: 'unattributed' },
    { ...existenceDriver, side: 'present' }, { ...strengthDriver, strength: 'stronger' },
    { ...strengthDriver, quantity_id: '' }, { ...factorDriver, cut_value: NaN },
    { ...factorDriver, pct_if_side: 20.5 }, { ...existenceDriver, pct_if_side: 101 },
    { ...factorDriver, authored_by: 'someone' },
  ])('no sentence for an unruled or invalid licensed entry %j', async (driver) => {
    const read = driven(driver);
    expect(goalChanceDriverDisplayForAgent(read.analysis_result, read.graph)).toEqual({});
    for (const view of [await saved(read), await run(read)]) expect(view).not.toHaveProperty('goal_chance_driver_display');
  });

  it.each(['factor_id', 'from', 'to'])('an unresolved %s label suppresses the sentence, with no id fallback', async (field) => {
    const driver = field === 'factor_id' ? factorDriver : strengthDriver;
    const read = driven({ ...driver, [field]: 'unresolved' });
    for (const view of [await saved(read), await run(read)]) expect(view).not.toHaveProperty('goal_chance_driver_display');
  });

  it('blank graph labels and absent graph suppress sentences', () => {
    const read = driven(strengthDriver);
    read.graph.nodes.find((n: Json) => n.id === 'mrr').label = '   ';
    expect(goalChanceDriverDisplayForAgent(read.analysis_result, read.graph)).toEqual({});
    expect(goalChanceDriverDisplayForAgent(read.analysis_result, undefined)).toEqual({});
  });

  it('only stored licensed drivers speak; unlicensed ids, withheld ids, conflicting entries and raw rows cannot supply a sentence', async () => {
    const read = driven(strengthDriver, { driver_by_option: { [A]: strengthDriver, [B]: strengthDriver,
      [C]: strengthDriver, unknown_option: strengthDriver }, no_driver_by_option: { [A]: 'none' } });
    for (const view of [await saved(read), await run(read)]) {
      expect(Object.keys(view.goal_chance_driver_display)).toEqual([B]);
      expect(view.goal_chance_driver_display[B]).toMatch(/\?$/);
    }
    const rawOnly = fixture();
    rawOnly.analysis_result.enrichment.option_comparison[0].probability_of_goal_drivers = { rows: [strengthDriver] };
    for (const view of [await saved(rawOnly), await run(rawOnly)]) expect(view).not.toHaveProperty('goal_chance_driver_display');
  });

  it('driver display stays absent without point display: stale, range, no chance, no licence, duplicate licence or run-wide withhold', async () => {
    const reads = [driven(strengthDriver), driven(strengthDriver), driven(strengthDriver, { pct_by_option: {} }),
      fixture(), driven(strengthDriver), driven(strengthDriver), driven(strengthDriver)];
    reads[0]!.analysis_state.run_state.kind = 'complete_stale';
    reads[1]!.analysis_result.enrichment.inference_warnings.push(clone(rangeRecord));
    reads[3]!.analysis_result.enrichment.inference_warnings = [];
    reads[4]!.analysis_result.enrichment.inference_warnings.push(clone(licence));
    reads[5]!.analysis_result.enrichment.inference_warnings.push({ code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, option_ids: [C] });
    reads[6]!.analysis_result.enrichment.inference_warnings.push({ code: GOAL_FIGURES_USER_EFFECT_CLAMPED, option_ids: [C] });
    for (const read of reads) for (const view of [await saved(read), await run(read)]) {
      expect(view).not.toHaveProperty('goal_chance_display');
      expect(view).not.toHaveProperty('goal_chance_driver_display');
    }
  });

  it('a top-level stored licence supplies the run-turn sentence, including alongside the unchanged deadline', () => {
    const read = driven(strengthDriver);
    const result = { inference_warnings: [...read.analysis_result.enrichment.inference_warnings, horizon] };
    expect(analysisResultForAgent(result, read.graph)).toMatchObject({
      goal_chance_display: { [A]: 'about 45%' }, goal_horizon_line: horizonLine,
      goal_chance_driver_display: goalChanceDriverDisplayForAgent(result, read.graph),
    });
  });

  it('both reporting rules contain the exact driver rule, with the old bans retained', () => {
    const driverRule = "When you state an option's chance and goal_chance_driver_display has a sentence for that option, say that sentence exactly, right after the chance (before any deadline sentence). While goal_chance_driver_display has any sentence, never say that no assumption is established, measurable, or most worth investigating, in any wording.";
    const runRule = HOST_TOOL_CONTRACT.slice(HOST_TOOL_CONTRACT.indexOf('When you report an analysis,'), HOST_TOOL_CONTRACT.indexOf('For a CURRENT saved Run,'));
    const savedRule = HOST_TOOL_CONTRACT.slice(HOST_TOOL_CONTRACT.indexOf('For a CURRENT saved Run,'), HOST_TOOL_CONTRACT.indexOf('Earlier assistant replies can describe a Run'));
    for (const rule of [runRule, savedRule]) expect(rule).toContain(driverRule);
    expect(HOST_TOOL_CONTRACT).toContain('Never call an option the winner, the best option or the recommended one.');
    expect(HOST_TOOL_CONTRACT).toContain('Otherwise do not name, rank or hint at one');
    expect(HOST_TOOL_CONTRACT).toContain('never express the chance as a percentage of model runs');
    expect(HOST_TOOL_CONTRACT).toContain('Leader permission still governs ranking and naming a leader; never turn per-option facts into a ranking.');
    expect(HOST_TOOL_CONTRACT).toContain('Name an assumption the ordering is sensitive to ONLY from the result’s `decision_sensitivity`');
    expect(HOST_TOOL_CONTRACT).toContain('Never translate either EVPPI status into no measurable assumption or no measurable goal-chance driver');
    expect(HOST_TOOL_CONTRACT).toContain('This availability grants no permission to name or rank a driver or an option.');
  });
});
