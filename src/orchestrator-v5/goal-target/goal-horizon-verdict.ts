/** Science §(ad): one typed horizon verdict for the producer and every reply surface. */
import { STATIC_MODEL_SCOPE_NOTE, STATIC_INPUTS_NOT_RECORDED } from './static-run-evidence.js';
import { deriveRunQuestion } from './run-question.js';
import { goalTargetBasisIn, humanEffectsTimingOf, optionLeadWords, optionTimingAtPeriodEnd, referenceWords } from '../statement-door/fields/goal-timing.js';
import { periodEndWords } from './goal-target-basis.js';
import { evaluatedIdentityCarriers } from '../admission/identity-evaluations.js';
import { readGoalRecord } from './goal-record.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { withholdOptionGoalFigures } from '../../orchestrator/context/constraint-feasibility.js';
import { GOAL_FIGURES_HORIZON_NOT_TESTED, GOAL_FIGURES_OPTION_NOT_IN_PLACE, readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { goalHorizonWithholdDetail } from './goal-horizon-detail.js';
import { horizonSteadyAttested } from './horizon-basis.js';
import { goalKindOf } from './goal-kind.js';
import { timeClassOf } from './time-class.js';

type Rec = Record<string, unknown>;
const recordOf = (value: unknown): Rec | undefined => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Rec : undefined;

/**
 * `basis_at_h` (recovery Batch C, amendment 2; ruling 12): the goal's own stated basis says every option's effect on it IS
 * its size at the held month (including recruitment and ramp-up) — an explicit timing assumption Olumi states beside the
 * chance, never a steady state. Only at the SAME month as the held horizon, and never while the target's question is open.
 */
export type GoalHorizonVerdict = 'no_horizon' | 'computed_at_h' | 'steady_attested' | 'basis_at_h' | 'withhold';
export const GOAL_HORIZON_STEADY_ATTESTED = 'GOAL_HORIZON_STEADY_ATTESTED';

/** The one held-month accessor: wording consumers do not validate/re-derive the horizon. */
export function heldGoalHorizonMonths(goal: unknown): number | undefined {
  const node = recordOf(goal);
  return typeof node?.id === 'string' ? readGoalRecord({ nodes: [node] }, node.id)?.horizon?.months : undefined;
}

/** The one held-deadline accessor for horizon permission and its wording; validates the schema's date arm. */
export function heldGoalDeadline(goal: unknown): string | undefined {
  const node = recordOf(goal);
  return typeof node?.id === 'string' ? readGoalRecord({ nodes: [node] }, node.id)?.horizon?.deadline : undefined;
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
  if (product.operation === 'sum' && product.stated_in_brief !== true) return false;
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
    if (heldGoalDeadline(goal) !== undefined && goalKindOf(graph) !== 'share_by_date') return 'withhold';
    // Batch C: no held month, but the target's own stated period with effects at its end — the chance says that period.
    const stated = goalTargetBasisIn(graph, goal);
    return stated !== undefined && stated.effects_at_period_end && stated.open_question === undefined ? 'basis_at_h' : 'no_horizon';
  }
  // ⭐ EBD (Paul's hiring test, 12 Oct): a share-by-date forecast is computed AT its deadline (`withEventShareDate`
  // materialises the team's share and every added capacity by that date); the month count its deadline card also holds names
  // the same date. Without this, every option's chance was withheld as "only today's numbers" (DL GO, 12 Oct).
  if (goalKindOf(graph) === 'share_by_date') return 'computed_at_h';
  if (accumulationTestedAtGoalHorizon(graph, envelope)) return 'computed_at_h';
  if (horizonSteadyAttested(graph)) return 'steady_attested';
  // ⛔ Amendment 2: never assume steady state for an urgent hire. Without an at-horizon basis the chance is withheld.
  // M3b: a recorded human forecast that is stale or puts the effects later never reads as at the horizon.
  const basis = goalTargetBasisIn(graph, goal);
  if (basis === undefined || basis.open_question !== undefined || basis.period_months !== heldGoalHorizonMonths(goal)) return 'withhold';
  if (basis.effects_at_period_end) return 'basis_at_h';
  // ⭐ DL ruling 14 Oct (option A; AIE #94 6171728409: a chance only where the model supports it): a CHANGE target whose held month IS its own stated period, with
  // nothing in the model that works out timing (no accumulation carrier), is the same static reading as no held month: the
  // licence's conditional reading says Olumi's period-end assumption with the chance, or E's withhold says why not
  // (`periodEndConditionalOf`). Served hiring: the deadline card's "3 months from today" held month 3 beside the basis' 3, and
  // every Run withheld "only today's numbers". A held month that differs from the period still withholds.
  const timingCarrier = Array.isArray(rawNodes) && rawNodes.some(n => recordOf(recordOf(n)?.nonlinear_identity)?.operation === 'accumulation');
  return basis.target_frame !== 'level' && !timingCarrier ? 'no_horizon' : 'withhold';
}

