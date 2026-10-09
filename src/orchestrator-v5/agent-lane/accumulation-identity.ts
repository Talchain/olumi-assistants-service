/**
 * ⭐ ACCUMULATION IDENTITY, ADMITTED (CEE #4; Science goals §(v); contract: programme-docs
 * `design/ACCUMULATION-CARRIER-CONTRACT-20261008.md`).
 *
 * A goal with a deadline ("£20k MRR within 12 months") is about a STOCK at that deadline, and a model with no time
 * dimension can only compare today's levels (#2838: "no option can reach it" was false certainty). The drafter may
 * declare a quantity "‘Pro subscribers at month 12’" as worked out from [the stock today, the churn rate per month, the
 * new subscribers per month]; ISL works it out in closed form (S_T = S₀(1−c)^T + inflow·(1−(1−c)^T)/c).
 *
 * This module is the ONE writer of the `accumulation` carrier. It FAILS CLOSED: a declaration is carried only when every
 * check below holds, and every refusal is said in the ledger, with nothing assumed:
 *  · the outcome is a quantity, or the goal through a derived unary-sum carrier;
 *  · three DISTINCT inputs, in order [stock, rate, inflow], each a quantity and each a DIRECT parent of the outcome
 *    (ISL validates parents by name);
 *  · the goal's deadline is HELD (`goal_horizon_months`, only where the brief attests it): that is `horizon_months`,
 *    so the stock is never projected to a horizon the user did not state;
 *  · the rate is a percentage PER MONTH (`rate_scale` 0.01, applied by ISL to the LEVEL in user units, never the
 *    framed `observed_state.value`); any other period or unit is refused, never converted;
 *  · today's level of each input is known, the stock and inflow are not negative, and the rate is below 100%;
 *  · the outcome has a positive frame, kept when already present or worked out from the stock and inflow ranges;
 *  · the outcome carries no other identity and is a part of the admitted goal product.
 * `stated_in_brief` follows all three input levels, never the drafter's declaration stamp alone. Pure.
 */
import { periodAdverb, periodNoun, type UnitPeriod } from '../../utils/unit-alphabet.js';
import { canonicalLabel } from './model-primitives.js';
import { isPercentScaledUnit } from '../../cee/draft/records/unit-scale-class.js';
import { classifyValueSource, reflectsAHumanAct } from '../../cee/graph-readiness/obligation-provenance.js';
import type { CandidateIdentity } from './admit-model.js';

export interface AccumulationCarrier {
  readonly operation: 'accumulation';
  readonly factor_ids: readonly [string, string, string];
  readonly horizon_months: number;
  readonly rate_scale: number;
  readonly stated_in_brief: boolean;
}

type NodeLike = {
  readonly id: string;
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly category?: unknown;
  readonly observed_state?: { readonly value?: unknown; readonly raw_value?: unknown; readonly unit?: unknown; readonly cap?: unknown; readonly source?: unknown } | undefined;
  readonly scale_frame?: unknown;
  readonly nonlinear_identity?: unknown;
  readonly goal_horizon_months?: unknown;
};
type EdgeLike = { readonly from: string; readonly to: string };
type AuthoredEdge = EdgeLike & {
  readonly strength: { readonly mean: number; readonly std: number };
  readonly exists_probability: 1;
  readonly effect_direction: 'positive';
  readonly provenance: { readonly source: 'cee_hypothesis'; readonly definitional: true };
};
export interface AccumulationAdmission {
  readonly carriers: ReadonlyMap<string, AccumulationCarrier>;
  readonly loss: readonly AccumulationLoss[];
  readonly addedNodes: readonly NodeLike[];
  readonly addedEdges: readonly AuthoredEdge[];
  readonly goalCarriers: ReadonlyMap<string, { readonly carrierId: string; readonly stated: boolean }>;
}
const definitionEdge = (from: string, to: string): AuthoredEdge => ({
  from, to, strength: { mean: 1, std: 0.01 }, exists_probability: 1,
  effect_direction: 'positive', provenance: { source: 'cee_hypothesis', definitional: true },
});

export interface AccumulationLoss {
  readonly field_path: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly severity: 'info' | 'warn';
}

const QUANTITY = new Set(['factor', 'outcome', 'risk']);
/**
 * A period other than a month, named in the rate's unit ("% per year", "%/yr", "% annual"). Refused, never converted.
 * Read through THE ONE UNIT VOCABULARY (`utils/unit-alphabet.ts`), never a private list.
 */
