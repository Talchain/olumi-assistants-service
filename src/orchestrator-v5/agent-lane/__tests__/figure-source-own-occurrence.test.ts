/**
 * ⭐ ONE FIGURE PER OCCURRENCE (PROMPT-INT first-loss trace, prompt/DRAFTER-NET-CHANGE-FIRST-LOSS.md §2; DL-3). Where one sentence of the
 * brief carries BOTH options' figures, every statement quotes that whole sentence (STATEMENTS requires it). `figureSource`'s uniqueness
 * clause (C4 rule 2) then refused each option's setting: measured on the drafts, the rival was the LINK from the option's own factor,
 * stating the same figure from the same writing (the setting and what it adds are one quantity read twice). A rival is now only another
 * subject claiming the SAME writing: the sentence may write the figure once per claimant (read by the one reader, `timesTheUserWrote`),
 * and the link carried by the setting is no rival. RULE 2 is kept for one writing claimed twice.
 * Real path: `buildModelFromBrief` with a scripted drafter → admission → the registered graph. SYNTHETIC briefs; 0 provider calls.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { figureSource } from '../construction-source-map.js';

type Rec = Record<string, any>;
const LEVEL = 'Our warehouse ships about 400 orders a day at the moment.';
const TARGET = 'We need at least 460 orders a day by the end of next year.';
const statement = (quote: string, subject: Rec, field: string, form: string, value: number, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null });
const setting = (option: string, factor: string, value: number, quote: string): Rec =>
  statement(quote, { kind: 'option', label: option, factor_label: factor }, 'level', 'point', value, 'orders a day');
const carriedLink = (factor: string, value: number, quote: string): Rec =>
  statement(quote, { kind: 'link', label: factor, to_label: 'Daily orders shipped' }, 'effect', 'point', value, 'orders a day');
const OPTIONS = [['Hire a temp', 'Temp order capacity'], ['Add a picking robot', 'Robot order capacity']] as const;

/** One draft: each option sets its own capacity factor to its figure, each factor links to the goal; every statement quotes `sentence`. */
function draft(sentence: string, figures: readonly [number, number], links: 'carried' | 'none' | 'rival'): { brief: string; text: string } {
  return {
    brief: `${LEVEL} ${TARGET} ${sentence}`,
    text: JSON.stringify({
      goal: { kind: null, deliverable: null, metric: 'Daily orders shipped', operator: '>=', target_stated: true, value: 460, unit: 'orders a day', horizon_months: null,
        provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 400, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
        basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'orders a day', effects_at_period_end: false, also_required: null, open_question: null },
        source_quote: TARGET, deadline_words: null },
      constraints: [],
      options: [
        { label: 'Keep things as they are', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
        ...OPTIONS.map(([label, factor], i) => ({ label, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
          interventions: [{ factor_label: factor, value: figures[i], value_kind: 'additional', unit: 'orders a day', provenance: 'explicit' }] })),
      ],
      factors: [...OPTIONS.map(([, factor]) => ({ label: factor, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'orders a day', provenance: 'inferred', plausible_max: 200 })),
        ...(links === 'rival' ? [{ label: 'Returns handled', role: 'external', baseline_known: false, baseline_value: 0, unit: 'orders a day', provenance: 'inferred', plausible_max: 200 }] : [])],
      risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
      links: [...OPTIONS.map(([, factor]) => ({ from: factor, to: 'Daily orders shipped', direction: 'positive', provenance: 'explicit', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null })),
        ...(links === 'rival' ? [{ from: 'Returns handled', to: 'Daily orders shipped', direction: 'negative', provenance: 'ai_proposed', effect_amount: null,
          effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }] : [])],
      statements: [
        statement(LEVEL, { kind: 'goal', label: 'Daily orders shipped' }, 'level', 'point', 400, 'orders a day'),
        statement(TARGET, { kind: 'goal', label: 'Daily orders shipped' }, 'target', 'lower_bound', 460, 'orders a day'),
        ...OPTIONS.map(([label, factor], i) => setting(label, factor, figures[i], sentence)),
        ...(links === 'carried' ? OPTIONS.map(([, factor], i) => carriedLink(factor, figures[i], sentence)) : []),
        ...(links === 'rival' ? [carriedLink('Returns handled', figures[0], sentence)] : []),
      ],
    }),
  };
}
async function built(sentence: string, figures: readonly [number, number], links: 'carried' | 'none' | 'rival'): Promise<Rec> {
  const { brief, text } = draft(sentence, figures, links);
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text, status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return graph!;
}
const settingOf = (g: Rec, option: string, factor: string): Rec => {
  const id = (g.nodes as Rec[]).find((n) => n.label === factor)!.id as string;
  return (g.nodes as Rec[]).find((n) => n.label === option)!.interventions[id] as Rec;
};

