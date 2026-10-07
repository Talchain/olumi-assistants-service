/**
 * S-DEF (Science 393023, DL P0, 7 Oct): a link that holds by definition is never what an option's chance rests on.
 *
 * SERVED Wave B9 T1b Run 1 (guest, CEE df15c8c1 + UI 19e4dd53; `waveB9-t1b-df15c8c-run1-turn002.json`, keys untouched). Its
 * screen said "‘Launch starter tier’: about 52% … It rests most on Olumi’s own estimate of how strongly ‘Starter-tier monthly
 * recurring revenue’ affects ‘monthly recurring revenue’ … How sure are you of that size?". That link is
 * `provenance.definitional: true` (£1 per £1); its strength and existence rows topped the Starter block (spreads 1.0 and 0.64)
 * only because it was drawn as a belief. Twins written by the author are labelled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceDriverOf, withoutDefinitionRows } from '../goal-chance-driver.js';

type Rec = Record<string, any>;
const TURN = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/waveB9-t1b-df15c8c-run1-turn002.json', import.meta.url), 'utf8')) as Rec;
const BLOCK = TURN.blocks.find((b: Rec) => b?.type === 'analysis_result') as Rec;
const GRAPH = TURN.draft_graph as Rec;
const recordOf = (id: string): Rec => BLOCK.enrichment.option_comparison.find((o: Rec) => o.option_id === id);
const IDENTITY = 'starter_tier_monthly_recurring_revenue->monthly_recurring_revenue';
const clone = <T>(v: T): T => structuredClone(v);

describe('S-DEF: the served Starter chance no longer "rests most on" an identity', () => {
  it('PRECONDITION: the served Starter block is topped by the identity link (strength, then existence)', () => {
    const rows = [...recordOf('launch_starter_tier').probability_of_goal_drivers.drivers].sort((a: Rec, b: Rec) => b.spread - a.spread);
    expect(rows.slice(0, 2).map((r: Rec) => [r.kind, r.quantity_id])).toEqual([['link_strength', IDENTITY], ['link_existence', IDENTITY]]);
    const edge = GRAPH.edges.find((e: Rec) => `${e.from}->${e.to}` === IDENTITY);
    expect(edge.provenance).toMatchObject({ definitional: true, source: 'cee_hypothesis' });
  });

  it('RED at base: the identity\'s rows leave the ranking; what is left is below resolution, so Starter claims no driver', () => {
    const claim = goalChanceDriverOf(recordOf('launch_starter_tier'), 'launch_starter_tier', GRAPH, BLOCK);
    expect(JSON.stringify(claim)).not.toContain(IDENTITY);
    expect(claim).toEqual({ no_driver: 'below_resolution' });
    const kept = withoutDefinitionRows(recordOf('launch_starter_tier'), GRAPH).probability_of_goal_drivers.drivers as Rec[];
    expect(kept.some((r) => r.quantity_id === IDENTITY)).toBe(false);
    expect(kept.length).toBe(recordOf('launch_starter_tier').probability_of_goal_drivers.drivers.length - 2);
  });

  it('CONTROL (same Run): Raise prices keeps its own driver, the price link (no definition on its path)', () => {
    const claim = goalChanceDriverOf(recordOf('raise_prices_by_10'), 'raise_prices_by_10', GRAPH, BLOCK) as Rec;
    expect(claim.driver).toMatchObject({ kind: 'link_strength', quantity_id: 'price_rise_from_current_price->monthly_recurring_revenue' });
  });

  it('TWIN (author): the same flag on a part whose label does not hold the total\'s words fails validation → it can be the driver again', () => {
    const graph = clone(GRAPH);
    graph.nodes.find((n: Rec) => n.id === 'starter_tier_monthly_recurring_revenue').label = 'Pipeline value';
    const claim = goalChanceDriverOf(recordOf('launch_starter_tier'), 'launch_starter_tier', graph, BLOCK) as Rec;
    expect(claim.driver).toMatchObject({ kind: 'link_strength', quantity_id: IDENTITY });
  });

  it('a block with no definitional row is returned unchanged (same object)', () => {
    const r = recordOf('raise_prices_by_10');
    expect(withoutDefinitionRows(r, GRAPH)).toBe(r);
  });
});

describe('S-DEF: an existence driver\'s doubt is the user\'s only when the USER\'s own link is held', () => {
  // Author: the served Starter record reduced to ONE existence row on a causal link, with that link's provenance varied.
  const existenceOnly = (from: string, to: string): Rec => {
    const r = clone(recordOf('launch_starter_tier'));
    const row = clone(r.probability_of_goal_drivers.drivers.find((x: Rec) => x.kind === 'link_existence')) as Rec;
    Object.assign(row, { quantity_id: `${from}->${to}`, from, to, spread: 0.5, status: 'resolved' });
    r.probability_of_goal_drivers.drivers = [row];
    return r;
  };
  it('an Olumi link (not held) → olumi; the user\'s own link held by its range → user', () => {
    const edge = GRAPH.edges.find((e: Rec) => e.from === 'price_rise_from_current_price' && e.to === 'customers_lost_from_price_rise');
    // The user's link: their brief stated it with its evidence ("Each 1% price rise loses about 2 customers, between 1 and 4.").
    expect(edge.provenance).toMatchObject({ source: 'brief_extraction', magnitude: 'user_stated', source_quote: expect.stringContaining('between 1 and 4') });
    const user = goalChanceDriverOf(existenceOnly(edge.from, edge.to), 'launch_starter_tier', GRAPH, BLOCK) as Rec;
    expect(user.driver).toMatchObject({ kind: 'link_existence', authored_by: 'user' });
    const olumi = goalChanceDriverOf(existenceOnly('starter_subscribers', 'starter_tier_monthly_recurring_revenue'), 'launch_starter_tier', GRAPH, BLOCK) as Rec;
    expect(olumi.driver).toMatchObject({ kind: 'link_existence', authored_by: 'olumi' });
  });
});
