/**
 * ⭐ QUANTITY BINDING CONTRACT — construction rows (outbox/QUANTITY-BINDING-CONTRACT-20261018.md; plan v4.12/v4.13; owner: lean core).
 * A figure binds to the quantity its own words name, with its unit, signed value and qualification, at one written occurrence; the
 * goal's target is the user's (`threshold_source: 'brief_extraction'`) only where it binds. Each RED row is RED at staging 4dd7c21b
 * and runs the real path: scripted drafter → `buildModelFromBrief` → `/graph/register` (the registered graph is the cold read's input).
 * PR-A rows: 1 (#3399 D4 ×2), 2 (#3399 D2), 3 (#3401 re-choice), 4 (#3401 retry, rows reused from codex-r3-probes), 11 (P05).
 * Row 5 (pair brief, per-occurrence ownership) is PR-B's. Synthetic briefs, except the persisted unattested-event fixture the
 * existing suite already uses.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;

/** The real build with scripted drafter answers; the graph exactly as registered, and every drafter input. */
async function construct(answers: readonly unknown[], brief: string, scenario = 'qbc00000-0000-4000-8000-000000000001') {
  let graph: Rec | undefined;
  const inputs: string[] = [];
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as unknown as InternalDispatch;
  const drafter = (async (req: { input: string }) => {
    inputs.push(req.input);
    const a = answers[Math.min(inputs.length, answers.length) - 1];
    return { text: typeof a === 'string' ? a : JSON.stringify(a), status: 'completed' };
  }) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief(scenario, brief, dispatch, drafter) as Rec;
  return { graph, result, inputs };
}
const goalOf = (g: Rec | undefined): Rec | undefined => (g?.nodes as Rec[] | undefined)?.find((n) => n.kind === 'goal');

/* ── Rows 1, 2, 11: a change target binds by its SIGNED reading and its own clause's quantity ── */
const METRIC = 'Order turnaround';
function changeDraft(sentence: string, statement: Rec, goal: Rec = {}, factors: Rec[] = []): Rec {
  const link = (from: string, to: string) => ({ from, to, direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
    effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: METRIC, operator: '<=', target_stated: true, value: -20, unit: '%', horizon_months: 6,
      provenance: 'inferred', frame: 'change_rel', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null,
      quantity_frame: 'change', source_quote: sentence, deadline_words: null, ...goal },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add a packing shift', provenance: 'explicit', changes: ['Packing shifts'], interventions: [], added_capacity: null, is_status_quo: null },
    ],
    factors: [{ label: 'Packing shifts', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'shifts', provenance: 'inferred', plausible_max: 5 }, ...factors],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [link('Packing shifts', METRIC), ...factors.map((f) => link(f.label, METRIC))],
    statements: [{ quote: sentence, speaker: 'user', subject: { kind: 'goal', label: METRIC, to_label: null, factor_label: null }, field: 'target',
      unit: '%', qualifier: null, conditions: null, low: null, high: null, ...statement }],
  };
}
const brief = (sentence: string) => `${sentence} We could add a packing shift or carry on as now.`;

describe('row 1 (#3399 D4): a target figure never binds by magnitude alone', () => {
  it('RED (sign): "increase … by at least 20%" is never the user\'s −20% target', async () => {
    const said = 'We want to increase order turnaround by at least 20%.';
    const { graph } = await construct([changeDraft(said, { form: 'lower_bound', value: 20 })], brief(said));
    const goal = goalOf(graph);
    expect(goal, 'PRECONDITION: the model registers').toBeDefined();
    expect(goal!.threshold_source, JSON.stringify(goal)).not.toBe('brief_extraction');
  });

  // GUARD (green at 006716c2 only because the verifier refuses EVERY negative target, the P05 class): the fix that turns row 11 green
  // (a signed cut binds) must keep this one green, by the clause's own quantity.
  it('GUARD (another quantity): "… lower and will cut the promotion budget by at least 20%" never gives the 20% to order turnaround', async () => {
    const said = 'We want order turnaround lower and will cut the promotion budget by at least 20%.';
    const promo = [{ label: 'Promotion budget', role: 'controllable', baseline_known: false, baseline_value: null, unit: '£', provenance: 'explicit', plausible_max: 100000 }];
    const { graph } = await construct([changeDraft(said, { form: 'upper_bound', value: -20 }, {}, promo)], brief(said));
    const goal = goalOf(graph);
    expect(goal, 'PRECONDITION: the model registers').toBeDefined();
    expect(goal!.threshold_source, JSON.stringify(goal)).not.toBe('brief_extraction');
    // Codex R2 on #3399: the same bind decides the goal's own provenance, so no false from_brief either.
    expect(goal!.provenance, JSON.stringify(goal)).not.toBe('from_brief');
  });
});

