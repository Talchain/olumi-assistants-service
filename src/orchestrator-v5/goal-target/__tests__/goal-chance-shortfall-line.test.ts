import { describe, expect, it } from 'vitest';
import {
  floorSig2, goalChanceLicenceForAgent, goalChanceLicenceOf, shortfallNoteLabel, withGoalChanceLicence,
  type SentGoalThreshold,
} from '../goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { sayFigureAsWritten } from '../../agent-lane/say-figure.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const GOAL = 'monthly_recurring_revenue';
const RAISE = 'raise';
const STARTER = 'starter';
const KEEP = 'keep';
const CAP = 157500;
const UNIT = '£/month'; // T1b's goal_threshold_unit, not a second formatter's unit.
const RAISE_LINE = 'In its worst 1 in 20 runs of this model, ‘Raise prices 10%’ falls short of your target by £15,000 / month or more.';
const KEEP_LINE = 'In this model, ‘Keep pricing as is’ falls short of your target in almost every run, typically by about £6,000 / month.';

// Author-constructed from Science 393023's T1b p05-d1 numbers; not a re-recording of a different served Run.
const fixture = (): { graph: Json; envelope: Json; sent: SentGoalThreshold } => ({
  graph: {
    nodes: [
      { id: GOAL, kind: 'goal', label: 'Monthly recurring revenue', goal_direction: '>=', goal_threshold_cap: CAP,
        goal_threshold_raw: 126000, goal_threshold: 0.8, goal_threshold_unit: UNIT, goal_threshold_frame: 'level' },
      { id: RAISE, kind: 'option', label: 'Raise prices 10%', interventions: { factor: 1 } },
      { id: STARTER, kind: 'option', label: 'Launch starter tier', interventions: { factor: 2 } },
      { id: KEEP, kind: 'option', label: 'Keep pricing as is', is_baseline: true, interventions: { factor: 0 } },
      { id: 'factor', kind: 'factor', label: 'Revenue driver' },
    ],
    // The existing summary prior withhold makes the known-answer Run `each` without tampering with its point chances.
    edges: [{ from: 'factor', to: GOAL, exists_probability: 0.8, strength: { mean: 1, std: 0.1 } }],
  },
  envelope: { option_comparison: [
    { option_id: RAISE, probability_of_goal: 0.48, downside: { p05: 110911.4 / CAP },
      outcome: { p10: 113768, p50: 124830, mean: 124830, p90: 136000 } },
    { option_id: STARTER, probability_of_goal: 0.99, downside: { p05: 126414 / CAP },
      outcome: { p10: 126500, p50: 132000, mean: 132000, p90: 140000 } },
    { option_id: KEEP, probability_of_goal: 0, downside: { p05: 120000 / CAP },
      outcome: { p10: 120000, p50: 120000, mean: 120000, p90: 120000 } },
  ] },
  sent: { value: 126000, field: 'goal_threshold_raw', frame: 'delta' },
});
type Fixture = ReturnType<typeof fixture>;
const goal = (f: Fixture): Json => f.graph.nodes.find((n: Json) => n.id === GOAL);
const option = (f: Fixture, id = RAISE): Json => f.envelope.option_comparison.find((r: Json) => r.option_id === id);
const earned = (id: string, p: 0 | 1): boolean => id === KEEP && p === 0;
const licence = (f = fixture()) => goalChanceLicenceOf(f.envelope, f.graph, GOAL, earned, f.sent)!;
const positive = (f: Fixture): void => expect(licence(f).shortfall_note_by_option?.[RAISE]).toBe(RAISE_LINE);
const absent = (f: Fixture, id = RAISE): void => expect(licence(f).shortfall_note_by_option?.[id]).toBeUndefined();

