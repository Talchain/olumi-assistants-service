import { withGoalChanceReadback } from '../orchestrator-v5/goal-target/goal-chance-licence.js';
import { readRunAnalysisOccurrence } from '../orchestrator-v5/types/handler-fact.js';
import { readRunEvidence, runEvidenceWireOf } from '../orchestrator-v5/agent-lane/run-evidence.js';
import { runLeaderOf, type RunLeader } from '../orchestrator-v5/agent-lane/run-facts.js';
import { GOAL_FIGURES_HORIZON_NOT_TESTED } from '../orchestrator/context/option-result-source.js';
import { ZERO_SPREAD_NEEDS_MONTHLY_CHANGES } from '../orchestrator-v5/goal-target/zero-spread-horizon-line.js';
import { goalTargetGapOf } from '../orchestrator-v5/goal-target/goal-target-gap.js';
import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { FreshnessDerivation } from '../orchestrator-v5/context/freshness.js';
import { isAnalysisRefusalFact } from '../orchestrator-v5/context/analysis-refusal-continuity.js';
import { leaderLicenceFromState, type LeaderLicence } from '../orchestrator-v5/compose/leader-licence.js';
import { deriveRunQuestion, goalChanceDriverAvailabilityForAgent, goalChanceLicenceForAgent, PERIOD_END_EFFECTS_UNSTATED, STATIC_MODEL_SCOPE_NOTE, type RunQuestion, type SelectedRunEvidence } from '../orchestrator-v5/goal-target/goal-chance-licence.js';
import { goalChanceCellFacesForAgent } from '../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { readStoredGoalCertainty } from '../orchestrator-v5/tools/handlers/run-goal-certainty.js';
import {
  goalChanceFactsForAgent, goalChanceDriversForAgent, goalChanceWithheldReasonsForAgent, STATUS_QUO_BY_ASSUMPTION,
  type GoalChanceRangeDisplay, type RecordedGoalChanceWithholdReason,
} from '../orchestrator-v5/goal-target/goal-chance-range-agent.js';
import { notesAsShown, sayDisplayedPct } from '../orchestrator-v5/goal-target/goal-targets-joint.js';

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;

// MOVED bytes: DGAI src/canvas/runView/runView.ts:25, :27
// @ 8f53cea7eb4cb04bea5bd54b3f06d2f076d5cc8c. No new copy.
const RUN_AGAIN_FOR_CHANCE = 'Run the analysis again to see the chance.';
const UNKNOWN_RUN_FIGURES = 'This earlier Run may be out of date. Run the analysis again.';
const OPTION_CHANCE_WITHHELD = 'Olumi can’t yet say its chance of meeting your goal, in this model.';

const OPTION_CHANCE_NOT_SHOWN = 'Chance not shown yet';
/** Recovery Batch C, amendment 1: the status quo row's face — no figure, no interval. */
const STATUS_QUO_FACE = 'No change, by assumption';
/** C1: with no goal target, no option can have a chance of meeting it. */
const GOAL_TARGET_MISSING = 'goal_target_missing';
const GOAL_TARGET_MISSING_FACE = 'Not shown yet: needs a target';

/**
 * Moved readGoalIdentityWithheld message selection from DGAI
 * src/components/results/utils/goalIdentityWithheld.ts @ the same commit.
 * Copy selection only: it does not decide a cell's kind or licence.
 */
