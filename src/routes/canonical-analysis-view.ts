import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { FreshnessDerivation } from '../orchestrator-v5/context/freshness.js';
import { isAnalysisRefusalFact } from '../orchestrator-v5/context/analysis-refusal-continuity.js';
import { leaderLicenceFromState, type LeaderLicence } from '../orchestrator-v5/compose/leader-licence.js';
import { goalChanceDriverAvailabilityForAgent, goalChanceLicenceForAgent } from '../orchestrator-v5/goal-target/goal-chance-licence.js';
import { goalChanceCellFacesForAgent } from '../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { readStoredGoalCertainty } from '../orchestrator-v5/tools/handlers/run-goal-certainty.js';
import {
  goalChanceFactsForAgent, goalChanceDriversForAgent, goalChanceWithheldReasonsForAgent,
  type GoalChanceRangeDisplay, type RecordedGoalChanceWithholdReason,
} from '../orchestrator-v5/goal-target/goal-chance-range-agent.js';

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;

// MOVED bytes: DGAI src/canvas/runView/runView.ts:25, :27
// @ 8f53cea7eb4cb04bea5bd54b3f06d2f076d5cc8c. No new copy.
const RUN_AGAIN_FOR_CHANCE = 'Run the analysis again to see the chance.';
const OPTION_CHANCE_WITHHELD = 'Olumi can’t yet say its chance of meeting your goal, in this model.';

const OPTION_CHANCE_NOT_SHOWN = 'Chance not shown yet';

/**
 * Moved readGoalIdentityWithheld message selection from DGAI
 * src/components/results/utils/goalIdentityWithheld.ts @ the same commit.
 * Copy selection only: it does not decide a cell's kind or licence.
 */
