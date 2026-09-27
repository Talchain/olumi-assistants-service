/**
 * ⛔ A NUMBER IN THE BRIEF IS TODAY'S LEVEL OF A FACTOR ONLY WHEN IT IS WRITTEN AS THAT (AI Quality F2 on CEE #2073).
 *
 * #2076 kept a baseline as the user's (`brief_extraction`) when its number appeared ANYWHERE in the brief. Two shapes
 * over-claim, both read here on SERVED graphs (MG construction sweep, 27 Sep; fixture provenance inside):
 *   (a) the number is an OPTION's level on that same factor — "hire two senior engineers" grounded a baseline of 2
 *       seniors today;
 *   (b) the number is written for ANOTHER quantity — "0 enterprise customers" (or "zero …") grounded every 0.
 * Each row restamps the named factor to the defect shape and reads the author `withdrawUnstatedBaselineStamps` leaves.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withdrawUnstatedBaselineStamps } from '../stated-by-user.js';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: Record<string, { value: number }> };
type Graph = { brief: string; nodes: Node[] };
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'served-baseline-grounding-full-graphs-20260927.json'), 'utf8')) as { graphs: Record<string, Graph> };
const graph = (key: string): Graph => {
  const g = FIXTURE.graphs[key];
  expect(g, key).toBeDefined();
  return g!;
};

/** The factor `id` as admission stamps a known, named baseline: today's level `raw`, the user's (`brief_extraction`). */
function restamp(nodes: readonly Node[], stamps: Record<string, number>): Node[] {
  for (const id of Object.keys(stamps)) expect(nodes.filter((n) => n.id === id && n.kind === 'factor'), id).toHaveLength(1);
  return nodes.map((n) => {
    if (!(n.id in stamps)) return n;
    const raw = stamps[n.id]!;
    const { extractionType: _e, ...os } = n.observed_state ?? {};
    const cap = typeof os.cap === 'number' ? os.cap : undefined;
    return { ...n, observed_state: { ...os, value: cap !== undefined ? raw / cap : raw, raw_value: raw, source: 'brief_extraction' } };
  });
}
const stateOf = (nodes: readonly Node[], id: string): Record<string, unknown> => {
  const hit = nodes.filter((n) => n.id === id);
  expect(hit, id).toHaveLength(1);
  return hit[0]!.observed_state ?? {};
};
/** The brief with `from` replaced by `to` exactly once (a replacement that misses would test the served brief). */
const rewrite = (brief: string, from: string, to: string): string => {
  expect(brief.split(from)).toHaveLength(2);
  return brief.replace(from, to);
};

describe('F2 (a): a number the brief writes as an OPTION\'s level is not today\'s level of that factor', () => {
  it('RED served eng-hiring (a hybrid option sets 1 senior): "hire two senior engineers or four junior engineers" makes neither 2 nor 4 the user\'s', () => {
    const g = graph('enghiring_hybrid');
    // The served options: "Hire two senior engineers" sets 2 seniors, "Hire four junior engineers" 4 juniors.
    expect(g.nodes.find((n) => n.id === 'hire_two_senior_engineers')!.interventions!.senior_engineers_hired!.value * 10).toBe(2);
    const nodes = restamp(g.nodes, { senior_engineers_hired: 2, junior_engineers_hired: 4 });
    const out = withdrawUnstatedBaselineStamps(nodes, g.brief);
    for (const [id, raw] of [['senior_engineers_hired', 2], ['junior_engineers_hired', 4]] as const) {
      expect(stateOf(out, id).source, id).toBe('cee_inference');
      expect(stateOf(out, id).raw_value, id).toBe(raw);
      expect(stateOf(out, id).cap, id).toBe(stateOf(nodes, id).cap);
    }
  });

  it('RED served eng-hiring (option labels in digits): a baseline of 2 seniors is Olumi\'s, not the user\'s', () => {
    const g = graph('enghiring_digits');
    const out = withdrawUnstatedBaselineStamps(restamp(g.nodes, { senior_engineers_hired: 2 }), g.brief);
    expect(stateOf(out, 'senior_engineers_hired')).toMatchObject({ raw_value: 2, source: 'cee_inference' });
  });

  it('CONTROL: written once more than the options explain ("We have two senior engineers today."), 2 stays the user\'s', () => {
    const g = graph('enghiring_hybrid');
    const nodes = restamp(g.nodes, { senior_engineers_hired: 2 });
    const out = withdrawUnstatedBaselineStamps(nodes, `We have two senior engineers today. ${g.brief}`);
    const at = nodes.findIndex((n) => n.id === 'senior_engineers_hired');
    expect(out[at]).toBe(nodes[at]);
    expect(stateOf(out, 'senior_engineers_hired')).toMatchObject({ raw_value: 2, source: 'brief_extraction' });
  });

  it('CONTROL served Pro: "from £49 to £59" keeps the user\'s £49 beside an option held at £49; every node unchanged', () => {
    const g = graph('pro_hold_49');
    expect(stateOf(g.nodes, 'pro_plan_price')).toMatchObject({ raw_value: 49, source: 'brief_extraction' });
    expect(g.nodes.filter((n) => n.kind === 'option' && n.interventions?.pro_plan_price !== undefined)
      .map((n) => Math.round(n.interventions!.pro_plan_price!.value * 200)).sort((a, b) => a - b)).toEqual([49, 59]);
    const out = withdrawUnstatedBaselineStamps(g.nodes, g.brief);
    g.nodes.forEach((n, i) => expect(out[i], n.id).toBe(n));
  });

  it('CONTROL served Pro: "£59 per month" is still the option\'s £59 when another label holds "per" ("New Pro subscriptions per month")', () => {
    const g = graph('pro_rate_label');
    expect(g.nodes.some((n) => n.label === 'New Pro subscriptions per month')).toBe(true);
    const out = withdrawUnstatedBaselineStamps(g.nodes, g.brief);
    g.nodes.forEach((n, i) => expect(out[i], n.id).toBe(n));
  });
});

