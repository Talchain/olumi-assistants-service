/**
 * ⛔ G3 a735, GENERATIVE SWEEP (DL-3 14:28Z: a matcher ships with every confusable case in its first round; DL-3 16:1xZ ruling on
 * BUDDY-A #3356 R5: ONE unit authority, never convert). A link-effect range is the user's range in the AI's unit only where that unit
 * agrees with the COMPLETE unit written WITH THAT RANGE (magnitude, period); otherwise it is still recorded, whole, with no unit.
 * Dimensions: magnitude unit × period × another quantity in the sentence × written or absent. ORACLE: complete-unit agreement by the
 * estate's own authority (`readUnitParts` part by part; `sameUnit` against the link), over the unit text THIS test writes
 * at the range: the sweep proves which words count, never re-implements the unit grammar. SYNTHETIC sentences.
 */
import { describe, expect, it } from 'vitest';
import { sourceMapOf } from '../construction-source-map.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { figureTheUserWrote } from '../stated-by-user.js';
import { readUnitParts, sameUnit } from '../same-unit.js';

type Rec = Record<string, any>;
/** Magnitude units as written (no bare "m": "6 m" is six million) and the AI's extra claimed spellings. */
const WRITTEN = ['mm', 'millimetres', 'cm', 'metres', 'km', 'mg', 'g', 'grams', 'kg', 'kgs', 'kilograms', 'lb', 'lbs', 'oz', 'ml', 'litres',
  'seconds', 'minutes', 'mins', 'hours', 'days', 'weeks', 'percent', 'per cent', 'percentage points', 'crates'];
const CLAIMED = [...WRITTEN, 'm', 'l', 's', 'h', 'pp', '%'];
const PERIODS = ['', ' a day', ' per week'];
/** The oracle (DL-3 fail-safe core): every part of the complete unit written at the range EQUALS the claim's, present alike. */
const agrees = (written: string, claimed: string): boolean => {
  const w = readUnitParts(written), c = readUnitParts(claimed);
  // Present alike (BUDDY-A R8): an unnamed denominator ("each", []) is never none (null).
  return w !== null && c !== null && w.kind === c.kind && w.code === c.code && w.period === c.period
    && (['noun', 'per', 'base', 'qualifiers'] as const).every((k) => JSON.stringify(w[k]) === JSON.stringify(c[k]));
};
const KEY = 'link|pre-order system in use|daily food waste||effect';
const statement = (quote: string, unit: string, low = 4, high = 6): Rec => ({ quote, subject: { kind: 'link', label: 'Pre-order system in use', to_label: 'Daily food waste', factor_label: null },
  field: 'effect', form: 'range', value: null, low, high, unit, qualifier: null, conditions: null });
/** The range as the verifier keeps it: always recorded, in the AI's unit or in none. */
const recordedUnit = (quote: string, unit: string, low?: number, high?: number): string | undefined =>
  (sourceMapOf([statement(quote, unit, low, high)], quote).verified.get(KEY) ?? []).find((s) => s.form === 'range')?.unit;

