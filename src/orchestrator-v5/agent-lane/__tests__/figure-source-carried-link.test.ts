/**
 * ⭐ ONE QUANTITY READ TWICE IS NO RIVAL, ONLY AT ONE OWNED OCCURRENCE (PROMPT-INT first-loss trace, prompt/DRAFTER-NET-CHANGE-FIRST-LOSS.md
 * §2; Codex pair AMEND; Codex #3439 BLOCK + Buddy-A occurrence design). Every statement quotes its whole sentence, and `figureSource`'s
 * uniqueness clause (C4 rule 2) refused an option's setting whenever another subject's statement on that sentence stated the same figure.
 * Measured on the drafts, that rival was the LINK from the option's own factor ("hiring a contractor would add 60 tickets a week" is the
 * setting and what it adds). That link no longer contests the setting ONLY where the setting's occurrence is provably the option's own:
 * the one reader binds it to the option's name, its clause names no other option, its written quantity is the setting's (unit, not a
 * range end, no distributive before it) and the user writes that figure only there. Everything else keeps RULE 2 (base).
 * Real path: `buildModelFromBrief` with a scripted drafter → admission → the registered graph. SYNTHETIC briefs; 0 provider calls.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { figureSource } from '../construction-source-map.js';

type Rec = Record<string, any>;
type Option = readonly [label: string, factor: string];
const LEVEL = 'Our warehouse ships about 400 orders a day at the moment.';
const TARGET = 'We need at least 460 orders a day by the end of next year.';
const statement = (quote: string, subject: Rec, field: string, form: string, value: number, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null });
const setting = (option: string, factor: string, value: number, quote: string): Rec =>
  statement(quote, { kind: 'option', label: option, factor_label: factor }, 'level', 'point', value, 'orders a day');
const carriedLink = (factor: string, value: number, quote: string, unit = 'orders a day'): Rec =>
  statement(quote, { kind: 'link', label: factor, to_label: 'Daily orders shipped' }, 'effect', 'point', value, unit);
/** Noun labels: each option's own words name only it. */
const OPTIONS: readonly [Option, Option] = [['Hire a temp', 'Temp order capacity'], ['Picking robot', 'Robot order capacity']];
/** Codex #3439's labels: "Add a picking robot" shares its verb with every "would add" clause. */
const VERB_LABELS: readonly [Option, Option] = [['Hire a temp', 'Temp order capacity'], ['Add a picking robot', 'Robot order capacity']];

type Links = 'carried' | 'none' | 'rival' | 'per-unit';
/** One draft: each option sets its own capacity factor to its figure, each factor links to the goal; every statement quotes `sentence`. */
function draft(sentence: string, figures: readonly [number, number], links: Links, options: readonly [Option, Option]): { brief: string; text: string } {
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
        ...options.map(([label, factor], i) => ({ label, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
          interventions: [{ factor_label: factor, value: figures[i], value_kind: 'additional', unit: 'orders a day', provenance: 'explicit' }] })),
      ],
      factors: [...options.map(([, factor]) => ({ label: factor, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'orders a day', provenance: 'inferred', plausible_max: 200 })),
        ...(links === 'rival' ? [{ label: 'Returns handled', role: 'external', baseline_known: false, baseline_value: 0, unit: 'orders a day', provenance: 'inferred', plausible_max: 200 }] : [])],
      risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
      links: [...options.map(([, factor]) => ({ from: factor, to: 'Daily orders shipped', direction: 'positive', provenance: 'explicit', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null })),
        ...(links === 'rival' ? [{ from: 'Returns handled', to: 'Daily orders shipped', direction: 'negative', provenance: 'ai_proposed', effect_amount: null,
          effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }] : [])],
      statements: [
        statement(LEVEL, { kind: 'goal', label: 'Daily orders shipped' }, 'level', 'point', 400, 'orders a day'),
        statement(TARGET, { kind: 'goal', label: 'Daily orders shipped' }, 'target', 'lower_bound', 460, 'orders a day'),
        ...options.map(([label, factor], i) => setting(label, factor, figures[i], sentence)),
        ...(links === 'carried' || links === 'rival' ? options.map(([, factor], i) => carriedLink(factor, figures[i], sentence)) : []),
        ...(links === 'per-unit' ? [carriedLink(options[0][1], figures[0], sentence, 'orders a day per temp'), carriedLink(options[1][1], figures[1], sentence)] : []),
        ...(links === 'rival' ? [carriedLink('Returns handled', figures[0], sentence)] : []),
      ],
    }),
  };
}
async function built(sentence: string, figures: readonly [number, number], links: Links, options = OPTIONS): Promise<Rec> {
  const { brief, text } = draft(sentence, figures, links, options);
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text, status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return graph!;
}
const settingOf = (g: Rec, [option, factor]: Option): Rec => {
  const id = (g.nodes as Rec[]).find((n) => n.label === factor)!.id as string;
  return (g.nodes as Rec[]).find((n) => n.label === option)!.interventions[id] as Rec;
};

