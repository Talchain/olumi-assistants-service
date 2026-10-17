/**
 * ⛔ G3 a735, GENERATIVE SWEEP (DL-3 14:28Z: a matcher ships with every confusable case in its first round; #3356 R1–R3 found
 * lb/kg, mm/m and a borrowed "6 metres" one at a time). Every written spelling × every claimed spelling of the confusable unit
 * families, at the range's own end, borrowed from an unrelated equal figure, and absent. The ORACLE is the family table below,
 * written independently of the implementation's vocabulary (bare "points" is no share: it is a score as often as percentage points,
 * as the ONE unit vocabulary `utils/unit-alphabet.ts` reads it). SYNTHETIC sentences.
 * - The verifier (`sourceMapOf`): a range is recorded in the AI's unit only when its words do not contradict it.
 * - Admission (`admitCandidateModel`): an Olumi size inside a range written in another family is set aside (placeholder), and a
 *   range written in the link's own family, however spelt, is not.
 */
import { describe, expect, it } from 'vitest';
import { sourceMapOf } from '../construction-source-map.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { figureTheUserWrote } from '../stated-by-user.js';

type Rec = Record<string, any>;
/** Oracle: spellings that name the SAME unit. Written spellings avoid magnitude letters ("6 m" is six million). */
const FAMILIES: readonly { readonly written: readonly string[]; readonly claimedOnly?: readonly string[] }[] = [
  { written: ['mm', 'millimetres'] }, { written: ['cm', 'centimetres'] }, { written: ['metres', 'metre'], claimedOnly: ['m'] },
  { written: ['km', 'kilometres'] }, { written: ['mg', 'milligrams'] }, { written: ['g', 'grams'] },
  { written: ['kg', 'kgs', 'kilograms'] }, { written: ['lb', 'lbs'] }, { written: ['oz', 'ounces'] },
  { written: ['ml', 'millilitres'] }, { written: ['litres'], claimedOnly: ['l'] }, { written: ['ms', 'milliseconds'] },
  { written: ['seconds', 'secs'], claimedOnly: ['s'] }, { written: ['minutes', 'mins'] }, { written: ['hours', 'hrs'], claimedOnly: ['h'] },
  { written: ['days'] }, { written: ['weeks'] }, { written: ['%', 'percent', 'per cent'] }, { written: ['percentage points'], claimedOnly: ['pp'] },
];
const familyOf = (spelling: string): number => FAMILIES.findIndex((f) => f.written.includes(spelling) || (f.claimedOnly ?? []).includes(spelling));
const WRITTEN = FAMILIES.flatMap((f) => f.written);
const CLAIMED = FAMILIES.flatMap((f) => [...f.written, ...(f.claimedOnly ?? [])]);
const at = (w: string): string => (w === '%' ? '6%' : `6 ${w}`);
const KEY = 'link|pre-order system in use|daily food waste||effect';
const statement = (quote: string, unit: string, low = 4, high = 6): Rec => ({ quote, subject: { kind: 'link', label: 'Pre-order system in use', to_label: 'Daily food waste', factor_label: null },
  field: 'effect', form: 'range', value: null, low, high, unit, qualifier: null, conditions: null });
const recorded = (quote: string, unit: string, low?: number, high?: number): boolean =>
  (sourceMapOf([statement(quote, unit, low, high)], quote).verified.get(KEY) ?? []).length > 0;