describe('F2 (b): a number written for ANOTHER quantity does not ground this one', () => {
  it('RED served stated-zero: "0 enterprise customers" makes neither the partners\' 0 nor the spend\'s £0 the user\'s', () => {
    const g = graph('statedzero');
    const out = withdrawUnstatedBaselineStamps(restamp(g.nodes, { active_channel_partners: 0, new_annual_spend: 0 }), g.brief);
    expect(stateOf(out, 'active_channel_partners')).toMatchObject({ raw_value: 0, source: 'cee_inference' });
    expect(stateOf(out, 'new_annual_spend')).toMatchObject({ raw_value: 0, source: 'cee_inference' });
    expect(stateOf(out, 'account_executives')).toMatchObject({ raw_value: 3, source: 'brief_extraction' });
  });

  it('RED: "zero enterprise customers" grounds no unrelated 0 either', () => {
    const g = graph('statedzero');
    const brief = rewrite(g.brief, '0 enterprise customers today', 'zero enterprise customers today');
    const out = withdrawUnstatedBaselineStamps(restamp(g.nodes, { active_channel_partners: 0, new_annual_spend: 0 }), brief);
    expect(stateOf(out, 'active_channel_partners').source).toBe('cee_inference');
    expect(stateOf(out, 'new_annual_spend').source).toBe('cee_inference');
  });

  it('CONTROL: "zero active channel partners" stays the partners\' 0', () => {
    const g = graph('statedzero');
    const brief = rewrite(g.brief, '0 enterprise customers today', 'zero active channel partners today');
    const out = withdrawUnstatedBaselineStamps(restamp(g.nodes, { active_channel_partners: 0, new_annual_spend: 0 }), brief);
    expect(stateOf(out, 'active_channel_partners').source).toBe('brief_extraction');
  });

  it('RED: the same "zero active channel partners" grounds no £0 of new annual spend', () => {
    const g = graph('statedzero');
    const brief = rewrite(g.brief, '0 enterprise customers today', 'zero active channel partners today');
    const out = withdrawUnstatedBaselineStamps(restamp(g.nodes, { active_channel_partners: 0, new_annual_spend: 0 }), brief);
    expect(stateOf(out, 'new_annual_spend')).toMatchObject({ raw_value: 0, source: 'cee_inference' });
  });

  it('CONTROL served factor-zero: "0 channel partners" and "three account executives" stay the user\'s; every node unchanged', () => {
    const g = graph('factorzero');
    expect(stateOf(g.nodes, 'channel_partner_count')).toMatchObject({ raw_value: 0, source: 'brief_extraction' });
    expect(stateOf(g.nodes, 'account_executive_headcount')).toMatchObject({ raw_value: 3, source: 'brief_extraction' });
    const out = withdrawUnstatedBaselineStamps(g.nodes, g.brief);
    g.nodes.forEach((n, i) => expect(out[i], n.id).toBe(n));
  });
});
