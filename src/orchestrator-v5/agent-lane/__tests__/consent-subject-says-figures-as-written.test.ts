/**
 * ⭐ A CONSENT SUBJECT SAYS A FIGURE AS THE USER WRITES IT (DL #72 5866282787, item 1).
 *
 * Served on `593362a` (3 × journey C, 28 Sep 08:21Z), after #2221 made these labels the reply's first sentence:
 *   - C03: "record the current level of "MRR" as your figure: 72000 £ MRR (target 100000 £ MRR)"
 *     and, on another run, "72000 GBP per month (target 100000 GBP per month)";
 *   - C05: "change the limit on … from at most 20000 £ over 6 months to at most 30000 £ over 6 months"
 *     and "20000 GBP over 6 months"; C06's approval repeated them ("is now at most 30000 £ over 6 months").
 *
 * The rule: every label producer says a figure through the lane's ONE figure formatter (`say-figure.ts`, moved
 * verbatim from MG's `limited-level-ask.ts`, so the limit asks and the consent subjects agree). A currency symbol or
 * code comes first with the figure grouped; the rest of the unit keeps its words. A figure the formatter cannot say
 * EXACTLY (more than two decimal places) keeps the producer's own exact rendering: a consent label never rounds the
 * figure it writes.
 *
 * The producer rows run the REAL capabilities on the SERVED graphs, with the user's words verbatim; the two served
 * unit spellings ("GBP …" and "£ …") are each a row.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sayFigureExactly } from '../say-figure.js';
import { composeProposalReply } from '../proposal-reply.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { breakEvenFor, breakEvenLine } from '../break-even.js';

type Node = Record<string, unknown> & { id: string };
type Served = { message: string; graph: { nodes: Node[]; goal_constraints?: Array<Record<string, unknown>> } & Record<string, unknown> };
const load = (f: string): Served => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as Served;
const C03 = load('served-journey-c-c03-mrr-651a7fd.json');
const C05 = load('served-journey-c-c05-budget-651a7fd.json');
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c3';

async function produce(s: Served, tool: string, args: Record<string, unknown>, message = s.message): Promise<Record<string, unknown>> {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(s.graph)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' } } }
    : { status: 500, json: {} });
  const caps = createAgentCapabilities(d, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: message, user_turn_text: message };
  return (await dispatchTool(tool, JSON.stringify(args), ctx as never, caps)) as Record<string, unknown>;
}

/** The served graph with every use of one unit spelled another way (served run 1 spelled "GBP" as "£"). */
function respelled(s: Served, from: string, to: string): Served {
  return JSON.parse(JSON.stringify(s).split(JSON.stringify(from)).join(JSON.stringify(to))) as Served;
}

/** A figure left as the engine holds it: five or more ungrouped digits, or a figure followed by its currency. */
const RAW = /(?<![\d,.])\d{4,}(?![\d,])|\d\s(?:£|GBP)\b/;

const limitLabel = (C05.graph.goal_constraints as Array<{ label: string; value: number }>).find((c) => c.value === 20000)!.label;
const LIMIT_ARGS = { limit_label: limitLabel, operator: '<=', new_value: 30000, unit: 'GBP', rationale: C05.message };

