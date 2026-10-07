/**
 * ⛔ DECISION SENSITIVITY COMES FROM EVPPI ALONE (Canonical #70 5847574837; finish line: truthful explanation).
 *
 * MEASURED on served `levelless-reason-PIN2` turn 3: `factor_sensitivity[0]` = `decision_brief.top_drivers[0]` =
 * "Paid AI add-on revenue" (labelled "biggest", `importance_basis: graph_structural`) — a factor only the EXCLUDED
 * option acts on — while `factor_evppi` was `below_resolution` for EVERY factor and `decision_evpi` ≈ 0.00025. The
 * Agent then named a "most decision-sensitive assumption" the run does not support.
 *
 * So the run result the Agent reads is projected here:
 *   (i)   `factor_sensitivity` and `decision_brief.top_drivers` are PLoT's structural goal-sensitivity, NOT decision
 *         sensitivity — they are removed from what the Agent reads, and so is the summary's "…is the strongest
 *         driver" clause built from them;
 *   (ii)  `decision_sensitivity` is added, read ONLY from `factor_evppi` by CEE's own reader
 *         (`selectFactorEvppiPriority`): a factor above resolution → `measured`; every row below resolution →
 *         `none_measurable` with NO sentence (RC 5950124321: EVPPI is flat in additive models and never varies links, so
 *         "no single assumption changes which option leads" read as nothing would; it makes no claim); anything else →
 *         `not_measured` (no claim);
 *   (iii) a factor no compared option acts on is therefore never ranked: nothing structural is left to rank;
 *   (iv)  LIMITS ARE NOT THE GOAL: every option row it keeps, in every carrier, has PLoT's limits-only joint
 *         `probability_of_joint_goal` renamed `all_limits_hold_probability` (with `limits_note`), and the brief's
 *         `goal_fit` is dropped;
 *   (v)   ABSENT STAYS ABSENT: when the run withheld its goal figures (#416's typed code), only the current carrier
 *         (`option_comparison`, top level or in `results`) is kept, with no P(goal) on any row; every downstream copy
 *         (`results[]`, `results.options` / `option_results`, `decision_brief.options`) is removed, exactly as
 *         `readOptionResultSources` refuses to read them (PR Review CR @ 0e1fd8c1).
 * The user-facing blocks are untouched; this is the Agent's view only.
 */
import { selectFactorEvppiPriority } from '../coaching/select-factor-evppi.js';
import { goalChanceDriverAvailabilityForAgent, nearestFiveGoalChancesForAgent } from '../goal-target/goal-chance-licence.js';
import { goalChanceFactsForAgent, runHasGoalChanceLicenceRecord } from '../goal-target/goal-chance-range-agent.js';
import { robustnessComputed } from './goal-chance-driver-egress.js';
import { readTopLevelFlipRows } from '../context/flip-threshold-rows.js';
import { flipRowScaleIsDisplaySafe } from '../context/analysis-signals.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import {
  GOAL_CHANCE_COMPANION_KEYS, GOAL_CHANCE_DRIVER_RECORD_KEYS, GOAL_FIGURES_WITHHELD_CODES, runWithheldGoalFigures,
} from '../../orchestrator/context/option-result-source.js';

/**
 * WHOSE RANGE (AIQ ruling #72 5867782904, words ACK 5870069785; Core Stabilisation Plan §7). ISL echoes each
 * `factor_evppi` row's `spread_source`: `template` = Olumi's own assumed range, `user` = the user's. Read from the
 * SELECTED factor's own row only, and only once it is measured to change the leader (`resolved`). Anything else, or no
 * field, makes no claim.
 */
export type RangeSource = 'olumi_assumed' | 'yours';
const RANGE_OF: Readonly<Record<string, RangeSource>> = { template: 'olumi_assumed', user: 'yours' };
export const olumiAssumedRangeSay = (label: string): string =>
  `Within the range Olumi assumed for ${label}, ${label} could change how the options compare. Do you know ${label} more precisely?`;

export type DecisionSensitivity =
  | {
    readonly status: 'measured';
    readonly most_sensitive: { readonly factor_id: string; readonly label: string; readonly range?: RangeSource };
    readonly say?: string;
  }
  | { readonly status: 'none_measurable' }
  | { readonly status: 'not_measured' };