const BOTH = 'Hiring a temp would add exactly 30 orders a day; adding a picking robot would add exactly 25 orders a day.';
const SAME_TWICE = 'Hiring a temp would add exactly 30 orders a day; adding a picking robot would also add exactly 30 orders a day.';
const SAME_ONCE = 'Either hiring a temp or adding a picking robot would add exactly 30 orders a day.';
const PER_TEMP = 'Hiring a temp adds 30 orders a day; adding a picking robot would add exactly 25 orders a day.';
const VENDOR = 'Hiring a temp would add exactly 30 orders a day; the vendor told us: "a picking robot would add exactly 25 orders a day."';

describe('an option\'s setting and the link it carries are one quantity only at the option\'s own occurrence (real build path)', () => {
  it('⭐ RED → GREEN: each option\'s own clause writes its figure once; with its carried link stating it, both settings are the user\'s', async () => {
    const g = await built(BOTH, [30, 25], 'carried');
    expect(settingOf(g, OPTIONS[0])).toMatchObject({ raw_value: 30, source: 'brief_extraction' });
    expect(settingOf(g, OPTIONS[1])).toMatchObject({ raw_value: 25, source: 'brief_extraction' });
    for (const o of OPTIONS) expect(settingOf(g, o).user_material_unverified).toBeUndefined();
  });

  it('RULE 2 KEPT: the same figure claimed by both options, written once or once each, stays unverified on both', async () => {
    for (const sentence of [SAME_ONCE, SAME_TWICE]) {
      const g = await built(sentence, [30, 30], 'carried');
      for (const o of OPTIONS) expect(settingOf(g, o), sentence).toMatchObject({ raw_value: 30, source: 'cee_hypothesis', user_material_unverified: true });
    }
  });

  it('RULE 2 KEPT: a link from ANOTHER factor claiming the same figure is a rival, so that setting stays unverified', async () => {
    const g = await built(BOTH, [30, 25], 'rival');
    expect(settingOf(g, OPTIONS[0])).toMatchObject({ raw_value: 30, source: 'cee_hypothesis', user_material_unverified: true });
    expect(settingOf(g, OPTIONS[1])).toMatchObject({ raw_value: 25, source: 'brief_extraction' });
  });

  it('ANOTHER UNIT is another quantity (Codex pair 1): a per-temp link stating the same figure still contests the setting', async () => {
    const g = await built(PER_TEMP, [30, 25], 'per-unit');
    expect(settingOf(g, OPTIONS[0])).toMatchObject({ raw_value: 30, source: 'cee_hypothesis', user_material_unverified: true });
    expect(settingOf(g, OPTIONS[1])).toMatchObject({ raw_value: 25, source: 'brief_extraction' });
  });

  it('SPEAKER: a setting written only in another speaker\'s quoted words is never the user\'s; the user\'s own beside it is', async () => {
    const g = await built(VENDOR, [30, 25], 'carried');
    expect(settingOf(g, OPTIONS[0])).toMatchObject({ raw_value: 30, source: 'brief_extraction' });
    expect(settingOf(g, OPTIONS[1]).source).not.toBe('brief_extraction');
  });

  it('FAIL-SAFE (verb labels): where a clause\'s words name both options ("would add" is "Add a picking robot"), ownership is unproven: base', async () => {
    const g = await built(BOTH, [30, 25], 'carried', VERB_LABELS);
    expect(settingOf(g, VERB_LABELS[0]).source).toBe('cee_hypothesis');
  });
});

/**
 * ⛔ CODEX #3439's SIX NEGATIVES (independent review, /private/tmp/rev3439-independent; its rows, its labels): a scripted draft that misreads
 * the brief is the untrusted input whose authorship figureSource must verify. Each registered the drafted figure as the user's on
 * 242daf43; each must stay unverified.
 */
describe('Codex #3439 negatives: no user credit without the option\'s own occurrence (real build path)', () => {
  it('swapped option figures stay unverified on the registered graph', async () => {
    const g = await built(BOTH, [25, 30], 'carried', VERB_LABELS);
    for (const o of VERB_LABELS) expect(settingOf(g, o).source, o[0]).not.toBe('brief_extraction');
  });
  for (const [name, sentence, which] of [
    ['unrelated figure', 'Hiring a temp would add exactly 30 orders a day while returns were 25 orders a day; adding a picking robot would add exactly 20 orders a day.', 1],
    ['speaker with same-figure distraction', 'Hiring a temp would add exactly 30 orders a day while returns were 25 orders a day; the vendor told us: "a picking robot would add exactly 25 orders a day."', 1],
    ['period figure', 'Hiring a temp would add exactly 30 orders a day; adding a picking robot would add exactly 20 orders a day for 25 days.', 1],
    ['range endpoint', 'Hiring a temp would add exactly 30 orders a day; adding a picking robot would add between 20 and 25 orders a day.', 1],
    ['same unit mislabeled per-temp', 'Each temp adds exactly 30 orders a day; adding a picking robot would add exactly 25 orders a day.', 0],
  ] as const) it(`${name} does not become the user's setting`, async () => {
    const g = await built(sentence, [30, 25], 'carried', VERB_LABELS);
    expect(settingOf(g, VERB_LABELS[which]).source).not.toBe('brief_extraction');
  });
  it('with noun labels too, and each ownership condition alone: never the user\'s (ownership, not only the verb, holds them)', async () => {
    for (const [sentence, which] of [
      ['Hiring a temp would add exactly 30 orders a day while returns were 25 orders a day; adding a picking robot would add exactly 20 orders a day.', 1],
      ['Hiring a temp would add exactly 30 orders a day; adding a picking robot would add exactly 20 orders a day for 25 days.', 1],
      ['Hiring a temp would add exactly 30 orders a day; adding a picking robot would add between 20 and 25 orders a day.', 1],
      ['Each temp adds exactly 30 orders a day; adding a picking robot would add exactly 25 orders a day.', 0],
      // each condition on its own: another period written after the figure; a distributive before it; the figure written twice
      ['Hiring a temp would add exactly 30 orders a day; adding a picking robot would add exactly 25 orders a week.', 1],
      ['Each temp we hire adds exactly 30 orders a day; adding a picking robot would add exactly 25 orders a day.', 0],
      ['Hiring a temp would add exactly 30 orders a day while returns were 30 orders a day; adding a picking robot would add exactly 25 orders a day.', 0],
    ] as const) {
      const g = await built(sentence, [30, 25], 'carried');
      expect(settingOf(g, OPTIONS[which]).source, sentence).not.toBe('brief_extraction');
    }
  });
});

