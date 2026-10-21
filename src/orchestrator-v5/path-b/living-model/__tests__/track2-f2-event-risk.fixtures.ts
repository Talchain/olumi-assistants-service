import type { LivingModelT } from '../../../../schemas/living-model.js';

/**
 * TRACK 2 F2 (21 Oct 2026): ISL #228's known answer, stated as a person would state it on the core living model.
 * "Gross profit is £16k a month; we need at least £12k. There's a 5–15% chance our key supplier fails within 12 months;
 * if it does we lose £8k a month. Dual-sourcing cuts that chance by 70% and costs £1k a month."
 *
 * Analytic (P(fails) = E[p] = 0.10, mitigated 0.03; ISL `test_event_risk_v1.py`):
 *  · stated EXACTLY (severity and cost): status quo P(≥ £12k) 0.900, mean £15,200; Dual-source 0.970, mean £14,760;
 *  · stated as POINTS (the core convention: Olumi's illustrative σ = |β|/2 on each, D3): severity S ~ N(8, 4) £k,
 *    cost C ~ N(1, 0.5) £k. Status quo 0.9 + 0.1·Φ((4 − 8)/4) = 0.9 + 0.1·0.1587 = 0.9159; Dual-source
 *    0.97 + 0.03·Φ((4 − 9)/√16.25) = 0.97 + 0.03·0.1075 = 0.9732. The means are unchanged.
 */
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const pointOrExact = (form: 'point' | 'exact', value: number, sign: '+' | '-') =>
  ({ form, value, sd: null, low: null, high: null, unit: '£', sign });

const RISK_WORDS = 'a 5–15% chance our key supplier fails within 12 months; dual-sourcing would cut that by 70%';

export const supplier = (form: 'point' | 'exact'): LivingModelT => ({
  aims: [{ id: 'gp', text: 'Monthly gross profit of at least £12,000', status: 'current', ...who('we need at least £12k a month; today it is £16k'),
    target: { quantity: 'monthly gross profit', comparator: '>=', value: 12000, low: null, high: null, unit: '£', by_when: null, baseline: 'today',
      current: 16000, current_source: null, current_unit: null, change_kind: null } }],
  options: [
    { id: 'status_quo', label: 'Carry on', settings: [], ...who('or we carry on as now') },
    { id: 'dual_source', label: 'Dual-source', ...who('dual-source the part'),
      settings: [{ factor_id: 'dual_sourcing', value: 1, low: null, high: null, unit: null, ...who('dual-source the part') }] },
  ],
  factors: [{ id: 'dual_sourcing', label: 'Dual sourcing in place', value: 0, low: null, high: null, unit: null, ...who('we single-source today') }],
  risks: [{ id: 'supplier_fails', label: 'Key supplier fails', occurrence: { low: 0.05, high: 0.15 }, horizon_months: 12,
    mitigations: [{ factor_id: 'dual_sourcing', reduction: 0.7 }], ...who(RISK_WORDS) }],
  links: [
    { id: 'fails_gp', from: 'supplier_fails', to: 'gp', ...who('if it does we lose £8k a month'), effect: pointOrExact(form, 8000, '-') },
    { id: 'cost_gp', from: 'dual_source', to: 'gp', ...who('it costs £1k a month'), effect: pointOrExact(form, 1000, '-') },
  ],
  conditions: [], views: [], history: [],
});

const risk = supplier('point').risks[0]!;
const withRisk = (patch: Record<string, unknown>): LivingModelT => ({ ...supplier('point'), risks: [{ ...risk, ...patch }] });

/** Certain within the window (p = 1) is still an event ISL evaluates (its c1 control): sent, never refused (buddy r1). */
export const CERTAIN_WITHIN_WINDOW = withRisk({ occurrence: { low: 1, high: 1 } });
/** §3C: a chance nobody stated but Olumi gave is sent as Olumi's (basis olumi), so the result is labelled provisional. */
export const OLUMI_CHANCE = withRisk({ source: 'olumi', quote: null });
/** NEGATIVE: no chance stated is never guessed; nor is a window. */
export const NO_CHANCE = withRisk({ occurrence: { low: null, high: null } });
export const NO_WINDOW = withRisk({ horizon_months: null });
/** NEGATIVE: whose figure is it? Unverified words are no one's: the chance is withheld, never made Olumi's or the person's. */
export const UNATTRIBUTED = withRisk({ source: 'unverified' });
/** NEGATIVE (§9: no shared-cause cascades): a cause INTO the event is not in this slice. */
export const CASCADE: LivingModelT = { ...supplier('point'),
  factors: [...supplier('point').factors, { id: 'demand', label: 'Demand', value: 1, low: null, high: null, unit: null, ...who('demand is high') }],
  links: [...supplier('point').links, { id: 'demand_fails', from: 'demand', to: 'supplier_fails', ...who('high demand strains the supplier'),
    effect: { form: 'point', value: 0.1, sd: null, low: null, high: null, unit: null, sign: '+' } }] };
/** NEGATIVE: a mitigation must be a 0/1 step an option switches on; a half-measure level is not in this slice. */
export const HALF_MITIGATION: LivingModelT = { ...supplier('point'),
  options: [supplier('point').options[0]!, { ...supplier('point').options[1]!,
    settings: [{ factor_id: 'dual_sourcing', value: 0.5, low: null, high: null, unit: null, ...who('half dual-source') }] }] };

/** NEGATIVE (buddy r1): one switch preventing two risks has two children; ISL refuses that preventer, so CEE does first. */
export const SHARED_PREVENTER: LivingModelT = { ...supplier('point'),
  risks: [...supplier('point').risks, { ...risk, id: 'port_strike', label: 'Port strike', occurrence: { low: 0.02, high: 0.04 } }],
  links: [...supplier('point').links, { id: 'strike_gp', from: 'port_strike', to: 'gp', ...who('a strike costs £2k a month'),
    effect: { form: 'point', value: 2000, sd: null, low: null, high: null, unit: '£', sign: '-' } }] };
/** NEGATIVE (buddy r1): a switch in % would reach the engine "in place" at 0.01, not 1: refused. */
export const PERCENT_PREVENTER: LivingModelT = { ...supplier('point'),
  factors: [{ ...supplier('point').factors[0]!, unit: '%' }],
  options: [supplier('point').options[0]!, { ...supplier('point').options[1]!,
    settings: [{ factor_id: 'dual_sourcing', value: 1, low: null, high: null, unit: '%', ...who('dual-source the part') }] }] };
