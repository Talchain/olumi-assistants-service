import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

/**
 * Hotfix 23 Oct (staging 50f76df0): the AI's strict tool schema sends null for every unstated field, so B2a's
 * `reference === null || period_kind === null` held every goal (`goal_scope_unknown`). The origin and observation period
 * matter only for a target with a time to place; a static level target keeps its chance, a windowed one stays held.
 */
type Rec = Record<string, any>;
const scopeHolds = (m: LivingModelT, id: string) => mapLivingModel(m).withheld.filter((w) => w.id === id && w.reason === 'goal_scope_unknown');
// The served capacity draft on 50f76df0 (paul-briefs nb r1, t1 brief read), its living model byte for byte.
const capacity = () => LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/capacity-50f76df0-living-model.json', import.meta.url), 'utf8')));
const CAPACITY_AIM = 'weekly_support_capacity';

describe('an unstated origin or period holds only a target that has a time to place', () => {
  it('(a) the real served capacity draft, a static level target with null scope, is not held for its scope', () => {
    const m = capacity();
    const t = m.aims.find((a) => a.id === CAPACITY_AIM)!.target!;
    // The draft really carries the strict schema's nulls on a static >= 100 target, with no window, period or change.
    expect(t).toMatchObject({ comparator: '>=', value: 100, reference: null, period_kind: null, period_months: null,
      by_when: null, change_kind: null, period_by: null });
    expect(scopeHolds(m, CAPACITY_AIM)).toEqual([]);
  });

  it('(a) a static level target with null scope keeps its chance, exactly as with the scope fields absent', () => {
    const nulls = structuredClone(KNOWN_ANSWER);
    Object.assign(nulls.aims[0]!.target!, { reference: null, period_kind: null });
    const out = mapLivingModel(nulls), goal = (out.graph.nodes as Rec[]).find((n) => n.id === 'g')!;
    expect(out.withheld.filter((w) => w.id === 'g')).toEqual([]);
    expect(goal).toMatchObject({ goal_threshold_raw: 100, goal_direction: '>=' });
    expect(out).toEqual(mapLivingModel(KNOWN_ANSWER));
  });

  it('(b) a launch window, a change or an accumulation with an unstated origin or period stays held, never read as today', () => {
    const launch = structuredClone(KNOWN_ANSWER);
    Object.assign(launch.aims[0]!.target!, { period_months: 3, by_when: 'in the first three months after launch', reference: null, period_kind: 'over_period' });
    expect(scopeHolds(launch, 'g')).toEqual([{ id: 'g', reason: 'goal_scope_unknown' }]);
    expect((mapLivingModel(launch).graph.nodes as Rec[]).find((n) => n.id === 'g')).not.toHaveProperty('goal_target_basis');

    const wordsOnly = structuredClone(KNOWN_ANSWER);
    Object.assign(wordsOnly.aims[0]!.target!, { by_when: 'within three months of launch', reference: null, period_kind: null });
    expect(scopeHolds(wordsOnly, 'g')).toEqual([{ id: 'g', reason: 'goal_scope_unknown' }]);

    const change = structuredClone(KNOWN_ANSWER);
    Object.assign(change.aims[0]!.target!, { comparator: 'increase', value: 10, change_kind: 'absolute', reference: 'today', period_kind: null });
    expect(scopeHolds(change, 'g')).toEqual([{ id: 'g', reason: 'goal_scope_unknown' }]);

    const stock = structuredClone(KNOWN_ANSWER);
    const own = { source: 'olumi' as const, party: null, quote: null };
    const f = (id: string, value: number | null, unit: string) => ({ ...stock.factors[0]!, ...own, id, label: id, value, unit });
    stock.factors.push(f('stock', 1000, 'customers'), f('loss', 3, '% per month'), f('inflow', 100, 'customers per month'),
      f('price', 50, '£ per customer per month'), { ...f('future', null, 'customers'), kind: 'outcome',
        accumulation: { stock_today: 'stock', loss_rate_per_month: 'loss', inflow_per_month: 'inflow', horizon_months: 6, ...own } });
    stock.aims[0]!.defined_as = { op: 'product', of: ['future', 'price'], ...own };
    Object.assign(stock.aims[0]!.target!, { reference: null, period_kind: null });
    expect(scopeHolds(stock, 'g')).toEqual([{ id: 'g', reason: 'goal_scope_unknown' }]);
  });

  it('(c) the real capacity draft with its scope fields absent maps identically to (a)', () => {
    const absent = capacity();
    const t = absent.aims.find((a) => a.id === CAPACITY_AIM)!.target! as Rec;
    delete t.reference; delete t.period_kind;
    expect(t).not.toHaveProperty('reference');
    expect(mapLivingModel(absent)).toEqual(mapLivingModel(capacity()));
  });
});
