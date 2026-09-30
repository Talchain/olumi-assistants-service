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
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
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
  const inputs: string[] = [];
  const call = (async (req: { input: string }) => {
    inputs.push(req.input);
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a4a4a4a4-0000-4a4a-8a4a-a4a4a4a4a4a4', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out, inputs };
}

const dealLink = (g: Graph) => g.edges.find((e) => e.from === 'deals_closed' && e.to === 'securing_funding');

describe('A4 guarantee: a written money range no link carries is asked of the repair retry', () => {
  it('RED: the served first draft (no countable) → the retry is asked the uncarried "£1-2 million", and the repaired draft is adopted', async () => {
    const { graph, inputs } = await build([servedFirstDraft(), repairedDraft()]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('Construction issues:');
    expect(inputs[1]).toContain('£1-2 million');
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