function goalIdentityWithheldMessage(result: unknown, option_id: string): string | undefined {
  const block = rec(result);
  const codes = ['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_USER_EFFECT_CLAMPED',
    'GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_UNSUPPORTED_SPREAD', 'GOAL_FIGURES_PRODUCT_NOT_READ',
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
  // R2 C3: a display-safe specific reason ("This comparison turns on the links from …") takes the "Not shown." prefix
  // instead of being dropped for the generic line. Empty or unsafe words still fall back.
  // D3 (AIE #94 6128697025; DL 12 Oct): ruling 12's sentence already says the chance "isn’t shown", so it is said as written,
  // never "Not shown. The chance … isn’t shown".
  const words = reasons.map(warning => {
    const itself = rec(warning.detail)?.reason === PERIOD_END_EFFECTS_UNSTATED;
    const raw = typeof warning.message === 'string' ? warning.message.trim() : '';
    return { itself, raw: raw === '' || itself || raw.startsWith('Not shown.') ? raw : `Not shown. ${raw}` };
  });
  const notDisplaySafe = /\b[a-z0-9]+_[a-z0-9_]+\b|[{}[\]<>]/;
  const allSafe = words.every(({ itself, raw }) => (itself ? raw !== '' : raw.startsWith('Not shown.')) && raw.length <= 400 && !notDisplaySafe.test(raw));
  return allSafe ? [...new Set(words.map(({ raw }) => raw))].join(' ')
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
  readonly question?: RunQuestion;
  readonly schema: 'canonical_analysis_view.v1';
  readonly source: 'stored_run_facts';
  /** Also supplied for a selected Run whose currentness is unknown. */
  readonly face_when_stale?: string;
  /** Display-only history; never current options, a leader or a driver. */
  readonly historical_figures?: {
    readonly chance_words?: string;
    readonly options: readonly { readonly option_id: string; readonly option_label?: string; readonly display: string }[];
  };
  readonly run: {
    readonly run_id: string | null;
    readonly graph_hash_at_run: string | null;
    readonly computed_at: string | null;
  } | null;
  readonly staleness: {
    /** Null means unknown/no Run, never an assertion that this Run is fresh. */
    readonly stale: boolean | null;
    readonly revision: number | null;
    readonly run_revision: number | null;
    readonly run_revision_source?: 'recorded' | 'legacy_unknown';
    readonly basis: 'analysis_graph_hash_interim';
    readonly reason: FreshnessDerivation['reason'] | null;
    readonly limitation: 'Hash equality cannot detect brief, framing or stage changes.'
      | 'Currentness is unknown because an analysis hash is unavailable.';
  };
  readonly leader_licence: LeaderLicence;
  /** ⭐ S7 / UI Q3: who leads, from the SAME builder the AI's Run facts use (`runLeaderOf`); the UI computes no leader. */
  readonly leader: RunLeader;
  readonly options: readonly {
    readonly option_id: string;
    readonly cell: CanonicalAnalysisCell;
    readonly main_driver: CanonicalMainDriver;
  }[];
  /**
   * ⭐ RECOVERY BATCH C (rulings 15–22; amendments 1–7): what the chance in each cell is a chance OF, the sentences said once
   * beside the chances, and — with several targets — each target's own chance per option and the joint's status. Copied
   * from the Run's stored licence by the same reader as the Agent's (`goalChanceFactsForAgent`); absent = nothing to add.
   */
  readonly goal_chance?: CanonicalGoalChanceDetail;
}

export interface CanonicalGoalChanceDetail {
  /** "chance of ‘productivity’ being at least 10% higher than today at three months". */
  readonly chance_words?: string;
  /** Disclosures, in order: reference/status quo assumption, effect timing, partial goal, estimate_only, provisional. */
  readonly notes?: readonly string[];
  readonly status_quo?: { readonly option_id: string; readonly line: string };
  readonly targets?: {
    /** The headline: the joint, licensed with its words, or withheld with its line (and the Fréchet bound when it applies). */
    readonly joint: { readonly status: 'licensed'; readonly words: string } | { readonly status: 'withheld'; readonly line: string; readonly frechet_line?: string };
    /** Each target on its own, below the headline, with each option's displayed figure. */
    readonly per_target: readonly { readonly constraint_id: string; readonly words: string;
      readonly options: readonly { readonly option_id: string; readonly display: string }[] }[];
  };
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
  /** Same selected Run through the existing block builder; history cannot reopen current claims. */
  readonly historicalResult?: OlumiResponse['blocks'][number] | null;
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
  runEvidence?: SelectedRunEvidence,
): readonly { readonly option_id: string; readonly cell: CanonicalAnalysisCell }[] {
  const current = currentResult?.type === 'analysis_result';
  const result = current ? currentResult : null;
  const facts = goalChanceFactsForAgent(result, graph, current);
  const faces = goalChanceCellFacesForAgent(result, graph, current, runEvidence);
  const certainty = new Map((current ? readStoredGoalCertainty(goalCertainty) : undefined)
    ?.filter(decision => decision.earned === false).map(decision => [decision.option_id, decision.say]) ?? []);
  const licence = goalChanceLicenceForAgent(result);
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).flatMap(node => {
    const row = rec(node);
    return typeof row?.id === 'string' && typeof row.label === 'string' && row.label.trim() !== ''
      ? [[row.id, row.label] as const] : [];
  }));
  // C1 (Paul's funding test, 14 Oct): with no goal target no option can have a chance of meeting it, so the missing target
  // is the ONE root reason, ahead of placeholder and horizon reasons. The standing gap's own reader and words
  // (`goal-target-gap.ts`, which `modelGapOf` and the action bar's "Set target" read; one target predicate with the target
  // ask, so a legacy goal's normalised threshold is a target, and a provisional objective is never asked for one).
  const gap = goalTargetGapOf(graph);
  const targetMissing = gap === null ? undefined : { code: GOAL_TARGET_MISSING, message: gap.question };
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
    const reasons = [...(targetMissing === undefined ? [] : [targetMissing]), ...goalChanceWithheldReasonsForAgent(result, option_id)];
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
    const horizonReason = reasons.find(reason => reason.code === GOAL_FIGURES_HORIZON_NOT_TESTED);
    // Recovery Batch C: the status quo of a change target (or of several targets) is no change, by assumption (amendment 1);
    // a joint withheld for several targets says its own line. Both are the licence's stored words, never composed here.
    const byAssumption = reasons.find(reason => reason.code === STATUS_QUO_BY_ASSUMPTION);
    const batchCReason = byAssumption ?? reasons.find(reason => reason.code === 'goal_joint_not_shown');
    const withheldWhy = targetMissing?.message ?? horizonReason?.message ?? identityMessage ?? certainty.get(option_id) ?? reasonLine
      ?? batchCReason?.message ?? licenceLine ?? OPTION_CHANCE_WITHHELD;
    const face = faces.get(option_id);
    const cell: CanonicalAnalysisCell = range !== undefined ? { kind: 'range', display: range.range, detail: range, ...(face === undefined ? {} : { face }) }
      : display !== undefined ? { kind: 'figure', display, ...(face === undefined ? {} : { face }) }
        : reasons.length > 0 ? { kind: 'withheld', reasons,
          face: targetMissing !== undefined ? GOAL_TARGET_MISSING_FACE : horizonReason !== undefined ? ZERO_SPREAD_NEEDS_MONTHLY_CHANGES : byAssumption !== undefined ? STATUS_QUO_FACE : OPTION_CHANCE_NOT_SHOWN,
          why: withheldWhy } : { kind: 'none' };
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
  const occurrence = fact === null ? undefined : readRunAnalysisOccurrence(fact);
  const question = fact === null ? undefined : deriveRunQuestion({ storedResult: fact.result,
    runEvidence: readRunEvidence(runEvidenceWireOf(fact)) });
  const recordedRevision = occurrence?.evaluated_scenario_revision ?? null;
  const runRevision = recordedRevision !== null && occurrence?.fact_row_id === input.derivation?.selected_fact_row_id
    && recordedRevision === input.derivation?.run_revision?.value
    ? recordedRevision : null;
  const freshness = fact === null ? undefined : input.derivation?.freshness;
  const current = fact !== null && input.analysisState?.run_state.kind === 'complete_current'
    && input.currentResult?.type === 'analysis_result';
  const result = current ? withGoalChanceReadback(input.currentResult, fact?.result, fact === null ? undefined : readRunEvidence(runEvidenceWireOf(fact))) : null;
  const historical = fact !== null && freshness === 'unknown' && input.historicalResult?.type === 'analysis_result'
    && (occurrence?.fact_row_id === undefined || occurrence.fact_row_id === input.derivation?.selected_fact_row_id)
    ? withGoalChanceReadback(input.historicalResult, fact.result, readRunEvidence(runEvidenceWireOf(fact))) : null;
  const past = goalChanceFactsForAgent(historical, input.graph, historical !== null);
  // Keep only the Run's licensed displays and stored chance words, never graph-derived faces, units or drivers.
  const historicalFigures = [
    ...Object.entries(past.goal_chance_display ?? {}),
    ...Object.entries(past.goal_chance_range_display ?? {}).map(([id, range]) => [id, range.range] as const),
  ].map(([option_id, display]) => {
    const label = past.goal_chance_licence?.option_labels_by_option?.[option_id];
    return { option_id, display, ...(label === undefined ? {} : { option_label: label }) };
  });
  const staticClaim = question?.scope.status === 'supported_static';
  const facts = goalChanceFactsForAgent(result, input.graph, current);
  const drivers = new Map(goalChanceDriversForAgent(result, input.graph).map(row => [row.option_id, row.driver]));
  const availability = goalChanceDriverAvailabilityForAgent(result);
  const driverStatus = new Map(availability?.options.map(row => [row.option_id, row]) ?? []);
  const cells = projectCanonicalAnalysisCells(result, input.graph, fact?.result.goal_certainty,
    fact === null ? undefined : readRunEvidence(runEvidenceWireOf(fact)));
  const summary = (result as { summary?: unknown } | null)?.summary;
  const goalChance = canonicalGoalChanceDetail(facts, [
    ...(typeof summary === 'string' ? [summary] : []),
    ...(staticClaim && question?.scope.status === 'supported_static' && cells.some(({ cell }) => cell.kind === 'figure' || cell.kind === 'range')
      ? [STATIC_MODEL_SCOPE_NOTE] : []),
  ]);
  return {
    schema: 'canonical_analysis_view.v1', source: 'stored_run_facts',
    ...(question === undefined ? {} : { question }),
    ...(fact !== null && (freshness === 'stale' || freshness === 'unknown')
      ? { face_when_stale: freshness === 'unknown' ? UNKNOWN_RUN_FIGURES : RUN_AGAIN_FOR_CHANCE } : {}),
    ...(historicalFigures.length === 0 ? {} : { historical_figures: {
      ...(past.goal_chance_words === undefined ? {} : { chance_words: past.goal_chance_words }),
      options: historicalFigures,
    } }),
    run: fact === null ? null : {
      run_id: fact.result.run_id ?? null,
      graph_hash_at_run: fact.result.graph_hash_at_run ?? null,
      computed_at: fact.result.computed_at ?? null,
    },
    staleness: {
      stale: freshness === 'stale' ? true : freshness === 'fresh' ? false : null,
      revision: typeof input.revision === 'number' && Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : null,
      run_revision: runRevision, run_revision_source: runRevision === null ? 'legacy_unknown' : 'recorded',
      basis: 'analysis_graph_hash_interim',
      reason: fact === null ? null : input.derivation?.reason ?? null,
      limitation: freshness === 'unknown' ? 'Currentness is unknown because an analysis hash is unavailable.'
        : 'Hash equality cannot detect brief, framing or stage changes.',
    },
    leader_licence: leaderLicenceFromState(input.analysisState, input.analysisReady),
    leader: runLeaderOf(result, input.analysisState, input.analysisReady, current),
    options: cells.map(({ option_id, cell: projected }) => {
      const cell = projected;
      const driver = cell.kind === 'figure' ? drivers.get(option_id) : undefined;
      const status = driverStatus.get(option_id);
      const detail = facts.goal_chance_driver_display?.[option_id];
      const main_driver: CanonicalMainDriver = driver !== undefined
        ? { kind: 'available', driver, ...(detail !== undefined ? { detail } : {}) }
        : cell.kind === 'figure' && status?.status === 'none_licensed' && status.reason !== undefined
          ? { kind: 'none_licensed', reason: status.reason } : { kind: 'not_recorded' };
      return { option_id, cell, main_driver };
    }),
    ...(goalChance !== undefined ? { goal_chance: goalChance } : {}),
  };
}