function otherPeriodIn(unit: string): UnitPeriod | null {
  for (const word of unit.toLowerCase().match(/[a-z]+(?:\.[a-z]+)*\.?/g) ?? []) {
    const period = periodNoun(word) ?? periodAdverb(word);
    if (period !== null && period !== 'month') return period;
  }
  return null;
}
/** The definitional "% of today" unit (`TODAY_UNIT`) is a level, never a rate. */
const OF_TODAY = /of today/i;

/** Today's level in the user's own unit: the raw figure when the state is framed, else its value. */
export function levelOf(n: NodeLike): number | undefined {
  const s = n.observed_state;
  const v = typeof s?.raw_value === 'number' ? s.raw_value : s?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function positiveFrame(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** An input's range in user units, never its normalised value when a raw level is present. */
function frameOf(n: NodeLike): number | undefined {
  const frame = positiveFrame(n.observed_state?.cap) ? n.observed_state.cap
    : positiveFrame(n.scale_frame) ? n.scale_frame
      : 2 * (levelOf(n) ?? NaN);
  return Number.isFinite(frame) && frame >= 0 ? Math.ceil(frame) : undefined;
}

/** At zero churn the input ranges allow S₀ + inflow × T; leave twice that room on the derived node. */
function accumulationFrame(outcome: NodeLike, stock: NodeLike, inflow: NodeLike, horizon: number): number | undefined {
  if (positiveFrame(outcome.scale_frame)) return outcome.scale_frame;
  const stockFrame = frameOf(stock);
  const inflowFrame = frameOf(inflow);
  if (stockFrame === undefined || inflowFrame === undefined) return undefined;
  const frame = 2 * (stockFrame + inflowFrame * horizon);
  return positiveFrame(frame) ? frame : undefined;
}

/**
 * The carriers to write and the ledger lines to say. `identities` is the drafter's whole list; only `accumulation`
 * entries are read (products are `markProductIdentities`'s).
 */
export function admitAccumulationIdentities(
  nodes: readonly NodeLike[],
  edges: readonly EdgeLike[],
  identities: readonly CandidateIdentity[] | undefined,
): AccumulationAdmission {
  const carriers = new Map<string, AccumulationCarrier>();
  const loss: AccumulationLoss[] = [];
  const addedNodes: NodeLike[] = [];
  const addedEdges: AuthoredEdge[] = [];
  const goalCarriers = new Map<string, { carrierId: string; stated: boolean }>();
  const declared = (identities ?? []).filter((d) => d?.operation === 'accumulation');
  if (declared.length === 0) return { carriers, loss, addedNodes, addedEdges, goalCarriers };
  const byLabel = new Map<string, NodeLike>();
  for (const n of nodes) if (typeof n.label === 'string' && !byLabel.has(canonicalLabel(n.label))) byLabel.set(canonicalLabel(n.label), n);
  const resolve = (label: unknown): NodeLike | undefined => (typeof label === 'string' ? byLabel.get(canonicalLabel(label)) : undefined);
  const goal = nodes.filter((n) => n.kind === 'goal');
  const horizon = goal.length === 1 ? goal[0]!.goal_horizon_months : undefined;
  const parents = (id: string): Set<string> => new Set(edges.filter((e) => e.to === id).map((e) => e.from));

  for (const d of declared) {
    const factors = Array.isArray(d.factors) ? d.factors : [];
    const outcome = resolve(d.outcome);
    const refuse = (why: string): void => {
      loss.push({
        field_path: `nodes[${outcome?.id ?? String(d.outcome)}].nonlinear_identity_rejected`,
        before: { outcome: d.outcome, operation: d.operation, factors: [...factors] },
        after: null,
        reason: `Olumi read "${d.outcome}" as worked out month by month from ${factors.map((f) => `"${f}"`).join(', ')}, `
          + `but ${why}, so that was not used and nothing about it is assumed.`,
        severity: 'warn',
      });
    };
    if (outcome === undefined) { refuse(`"${d.outcome}" is not in the model`); continue; }
    const goalStock = outcome.kind === 'goal';
    if (goalStock && outcome.nonlinear_identity != null) { refuse('the goal itself is never worked out this way; a quantity that feeds it is'); continue; }
    if (!goalStock && !QUANTITY.has(String(outcome.kind))) { refuse(`"${d.outcome}" is not a quantity in the model`); continue; }
    if (outcome.nonlinear_identity !== undefined && outcome.nonlinear_identity !== null || carriers.has(outcome.id) || goalCarriers.has(outcome.id)) {
      refuse(`"${d.outcome}" is already worked out another way`); continue;
    }
    const net = d.reading === 'net' && factors.length === 2;
    if (factors.length !== 3 && !net) { refuse('it needs exactly three quantities: the level today, the rate lost each month and the amount added each month'); continue; }
    const inputs = factors.map(resolve);
    const missing = factors.find((_, i) => inputs[i] === undefined);
    if (missing !== undefined) { refuse(`"${missing}" is not in the model`); continue; }
    const carrierId = goalStock ? `${outcome.id}_at_month_${horizon}` : outcome.id;
    const zero: NodeLike = { id: `${carrierId}_net_zero_rate`, kind: 'factor', category: 'observable',
      label: 'Share leaving each month (read as a net change)',
      observed_state: { value: 0, raw_value: 0, unit: '%', source: 'cee_inference' }, scale_frame: 100 };
    const [stock, rate, inflow] = (net ? [inputs[0], zero, inputs[1]] : inputs) as [NodeLike, NodeLike, NodeLike];
    if ([carrierId, ...(net ? [zero.id] : [])].some(id => nodes.some(n => n.id === id) && id !== outcome.id)) {
      refuse(`"${d.outcome}" is already worked out another way`); continue;
    }
    if (new Set([stock.id, rate.id, inflow.id, outcome.id]).size !== 4) { refuse('its quantities are not all different'); continue; }
    const notQuantity = [stock, rate, inflow].find((n) => !QUANTITY.has(String(n.kind)));
    if (notQuantity !== undefined) { refuse(`"${String(notQuantity.label)}" is not a quantity in the model`); continue; }
    const feeds = parents(outcome.id);
    const unlinked = [stock, ...(net ? [] : [rate]), inflow].find((n) => !feeds.has(n.id));
    if (unlinked !== undefined) { refuse(`"${String(unlinked.label)}" does not feed directly into "${d.outcome}" in the model`); continue; }
    // ⛔ ISL #231 R-P2-1 (7f, 8 Oct): S₀ is today's count, held exact in every draw. A causal link INTO it would be ranked as
    // a driver while moving nothing (every probe gives the same month-N figure). Only an option may set it.
    const moverOfToday = [...parents(stock.id)].map((id) => nodes.find((n) => n.id === id))
      .find((n) => n !== undefined && n.kind !== 'option' && n.kind !== 'decision');
    if (moverOfToday !== undefined) {
      refuse(`the count today, "${String(stock.label)}", is changed by "${String(moverOfToday.label)}" in the model`); continue;
    }
    if (typeof horizon !== 'number' || !Number.isInteger(horizon) || horizon < 1 || horizon > 120) {
      refuse('the brief states no deadline to work it out to'); continue;
    }
    const unit = typeof rate.observed_state?.unit === 'string' ? rate.observed_state.unit : undefined;
    // Science 393023 (a): per year is ASKED for per month, never converted ("30% a year" is ambiguous).
    const otherPeriod = unit !== undefined && isPercentScaledUnit(unit) ? otherPeriodIn(unit) : null;
    if (otherPeriod !== null) {
      refuse(`"${String(rate.label)}" is given per ${otherPeriod}, not per month; give it per month and Olumi can use it`); continue;
    }
    if (unit === undefined || !isPercentScaledUnit(unit) || OF_TODAY.test(unit)) {
      refuse(`"${String(rate.label)}" is not stated as a percentage per month`); continue;
    }
    const s0 = levelOf(stock);
    const c = levelOf(rate);
    const add = levelOf(inflow);
    const unknown = [[stock, s0], [rate, c], [inflow, add]].find(([, v]) => v === undefined);
    if (unknown !== undefined) { refuse(`today's level of "${String((unknown[0] as NodeLike).label)}" is not known`); continue; }
    if ((s0 as number) < 0 || (add as number) < 0 || (c as number) < 0 || (c as number) >= 100) {
      refuse('its levels today are outside what a count, a monthly rate and a monthly amount can be'); continue;
    }
    if (accumulationFrame(outcome, stock, inflow, horizon) === undefined) {
      refuse('its range could not be worked out'); continue;
    }
    // A plain causal link to the goal does not use this calculation. Only its admitted product does.
    const goalProduct = goal.length === 1 ? goal[0]!.nonlinear_identity : undefined;
    if (!goalStock && (goalProduct === null || typeof goalProduct !== 'object'
      || (goalProduct as { operation?: unknown }).operation !== 'product'
      || !Array.isArray((goalProduct as { factor_ids?: unknown }).factor_ids)
      || !(goalProduct as { factor_ids: unknown[] }).factor_ids.includes(outcome.id))) {
      refuse('nothing in the model works the goal out from it'); continue;
    }
    if (goalStock) {
      addedNodes.push({ id: carrierId, kind: 'outcome', label: `${outcome.label} at month ${horizon}`,
        scale_frame: accumulationFrame(outcome, stock, inflow, horizon) });
      addedEdges.push(definitionEdge(carrierId, outcome.id));
      goalCarriers.set(outcome.id, { carrierId, stated: d.provenance === 'explicit' });
    }
    if (net) { addedNodes.push(zero); addedEdges.push(definitionEdge(zero.id, carrierId)); }
    carriers.set(carrierId, {
      operation: 'accumulation',
      factor_ids: [stock.id, rate.id, inflow.id],
      horizon_months: horizon,
      rate_scale: 0.01,
      stated_in_brief: [stock, rate, inflow].every((n) => reflectsAHumanAct(classifyValueSource(n.observed_state?.source))),
    });
  }
  return { carriers, loss, addedNodes, addedEdges, goalCarriers };
}

/** The nodes with each admitted carrier written on its outcome. Byte-identical when there is none. */
export function withAccumulationCarriers<N extends NodeLike>(
  nodes: readonly N[],
  carriers: ReadonlyMap<string, AccumulationCarrier>,
): N[] {
  if (carriers.size === 0) return [...nodes];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    const carrier = carriers.get(n.id);
    if (carrier === undefined) return n;
    const stock = byId.get(carrier.factor_ids[0]);
    const inflow = byId.get(carrier.factor_ids[2]);
    if (stock === undefined || inflow === undefined) return n;
    const frame = accumulationFrame(n, stock, inflow, carrier.horizon_months);
    return frame === undefined ? n : {
      ...n,
      scale_frame: frame,
      nonlinear_identity: { ...carrier, factor_ids: [...carrier.factor_ids] },
    };
  });
}

