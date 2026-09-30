/**
 * ⭐ A4 — THE BRIEF'S "£1-2 million" PER DEAL IS CARRIED AS A SIZE PER DEAL, SAID WITH ITS RANGE, AS A FLOOR
 * (R3 #75 5918453000 first fail; lease MG 5918487838; R3 5918513716 (a) + C1 + C2; AIQ 5918523203; DL 5918542181).
 *
 * Paul's funding brief says "investment firms that do deals between £1-2 million". Read as `£1` and `2 million`, the deal
 * size could never be his figure, so every £ size into "Securing funding" was Olumi's guess. Now:
 *  · the drafter keeps the countable ("Deals closed") and sizes deals → £ goal with the LOW end, £1,000,000 per deal;
 *  · the size door (#2389) reads it as the user's (`user_stated`), because the brief writes £1m about deals;
 *  · it is said WITH the range, never as "your £1m" (C1), and as a floor: "at least" (C2); the edge carries the range
 *    (`natural_effect.stated_range`) so the card can say it too;
 *  · the same £1m on a conversations → goal link, or an angel link, stays Olumi's (AIQ: angels give "a small amount").
 *
 * Real path: strict candidate schema → `buildModelFromBrief` → the `/graph/register` body → `GraphV3.parse` → edges by id.
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Prov = 'explicit' | 'inferred' | 'ai_proposed';
type Size = { amount: number; per: number; by: Prov };
type NE = { amount?: number; amount_unit?: string; per_source_change_unit?: string; stated_range?: { low: number; high: number; text: string; end: string } };
type Wire = ReturnType<typeof deals>;
type Edge = { from: string; to: string; provenance?: { magnitude?: string; natural_effect?: NE } };
type Graph = { nodes: { id: string; kind: string }[]; edges: Edge[] };

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

/** Paul's shape as the A4 drafter rule asks for it: "Deals closed" is its own quantity; conversations → deals is unsized. */
function deals(sized: { deals?: Size; angel?: Size; conversations?: Size }) {
  return {
    goal: {
      metric: 'securing funding', operator: '>=', target_stated: true, frame: 'level', value: 1200000, unit: '£', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Current outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel bridge outreach', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Angel investor outreach', value: 20, value_kind: 'absolute', unit: 'prospects/month', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'UK investment-firm outreach', role: 'observable', baseline_known: true, baseline_value: 30, unit: 'prospects/month', provenance: 'ai_proposed', plausible_max: 200 },
      { label: 'Angel investor outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'prospects/month', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [],
    outcomes: [
      { label: 'Qualified investor conversations', provenance: 'inferred', unit: 'conversations', plausible_max: 20 },
      { label: 'Deals closed', provenance: 'inferred', unit: 'deals', plausible_max: 5 },
    ],
    links: [
      link('UK investment-firm outreach', 'Qualified investor conversations'),
      link('Angel investor outreach', 'Qualified investor conversations'),
      link('Qualified investor conversations', 'Deals closed'),
      link('Deals closed', 'securing funding', sized.deals),
      ...(sized.angel !== undefined ? [link('Angel investor outreach', 'securing funding', sized.angel)] : []),
      ...(sized.conversations !== undefined ? [link('Qualified investor conversations', 'securing funding', sized.conversations)] : []),
    ],
    identities: [],
    unknowns: ['How many qualified investor conversations become a closed deal within two months?'],
    decision_question: null,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function build(wire: Record<string, unknown>, brief: string = BRIEF) {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let body: unknown = null;
  const instructions: string[] = [];
  const call = (async (req: { instructions: string }) => { instructions.push(req.instructions); return { text: JSON.stringify(wire) }; }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out, instructions };
}

const GOAL = 'securing_funding';
const DEALS = 'deals_closed';
const ANGEL = 'angel_investor_outreach';
const CONV = 'qualified_investor_conversations';
const edge = (g: Graph, from: string, to: string) => g.edges.find((x) => x.from === from && x.to === to);
const said = (out: Record<string, unknown>) => (out.not_represented as string[] | undefined) ?? [];
const LOW: Size = { amount: 1000000, per: 1, by: 'explicit' };

describe('A4: "deals between £1-2 million" is £1,000,000 per deal, the low end of the range, said with it as a floor', () => {
  it('the drafter is told to put a per-one money size on the countable → goal link, at the LOW end of a range', async () => {
    const { instructions } = await build(deals({ deals: LOW }));
    expect(instructions.length).toBeGreaterThanOrEqual(1);
    expect(instructions[0]).toContain('A MONEY SIZE THE BRIEF STATES PER ONE OF SOMETHING');
    expect(instructions[0]).toContain('When the brief gives a RANGE for that size, use its LOW end.');
  });

  it('RED: deals → goal at £1,000,000 per deal, tagged explicit → the user\'s size, carrying the range it is the low end of', async () => {
    const { graph } = await build(deals({ deals: LOW }));
    const e = edge(graph, DEALS, GOAL);
    expect(e, JSON.stringify(graph.edges.map((x) => `${x.from}->${x.to}`))).toBeDefined();
    expect(e!.provenance?.magnitude).toBe('user_stated');
    expect(e!.provenance?.natural_effect?.amount).toBe(1000000);
    expect(e!.provenance?.natural_effect?.amount_unit).toBe('£');
    expect(e!.provenance?.natural_effect?.per_source_change_unit).toBe('deals');
    expect(e!.provenance?.natural_effect?.stated_range).toEqual({ low: 1000000, high: 2000000, text: '£1-2 million', end: 'low' });
  });

  it('C1 + C2: the reply says £1,000,000 WITH "the low end of your "£1-2 million" range", as a floor ("at least"); never "you said"', async () => {
    const { out } = await build(deals({ deals: LOW }));
    const lines = said(out).filter((s) => s.includes('£1,000,000'));
    expect(lines, JSON.stringify(said(out))).toEqual([
      '£1,000,000 per deal on "Deals closed" → "securing funding" is the low end of your "£1-2 million" range, '
        + 'so any figure that runs through this link is a floor: at least that much.',
    ]);
    expect(JSON.stringify(out)).not.toMatch(/[Yy]ou said[^"]*£1,000,000|your £1,000,000|your £1m/);
  });

  it('the high end, if drafted, is said as a ceiling ("at most"), never as the user\'s single figure', async () => {
    const { graph, out } = await build(deals({ deals: { amount: 2000000, per: 1, by: 'explicit' } }));
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range?.end).toBe('high');
    expect(said(out).filter((s) => s.includes('£2,000,000'))).toEqual([
      '£2,000,000 per deal on "Deals closed" → "securing funding" is the high end of your "£1-2 million" range, '
        + 'so any figure that runs through this link is a ceiling: at most that much.',
    ]);
  });

  // AIQ 5918523203: angels give "a small amount"; the range is about investment firms' deals.
  it('CONTROL (AIQ): the same £1,000,000 on the angel → goal link is not the user\'s, with no range; the deal link is still the user\'s', async () => {
    const { graph, out } = await build(deals({ deals: LOW, angel: { amount: 1000000, per: 1, by: 'explicit' } }));
    expect(edge(graph, ANGEL, GOAL)!.provenance?.magnitude).not.toBe('user_stated');
    expect(edge(graph, ANGEL, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
    expect(edge(graph, DEALS, GOAL)!.provenance?.magnitude).toBe('user_stated');
    expect(said(out).filter((s) => s.includes('end of your'))).toHaveLength(1);
  });

  // AIQ 5918526486 / DL 5918542181: never per conversation — that would claim every conversation brings £1m.
  it('CONTROL (AIQ/DL): £1,000,000 per conversation on conversations → goal is not the user\'s, with no range', async () => {
    const { graph } = await build(deals({ deals: LOW, conversations: { amount: 1000000, per: 1, by: 'explicit' } }));
    expect(edge(graph, CONV, GOAL)!.provenance?.magnitude).not.toBe('user_stated');
    expect(edge(graph, CONV, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
  });

  it('CONTROL (R3 (b) NO): a midpoint £1,500,000 per deal is written nowhere → not the user\'s, with no range', async () => {
    const { graph } = await build(deals({ deals: { amount: 1500000, per: 1, by: 'explicit' } }));
    expect(edge(graph, DEALS, GOAL)!.provenance?.magnitude).not.toBe('user_stated');
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
  });

  it('CONTROL: a single written figure ("Each deal brings in £1m") is the user\'s with NO range and no range sentence', async () => {
    const brief = BRIEF.replace('between £1-2 million', 'that each bring in £1m');
    const { graph, out } = await build(deals({ deals: LOW }), brief);
    expect(edge(graph, DEALS, GOAL)!.provenance?.magnitude).toBe('user_stated');
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
    expect(said(out).filter((s) => s.includes('end of your'))).toEqual([]);
  });

  it('CONTROL: Olumi\'s own (not explicit) £1,000,000 per deal is not the user\'s, with no range', async () => {
    const { graph } = await build(deals({ deals: { amount: 1000000, per: 1, by: 'ai_proposed' } }));
    expect(edge(graph, DEALS, GOAL)!.provenance?.magnitude).not.toBe('user_stated');
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
  });
});

/**
 * ⛔ THE WHOLE IDENTITY (CODEX CEE BUDDY 5919834707; AIQ 5919953251; R3 5919968627): a size carries a written range only
 * when ONE span carries it about this link's source, per one of it, in the target's currency — and the bound word is
 * the end × the link's sign on the goal. Anything else: no range, no range sentence; the size stays the #2389 point.
 */
describe('A4: the range binds only to its own span, and its bound word follows the link\'s sign', () => {
  const SINGLE = BRIEF.replace('between £1-2 million', 'that each bring in £1m');
  const ANGEL_RANGE = 'Angel investor outreach budgets range between £1-2 million.';
  const noRange = (graph: Graph, out: Record<string, unknown>) => {
    expect(edge(graph, DEALS, GOAL)!.provenance?.magnitude).toBe('user_stated');
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
    expect(said(out).filter((s) => s.includes('end of your'))).toEqual([]);
  };

  it('RED (CODEX): another quantity\'s range APPENDED beside a single "£1m" per deal → the deal size takes no range', async () => {
    const { graph, out } = await build(deals({ deals: LOW }), `${SINGLE} ${ANGEL_RANGE}`);
    noRange(graph, out);
  });

  it('RED (CODEX): the same range PREPENDED → no range', async () => {
    const { graph, out } = await build(deals({ deals: LOW }), `${ANGEL_RANGE} ${SINGLE}`);
    noRange(graph, out);
  });

  it('two links sharing a numeral: each takes only its own span (the deal range stays the deals\', never the angels\')', async () => {
    const { graph, out } = await build(
      deals({ deals: LOW, angel: { amount: 1000000, per: 1, by: 'explicit' } }),
      `${BRIEF} Angel investors could each give £1m.`,
    );
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range?.end).toBe('low');
    expect(edge(graph, ANGEL, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
    expect(said(out).filter((s) => s.includes('end of your'))).toHaveLength(1);
  });

  it('CONTROL (currency): "deals between €1-2 million" is not £1m per deal — not the user\'s, no range', async () => {
    const { graph } = await build(deals({ deals: LOW }), BRIEF.replace('£1-2 million', '€1-2 million'));
    expect(edge(graph, DEALS, GOAL)!.provenance?.magnitude).not.toBe('user_stated');
    expect(edge(graph, DEALS, GOAL)!.provenance?.natural_effect?.stated_range).toBeUndefined();
  });

  it('SIGN (R3): a £ cost per hire that LOWERS the goal, at its low end, is a CEILING on what runs through it ("at most")', async () => {
    const wire = deals({ deals: LOW }) as Wire & Record<string, any>;
    wire.factors.push({ label: 'Hires', role: 'observable', baseline_known: true, baseline_value: 0, unit: 'hires', provenance: 'ai_proposed', plausible_max: 10 });
    wire.links.push(link('Hires', 'securing funding', { amount: -40000, per: 1, by: 'explicit' }, 'negative'));
    const { graph, out } = await build(wire, `${BRIEF} Each hire costs £40-60k of the round.`);
    const e = edge(graph, 'hires', GOAL);
    expect(e!.provenance?.magnitude).toBe('user_stated');
    expect(e!.provenance?.natural_effect?.stated_range).toEqual({ low: 40000, high: 60000, text: '£40-60k', end: 'low' });
    expect(said(out).filter((s) => s.includes('£40,000'))).toEqual([
      '£40,000 per hire on "Hires" → "securing funding" is the low end of your "£40-60k" range, '
        + 'so any figure that runs through this link is a ceiling: at most that much.',
    ]);
  });

  it('a link NOT straight into the goal says the range and no bound word', async () => {
    const wire = deals({}) as Wire & Record<string, any>;
    wire.outcomes.push({ label: 'Funding raised', provenance: 'inferred', unit: '£', plausible_max: 5000000 });
    wire.links = wire.links.filter((l: { from: string }) => l.from !== 'Deals closed');
    wire.links.push(link('Deals closed', 'Funding raised', LOW), link('Funding raised', 'securing funding'));
    const { graph, out } = await build(wire);
    expect(edge(graph, DEALS, 'funding_raised')!.provenance?.natural_effect?.stated_range?.end).toBe('low');
    expect(said(out).filter((s) => s.includes('end of your'))).toEqual([
      '£1,000,000 per deal on "Deals closed" → "Funding raised" is the low end of your "£1-2 million" range.',
    ]);
  });
});