const recordOf = (x: unknown): Record<string, unknown> | undefined =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined;

/** "…'s lead because X is the strongest driver." → "…'s lead." (the clause is structural, `analysis-result-headline.ts`). */
export function withoutStrongestDriverClause(summary: string): string {
  // A label may carry a dot ("v2.0", "£49.00"), so the clause runs to the nearest " because ", not the nearest dot
  // (Canonical #2015 N1).
  return summary.replace(/ because (?:(?! because ).)*? is the strongest driver\./g, '.');
}

export function decisionSensitivityOf(enrichment: unknown): DecisionSensitivity {
  const d = selectFactorEvppiPriority(enrichment);
  if (d.outcome === 'selected') {
    const rows = recordOf(enrichment)?.factor_sensitivity;
    const labelled = Array.isArray(rows)
      ? (rows.map(recordOf).find((r) => r?.factor_id === d.factorId)?.factor_label)
      : undefined;
    const label = typeof labelled === 'string' && labelled !== '' ? labelled : d.factorId;
    const evppi = recordOf(enrichment)?.factor_evppi;
    const own = Array.isArray(evppi) ? evppi.map(recordOf).find((r) => r?.factor_id === d.factorId) : undefined;
    // Own keys only (DL nit on #2246): a plain-object lookup would hand back `constructor` / `toString` as a "range".
    const source = own?.spread_source;
    const range = typeof source === 'string' && Object.hasOwn(RANGE_OF, source) ? RANGE_OF[source] : undefined;
    if (range === undefined) return { status: 'measured', most_sensitive: { factor_id: d.factorId, label } };
    return {
      status: 'measured',
      most_sensitive: { factor_id: d.factorId, label, range },
      ...(range === 'olumi_assumed' ? { say: olumiAssumedRangeSay(label) } : {}),
    };
  }
  if (d.reason === 'all_below_resolution') return { status: 'none_measurable' };
  return { status: 'not_measured' };
}

/**
 * The first usable crossing in producer order, read by the existing parser and display predicate.
 * Values are already in display units: preserve their supplied precision, never calculate or round a replacement.
 * This factor fact names no option and has no EVPPI dependency. Its enclosing selected analysis result carries the
 * existing computed_against_hash / Run identity; callers consume canonical currentness, never infer it from this fact.
 * No rows are not_evaluated, all attested no-flip rows are no_flip_in_range, and unusable/unsafe rows are unresolved.
 * These are local projection outcomes, not a new shared status-transport contract.
 */
export type TippingPoint =
  | {
    readonly status: 'found';
    readonly factor_id: string;
    readonly label: string;
    readonly direction: 'increase' | 'decrease';
    readonly unit: string | null;
    readonly current_value: number;
    readonly threshold: number;
    readonly current_display: string;
    readonly threshold_display: string;
    readonly say: string;
  }
  | { readonly status: 'no_flip_in_range' }
  | { readonly status: 'unresolved' }
  | { readonly status: 'not_evaluated' };

const inUnit = (value: number, unit: string | null): string => {
  const n = String(value);
  if (unit === null || unit.trim() === '') return n;
  const suffix = unit.trim();
  // Compact the one-character percent suffix only; the shared display predicate already licensed the values.
  return classifyUnitScaleClass(suffix) === 'percent' && suffix.length === 1 ? `${n}${suffix}` : `${n} ${suffix}`;
};