/** Apply the one writer's admitted nodes and definitions; ordinary post-horizon effects stay on the goal. */
export function withAdmittedAccumulations<N extends NodeLike, E extends EdgeLike>(
  nodes: readonly N[], edges: readonly E[], admission: AccumulationAdmission,
): { nodes: N[]; edges: (E | AuthoredEdge)[] } {
  const written = withAccumulationCarriers([...nodes, ...admission.addedNodes] as N[], admission.carriers);
  return {
    nodes: written.map(n => {
      const goal = admission.goalCarriers.get(n.id);
      if (goal === undefined) return n;
      const { observed_state: _today, ...derived } = n;
      return { ...derived, nonlinear_identity: { operation: 'sum', factor_ids: [goal.carrierId],
        stated_in_brief: goal.stated } } as N;
    }),
    edges: [...edges.map(e => {
      const goal = admission.goalCarriers.get(e.to);
      return goal !== undefined && admission.carriers.get(goal.carrierId)?.factor_ids.includes(e.from)
        ? { ...e, to: goal.carrierId } : e;
    }), ...admission.addedEdges],
  };
}

export interface AccumulationOptionScope {
  readonly graph_hash: string;
  readonly carrier_id: string;
  readonly horizon_months: number;
  readonly sameForEveryOption: boolean;
}

/** D5: only the final submitted interventions count; follow every causal parent of the two rates. */
export function accumulationOptionScopes(
  nodes: readonly NodeLike[], edges: readonly EdgeLike[],
  options: readonly { readonly interventions?: unknown }[], graphHash: string,
): AccumulationOptionScope[] {
  const interventions = new Set(options.flatMap(option => option.interventions !== null
    && typeof option.interventions === 'object' ? Object.keys(option.interventions) : []));
  return nodes.flatMap(node => {
    const identity = node.nonlinear_identity as AccumulationCarrier | undefined;
    if (identity?.operation !== 'accumulation') return [];
    const parents = new Set<string>([identity.factor_ids[1], identity.factor_ids[2]]);
    for (const id of parents) for (const edge of edges) if (edge.to === id) parents.add(edge.from);
    return [{ graph_hash: graphHash, carrier_id: node.id, horizon_months: identity.horizon_months,
      sameForEveryOption: ![...interventions].some(id => parents.has(id)) }];
  });
}
