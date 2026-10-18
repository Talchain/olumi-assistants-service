/**
 * ⛔ CONTRACT A first loss (dev pilot P07/P09, outbox/CONTRACT-A-FIRST-LOSS-TRACE-P07-P09.md): construction (W22,
 * `withConstructionStatements`) DROPPED every drafted statement the shared quote check refused, so words the brief writes beside a
 * single-quote-marked term or speech were saved nowhere. DL-3 16:14Z (#3363): single marks → speaker UNKNOWN, WORDS KEPT. Words the
 * brief writes verbatim, refused ONLY as not a whole statement, are now kept on their subject with speaker unknown: never the user's,
 * never operative (no figure, unit or sign). SYNTHETIC brief (never a pilot brief). Real path: `buildModelFromBrief` (scripted
 * drafter) → `/graph/register` → the saved record → its readers. #3376 ruling 3: every reader sees the user's statements only (what it
 * saw before), so the kept words flip no base behaviour; only `recordsWithUnknownSpeakerOn` returns them.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { withConstructionStatements } from '../construction-source-map.js';
import { linkWorkingPointOf } from '../link-working-point.js';
import { userStatementOf } from '../user-statements.js';
import { recordedMeasureOf } from '../../statement-door/fields/measure.js';
import { subjectKey } from '../../statement-door/subject.js';
import { currentStatementRetention, prepareStatementCorrection, recordsWithUnknownSpeakerOn, userStatementFor, userStatementRecord, userStatementsOn,
  withUserStatement } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const AIM = 'We need to complete at least 900 repairs this year.';
const LEVEL = 'That score is 45 today, with no unit.';
const SAID = 'Faster parts delivery means more repairs completed.';
const brief = (open: string, close: string): string => [AIM, `Our depot tracks a ${open}quick lane${close} score for small jobs. ${LEVEL}`,
  `Tomasz, workshop lead: ${open}${SAID}${close}`, 'We could add a second van or open the quick lane on Saturdays.'].join('\n');
const SINGLE = brief("'", "'");
const DOUBLE = brief('“', '”');
/** The level sentence inside another speaker's PAIRED single marks: the quote check cannot bound it as the user's (dev P01/P11 rule). */
const SPOKEN = [AIM, `Kim, analyst: '${LEVEL}'`, SINGLE.split('\n')[2]!, 'We could add a second van or open the quick lane on Saturdays.'].join('\n');
const GOAL = 'Repairs completed';
const SCORE = 'Quick lane score';
const PARTS = 'Parts delivery speed';
const SPEECH = (b: string): string => b.split('\n')[2]!;

function draft(statements: Rec[]): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 900, unit: 'repairs', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add a second van', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: PARTS, value: 8, value_kind: 'absolute', unit: 'deliveries a day', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: PARTS, role: 'controllable', baseline_known: false, baseline_value: 5, unit: 'deliveries a day', provenance: 'ai_proposed', plausible_max: 20 },
      { label: SCORE, role: 'external', baseline_known: true, baseline_value: 45, unit: null, provenance: 'explicit', plausible_max: 100 },
    ],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [link(PARTS, GOAL), link(SCORE, GOAL)],
    statements: [
      { quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 900, low: null, high: null, unit: 'repairs', qualifier: null, conditions: null },
      ...statements,
    ],
  };
}
const level = (quote = LEVEL, value = 45): Rec => ({ quote, subject: { kind: 'factor', label: SCORE, to_label: null, factor_label: null },
  field: 'level', form: 'point', value, low: null, high: null, unit: null, qualifier: 'without a unit', conditions: null });
const speech = (quote: string): Rec => ({ quote, subject: { kind: 'link', label: PARTS, to_label: GOAL, factor_label: null }, field: 'relation',
  form: 'describes', value: null, low: null, high: null, unit: null, qualifier: "Tomasz's view", conditions: null });

