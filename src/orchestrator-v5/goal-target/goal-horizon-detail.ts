/** Science §(o′)/(ad): exact horizon detail, populated only by typed graph facts. */
import { GOAL_HORIZON_STEADY_ATTESTED, heldGoalDeadline, heldGoalHorizonMonths } from './goal-horizon-verdict.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { readGoalRecord } from './goal-record.js';
import { accumulationOptionScopes } from '../agent-lane/accumulation-identity.js';
import { readUnitParts } from '../agent-lane/same-unit.js';
import { sayFigureAsWritten } from '../agent-lane/say-figure.js';
import { sayDate } from './deadline-date.js';
import { isPercentScaledUnit } from '../../cee/draft/records/projector.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { timeClassOf, unsupportedTimeSentence } from './time-class.js';

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Rec : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function horizonGoal(graph: unknown): { goal: Rec; nodes: Rec[]; month: number | undefined; deadline: string | undefined } | undefined {
  const rawNodes = rec(graph)?.nodes;
  const nodes = Array.isArray(rawNodes) ? rawNodes.map(rec).filter((node): node is Rec => node !== undefined) : [];
  const goals = nodes.filter(node => node.kind === 'goal');
  const month = heldGoalHorizonMonths(goals[0]);
  const deadline = heldGoalDeadline(goals[0]);
  return goals.length === 1 && (month !== undefined || deadline !== undefined)
    ? { goal: goals[0]!, nodes, month, deadline } : undefined;
}

/**
 * The carrier's positional operands are [count today, leave share per month, additions per month]. No label or unit
 * text assigns a role. Without that typed carrier, the factual opening stands alone rather than guessing missing slots.
 */
export function goalHorizonWithholdDetail(graph: unknown, brief?: string | null): string | null {
  const held = horizonGoal(graph);
  if (held === undefined) return null;
  const { goal, nodes, month, deadline } = held;
  if (month === undefined) return `Your goal is for ${sayDate(deadline!)}, and this model only has today's numbers.`;
  // A timing shape the brief states and the product cannot yet model (`time-class.ts`): said in the user's own phrase, instead of
  // the generic opening. Only words change; what is withheld is decided by the verdict, never by this text.
  const unsupported = timeClassOf(brief).shapes[0];
  if (unsupported !== undefined) return unsupportedTimeSentence(unsupported, month);
  const opening = `Your goal is for month ${month}, and this model only has today's numbers.`;
  const product = NodeV3.shape.nonlinear_identity.safeParse(goal.nonlinear_identity).data;
  if (product?.operation !== 'product' || !Array.isArray(product.factor_ids)) return opening;
  const carriers = product.factor_ids.flatMap(id => {
    const node = nodes.find(candidate => candidate.id === id);
    const identity = NodeV3.shape.nonlinear_identity.safeParse(node?.nonlinear_identity).data;
    return identity?.operation === 'accumulation' && identity.horizon_months === month
      && Array.isArray(identity.factor_ids) && identity.factor_ids.length === 3
      && identity.factor_ids.every(id => typeof id === 'string' && id !== '')
      && new Set(identity.factor_ids).size === 3 ? [{ identity }] : [];
  });
  if (carriers.length !== 1) return opening;
  const ids = carriers[0]!.identity.factor_ids as string[];
  const stock = nodes.find(node => node.id === ids[0]);
  if (typeof stock?.label !== 'string' || stock.label.trim() === '') return opening;
  const missing = (index: number): boolean => {
    const state = rec(nodes.find(node => node.id === ids[index])?.observed_state);
    // The accumulation input reader gives a present raw number authority over the framed value.
    return !finite(typeof state?.raw_value === 'number' ? state.raw_value : state?.value);
  };
  const slots = [
    ...(missing(2) ? ['how many sign up each month'] : []),
    ...(missing(1) ? ['what share leave each month'] : []),
    ...(missing(0) ? ['how many there are today'] : []),
  ];
  return slots.length === 0 ? opening
    : `${opening} To work out month ${month}, Olumi needs how ‘${stock.label.trim()}’ changes each month: ${slots.join(' / ')}.`;
}

/** User attestation is licensed by goalHorizonVerdict; this helper owns its verbatim Why? sentence. */
export function goalHorizonSteadyWhyLine(graph: unknown): string | null {
  const held = horizonGoal(graph);
  if (held === undefined || held.month === undefined || typeof held.goal.label !== 'string' || held.goal.label.trim() === '') return null;
  return `You said ‘${held.goal.label.trim()}’ stays about where it is over ${held.month} months unless you act, so this is its chance once each option is in effect.`;
}