describe('row 1b: the AI\'s own reading of the sentence decides the bound, never the goal\'s comparator alone', () => {
  // GUARD (green at 4dd7c21b only because every negative was refused): a floor on the change (≥ −20, "cut at most 20%") is not
  // the goal's ceiling (≤ −20). Contradicting readings never bind; the user's 20% stays said as unbound, never credited.
  it('GUARD (comparator): a lower_bound −20 reading never binds a "<=" −20 goal', async () => {
    const said = 'We want to cut order turnaround by at least 20%.';
    const { graph } = await construct([changeDraft(said, { form: 'lower_bound', value: -20 })], brief(said));
    const goal = goalOf(graph);
    expect(goal, 'PRECONDITION: the model registers').toBeDefined();
    expect(goal!.threshold_source, JSON.stringify(goal)).not.toBe('brief_extraction');
    expect(goal!.provenance, JSON.stringify(goal)).not.toBe('from_brief');
  });
});

describe('row 2 (#3399 D2): an inferred goal becomes the user\'s target only where its statement binds', () => {
  it('RED: "cut order turnaround by at least 20%" binds −20 change_rel % → the target is the user\'s (explicit), minimise', async () => {
    const said = 'We want to cut order turnaround by at least 20%.';
    const { graph } = await construct([changeDraft(said, { form: 'upper_bound', value: -20 })], brief(said));
    const goal = goalOf(graph);
    expect(goal, JSON.stringify(graph?.nodes)).toMatchObject({ label: METRIC, goal_direction: '<=', goal_threshold_frame: 'change_rel',
      goal_threshold_raw: -0.2, threshold_source: 'brief_extraction', provenance: 'from_brief' });
  });
});

describe('row 11 (P05): a change written as a cut is the user\'s signed target, never "not this goal\'s target"', () => {
  it('RED: "cut the median turnaround by 20%" (explicit goal) keeps −20 change_rel % as the user\'s target', async () => {
    const said = 'We want to cut the median order turnaround by 20%.';
    const { graph } = await construct([changeDraft(said, { form: 'point', value: -20 }, { provenance: 'explicit', operator: '<=' })], brief(said));
    const goal = goalOf(graph);
    expect(goal, JSON.stringify(graph?.nodes)).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2, threshold_source: 'brief_extraction' });
  });
});