async function saved(model: Rec, text: string): Promise<Rec> {
  let body: Rec | undefined;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('7a7a7a7a-0000-4a7a-8a7a-7a7a7a7a7a7a', text, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return body!;
}
const nodeOf = (g: Rec, label: string): Rec => g.nodes.find((n: Rec) => n.label === label);
const recordOf = (g: Rec, label: string, key: string): Rec | undefined => nodeOf(g, label)?.user_statements?.find((r: Rec) => r.subject_key === key);
const levelRecord = (g: Rec): Rec | undefined => recordOf(g, SCORE, `factor|${nodeOf(g, SCORE).id}|||level`);
const speechRecord = (g: Rec): Rec | undefined => recordOf(g, PARTS, `link|${nodeOf(g, PARTS).id}|${nodeOf(g, GOAL).id}||relation`);
/** The words, exactly as written, with speaker unknown and nothing operative: no figure, unit or sign, Olumi's reading `describes`. */
const unknownWords = (quote: string, source: string, quantity: string): Rec[] =>
  [{ speaker: 'unknown', quote, source, subject: { quantity }, form: 'describes', reading: 'olumi' }];

describe('words the quote check cannot bound as whole are kept with speaker unknown, never dropped and never the user\'s', () => {
  it('⭐ RED → GREEN, real build → register: a level sentence inside another speaker\'s single marks is kept; a single-marked named speech keeps its words', async () => {
    const g = await saved(draft([level(), speech(SPEECH(SINGLE))]), SPOKEN);
    expect(levelRecord(g)?.statements, 'the "no unit" words, kept').toEqual(unknownWords(LEVEL, SPOKEN.split('\n')[1]!, 'factor|quick lane score|||level'));
    expect(speechRecord(g)?.statements, 'the named speech, kept whole with its name').toEqual(
      unknownWords(SPEECH(SINGLE), SPEECH(SINGLE), 'link|parts delivery speed|repairs completed||relation'));
    expect(levelRecord(g)?.attest).toEqual({ recorded_by: 'construction' });
    // Never the user's: every reader's record holds none of them; only the named accessor returns them.
    expect(userStatementsOn(nodeOf(g, SCORE)), 'level: readers see none').toEqual([]);
    expect(userStatementsOn(nodeOf(g, PARTS)), 'speech: readers see none').toEqual([]);
    expect(recordsWithUnknownSpeakerOn(nodeOf(g, SCORE))).toEqual([levelRecord(g)]);
    // Same build, same line set: the goal's whole sentence is still the user's.
    expect(recordOf(g, GOAL, `goal|${nodeOf(g, GOAL).id}|||target`)?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: AIM, low: 900 })]);
  });

  it('CONTRAST, real path: the level sentence after a marked TERM is the user\'s, single (paired, dev P01/P11) or double; a named speech in either is the speaker\'s (C2)', async () => {
    for (const text of [SINGLE, DOUBLE]) {
      const g = await saved(draft([level(), speech(SPEECH(text))]), text);
      expect(levelRecord(g)?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: LEVEL, form: 'point', low: 45, high: 45 })]);
      // AIE: quoting an entire report does not transfer its embedded claim; kept whole with its speaker, never the user's statement.
      expect(speechRecord(g)?.statements).toEqual(unknownWords(SPEECH(text), SPEECH(text), 'link|parts delivery speed|repairs completed||relation'));
    }
  });

  it('⛔ a refusal for any other reason keeps nothing: a figure the sentence does not write, or words the brief never wrote', async () => {
    const plain = brief('', '');
    expect(levelRecord(await saved(draft([level(LEVEL, 50)]), plain)), 'whole sentence, figure 50 not written').toBeUndefined();
    expect(levelRecord(await saved(draft([level('The score is 45 today and has no unit.')]), SINGLE)), 'not the brief\'s words').toBeUndefined();
    expect(speechRecord(await saved(draft([speech('Tomasz says faster parts delivery means more repairs completed.')]), SINGLE))).toBeUndefined();
  });

  it('⛔ not operative: construction adds only the speaker-unknown record; every other member of the graph is unchanged', () => {
    const graph = { nodes: [{ id: 'score', kind: 'factor', label: SCORE, observed_state: { value: 0.45, raw_value: 45, cap: 100 } }], edges: [] };
    const out = withConstructionStatements(structuredClone(graph), [level()], SPOKEN, '2026-10-17T22:00:00Z') as Rec;
    const { user_statements: kept, ...rest } = out.nodes[0];
    expect({ ...out, nodes: [rest] }).toEqual(graph);
    expect(kept).toEqual([{ subject_key: 'factor|score|||level', field: 'level', recorded_at: '2026-10-17T22:00:00Z', attest: { recorded_by: 'construction' },
      statements: unknownWords(LEVEL, SPOKEN.split('\n')[1]!, 'factor|quick lane score|||level') }]);
    // The one reader never admits a speaker-unknown statement that carries a figure, unit or sign.
    for (const extra of [{ low: 45 }, { high: 45 }, { unit: 'points' }, { negated: true }, { form: 'point' }]) {
      expect(userStatementOf({ ...kept[0].statements[0], ...extra }), JSON.stringify(extra)).toBeUndefined();
    }
  });
});

