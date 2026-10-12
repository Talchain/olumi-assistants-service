/**
 * Recovery Batch B: the figure-credit corpus harness (DL #94 6120805174; SYS2 owns the verifier).
 *
 * Corpus: `fixtures/verifier-corpus-v1.json` is a byte copy of `recovery/bB/verifier-corpus-codex/VERIFIER-CORPUS-v1.json`,
 * sha256-pinned below. It holds 18 verbatim sentences from Paul's journey briefs and turns, labelled by SYS2 and relabelled
 * blind by Codex, and 48 new sentences written and labelled by Codex.
 * Labels come from the corpus, never from this file:
 *   - a `level` figure (the user's own current point) must be stored as the user's (`human`);
 *   - every other figure must not be;
 *   - a figure the user wrote is never reattributed to Olumi (`ai`) (AIE 6120633627).
 *
 * Each figure is drafted the way the constructor's drafter claims a level: one factor, the figure as `baseline_value`,
 * `provenance: 'explicit'`, and the sentence as its `baseline_evidence.quote`. It is then admitted through the real
 * `admitCandidateModel`, and the stored `observed_state` is read through one provenance reader. ⚠ The factor label and
 * unit per figure (DRAFTS) are SELF-AUTHORED by the builder; the independent check should read them.
 *
 * Rows the corpus cannot decide today:
 *   - H06 "25%" and M04 "3-month sales cycle" are adjudicated `other` by the AIE (6120633627), so they are not credited.
 *   - `effect-rate` points are PENDING V2. The AIE says a per-unit rate is a rate-parameter level or an incremental
 *     effect depending on the bound model quantity, so only "never Olumi's" is asserted for them.
 *   - Any endpoint of a stated range is not the user's point, so it is not credited as one (row 5).
 * Today's failures are RED by design.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { valueAuthorshipOf } from '../turn-context/guidance-signals.js';

const RAW = readFileSync(new URL('./fixtures/verifier-corpus-v1.json', import.meta.url));
const CORPUS_SHA256 = '674cfaf63672ee3cab3b1647c6f4bd44ba9685f87017f94ebcdc405b35f96284';
type Figure = { figure?: string; text?: string; label: string; range?: unknown };
type Sentence = { id: string; sentence: string; figures: Figure[] };
const corpus = JSON.parse(RAW.toString('utf8')) as { verbatim: { sentences: Sentence[] }; extension: Sentence[]; adjudicate: { id: string; figure: string }[] };

/**
 * Interim stand-in for C's `provenanceOf` (DL 12 Oct: one read side for every reader). It reads the EXISTING stored
 * fields through the existing authorship reader; swap the import when C's export lands.
 */
function provenanceOf(observed: unknown): 'human' | 'ai' | 'unknown' {
  const a = valueAuthorshipOf(observed);
  return a === 'yours' ? 'human' : a === 'olumi_estimate' || a === 'olumi_accepted' ? 'ai' : 'unknown';
}

