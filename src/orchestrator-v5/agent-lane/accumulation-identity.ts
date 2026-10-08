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
 *  · the outcome is a quantity in the model and not the goal (the goal keeps its ordinary binary product);
 *  · three DISTINCT inputs, in order [stock, rate, inflow], each a quantity and each a DIRECT parent of the outcome
 *    (ISL validates parents by name);
 *  · the goal's deadline is HELD (`goal_horizon_months`, only where the brief attests it): that is `horizon_months`,
 *    so the stock is never projected to a horizon the user did not state;
 *  · the rate is a percentage PER MONTH (`rate_scale` 0.01, applied by ISL to the LEVEL in user units, never the
 *    framed `observed_state.value`); any other period or unit is refused, never converted;
 *  · today's level of each input is known, the stock and inflow are not negative, and the rate is below 100%;
 *  · the outcome has a positive frame, kept when already present or worked out from the stock and inflow ranges;
 *  · the outcome carries no other identity.
 * `stated_in_brief` is the declaration's own provenance (`explicit`), as for a product. Pure.
 */
import { canonicalLabel } from './model-primitives.js';
import { isPercentScaledUnit } from '../../cee/draft/records/unit-scale-class.js';
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
  readonly observed_state?: { readonly value?: unknown; readonly raw_value?: unknown; readonly unit?: unknown; readonly cap?: unknown } | undefined;
  readonly scale_frame?: unknown;
  readonly nonlinear_identity?: unknown;
  readonly goal_horizon_months?: unknown;
};
type EdgeLike = { readonly from: string; readonly to: string };

export interface AccumulationLoss {
  readonly field_path: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly severity: 'info' | 'warn';
}

const QUANTITY = new Set(['factor', 'outcome', 'risk']);
/** A period other than a month, named in the rate's unit ("% per year", "%/yr", "% annual"). Refused, never converted. */
const OTHER_PERIOD = /\b(year|yr|annual|annum|p\.?a\.?|quarter|week|day|daily|weekly)\b/i;
/** The definitional "% of today" unit (`TODAY_UNIT`) is a level, never a rate. */
const OF_TODAY = /of today/i;

/** Today's level in the user's own unit: the raw figure when the state is framed, else its value. */
function levelOf(n: NodeLike): number | undefined {
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
): { readonly carriers: ReadonlyMap<string, AccumulationCarrier>; readonly loss: readonly AccumulationLoss[] } {
  const carriers = new Map<string, AccumulationCarrier>();
  const loss: AccumulationLoss[] = [];
  const declared = (identities ?? []).filter((d) => d?.operation === 'accumulation');
  if (declared.length === 0) return { carriers, loss };
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
    if (outcome.kind === 'goal') { refuse('the goal itself is never worked out this way; a quantity that feeds it is'); continue; }
    if (!QUANTITY.has(String(outcome.kind))) { refuse(`"${d.outcome}" is not a quantity in the model`); continue; }
    if (outcome.nonlinear_identity !== undefined && outcome.nonlinear_identity !== null || carriers.has(outcome.id)) {
      refuse(`"${d.outcome}" is already worked out another way`); continue;
    }
    if (factors.length !== 3) { refuse('it needs exactly three quantities: the level today, the rate lost each month and the amount added each month'); continue; }
    const inputs = factors.map(resolve);
    const missing = factors.find((_, i) => inputs[i] === undefined);
    if (missing !== undefined) { refuse(`"${missing}" is not in the model`); continue; }
    const [stock, rate, inflow] = inputs as [NodeLike, NodeLike, NodeLike];
    if (new Set([stock.id, rate.id, inflow.id, outcome.id]).size !== 4) { refuse('its quantities are not all different'); continue; }
    const notQuantity = [stock, rate, inflow].find((n) => !QUANTITY.has(String(n.kind)));
    if (notQuantity !== undefined) { refuse(`"${String(notQuantity.label)}" is not a quantity in the model`); continue; }
    const feeds = parents(outcome.id);
    const unlinked = [stock, rate, inflow].find((n) => !feeds.has(n.id));
    if (unlinked !== undefined) { refuse(`"${String(unlinked.label)}" does not feed directly into "${d.outcome}" in the model`); continue; }
    if (typeof horizon !== 'number' || !Number.isInteger(horizon) || horizon < 1 || horizon > 120) {
      refuse('the brief states no deadline to work it out to'); continue;
    }
    const unit = typeof rate.observed_state?.unit === 'string' ? rate.observed_state.unit : undefined;
    // Science 393023 (a): per year is ASKED for per month, never converted ("30% a year" is ambiguous).
    if (unit !== undefined && isPercentScaledUnit(unit) && OTHER_PERIOD.test(unit)) {
      refuse(`"${String(rate.label)}" is given per ${/quarter/i.test(unit) ? 'quarter' : /week/i.test(unit) ? 'week' : /day|daily/i.test(unit) ? 'day' : 'year'}, not per month; give it per month and Olumi can use it`); continue;
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
    carriers.set(outcome.id, {
      operation: 'accumulation',
      factor_ids: [stock.id, rate.id, inflow.id],
      horizon_months: horizon,
      rate_scale: 0.01,
      stated_in_brief: d.provenance === 'explicit',
    });
  }
  return { carriers, loss };
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