describe('#3376 ruling 3: every reader sees exactly what it saw before, the user\'s statements only', () => {
  const subject = { kind: 'goal' as const, id: 'coverage', field: 'measure' as const };
  const old = 'Coverage is measured in staff hours, mostly on nights.';
  const graphWith = (speaker: 'user' | 'unknown' | null) => {
    const g: Rec & { nodes: unknown[] } = { nodes: [{ id: 'coverage', kind: 'goal', label: 'Coverage',
      goal_threshold_raw: 10, goal_threshold_unit: '%', goal_threshold_frame: 'change_rel', goal_target_basis: { quantity_frame: 'level', target_frame: 'change_rel', target_raw: 10, reference: 'today',
        denominator: "today's staff hours", period_months: 3, period_kind: 'at_end', effect_unit: '% of staff hours',
        effects_at_period_end: true, source: 'olumi_reading' } }], edges: [] };
    if (speaker === null) return g;
    const held = userStatementOf({ speaker, quote: old, source: old, form: 'describes', reading: 'olumi', subject: { quantity: subjectKey(subject), node_id: 'coverage' } })!;
    return withUserStatement(g, userStatementRecord(subject, [held], '2026-10-17T12:00:00Z', { recorded_by: 'construction' }), subject)!;
  };
  const correct = (g: Rec) => {
    const quote = 'For Coverage, withdraw “mostly on nights”; keep “staff hours”.';
    return prepareStatementCorrection(g, { quote, edits: [{ subject, retirement: { quote: 'mostly on nights', scope: 'part', disposition: 'retracted' },
      retained: ['staff hours'], reading_words: 'The listed parts remain; the specified earlier account is withdrawn.' }] }, { now: quote }, '2026-10-17T13:00:00Z');
  };

  it('CONTRAST, speaker user: the measure reader credits the words and a correction retains them as the user\'s source', () => {
    const g = graphWith('user');
    expect(recordedMeasureOf(g.nodes[0])).toBe('staff hours');
    const r = correct(g);
    if (!('correction' in r)) throw new Error(JSON.stringify(r));
    expect(currentStatementRetention(userStatementFor(r.candidate, subject)!)?.spans).toEqual([{ text: 'staff hours', origin: 'held_user_statement' }]);
  });

  it('speaker unknown: ordinary readers gain no human source; a new correction keeps unknown attribution', () => {
    const g = graphWith('unknown'), base = graphWith(null);
    expect(userStatementFor(g, subject)).toBeUndefined();
    expect(userStatementsOn(g.nodes[0])).toEqual([]);
    expect(recordedMeasureOf(g.nodes[0])).toBe(recordedMeasureOf(base.nodes[0]));
    // Unknown words may identify the old bytes a NEW typed correction addresses; they never become human source.
    expect(correct(base)).toMatchObject({ refused: 'retired_source_not_held' });
    const fixed = correct(g);
    if (!('candidate' in fixed)) throw new Error(JSON.stringify(fixed));
    const node = (fixed.candidate.nodes as Rec[])[0]!;
    expect(currentStatementRetention(userStatementFor(fixed.candidate, subject)!)?.spans).toEqual([{ text: 'staff hours', origin: 'unknown' }]);
    expect(recordedMeasureOf(node)).toBe(recordedMeasureOf(base.nodes[0]));
    expect(recordsWithUnknownSpeakerOn(node)[0]!.statements.filter(s => s.speaker === 'unknown'))
      .toEqual(recordsWithUnknownSpeakerOn(g.nodes[0])[0]!.statements);
    expect(recordsWithUnknownSpeakerOn(g.nodes[0])).toEqual([expect.objectContaining({ subject_key: subjectKey(subject),
      statements: [expect.objectContaining({ speaker: 'unknown', quote: old })] })]);
  });
});