function goalIdentityWithheldMessage(result: unknown, option_id: string): string | undefined {
  const block = rec(result);
  const codes = ['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_USER_EFFECT_CLAMPED',
    'GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_PRODUCT_NOT_READ',
    'GOAL_FIGURES_TARGET_NOT_TESTABLE', 'GOAL_FIGURES_SHARE_APPROXIMATION', 'GOAL_FIGURES_OPTIONS_IDENTICAL'];
  const warnings = [rec(block?.enrichment)?.inference_warnings, block?.inference_warnings]
    .flatMap(value => Array.isArray(value) ? value : []).map(rec);
  const matched = warnings.filter((warning): warning is Rec => warning !== undefined
    && typeof warning.code === 'string' && codes.includes(warning.code))
    .filter(warning => !Object.hasOwn(warning, 'option_ids')
      || (Array.isArray(warning.option_ids)
        && warning.option_ids.some(id => typeof id === 'string' && id === option_id)));
  if (matched.length === 0) return undefined;
  const hasTargetRequirement = matched.some(warning => warning.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
  const reasons = hasTargetRequirement ? matched.filter(warning => warning.code !== 'GOAL_FIGURES_PLACEHOLDER_PATH') : matched;
  const words = reasons.map(warning => typeof warning.message === 'string' ? warning.message.trim() : '');
  const notDisplaySafe = /\b[a-z0-9]+_[a-z0-9_]+\b|[{}[\]<>]/;
  const allSafe = words.every(raw => raw.startsWith('Not shown.') && raw.length <= 400 && !notDisplaySafe.test(raw));
  return allSafe ? [...new Set(words)].join(' ')
    : "Not shown. Olumi can't give each option's figures for this goal from this run.";
}

/** A RunView cell, already licensed by the existing point/range readers. */
export type CanonicalAnalysisCell =
  | { readonly kind: 'figure'; readonly display: string;
      /** absent = the server has no licensed sentence for this cell; the UI must not invent one */
      readonly face?: string }
  | { readonly kind: 'range'; readonly display: string; readonly detail: GoalChanceRangeDisplay;
      /** absent = the server has no licensed sentence for this cell; the UI must not invent one */
      readonly face?: string }
  | { readonly kind: 'withheld'; readonly reasons: readonly RecordedGoalChanceWithholdReason[];
      /** The face is the ≤8-word marker; why is shown verbatim behind "Why?", never shortened. */
      readonly face: string; readonly why: string }
  | { readonly kind: 'none' };

export type CanonicalMainDriver =
  | { readonly kind: 'available'; readonly driver: Readonly<Rec>; readonly detail?: string }
  | { readonly kind: 'none_licensed'; readonly reason: string }
  | { readonly kind: 'not_recorded' };

export interface CanonicalAnalysisView {
  readonly schema: 'canonical_analysis_view.v1';
  readonly source: 'stored_run_facts';
  readonly face_when_stale?: string;
  readonly run: {
    readonly run_id: string | null;
    readonly graph_hash_at_run: string | null;
    readonly computed_at: string | null;
  } | null;
  readonly staleness: {
    /** Null means unknown/no Run, never an assertion that this Run is fresh. */
    readonly stale: boolean | null;
    readonly revision: number | null;
    readonly run_revision: null;
    readonly basis: 'analysis_graph_hash_interim';
    readonly reason: FreshnessDerivation['reason'] | null;
    readonly limitation: 'Hash equality cannot detect brief, framing or stage changes.';
  };
  readonly leader_licence: LeaderLicence;
  readonly options: readonly {
    readonly option_id: string;
    readonly cell: CanonicalAnalysisCell;
    readonly main_driver: CanonicalMainDriver;
  }[];
}

export interface CanonicalAnalysisViewInput {
  readonly revision?: number;
  readonly graph?: unknown;
  /** The existing successful-Run selector owns this choice, including on a stale read. */
  readonly runFact?: RunAnalysisHandlerFact | null;
  readonly derivation?: FreshnessDerivation | null;
  readonly analysisState?: AnalysisStateV1 | null;
  readonly analysisReady?: unknown;
  /** The already gated public result, never a recovered historical result. */
  readonly currentResult?: OlumiResponse['blocks'][number] | null;
}

/**
 * Read cells from an already gated public result. The caller owns currentness;
 * this reader never selects a Run or derives freshness. Stored certainty only
 * supplies the existing withheld face, never a cell's kind or figure licence.
 */
export function projectCanonicalAnalysisCells(
  currentResult: OlumiResponse['blocks'][number] | null | undefined,
  graph: unknown,
  goalCertainty?: unknown,
): readonly { readonly option_id: string; readonly cell: CanonicalAnalysisCell }[] {
  const current = currentResult?.type === 'analysis_result';
  const result = current ? currentResult : null;
  const facts = goalChanceFactsForAgent(result, graph, current);
  const faces = goalChanceCellFacesForAgent(result, graph, current);
  const certainty = new Map((current ? readStoredGoalCertainty(goalCertainty) : undefined)
    ?.filter(decision => decision.earned === false).map(decision => [decision.option_id, decision.say]) ?? []);
  const licence = goalChanceLicenceForAgent(result);
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).flatMap(node => {
    const row = rec(node);
    return typeof row?.id === 'string' && typeof row.label === 'string' && row.label.trim() !== ''
      ? [[row.id, row.label] as const] : [];
  }));
  const compared = rec(rec(result)?.enrichment)?.option_comparison;
  // The roster belongs to the served Run, not today's graph or a refused attempt.
  const optionIds = [...new Set([
    ...(Array.isArray(compared) ? compared.flatMap(row => {
      const id = rec(row)?.option_id;
      return typeof id === 'string' && id.trim() !== '' ? [id] : [];
    }) : []),
    ...(facts.goal_chance_licence?.option_ids ?? []),
    ...Object.keys(facts.goal_chance_range_display ?? {}),
  ])];
  return optionIds.map(option_id => {
    const identityMessage = goalIdentityWithheldMessage(result, option_id);
    const range = Object.hasOwn(facts.goal_chance_range_display ?? {}, option_id)
      ? facts.goal_chance_range_display?.[option_id] : undefined;
    const display = Object.hasOwn(facts.goal_chance_display ?? {}, option_id)
      ? facts.goal_chance_display?.[option_id] : undefined;
    const reasons = goalChanceWithheldReasonsForAgent(result, option_id);
    const recordedLabel = licence?.option_labels_by_option?.[option_id];
    const label = typeof recordedLabel === 'string' && recordedLabel.trim() !== '' ? recordedLabel : labels.get(option_id);
    const reasonByOption = rec(rec(licence)?.withheld_reason_by_option);
    const carriedLine = reasonByOption !== undefined && Object.hasOwn(reasonByOption, option_id)
      ? rec(reasonByOption[option_id])?.line : undefined;
    const reasonLine = typeof carriedLine === 'string' && carriedLine.trim() !== '' ? carriedLine : undefined;
    // MOVED c6 licence line: DGAI analysis-hero/goalChanceCopy.ts:135, same commit.
    const licenceLine = licence?.withheld_option_ids?.includes(option_id) && label !== undefined
      ? `‘${label}’: ${OPTION_CHANCE_WITHHELD}` : undefined;
    // DGAI RunView:125 precedence, applied only to the existing withheld cell.
    const withheldWhy = identityMessage ?? certainty.get(option_id) ?? reasonLine ?? licenceLine ?? OPTION_CHANCE_WITHHELD;
    const face = faces.get(option_id);
    const cell: CanonicalAnalysisCell = range !== undefined ? { kind: 'range', display: range.range, detail: range, ...(face === undefined ? {} : { face }) }
      : display !== undefined ? { kind: 'figure', display, ...(face === undefined ? {} : { face }) }
        : reasons.length > 0 ? { kind: 'withheld', reasons, face: OPTION_CHANCE_NOT_SHOWN, why: withheldWhy } : { kind: 'none' };
    return { option_id, cell };
  });
}