export function tippingPointOf(enrichment: unknown): TippingPoint {
  const e = recordOf(enrichment);
  if (e === undefined) return { status: 'not_evaluated' };
  const rows = readTopLevelFlipRows(e);
  if (rows.length === 0) return { status: 'not_evaluated' };
  const first = rows.find((r) => r.kind === 'flip_pair' && r.current_value !== null && r.flip_value !== null
    && flipRowScaleIsDisplaySafe({ value_scale: r.value_scale }, r.current_value, r.flip_value));
  if (first === undefined) {
    return rows.every((r) => r.kind === 'attested_no_flip') ? { status: 'no_flip_in_range' } : { status: 'unresolved' };
  }
  const current = inUnit(first.current_value!, first.unit);
  const threshold = inUnit(first.flip_value!, first.unit);
  return {
    status: 'found',
    factor_id: first.factor_id,
    label: first.factor_label,
    direction: first.direction!,
    unit: first.unit,
    current_value: first.current_value!,
    threshold: first.flip_value!,
    current_display: current,
    threshold_display: threshold,
    say: `${first.factor_label} is a factor that could change this: the comparison could change if it ${first.direction === 'increase' ? 'rises above' : 'falls below'} ${threshold}.`,
  };
}

/**
 * ⭐ S2i (DL GO, Wave B2–B7): NO ABSENCE TO SAY BESIDE A SCREEN THAT SHOWS ONE. Every served Run of Waves B1–B7 and W3 (14)
 * handed the Agent `decision_sensitivity: not_measured | none_measurable` and `tipping_point: not_evaluated` beside a
 * screen naming each option's driver (a licensed driver, or a range's "depends most on") or a robustness check that ran,
 * and each wave served a new wording of "nothing established which assumption matters most / sensitivity was not
 * measured". The instruction to make no claim (RC 5950124321) did not hold, and the egress removes only the forms it
 * knows. So on such a screen neither status is handed: `decision_sensitivity` unless `measured` (with the raw
 * `factor_evppi` rows it is read from), and `tipping_point` when `not_evaluated`. A `measured` sensitivity and every
 * tipping-point FINDING (`no_flip_in_range`, `unresolved`, a threshold) still are. `goal_chance_driver_availability` is
 * not gated: it covers only the options with a point chance, so beside another option's range it is still true.
 * `screenGraph` names the screen's labels for callers that do not pass `graph` (Explain, saved-run facts): it decides
 * this gate only, never which facts are shown.
 */
function screenShowsSensitivity(block: Record<string, unknown>, graph: unknown, current: boolean): boolean {
  const facts = goalChanceFactsForAgent(block, graph, current);
  return Object.keys(facts.goal_chance_driver_display ?? {}).length > 0
    || Object.keys(facts.goal_chance_range_display ?? {}).length > 0
    || robustnessComputed(block);
}