/**
 * ⭐ GENERATED: option count × figures (distinct, the same written per option, the same written once) × links (none, carried, carried in
 * another unit, a rival factor's link) × form (digits, words) × speaker (the user's, inside another speaker's quotation). The expected
 * verdict is the rule: the user's own words, and no other claimant of the figure in that sentence, except the option's own carried link
 * in the setting's unit when the figure is written once, in the option's own clause.
 */
describe('figureSource by property: a carried link is no rival only at the option\'s own single occurrence', () => {
  const WORDS: Record<number, string> = { 12: 'twelve', 30: 'thirty', 45: 'forty-five' };
  const LABELS = ['Hire a temp', 'Picking robot', 'Night shift'];
  const FACTORS = ['Temp order capacity', 'Robot order capacity', 'Night order capacity'];
  const SAID = ['hiring a temp', 'adding a picking robot', 'running a night shift'];
  it('every combination gives the rule\'s verdict, and the sweep reaches both verdicts', () => {
    const seen = { user: 0, unverified: 0 };
    for (const n of [2, 3]) for (const shape of ['distinct', 'same-each', 'same-once'] as const)
    for (const links of ['none', 'carried', 'other-unit', 'rival'] as const) for (const words of [false, true]) for (const quoted of [false, true]) {
      const figures = [12, 30, 45].slice(0, n).map((v) => (shape === 'distinct' ? v : 30));
      const say = (v: number): string => (words ? WORDS[v]! : String(v));
      const said = shape === 'same-once'
        ? `Any of ${SAID.slice(0, n).join(', ')} would add exactly ${say(30)} orders a day`
        : SAID.slice(0, n).map((l, i) => `${l} would add exactly ${say(figures[i]!)} orders a day`).join('; ');
      const sentence = quoted ? `Our consultant said: "${said}."` : `${said}.`;
      const statements = [
        ...LABELS.slice(0, n).map((l, i) => setting(l, FACTORS[i]!, figures[i]!, sentence)),
        ...(links === 'carried' || links === 'rival' ? FACTORS.slice(0, n).map((f, i) => carriedLink(f, figures[i]!, sentence)) : []),
        ...(links === 'other-unit' ? FACTORS.slice(0, n).map((f, i) => carriedLink(f, figures[i]!, sentence, 'orders a day per hire')) : []),
        ...(links === 'rival' ? [carriedLink('Returns handled', figures[0]!, sentence)] : []),
      ];
      const model = { statements, options: LABELS.slice(0, n).map((label) => ({ label })), factors: FACTORS.slice(0, n).map((label) => ({ label })) };
      const brief = `${LEVEL} ${TARGET} ${sentence}`;
      for (let i = 0; i < n; i += 1) {
        const sameFigure = figures.filter((v) => v === figures[i]).length;
        // A count in words proves no ownership on this base: the reader binds a word only beside a label word (#3438 lifts that).
        const ownOnce = shape === 'distinct' && !words;
        const otherClaims = (sameFigure - 1) * (links === 'none' ? 1 : 2) + (links === 'other-unit' ? 1 : 0)
          + (links === 'carried' || links === 'rival' ? (ownOnce ? 0 : 1) : 0) + (links === 'rival' && figures[0] === figures[i] ? 1 : 0);
        const expected = !quoted && otherClaims === 0 ? 'user' : 'unverified';
        const got = figureSource(model, brief, { kind: 'option', label: LABELS[i]!, factor_label: FACTORS[i]! }, 'level', figures[i]!);
        expect(got, `${n} ${shape} ${links} words=${words} quoted=${quoted} option ${i} | ${sentence}`).toBe(expected);
        seen[got as 'user' | 'unverified'] += 1;
      }
    }
    expect(seen.user).toBeGreaterThan(15);
    expect(seen.unverified).toBeGreaterThan(100);
  });
});
