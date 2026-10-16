/**
 * ⭐ G3 option C's cost (VERIFY-1a1a7907; TL 19:18Z ACK of Lane A's prompt shortcut, C4 rule 2 UNCHANGED). The user stated ONE
 * figure for an option made of several parts; the drafter bound it to two subjects of that option (its spend and its cost),
 * so C4 rule 2 left both unverified (`cee_hypothesis`, "Not confirmed from your brief") and the cost check could not use it.
 * The drafter is now told (STATEMENTS_INSTRUCTION, the AIE's exact AMEND of TL 19:18Z's shortcut): "When the source states one
 * aggregate cost covering named parts of the same option, record that stated total ONCE against that option's aggregate
 * cost … Keep separately stated costs separate. … existing source verification determines whether that binding is supported."
 * Rows through the real build, scripted drafter (the prompt pin is construction-source-map.test.ts):
 *  · attributed once → the option's cost is stored as the user's total (`brief_extraction`, not unverified);
 *  · RULE 2 KEPT: the same figure bound to two of the option's parts stays unverified on both;
 *  · CONTRAST: two figures the user stated separately stay separate, each the user's.
 * SYNTHETIC brief (never an unseen brief).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, STATEMENTS_INSTRUCTION } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const LEVEL = 'Our library gets about 2000 visits a week at the moment.';
const TARGET = 'We need at least 2400 visits a week by the end of next year.';
const TOTAL = 'Option two is an outreach campaign covering posters and school visits, costing £18,000 a year in total.';
const SPLIT = 'Option two is an outreach campaign: posters would cost £8,000 a year and school visits £10,000 a year.';
const statement = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null, conditions: null });
const setting = (option: string, factor: string, value: number, quote: string): Rec =>
  statement(quote, { kind: 'option', label: option, factor_label: factor }, 'level', 'point', { value }, '£/year');
const factor = (label: string, unit: string, max: number): Rec =>
  ({ label, role: 'controllable', baseline_known: false, baseline_value: 0, unit, provenance: 'inferred', plausible_max: max });

/** shape: 'once' (the option's total on its own cost), 'twice' (the same figure on two parts), 'split' (two stated figures). */
function draft(shape: 'once' | 'twice' | 'split'): { brief: string; text: string } {
  const sentence = shape === 'split' ? SPLIT : TOTAL;
  const parts = shape === 'split' ? [['Poster spend', 8000], ['School visit spend', 10000]] as const
    : shape === 'twice' ? [['Annual extra cost', 18000], ['Outreach spend', 18000]] as const : [['Annual extra cost', 18000]] as const;
  return {
    brief: `${LEVEL} ${TARGET} Option one is keeping the current service. ${sentence}`,
    text: JSON.stringify({
      goal: { kind: null, deliverable: null, metric: 'Weekly library visits', operator: '>=', target_stated: true, value: 2400, unit: 'visits per week', horizon_months: null,
        provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 2000, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
        basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'visits per week', effects_at_period_end: false, also_required: null, open_question: null },
        source_quote: TARGET, deadline_words: null },
      constraints: [],
      options: [
        { label: 'Keep current service', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
        { label: 'Outreach campaign', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
          interventions: [{ factor_label: 'Campaign running', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' },
            ...parts.map(([f, v]) => ({ factor_label: f, value: v, value_kind: 'absolute', unit: '£/year', provenance: 'explicit' }))] },
      ],
      factors: [factor('Campaign running', '0/1', 1), ...parts.map(([f]) => factor(f, '£/year', 40000))],
      risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
      links: [{ from: 'Campaign running', to: 'Weekly library visits', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }],
      statements: [
        statement(LEVEL, { kind: 'goal', label: 'Weekly library visits' }, 'level', 'point', { value: 2000 }, 'visits per week'),
        statement(TARGET, { kind: 'goal', label: 'Weekly library visits' }, 'target', 'lower_bound', { value: 2400 }, 'visits per week'),
        ...parts.map(([f, v]) => setting('Outreach campaign', f, v, sentence)),
      ],
    }),
  };
}
async function built(shape: 'once' | 'twice' | 'split'): Promise<Rec> {
  const { brief, text } = draft(shape);
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text, status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return graph!;
}
/** The option's stored setting of the factor labelled `label`. */
const settingOf = (g: Rec, label: string): Rec => {
  const id = (g.nodes as Rec[]).find((n) => n.label === label)!.id as string;
  return (g.nodes as Rec[]).find((n) => n.label === 'Outreach campaign')!.interventions[id] as Rec;
};

describe('one figure for several parts of an option is the user\'s total, attributed once', () => {
  it('the drafter is told to record a stated total once, against the option\'s aggregate cost (the AIE\'s exact text)', () => {
    const packet = JSON.parse(readFileSync('tests/fixtures/sys2/aie-one-figure-option-total-amendment-v1.json', 'utf8')) as { changes: { replacement: string }[] };
    expect(STATEMENTS_INSTRUCTION).toContain(packet.changes[0]!.replacement);
    expect(STATEMENTS_INSTRUCTION).toContain('record that stated total ONCE against that option\'s aggregate cost');
    expect(STATEMENTS_INSTRUCTION).toContain('Keep separately stated costs separate.');
  });
  it('⭐ attributed ONCE: the option\'s cost is stored as the user\'s £18,000 total', async () => {
    const g = await built('once');
    const cost = settingOf(g, 'Annual extra cost');
    expect(cost).toMatchObject({ raw_value: 18000, source: 'brief_extraction' });
    // The campaign's own switch is a structural setting, never a second claim on the figure.
    expect(settingOf(g, 'Campaign running')).toMatchObject({ value: 1 });
    expect(cost.user_material_unverified).toBeUndefined();
  });
  it('RULE 2 KEPT: the same £18,000 bound to two of the option\'s parts stays unverified on both', async () => {
    const g = await built('twice');
    for (const part of ['Annual extra cost', 'Outreach spend']) {
      // The served G3 shape (VERIFY-1a1a7907 reads/01-brief.json): Olumi's hypothesis, flagged as unverified user material.
      expect(settingOf(g, part)).toMatchObject({ raw_value: 18000, source: 'cee_hypothesis', user_material_unverified: true });
    }
  });
  it('CONTRAST: two figures the user stated separately stay separate, each the user\'s', async () => {
    const g = await built('split');
    expect(settingOf(g, 'Poster spend')).toMatchObject({ raw_value: 8000, source: 'brief_extraction' });
    expect(settingOf(g, 'School visit spend')).toMatchObject({ raw_value: 10000, source: 'brief_extraction' });
  });
});