/* ── Rows 3 and 5: the unattested-event re-choice keeps the user's verified target whole (fixture of the existing suite) ── */
const FX = JSON.parse(readFileSync(new URL('./fixtures/hiring-unattested-event-raw-20261014.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };
const GOVERNING = 'Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality?';
const TARGET = 'Productivity change by launch';
const first = (): Rec => JSON.parse(FX.raw_text) as Rec;
const redraft = (): Rec => {
  const d = first();
  d.goal = { kind: null, deliverable: null, metric: TARGET, operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3,
    provenance: 'explicit', frame: 'change_abs', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null,
    quantity_frame: 'change', basis: { reference: 'today', denominator: "today's productivity", period_months: 3, period_kind: 'at_end',
      effect_unit: "% of today's productivity", effects_at_period_end: false,
      also_required: ['maintaining code quality', 'launch completed by the urgent launch date'], open_question: null },
    source_quote: GOVERNING };
  d.constraints = (d.constraints as Rec[]).filter((c) => c.role !== 'target');
  d.factors = (d.factors as Rec[]).filter((f) => f.label !== TARGET);
  const link = (from: string, direction: string) => ({ from, to: TARGET, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null,
    effect_provenance: null, definitional: null, basis: null, source_quote: null });
  d.links = (d.links as Rec[]).filter((l) => l.to !== 'Urgent launch' && l.to !== TARGET && l.from !== TARGET)
    .concat([link('Delivery capacity', 'positive'), link('Code quality score', 'positive'), link('Launch delay from onboarding', 'negative')]);
  d.unknown_concerns = (d.unknown_concerns as Rec[]).map((u) => ({ ...u, concerns: (u.concerns as string[]).filter((c) => !c.includes('Urgent launch')) }));
  return d;
};
const targetStatement = (kind: 'factor' | 'goal') => ({ quote: GOVERNING, speaker: 'user', subject: { kind, label: TARGET, to_label: null, factor_label: null },
  field: 'target', form: 'lower_bound', value: 10, low: null, high: null, unit: '%', qualifier: null, conditions: null });

describe('row 3 (#3401): a re-chosen goal never overwrites the user\'s verified +10% target', () => {
  const withStatement = (d: Rec, kind: 'factor' | 'goal'): Rec => { d.statements = [targetStatement(kind)]; return d; };
  const firstDraft = (): Rec => { const d = withStatement(first(), 'factor'); d.constraints = (d.constraints as Rec[]).filter((c) => c.role !== 'target'); return d; };
  it.each([
    ['12% for their 10%', { value: 12 }],
    ['−10% for their +10%', { value: -10 }],
    ['USD 10 for their 10%', { unit: 'USD' }],
  ] as const)('RED: a re-choice registering %s is not adopted', async (_name, change) => {
    const retry = withStatement(redraft(), 'goal');
    Object.assign(retry.goal, change);
    const { graph, inputs } = await construct([firstDraft(), retry], FX.brief);
    expect(inputs, 'PRECONDITION: the one retry was asked').toHaveLength(2);
    expect(graph, `never registered: ${JSON.stringify(goalOf(graph))}`).toBeUndefined();
  });
  it('RED: a re-choice that marks the kept target Olumi\'s (ai_proposed) never relabels it: the bound statement keeps it the user\'s', async () => {
    const retry = withStatement(redraft(), 'goal');
    retry.goal.provenance = 'ai_proposed';
    const { graph, inputs } = await construct([firstDraft(), retry], FX.brief);
    expect(inputs).toHaveLength(2);
    expect(goalOf(graph), JSON.stringify(goalOf(graph))).toMatchObject({ goal_threshold_raw: 10, goal_threshold_unit: '%',
      threshold_source: 'brief_extraction', provenance: 'from_brief' });
  });
  it('CONTROL: the genuine re-choice is adopted with the user\'s +10% (threshold_source kept)', async () => {
    const { graph, inputs } = await construct([firstDraft(), withStatement(redraft(), 'goal')], FX.brief);
    expect(inputs).toHaveLength(2);
    expect(goalOf(graph), JSON.stringify(goalOf(graph))).toMatchObject({ goal_threshold_raw: 10, goal_threshold_unit: '%', threshold_source: 'brief_extraction' });
  });
});

/* ── Row 4 (#3401 retry; Codex r2 rows reused from codex-r3-probes/r2-rows-from-d3b6b296.test.ts) ── */
const AIM = 'We need to bring in at least £600k of new contract value this year.';
const SIZE = 'Our broker says each contract we sign is worth between £40k and £60k.';
const BRIEF4 = `${AIM} ${SIZE} We could hire a second salesperson or start a referral scheme.`;
const GOAL4 = 'New contract value';
const COUNT = 'Contracts signed';
function contractDraft(withRange: boolean, referral: boolean, linked: boolean): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  const d: Rec = {
    goal: { kind: null, deliverable: null, metric: GOAL4, operator: '>=', target_stated: true, value: 600000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Hire a second salesperson', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Salespeople', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit' }] },
    ],
    factors: [{ label: 'Salespeople', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'people', provenance: 'inferred', plausible_max: 5 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: COUNT, provenance: 'inferred', unit: 'contracts', plausible_max: 30 }],
    links: [link('Salespeople', COUNT), { ...link(COUNT, GOAL4), provenance: 'explicit' }],
    statements: [
      { quote: AIM, speaker: 'user', subject: { kind: 'goal', label: GOAL4, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound',
        value: 600000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      ...(withRange ? [{ quote: SIZE, speaker: 'user', subject: { kind: 'link', label: COUNT, to_label: GOAL4, factor_label: null },
        field: 'effect', form: 'range', value: null, low: 40000, high: 60000, unit: '£', qualifier: null, conditions: null }] : []),
    ],
  };
  if (referral) {
    d.options.push({ label: 'Start a referral scheme', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Referral income', value: 100000, value_kind: 'absolute', unit: '£', provenance: 'ai_proposed' }] });
    d.factors.push({ label: 'Referral income', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '£', provenance: 'inferred', plausible_max: 500000 });
    if (linked) d.links.push(link('Referral income', GOAL4));
  }
  return d;
}
describe('row 4 (#3401 retry): a retry that adds a path never changes the user\'s goal figure or unit', () => {
  const referralReaches = (g: Rec): boolean => (g.edges as Rec[]).some((e) => e.from === (g.nodes as Rec[]).find((n) => n.label === 'Referral income')?.id
    && e.to === goalOf(g)!.id);
  it.each([
    ['£600k → £700k', { value: 700000 }],
    ['£ → USD', { unit: 'USD' }],
  ] as const)('RED: a range + link retry that also changes the goal (%s) is not adopted; the user\'s £600k stays', async (_c, change) => {
    const changed = contractDraft(true, true, true);
    Object.assign(changed.goal, change);
    const { graph, inputs } = await construct([contractDraft(false, true, false), changed], BRIEF4);
    expect(inputs, 'PRECONDITION: the retry was asked').toHaveLength(2);
    const g = GraphV3.parse(graph) as unknown as Rec;
    expect(goalOf(g)).toMatchObject({ goal_threshold_raw: 600000, goal_threshold_unit: '£' });
    expect(referralReaches(g), 'the first draft is kept').toBe(false);
  });
  it('CONTROL: the same retry with the goal unchanged is adopted (its link registers)', async () => {
    const { graph, inputs } = await construct([contractDraft(false, true, false), contractDraft(true, true, true)], BRIEF4);
    expect(inputs).toHaveLength(2);
    const g = GraphV3.parse(graph) as unknown as Rec;
    expect(referralReaches(g)).toBe(true);
    expect(goalOf(g)).toMatchObject({ goal_threshold_raw: 600000, goal_threshold_unit: '£' });
  });
});