/** Recovery Batch C: the stored licence's sentence parts, as the screen shows them (no calculation, no second licence). */
function canonicalGoalChanceDetail(facts: ReturnType<typeof goalChanceFactsForAgent>, saidOnCard: readonly string[]): CanonicalGoalChanceDetail | undefined {
  const targets = facts.goal_targets;
  const detail: CanonicalGoalChanceDetail = {
    ...(facts.goal_chance_words !== undefined ? { chance_words: facts.goal_chance_words } : {}),
    // Reply-face P2: each cause once on the card, never the card's own summary again (`notesAsShown`).
    ...((): { notes?: string[] } => {
      const shown = facts.goal_chance_notes === undefined ? [] : notesAsShown(facts.goal_chance_notes, targets?.note_groups, saidOnCard);
      return shown.length > 0 ? { notes: shown } : {};
    })(),
    ...(facts.goal_chance_status_quo !== undefined ? { status_quo: facts.goal_chance_status_quo } : {}),
    ...(targets !== undefined ? { targets: {
      joint: targets.joint.status === 'licensed' ? { status: 'licensed' as const, words: targets.joint.words }
        : { status: 'withheld' as const, line: targets.joint.line, ...(targets.joint.frechet_line !== undefined ? { frechet_line: targets.joint.frechet_line } : {}) },
      per_target: targets.per_target.map(t => ({ constraint_id: t.constraint_id, words: t.words,
        options: Object.entries(t.pct_by_option).map(([option_id, pct]) => ({ option_id, display: sayDisplayedPct(pct) })) })),
    } } : {}),
  };
  return Object.keys(detail).length > 0 ? detail : undefined;
}
