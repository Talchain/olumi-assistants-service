/** One bound Run/current-graph snapshot, licensed once before either review serializer. */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { readMayNameLeadingOptionFromResult, deriveWinnerConstraintInfeasibility } from '../../orchestrator/context/constraint-feasibility.js';
import { readOptionResultSources, isUsableWinProbability } from '../../orchestrator/context/option-result-source.js';
import { collectFactorFlipEntries } from '../../orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import { isRecommendableOption } from '../tools/handlers/recommendable-option.js';
import { licensedRunBlockForModel, withoutLeaderDesignations, keyNamesLeader } from '../agent-lane/licensed-run-view.js';
import { savedRunContextFacts } from '../agent-lane/saved-run-context-facts.js';
import { runExplanationKeyForRecord, RUN_EXPLANATION_PREFIX } from '../agent-lane/run-explanation.js';
import { composeAnalysisStateV1, readRawRobustnessFromResponseBody } from '../compose/analysis-state-v1.js';
import { selectCanonicalAnalysisState } from './canonical-analysis-state.js';
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { readGraph, buildNodeLabelMap } from './enrichment-graph-labels.js';
import { readTopLevelFlipRows, flipRowScaleUnsafeForPromptUnits, type TopLevelFlipRow } from './flip-threshold-rows.js';
import { projectRunGraphForDecisionReview } from '../coaching/decision-review-graph-projection.js';

export interface LicensedReviewOption {
  readonly id: string;
  readonly label: string;
  readonly win_probability: number;
  readonly outcome_mean?: number;
  readonly [key: string]: unknown;
}
export interface LicensedRunFacts {
  readonly analysis: Record<string, unknown>;
  readonly current: boolean;
  readonly mayNameLeader: boolean;
  readonly hasReviewOptions: boolean;
  readonly constraintInfeasible: boolean;
  readonly enrichment: Record<string, unknown>;
  readonly winner: Partial<LicensedReviewOption> & { readonly recommendation_suppressed?: boolean };
  readonly runnerUp: LicensedReviewOption | null;
  readonly flipRows: readonly (Pick<TopLevelFlipRow, 'factor_id' | 'factor_label' | 'current_value' | 'flip_value' | 'direction' | 'unit'> &
    Partial<Pick<TopLevelFlipRow, 'alternative_winner_id' | 'alternative_winner_label'>>)[];
  readonly flipSource: 'top_level' | 'nested_legacy' | 'none';
  readonly flipNoEffectCount: number;
  readonly flipScaleRefusedCount: number;
}
const readRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const readNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function hashOf(graph: unknown): string | null {
  const parsed = GraphStateIngressSchema.safeParse(graph);
  return parsed.success ? computeAnalysisAffectingGraphHash(parsed.data) : null;
}