/** AIE 6120633627 adjudications of the corpus's two open rows. */
const AIE_LABEL = new Map([['H06:25%', 'other'], ['M04:3-month sales cycle', 'other']]);
type Draft = { label: string; unit: string; value: number; rangeEnd?: true } | { none: string };
/** Key `${id}:${figure text}`. SELF-AUTHORED: the factor a drafter would name for the figure, in the sentence's own words. */
const DRAFTS: Record<string, Draft> = {
  'H01:at least 10%': { label: 'Productivity increase', unit: '%', value: 10 },
  'H01:two developers': { label: 'Developers', unit: 'developers', value: 2 },
  'H02:the next three months': { label: 'Time to launch', unit: 'months', value: 3 },
  'H03:six mid-weight developers': { label: 'Mid-weight developers', unit: 'developers', value: 6 },
  'H04:£200,000': { label: 'Budget', unit: '£', value: 200000 },
  'H05:between 20% and 30%': { label: 'Time spent on non-development tasks', unit: '%', value: 20, rangeEnd: true },
  'H06:25%': { label: 'Time spent on non-development tasks', unit: '%', value: 25 },
  'M01:£100,000': { label: 'Budget', unit: '£', value: 100000 },
  'M02:more than 25% of my time': { label: 'Share of my time', unit: '%', value: 25 },
  'M03:over 15%': { label: 'Conversion rate', unit: '%', value: 15 },
  'M03:20 new customers': { label: 'New customers', unit: 'customers', value: 20 },
  'M03:within the first 3 months': { label: 'Time to secure new customers', unit: 'months', value: 3 },
  'M04:6 months': { label: 'Time to launch', unit: 'months', value: 6 },
  'M04:last Friday': { none: 'a day name, no number' },
  'M04:3-month sales cycle': { label: 'Sales cycle length', unit: 'months', value: 3 },
  'M05:the 9th of October': { label: 'Reference day of month', unit: 'day', value: 9 },
  'C01:two staffing options': { label: 'Staffing options', unit: 'options', value: 2 },
  'C02:80 tickets per week': { label: 'Tickets resolved per week', unit: 'tickets per week', value: 80 },
  'C03:no specialist': { label: 'Additional specialists', unit: 'specialists', value: 0 },
  'C04:adds one specialist': { label: 'Additional specialists', unit: 'specialists', value: 1 },
  'C05:about 20 tickets per week': { label: 'Tickets per specialist per week', unit: 'tickets per week per specialist', value: 20 },
  'C05:between 10 and 30': { label: 'Tickets per specialist per week', unit: 'tickets per week per specialist', value: 10, rangeEnd: true },
  'C06:the existing 80 tickets per week': { label: 'Tickets resolved per week', unit: 'tickets per week', value: 80 },
  'C07:at least 100 tickets per week': { label: 'Weekly support capacity', unit: 'tickets per week', value: 100 },
  'X01:92': { label: 'Help desk tickets resolved per day', unit: 'tickets per day', value: 92 },
  'X02:1,400': { label: 'Claims processed per week', unit: 'claims per week', value: 1400 },
  'X03:36': { label: 'Patients seen per day', unit: 'patients per day', value: 36 },
  'X04:620': { label: 'Parcels shipped per day', unit: 'parcels per day', value: 620 },
  'X05:74%': { label: 'Press utilisation', unit: '%', value: 74 },
  'X06:180': { label: 'Orders handled per day', unit: 'orders per day', value: 180, rangeEnd: true },
  'X06:220': { label: 'Orders handled per day', unit: 'orders per day', value: 220, rangeEnd: true },
  'X07:14': { label: 'Applications cleared per caseworker per week', unit: 'applications per week per caseworker', value: 14 },
  'X08:45': { label: 'Shoppers handled per checkout lane per hour', unit: 'shoppers per hour per lane', value: 45 },
  'X09:8': { label: 'Admin minutes saved per appointment', unit: 'minutes per appointment', value: 8 },
  'X10:70': { label: 'Mugs per extra kiln batch', unit: 'mugs per batch', value: 70, rangeEnd: true },
  'X10:90': { label: 'Mugs per extra kiln batch', unit: 'mugs per batch', value: 90, rangeEnd: true },
  'X11:3': { label: 'Mortgages closed per referral partner per month', unit: 'mortgages per month per partner', value: 3 },
  'X12:110': { label: 'Fleet range per charging slot', unit: 'miles per slot', value: 110 },
  'X13:85%': { label: 'Occupancy', unit: '%', value: 85 },
  'X14:500': { label: 'Orders per day', unit: 'orders per day', value: 500 },
  'X15:12': { label: 'Queue', unit: 'cases', value: 12 },
  'X16:4': { label: 'Average call duration', unit: 'minutes per call', value: 4 },
  'X17:£75k': { label: 'Lab refit budget', unit: '£', value: 75000 },
  'X18:2%': { label: 'Scrap rate', unit: '%', value: 2 },
  'X18:4%': { label: 'Scrap rate', unit: '%', value: 4 },
  'X19:260': { label: 'Kiosk transactions per day', unit: 'transactions per day', value: 260 },
  'X20:90%': { label: 'Plant utilisation', unit: '%', value: 90 },
  'X21:700': { label: 'Tickets resolved per week', unit: 'tickets per week', value: 700 },
  'X22:18': { label: 'Advisers', unit: 'advisers', value: 18 },
  'X23:48': { label: 'Patients seen per afternoon', unit: 'patients per afternoon', value: 48 },
  'X24:900': { label: 'Cartons shipped per month', unit: 'cartons per month', value: 900 },
  'X24:1,100': { label: 'Cartons shipped per month', unit: 'cartons per month', value: 1100 },
  'X25:310': { label: 'Property sales closed', unit: 'sales', value: 310 },
  'X26:65': { label: 'Insurance claims processed per day', unit: 'claims per day', value: 65 },
  'X27:81%': { label: 'Renewal rate', unit: '%', value: 81 },
  'X28:2,400': { label: 'Meals shipped per week', unit: 'meals per week', value: 2400 },
  'X29:40': { label: 'Walk-ins per day', unit: 'walk-ins per day', value: 40 },
  'X29:55': { label: 'Walk-ins per day', unit: 'walk-ins per day', value: 55 },
  'X30:127': { label: 'Repair backlog', unit: 'repairs', value: 127 },
  'X31:99.95%': { label: 'Hosted service uptime', unit: '%', value: 99.95 },
  'X32:8,000': { label: 'Parcels shipped per day', unit: 'parcels per day', value: 8000 },
  'X33:6%': { label: 'Sector average rejection rate', unit: '%', value: 6 },
  'X34:12,000': { label: 'Deliveries per day', unit: 'deliveries per day', value: 12000 },
  'X35:28': { label: 'Patients seen per dentist per day', unit: 'patients per day', value: 28 },
  'X36:0.5%': { label: 'Sensor failure rate', unit: '%', value: 0.5 },
  'X36:1.2%': { label: 'Sensor failure rate', unit: '%', value: 1.2 },
  'X37:407': { label: 'Project number', unit: 'project', value: 407 },
  'X38:14': { label: 'Draft date day', unit: 'day', value: 14 },
  'X39:7': { label: 'Option number', unit: 'option', value: 7 },
  'X40:three': { label: 'Questions in this brief', unit: 'questions', value: 3 },
  'X41:4': { label: 'Section number', unit: 'section', value: 4 },
  'X42:2.6': { label: 'Template version', unit: 'version', value: 2.6 },
  'X43:300': { label: 'Deliveries per day', unit: 'deliveries per day', value: 300, rangeEnd: true },
  'X43:340': { label: 'Deliveries per day', unit: 'deliveries per day', value: 340, rangeEnd: true },
  'X43:400': { label: 'Deliveries per day', unit: 'deliveries per day', value: 400 },
  'X44:5': { label: 'Jobs per extra installer per week', unit: 'jobs per week per installer', value: 5 },
  'X44:two': { label: 'Installers hired', unit: 'installers', value: 2 },
  'X44:35': { label: 'Jobs finished per week', unit: 'jobs per week', value: 35 },
  'X45:17': { label: 'Contracts closed per quarter', unit: 'contracts per quarter', value: 17 },
  'X45:24': { label: 'Contracts closed per quarter', unit: 'contracts per quarter', value: 24 },
  'X46:460': { label: 'Calls handled per day', unit: 'calls per day', value: 460 },
  'X46:120': { label: 'Bookings processed per day', unit: 'bookings per day', value: 120 },
  'X46:2': { label: 'Note label', unit: 'note', value: 2 },
  'X47:4': { label: 'Water use per litre of beer', unit: 'litres per litre', value: 4 },
  'X47:2.8': { label: 'Water use per litre of beer', unit: 'litres per litre', value: 2.8 },
  'X48:68%': { label: 'Room occupancy', unit: '%', value: 68 },
  'X48:61%': { label: 'Room occupancy', unit: '%', value: 61 },
  'X48:2': { label: 'Occupancy lift per tour-group booking', unit: 'percentage points per booking', value: 2 },
};