/** The slice-A unary goal's typed carrier; product carriers never enter this reader. */
export function goalStockAccumulationOf(graph: unknown) {
  const raw = rec(graph);
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes.map(rec).filter((n): n is Rec => n !== undefined) : [];
  const goals = nodes.filter(n => n.kind === 'goal');
  if (goals.length !== 1 || typeof goals[0]!.id !== 'string') return null;
  const goal = goals[0]!;
  const held = readGoalRecord(graph, String(goal.id));
  const month = held?.horizon?.months;
  const identity = NodeV3.shape.nonlinear_identity.safeParse(goal.nonlinear_identity).data;
  if (identity?.operation !== 'sum' || identity.factor_ids.length !== 1 || month === undefined) return null;
  const carrier = nodes.find(n => n.id === identity.factor_ids[0]);
  const accumulation = NodeV3.shape.nonlinear_identity.safeParse(carrier?.nonlinear_identity).data;
  if (carrier === undefined || accumulation?.operation !== 'accumulation' || accumulation.horizon_months !== month
    || [goal, carrier].some(n => n.analysis_participation === 'retained_excluded')) return null;
  const inputs = accumulation.factor_ids.map(id => nodes.find(n => n.id === id));
  if (inputs.some(n => n === undefined)) return null;
  const [stock, rate, inflow] = inputs as [Rec, Rec, Rec];
  const zeroState = rec(rate.observed_state);
  const netZero = rate.id === `${carrier.id}_net_zero_rate` && zeroState?.raw_value === 0
    && zeroState.value === 0 && typeof zeroState.unit === 'string' && isPercentScaledUnit(zeroState.unit) ? rate : null;
  return { goal, carrier, stock, rate, inflow, netZero, month, nodes, identity, accumulation };
}

const spokenFigure = (node: Rec): string | null => {
  const os = rec(node.observed_state);
  if (!finite(os?.raw_value) || typeof os.unit !== 'string') return null;
  return sayFigureAsWritten(os.raw_value, os.unit).replace(/ \/ (day|week|month|quarter|year)$/, ' a $1');
};

/** Only a positive monthly addition is said; a negative or zero one is refused at admission and never worded here. */
const positiveInflow = (node: Rec): boolean => {
  const raw = rec(node.observed_state)?.raw_value;
  return finite(raw) && raw > 0;
};

/**
 * Science §(ai) Q4 spread words, from the inflow's own §(ab) spread (accumulation-rate-spread.ts): σ 0.136 for a
 * user-stated or confirmed amount ("about a quarter" at 90%), σ 0.246 for Olumi's estimate ("about half").
 */
const inflowSpreadWords = (node: Rec): string => {
  const source = classifyValueSource(rec(node.observed_state)?.source);
  return source === 'user_stated' || source === 'user_ratified' ? 'about a quarter' : 'about half';
};

/** The rate-goal alternative is derived only from this admitted stock reading's own graph. */
export function goalStockOneOffChoice(graph: unknown): string | null {
  const held = goalStockAccumulationOf(graph);
  if (held === null || readUnitParts(readGoalRecord(graph, String(held.goal.id))?.target?.unit)?.period !== 'month') return null;
  const raw = rec(held.inflow.observed_state)?.raw_value;
  const unit = readGoalRecord(graph, String(held.goal.id))?.target?.unit;
  return !finite(raw) || typeof unit !== 'string' ? null : `No, it's a one-off ${sayFigureAsWritten(raw, unit).replace(/ \/ month$/, ' a month')}`;
}

/** Net versus gross is the drafter's reading, disclosed on the existing correction card. */
export function goalStockNetReadingLine(graph: unknown): string | null {
  const held = goalStockAccumulationOf(graph);
  const amount = held === null || !positiveInflow(held.inflow) ? null : spokenFigure(held.inflow);
  if (held?.netZero && amount !== null && goalStockOneOffChoice(graph) !== null) {
    const value = rec(held.inflow.observed_state)!.raw_value as number;
    const unit = readGoalRecord(graph, String(held.goal.id))?.target?.unit;
    const figure = sayFigureAsWritten(value, String(unit)).replace(/ \/ month$/, ' a month');
    const increment = sayFigureAsWritten(value * held.month, String(unit)).replace(/ \/ month$/, '');
    const monthly = figure.replace(/ a month$/, '');
    return `Olumi read ‘${figure}’ as ‘${String(held.goal.label)}’ growing by ${monthly} every month (about ${increment} more by month ${held.month}), after any losses.`;
  }
  return held?.netZero && amount !== null
    ? `Olumi read ‘+${amount}’ as the change after any losses.` : null;
}