describe('#3376 ruling 3, zero base flips: a link\'s working point is the same with or without kept words beside its range', () => {
  const AIM2 = 'We want the household recycling rate to reach at least 50% this year.';
  const NOW = 'The recycling rate is 42% today.';
  const RANGE = 'Our recycling lead thinks switching to weekly food collection could lift the rate by between 4 and 7 percentage points.';
  const KEPT = 'It mostly depends on households sorting their food waste.';
  // KEPT sits inside the council's paired single marks, so the quote check cannot bound it as the user's (kept, speaker unknown).
  const TEXT = [AIM2, NOW, RANGE, `The council says: '${KEPT}'`, 'We could start weekly food collection or keep fortnightly collection.'].join('\n');
  const RATE = 'Household recycling rate', SWITCH = 'Weekly food collection running';
  const on = { kind: 'link', label: SWITCH, to_label: RATE, factor_label: null };
  const model = (kept: boolean): Rec => ({
    goal: { kind: null, deliverable: null, metric: RATE, operator: '>=', target_stated: true, value: 50, unit: '%', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 42, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM2, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Keep fortnightly collection', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: true,
        interventions: [{ factor_label: SWITCH, value: 0, value_kind: 'absolute', unit: '0/1', provenance: 'explicit' }] },
      { label: 'Start weekly food collection', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: SWITCH, value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'explicit' }] },
    ],
    factors: [{ label: SWITCH, role: 'controllable', baseline_known: true, baseline_value: 0, unit: '0/1', provenance: 'explicit', plausible_max: 1 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [{ from: SWITCH, to: RATE, direction: 'positive', provenance: 'explicit', effect_amount: null, effect_per_source_change: null,
      effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [
      { quote: AIM2, subject: { kind: 'goal', label: RATE, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 50, low: null, high: null, unit: '%', qualifier: null, conditions: null },
      { quote: NOW, subject: { kind: 'goal', label: RATE, to_label: null, factor_label: null }, field: 'level', form: 'point', value: 42, low: null, high: null, unit: '%', qualifier: null, conditions: null },
      { quote: RANGE, subject: on, field: 'effect', form: 'range', value: null, low: 4, high: 7, unit: 'percentage points', qualifier: null, conditions: null },
      ...(kept ? [{ quote: KEPT, subject: on, field: 'effect', form: 'describes', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null }] : []),
    ],
  });
  const ends = (g: Rec) => [nodeOf(g, SWITCH).id, nodeOf(g, RATE).id] as const;

  it('⛔ real build → register → reader: a verified range plus kept words on one link gives the point the range alone gives', async () => {
    const base = await saved(model(false), TEXT), withWords = await saved(model(true), TEXT);
    // Not vacuous: the saved record holds the user's range AND the kept words; the base record holds the range alone.
    const raw = (g: Rec) => nodeOf(g, SWITCH).user_statements.find((r: Rec) => r.field === 'effect').statements.map((st: Rec) => [st.speaker, st.form]);
    expect(raw(base)).toEqual([['user', 'range']]);
    expect(raw(withWords)).toEqual([['user', 'range'], ['unknown', 'describes']]);
    const point = linkWorkingPointOf(base, ...ends(base));
    expect(point, 'the base offers a working point').toMatchObject({ low: 4, high: 7, unit: 'percentage points', quote: RANGE });
    expect(linkWorkingPointOf(withWords, ...ends(withWords))).toEqual(point);
  });
});