/**
 * One additive view of the existing read. No calculation, fact selection or
 * second licence policy: all cells/drivers use the same readers as the Agent.
 * Stale identity survives, but existing currentness gates still own figures.
 */
export function projectCanonicalAnalysisView(input: CanonicalAnalysisViewInput): CanonicalAnalysisView {
  const fact = input.runFact != null && !isAnalysisRefusalFact(input.runFact as HandlerFact) ? input.runFact : null;
  const freshness = fact === null ? undefined : input.derivation?.freshness;
  const current = fact !== null && input.analysisState?.run_state.kind === 'complete_current'
    && input.currentResult?.type === 'analysis_result';
  const result = current ? input.currentResult : null;
  const facts = goalChanceFactsForAgent(result, input.graph, current);
  const drivers = new Map(goalChanceDriversForAgent(result, input.graph).map(row => [row.option_id, row.driver]));
  const availability = goalChanceDriverAvailabilityForAgent(result);
  const driverStatus = new Map(availability?.options.map(row => [row.option_id, row]) ?? []);
  const cells = projectCanonicalAnalysisCells(result, input.graph, fact?.result.goal_certainty);
  return {
    schema: 'canonical_analysis_view.v1', source: 'stored_run_facts',
    ...(fact !== null && freshness === 'stale' ? { face_when_stale: RUN_AGAIN_FOR_CHANCE } : {}),
    run: fact === null ? null : {
      run_id: fact.result.run_id ?? null,
      graph_hash_at_run: fact.result.graph_hash_at_run ?? null,
      computed_at: fact.result.computed_at ?? null,
    },
    staleness: {
      stale: freshness === 'stale' ? true : freshness === 'fresh' ? false : null,
      revision: typeof input.revision === 'number' && Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : null,
      run_revision: null, basis: 'analysis_graph_hash_interim',
      reason: fact === null ? null : input.derivation?.reason ?? null,
      limitation: 'Hash equality cannot detect brief, framing or stage changes.',
    },
    leader_licence: leaderLicenceFromState(input.analysisState, input.analysisReady),
    options: cells.map(({ option_id, cell }) => {
      const driver = cell.kind === 'figure' ? drivers.get(option_id) : undefined;
      const status = driverStatus.get(option_id);
      const detail = facts.goal_chance_driver_display?.[option_id];
      const main_driver: CanonicalMainDriver = driver !== undefined
        ? { kind: 'available', driver, ...(detail !== undefined ? { detail } : {}) }
        : cell.kind === 'figure' && status?.status === 'none_licensed' && status.reason !== undefined
          ? { kind: 'none_licensed', reason: status.reason } : { kind: 'not_recorded' };
      return { option_id, cell, main_driver };
    }),
  };
}