/** The run's `analysis_result` block as the Agent reads it: (i)–(iii) above. Never mutates its input. */
export function analysisResultForAgent(result: unknown, graph?: unknown, current = true, screenGraph?: unknown): unknown {
  const block = recordOf(result);
  if (block === undefined) return result;
  const enrichment = recordOf(block.enrichment);
  const goalFacts = goalChanceFactsForAgent(block, graph, current);
  const displays = goalFacts.goal_chance_display ?? {};
  // A Run with no GOAL_CHANCE_LICENSED record (served before #2625) keeps the run-wide rule it was built under.
  const legacyRun = !runHasGoalChanceLicenceRecord(block);
  const out: Record<string, unknown> = { ...block };
  if (typeof block.summary === 'string') out.summary = withoutStrongestDriverClause(block.summary);
  if ('inference_warnings' in block) out.inference_warnings = warningsForAgent(block.inference_warnings);
  if (enrichment !== undefined) {
    const { factor_sensitivity: _structural, ...rest } = enrichment;
    const withheld = runWithheldGoalFigures(enrichment);
    const outcomeHidden = keptOutcomeOptionIds(enrichment);
    // ⭐ (9) chat and panel quote the same figure: a chance the licence displays at the nearest 5 reaches the Agent as displayed.
    const shown = nearestFiveGoalChancesForAgent(block);
    const brief = recordOf(rest.decision_brief);
    let limitsRenamed = false;
    const rows = (value: unknown): unknown => {
      const projected = optionRowsForAgent(value, outcomeHidden, shown, displays, legacyRun ? withheld : undefined);
      if (projected.renamed) limitsRenamed = true;
      return projected.rows;
    };
    if (brief !== undefined) {
      const { top_drivers: _drivers, ...briefRest } = brief;
      // ⛔ LIMITS ARE NOT THE GOAL (AIQ 5887531086; DL 5887546998): the brief's `goal_fit` is the LEADER's limits-only joint
      // (PLoT `decision-brief.ts`), so the Agent never sees it under that name.
      const summary = recordOf(briefRest.analysis_summary);
      if (summary !== undefined && 'goal_fit' in summary) {
        const { goal_fit: _jointOfLeader, ...summaryRest } = summary;
        briefRest.analysis_summary = summaryRest;
        limitsRenamed = true;
      }
      if ('options' in briefRest) {
        if (withheld) delete briefRest.options;
        else briefRest.options = rows(briefRest.options);
      }
      rest.decision_brief = briefRest;
    }
    if ('option_comparison' in rest) rest.option_comparison = rows(rest.option_comparison);
    const nested = recordOf(rest.results);
    if (Array.isArray(rest.results)) {
      if (withheld) delete rest.results;
      else rest.results = rows(rest.results);
    } else if (nested !== undefined) {
      const results: Record<string, unknown> = { ...nested };
      if ('option_comparison' in results) results.option_comparison = rows(results.option_comparison);
      for (const copy of ['options', 'option_results'] as const) {
        if (!(copy in results)) continue;
        if (withheld) delete results[copy];
        else results[copy] = rows(results[copy]);
      }
      rest.results = results;
    }
    if ('inference_warnings' in rest) rest.inference_warnings = warningsForAgent(rest.inference_warnings);
    out.enrichment = rest;
    if (limitsRenamed) out.limits_note = ALL_LIMITS_HOLD_NOTE;
  }
  const shown = screenShowsSensitivity(block, graph ?? screenGraph, current);
  const sensitivity = decisionSensitivityOf(enrichment);
  const projected = recordOf(out.enrichment);
  if (!shown || sensitivity.status === 'measured') out.decision_sensitivity = sensitivity;
  else if (projected !== undefined && 'factor_evppi' in projected) {
    const { factor_evppi: _absenceSource, ...withoutEvppi } = projected;
    out.enrichment = withoutEvppi;
  }
  // CEE-owned facts stay outside enrichment's producer-prose filter. The licence, not EVPPI, owns this claim scope.
  Object.assign(out, goalFacts);
  if (goalFacts.goal_chance_display !== undefined) {
    const availability = goalChanceDriverAvailabilityForAgent(block);
    if (availability !== undefined) {
      const options = availability.options.filter((o) => Object.hasOwn(displays, o.option_id));
      out.goal_chance_driver_availability = { ...availability, options,
        status: options.some((o) => o.status === 'available') ? 'available'
          : options.every((o) => o.status === 'none_licensed') ? 'none_licensed' : 'not_recorded' };
    }
  }
  const tipping = tippingPointOf(enrichment);
  if (!(shown && tipping.status === 'not_evaluated')) out.tipping_point = tipping;
  return out;
}

/**
 * One carrier's option rows for the Agent: each row's `probability_of_joint_goal` (how often ALL the user's limits hold
 * together — never the goal's target) becomes `all_limits_hold_probability`; under #416's withhold no row keeps a
 * `probability_of_goal`. Not an array → unchanged.
 */
