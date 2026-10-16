import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  goalChanceLicenceOf, goalChanceLicenceForAgent, sentGoalThresholdOf, withGoalChanceLicence,
  SPREAD_NOTE_WITHOUT_DOWNSIDE, type SentGoalThreshold,
} from '../goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import { ContextPackRunDeltaSchema } from '../../context/context-pack-schema.js';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import { applyStatementRecordEdit } from '../cohort-forecast-write.js';
import { rangeLawAdoption, rangeLawStatementOf } from '../../statement-door/fields/range-law.js';

type Json = Record<string, any>;
const capture = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/waveB-pilot-t1b-86ccaf3-turn003.json', import.meta.url), 'utf8')) as Json;
const clone = <T>(v: T): T => structuredClone(v);
const GOAL = 'monthly_recurring_revenue';
const A = 'launch_starter_tier';
const B = 'raise_prices_by_10';
const SQ = 'keep_pricing_as_it_is';
/** C2 withhold (AIE 6184726873): a likely range's equal-tail approximation ADOPTED, as its card's press records it (`RANGE_LAW_ROW`). */
const adoptRangeLaw = (g: Json, optionId: string, factorId: string): Json => {
  const cell = g.nodes.find((n: Json) => n.id === optionId).interventions[factorId];
  const { low, high, source_quote: quote } = cell.range;
  const approved = rangeLawAdoption(g, optionId, factorId, [rangeLawStatementOf(optionId, factorId, quote, low, high, cell.unit)], low, high,
    '2026-10-15T00:00:00.000Z')!;
  const written = applyStatementRecordEdit(g, approved);
  if (written.kind !== 'mutated') throw new Error(`the adoption was not written: ${written.kind}`);
  return written.mutatedGraph as Json;
};
const graph = (): Json => {
  const g = clone(capture.draft_graph);
  // Constructed level-frame inputs only; production records the raw-samples delta frame.
  g.nodes.find((n: Json) => n.id === GOAL).goal_baseline = 120000;
  // The brief's 80–250 for Starter, its approximation adopted: these rows are about the spread note, not the range law.
  return adoptRangeLaw(g, A, 'starter_tier_subscribers');
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
  it('served T1b: £ output agreement cannot override the dispatched normalised LEVEL frame', () => {
    const g = graph(); goal(g).goal_threshold = 0.8;
    const envelope = { option_comparison: records() };
    const sentRun = { graph: g, goal_node_id: GOAL, options: [{ option_id: A }, { option_id: B }, { option_id: SQ, is_baseline: true }] };
    const sent = sentGoalThresholdOf(envelope, g, GOAL, earned, { sentRun });
    expect(sent).toEqual({ value: 0.8, field: 'goal_threshold', frame: 'level', baseline: 120000 / 157500, status_quo_option_id: SQ });
    expect(sentGoalThresholdOf(envelope, g, GOAL, earned), 'no request evidence').toBeUndefined();
    // The £ samples do not validate a disclosure on that normalised threshold. Existing known-frame B19 positives below stay.
    const l = goalChanceLicenceOf(envelope, g, GOAL, earned, sent)!;
    noRecordedThreshold(l);
    expect(goalChanceLicenceForAgent({ inference_warnings: [l] })).not.toHaveProperty('sent_threshold');
  });
  it('a constructed output reversal still cannot invent raw-frame evidence or a spread note', () => {
    const g = graph(); goal(g).goal_threshold = 0.8;
    const envelope = { option_comparison: trigger() };
    const sentRun = { graph: g, goal_node_id: GOAL, options: [{ option_id: A }, { option_id: B }, { option_id: SQ, is_baseline: true }] };
    const sent = sentGoalThresholdOf(envelope, g, GOAL, earned, { sentRun });
    expect(sent?.frame).toBe('level');
    noRecordedThreshold(goalChanceLicenceOf(envelope, g, GOAL, earned, sent)!);
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
    // Batch C: ruling r1 item 3 — a declared status quo has no figure, so no every-option form is said beside it; the
    // 'highest' form is reached with ‘Keep pricing as it is’ as an ordinary option.
    delete g.nodes.find((n: Json) => n.id === SQ).is_baseline;
    const rs = trigger(); rs.forEach(r => { delete r.probability_of_goal_precision; });
    const l = licence(rs, delta, g);
    expect(l.form).toBe('highest'); noNote(l);
  });
  const shortfallScreenFixture = (): { g: Json; result: Json; lines: ReturnType<typeof goalChanceScreenLinesForAgent> } => {
    const g = graph(); goal(g).goal_threshold = 0.8;
    // ⛔ RE-SCOPE 2 (R5-1/R5-2, DL AMEND: three provenance states) — CHANGED FIXTURE: the 86ccaf3 capture's three 0-today levels
    // are stamped `cee_inference` with no extraction type — Olumi's starting values now (e58b8dbd read them `unknown` and said
    // nothing). These rows pin the spread/shortfall DISPLAY contract, so they are attested here as the person's to keep that
    // contract isolated; their attribution is pinned where it is the subject (goal-chance-screen-lines, b2-zero-spread).
    for (const n of g.nodes as Json[]) {
      if (n.observed_state?.source === 'cee_inference' && n.observed_state.extractionType === undefined) {
        Object.assign(n.observed_state, { source: 'brief_extraction', extractionType: 'explicit' });
      }
    }
    // Batch C: ruling r1 item 3 (amendment 1, every frame) — a DECLARED status quo is "no change, by assumption" and never
    // carries a figure or a shortfall line, so these display-contract rows use ‘Keep pricing as it is’ as an ordinary option
    // (delta frame: no status quo is read). The declared case is pinned in batch-c-goal-chance-licence / shortfall-line.
    delete g.nodes.find((n: Json) => n.id === SQ).is_baseline;
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
