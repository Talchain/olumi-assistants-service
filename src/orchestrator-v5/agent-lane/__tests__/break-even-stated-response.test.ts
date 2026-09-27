/**
 * ⭐ THE ARITHMETIC LEADER AT THE USER'S OWN FIGURES (AIQ #70 5854577702 + 5854607789; DL split 5854587915; MG's
 * writer 5854618303). FIXTURE: the served F8 model (`served-f8-run-graph-d6b09c0.json`), options £59 (brief), £49 hold
 * and £54 (Olumi's). Its subscriber count (300) is an approved assumption; the "user's count" rows restamp it with the
 * brief's own source (`brief_extraction`, the stamp the served £49 price carries), and MG's typed fact is placed on the
 * node carrying `nonlinear_identity` (the goal, `mrr`), in MG's shape.
 *
 * By hand at the user's figures (300 today; 260 stay at £59; 280 at £54): £59 × 260 = £15,340; £54 × 280 = £15,120;
 * £49 × 300 = £14,700 → £59 gives the most MRR, on this arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { breakEvenFor, breakEvenLine } from '../break-even.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: Record<string, unknown>[] };
type N = Record<string, unknown> & { observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> };
const node = (ns: Record<string, unknown>[], id: string) => ns.find((n) => n.id === id)! as N;
const at = (price: number, level: number) => ({ price_node_id: 'pro_plan_price', price, level, by: 'user' });
const FACT = { operand_node_id: 'pro_paying_subscribers', today: { value: 300, unit: 'subscribers', by: 'user' }, at: [at(59, 260), at(54, 280)] };
const graph = (opts: { userCount?: boolean; fact?: unknown; aiToday?: number; change?: (ns: Record<string, unknown>[]) => void } = {}) => {
  const g = structuredClone(served);
  if (opts.userCount !== false) node(g.nodes, 'pro_paying_subscribers').observed_state!.source = 'brief_extraction';
  // Paul's graph AFTER the starting point: the AI release is 1 today, as every option sets it (AIQ B1), so price is the
  // only lever that differs. The served F8 draft itself has it at 0 today — the B1 RED below.
  node(g.nodes, 'ai_feature_availability').observed_state!.value = opts.aiToday ?? 1;
  node(g.nodes, 'ai_feature_availability').observed_state!.raw_value = opts.aiToday ?? 1;
  if (opts.fact !== undefined) node(g.nodes, 'mrr').stated_response = opts.fact;
  opts.change?.(g.nodes);
  return g;
};

describe('AX1 at the user\'s own figures: a stated response names the arithmetic leader, and only then', () => {
  it('RED: today\'s count and a count at every compared price, all the user\'s → the figures and the arithmetic leader', () => {
    const be = breakEvenFor(graph({ fact: FACT }))!;
    expect(be.stated?.leader).toBe('Raise Pro to £59');
    expect(be.stated?.at_your_figures?.map((x) => [x.option, x.volume, x.goal_value])).toEqual([
      ['Raise Pro to £59', 260, 15_340], ['Hold £49 with AI release', 300, 14_700], ['Raise Pro to £54', 280, 15_120]]);
    const said = breakEvenLine(be);
    expect(said).toContain('At your own figures, Raise Pro to £59 gives £15,340/month (260 at £59/month), Hold £49 with AI release gives £14,700/month (300 at £49/month, as today) and Raise Pro to £54 gives £15,120/month (280 at £54/month).');
    expect(said).toContain('On this arithmetic, Raise Pro to £59 gives the most MRR.');
    expect(said).toContain('This is arithmetic on your figures, not the analysis ranking the options.');
    expect(said).not.toContain('it says nothing about how many will stay');
  });

  it('CONTRAST: today\'s count is not the user\'s (an approved assumption) → no leader; Olumi asks for today\'s count', () => {
    const be = breakEvenFor(graph({ userCount: false, fact: FACT }))!;
    expect(be.stated).toEqual({ ask: { today: true } });
    expect(breakEvenLine(be)).toContain('To compare the options at your own figures, tell me how many Pro paying subscribers you have today.');
    expect(breakEvenLine(be)).not.toContain('gives the most');
  });

  it('CONTRAST: the user\'s count but no stated response → the break-even stays, and Olumi asks at each compared price', () => {
    const said = breakEvenLine(breakEvenFor(graph())!);
    expect(said).toContain('it says nothing about how many will stay.');
    expect(said).toContain('To compare them at your own figures, tell me how many Pro paying subscribers you would expect at £54/month or £59/month.');
  });

  it('CONTRAST (AIQ Q1): a rival at a price with no stated count → no leader; the ask names only that price', () => {
    const be = breakEvenFor(graph({ fact: { ...FACT, at: [at(59, 260)] } }))!;
    expect(be.stated).toEqual({ ask: { at_prices: [54] } });
    expect(breakEvenLine(be)).toContain('you would expect at £54/month.');
  });

  it('STALE (AIQ): today\'s count changed since it was stated → nothing is named from it; Olumi asks again', () => {
    const be = breakEvenFor(graph({ fact: FACT, change: (ns) => { node(ns, 'pro_paying_subscribers').observed_state!.raw_value = 320; } }))!;
    expect(be.stated?.leader).toBeUndefined();
    expect(be.stated?.ask).toEqual({ at_prices: [54, 59] });
  });

  it('STALE (AIQ): an option\'s price changed (£59 → £64) → that price has no stated count; Olumi asks for it', () => {
    const be = breakEvenFor(graph({ fact: FACT, change: (ns) => {
      const lv = node(ns, 'raise_pro_to_59').interventions!.pro_plan_price as Record<string, unknown>;
      lv.raw_value = 64; if (typeof lv.value === 'number') lv.value = (lv.value as number) * 64 / 59;
    } }))!;
    expect(be.stated?.leader).toBeUndefined();
    expect(be.stated?.ask).toEqual({ at_prices: [64] });
  });

  it('KEPT (AIQ): a churn edit (Paul\'s step 4) leaves the stated response current — the leader stays', () => {
    const be = breakEvenFor(graph({ fact: FACT, change: (ns) => { node(ns, 'monthly_churn').observed_state!.raw_value = 12; } }))!;
    expect(be.stated?.leader).toBe('Raise Pro to £59');
  });

  it('CONTRAST: a figure not the user\'s, or on another operand, is never used', () => {
    const notUsers = breakEvenFor(graph({ fact: { ...FACT, at: [{ ...at(59, 260), by: 'olumi' }, at(54, 280)] } }))!;
    expect(notUsers.stated).toEqual({ ask: { at_prices: [59] } });
    const otherOperand = breakEvenFor(graph({ fact: { ...FACT, operand_node_id: 'monthly_churn' } }))!;
    expect(otherOperand.stated).toEqual({ ask: { at_prices: [54, 59] } });
  });

  it('STALE (AIQ 3): the identity moved — its operand is now another factor → the fact no longer answers it; nothing named', () => {
    const be = breakEvenFor(graph({ fact: FACT, change: (ns) => {
      const id = node(ns, 'mrr').nonlinear_identity as { factor_ids?: string[] };
      id.factor_ids = (id.factor_ids ?? []).map((f) => (f === 'pro_paying_subscribers' ? 'monthly_churn' : f));
    } }));
    expect(be?.stated?.leader).toBeUndefined();
  });

  it('STALE (AIQ 3): a non-product identity yields no arithmetic at all, so no stated leader', () => {
    const g = graph({ fact: FACT, change: (ns) => { (node(ns, 'mrr').nonlinear_identity as { operation?: string }).operation = 'sum'; } });
    expect(breakEvenFor(g)?.stated?.leader).toBeUndefined();
  });

  it('STALE (AIQ 4): the count\'s unit changed (to "paying accounts") or the fact carries none → incomparable; Olumi asks again', () => {
    const changed = breakEvenFor(graph({ fact: FACT, change: (ns) => { node(ns, 'pro_paying_subscribers').observed_state!.unit = 'paying accounts'; } }));
    expect(changed?.stated?.leader).toBeUndefined();
    const noUnit = breakEvenFor(graph({ fact: { ...FACT, today: { value: 300, by: 'user' } } }))!;
    expect(noUnit.stated).toEqual({ ask: { at_prices: [54, 59] } });
    const caseOnly = breakEvenFor(graph({ fact: { ...FACT, today: { value: 300, unit: '  Subscribers ', by: 'user' } } }))!;
    expect(caseOnly.stated?.leader, 'trimmed and case-folded, as limitTargetCaps compares').toBe('Raise Pro to £59');
  });

  it('RED (AIQ B1, MG refinement): the options share a lever that differs from today (AI 0 today, all set 1) → today\'s count cannot stand in for £49; £49 is asked too, no leader', () => {
    const be = breakEvenFor(graph({ fact: FACT, aiToday: 0 }))!;
    expect(be.stated).toEqual({ ask: { at_prices: [49] }, with: ['AI feature availability on'] });
    const said = breakEvenLine(be);
    expect(said).not.toContain('gives the most');
    expect(said).toContain('you would expect at £49/month, with AI feature availability on.');
  });

  it('RED (MG): the same, with a stated count at £49 too → the leader from three stated counts (today\'s 300 is not used)', () => {
    const be = breakEvenFor(graph({ fact: { ...FACT, at: [...FACT.at, at(49, 310)] }, aiToday: 0 }))!;
    expect(be.stated?.at_your_figures?.find((x) => x.price === 49)?.volume).toBe(310);
    expect(be.stated?.leader).toBe('Raise Pro to £59');
  });

  it('CONTRAST (AIQ B1): the release is already 1 today → the shared lever equals today; £49 uses today\'s count and the leader is named', () => {
    const be = breakEvenFor(graph({ fact: FACT, aiToday: 1 }))!;
    expect(be.stated?.at_your_figures?.find((x) => x.price === 49)?.volume).toBe(300);
    expect(be.stated?.leader).toBe('Raise Pro to £59');
  });

  it('FAIL-CLOSED (AIQ B1): the options disagree on another lever (one without the release) → no figures, no leader, no ask', () => {
    const be = breakEvenFor(graph({ fact: { ...FACT, at: [...FACT.at, at(49, 310)] }, aiToday: 0, change: (ns) => { delete node(ns, 'raise_pro_to_54').interventions!.ai_feature_availability; } }))!;
    expect(be.stated).toEqual({});
    expect(breakEvenLine(be)).toContain('it says nothing about how many will stay.');
  });

  it('RED (AIQ P1): "keep current" (£49, AI off) and "hold £49 with the release" (AI on) never share a count', () => {
    const be = breakEvenFor(graph({ fact: { ...FACT, at: [...FACT.at, at(49, 310)] }, aiToday: 0, change: (ns) => {
      const hold = node(ns, 'hold_49_with_ai_release');
      ns.push({ id: 'keep_current', kind: 'option', label: 'Keep current position', interventions: {
        pro_plan_price: structuredClone(hold.interventions!.pro_plan_price), ai_feature_availability: { value: 0, source: 'cee_hypothesis' } } });
    } }))!;
    const figs = be.stated?.at_your_figures ?? [];
    expect(figs.find((x) => x.option === 'Keep current position')).toMatchObject({ volume: 300, as_today: true });
    expect(figs.find((x) => x.option === 'Hold £49 with AI release')?.volume).toBe(310);
    const said = breakEvenLine(be);
    expect(said).toContain('At your own figures, with AI feature availability on, ');
    expect(said).toContain('Keep current position gives £14,700/month (300 at £49/month, as today)');
  });

  it('FAIL-CLOSED (AIQ P2): a row that does not set a lever the others set is a disagreement, not "today"', () => {
    const be = breakEvenFor(graph({ fact: FACT, aiToday: 1, change: (ns) => { delete node(ns, 'raise_pro_to_54').interventions!.ai_feature_availability; } }))!;
    expect(be.stated).toEqual({});
  });

  it('CONTRAST (MG M1): two stated counts at one price that disagree are no count — that price is asked again', () => {
    const be = breakEvenFor(graph({ fact: { ...FACT, at: [...FACT.at, at(59, 240)] } }))!;
    expect(be.stated).toEqual({ ask: { at_prices: [59] } });
  });

  it('CONTRAST: a tie at the top names no single leader', () => {
    // £59 × 249.15… is not a count; pick levels that tie with the hold: £59 × 0 < …; £54 × 272.2… → use £14,700 exactly: 49 × 300.
    const be = breakEvenFor(graph({ fact: { ...FACT, at: [at(59, 0), at(54, 0)] }, change: (ns) => { node(ns, 'raise_pro_to_59').interventions!.pro_plan_price = node(ns, 'hold_49_with_ai_release').interventions!.pro_plan_price; } }))!;
    expect(be.stated?.at_your_figures?.filter((x) => x.goal_value === 14_700).length).toBe(2);
    expect(be.stated?.leader).toBeUndefined();
    expect(breakEvenLine(be)).toContain('no single option gives the most MRR: the top ones are equal.');
  });

  it('WRITES NOTHING: the graph is byte-identical after reading it (the churn limit\'s inputs are untouched)', () => {
    const g = graph({ fact: FACT });
    const before = JSON.stringify(g);
    breakEvenLine(breakEvenFor(g)!);
    expect(JSON.stringify(g)).toBe(before);
  });
});