type Expect = 'credit' | 'refuse' | 'pending';
function expectation(key: string, label: string, d: Draft): Expect {
  const l = AIE_LABEL.get(key) ?? label;
  if ('none' in d) return 'refuse';
  if (l === 'effect-rate') return d.rangeEnd ? 'refuse' : 'pending';
  if (l === 'level') return d.rangeEnd ? 'refuse' : 'credit';
  return 'refuse';
}

type Rec = Record<string, unknown>;
function stored(model: CandidateModel, brief: string, label: string): 'human' | 'ai' | 'unknown' {
  const nodes = admitCandidateModel(model, {}, brief).nodes as unknown as Rec[];
  const node = nodes.find(n => n.kind === 'factor' && n.label === label);
  expect(node, `admitted factor "${label}"`).toBeDefined();
  return provenanceOf(node!.observed_state);
}
const claim = (d: { label: string; unit: string; value: number }, quote: string) => ({
  label: d.label, baseline_value: d.value, unit: d.unit, baseline_known: true, provenance: 'explicit', role: 'observable',
  plausible_max: Math.max(10, Math.abs(d.value) * 10), baseline_evidence: { quote },
});
/** The sentence alone is the brief; the goal holds no figure, so only the sentence's own reading decides. */
function alone(sentence: string, d: { label: string; unit: string; value: number }): CandidateModel {
  return {
    goal: { metric: 'Overall outcome', value: null, unit: null, operator: '>=', horizon_months: null, provenance: 'explicit' },
    constraints: [], options: [], outcomes: [], risks: [], links: [], factors: [claim(d, sentence)],
  } as unknown as CandidateModel;
}

