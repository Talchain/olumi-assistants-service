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
  ({ form, estimate_by: null, value, sd: null, low: null, high: null, unit: '£', sign });

const RISK_WORDS = 'a 5–15% chance our key supplier fails within 12 months; dual-sourcing would cut that by 70%';

export const supplier = (form: 'point' | 'exact'): LivingModelT => ({
  aims: [{ id: 'gp', text: 'Monthly gross profit of at least £12,000', status: 'current', defined_as: null, ...who('we need at least £12k a month; today it is £16k'),
    target: { quantity: 'monthly gross profit', comparator: '>=', value: 12000, low: null, high: null, unit: '£', by_when: null, period_months: null, period_by: null, period_read_on: null, baseline: 'today',
      current: 16000, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [
    { status: 'feasible', id: 'status_quo', label: 'Carry on', settings: [], developed_from: null, ...who('or we carry on as now') },
    { status: 'feasible', id: 'dual_source', label: 'Dual-source', developed_from: null, ...who('dual-source the part'),
      settings: [{ estimate_by: null, factor_id: 'dual_sourcing', value: 1, low: null, high: null, unit: null, ...who('dual-source the part') }] },
  ],
  factors: [{ estimate_by: null, kind: 'factor', limit: null, id: 'dual_sourcing', label: 'Dual sourcing in place', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('we single-source today') }],
  risks: [{ id: 'supplier_fails', label: 'Key supplier fails', occurrence: { estimate_by: null, low: 0.05, high: 0.15 }, horizon_months: 12, horizon_by: null,
    mitigations: [{ factor_id: 'dual_sourcing', reduction: 0.7, ...who('dual-sourcing would cut that by 70%') }], ...who(RISK_WORDS) }],
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
/** The person's risk with Olumi's proposed step: the 70% is Olumi's estimate, never the person's (codex integration review). */
export const OLUMI_MITIGATION = withRisk({ mitigations: [{ ...risk.mitigations[0]!, source: 'olumi', quote: null }] });
/** A reduction in words nobody can find: no one's yet, so the link carries no author. */
export const UNVERIFIED_MITIGATION = withRisk({ mitigations: [{ ...risk.mitigations[0]!, source: 'unverified' }] });
/** NEGATIVE: no chance stated is never guessed; nor is a window. */
export const NO_CHANCE = withRisk({ occurrence: { low: null, high: null } });
export const NO_WINDOW = withRisk({ horizon_months: null });
/** NEGATIVE: whose figure is it? Unverified words are no one's: the chance is withheld, never made Olumi's or the person's. */
export const UNATTRIBUTED = withRisk({ source: 'unverified' });
/** NEGATIVE (§9: no shared-cause cascades): a cause INTO the event is not in this slice. */
export const CASCADE: LivingModelT = { ...supplier('point'),
  factors: [...supplier('point').factors, { estimate_by: null, kind: 'factor', limit: null, id: 'demand', label: 'Demand', value: 1, low: null, high: null, unit: null, defined_as: null, ...who('demand is high') }],
  links: [...supplier('point').links, { id: 'demand_fails', from: 'demand', to: 'supplier_fails', ...who('high demand strains the supplier'),
    effect: { estimate_by: null, form: 'point', value: 0.1, sd: null, low: null, high: null, unit: null, sign: '+' } }] };
/** NEGATIVE: a mitigation must be a 0/1 step an option switches on; a half-measure level is not in this slice. */
export const HALF_MITIGATION: LivingModelT = { ...supplier('point'),
  options: [supplier('point').options[0]!, { ...supplier('point').options[1]!,
    settings: [{ estimate_by: null, factor_id: 'dual_sourcing', value: 0.5, low: null, high: null, unit: null, ...who('half dual-source') }] }] };

/**
 * The served re-run's shape (CEE 997f7a15, 21 Oct): the £1k cost said of the mitigation itself ("dual-sourcing … costs £1k a
 * month"), not of the option. ISL's preventer is a switch for its risk only, so the cost reaches the engine through the option.
 */
const costOnSwitch = (m: LivingModelT): LivingModelT => ({ ...m, links: m.links.map((l) => (l.id === 'cost_gp' ? { ...l, from: 'dual_sourcing' } : l)) });
export const COSTED_SWITCH = costOnSwitch(supplier('point'));
/** CONTROL: the same cost on a switch that is not a clean 0/1 step keeps its link, and its risk is refused by name. */
export const COSTED_HALF_SWITCH = costOnSwitch(HALF_MITIGATION);
/** CONTROL: already in place today, its cost is paid under carrying on too, so it is never moved onto the option alone. */
export const COSTED_SWITCH_IN_PLACE: LivingModelT = { ...COSTED_SWITCH, factors: [{ ...COSTED_SWITCH.factors[0]!, value: 1 }] };
/**
 * NEGATIVE (codex r1): two options switch the same costed mitigation on. Said per option, the one cost would be drawn
 * separately for each, changing their comparison, so the switch keeps its link and its risk is refused by name.
 */
export const COSTED_SWITCH_TWO_OPTIONS: LivingModelT = { ...COSTED_SWITCH,
  options: [...COSTED_SWITCH.options, { ...COSTED_SWITCH.options[1]!, id: 'dual_source_fast', label: 'Dual-source this month' }] };

/** NEGATIVE (buddy r1): one switch preventing two risks has two children; ISL refuses that preventer, so CEE does first. */
export const SHARED_PREVENTER: LivingModelT = { ...supplier('point'),
  risks: [...supplier('point').risks, { ...risk, id: 'port_strike', label: 'Port strike', occurrence: { estimate_by: null, low: 0.02, high: 0.04 } }],
  links: [...supplier('point').links, { id: 'strike_gp', from: 'port_strike', to: 'gp', ...who('a strike costs £2k a month'),
    effect: { estimate_by: null, form: 'point', value: 2000, sd: null, low: null, high: null, unit: '£', sign: '-' } }] };
/** NEGATIVE (buddy r1): a switch in % would reach the engine "in place" at 0.01, not 1: refused. */
export const PERCENT_PREVENTER: LivingModelT = { ...supplier('point'),
  factors: [{ ...supplier('point').factors[0]!, unit: '%' }],
  options: [supplier('point').options[0]!, { ...supplier('point').options[1]!,
    settings: [{ estimate_by: null, factor_id: 'dual_sourcing', value: 1, low: null, high: null, unit: '%', ...who('dual-source the part') }] }] };
/** NEGATIVE (served F2, CEE f51249ba): any unit says a quantity, even one whose frame happens to be 1, so the switch is refused. */
export const UNIT_TEXT_PREVENTER: LivingModelT = { ...supplier('point'),
  factors: [{ ...supplier('point').factors[0]!, unit: '0 = not in place; 1 = in place' }] };
