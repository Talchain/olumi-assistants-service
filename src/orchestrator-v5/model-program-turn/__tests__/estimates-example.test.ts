/**
 * THE DRAFTER'S WORKED EXAMPLE, AS A MODEL (r10, Paul 28 Oct: "Olumi can make assumptions and even make educated guesses on
 * data … clearly visible if Olumi has produced the assumption or data, and … the level of uncertainty"). The bakery sketch
 * in `prompt.ts` DRAFTING_INSTRUCTIONS, record for record: every figure the calculation needs is the person's or Olumi's
 * ranged estimate, the outcome is arithmetic all the way to each aim and limit, and their own threshold stays asked. If the
 * example the drafter copies cannot calculate, no draft that copies it will; this row proves it does, by hand.
 */
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { HOST_OWNED_FIELDS, type CanonicalModelT } from '../../model-program/canonical.js';
import { compile } from '../../model-program/compile.js';
import { project } from '../../model-program/project.js';
import { simulate } from '../../model-program/simulate/simulate.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS } from '../prompt.js';
import { BRIEF, example } from './estimates-example.fixture.js';

const goalOf = (m: CanonicalModelT, id: string) => compile(m).perGoal.find((g) => g.goal_id === id)!;
const chances = (m: CanonicalModelT) => {
  const sim = simulate(compile(m).executable!, { seed: 7, draws: 8000 });
  return Object.fromEntries(sim.options.map((o) => [o.option_id, {
    sell_500: (o.per_goal.find((g) => g.goal_id === 'sell_500') as { chance: number }).chance,
    in_budget: (o.per_limit.find((l) => l.limit_id === 'in_budget') as { chance: number }).chance,
  }]));
};

describe('r10: the worked example the drafter copies calculates on Olumi\'s labelled estimates', () => {
  it('is the sketch in DRAFTING_INSTRUCTIONS (its brief and its Olumi estimates, word for word)', () => {
    expect(DRAFTING_INSTRUCTIONS).toContain(`Example: "${BRIEF}"`);
    for (const s of ['hours_capacity loaf/week fact estimated 40 (20–80)', 'sell_share 1 coefficient estimated 0.7 (0.4–0.95)', 'oven_price GBP fact estimated 4000 (2000–9000)',
      'chance estimated 0.15 (0.05–0.3)', 'size estimated 0.8 (0.6–0.95)', 'grow_target loaf/week fact asked', 'sets [added_capacity to extra_capacity, spend to oven_price]',
      'sets [added_capacity to hours_capacity]', 'spend <= budget']) expect(DRAFTING_INSTRUCTIONS).toContain(s);
  });

  it('is a valid draft, and compiles with no errors: the sales aim and the budget calculate, every option is compared, and only their own growth threshold is asked', () => {
    const m = example();
    // What the drafter writes: the host's fields (history, approval, approved_by, author_id) are never in its schema.
    const host = new Set<string>([...HOST_OWNED_FIELDS, 'history']);
    const drafted = JSON.parse(JSON.stringify(m), (k, v) => (host.has(k) ? undefined : v));
    expect(new Ajv({ strict: false }).validate(CANONICAL_JSON_SCHEMA, drafted)).toBe(true);
    const c = compile(m);
    expect(c.errors).toEqual([]);
    expect([goalOf(m, 'sell_500').status, goalOf(m, 'sell_500').reasons]).toEqual(['calculable', []]);
    expect([goalOf(m, 'grow').status, goalOf(m, 'grow').asks]).toEqual(['asks', ['grow_target']]);
    expect(c.perLimit.map((l) => [l.limit_id, l.status])).toEqual([['in_budget', 'calculable']]);
    expect(c.perOption.map((o) => [o.option_id, o.status])).toEqual([['second_oven', 'calculable'], ['longer_hours', 'calculable'], ['carry_on', 'calculable']]);
    // What the sales chance rests on that is Olumi's is named, so the card can say so (what an option sets is on its card).
    expect(goalOf(m, 'sell_500').olumi_inputs).toEqual(['sell_share', 'rival_kept', 'rival_chance', 'added_capacity', 'sales_rel', 'extra_sales_rel']);
  });

  it('the chances, by hand: an Olumi range is read as 8 in 10 inside it, split at its most likely figure (range-law.ts rule 1)', () => {
    // Φ⁻¹(0.9) = 1.28155. Second oven sells 400 + 150 × share ≥ 500 when share ≥ 2/3. Below 0.7 the half has σL = 0.3/1.28155
    // = 0.23409, so P(share < 2/3) = ½ · P(|Z| > 0.03333/0.23409 = 0.1424) = ½ · 0.88676 = 0.4434 (the floor at 0 is |Z| 2.99
    // away: 0.0003 of it), so 0.557. Budget: the oven ≤ £5,000; above £4,000 σH = 5000/1.28155 = 3901.6, P(|Z| ≤ 0.2563) =
    // 0.2023, so ½ + ½ · 0.2023 = 0.601. Carrying on sells exactly 400 and spends 0; longer hours reach 500 only in both tails.
    const p = chances(example(false));
    expect(p['second_oven']!.sell_500).toBeGreaterThan(0.537);
    expect(p['second_oven']!.sell_500).toBeLessThan(0.577);
    expect(p['second_oven']!.in_budget).toBeGreaterThan(0.581);
    expect(p['second_oven']!.in_budget).toBeLessThan(0.621);
    expect(p['carry_on']).toEqual({ sell_500: 0, in_budget: 1 });
    expect(p['longer_hours']!.sell_500).toBeLessThan(0.03);
    expect(p['longer_hours']!.in_budget).toBe(1);
    // Olumi's sized risk only lowers the second oven's chance of 500 (a rival opening takes some of the new sales).
    const r = chances(example(true));
    expect(r['second_oven']!.sell_500).toBeLessThan(p['second_oven']!.sell_500);
    expect(r['second_oven']!.sell_500).toBeGreaterThan(0.45);
  });

  it('every Olumi estimate shows as Olumi\'s, with its range, on the card: never as the person\'s', () => {
    const m = example();
    const nodes = project(m, compile(m), { brief: BRIEF }).graph.nodes as Array<Record<string, unknown>>;
    const node = (id: string) => nodes.find((x) => x['id'] === id) as Record<string, unknown>;
    // A figure the calculation reads is its own card; what an option sets is on the option's card (Q1).
    const shown = [JSON.stringify(node('sell_share')),
      JSON.stringify((node('second_oven')['interventions'] as Record<string, unknown>)['spend']),
      JSON.stringify((node('longer_hours')['interventions'] as Record<string, unknown>)['added_capacity'])];
    for (const s of shown) expect(s).toMatch(/0\.4–0\.95|2,000–9,000|20–80/);
    for (const s of shown) expect(s).toMatch(/Olumi's estimate/);
    expect(JSON.stringify((node('second_oven')['interventions'] as Record<string, unknown>)['added_capacity'])).toMatch(/from your brief/);
  });
});