const BOTH = 'Hiring a temp would add exactly 30 orders a day; adding a picking robot would add exactly 25 orders a day.';
const SAME_TWICE = 'Hiring a temp would add exactly 30 orders a day; adding a picking robot would also add exactly 30 orders a day.';
const SAME_ONCE = 'Either hiring a temp or adding a picking robot would add exactly 30 orders a day.';

describe('one sentence, both options\' figures: each option\'s setting is the user\'s from its own writing (real build path)', () => {
  it('⭐ RED → GREEN: with each option\'s carried link stating the same figure, both settings are stored as the user\'s', async () => {
    const g = await built(BOTH, [30, 25], 'carried');
    expect(settingOf(g, 'Hire a temp', 'Temp order capacity')).toMatchObject({ raw_value: 30, source: 'brief_extraction' });
    expect(settingOf(g, 'Add a picking robot', 'Robot order capacity')).toMatchObject({ raw_value: 25, source: 'brief_extraction' });
    for (const [o, f] of OPTIONS) expect(settingOf(g, o, f).user_material_unverified).toBeUndefined();
  });

  it('per occurrence: the same figure WRITTEN once for each option is each option\'s own', async () => {
    const g = await built(SAME_TWICE, [30, 30], 'carried');
    for (const [o, f] of OPTIONS) expect(settingOf(g, o, f)).toMatchObject({ raw_value: 30, source: 'brief_extraction' });
  });

  it('RULE 2 KEPT: one writing of a figure claimed by both options stays unverified on both', async () => {
    const g = await built(SAME_ONCE, [30, 30], 'carried');
    for (const [o, f] of OPTIONS) expect(settingOf(g, o, f)).toMatchObject({ raw_value: 30, source: 'cee_hypothesis', user_material_unverified: true });
  });

  it('RULE 2 KEPT: a link from ANOTHER factor claiming the same writing is a rival, so that setting stays unverified', async () => {
    const g = await built(BOTH, [30, 25], 'rival');
    expect(settingOf(g, 'Hire a temp', 'Temp order capacity')).toMatchObject({ raw_value: 30, source: 'cee_hypothesis', user_material_unverified: true });
    expect(settingOf(g, 'Add a picking robot', 'Robot order capacity')).toMatchObject({ raw_value: 25, source: 'brief_extraction' });
  });
});

/**
 * ⭐ GENERATED: option count × figures (distinct, the same written per option, the same written once) × link shape (none, carried, a
 * rival link) × figure form (digits, words). The expected verdict is the rule itself: an option's setting is the user's when every
 * other subject claiming its figure in the sentence has a writing of its own (a carried link is no other subject).
 */
describe('figureSource by property: one figure per occurrence', () => {
  const WORDS: Record<number, string> = { 12: 'twelve', 30: 'thirty', 45: 'forty-five' };
  const LABELS = ['Hire a temp', 'Add a picking robot', 'Run a night shift'];
  const FACTORS = ['Temp order capacity', 'Robot order capacity', 'Night order capacity'];
  it('every combination gives the rule\'s verdict, and the sweep reaches both verdicts', () => {
    const seen = { user: 0, unverified: 0 };
    for (const n of [2, 3]) for (const shape of ['distinct', 'same-each', 'same-once'] as const)
    for (const links of ['none', 'carried', 'rival'] as const) for (const words of [false, true]) {
      const figures = [12, 30, 45].slice(0, n).map((v) => (shape === 'distinct' ? v : 30));
      const say = (v: number): string => (words ? WORDS[v]! : String(v));
      const sentence = shape === 'same-once'
        ? `Any of ${LABELS.slice(0, n).join(', ')} would add exactly ${say(30)} orders a day.`
        : LABELS.slice(0, n).map((l, i) => `${l} would add exactly ${say(figures[i]!)} orders a day`).join('; ') + '.';
      const brief = `${LEVEL} ${TARGET} ${sentence}`;
      const statements = [
        ...LABELS.slice(0, n).map((l, i) => setting(l, FACTORS[i]!, figures[i]!, sentence)),
        ...(links === 'carried' ? FACTORS.slice(0, n).map((f, i) => carriedLink(f, figures[i]!, sentence)) : []),
        ...(links === 'rival' ? [carriedLink('Returns handled', figures[0]!, sentence)] : []),
      ];
      for (let i = 0; i < n; i += 1) {
        const claimants = figures.filter((v) => v === figures[i]).length + (links === 'rival' && figures[0] === figures[i] ? 1 : 0);
        const writings = shape === 'same-once' ? 1 : figures.filter((v) => v === figures[i]).length;
        const expected = writings >= claimants ? 'user' : 'unverified';
        const got = figureSource({ statements }, brief, { kind: 'option', label: LABELS[i]!, factor_label: FACTORS[i]! }, 'level', figures[i]!);
        expect(got, `${n} ${shape} ${links} words=${words} option ${i} | ${sentence}`).toBe(expected);
        seen[got as 'user' | 'unverified'] += 1;
      }
    }
    expect(seen.user).toBeGreaterThan(20);
    expect(seen.unverified).toBeGreaterThan(10);
  });
});