describe('SWEEP: a range is recorded in the AI\'s unit only where the complete unit written WITH it agrees; else in none', () => {
  it(`at the range's own end: ${WRITTEN.length} units × ${PERIODS.length} periods × ${CLAIMED.length} claims (and the claim's own period)`, () => {
    const wrong: string[] = [];
    for (const w of WRITTEN) for (const p of PERIODS) {
      const quote = `Our manager reckons a pre-order system would cut waste by between 4 and 6 ${w}${p}.`;
      for (const c of [...CLAIMED, `${w} per day`, `${w} per week`]) {
        const expected = agrees(`${w}${p}`, c) ? c : '';
        const got = recordedUnit(quote, c);
        if (got !== expected) wrong.push(`"6 ${w}${p}" claimed ${c}: ${got === undefined ? 'no record' : `unit "${got}"`}, expected "${expected}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('money and denominators (BUDDY-A R6): the complete written rate decides, never a currency alone or a contained denominator', () => {
    const wrong: string[] = [];
    const MONEY = [['£', ''], ['£', ' a week'], ['£', ' per day'], ['£', ' each'], ['$', ' a day'], ['€', '']] as const;
    const MONEY_CLAIMS = ['£', 'GBP', '£ per day', '£ per week', '£ each', '$', 'USD per day', '$ per week', '€', 'EUR per day'];
    for (const [sym, p] of MONEY) {
      const quote = `Our manager reckons it would save between ${sym}4 and ${sym}6${p}.`;
      for (const c of MONEY_CLAIMS) {
        const expected = agrees(`${sym}${p}`, c) ? c : '';
        if (recordedUnit(quote, c) !== expected) wrong.push(`"${sym}6${p}" claimed ${c}: "${recordedUnit(quote, c)}", expected "${expected}"`);
      }
    }
    for (const w of ['kg per client', 'kg per new client', 'kg per client per week']) for (const c of ['kg per client', 'kg per new client', 'kg', 'kg per week', 'kg per client per week']) {
      const quote = `Our manager reckons it would cut waste by between 4 and 6 ${w}.`;
      const expected = agrees(w, c) ? c : '';
      if (recordedUnit(quote, c) !== expected) wrong.push(`"6 ${w}" claimed ${c}: "${recordedUnit(quote, c)}", expected "${expected}"`);
    }
    // Not vacuous: each family has a case the AI's unit holds, and one it does not.
    expect(recordedUnit('Our manager reckons it would save between £4 and £6 a week.', '£ per week')).toBe('£ per week');
    expect(recordedUnit('Our manager reckons it would save between £4 and £6 a week.', '£ per day')).toBe('');
    expect(recordedUnit('Our manager reckons it would save between £4 and £6 each.', '£ each')).toBe('£ each');
    expect(recordedUnit('Our manager reckons it would save between £4 and £6 each.', '£')).toBe('');
    expect(recordedUnit('Our manager reckons it would cut waste by between 4 and 6 kg per new client.', 'kg per client')).toBe('');
    expect(recordedUnit('Our manager reckons it would cut waste by between 4 and 6 kg per client.', 'kg per client')).toBe('kg per client');
    expect(wrong).toEqual([]);
  });

  it('another quantity in the sentence never lends its unit (written at the range, or nothing written there)', () => {
    const wrong: string[] = [];
    for (const w of WRITTEN) for (const c of CLAIMED) {
      if (agrees(w, c)) continue;
      for (const quote of [
        `Our manager reckons it would cut waste by between 4 and 6 ${w} a day, while the stand is 6 ${c} high.`,
        `Our manager reckons it would cut waste by between 4 and 6 ${w}, with each one weighing 10 ${c}.`,
      ]) if (recordedUnit(quote, c) !== '') wrong.push(`«${quote}» claimed ${c}: ${recordedUnit(quote, c)}`);
    }
    for (const c of CLAIMED) {
      const quote = `Our manager reckons it would cut waste by between 4 and 6, while the stand is 6 ${c} high.`;
      if (recordedUnit(quote, c) !== '') wrong.push(`nothing written at the range, claimed ${c}: ${recordedUnit(quote, c)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('a noun with other words is another population (BUDDY-A R7; DL-3 exit): kept whole, unconverted; the same noun is kept in it', () => {
    const wrong: string[] = [];
    for (const c of ['visitors', 'kg', 'litres', 'hours']) {
      // The tail reader's noun is the whole phrase after the figure (up to three words), so a unit stands alone to equal the claim.
      if (recordedUnit(`Our manager reckons the scheme would bring between 20 and 40 ${c}.`, c, 20, 40) !== c) wrong.push(`${c}: not in ${c}`);
      if (recordedUnit(`Our manager reckons the scheme would bring between 20 and 40 ${c} that week.`, c, 20, 40) !== '') wrong.push(`${c} that week: read as ${c}`);
      if (recordedUnit(`Our manager reckons the scheme would bring between 20 and 40 extra ${c}.`, c, 20, 40) !== '') wrong.push(`extra ${c}: read as ${c}`);
      if (recordedUnit('Our manager reckons the scheme would bring between 20 and 40 more of them each time.', c, 20, 40) !== '') wrong.push(`no unit, claimed ${c}`);
    }
    if (recordedUnit('Our manager reckons the scheme would bring between 4 and 6 non-paying visitors.', 'paying visitors') !== '') wrong.push('non-paying read as paying');
    if (recordedUnit('Our manager reckons the scheme would bring between 4 and 6 paying visitors.', 'paying visitors') !== 'paying visitors') wrong.push('paying not kept');
    expect(wrong).toEqual([]);
  });
});

describe('SWEEP: admission sets an Olumi size aside exactly when the recorded range is not in the link\'s complete unit', () => {
  const LINK_UNITS = ['kg', 'kg per day', 'lb', 'metres', 'mm', 'litres', 'hours'] as const;
  const model = (edgeUnit: string, written: string, claimed: string): { model: Rec; brief: string } => {
    const goal = `We want to bring daily food waste down from about 40 ${edgeUnit} today to at most 30 ${edgeUnit} by the end of next year.`;
    const range = `Our kitchen manager reckons switching on a pre-order system would cut waste by between 4 and 6 ${written}.`;
    const option = (label: string, factor: string): Rec => ({ label, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: factor, value: 100, value_kind: 'absolute', unit: '%', provenance: 'explicit' }] });
    return { brief: `${goal} ${range} We can afford only one option this year.`, model: {
      goal: { kind: null, deliverable: null, metric: 'Daily food waste', operator: '<=', target_stated: true, value: 30, unit: edgeUnit, horizon_months: null,
        provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 40, baseline_provenance: 'explicit', scope: null,
        quantity_frame: 'level', source_quote: goal, deadline_words: null },
      constraints: [],
      options: [{ label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
        option('Pre-order system', 'Pre-order system in use')],
      factors: [{ label: 'Pre-order system in use', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }],
      risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
      links: [{ from: 'Pre-order system in use', to: 'Daily food waste', direction: 'negative', provenance: 'explicit', effect_amount: -4, effect_per_source_change: 100,
        effect_provenance: 'inferred', definitional: null, basis: 'Uses the stated lower end as a provisional planning effect.', source_quote: range }],
      statements: [
        { quote: goal, subject: { kind: 'goal', label: 'Daily food waste', to_label: null, factor_label: null }, field: 'level', form: 'point', value: 40, low: null, high: null, unit: edgeUnit, qualifier: 'about', conditions: null },
        { quote: goal, subject: { kind: 'goal', label: 'Daily food waste', to_label: null, factor_label: null }, field: 'target', form: 'upper_bound', value: 30, low: null, high: null, unit: edgeUnit, qualifier: null, conditions: null },
        { ...statement(range, claimed, -6, -4) },
      ],
    } };
  };
  it(`${LINK_UNITS.length} link units × written units and periods × the claim (as written, as the link's unit, and wrong)`, { timeout: 60_000 }, () => {
    const wrong: string[] = [];
    const reached = { aside: 0, kept: 0 };
    for (const e of LINK_UNITS) for (const written of ['kg', 'kg a day', 'kg per week', 'kilograms', 'lb', 'mm', 'metres', 'litres', 'hours', 'crates']) {
      for (const claimed of [written, e, 'grams']) {
        const { model: m, brief } = model(e, written, claimed);
        const out = admitCandidateModel(m as CandidateModel, {}, brief, (v, u) => figureTheUserWrote(v, u, brief));
        const goalId = out.nodes.find((n: Rec) => n.kind === 'goal')?.id;
        const edge = out.edges.find((x: Rec) => x.to === goalId) as Rec | undefined;
        if (edge === undefined) { wrong.push(`${e}/${written}/${claimed}: no edge`); continue; }
        const said = out.loss.some((l: Rec) => l.field_path.endsWith('.stated_range_other_unit'));
        const setAside = edge.provenance?.magnitude === 'olumi_placeholder';
        const expected = !sameUnit(agrees(written, claimed) ? claimed : '', e);
        reached[expected ? 'aside' : 'kept'] += 1;
        // Set aside AND said, or neither: a placeholder for another reason, or a sentence without the set-aside, is wrong too.
        if (setAside !== expected || said !== expected) wrong.push(`link ${e}, written ${written}, claimed ${claimed}: ${setAside ? 'placeholder' : edge.provenance?.magnitude}, ${said ? 'said' : 'silent'}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(Math.min(reached.aside, reached.kept), JSON.stringify(reached)).toBeGreaterThan(5);
  });
});