function optionRowsForAgent(
  value: unknown, outcomeHidden: ReadonlySet<string> = new Set(), shown: ReadonlyMap<string, number> = new Map(),
  displays: Readonly<Record<string, string>> = {},
  /** Legacy Run (no licence record): the run-wide withhold alone decides, as before #2625. */
  legacyWithheld?: boolean,
): { rows: unknown; renamed: boolean } {
  if (!Array.isArray(value)) return { rows: value, renamed: false };
  let renamed = false;
  const rows = value.map((row) => {
    const r = recordOf(row);
    if (r === undefined) return row;
    let next: Record<string, unknown> = r;
    // ⭐ F1b [R1] (DL 5931658539 item 1, (ii)): an outcome a withhold KEPT for the panel never reaches the model — the UI
    // shows it deterministically, and the LLM cannot rank what it never sees. The sample counts stay.
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    if (outcomeHidden.has(EVERY_OPTION) || (id !== undefined && outcomeHidden.has(id))) {
      const outcome = recordOf(next.outcome);
      const { expected_outcome: _expected, ...others } = next;
      next = others;
      if (outcome !== undefined) {
        const kept: Record<string, unknown> = { ...outcome };
        for (const k of ['mean', 'std', 'p10', 'p50', 'p90'] as const) delete kept[k];
        next = { ...next, outcome: kept };
      }
    }
    if ('probability_of_joint_goal' in next) {
      const { probability_of_joint_goal: joint, ...others } = next;
      next = { ...others, all_limits_hold_probability: joint };
      renamed = true;
    }
    const chancePermitted = legacyWithheld !== undefined ? !legacyWithheld : id !== undefined && Object.hasOwn(displays, id);
    if (!chancePermitted && 'probability_of_goal' in next) {
      const { probability_of_goal: _withheld, ...others } = next;
      next = others;
    }
    if (chancePermitted && id !== undefined && typeof next.probability_of_goal === 'number') {
      next = { ...next, probability_of_goal: shown.get(id) ?? next.probability_of_goal };
    }
    // ⛔ G4/G5 PHASE 2 (design-g4g6 Q3): the goal chance's precision and drivers NEVER reach the Agent, withheld or not —
    // no ruled Agent sentence exists, and free prose about a "main driver" passes no guard. It reads the licence record only.
    if (GOAL_CHANCE_COMPANION_KEYS.some((k) => k in next)) {
      const others: Record<string, unknown> = { ...next };
      for (const k of GOAL_CHANCE_COMPANION_KEYS) delete others[k];
      next = others;
    }
    return next;
  });
  return { rows, renamed };
}

/**
 * ⛔ G4/G5 PHASE 2 (design-g4g6 Q3): the goal-chance licence's main-driver claims never reach the Agent, in either carrier
 * (`enrichment.inference_warnings`, or a kept Run's `inference_warnings`). The rest of every record is untouched.
 */
function warningsForAgent(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  // ⛔ S1 review r1 #4: the GOAL_CHANCE_RANGE record's figures never reach the model raw (ruling 1 §6: no comparison of
  // ranges); the Agent reads only its ruled display (`goalChanceRangeDisplayForAgent`, PR-S2).
  return value.filter((w) => recordOf(w)?.code !== 'GOAL_CHANCE_RANGE').map((w) => {
    const r = recordOf(w);
    if (r === undefined || !GOAL_CHANCE_DRIVER_RECORD_KEYS.some((k) => k in r)) return w;
    const kept: Record<string, unknown> = { ...r };
    for (const k of GOAL_CHANCE_DRIVER_RECORD_KEYS) delete kept[k];
    return kept;
  });
}

/** What the Agent is told about the limits-only figure (AIQ 5887531086: its own fact, in the UI's register). */
export const ALL_LIMITS_HOLD_NOTE =
  '`all_limits_hold_probability` is how often ALL the user\u2019s limits hold together in the model runs. It does NOT include '
  + 'the goal\u2019s target: never call it a chance of reaching the goal, a goal fit or a target fit, and never combine it with '
  + 'the goal. Say it, if at all, as "all your limits hold in N% of model runs (this does not include the goal\u2019s target)".';

/**
 * The options whose OUTCOME a goal-figure withhold kept for the panel (`withheld_claims` present, without `outcome`; F1b
 * B2), or {@link EVERY_OPTION}. Their outcome figures are removed from the Agent's view (DL 5931658539 item 1 (ii)).
 */
const EVERY_OPTION = '*';
function keptOutcomeOptionIds(enrichment: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const warnings = Array.isArray(enrichment.inference_warnings) ? enrichment.inference_warnings : [];
  for (const w of warnings) {
    const r = recordOf(w);
    if (r === undefined || typeof r.code !== 'string' || !GOAL_FIGURES_WITHHELD_CODES.has(r.code)) continue;
    if (!Array.isArray(r.withheld_claims) || (r.withheld_claims as unknown[]).includes('outcome')) continue;
    // No option list = every option (fail closed).
    if (!Array.isArray(r.option_ids)) { out.add(EVERY_OPTION); continue; }
    for (const id of r.option_ids) if (typeof id === 'string') out.add(id);
  }
  return out;
}
