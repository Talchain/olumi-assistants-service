import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  goalChanceLicenceOf, goalChanceLicenceForAgent, sentGoalThresholdOf, withGoalChanceLicence,
  SPREAD_NOTE_WITHOUT_DOWNSIDE, type SentGoalThreshold,
} from '../goal-chance-licence.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../../agent-lane/goal-chance-screen-lines.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import { ContextPackRunDeltaSchema } from '../../context/context-pack-schema.js';
import { RunDeltaSchema } from '@talchain/schemas/boundary';

type Json = Record<string, any>;
const capture = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/waveB-pilot-t1b-86ccaf3-turn003.json', import.meta.url), 'utf8')) as Json;
const clone = <T>(v: T): T => structuredClone(v);
const GOAL = 'monthly_recurring_revenue';
const A = 'launch_starter_tier';
const B = 'raise_prices_by_10';
const SQ = 'keep_pricing_as_it_is';
const graph = (): Json => {
  const g = clone(capture.draft_graph);
  // Constructed level-frame inputs only; production records the raw-samples delta frame.
  g.nodes.find((n: Json) => n.id === GOAL).goal_baseline = 120000;
  return g;
};
const goal = (g: Json): Json => g.nodes.find((n: Json) => n.id === GOAL);
const records = (): Json[] => clone(capture.blocks.find((b: Json) => b.type === 'analysis_result').enrichment.option_comparison);
const earned = (id: string, p: 0 | 1): boolean => id === SQ && p === 0;
const delta: SentGoalThreshold = { value: 126000, field: 'goal_threshold_raw', frame: 'delta' };
const level: SentGoalThreshold = { ...delta, frame: 'level', baseline: 120000, status_quo_option_id: SQ };
// Author-constructed reversal from the served records. The existing graph's existence-prior withhold gives `each`.
const trigger = (): Json[] => records().map(r => r.option_id === B ? { ...r, probability_of_goal: 0.55 }
  : r.option_id === A ? { ...r, probability_of_goal: 0.45 } : r);
const licence = (rs = trigger(), sent: SentGoalThreshold | undefined = delta, g = graph()) =>
  goalChanceLicenceOf({ option_comparison: rs }, g, GOAL, earned, sent)!;
const noNote = (l: ReturnType<typeof licence>): void => {
  expect(l).not.toHaveProperty('spread_note_by_option');
};

const noRecordedThreshold = (l: ReturnType<typeof licence>): void => {
  noNote(l); expect(l).not.toHaveProperty('sent_threshold');
};