/**
 * A held month needs this Run's evaluated carrier or a verified S5 door attestation. And a brief that STATES a timing shape the
 * product cannot yet work out over time (`time-class.ts`: "starting in month 3", seasonality, a gradual build-up) loses the at-H
 * chance even when a carrier exists: the carrier knows nothing of that mechanism, so its chance would be manufactured certainty.
 * The brief may only WITHHOLD here (never license, compute or add a figure), and it is said in the user's own words.
 */
export function withholdGoalFiguresForUntestedHorizon<E>(response: E, graph: unknown, brief?: string | null): E {
  const verdict = goalHorizonVerdict(graph, response);
  // Both licences at a held month (a carrier computed it; the user attested the goal steady) are WITHHELD when the brief states a timing
  // shape the product cannot work out: neither knows of it, so either chance would be manufactured certainty. Only a withhold is added.
  const outsideTheClass = (verdict === 'computed_at_h' || verdict === 'steady_attested') && timeClassOf(brief).shapes.length > 0;
  return verdict === 'withhold' || outsideTheClass ? withholdUntestedHorizonFigures(response, graph, brief) : response;
}

/**
 * ⭐ M3c (AIE 6181933060): where the options' OWN recorded leads give the reading at the target's month (`goalTargetBasisIn`), an
 * option whose effect is not fully in place by then, or may or may not be (a lead that straddles it), stays visible with its
 * outcome, but its chance at that month is not part of this scored set; never read as "no change". Two conditional chances are
 * not representable on today's engine, so a straddling lead withholds rather than invents a law. Every share and the leader go
 * too: the comparison would set an effect that is not yet there against the others. Pure.
 */
