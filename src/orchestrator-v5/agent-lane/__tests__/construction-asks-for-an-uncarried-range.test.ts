/**
 * ⭐ A4 ON THE SERVED DRAFT — A MONEY RANGE THE BRIEF WRITES, THAT NO LINK CARRIES, IS A CONSTRUCTION ISSUE
 * (R3 5921213011 FIRST FAIL A4; diagnosis 5921266982).
 *
 * SERVED (`5479e15e`, R3 train-2255Z): Paul's brief says investment firms "do deals between £1-2 million". The drafter
 * drew that route as an EFFORT lever ("Hours per week on investment-firm outreach") straight into the £ goal, with no
 * countable at all, so the per-one rule (#2409) had nothing to size and every goal link was a ±0.5 placeholder. A prompt
 * sentence is a hope; this is the guarantee: the uncarried range is listed for the EXISTING repair retry, and the retry
 * is adopted only when a link then carries that range as the user's (the #2389 door + #2409's span binding).
 *
 * Real path: strict candidate schema → `buildModelFromBrief` (two scripted drafter calls) → `/graph/register` → GraphV3.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, firstConstructInput, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { BRIEF_LABEL, todayLine } from '../turn-context.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Prov = 'explicit' | 'inferred' | 'ai_proposed';
type Size = { amount: number; per: number; by: Prov };
type Edge = { from: string; to: string; provenance?: { magnitude?: string; natural_effect?: { stated_range?: { end?: string; text?: string } } } };
type Graph = { nodes: { id: string; kind: string; label: string }[]; edges: Edge[] };

/** Paul's 506-character brief, verbatim (R3 `accept-paul/paul-scenario-read.json`). */
const BRIEF =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it. We need to raise at least £1.2m.';

const link = (from: string, to: string, size?: Size, direction: 'positive' | 'negative' = 'positive') => ({
  from, to, direction, provenance: 'inferred' as Prov,
  effect_amount: size?.amount ?? null, effect_per_source_change: size?.per ?? null, effect_provenance: size?.by ?? null,
});