describe('spread-driven chance note — recorded scoring frame, point licence only', () => {
  it('served T1b candidates: only raw agrees, recorded on the delta frame without a note', () => {
    const g = graph(); goal(g).goal_threshold = 0.8;
    const envelope = { option_comparison: records() };
    const sent = sentGoalThresholdOf(envelope, g, GOAL, earned);
    expect(sent).toEqual(delta);
    const l = goalChanceLicenceOf(envelope, g, GOAL, earned, sent)!;
    expect(l.sent_threshold).toEqual(delta);
    noNote(l);
    expect(goalChanceLicenceForAgent({ inference_warnings: [l] })!.sent_threshold).toEqual(delta);
  });
  it('same candidates with constructed reversal: raw recorded, note on B only', () => {
    const g = graph(); goal(g).goal_threshold = 0.8;
    const envelope = { option_comparison: trigger() };
    const sent = sentGoalThresholdOf(envelope, g, GOAL, earned);
    const l = goalChanceLicenceOf(envelope, g, GOAL, earned, sent)!;
    expect(l.sent_threshold).toEqual(delta);
    expect(l.spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
  });
  it.each(['both', 'neither'] as const)('%s candidates agree: no recorded threshold and no note', mode => {
    const g = graph();
    goal(g).goal_threshold = mode === 'both' ? 126001 : 0.8;
    if (mode === 'neither') goal(g).goal_threshold_raw = 0.9;
    const envelope = { option_comparison: trigger() };
    const sent = sentGoalThresholdOf(envelope, g, GOAL, earned);
    expect(sent).toBeUndefined();
    const l = goalChanceLicenceOf(envelope, g, GOAL, earned, sent)!;
    expect(l).not.toHaveProperty('sent_threshold'); noNote(l);
  });
  it('one licensed option disagreeing or lacking percentiles rejects the candidate for the whole Run', () => {
    for (const p10 of [127000, undefined, NaN]) {
      const g = graph(); goal(g).goal_threshold = 0.8;
      const rs = trigger(); rs.find(r => r.option_id === A)!.outcome.p10 = p10;
      expect(sentGoalThresholdOf({ option_comparison: rs }, g, GOAL, earned)).toBeUndefined();
    }
  });
  it('served T1b: the closer mean does not have a lower displayed chance, so no note', () => {
    expect(licence(records(), level).form).toBe('each');
    noNote(licence(records(), level));
    noNote(licence(records(), delta));
    noNote(licence(trigger(), level, capture.draft_graph));
  });
  it('constructed T1b reversal: exact long words on B only, after its chance; transformed level supported', () => {
    expect(licence().spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
    expect(licence(trigger(), level).spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
    expect(licence().sent_threshold).toEqual(delta);
  });
  // Science B19 ruling (3): the short words in EVERY case, a finite downside included (the retired variant never returns).
  it.each([undefined, {}, { p05: NaN }, { p05: Infinity }, { p05: 0.62, cvar_10: 0.55 }])('downside %j: the exact short words, never "(see its downside)"', downside => {
    const rs = trigger(); rs.find(r => r.option_id === B)!.downside = downside;
    expect(licence(rs).spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
    expect(JSON.stringify(licence(rs))).not.toContain('see its downside');
  });
  it('at most mirror: a mean above the ceiling with higher chance than the closer mean', () => {
    const g = graph(); goal(g).goal_direction = '<=';
    const rs = trigger().map(r => ({ ...r, probability_of_goal: r.option_id === SQ ? 0 : r.probability_of_goal,
      outcome: { ...r.outcome, mean: 252000 - r.outcome.mean, p10: 252000 - r.outcome.p90, p90: 252000 - r.outcome.p10 } }));
    const l = goalChanceLicenceOf({ option_comparison: rs }, g, GOAL, () => true, delta)!;
    expect(l.spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
  });
  it('normalised 0.7 threshold against £ samples fails the Run-wide scale check', () => {
    const g = graph(); goal(g).goal_threshold = 0.7;
    noRecordedThreshold(licence(trigger(), { ...delta, field: 'goal_threshold', value: 0.7 }, g));
  });
  it('sent threshold absent, frame absent or invalid, or mismatching graph field: nothing', () => {
    noRecordedThreshold(goalChanceLicenceOf({ option_comparison: trigger() }, graph(), GOAL, earned)!);
    for (const sent of [{ value: 126000, field: 'goal_threshold_raw' }, { ...delta, frame: 'unknown' }, { ...delta, value: 125000 }]) {
      noRecordedThreshold(licence(trigger(), sent as SentGoalThreshold));
    }
  });
  it('level baseline or status-quo input/mean missing or non-finite: nothing', () => {
    for (const sent of [{ ...level, baseline: undefined }, { ...level, baseline: Infinity }, { ...level, baseline: 119000 }, { ...level, status_quo_option_id: undefined }, { ...level, status_quo_option_id: A }]) {
      noRecordedThreshold(licence(trigger(), sent));
    }
    const rs = trigger(); delete rs.find(r => r.option_id === SQ)!.outcome.mean;
    noRecordedThreshold(licence(rs, level));
    const g = graph(); delete g.nodes.find((n: Json) => n.id === SQ).is_baseline;
    noRecordedThreshold(licence(trigger(), level, g));
  });
  it('same samples: delta mean falls short, level mean passes; percentiles use the same transform', () => {
    const rs = trigger();
    // SQ is 120000, so the level adjustment is +1000: B becomes 126737.54, past 126000.
    expect(licence(rs, delta).spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
    const shifted = graph(); goal(shifted).goal_baseline = 121000;
    noNote(licence(rs, { ...level, baseline: 121000 }, shifted));
    // -30000 shifts every percentile below t; the midrange chances disagree and silence the whole Run.
    goal(shifted).goal_baseline = 90000;
    noNote(licence(rs, { ...level, baseline: 90000 }, shifted));
  });
  it('stretch goal, all means short, but no reversal: no note', () => {
    const rs = trigger(); rs.find(r => r.option_id === B)!.probability_of_goal = 0.45;
    rs.find(r => r.option_id === A)!.probability_of_goal = 0.55;
    expect(rs.every(r => r.outcome.mean < delta.value)).toBe(true);
    noNote(licence(rs));
  });
  it('displayed equal chances, or B mean at/past threshold: no note', () => {
    const rs = trigger(); rs.find(r => r.option_id === A)!.probability_of_goal = 0.549;
    noNote(licence(rs));
    const equalMeans = trigger(); equalMeans.find(r => r.option_id === A)!.outcome.mean = equalMeans.find(r => r.option_id === B)!.outcome.mean;
    noNote(licence(equalMeans));
    for (const mean of [126000, 126050]) {
      const copy = trigger(); copy.find(r => r.option_id === B)!.outcome.mean = mean;
      // A still supplies the reversal half, so this row specifically binds B's mean-beyond guard.
      copy.find(r => r.option_id === A)!.outcome.mean = mean + 100;
      noNote(licence(copy));
    }
  });
  it.each([A, B])('withheld option %s cannot supply either half of the reversal', id => {
    const rs = trigger(); delete rs.find(r => r.option_id === id)!.probability_of_goal;
    noNote(licence(rs));
  });
  it('withheld SQ may still supply its recorded reference mean, never a chance or a note', () => {
    const l = goalChanceLicenceOf({ option_comparison: trigger() }, graph(), GOAL, () => false, level)!;
    expect(l.withheld_option_ids).toContain(SQ);
    expect(l.spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
  });
  it('one licensed option with missing/non-finite figures or inconsistent percentiles silences the Run', () => {
    for (const [key, value] of [['mean', undefined], ['p10', NaN], ['p90', Infinity], ['p10', 200000]] as const) {
      const rs = trigger(); rs.find(r => r.option_id === A)!.outcome[key] = value;
      noRecordedThreshold(licence(rs));
    }
    const rs = trigger(); rs.find(r => r.option_id === A)!.outcome.p10 = 127000;
    noRecordedThreshold(licence(rs));
  });
  it('forms hiding per-option point lines never carry a note', () => {
    const g = graph(); g.edges = [];
    const rs = trigger(); rs.forEach(r => { delete r.probability_of_goal_precision; });
    const l = licence(rs, delta, g);
    expect(l.form).toBe('highest'); noNote(l);
  });
  it('chat: B chance ends with the note once; an existing chance sentence gains it without repeating the chance', () => {
    const g = graph();
    const result = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, level);
    const lines = goalChanceScreenLinesForAgent(result, g, true);
    const b = lines.find(l => l.option_id === B)!;
    expect(b.chance.endsWith(SPREAD_NOTE_WITHOUT_DOWNSIDE)).toBe(true);
    expect(lines.filter(l => l.chance.includes(SPREAD_NOTE_WITHOUT_DOWNSIDE))).toHaveLength(1);
    const text = withScreenLinesOwed('', lines).text;
    expect(text.split(SPREAD_NOTE_WITHOUT_DOWNSIDE)).toHaveLength(2);
    expect(withScreenLinesOwed(text, lines)).toEqual({ text, added: 0 });
    const chanceOnly = b.chance.slice(0, -SPREAD_NOTE_WITHOUT_DOWNSIDE.length).trimEnd();
    const completed = withScreenLinesOwed(chanceOnly, [b]).text;
    expect(completed).toBe(b.chance);
    expect(withScreenLinesOwed(completed, [b]).added).toBe(0);
    const phrased = `${b.label}: ${b.figure}.`;
    const phrasedDone = withScreenLinesOwed(phrased, [b]).text;
    expect(phrasedDone).toBe(`${phrased} ${SPREAD_NOTE_WITHOUT_DOWNSIDE}`);
    expect(withScreenLinesOwed(phrasedDone, [b]).added).toBe(0);
    const orphan = withScreenLinesOwed(`${SPREAD_NOTE_WITHOUT_DOWNSIDE}\n${chanceOnly}`, [b]).text;
    expect(orphan.split(SPREAD_NOTE_WITHOUT_DOWNSIDE)).toHaveLength(2);
    expect(orphan).toContain(b.chance);
    expect(goalChanceScreenLinesForAgent(result, g, false)).toEqual([]);
    expect(b.chance).not.toContain(B);
  });
  it('licence and Agent result projection keep the recorded frame and note; malformed notes stay silent', () => {
    const g = graph(); const result = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, level);
    const projected = goalChanceLicenceForAgent(result)!;
    expect(projected.sent_threshold).toEqual(level);
    expect(projected.spread_note_by_option).toEqual({ [B]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
    const model = analysisResultForAgent(result, g) as Json;
    expect(model.goal_chance_licence).toMatchObject(projected);
    const malformed = clone(result) as Json;
    malformed.inference_warnings[0].spread_note_by_option[B] = B;
    expect(goalChanceLicenceForAgent(malformed)).not.toHaveProperty('spread_note_by_option');
  });
  it('run-delta projection guard: additions to the warning carrier do not alter its permitted key set', () => {
    const omitted = new Set(['flip_thresholds', 'endpoints', 'input_changes', 'input_coverage', 'win_probabilities_unavailable', 'goal_chances']);
    expect(Object.keys(ContextPackRunDeltaSchema.shape).sort()).toEqual(Object.keys(RunDeltaSchema.innerType().shape).filter(k => !omitted.has(k)).sort());
  });
});

describe('saved Runs from before #2786 (Codex r4 on #2783)', () => {
  it('the retired "(see its downside)" note is read as the short words; any other text still drops the map', async () => {
    const { goalChanceLicenceForAgent: forAgent } = await import('../goal-chance-licence.js');
    const g = graph();
    const result = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, delta) as Json;
    const rec = result.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    const id = Object.keys(rec.spread_note_by_option ?? {})[0];
    expect(id, 'control: the fixture licenses a spread note').toBeDefined();
    rec.spread_note_by_option = { [id!]: 'Its typical result falls short of your target: this chance comes from its wider spread, which also widens how far short it could fall (see its downside).' };
    expect(forAgent(result)?.spread_note_by_option).toEqual({ [id!]: SPREAD_NOTE_WITHOUT_DOWNSIDE });
    rec.spread_note_by_option = { [id!]: 'Its spread is wide.' };
    expect(forAgent(result)?.spread_note_by_option).toBeUndefined();
  });
});