describe('B19 goal-relative shortfall — one licensed point option at a time', () => {
  it('T1b p05-d1: Raise £15,000; Starter q05 past target none; Keep typically £6,000', () => {
    const f = fixture(); const l = licence(f);
    expect(l.form).toBe('each');
    expect(l.pct_by_option).toEqual({ [RAISE]: 48, [STARTER]: 99, [KEEP]: 0 });
    expect(l.shortfall_note_by_option).toEqual({ [RAISE]: RAISE_LINE, [KEEP]: KEEP_LINE });
    expect(sayFigureAsWritten(15000, l.target.unit)).toBe('£15,000 / month');
    expect(l.sent_threshold).toEqual(f.sent);
  });
  it('recorded delta positive control → level frame suppresses every shortfall', () => {
    const f = fixture(); positive(f); f.sent = { ...f.sent, frame: 'level' };
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('recorded threshold positive control → missing or mismatching threshold cannot license a line', () => {
    const f = fixture(); positive(f);
    expect(goalChanceLicenceOf(f.envelope, f.graph, GOAL, earned)).not.toHaveProperty('shortfall_note_by_option');
    f.sent = { ...f.sent, value: 125999 }; absent(f);
  });
  it('verified cap positive control → t×cap≠raw suppresses the Run', () => {
    const f = fixture(); positive(f); goal(f).goal_threshold = 0.79;
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('scale-map tolerance has a positive control inside and one-field negative outside', () => {
    const f = fixture(); goal(f).goal_threshold = (126000 + 0.0001) / CAP; positive(f);
    goal(f).goal_threshold = (126000 + 0.0002) / CAP;
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it.each([undefined, 0, -1, NaN, Infinity])('cap %s: finite positive control → invalid map', cap => {
    const f = fixture(); positive(f); goal(f).goal_threshold_cap = cap;
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('p05×cap≤p10 positive control → mismatched option only withheld', () => {
    const f = fixture(); positive(f); option(f).downside.p05 = 114000 / CAP;
    absent(f); expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE);
  });
  it('negative p10 uses p10 + 1e-6×|p10|, with one-field outside-tolerance control', () => {
    const f = fixture(); goal(f).goal_threshold_raw = -126000; goal(f).goal_threshold = -0.8;
    f.sent = { ...f.sent, value: -126000 }; option(f).outcome.p10 = -150000;
    option(f).downside.p05 = -149999.9 / CAP;
    expect(licence(f).shortfall_note_by_option?.[RAISE]).toContain('£23,000 / month or more.');
    option(f).downside.p05 = -149999.8 / CAP; absent(f);
  });
  it.each([undefined, {}, { p05: NaN }, { p05: Infinity }])('downside %j: positive control → unreadable quantile', downside => {
    const f = fixture(); positive(f); option(f).downside = downside; absent(f);
    expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE);
  });
  it('correlation_model empty positive control → non-empty block silences every option', () => {
    const f = fixture(); f.envelope.correlation_model = {}; positive(f);
    f.envelope.correlation_model = { groups: [{ factor_ids: ['factor', 'other'], rho: 0.5 }] };
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it.each([null, undefined])('correlation_model %s: no correlation block keeps the known answer', correlation => {
    const f = fixture(); f.envelope.correlation_model = correlation; positive(f);
  });
  it.each([false, 'unknown', []])('malformed correlation_model %j fails closed after valid empty control', correlation => {
    const f = fixture(); f.envelope.correlation_model = {}; positive(f); f.envelope.correlation_model = correlation;
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('sent graph empty correlation block positive control → populated block silences the Run', () => {
    const f = fixture(); f.graph.factor_correlations = []; positive(f);
    f.graph.factor_correlations = [{ factor_a: 'factor', factor_b: 'other', correlation: 0.5 }];
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('scalar correlation_active:false diagnostic is not a correlation block', () => {
    const f = fixture(); f.envelope.factor_evppi = [{ correlation_active: false }]; positive(f);
  });
  it('at_least positive control → above comparator has no shortfall', () => {
    const f = fixture(); positive(f); goal(f).goal_direction = '>';
    expect(licence(f).target.comparator).toBe('above');
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it.each(['<=', '<'])('comparator %s cannot license a lower-tail shortfall', direction => {
    const f = fixture(); positive(f); goal(f).goal_direction = direction;
    expect(goalChanceLicenceOf(f.envelope, f.graph, GOAL, earned, f.sent)?.shortfall_note_by_option).toBeUndefined();
  });
  it('licensed point positive control → withheld option loses only its line', () => {
    const f = fixture(); positive(f); delete option(f).probability_of_goal;
    expect(licence(f).withheld_option_ids).toContain(RAISE); absent(f);
    expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE);
  });
  it.each(['withheld', 'range'] as const)('%s path cannot carry a shortfall beside a surviving raw probability', mode => {
    const f = fixture(); positive(f);
    f.envelope.inference_warnings = [mode === 'withheld'
      ? { code: GOAL_FIGURES_PLACEHOLDER_PATH, option_ids: [RAISE] }
      : { code: 'GOAL_CHANCE_RANGE', option_ids: [RAISE], range_by_option: { [RAISE]: {} } }];
    absent(f); expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE);
  });
  it('each positive control → highest (only existence probability differs) has no per-option line', () => {
    const f = fixture(); positive(f); f.graph.edges[0].exists_probability = 1;
    expect(licence(f).form).toBe('highest');
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('each positive control → similar (only existence probability differs) has no per-option line', () => {
    const f = fixture(); option(f).probability_of_goal = 0.55; option(f, STARTER).probability_of_goal = 0.56;
    option(f, KEEP).probability_of_goal = 0.51; positive(f);
    f.graph.edges[0].exists_probability = 1;
    expect(licence(f).form).toBe('similar');
    expect(licence(f)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('positive shortfall → X rounds to zero at the target (only p05 differs)', () => {
    const f = fixture(); option(f).outcome.p10 = 126000; option(f).downside.p05 = 125999 / CAP;
    expect(licence(f).shortfall_note_by_option?.[RAISE]).toContain('£1 / month or more.');
    option(f).downside.p05 = 126000 / CAP; absent(f);
  });
  it('below-target q05 positive control → q05 above target has no line', () => {
    const f = fixture(); option(f).outcome.p10 = 127000; positive(f);
    option(f).downside.p05 = 126001 / CAP; absent(f);
  });
  it('99% below-target control → displayed more than 99% suppresses a line', () => {
    const f = fixture(); option(f).probability_of_goal = 0.99; positive(f);
    option(f).probability_of_goal = 0.999; absent(f);
  });
  it.each([NaN, Infinity, 126000, 127000])('less than 1%% median %s suppresses non-positive/unreadable Y', p50 => {
    const f = fixture(); expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE);
    option(f, KEEP).outcome.p50 = p50; absent(f, KEEP);
  });
  it('less than 1% uses raw p50, nearest two significant figures and the same target formatter', () => {
    const f = fixture(); option(f, KEEP).outcome.p50 = 120040;
    expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE); // 5,960 → about 6,000, not 5,900.
  });
  it('no-unit goals are already unlicensed; no no-unit template is built', () => {
    const f = fixture(); positive(f); delete goal(f).goal_threshold_unit;
    expect(goalChanceLicenceOf(f.envelope, f.graph, GOAL, earned, f.sent)).toBeNull();
  });
  it('missing option graph label positive control → only that note suppressed', () => {
    const f = fixture(); positive(f); delete f.graph.nodes.find((n: Json) => n.id === RAISE).label;
    absent(f); expect(licence(f).shortfall_note_by_option?.[KEEP]).toBe(KEEP_LINE);
  });
  it('noncurrent selected Run exposes no chance or shortfall lines', () => {
    const f = fixture(); const result = withGoalChanceLicence(f.envelope, f.graph, GOAL, earned, f.sent);
    expect(goalChanceScreenLinesForAgent(result, f.graph, true).find(l => l.option_id === RAISE)?.shortfall_note).toBe(RAISE_LINE);
    expect(goalChanceScreenLinesForAgent(result, f.graph, false)).toEqual([]);
  });
});

describe('B19 rounding — DOWN means a conservative bound, not nearest', () => {
  it.each([
    [15088.6, 15000], [15099.99, 15000], [15960, 15000], [9999, 9900], [0.0347, 0.034],
    [15000, 15000], [14999.999, 14000], [16000, 16000], [15999.999, 15000],
    [10000, 10000], [1000, 1000], [999.999, 990], [100, 100], [10, 10], [1, 1],
    [0.1, 0.1], [0.01, 0.01], [0.034, 0.034], [0.033999, 0.033], [0.29, 0.29],
    [0, 0], [-1, 0], [NaN, 0], [Infinity, 0],
  ])('floorSig2(%s) = %s', (x, rounded) => expect(floorSig2(x)).toBe(rounded));
  it.each([[15099.99, 15000], [15960, 15000]])('X=%s produces £%s, never a rounded-up tail bound', (x, rounded) => {
    const f = fixture(); option(f).downside.p05 = (126000 - x) / CAP;
    expect(licence(f).shortfall_note_by_option?.[RAISE]).toBe(RAISE_LINE);
    expect(sayFigureAsWritten(rounded, UNIT)).toBe('£15,000 / month');
  });
  it.each([0.000059, 0.000599])('formatter-limited X=%s stays silent rather than zero or an increased bound', x => {
    const f = fixture(); option(f).outcome.p10 = 126000; option(f).downside.p05 = (126000 - x) / CAP; absent(f);
  });
  it('numeric £1 shortfall positive control → binary unit 0/1 suppresses a nonnumeric figure', () => {
    const f = fixture();
    goal(f).goal_threshold_cap = 1; goal(f).goal_threshold_raw = 1; goal(f).goal_threshold = 1;
    f.sent = { ...f.sent, value: 1 };
    option(f).downside.p05 = 0;
    option(f).outcome = { p10: 0, p50: 0, mean: 0, p90: 1 };
    const l = licence(f);
    expect(l.form).toBe('each');
    expect(l.pct_by_option[RAISE]).toBe(48);
    expect(l.shortfall_note_by_option?.[RAISE]).toBe(
      'In its worst 1 in 20 runs of this model, ‘Raise prices 10%’ falls short of your target by £1 / month or more.',
    );
    goal(f).goal_threshold_unit = '0/1';
    expect(sayFigureAsWritten(1, '0/1')).toBe('on');
    expect(licence(f).pct_by_option[RAISE]).toBe(48);
    absent(f);
  });
});

describe('B19 stored Agent licence — exact template and licensed option identities', () => {
  const result = (): Json => structuredClone({ inference_warnings: [licence()] });
  it('both exact templates survive with the recorded delta frame', () => {
    expect(goalChanceLicenceForAgent(result())?.shortfall_note_by_option).toEqual({ [RAISE]: RAISE_LINE, [KEEP]: KEEP_LINE });
  });
  it.each([
    RAISE_LINE.replace('worst 1 in 20', 'worst 1 in 10'), RAISE_LINE.replace(' or more.', '.'),
    RAISE_LINE.replace('In its', 'In our'), RAISE_LINE.replace('model,', 'model;'),
    `${RAISE_LINE} Extra advice.`, `Preface. ${RAISE_LINE}`, `${RAISE_LINE}\n`, 15000,
  ])('tampered shortfall %j drops the entire note map', note => {
    const r = result(); expect(goalChanceLicenceForAgent(r)?.shortfall_note_by_option).toBeDefined();
    r.inference_warnings[0].shortfall_note_by_option[RAISE] = note;
    expect(goalChanceLicenceForAgent(r)).not.toHaveProperty('shortfall_note_by_option');
  });
  it.each(['unknown', 'withheld', 'unlicensed', 'invalid_pct', 'certain', 'level', 'above'])('%s entry fails closed after licensed control', mode => {
    const r = result(); expect(goalChanceLicenceForAgent(r)?.shortfall_note_by_option).toBeDefined();
    const l = r.inference_warnings[0];
    if (mode === 'unknown') l.shortfall_note_by_option.unknown = RAISE_LINE;
    if (mode === 'withheld') l.withheld_option_ids = [RAISE];
    if (mode === 'unlicensed') delete l.pct_by_option[RAISE];
    if (mode === 'invalid_pct') l.pct_by_option[RAISE] = 48.5;
    if (mode === 'certain') l.pct_by_option[RAISE] = 100;
    if (mode === 'level') l.sent_threshold.frame = 'level';
    if (mode === 'above') l.target.comparator = 'above';
    expect(goalChanceLicenceForAgent(r)).not.toHaveProperty('shortfall_note_by_option');
  });
  it('templates return the literal label for downstream graph binding', () => {
    expect(shortfallNoteLabel(RAISE_LINE)).toBe('Raise prices 10%');
    expect(shortfallNoteLabel(KEEP_LINE)).toBe('Keep pricing as is');
  });
});