/** The SERVED first draft's shape (train-2255Z `02-cold-after-build.json`): effort levers, no countable, nothing sized. */
function servedFirstDraft() {
  return {
    goal: {
      metric: 'securing funding', operator: '>=', target_stated: true, frame: 'level', value: 1200000, unit: '£', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Continue Current Process', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel Outreach Pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Hours per week on angel outreach', value: 5, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Hours per week on investment-firm outreach', role: 'controllable', baseline_known: true, baseline_value: 20, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 60 },
      { label: 'Hours per week on angel outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 40 },
    ],
    risks: [],
    outcomes: [{ label: 'Qualified angel investor conversations', provenance: 'inferred', unit: 'conversations', plausible_max: 20 }],
    links: [
      link('Hours per week on investment-firm outreach', 'securing funding'),
      link('Hours per week on angel outreach', 'Qualified angel investor conversations'),
      link('Qualified angel investor conversations', 'securing funding'),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

/** The repair the retry is asked for: the countable kept, sized per one at the low end (#2409's drafter rule). */
function repairedDraft(dealSize: Size = { amount: 1000000, per: 1, by: 'explicit' }) {
  const d = servedFirstDraft() as Record<string, any>;
  d.outcomes = [...d.outcomes, { label: 'Deals closed', provenance: 'inferred', unit: 'deals', plausible_max: 3 }];
  d.links = [
    ...d.links.filter((l: { from: string }) => l.from !== 'Hours per week on investment-firm outreach'),
    link('Hours per week on investment-firm outreach', 'Deals closed'),
    link('Deals closed', 'securing funding', dealSize),
  ];
  return d;
}

async function build(drafts: readonly Record<string, unknown>[], brief: string = BRIEF) {
  let body: unknown = null;
  let registeredBrief: unknown = null;
  const inputs: string[] = [];
  const call = (async (req: { input: string }) => {
    inputs.push(req.input);
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      registeredBrief = (b as { brief_text?: unknown }).brief_text;
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a4a4a4a4-0000-4a4a-8a4a-a4a4a4a4a4a4', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out, inputs, registeredBrief };
}

const dealLink = (g: Graph) => g.edges.find((e) => e.from === 'deals_closed' && e.to === 'securing_funding');

describe('A4 guarantee: a written money range no link carries is asked of the repair retry', () => {
  it('RED: the served first draft (no countable) → the retry is asked the uncarried "£1-2 million", and the repaired draft is adopted', async () => {
    const { graph, inputs } = await build([servedFirstDraft(), repairedDraft()]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('Construction issues:');
    expect(inputs[1]).toContain('£1-2 million');
    // The repair retains the frozen first input, including the range notes, before its own issues/candidate suffix.
    expect(inputs[1]!.startsWith(`${inputs[0]}\n\nConstruction issues: `), inputs[1]!.slice(0, 300)).toBe(true);
    expect(dealLink(graph)?.provenance?.magnitude).toBe('user_stated');
    expect(dealLink(graph)?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('a retry that still carries no range is NOT adopted: the first draft stands, exactly as before', async () => {
    const { graph, inputs } = await build([servedFirstDraft(), servedFirstDraft()]);
    expect(inputs).toHaveLength(2);
    expect(dealLink(graph)).toBeUndefined();
    expect(graph.nodes.some((n) => n.label === 'Hours per week on…' || n.label.startsWith('Hours per week on'))).toBe(true);
  });

  it('a retry that sizes the countable from NOTHING written (a £1.5m midpoint) is not adopted', async () => {
    const { graph } = await build([servedFirstDraft(), repairedDraft({ amount: 1500000, per: 1, by: 'explicit' })]);
    expect(dealLink(graph)).toBeUndefined();
  });

  // ⛔ CODEX CEE BUDDY 5921470248: a frame in another unit once "held" £1m (plausible_max 1000 on an hours factor).
  it('RED (CODEX collision): an unrelated hours factor with plausible_max 1000 does not hide the range — still asked and adopted', async () => {
    const collide = (d: Record<string, any>) => ({ ...d, factors: d.factors.map((f: { label: string }) => f.label === 'Hours per week on angel outreach' ? { ...f, plausible_max: 1000 } : f) });
    const { graph, inputs } = await build([collide(servedFirstDraft()), collide(repairedDraft())]);
    expect(inputs).toHaveLength(2);
    expect(dealLink(graph)?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('RED (CODEX collision, both ends): frames of 1000 AND 2000 on hours factors never hold "£1-2 million" — still asked', async () => {
    const collide = (d: Record<string, any>) => ({ ...d, factors: d.factors.map((f: { label: string }) =>
      f.label === 'Hours per week on angel outreach' ? { ...f, plausible_max: 1000 } : { ...f, plausible_max: 2000 }) });
    const { inputs } = await build([collide(servedFirstDraft()), collide(repairedDraft())]);
    expect(inputs).toHaveLength(2);
  });

  it('RED (another quantity): a £1m GOAL target holds one end only — the range is still asked', async () => {
    const at1m = (d: Record<string, any>) => ({ ...d, goal: { ...d.goal, value: 1000000 } });
    const { inputs } = await build([at1m(servedFirstDraft()), at1m(repairedDraft())], BRIEF.replace('at least £1.2m', 'at least £1m'));
    expect(inputs).toHaveLength(2);
  });

  // ⛔ CODEX CEE BUDDY 5921674571 (+ PTL 5921699859): "held" once pooled every £ value in the draft, so two UNRELATED
  // quantities whose values happen to be the range's ends hid it. Held = ONE quantity holds both ends, and the range's
  // own span is written about that quantity (the strict scoped reader, at each end).
  it('RED (CODEX entity collision): an unrelated £1m valuation + £2m payroll never hold "£1-2 million" — still asked and adopted', async () => {
    const first = servedFirstDraft() as Record<string, any>;
    first.factors = [...first.factors,
      { label: 'Company valuation', role: 'observable', baseline_known: true, baseline_value: 1000000, unit: '£', provenance: 'ai_proposed', plausible_max: 5000000 },
      { label: 'Annual payroll', role: 'observable', baseline_known: true, baseline_value: 2000000, unit: '£', provenance: 'ai_proposed', plausible_max: 5000000 }];
    const { graph, inputs } = await build([first, repairedDraft()]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('£1-2 million');
    expect(dealLink(graph)?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('RED (the span decides): ONE quantity holding both ends (valuation £1m today, an option taking it to £2m) that the range is not written about — still asked and adopted', async () => {
    const valued = (d: Record<string, any>) => ({
      ...d,
      factors: [...d.factors, { label: 'Company valuation', role: 'controllable', baseline_known: true, baseline_value: 1000000, unit: '£', provenance: 'ai_proposed', plausible_max: 5000000 }],
      options: [...d.options, { label: 'Raise the valuation', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Company valuation', value: 2000000, value_kind: 'absolute', unit: '£', provenance: 'ai_proposed' },
      ] }],
      links: [...d.links, link('Company valuation', 'securing funding')],
    });
    const { graph, inputs } = await build([valued(servedFirstDraft()), valued(repairedDraft())]);
    expect(inputs).toHaveLength(2);
    expect(dealLink(graph)?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('RED (both ends): the quantity the span names holding ONE end (a £1m "Deal size" today) does not hold the range — still asked', async () => {
    const sized = (d: Record<string, any>) => ({
      ...d,
      factors: [...d.factors, { label: 'Deal size', role: 'observable', baseline_known: true, baseline_value: 1000000, unit: '£', provenance: 'ai_proposed', plausible_max: 5000000 }],
      links: [...d.links, link('Deal size', 'securing funding')],
    });
    const { inputs } = await build([sized(servedFirstDraft()), sized(repairedDraft())]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('£1-2 million');
  });

  it('CONTROL (price levels): a price range whose BOTH ends are the options\' £ levels is held → ONE call', async () => {
    const priced = servedFirstDraft() as Record<string, any>;
    priced.factors = [...priced.factors, { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: '£', provenance: 'explicit', plausible_max: 200 }];
    priced.options = [...priced.options, { label: 'Raise the price to £59', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
      { factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: '£', provenance: 'explicit' },
    ] }];
    priced.links = [...priced.links, link('Pro plan price', 'securing funding')];
    const { inputs } = await build([priced], `${BRIEF.replace(' that do deals between £1-2 million', '')} We could price the Pro plan between £49 and £59.`);
    expect(inputs).toHaveLength(1);
  });

  it('CONTROL: a first draft that already carries the range → ONE call, no retry', async () => {
    const { inputs, graph } = await build([repairedDraft()]);
    expect(inputs).toHaveLength(1);
    expect(dealLink(graph)?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('CONTROL: a brief with no money range → ONE call, no retry (the served draft stands)', async () => {
    const { inputs } = await build([servedFirstDraft()], BRIEF.replace(' that do deals between £1-2 million', ''));
    expect(inputs).toHaveLength(1);
  });
});

/**
 * ⛔ THE NEGATIVE CLASSES (CODEX CEE BUDDY 5921351458): a range about something else, in another currency, in a question,
 * two separate figures, a money source, and a retry that costs the user anything. Each keeps the first draft (or makes no
 * retry at all): the retry is adopted only when a link CARRIES the range as the user's, through the door's own span.
 */
describe('A4 guarantee: every other shape keeps the first draft', () => {
  const SINGLE = BRIEF.replace('that do deals between £1-2 million', 'that do deals');
  const kept = (graph: Graph) => expect(dealLink(graph)).toBeUndefined();

  it('a range about ANOTHER quantity (an outreach budget) is asked, but a deal link sized from it is never adopted', async () => {
    const { graph, inputs } = await build([servedFirstDraft(), repairedDraft()], `${SINGLE} Angel investor outreach budgets range between £1-2 million.`);
    expect(inputs).toHaveLength(2);
    kept(graph);
  });

  it('the range PER ANOTHER countable ("£1-2 million per fund") never becomes the deal size', async () => {
    const { graph } = await build([servedFirstDraft(), repairedDraft()], `${SINGLE} The funds we speak to manage between £1-2 million per fund.`);
    kept(graph);
  });

  it('a range in ANOTHER currency ("€1-2 million" against a £ goal) is never the user\'s £ size', async () => {
    const { graph } = await build([servedFirstDraft(), repairedDraft()], BRIEF.replace('£1-2 million', '€1-2 million'));
    kept(graph);
  });

  it('a range written in a QUESTION is not asked: ONE call, no retry', async () => {
    const q = BRIEF.replace("We've been focused on investment firms that do deals between £1-2 million, mostly based in the UK.",
      'Should we focus on investment firms that do deals between £1-2 million?');
    const { inputs, graph } = await build([servedFirstDraft(), repairedDraft()], q);
    expect(inputs).toHaveLength(1);
    kept(graph);
  });

  it('two SEPARATE figures are no range: no range issue, no retry', async () => {
    const { inputs } = await build([servedFirstDraft()], BRIEF.replace('between £1-2 million', 'of £1 million. Some reach £2 million'));
    expect(inputs).toHaveLength(1);
  });

  it('a MONEY source (a budget in £) sized with the range is no per-one size: not adopted', async () => {
    const retry = servedFirstDraft() as Record<string, any>;
    retry.factors = [...retry.factors, { label: 'Deal budget', role: 'observable', baseline_known: false, baseline_value: null, unit: '£', provenance: 'inferred', plausible_max: 5000000 }];
    retry.links = [...retry.links, link('Deal budget', 'securing funding', { amount: 1000000, per: 1, by: 'explicit' })];
    const { graph } = await build([servedFirstDraft(), retry]);
    expect(graph.edges.some((e) => e.provenance?.natural_effect?.stated_range !== undefined)).toBe(false);
  });

  it('a retry that carries the range but DROPS an option the first draft registered is not adopted', async () => {
    const retry = repairedDraft() as Record<string, any>;
    retry.options = retry.options.filter((o: { label: string }) => o.label !== 'Angel Outreach Pilot');
    const { graph } = await build([servedFirstDraft(), retry]);
    kept(graph);
    expect(graph.nodes.some((n) => n.kind === 'option' && n.label.startsWith('Angel Outreach'))).toBe(true);
  });

  it('a retry that carries the range but DROPS a risk the first draft held is not adopted', async () => {
    const withRisk = (d: Record<string, any>) => ({
      ...d,
      risks: [{ label: 'Fundraising distraction', provenance: 'inferred', unit: null, plausible_max: null }],
      links: [...d.links, link('Hours per week on angel outreach', 'Fundraising distraction'), link('Fundraising distraction', 'securing funding', undefined, 'negative')],
    });
    const { graph } = await build([withRisk(servedFirstDraft()), repairedDraft()]);
    kept(graph);
  });
});

// ⭐ A4 FIRST PASS (MG lease 5944839798; DL GO): the range is asked of the FIRST construct, so a first draft that carries it
// needs no second call (Paul's brief: 7 of 8 served first briefs paid one, median +15.7 s). The retry stays the backstop.
/** T2 corpus briefs A and C (`output/mg-0ebb952a/t2/T2-CORPUS.json`), verbatim: a price MOVE written inside a question. */
const T2_A = "Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?";
const T2_C = "We need to reach £100k MRR within 6 months with a £20k budget, while keeping monthly churn under 4%. Should we develop new features and increase our Pro plan price from £49 to £59 per month in the next release, or invest in additional advertising?";
const T2_D1 = "I need some help framing a prioritisation conflict for our sprint planning on Monday.\nSales is breathing down my neck because they have this huge enterprise prospect—like potentially our biggest deal of the quarter—but the prospect is saying they won’t sign unless we can promise an AI reporting module by next month. The sales rep is saying it's a \"make or break\" thing.\nBut my lead engineer just showed me the data on our new trial signup flow and it’s a total mess. We're losing like 15% of people before they even finish setting up their profile because of a bug in the integration step. If we don't fix that now, we're basically burning marketing budget.\nEngineering says they only have bandwidth to tackle one of these properly in the upcoming sprint. I need to write an update for the leadership team explaining what we're going to do, but honestly, I'm stuck. How should I approach this trade-off? What am I missing here?";
// A3 (AIE-approved text, prompt/AIE-A3-COMMON-20261017-v1.json, exact): the range is kept whole on its link, never an end.
const PER_ONE = 'If it is a money size PER ONE of something the brief names (per deal, per contract, per customer), apply the per-one rule: keep that countable as its own quantity, link it to the money goal per one (effect_per_source_change 1), and retain "£1-2 million" as the complete stated effect range in statements on that directed link, with its signed endpoints, actual unit, reference, period, conditions and source. Leave the point size null unless a separately supported point size is supplied. Retain any explicitly stated central figure with its qualifier and range, without interpreting it as an expected mean or inferring a distribution. Any operative Olumi approximation stays separate, with its own supported basis, disclosed assumptions and required approval. Do not substitute a chosen endpoint, midpoint, zero or a guessed spread for the source, and do not re-ask a range already supplied.';

describe('A4 first pass: the written range is asked of the FIRST construct', () => {
  it('RED: Paul\'s brief → the FIRST call already asks the per-one rule of "£1-2 million"; a draft that carries it is ONE call', async () => {
    const { graph, inputs, registeredBrief } = await build([repairedDraft()]);
    expect(inputs).toHaveLength(1);
    // CODEX CEE BUDDY 5944923532: the notes ride the drafter's input ONLY — the persisted brief is the user's words, verbatim.
    expect(registeredBrief).toBe(BRIEF);
    expect(inputs[0]).toBe(`${todayLine(new Date())}\n\n${BRIEF_LABEL}\n${BRIEF}\n\nConstruction notes: ${JSON.stringify([`The brief writes "£1-2 million". ${PER_ONE} If it is not a size per one of anything, draw it as you otherwise would.`])}`);
    expect(dealLink(graph)?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('BACKSTOP: the retry still asks with its OWN words, byte for byte as before, when the first draft ignores the note', async () => {
    const { inputs } = await build([servedFirstDraft(), repairedDraft()]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain(JSON.stringify([`The brief writes "£1-2 million" and no link in the model carries it. ${PER_ONE} If it is not a size per one of anything, change nothing for it.`]));
  });

  it('CONTROL (DL condition 1): questions about a price move and D1\'s no-range brief get the exact shared frame without range notes', () => {
    for (const brief of [T2_A, T2_C, T2_D1]) expect(firstConstructInput(brief)).toBe(`${todayLine(new Date())}\n\n${BRIEF_LABEL}\n${brief}`);
  });

  it('CONTROL: a range asked as a question ("Should we focus on firms that do deals between £1-2m?") is no note', () => {
    const asked = 'We need to raise at least £1.2m in 2 months. Should we focus on firms that do deals between £1-2m?';
    expect(firstConstructInput(asked)).toBe(`${todayLine(new Date())}\n\n${BRIEF_LABEL}\n${asked}`);
  });
});

// ⭐ A3 (AIE-approved text, exact; DL-3 ruling 2): the producer keeps a written range WHOLE on its link, size null, and records it in
// `statements`. SYNTHETIC brief (never the served one): the range keeps both ends with its provenance, no retry is asked for what the
// draft holds, and the size stays Olumi's placeholder, said once against the user's range (ITEM 3); only claims resting on it wait.
const SYN_RANGE = 'Each new clinic contract is worth between £20-40k a year to us.';
const SYN_BRIEF = `We sell booking software to clinics. ${SYN_RANGE} We need at least £120k of new annual contract value within 3 months.`;
function wholeRangeDraft(recorded = true): Record<string, unknown> {
  return {
    goal: { metric: 'new annual contract value', operator: '>=', target_stated: true, frame: 'level', value: 120000, unit: '£', horizon_months: 3,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Add a sales hire', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Sales calls per week', value: 40, value_kind: 'absolute', unit: 'calls/week', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: 'Sales calls per week', role: 'controllable', baseline_known: true, baseline_value: 20, unit: 'calls/week', provenance: 'ai_proposed', plausible_max: 100 }],
    risks: [],
    outcomes: [{ label: 'Clinic contracts signed', provenance: 'inferred', unit: 'contracts', plausible_max: 10 }],
    links: [link('Sales calls per week', 'Clinic contracts signed'), link('Clinic contracts signed', 'new annual contract value', { amount: null as never, per: 1, by: null as never })],
    identities: [], unknowns: [], decision_question: null,
    statements: recorded ? [{ quote: SYN_RANGE, subject: { kind: 'link', label: 'Clinic contracts signed', to_label: 'new annual contract value', factor_label: null },
      field: 'effect', form: 'range', value: null, low: 20000, high: 40000, unit: '£', qualifier: null, conditions: null }] : [],
  };
}

describe('A3: a written range is kept whole on its link, never an end as the size', () => {
  it('RED → GREEN: the recorded range keeps both ends, as the user\'s; no retry is asked for it; the size stays Olumi\'s placeholder, said once', async () => {
    const { graph, inputs, out } = await build([wholeRangeDraft()], SYN_BRIEF);
    expect(inputs, 'a range the draft records is never asked again').toHaveLength(1);
    const g = graph as unknown as { nodes: Array<Record<string, any>>; edges: Array<Record<string, any>> };
    const from = g.nodes.find((n) => n.label === 'Clinic contracts signed')!;
    const to = g.nodes.find((n) => n.label === 'new annual contract value')!;
    const edge = g.edges.find((e) => e.from === from.id && e.to === to.id)!;
    expect(edge.provenance?.natural_effect, 'no end of the range is the size').toBeUndefined();
    expect(edge.provenance?.magnitude ?? 'placeholder').not.toBe('user_stated');
    const record = from.user_statements?.find((r: Record<string, any>) => r.subject_key === `link|${from.id}|${to.id}||effect`);
    expect(record, JSON.stringify(from.user_statements ?? null)).toMatchObject({ statements: [expect.objectContaining({ speaker: 'user', quote: SYN_RANGE, form: 'range', low: 20000, high: 40000 })] });
    expect((out.not_represented as string[]).some((x) => x.includes(SYN_RANGE) && x.includes('Olumi')), JSON.stringify(out.not_represented)).toBe(true);
  });

  it('CONTRAST: a draft that neither sizes nor records the written range is still asked about it by the retry (the backstop stands)', async () => {
    const { inputs } = await build([wholeRangeDraft(false), wholeRangeDraft(false)], SYN_BRIEF);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain(JSON.stringify('The brief writes "£20-40k" and no link in the model carries it.').slice(1, -1));
  });
});

