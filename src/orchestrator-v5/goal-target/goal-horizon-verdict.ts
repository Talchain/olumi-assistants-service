/** Science §(ad): one typed horizon verdict for the producer and every reply surface. */
import { evaluatedIdentityCarriers } from '../admission/identity-evaluations.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { withholdOptionGoalFigures } from '../../orchestrator/context/constraint-feasibility.js';
import { GOAL_FIGURES_HORIZON_NOT_TESTED, readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { goalHorizonWithholdDetail } from './goal-horizon-detail.js';
import { horizonSteadyAttested } from './horizon-basis.js';
import { goalKindOf } from './goal-kind.js';

type Rec = Record<string, unknown>;
const recordOf = (value: unknown): Rec | undefined => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Rec : undefined;

export type GoalHorizonVerdict = 'no_horizon' | 'computed_at_h' | 'steady_attested' | 'withhold';
export const GOAL_HORIZON_STEADY_ATTESTED = 'GOAL_HORIZON_STEADY_ATTESTED';

/** The one held-month accessor: wording consumers do not validate/re-derive the horizon. */
export function heldGoalHorizonMonths(goal: unknown): number | undefined {
  const month = recordOf(goal)?.goal_horizon_months;
  return typeof month === 'number' && Number.isInteger(month) && month > 0 ? month : undefined;
}

/** The one held-deadline accessor for horizon permission and its wording; validates the schema's date arm. */
export function heldGoalDeadline(goal: unknown): string | undefined {
  const horizon = NodeV3.shape.goal_horizon.safeParse(recordOf(goal)?.goal_horizon).data;
  return horizon !== undefined && 'deadline' in horizon ? horizon.deadline : undefined;
}

/** A Run's carrier must attest the declared positional inputs and the goal's own month. */
function accumulationTestedAtGoalHorizon(graph: unknown, envelope?: unknown): boolean {
  const rawNodes = recordOf(graph)?.nodes;
  if (!Array.isArray(rawNodes)) return false;
  const nodes = rawNodes.map(recordOf).filter((node): node is Rec => node !== undefined);
  const goals = nodes.filter(node => node.kind === 'goal');
  if (goals.length !== 1) return false;
  const goal = goals[0]!;
  const month = heldGoalHorizonMonths(goal);
  if (month === undefined) return false;
  const product = NodeV3.shape.nonlinear_identity.safeParse(goal.nonlinear_identity).data;
  if (product?.operation !== 'product' && !(product?.operation === 'sum' && product.factor_ids.length === 1)) return false;
  const env = recordOf(envelope);
  const evaluations = env?.identity_evaluations;
  const evaluated = env === undefined ? undefined : evaluatedIdentityCarriers(nodes,
    Array.isArray(evaluations) ? evaluations : undefined);
  if (evaluated === undefined ? product.stated_in_brief !== true : !evaluated.has(goal.id)) return false;
  return product.factor_ids.some(id => {
    const node = nodes.find(candidate => candidate.id === id);
    const carrier = NodeV3.shape.nonlinear_identity.safeParse(node?.nonlinear_identity).data;
    return carrier?.operation === 'accumulation' && carrier.horizon_months === month
      && (evaluated === undefined ? carrier.stated_in_brief === true : evaluated.has(id));
  });
}

export function goalHorizonVerdict(graph: unknown, envelope?: unknown): GoalHorizonVerdict {
  const rawNodes = recordOf(graph)?.nodes;
  const goals = Array.isArray(rawNodes) ? rawNodes.map(recordOf).filter((node): node is Rec =>
    node !== undefined && node.kind === 'goal') : [];
  const goal = goals.length === 1 ? goals[0] : undefined;
  if (heldGoalHorizonMonths(goal) === undefined) {
    // Calendar dates have no bound carrier today; share-by-date's event chances already model time.
    return heldGoalDeadline(goal) !== undefined && goalKindOf(graph) !== 'share_by_date' ? 'withhold' : 'no_horizon';
  }
  if (accumulationTestedAtGoalHorizon(graph, envelope)) return 'computed_at_h';
  return horizonSteadyAttested(graph) ? 'steady_attested' : 'withhold';
}

/** A held month needs this Run's evaluated carrier or a verified S5 door attestation. */
export function withholdGoalFiguresForUntestedHorizon<E>(response: E, graph: unknown): E {
  return goalHorizonVerdict(graph, response) === 'withhold' ? withholdUntestedHorizonFigures(response, graph) : response;
}

/** Only callers that have obtained the ONE verdict enter this projection. */
function withholdUntestedHorizonFigures<E>(response: E, graph: unknown): E {
  const goals = recordOf(graph)?.nodes;
  const goal = Array.isArray(goals) ? goals.map(recordOf).find(node => node?.kind === 'goal') : undefined;
  const env = recordOf(response);
  if (env === undefined) return response;
  const displayIds = (Array.isArray(env.inference_warnings) ? env.inference_warnings : []).flatMap(raw => {
    const warning = recordOf(raw);
    return ['GOAL_CHANCE_LICENSED', 'GOAL_CHANCE_RANGE'].includes(String(warning?.code))
      && Array.isArray(warning?.option_ids) ? warning.option_ids : [];
  });
  const scored = [...new Set([...readOptionResultSources(env).flat().map(row => row.option_id ?? row.id), ...displayIds]
    .filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (goal === undefined || scored.length === 0) return response;
  const message = goalHorizonWithholdDetail(graph);
  return withholdOptionGoalFigures(response, new Set(scored), {
    code: GOAL_FIGURES_HORIZON_NOT_TESTED, severity: 'warning', message, say: message,
    node_ids: [String(goal.id)], option_ids: scored,
    detail: { reason: 'HORIZON_NOT_TESTED' },
    // Science 93 @54dbc0fe (Q-a): only claims AGAINST the target's month go. The leader and win shares compare options on
    // the outcome and do not depend on the month, so the ordering stays (TARGET_ONLY_CLAIMS, as for a missing level).
  }, { keepOutcome: true, keepOrdering: true });
}

/**
 * DL #2895 P1b: hash equality does not cover a deadline edit. Reapply the horizon licence to today's graph on every
 * stored-result read. Never unlock a previously withheld Run: only a new Run can supply new figures.
 * Accept both a PLoT envelope and its public analysis_result block; preserve ordering exactly as the Run gate does.
 */
export function withReadTimeHorizonGate<R>(result: R, currentGraph: unknown, storedEnvelope?: unknown): R {
  const block = recordOf(result);
  if (block === undefined) return result;
  const enrichment = recordOf(block.enrichment);
  const envelope = enrichment ?? block;
  const warnings = [block.inference_warnings, enrichment?.inference_warnings]
    .flatMap(value => Array.isArray(value) ? value : []);
  if (warnings.some(value => recordOf(value)?.code === GOAL_FIGURES_HORIZON_NOT_TESTED)
    || goalHorizonVerdict(currentGraph, storedEnvelope ?? envelope) !== 'withhold') return result;
  // Legacy blocks can keep their only chance record beside an otherwise empty enrichment. Its ids still need gating.
  const outerDisplays = enrichment === undefined || !Array.isArray(block.inference_warnings) ? []
    : block.inference_warnings.filter(w => ['GOAL_CHANCE_LICENSED', 'GOAL_CHANCE_RANGE'].includes(String(recordOf(w)?.code)));
  const candidate = outerDisplays.length === 0 ? envelope : { ...envelope,
    inference_warnings: [...(Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : []), ...outerDisplays] };
  const gated = withholdUntestedHorizonFigures(candidate, currentGraph);
  if (gated === candidate) return result;
  // Stored display records contain percentages and attainment wording of their own. They cannot survive the withhold.
  const stripChanceRecords = (value: unknown): unknown => Array.isArray(value)
    ? value.filter(w => !['GOAL_CHANCE_LICENSED', 'GOAL_CHANCE_RANGE', 'GOAL_HORIZON_NOT_TESTED', GOAL_HORIZON_STEADY_ATTESTED]
      .includes(String(recordOf(w)?.code))) : value;
  // UI-normalised aliases are also stored in legacy carriers. Keep only the non-target fields of those rows.
  const stripAliases = (value: unknown): unknown => Array.isArray(value) ? value.map(raw => {
    const row = recordOf(raw);
    if (row === undefined) return raw;
    const { goal_probability: _snake, goalProbability: _camel, ...rest } = row;
    return rest;
  }) : value;
  const held: Rec = { ...gated, inference_warnings: stripChanceRecords(gated.inference_warnings) };
  if ('option_comparison' in held) held.option_comparison = stripAliases(held.option_comparison);
  if (Array.isArray(held.results)) held.results = stripAliases(held.results);
  else if (recordOf(held.results) !== undefined) {
    const nested = { ...recordOf(held.results) };
    for (const key of ['option_comparison', 'options', 'option_results']) if (key in nested) nested[key] = stripAliases(nested[key]);
    held.results = nested;
  }
  if (recordOf(held.decision_brief) !== undefined) {
    const brief = { ...recordOf(held.decision_brief) };
    if ('options' in brief) brief.options = stripAliases(brief.options);
    held.decision_brief = brief;
  }
  // Exact 0/1 decisions are stored target displays too. Empty recorded absence contains no chance and stays byte-equal.
  const { goal_certainty, ...withoutCertainty } = block;
  const safeBlock = Array.isArray(goal_certainty) && goal_certainty.length > 0 ? withoutCertainty : block;
  return (enrichment === undefined ? held : { ...safeBlock, enrichment: held,
    ...('inference_warnings' in block ? { inference_warnings: stripChanceRecords(block.inference_warnings) } : {}) }) as R;
}