describe('⭐ a consent subject says a figure as the user writes it', () => {
  it('the formatter, one row per shape', () => {
    expect(sayFigureExactly(72000, 'GBP per month')).toBe('£72,000 per month');
    expect(sayFigureExactly(72000, '£ MRR')).toBe('£72,000 MRR');
    expect(sayFigureExactly(20000, 'GBP over 6 months')).toBe('£20,000 over 6 months');
    expect(sayFigureExactly(20000, '£ over 6 months')).toBe('£20,000 over 6 months');
    expect(sayFigureExactly(30000, 'GBP/year')).toBe('£30,000/year');
    expect(sayFigureExactly(3.5, '%')).toBe('3.5%');
    expect(sayFigureExactly(1300, 'subscribers')).toBe('1,300 subscribers');
    expect(sayFigureExactly(72000.5, 'GBP')).toBe('£72,000.5');
    // Exact or not at all: two decimal places would round these.
    expect(sayFigureExactly(0.125, '%')).toBeNull();
    expect(sayFigureExactly(Number.NaN, 'GBP')).toBeNull();
  });

  for (const [name, graph, unit] of [
    ['GBP per month (served run 2)', C03, 'GBP per month'],
    ['£ MRR (served run 1)', respelled(C03, 'GBP per month', '£ MRR'), '£ MRR'],
  ] as const) {
    it(`RED (goal level, ${name}): the user’s figure and the target, grouped, the currency first`, async () => {
      const r = await produce(graph, 'propose_goal_current_level', { goal_label: 'MRR', value: 72000, unit, goal_is: 'at_least', user_stated: true });
      expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
      const said = unit === '£ MRR' ? '£72,000 MRR (target £100,000 MRR)' : '£72,000 per month (target £100,000 per month)';
      expect(String(r.public_label)).toContain(`as your figure: ${said}`);
      expect(String(r.public_label)).not.toMatch(RAW);
      // The re-derived count keeps its own words.
      expect(String(r.public_label)).toMatch(/becomes about 1,469 subscribers \(was 1,300 subscribers\)/);
      const reply = composeProposalReply('propose_goal_current_level', { whole_request: true }, r, C03.message);
      expect(reply).toContain(said);
      expect(reply).not.toMatch(RAW);
    });
  }

  for (const [name, graph] of [
    ['GBP over 6 months (served run 2)', C05],
    ['£ over 6 months (served run 1)', respelled(C05, 'GBP over 6 months', '£ over 6 months')],
  ] as const) {
    it(`RED (limit change, ${name}): both figures grouped, the currency first, the period kept`, async () => {
      const r = await produce(graph, 'propose_limit_change', LIMIT_ARGS);
      expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
      expect(r.public_label).toBe(`Change the limit on "${limitLabel}" from at most £20,000 over 6 months to at most £30,000 over 6 months`);
      const reply = composeProposalReply('propose_limit_change', { whole_request: true }, r, C05.message);
      expect(reply).toContain('from at most £20,000 over 6 months to at most £30,000 over 6 months');
      expect(reply).not.toMatch(RAW);
    });
  }

  it('CONTROL (limit change, %): already said as written, and still is', async () => {
    const msg = 'Our churn limit is now less than 3%.';
    const r = await produce(C05, 'propose_limit_change', { limit_label: 'Monthly churn', operator: '<=', new_value: 3, unit: '%', rationale: msg }, msg);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
    expect(r.public_label).toBe('Change the limit on "Monthly churn" from less than 4% to less than 3%');
  });

  it('RED (option levels, count and money): each level said as written, in the subject and in Olumi’s-estimate lines', async () => {
    const msg = 'Put £15,000 into advertising, and assume 1,200 Pro subscribers under that option.';
    const r = await produce(C05, 'propose_option_interventions', {
      interventions: [
        { option_label: 'Additional advertising', factor_label: 'Advertising spend', value: 15000, unit: 'GBP over 6 months', basis: msg },
        { option_label: 'Additional advertising', factor_label: 'Pro paying subscribers', value: 1200, unit: 'subscribers', basis: msg },
      ],
    }, msg);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
    expect(String(r.public_label)).toContain('to £15,000 over 6 months');
    expect(String(r.public_label)).toContain('to 1,200 subscribers');
    expect(String(r.public_label)).not.toMatch(RAW);
    // Olumi's estimate, said by the one-call template's own line.
    const estimated = { ok: true, mutated: false, proposal_id: r.proposal_id, public_label: r.public_label, base_revision: r.base_revision, interventions: [{ option: 'Additional advertising', factor: 'Advertising spend', value: 15000, unit: 'GBP over 6 months', basis: 'a planning figure', stated_by: 'olumi_estimate' }] };
    const reply = composeProposalReply('propose_option_interventions', { interventions: [], whole_request: true }, estimated, msg);
    expect(reply).toContain('‘Advertising spend’ under ‘Additional advertising’ is set to £15,000 over 6 months, Olumi’s estimate');
    expect(reply).not.toMatch(RAW);
  });

  it('RED (a revised starting value): both figures said as written', async () => {
    const msg = 'Advertising spend is now £15,000 over the six months.';
    const r = await produce(C05, 'propose_assumptions', {
      assumptions: [{ factor_label: 'Advertising spend', value: 15000, unit: 'GBP over 6 months', basis: msg, revise: true }],
    }, msg);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
    expect(String(r.public_label)).toMatch(/Advertising spend: £[\d,]+ over 6 months → £15,000 over 6 months/);
    expect(String(r.public_label)).not.toMatch(RAW);
  });
});

/**
 * A COUNT WITH A FRACTIONAL STORED VALUE (DL #72 5866480722; MG 5866456413, served run 3 on `63e060e`): after #2214 the
 * re-derived subscriber estimate is the exact quotient 72,000 / 49 = 1,469.388…, and the arithmetic said "1,469.388 Pro
 * paying subscribers" and "a loss of at most 248.388". A count is said as a whole number; the stored level is untouched.
 */
describe('⭐ a count is said as a whole number, whatever the stored quotient', () => {
  const F8 = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: unknown[]; edges: unknown[] };
  const served = breakEvenFor(F8)!;

  it('RED (served run 3 shape): "about 1,469" and "about 248", never 1,469.388 or 248.388', () => {
    const v0 = 72_000 / 49;
    const keep = Math.ceil(72_000 / 59 - 1e-9);
    const be = { ...served, baseline_volume: v0, baseline_volume_by: 'olumi' as const, baseline_goal: 72_000,
      options: [{ option: 'Raise Pro to £59', option_id: 'raise_pro_to_59', price: 59, price_by: 'user' as const, keep_at_least: keep }] };
    const { target: _t, ...noTarget } = be;
    const said = breakEvenLine(noTarget);
    expect(said).toContain('at £49/month and about 1,469 Pro paying subscribers (Olumi’s estimate), MRR is £72,000/month today.');
    expect(said).toContain('At £59/month, MRR stays at least that while 1,221 or more of about 1,469 stay (a loss of at most about 248).');
    expect(said).not.toMatch(/\d\.\d{3}/);
  });

  it('CONTROL (served F8, whole counts): said exactly as before', () => {
    const said = breakEvenLine(served);
    expect(said).toContain('at £49/month and 300 Pro paying subscribers (an assumption you approved), MRR is £14,700/month today.');
    expect(said).toContain('At £59/month, MRR stays at least that while 250 or more of the 300 stay (a loss of at most 50).');
  });
});