/** Review-only tightening: the shared Agent projector intentionally retains shares and some old findings. */
export function buildLicensedRunFacts(
  fact: Extract<HandlerFact, { fact_type: 'run_analysis' }>, scenarioId: string,
  groundingGraph: unknown, currentGraph?: unknown, currentGraphHash?: string | null,
): LicensedRunFacts {
  const result = fact.result;
  const raw = result.enrichment ?? {};
  // Run grounding may be historical. Only an explicit current-model snapshot or
  // its caller-supplied hash can establish currentness; absence stays unknown.
  const currencyHash = currentGraphHash !== undefined ? currentGraphHash : hashOf(currentGraph);
  const canonical = selectCanonicalAnalysisState({ handlerFacts: [fact], currentGraphHash: currencyHash, currentGraph });
  const current = canonical.freshness === 'fresh';
  const mayNameLeader = current && readMayNameLeadingOptionFromResult(result);
  const state = composeAnalysisStateV1({ canonical, mayNameLeadingOption: mayNameLeader,
    rawRobustness: current ? readRawRobustnessFromResponseBody({ blocks: [{ enrichment: raw }] }) : null });
  const permissions = { leader_may_be_named: mayNameLeader };
  const block = { type: 'analysis_result', computed_against_hash: result.graph_hash_at_run, enrichment: raw };
  const selected = { graph_hash: currencyHash ?? undefined, analysis_state: state, analysis_result: block };
  const saved = savedRunContextFacts(scenarioId, selected, permissions);
  const recordedKey = runExplanationKeyForRecord(scenarioId, state, block);
  // savedRunContextFacts binds current references; the same reference helper binds historical facts.
  const analysis: Record<string, unknown> = { ...state, ...saved, claim_permissions: permissions,
    ...(recordedKey === null ? {} : { selected_run_reference: `${RUN_EXPLANATION_PREFIX}${recordedKey}` }) };
  // Only the producer's explicit `unavailable` (or a Run that is not current) withholds flip data. `computed`,
  // `partial_no_effect` (real pairs beside no-effect rows) and `all_no_effect` (the honest "no factor flips it" fact)
  // all carry licensed rows; absent status keeps the legacy behaviour, as `lens-selector` does.
  const flipAvailable = current && raw.flip_thresholds_status !== 'unavailable';
  // The tipping point names a factor and a threshold, never an option, so the LEADER permission does not gate it.
  if (!flipAvailable) {
    delete analysis.tipping_point;
    delete analysis.tipping_point_run_key;
  }

  let chosen: readonly Record<string, unknown>[] | undefined;
  let winner: LicensedReviewOption | null = null;
  for (const source of readOptionResultSources(raw).map(rows => rows.filter(isRecommendableOption))) {
    winner = selectWinner(source, result.leading_option_id);
    if (winner !== null) { chosen = source; break; }
  }
  // The SAME run-matched representation the review's own graph section is built from, so label and unit lookups (and the
  // flip units drawn from them) are exactly what they were before the review was given licensed facts.
  const graph = projectRunGraphForDecisionReview(readGraph(raw), groundingGraph).graph;
  const labels = buildNodeLabelMap(graph);
  const units = buildNodeUnitMap(graph);
  const topLevel = Array.isArray(raw.flip_thresholds);
  const rows = flipAvailable && topLevel ? readTopLevelFlipRows(raw, labels, units) : [];
  const pairs = rows.filter(row => row.kind === 'flip_pair');
  // The one scale predicate the review always used (a trimmed-empty scale token is absent). No second, stricter gate.
  const kept = pairs.filter(row => !flipRowScaleUnsafeForPromptUnits(row));
  const legacy = flipAvailable && !topLevel ? collectFactorFlipEntries(raw as V2RunResponseEnvelope, labels, units) : [];
  // Flip data follows its own availability. Only the identity of the option that would take over is leader-licensed.
  const withoutAlternativeIdentity = <T extends { alternative_winner_id?: unknown; alternative_winner_label?: unknown }>(row: T): T => {
    const { alternative_winner_id: _id, alternative_winner_label: _label, ...rest } = row;
    return rest as T;
  };
  const approvedRows = [...(mayNameLeader ? kept : kept.map(withoutAlternativeIdentity)), ...legacy];
  // The withheld-leader projection runs only when the LEADER is withheld. Flip availability removes flip data by key
  // (below); it never strips the producer's ordinary prose.
  const projected = mayNameLeader ? raw
    : readRecord(readRecord(licensedRunBlockForModel({ enrichment: raw }))?.enrichment) ?? {};
  // Withheld flip FIGURES: when the producer's own flip data is withheld, a retained prose string that restates one of its
  // thresholds is the same claim by another carrier. Bound to the specific withheld numbers (never to wording), so ordinary
  // producer prose is untouched and a rephrased claim cannot slip past a phrase list.
  const withheldFlipFigures: string[] = flipAvailable ? [] : [
    ...(topLevel ? readTopLevelFlipRows(raw, labels, units).map(row => row.flip_value) : []),
    ...(!topLevel ? collectFactorFlipEntries(raw as V2RunResponseEnvelope, labels, units).map(entry => entry.flip_value) : []),
  ].filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).map(n => String(n));
  const restatesWithheldFlip = (text: string): boolean => withheldFlipFigures.some(figure =>
    new RegExp(`(?<![\\d.])${figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d]|\\.\\d)`).test(text));
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap(item => typeof item === 'string' && restatesWithheldFlip(item) ? [] : [clean(item)]);
    }
    const rec = readRecord(value);
    if (rec === null) return value;
    return Object.fromEntries(Object.entries(rec).flatMap(([key, v]) => {
      if (typeof v === 'string' && restatesWithheldFlip(v)) return [];
      if (!mayNameLeader && (key === 'win_probability' || key === 'winner' || key === 'runner_up'
        || key === 'margin' || keyNamesLeader(key))) return [];
      if (!flipAvailable && /^(?:flip_thresholds|edge_e_values|fragile_edges)$/.test(key)) return [];
      if (!current && /(?:driver|sensitivity|fragility|robustness|m1_coaching)/.test(key)) return [];
      return [[key, clean(v)]];
    }));
  };
  return { analysis, current, mayNameLeader, hasReviewOptions: winner !== null,
    constraintInfeasible: winner !== null && deriveWinnerConstraintInfeasibility(raw, winner.id).infeasible,
    enrichment: readRecord(clean(mayNameLeader ? projected : withoutLeaderDesignations(projected))) ?? {},
    winner: mayNameLeader && winner !== null ? winner : { recommendation_suppressed: true },
    runnerUp: mayNameLeader && winner !== null && chosen !== undefined ? selectRunnerUp(chosen, winner) : null,
    flipRows: approvedRows, flipSource: topLevel ? 'top_level' : legacy.length > 0 ? 'nested_legacy' : 'none',
    flipNoEffectCount: rows.filter(row => row.kind === 'attested_no_flip').length,
    flipScaleRefusedCount: pairs.length - kept.length };
}