describe('SWEEP: a range is recorded in the AI\'s unit only where its own words do not say another', () => {
  it(`at the range's own end: ${WRITTEN.length} written × ${CLAIMED.length} claimed spellings — recorded exactly when they name the same unit`, () => {
    const wrong: string[] = [];
    for (const w of WRITTEN) for (const c of CLAIMED) {
      const quote = `Our manager reckons a pre-order system would cut waste by between 4 and ${at(w)} a day.`;
      const expected = familyOf(w) === familyOf(c);
      if (recorded(quote, c) !== expected) wrong.push(`${w} read as ${c}: expected ${expected ? 'recorded' : 'refused'}`);
    }
    expect(wrong).toEqual([]);
  });

  it('borrowed: the claimed unit written only after an UNRELATED equal figure never becomes the range\'s unit', () => {
    const wrong: string[] = [];
    for (const f of FAMILIES) for (const g of FAMILIES) {
      if (f === g) continue;
      const w = f.written[0]!, c = g.written[0]!;
      const quote = `Our manager reckons a pre-order system would cut waste by between 4 and ${at(w)} a day, while the stand is ${at(c)} high.`;
      if (recorded(quote, c)) wrong.push(`${w} with an unrelated ${at(c)}: recorded in ${c}`);
    }
    // A word outside every family at the range ("crates") is no unit of these: the unrelated figure still never lends one.
    for (const c of CLAIMED) {
      const quote = `Our manager reckons a pre-order system would cut waste by between 4 and 6 crates a day, while the stand is ${at(c === 'm' ? 'metres' : c === 'l' ? 'litres' : c === 's' ? 'seconds' : c === 'h' ? 'hours' : c === 'pp' ? 'points' : c)} high.`;
      if (recorded(quote, c)) wrong.push(`6 crates with an unrelated 6 ${c}: recorded in ${c}`);
    }
    expect(wrong).toEqual([]);
  });

  it('POSITIVE CONTROLS: a unit written after a word ("extra"), or once beside the central figure, is still read; one never written is not', () => {
    const wrong: string[] = [];
    for (const c of WRITTEN) {
      const extra = `Our manager reckons the scheme would bring between 20 and 40 extra ${c === '%' ? 'percent' : c} that week.`;
      if (!recorded(extra, c, 20, 40)) wrong.push(`extra ${c}: refused`);
      const central = `Our manager thinks it would add about 5 ${c === '%' ? 'percent' : c}, between 4 and 7.`;
      if (!recorded(central, c, 4, 7)) wrong.push(`about 5 ${c}, between 4 and 7: refused`);
      const none = 'Our manager reckons the scheme would bring between 20 and 40 more of them each time.';
      if (recorded(none, c, 20, 40)) wrong.push(`no unit written, claimed ${c}: recorded`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('SWEEP: admission sets an Olumi size aside exactly when the range is written in another unit than the link\'s', () => {
  // One link unit per family the sweep writes, plus one spelling variant (kilograms): every written spelling meets each.
  const LINK_UNITS = ['kg', 'kilograms', 'lb', 'metres', 'mm', 'litres', 'hours', 'days'] as const;
  const model = (edgeUnit: string, w: string, claimed: string): { model: Rec; brief: string } => {
    const goal = `We want to bring daily food waste down from about 40 ${edgeUnit} today to at most 30 ${edgeUnit} by the end of next year.`;
    const range = `Our kitchen manager reckons switching on a pre-order system would cut waste by between 4 and ${at(w)} a day.`;
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
  it(`${LINK_UNITS.length} link units × every written spelling (claimed as written, as the link's unit, and in a third family)`, { timeout: 60_000 }, () => {
    const wrong: string[] = [];
    // Claimed as written, as the link's unit, and in a THIRD family (refused for its claim: its own words still decide).
    const third = (w: string, e: string): string => CLAIMED.find((c) => familyOf(c) !== familyOf(w) && familyOf(c) !== familyOf(e))!;
    for (const e of LINK_UNITS) for (const w of WRITTEN) for (const claimed of [w, e, third(w, e)]) {
      const { model: m, brief } = model(e, w, claimed);
      const out = admitCandidateModel(m as CandidateModel, {}, brief, (v, u) => figureTheUserWrote(v, u, brief));
      const goalId = out.nodes.find((n: Rec) => n.kind === 'goal')?.id;
      const edge = out.edges.find((x: Rec) => x.to === goalId) as Rec | undefined;
      if (edge === undefined) { wrong.push(`${e}/${w}/${claimed}: no edge`); continue; }
      const said = out.loss.some((l: Rec) => l.field_path.endsWith('.stated_range_other_unit'));
      const setAside = edge.provenance?.magnitude === 'olumi_placeholder';
      const expected = familyOf(w) !== familyOf(e);
      // Set aside AND said, or neither: a placeholder for another reason, or a sentence without the set-aside, is wrong too.
      if (setAside !== expected || said !== expected) wrong.push(`link ${e}, written ${w}, claimed ${claimed}: ${setAside ? 'placeholder' : edge.provenance?.magnitude}, ${said ? 'said' : 'silent'}`);
    }
    expect(wrong).toEqual([]);
  });
});