export function goalStockMethodFaceLine(graph: unknown): string | null {
  const held = goalStockAccumulationOf(graph);
  return held === null ? null : `Worked out month by month to month ${held.month}`;
}

/** Call only after the Run's computed_at_h verdict, using its stored submitted options. */
export function goalStockMethodWhyLine(graph: unknown, options: readonly { interventions?: unknown }[]): string | null {
  const held = goalStockAccumulationOf(graph);
  if (held === null || !positiveInflow(held.inflow)) return null;
  const start = spokenFigure(held.stock);
  const addition = spokenFigure(held.inflow)?.replace(/ a month$/, '');
  if (start === null || addition === undefined) return null;
  const rawEdges = rec(graph)?.edges;
  const edges = Array.isArray(rawEdges) ? rawEdges.filter((e): e is Rec & { from: string; to: string } =>
    typeof rec(e)?.from === 'string' && typeof rec(e)?.to === 'string') : [];
  const scopes = accumulationOptionScopes(held.nodes as Array<Rec & { id: string }>, edges, options, '');
  const same = options.length > 0 && scopes.find(scope => scope.carrier_id === held.carrier.id)?.sameForEveryOption === true;
  const factors = [...new Set(options.flatMap(o => rec(o.interventions) ? Object.keys(o.interventions as Rec) : []))];
  const factor = factors.length === 1 ? held.nodes.find(n => n.id === factors[0]) : undefined;
  const reference = held.goal.goal_horizon_reference_date;
  const deadline = readGoalRecord(graph, String(held.goal.id))?.horizon?.deadline;
  const referenceLine = typeof reference === 'string' && held.goal.goal_horizon_stated_months === undefined ? ` Whole months completed from ${sayDate(reference)}.` : '';
  const remainder = typeof reference === 'string' && typeof deadline === 'string' && held.goal.goal_horizon_stated_months === undefined
    && reference.slice(8) !== deadline.slice(8);
  const disclosure = remainder ? ` Month ${held.month} is the last full month before ${sayDate(deadline!)}.` : '';
  return `Starts from today's ${start} and adds ${addition} each month${held.netZero ? ' (Olumi read that as the change after any losses)' : ''}, give or take ${inflowSpreadWords(held.inflow)}, up to month ${held.month}${same ? ', the same for every option' : ''}.`
    + (typeof factor?.label === 'string' && factor.label.trim() !== '' ? ` Each option then changes ‘${factor.label.trim()}’ from there.` : '') + referenceLine + disclosure;
}

/** The existing Run snapshot retains exactly the settings dispatched, including held baseline settings. */
export function submittedOptionsForMethod(result: unknown): { interventions: Record<string, unknown> }[] {
  const snapshot = rec(rec(result)?.input_snapshot);
  return Array.isArray(snapshot?.options) ? snapshot.options.filter((o): o is Rec => rec(o) !== undefined).map(o => ({
    interventions: Object.fromEntries((Array.isArray(o.settings) ? o.settings : []).flatMap(raw => {
      const setting = rec(raw);
      return typeof setting?.factor_id === 'string' ? [[setting.factor_id, setting.encoded]] : [];
    })),
  })) : [];
}

/** Internal composer input only; the stored Why? uses the existing horizon-warning carrier. */
export function goalStockMethodForRun(graph: unknown, result: unknown): { face: string; why: string } | null {
  // The canonical read already gates this recorded warning against the current graph. Public blocks omit the
  // snapshot and evaluations; never reconstruct option scope from today's graph options at this surface.
  if (goalStockAccumulationOf(graph) === null) return null;
  const face = goalStockMethodFaceLine(graph);
  const envelope = rec(rec(result)?.enrichment ?? result);
  const warnings = Array.isArray(envelope?.inference_warnings) ? envelope.inference_warnings.map(rec) : [];
  const method = warnings.filter(w => w?.code === GOAL_HORIZON_STEADY_ATTESTED && w.severity === 'info');
  const why = method.length === 1 ? method[0]?.message : undefined;
  return face === null || typeof why !== 'string' ? null : { face, why };
}