export function selectWinner(
  results: ReadonlyArray<Record<string, unknown>>,
  leadingOptionId: string | null,
): LicensedReviewOption | null {
  if (results.length === 0) return null;
  if (typeof leadingOptionId === 'string' && leadingOptionId.length > 0) {
    const byId = results.find(
      (r) => r.option_id === leadingOptionId || r.id === leadingOptionId,
    );
    return byId && isUsableWinProbability(byId.win_probability)
      ? projectOptionAsWinner(byId)
      : null;
  }
  const top = highestWinProbability(results);
  return top ? projectOptionAsWinner(top) : null;
}

function selectRunnerUp(
  results: ReadonlyArray<Record<string, unknown>>,
  winner: LicensedReviewOption,
): LicensedReviewOption | null {
  // Filter against BOTH `option_id` and `id` so entries from the
  // `option_comparison` shape (which populates both) and the
  // `decision_brief.options` shape (which only populates `option_id`)
  // are both excluded correctly from the runner-up candidate set.
  const others = results.filter(
    (r) => r.option_id !== winner.id && r.id !== winner.id,
  );
  const top = highestWinProbability(others);
  return top ? projectOptionAsWinner(top) : null;
}

function highestWinProbability(
  results: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestProb = -Infinity;
  for (const r of results) {
    // Round-4 review MAJOR-A: gate on the SHARED usable-probability predicate
    // (finite AND in [0,1]) so the null-leader + runner-up paths skip a thin /
    // out-of-range source exactly like the other selectors.
    if (!isUsableWinProbability(r.win_probability)) continue;
    const p = r.win_probability;
    if (p > bestProb) {
      best = r;
      bestProb = p;
    }
  }
  return best;
}

function projectOptionAsWinner(r: Record<string, unknown>): LicensedReviewOption | null {
  const id =
    typeof r.option_id === 'string'
      ? r.option_id
      : typeof r.id === 'string'
        ? r.id
        : '';
  const label =
    typeof r.option_label === 'string'
      ? r.option_label
      : typeof r.label === 'string'
        ? r.label
        : id;
  const winProb = r.win_probability;
  if (!isUsableWinProbability(winProb)) return null;
  // outcome_mean: read from flat field first, then nested outcome.mean.
  // PLoT's option_comparison shape carries the value nested; older fixtures
  // and some test paths use the flat field.
  const outcomeMean = readNumber(r.outcome_mean)
    ?? readNumber(readRecord(r.outcome)?.mean);
  return {
    id,
    label,
    win_probability: winProb,
    ...(outcomeMean !== null ? { outcome_mean: outcomeMean } : {}),
  };
}


function buildNodeUnitMap(graph: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return map;
  for (const raw of nodes) {
    const n = readRecord(raw);
    if (!n) continue;
    const id = typeof n.id === 'string' ? n.id : null;
    if (!id) continue;
    const data = readRecord(n.data);
    const obs = readRecord(n.observed_state);
    const unit = (typeof data?.unit === 'string' ? data.unit : null)
      ?? (typeof obs?.unit === 'string' ? obs.unit : null);
    if (unit) map.set(id, unit);
  }
  return map;
}

