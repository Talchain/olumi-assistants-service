import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { FreshnessDerivation } from '../orchestrator-v5/context/freshness.js';
import { isAnalysisRefusalFact } from '../orchestrator-v5/context/analysis-refusal-continuity.js';
import { leaderLicenceFromState, type LeaderLicence } from '../orchestrator-v5/compose/leader-licence.js';
import { goalChanceDriverAvailabilityForAgent } from '../orchestrator-v5/goal-target/goal-chance-licence.js';
import {
  goalChanceFactsForAgent, goalChanceDriversForAgent, goalChanceWithheldReasonsForAgent,
  type GoalChanceRangeDisplay, type RecordedGoalChanceWithholdReason,
} from '../orchestrator-v5/goal-target/goal-chance-range-agent.js';

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;

/** A RunView cell, already licensed by the existing point/range readers. */
export type CanonicalAnalysisCell =
  | { readonly kind: 'figure'; readonly display: string }
  | { readonly kind: 'range'; readonly display: string; readonly detail: GoalChanceRangeDisplay }
  | { readonly kind: 'withheld'; readonly reasons: readonly RecordedGoalChanceWithholdReason[] }
  | { readonly kind: 'none' };

export type CanonicalMainDriver =
  | { readonly kind: 'available'; readonly driver: Readonly<Rec>; readonly detail?: string }
  | { readonly kind: 'none_licensed'; readonly reason: string }
  | { readonly kind: 'not_recorded' };

export interface CanonicalAnalysisView {
  readonly schema: 'canonical_analysis_view.v1';
  readonly source: 'stored_run_facts';
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
  const enrichment = rec(rec(result)?.enrichment);
  const compared = enrichment?.option_comparison;
  // The roster belongs to the served Run, not today's graph or a refused attempt.
  const optionIds = [...new Set([
    ...(Array.isArray(compared) ? compared.flatMap(row => {
      const id = rec(row)?.option_id;
      return typeof id === 'string' && id.trim() !== '' ? [id] : [];
    }) : []),
    ...(facts.goal_chance_licence?.option_ids ?? []),
    ...Object.keys(facts.goal_chance_range_display ?? {}),
  ])];
  return {
    schema: 'canonical_analysis_view.v1', source: 'stored_run_facts',
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
    options: optionIds.map(option_id => {
      const range = facts.goal_chance_range_display?.[option_id];
      const display = facts.goal_chance_display?.[option_id];
      const reasons = goalChanceWithheldReasonsForAgent(result, option_id);
      const cell: CanonicalAnalysisCell = range !== undefined ? { kind: 'range', display: range.range, detail: range }
        : display !== undefined ? { kind: 'figure', display }
          : reasons.length > 0 ? { kind: 'withheld', reasons } : { kind: 'none' };
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