export function withholdOptionsNotInPlaceAtPeriodEnd<E>(response: E, graph: unknown): E {
  const nodes = recordOf(graph)?.nodes;
  const goals = Array.isArray(nodes) ? nodes.map(recordOf).filter((n): n is Rec => n?.kind === 'goal') : [];
  const goal = goals.length === 1 ? goals[0]! : undefined;
  if (goal === undefined || typeof goal.id !== 'string' || humanEffectsTimingOf(graph, goal.id) !== undefined) return response;
  const basis = goalTargetBasisIn(graph, goal);
  const timing = optionTimingAtPeriodEnd(graph, goal.id);
  if (basis === undefined || !basis.effects_at_period_end || timing === undefined) return response;
  // Only options this Run scored are named: an option the Run left out says so elsewhere (`option_participation`).
  const env = recordOf(response);
  const scored = new Set(env === undefined ? [] : readOptionResultSources(env).flat().map((row) => row.option_id ?? row.id)
    .filter((id): id is string => typeof id === 'string'));
  const out = timing.options.filter((o) => scored.has(o.option_id)
    && (((o.kind === 'later' || o.kind === 'straddles') && o.lead !== undefined) || (o.kind === 'unknown' && o.olumi_proposed === true)));
  if (out.length === 0) return response;
  const at = `${periodEndWords(basis)} ${referenceWords(basis)}`;
  const said = out.map((o) => (o.kind === 'later'
    ? `‘${o.label}’ is not fully in place by ${at} on your forecast (${optionLeadWords(o.lead!)}), so its chance at that point is not part of this scored set.`
    : o.kind === 'straddles'
      ? `‘${o.label}’ may or may not be fully in place by ${at} on your forecast (${optionLeadWords(o.lead!)}), so its chance at that point is withheld.`
      : `‘${o.label}’ is Olumi’s suggestion and has no forecast of when its effect is fully in place, so its chance at ${at} is withheld.`));
  const message = `${said.join(' ')} The options are not ranked against each other here, because that comparison would count an effect that is not yet in place.`;
  const ids = out.map((o) => o.option_id);
  return withholdOptionGoalFigures(response, new Set(ids), {
    code: GOAL_FIGURES_OPTION_NOT_IN_PLACE, severity: 'warning', message, say: message, node_ids: ids, option_ids: ids,
    detail: { reason: 'OPTION_NOT_IN_PLACE_AT_PERIOD_END', per_option: out.map((o) => ({ option_id: o.option_id, kind: o.kind })) },
  }, { keepOutcome: true });
}

/** Only callers that have obtained the ONE verdict enter this projection. */
function withholdUntestedHorizonFigures<E>(response: E, graph: unknown, brief?: string | null): E {
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
  const message = goalHorizonWithholdDetail(graph, brief);
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
  // A request-bound static calculation makes no claim about the held date. A caveat alone cannot grant this permission.
  if (deriveRunQuestion({ storedResult: block }).scope.status === 'supported_static') return result;
  const enrichment = recordOf(block.enrichment);
  const envelope = enrichment ?? block;
  const warnings = [block.inference_warnings, enrichment?.inference_warnings]
    .flatMap(value => Array.isArray(value) ? value : []);
  const missingStaticEvidence = warnings.some(value => {
    const warning = recordOf(value);
    return warning?.code === 'GOAL_CHANCE_LICENSED' && Array.isArray(warning.notes) && warning.notes.includes(STATIC_MODEL_SCOPE_NOTE);
  });
  if (!missingStaticEvidence && (warnings.some(value => recordOf(value)?.code === GOAL_FIGURES_HORIZON_NOT_TESTED)
    || goalHorizonVerdict(currentGraph, storedEnvelope ?? envelope) !== 'withhold')) return result;
  // Legacy blocks can keep their only chance record beside an otherwise empty enrichment. Its ids still need gating.
  const outerDisplays = enrichment === undefined || !Array.isArray(block.inference_warnings) ? []
    : block.inference_warnings.filter(w => ['GOAL_CHANCE_LICENSED', 'GOAL_CHANCE_RANGE'].includes(String(recordOf(w)?.code)));
  const candidate = outerDisplays.length === 0 ? envelope : { ...envelope,
    inference_warnings: [...(Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : []), ...outerDisplays] };
  const displayIds = warnings.flatMap(value => {
    const warning = recordOf(value); return Array.isArray(warning?.option_ids) ? warning.option_ids : [];
  });
  const ids = [...new Set([...readOptionResultSources(candidate).flat().map(row => row.option_id ?? row.id), ...displayIds]
    .filter((id): id is string => typeof id === 'string' && id !== ''))];
  const gated = missingStaticEvidence ? withholdOptionGoalFigures(candidate, new Set(ids), {
    code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', severity: 'warning', message: STATIC_INPUTS_NOT_RECORDED, say: STATIC_INPUTS_NOT_RECORDED,
    option_ids: ids, detail: { reason: 'EVALUATED_STATIC_INPUTS_NOT_RECORDED' },
  }, { keepOutcome: true, keepOrdering: true }) : withholdUntestedHorizonFigures(candidate, currentGraph);
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
