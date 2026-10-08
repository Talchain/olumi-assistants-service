import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  goalChanceLicenceOf, goalChanceLicenceForAgent, sentGoalThresholdOf, withGoalChanceLicence,
  SPREAD_NOTE_WITHOUT_DOWNSIDE, type SentGoalThreshold,
} from '../goal-chance-licence.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../../agent-lane/goal-chance-screen-lines.js';
import { withEstimateGoalPointsAtEgress } from '../../agent-lane/goal-chance-estimate-egress.js';
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
  it('one option’s invalid spread figures silence spread Run-wide, while another option keeps its licensed shortfall', () => {
    for (const [key, value] of [['mean', undefined], ['p10', NaN], ['p90', Infinity], ['p10', 200000]] as const) {
      const rs = trigger(); rs.find(r => r.option_id === A)!.outcome[key] = value;
      const l = licence(rs);
      noNote(l);
      // B19 licences shortfall per option; Starter's malformed spread figures do not erase Raise's valid scale map.
      expect(l.sent_threshold).toEqual(delta);
      expect(l.shortfall_note_by_option).toHaveProperty(B);
    }
    const rs = trigger(); rs.find(r => r.option_id === A)!.outcome.p10 = 127000;
    const l = licence(rs);
    noNote(l);
    expect(l.sent_threshold).toEqual(delta);
    expect(l.shortfall_note_by_option).toHaveProperty(B);
  });
  it('forms hiding per-option point lines never carry a note', () => {
    const g = graph(); g.edges = [];
    const rs = trigger(); rs.forEach(r => { delete r.probability_of_goal_precision; });
    const l = licence(rs, delta, g);
    expect(l.form).toBe('highest'); noNote(l);
  });
  it('chat: B chance ends with the note once; an unlabelled figure owes the full estimate-labelled point', () => {
    const g = graph();
    // This downstream estimate-label test needs ordinary estimates; validated definitions owe no RC4 label.
    for (const edge of g.edges.filter((e: Json) => e.provenance?.magnitude === 'olumi_estimate')) {
      edge.provenance.definitional = false;
    }
    const result = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, level);
    const lines = goalChanceScreenLinesForAgent(result, g, true);
    const b = lines.find(l => l.option_id === B)!;
    expect(b.olumi_estimate_link_count).toBe(2);
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
    const phrasedOwed = withScreenLinesOwed(phrased, [b]).text;
    const phrasedDone = withEstimateGoalPointsAtEgress({ assistant_text: phrasedOwed }, {
      analysisResult: result, graph: g, current: true,
    }).assistant_text;
    expect(phrasedDone.trim()).toBe(`${b.chance}${b.depends === '' ? '' : ` ${b.depends}`}`);
    expect(phrasedDone).not.toContain(phrased);
    expect(withScreenLinesOwed(phrasedDone, [b]).added).toBe(0);
    const orphan = withScreenLinesOwed(`${SPREAD_NOTE_WITHOUT_DOWNSIDE}\n${chanceOnly}`, [b]).text;
    expect(orphan.split(SPREAD_NOTE_WITHOUT_DOWNSIDE)).toHaveLength(2);
    expect(orphan).toContain(b.chance);
    expect(goalChanceScreenLinesForAgent(result, g, false)).toEqual([]);
    expect(b.chance).not.toContain(B);
  });
  const shortfallScreenFixture = (): { g: Json; result: Json; lines: ReturnType<typeof goalChanceScreenLinesForAgent> } => {
    const g = graph(); goal(g).goal_threshold = 0.8;
    const result = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, delta) as Json;
    const label = (id: string): string => g.nodes.find((n: Json) => n.id === id).label;
    // Authored licence strings isolate the downstream display/movement contract from the producer's numerical rows.
    result.inference_warnings[0].shortfall_note_by_option = {
      [B]: `In its worst 1 in 20 runs of this model, ‘${label(B)}’ falls short of your target by £15,000 / month or more.`,
      [SQ]: `In this model, ‘${label(SQ)}’ falls short of your target in almost every run, typically by about £6,000 / month.`,
    };
    // These authored downstream rows isolate chance/note ownership from the separately tested driver carriage.
    return { g, result, lines: goalChanceScreenLinesForAgent(result, g, true).map(l => ({ ...l, depends: '' })) };
  };
  it('B19 screen order: chance, spread, then shortfall; the less-than-1% line uses its own exact template', () => {
    const { lines } = shortfallScreenFixture();
    const b = lines.find(l => l.option_id === B)!;
    expect(b.spread_note).toBe(SPREAD_NOTE_WITHOUT_DOWNSIDE);
    expect(b.shortfall_note).toBe(`In its worst 1 in 20 runs of this model, ‘${b.label}’ falls short of your target by £15,000 / month or more.`);
    // r8: both captured Olumi-marked links are validated accounting definitions, which RC4 excludes.
    expect(b.olumi_estimate_link_count).toBeUndefined();
    expect(b.chance).toBe(`‘${b.label}’: ${b.figure} chance of meeting your goal, in this model. ${SPREAD_NOTE_WITHOUT_DOWNSIDE} ${b.shortfall_note}`);
    const sq = lines.find(l => l.option_id === SQ)!;
    expect(sq.shortfall_note).toBe(`In this model, ‘${sq.label}’ falls short of your target in almost every run, typically by about £6,000 / month.`);
    expect(sq.chance).toBe(`‘${sq.label}’: less than 1% chance of meeting your goal, in this model. ${sq.shortfall_note}`);
  });
  it('r8 CONTRAST: two ordinary unaccepted estimates still carry the 2-link label and remove bare narrated chances', () => {
    const { g, result } = shortfallScreenFixture();
    for (const edge of g.edges.filter((e: Json) => e.provenance?.magnitude === 'olumi_estimate')) {
      edge.provenance.definitional = false;
    }
    // Changing estimate ownership changes this Run's licence; its source records the new RC4 count.
    const attributed = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, delta) as Json;
    attributed.inference_warnings[0].shortfall_note_by_option = result.inference_warnings[0].shortfall_note_by_option;
    const lines = goalChanceScreenLinesForAgent(attributed, g, true);
    for (const line of lines) {
      expect(line.olumi_estimate_link_count).toBe(2);
      expect(line.chance).toContain("using Olumi's estimates for 2 links (see Check estimates).");
    }
    const bare = 'Raise prices by 10% has a 55% chance of meeting your goal.';
    const owed = withScreenLinesOwed(bare, lines).text;
    const out = withEstimateGoalPointsAtEgress({ assistant_text: owed }, {
      analysisResult: attributed, graph: g, current: true,
    }).assistant_text;
    expect(out).not.toContain(bare);
    for (const line of lines) expect(out).toContain(line.chance);
  });
  it('B19 r3 owed insertion: Agent wording stays and the canonical shortfall unit is appended once', () => {
    const { lines } = shortfallScreenFixture();
    const b = lines.find(l => l.option_id === B)!;
    const phrased = `${b.label}: ${b.figure}.`;
    const completed = withScreenLinesOwed(phrased, [b]);
    expect(completed).toEqual({ text: `${phrased}\n\n${b.chance}`, added: 1 });
    expect(completed.text.split(b.figure)).toHaveLength(3);
    expect(completed.text.split(b.spread_note!)).toHaveLength(2);
    expect(completed.text.split(b.shortfall_note!)).toHaveLength(2);
    expect(withScreenLinesOwed(completed.text, [b])).toEqual({ text: completed.text, added: 0 });
  });
  it.each(['split', 'orphan', 'reversed', 'separated', 'duplicate'] as const)('B19 r3 existing %s notes stay; only a missing canonical unit is appended', mode => {
    const { lines } = shortfallScreenFixture();
    const b = lines.find(l => l.option_id === B)!;
    const chanceOnly = `‘${b.label}’: ${b.figure} chance of meeting your goal, in this model.`;
    const text = mode === 'split' ? `${chanceOnly}\n${b.spread_note}\n${b.shortfall_note}`
      : mode === 'orphan' ? `${b.shortfall_note}\n${b.spread_note}\n${chanceOnly}`
        : mode === 'reversed' ? `${chanceOnly} ${b.shortfall_note} ${b.spread_note}`
          : mode === 'separated' ? `${chanceOnly} Another point. ${b.spread_note} ${b.shortfall_note}`
            : `${b.chance}\n${b.shortfall_note}`;
    const completed = withScreenLinesOwed(text, [b]);
    expect(completed).toEqual(mode === 'duplicate' ? { text, added: 0 } : { text: `${text}\n\n${b.chance}`, added: 1 });
    expect(withScreenLinesOwed(completed.text, [b])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 shared spread words: adding another option’s shortfall never strips the first option’s unit', () => {
    const { g, lines } = shortfallScreenFixture();
    const b = lines.find(l => l.option_id === B)!;
    const label = g.nodes.find((n: Json) => n.id === A).label as string;
    const other = { ...b, option_id: A, label, chance: b.chance.split(b.label).join(label),
      shortfall_note: b.shortfall_note!.split(b.label).join(label) };
    const base = (l: typeof b): string => `‘${l.label}’: ${l.figure} chance of meeting your goal, in this model.`;
    const completed = withScreenLinesOwed(`${base(b)} ${base(other)}`, [b, other]);
    expect(completed).toEqual({ text: `${base(b)} ${base(other)}\n\n${b.chance} ${other.chance}`, added: 2 });
    expect(completed.text.split(SPREAD_NOTE_WITHOUT_DOWNSIDE)).toHaveLength(3);
    expect(completed.text.split(b.shortfall_note!)).toHaveLength(2);
    expect(completed.text.split(other.shortfall_note)).toHaveLength(2);
    expect(withScreenLinesOwed(completed.text, [b, other])).toEqual({ text: completed.text, added: 0 });
  });
  const sharedSpreadLines = () => {
    const { lines } = shortfallScreenFixture();
    const b = { ...lines.find(l => l.option_id === B)!, depends: '' };
    const label = lines.find(l => l.option_id === A)!.label;
    const other = { ...b, option_id: A, label, chance: b.chance.split(b.label).join(label),
      shortfall_note: b.shortfall_note!.split(b.label).join(label) };
    const { shortfall_note: _shortfall, ...spreadOnly } = other;
    spreadOnly.chance = other.chance.slice(0, -other.shortfall_note.length).trimEnd();
    return { b, other, spreadOnly };
  };
  it.each([
    ['canonical', 'same row'], ['canonical', 'new row'], ['agent', 'same row'], ['agent', 'new row'],
    ['missing', 'same row'], ['missing', 'new row'],
  ] as const)('B19 R1 spread-only %s path on %s preserves another option’s spread', (mode, placement) => {
    const { b, spreadOnly } = sharedSpreadLines();
    const separator = placement === 'same row' ? ' ' : '\n';
    const base = spreadOnly.chance.slice(0, -spreadOnly.spread_note!.length).trimEnd();
    const ownRow = mode === 'canonical' ? base : mode === 'agent' ? `${spreadOnly.label}: ${spreadOnly.figure}.`
      : `${spreadOnly.label} still needs evidence.`;
    const text = `${b.chance}${separator}${ownRow}`;
    const completed = withScreenLinesOwed(text, [b, spreadOnly]);
    const ownDone = mode === 'canonical' ? spreadOnly.chance : `${ownRow}\n\n${spreadOnly.chance}`;
    expect(completed).toEqual({ text: `${b.chance}${separator}${ownDone}`, added: 1 });
    expect(completed.text.split(b.spread_note!)).toHaveLength(3);
    expect(withScreenLinesOwed(completed.text, [b, spreadOnly])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 r3 mixed units: a spread-only sentence never inserts its note inside a canonical shortfall line', () => {
    const { b, spreadOnly } = sharedSpreadLines();
    const own = `${spreadOnly.label}: ${spreadOnly.figure}`;
    const text = `${own} ${b.chance}`;
    const completed = withScreenLinesOwed(text, [b, spreadOnly]);
    expect(completed).toEqual({ text: `${text}\n\n${spreadOnly.chance}`, added: 1 });
    expect(completed.text.split(b.chance)).toHaveLength(2);
    expect(withScreenLinesOwed(completed.text, [b, spreadOnly])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 R1 spread-only positive control: two already-complete options sharing a row stay byte-identical', () => {
    const { b, spreadOnly } = sharedSpreadLines();
    const text = `${b.chance} ${spreadOnly.chance}`;
    expect(withScreenLinesOwed(text, [b, spreadOnly])).toEqual({ text, added: 0 });
  });
  it.each(['split', 'separated'] as const)('B19 R1 spread-only %s compatibility control keeps existing bytes', placement => {
    const { spreadOnly } = sharedSpreadLines();
    const base = spreadOnly.chance.slice(0, -spreadOnly.spread_note!.length).trimEnd();
    const text = placement === 'split' ? `${base}\n${spreadOnly.spread_note}`
      : `${base} Another point. ${spreadOnly.spread_note}`;
    expect(withScreenLinesOwed(text, [spreadOnly])).toEqual({ text, added: 0 });
  });
  it('B19 r3 semicolon clauses: Agent words stay and each canonical line is appended once', () => {
    const { b, other } = sharedSpreadLines();
    const first = `${b.label}: ${b.figure};`;
    const second = `${other.label}: ${other.figure}.`;
    const completed = withScreenLinesOwed(`${first} ${second}`, [b, other]);
    const text = `${first} ${second}\n\n${b.chance} ${other.chance}`;
    expect(completed).toEqual({ text, added: 2 });
    expect(withScreenLinesOwed(text, [b, other])).toEqual({ text, added: 0 });
  });
  it('B19 r3 period clauses: Agent words stay and each canonical line is appended once', () => {
    const { b, other } = sharedSpreadLines();
    const first = `${b.label}: ${b.figure}.`;
    const second = `${other.label}: ${other.figure}.`;
    const completed = withScreenLinesOwed(`${first} ${second}`, [b, other]);
    const text = `${first} ${second}\n\n${b.chance} ${other.chance}`;
    expect(completed).toEqual({ text, added: 2 });
    expect(withScreenLinesOwed(text, [b, other])).toEqual({ text, added: 0 });
  });
  it.each(['same row', 'standalone row'] as const)('B19 r3 duplicate Agent spread on %s stays beside complete canonical units', placement => {
    const { b, other } = sharedSpreadLines();
    const separator = placement === 'same row' ? ' ' : '\n';
    const text = `${b.chance}${separator}${b.spread_note}\n${other.chance}`;
    const completed = withScreenLinesOwed(text, [b, other]);
    expect(completed).toEqual({ text, added: 0 });
    expect(completed.text).toContain(b.chance);
    expect(completed.text).toContain(other.chance);
    expect(completed.text.split(b.spread_note!)).toHaveLength(4);
    expect(completed.text.split(b.shortfall_note!)).toHaveLength(2);
    expect(completed.text.split(other.shortfall_note)).toHaveLength(2);
    expect(withScreenLinesOwed(completed.text, [b, other])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 R1 duplicate positive control: one complete notes unit per option stays byte-identical', () => {
    const { b, other } = sharedSpreadLines();
    const text = `${b.chance} ${other.chance}`;
    expect(withScreenLinesOwed(text, [b, other])).toEqual({ text, added: 0 });
  });
  it('B19 r3 spread-only compatibility: staging leaves an already-said canonical chance and duplicate note unchanged', () => {
    const { spreadOnly } = sharedSpreadLines();
    const text = `${spreadOnly.chance} ${spreadOnly.spread_note}`;
    const completed = withScreenLinesOwed(text, [spreadOnly]);
    expect(completed).toEqual({ text, added: 0 });
    expect(completed.text.split(spreadOnly.spread_note!)).toHaveLength(3);
    expect(withScreenLinesOwed(completed.text, [spreadOnly])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 R1 straight-quote complete unit is recognized without inserting a second copy', () => {
    const { b } = sharedSpreadLines();
    const text = b.chance.replace(/[‘’]/g, "'");
    expect(withScreenLinesOwed(text, [b])).toEqual({ text, added: 0 });
  });
  it('B19 r3 straight-quote split notes stay while the canonical shortfall line is appended', () => {
    const { b } = sharedSpreadLines();
    const chanceOnly = b.chance.slice(0, -(b.spread_note!.length + b.shortfall_note!.length + 1)).trimEnd();
    const text = `${chanceOnly.replace(/[‘’]/g, "'")}\n${b.spread_note}\n${b.shortfall_note!.replace(/[‘’]/g, "'")}`;
    const completed = withScreenLinesOwed(text, [b]);
    expect(completed).toEqual({ text: `${text}\n\n${b.chance}`, added: 1 });
    expect(completed.text.split('In its worst 1 in 20 runs of this model')).toHaveLength(3);
    expect(withScreenLinesOwed(completed.text, [b])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 r3 curly-quote split notes stay while the canonical shortfall line is appended', () => {
    const { b } = sharedSpreadLines();
    const chanceOnly = b.chance.slice(0, -(b.spread_note!.length + b.shortfall_note!.length + 1)).trimEnd();
    const text = `${chanceOnly}\n${b.spread_note}\n${b.shortfall_note}`;
    const completed = withScreenLinesOwed(text, [b]);
    expect(completed).toEqual({ text: `${text}\n\n${b.chance}`, added: 1 });
    expect(completed.text.split(b.shortfall_note!)).toHaveLength(3);
    expect(withScreenLinesOwed(completed.text, [b])).toEqual({ text: completed.text, added: 0 });
  });
  it('B19 orphaned label: another option’s same figure cannot count as this option’s chance', () => {
    const { g, lines } = shortfallScreenFixture();
    const b = lines.find(l => l.option_id === B)!;
    const otherLabel = g.nodes.find((n: Json) => n.id === A).label as string;
    const otherChance = `${otherLabel}: ${b.figure}.`;
    const text = `${otherChance} ${b.spread_note} ${b.shortfall_note}`;
    const completed = withScreenLinesOwed(text, [{ ...b, depends: '' }]);
    expect(completed).toEqual({ text: `${text}\n\n${b.chance}`, added: 1 });
    expect(completed.text).toContain(otherChance);
    expect(completed.text).toContain(`\n\n${b.chance}`);
    expect(completed.text.split(b.shortfall_note!)).toHaveLength(3);
    expect(completed.text.split(b.spread_note!)).toHaveLength(3);
    expect(withScreenLinesOwed(completed.text, [{ ...b, depends: '' }])).toEqual({ text: completed.text, added: 0 });
  });
  it.each([B, SQ])('B19 label guard: %s’s structurally valid shortfall is dropped when its label differs from the licence', id => {
    const { g, result, lines } = shortfallScreenFixture();
    const original = lines.find(l => l.option_id === id)!;
    expect(original.shortfall_note).toBeDefined();
    result.inference_warnings[0].shortfall_note_by_option[id] = original.shortfall_note!.replace(`‘${original.label}’`, `‘${original.label} stale’`);
    const guarded = goalChanceScreenLinesForAgent(result, g, true).find(l => l.option_id === id)!;
    expect(guarded).not.toHaveProperty('shortfall_note');
    expect(guarded.chance).not.toContain(original.shortfall_note!);
    expect(guarded.chance).not.toContain(`‘${original.label} stale’`);
    expect(guarded.spread_note).toBe(original.spread_note);
  });
  it('B19 label guard: literal metacharacters in an exact Run label are accepted, and a stale Run stays silent', () => {
    const { g, result, lines } = shortfallScreenFixture();
    const b = lines.find(l => l.option_id === B)!;
    const label = 'Raise (10%)+ [£]';
    g.nodes.find((n: Json) => n.id === B).label = label;
    const renamed = withGoalChanceLicence({ option_comparison: trigger() }, g, GOAL, earned, delta) as Json;
    renamed.inference_warnings[0].shortfall_note_by_option = {
      ...result.inference_warnings[0].shortfall_note_by_option,
      [B]: b.shortfall_note!.replace(`‘${b.label}’`, `‘${label}’`),
    };
    const changed = goalChanceScreenLinesForAgent(renamed, g, true).find(l => l.option_id === B)!;
    expect(changed.shortfall_note).toBe(renamed.inference_warnings[0].shortfall_note_by_option[B]);
    expect(changed.chance).toContain(`‘${label}’ falls short of your target`);
    expect(goalChanceScreenLinesForAgent(renamed, g, false)).toEqual([]);
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