const rows = [...corpus.verbatim.sentences, ...corpus.extension].flatMap(s => s.figures.map(f => {
  const figure = f.text ?? f.figure!;
  const key = `${s.id}:${figure}`;
  return { s, key, label: f.label, draft: DRAFTS[key] };
}));

describe('corpus integrity', () => {
  it('the fixture is the pinned corpus byte for byte', () => {
    expect(CORPUS_SHA256).toHaveLength(64);
    expect(createHash('sha256').update(RAW).digest('hex')).toBe(CORPUS_SHA256);
  });
  it('every corpus figure has exactly one draft, and no draft names a figure the corpus lacks', () => {
    expect(rows.filter(r => r.draft === undefined).map(r => r.key)).toEqual([]);
    expect(Object.keys(DRAFTS).filter(k => !rows.some(r => r.key === k))).toEqual([]);
    expect(rows).toHaveLength(Object.keys(DRAFTS).length);
  });
  it('the two adjudicated rows are the corpus\'s own open rows', () => {
    expect(corpus.adjudicate.map(a => a.id).sort()).toEqual(['H06', 'M04']);
  });
});

describe('each corpus figure, drafted as a claimed level and admitted alone: credited ⇔ the corpus says level', () => {
  for (const r of rows) {
    const d = r.draft!;
    const want = expectation(r.key, r.label, d);
    const tag = AIE_LABEL.has(r.key) ? ` (AIE 6120633627: ${AIE_LABEL.get(r.key)})` : d && 'rangeEnd' in d ? ' (range end)' : '';
    if ('none' in d) { it(`${r.key} [${r.label}] has no number to credit: ${d.none}`, () => undefined); continue; }
    const name = `${r.key} [${r.label}${tag}] → ${want === 'pending' ? 'PENDING V2: never Olumi\'s' : want === 'credit' ? 'the user\'s' : 'not the user\'s point, never Olumi\'s'}`;
    it(name, () => {
      const got = stored(alone(r.s.sentence, d), r.s.sentence, d.label);
      if (want === 'credit') expect(got).toBe('human');
      else if (want === 'refuse') expect(got).toBe('unknown');
      else expect(got).not.toBe('ai');
    });
  }
});

/** DGAI e2e/core/journey/J1-whole-poc.journey.spec.ts LEVEL_BRIEF @40c7b914 (corpus `verbatim.sources.capacity`). */
const CAPACITY = 'We are comparing two staffing options, labelled exactly "Keep current staffing" and "Add one specialist". Use the exact goal label "Weekly support capacity". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.';
describe('the capacity sentences inside their own served brief (quoted option labels first: V1)', () => {
  const inBrief = (key: string): CandidateModel => {
    const r = rows.find(x => x.key === key)!; const d = r.draft as { label: string; unit: string; value: number };
    return {
      goal: { metric: 'Weekly support capacity', operator: '>=', target_stated: true, frame: 'level', value: 100, unit: 'tickets per week',
        horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null },
      constraints: [], risks: [], outcomes: [], unknowns: [], links: [],
      options: [
        { label: 'Keep current staffing', provenance: 'explicit', is_status_quo: true, changes: ['Additional specialists'],
          interventions: [{ factor_label: 'Additional specialists', value: 0, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit' }] },
        { label: 'Add one specialist', provenance: 'explicit', is_status_quo: null, changes: ['Additional specialists'],
          interventions: [{ factor_label: 'Additional specialists', value: 1, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit' }] },
      ],
      factors: [
        { label: 'Additional specialists', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'specialists', provenance: 'explicit', plausible_max: 10 },
        ...(d.label === 'Additional specialists' ? [] : [claim(d, r.s.sentence)]),
      ],
    } as unknown as CandidateModel;
  };
  for (const key of ['C02:80 tickets per week', 'C06:the existing 80 tickets per week', 'C05:about 20 tickets per week']) {
    const r = rows.find(x => x.key === key)!; const d = r.draft as { label: string; unit: string; value: number };
    const want = expectation(key, r.label, d);
    it(`${key} [${r.label}] in the capacity brief → ${want === 'pending' ? 'PENDING V2: never Olumi\'s' : want === 'credit' ? 'the user\'s' : 'not the user\'s point, never Olumi\'s'}`, () => {
      const got = stored(inBrief(key), CAPACITY, d.label);
      if (want === 'credit') expect(got).toBe('human');
      else if (want === 'refuse') expect(got).toBe('unknown');
      else expect(got).not.toBe('ai');
    });
  }
});
