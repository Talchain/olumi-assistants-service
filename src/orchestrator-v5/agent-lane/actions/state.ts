/**
 * ⭐ S-B — WHAT THE ACTION BAR READS: one pure projection of a canonical read (the turn's final readback, or the reload
 * GET's read), so a live turn and a reload compute the SAME facts from the same persisted state (github-a2 amendment 9).
 *
 * Every fact comes from the existing reader that owns it (AIE 6036471065): RC's signals adapter and selector
 * (`assembleGuidanceSignals` → `selectorSignalsOf` → `eligibleGuidanceRows`), the Run binding (`runExplanationChip`), the ONE licence (`leaderLicenceFromState`), the S1
 * card (`strengthenCardFor`) and the review's fragile-link rule (`testableFragileLinkOf`). Nothing here reads
 * conversation text or a random source. Approval liveness uses the existing survival rule and its expiry clock.
 */
import { createHash } from 'node:crypto';
import { eligibleGuidanceRows, type GuidanceState, type SelectedRow } from '../guidance/index.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { selectorSignalsOf } from '../turn-context/selector-signals.js';
import { guidanceLeaderLicensed } from '../turn-context/guidance-wire.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import { runExplanationChip, RUN_EXPLANATION_PREFIX } from '../run-explanation.js';
import { strengthenCardFor } from '../strengthen-press.js';
import { testableFragileLinkOf } from '../decision-review-press.js';
import { soleGoalOf, goalKindOf, goalDeadlineOf, type GoalKind } from '../../goal-target/goal-kind.js';
import { statedGoalTargetOf } from '../../goal-target/stated-goal-target.js';
import { isPendingActionExpired, type PendingAction } from '../../session/pending-action.js';
import { approvalChipIdFor, typedApprovalOf } from '../approval-chips.js';
import type { StageType } from '@talchain/schemas/boundary';
import type { GoalPathFactor, ValueAuthorship } from '../turn-context/guidance-signals.js';
import { canonicalStageOf } from '../method-turn/method-turn.js';
import { goalChanceDriversForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { keptFigureFor } from '../kept-figure.js';
import { proposalFigure } from '../proposal-reply.js';
import { isPercentScaledUnit } from '../../../cee/draft/records/projector.js';
import { computeProposalId } from '../proposal.js';
import { risksTurnForReadback } from '../method-turn/widen-turn.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

/** The persisted state the bar is a function of. The same fields at the turn's end and on the reload GET. */
export interface ActionRead {
  readonly scenarioId: string;
  readonly graph: unknown;
  readonly graphHash?: string;
  readonly analysisState?: unknown;
  readonly analysisReady?: unknown;
  readonly analysisResult?: unknown;
  readonly optionParticipation?: unknown;
  readonly identityEvaluated?: ReadonlySet<string>;
  /** RC's persisted guidance history (interaction history). Unreadable or absent = no cooldown. */
  readonly guidance?: GuidanceState | null;
  /** The latest answer row’s pending carrier, settled after held-proposal reconciliation. */
  readonly pending?: readonly PendingAction[];
}

/** The model revision every offer is bound to (contract v1.1 item 5). */
export interface ActionRevision { readonly graph_hash: string | null; readonly run_key: string | null }

export interface ActionFacts {
  readonly scenarioId: string;
  readonly canonicalStage: StageType | null;
  readonly estimateCandidates: readonly (GoalPathFactor & { readonly figure: string })[];
  readonly estimateDriverIds: readonly string[];
  readonly revision: ActionRevision;
  /** 16-hex hash of (scenario, revision): the bar's identity (contract v1.1: state_key is the revision's hash). */
  readonly stateKey: string;
  /** False when the model could not be read: the bar then claims nothing about it. */
  readonly readable: boolean;
  /** A current Run this read binds (the Explain control's own binding). */
  readonly runBound: boolean;
  /** The canonical readiness admits a Run now (`may_run`, else `status === 'ready'`). */
  readonly runAdmissible: boolean;
  readonly goalPresent: boolean;
  readonly goalLabel: string;
  readonly goalKind: GoalKind | null;
  readonly targetPresent: boolean;
  readonly approvalWaiting: boolean;
  readonly runStale: boolean;
  /** `goal_horizon.deadline` (YYYY-MM-DD) when the goal holds one: the pre-mortem's horizon (contract v1.1 item 4). */
  readonly deadline: string | null;
  readonly ownOptionCount: number;
  readonly goalPathFactorCount: number;
  readonly riskCount: number;
  readonly outcomeCount: number;
  readonly limitCount: number;
  /** The risks door’s own current availability, not a second eligibility rule. */
  readonly risksAvailability: 'run' | 'no_goal' | 'omit';
  /** Every RC row eligible on this state after RC's own cooldown, in RC's order. */
  readonly rcRows: readonly SelectedRow[];
  /** The S1 card a Strengthen press would hold (`strengthenCardFor`). */
  readonly strengthenCard: boolean;
  /** The review's own F5 link, when its test is not refused first. */
  readonly testLink: { readonly from_id: string; readonly to_id: string } | null;
}

const hash16 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/**
 * The bar's identity: scenario + model revision, plus the goal's date, which the analysis-affecting `graph_hash` does
 * not cover but an offer's words do (the pre-mortem names it; Codex r1 P2-5 on #2751). A changed graph, Run or date
 * gives a different key.
 */
export function stateKeyOf(scenarioId: string, revision: ActionRevision, deadline: string | null = null): string {
  return hash16(['action_bar', 1, scenarioId, revision.graph_hash, revision.run_key, deadline]);
}

/** True unless the carrier embeds an Agent proposal whose content no longer hashes to its own id. */
function agentCarrierIntact(inlinePatch: unknown): boolean {
  const p = rec(rec(inlinePatch)?.agent_proposal);
  if (p === undefined) return true;
  if (typeof p.proposal_id !== 'string') return false;
  const { proposal_id: id, ...content } = p;
  try { return computeProposalId(content as Parameters<typeof computeProposalId>[0]) === id; } catch { return false; }
}

/**
 * Whether an APPROVAL CARD waits for the user's yes in the latest pending carrier (the DL's "consent first": the standing
 * gap yields to it). An approval is a typed approval (`typedApprovalOf`: a `prop_` or `gmh_` proposal, carried either as
 * its approve chip or, for a product hold, as its own id), alive by the ONE read-time liveness authority
 * (`isPendingActionExpired`, as the reload's own held-offer and answer-offer reads use it; Codex r1 P2-3 on #2766: the
 * carry-forward survival rule decrements first and so drops an approval a turn early), and offered on THIS model
 * revision (its `graph_hash` precondition). A goal-scope question is not an approval card (Codex r1 P1-2). Both egresses
 * pass the latest PERSISTED carrier (Codex r1 P1-1), so the live bar and the reload bar agree.
 */
export function approvalWaitingOf(pending: readonly PendingAction[], graphHash: string | undefined, nowMs = Date.now()): boolean {
  return pending.some((pa) => {
    const typed = typedApprovalOf({ chip: { id: pa.chip_id } }) ?? typedApprovalOf({ chip: { id: approvalChipIdFor(pa.chip_id) } });
    if (typed === undefined || isPendingActionExpired(pa, nowMs)) return false;
    // An Agent proposal's carrier must still hash to its id, the rule `rehydrateProposals` applies before any card is
    // served from it (Codex r2 P2 on #2766): a carrier the card reader refuses never displaces the standing gap.
    if (pa.action.kind === 'apply_proposed_change' && !agentCarrierIntact(pa.action.inline_patch)) return false;
    const offeredOn = pa.preconditions.graph_hash;
    return offeredOn === undefined || graphHash === undefined || offeredOn === graphHash;
  });
}

/** The facts the bar ranks on. An unreadable model offers no model-dependent action. */
export function actionFactsOf(read: ActionRead): ActionFacts {
  const runChip = runExplanationChip(read.scenarioId, { graphHash: read.graphHash, analysisState: read.analysisState, analysisResult: read.analysisResult });
  const runKey = runChip === null ? null : runChip.id.slice(RUN_EXPLANATION_PREFIX.length);
  const revision: ActionRevision = { graph_hash: typeof read.graphHash === 'string' && read.graphHash !== '' ? read.graphHash : null, run_key: runKey };
  const ready = rec(read.analysisReady);
  const raw = rec(read.graph);
  const goal = soleGoalOf(read.graph);
  const deadline = goalDeadlineOf(goal) ?? null;
  const base = {
    scenarioId: read.scenarioId, revision, stateKey: stateKeyOf(read.scenarioId, revision, deadline), runBound: runKey !== null,
    approvalWaiting: approvalWaitingOf(read.pending ?? [], read.graphHash),
    runStale: rec(rec(read.analysisState)?.run_state)?.kind === 'complete_stale',
    runAdmissible: typeof ready?.may_run === 'boolean' ? ready.may_run : ready?.status === 'ready',
  };
  const unread: ActionFacts = { ...base, readable: false, goalPresent: false, goalLabel: '', goalKind: null, targetPresent: false, deadline: null, ownOptionCount: 0,
    estimateCandidates: [], estimateDriverIds: [], canonicalStage: null, goalPathFactorCount: 0, riskCount: 0, outcomeCount: 0, limitCount: 0, risksAvailability: 'omit', rcRows: [], strengthenCard: false, testLink: null };
  if (raw === undefined || !Array.isArray(raw.nodes)) return unread;
  const nodes = raw.nodes.map(rec);
  try {
    const signals = assembleGuidanceSignals({
      request: 'turn', offeredSpecific: [], graph: read.graph, analysisState: read.analysisState, analysisResult: read.analysisResult,
      optionParticipation: read.optionParticipation,
      identityEvaluations: [...(read.identityEvaluated ?? [])].sort().map((node_id) => ({ node_id, evaluated: true })),
      guidance: read.guidance ?? {}, explicitRequest: null,
      leaderLicensed: guidanceLeaderLicensed(leaderLicenceFromState(read.analysisState, read.analysisReady)),
    });
    const selectorSignals = selectorSignalsOf(signals, null, runKey ?? undefined);
    const risks = risksTurnForReadback(read);
    const constraints = Array.isArray(raw.goal_constraints) ? raw.goal_constraints.map(rec) : [];
    return {
      ...base,
      readable: true,
      canonicalStage: canonicalStageOf(signals['run.kind'], read.graph),
      estimateCandidates: signals['model.goal_path_factors'].flatMap(f => {
        if (f.value_authorship !== 'olumi_estimate' && f.value_authorship !== 'olumi_accepted') return [];
        const node = nodes.find(n => n?.id === f.factor_id);
        if (node === undefined) return [];
        const unit = rec(node.observed_state)?.unit;
        const value = keptFigureFor(node, typeof unit === 'string' ? unit : '');
        if (value === undefined || !displayScaleEstablished(value, rec(node.observed_state)?.value, unit)) return [];
        return [{ ...f, figure: proposalFigure(value, unit) }];
      }),
      estimateDriverIds: runKey === null ? [] : goalChanceDriversForAgent(read.analysisResult, read.graph)
        .flatMap(({ driver }) => driver.kind === 'factor_value' && driver.authored_by === 'olumi' ? [driver.factor_id as string] : []),
      // RC's own goal read (slice 1 unchanged); the goal's kind, target, label and date come from the SOLE goal only.
      goalPresent: signals['model.goal_present'],
      goalLabel: typeof goal?.label === 'string' ? goal.label : '',
      goalKind: goal === undefined ? null : goalKindOf(goal),
      targetPresent: goal !== undefined && statedGoalTargetOf(raw, goal) !== null,
      deadline,
      ownOptionCount: signals['model.non_sq_option_ids'].length,
      goalPathFactorCount: signals['model.goal_path_factor_ids'].length,
      riskCount: signals['model.risk_ids'].length,
      outcomeCount: raw.nodes.map(rec).filter(n => n?.kind === 'outcome').length,
      limitCount: constraints.filter(c => c !== undefined && c.node_id !== goal?.id && !('deadline_metadata' in c)).length,
      risksAvailability: risks.kind === 'run_risks' ? 'run' : risks.reason === 'no_goal' ? 'no_goal' : 'omit',
      rcRows: eligibleGuidanceRows(selectorSignals, selectorSignals.guidance ?? {}),
      strengthenCard: strengthenCardFor({ graph: read.graph, analysisState: read.analysisState, analysisResult: read.analysisResult,
        optionParticipation: read.optionParticipation, ...(read.identityEvaluated !== undefined ? { identityEvaluated: read.identityEvaluated } : {}) }) !== null,
      testLink: runKey === null ? null : testableFragileLinkOf(read.graph, read.analysisState, read.analysisReady, read.analysisResult) ?? null,
    };
  } catch {
    return unread;
  }
}

/**
 * Whether the figure the keep reader returns is the figure the canvas shows (Codex r2 P1 on #2766). On a percent unit a
 * stored pair `{ value: 0.25, raw_value: 0.25 }` round-trips the writer as 0.25 but the canvas reads the fraction as
 * 25%: the display scale is ambiguous, so the point is excluded (fail-closed) rather than said 100× too low. A percent
 * figure at most 1 is kept only when it IS the normalised value × 100 (a genuine 0.25% is stored as 0.0025).
 */
function displayScaleEstablished(figure: number, value: unknown, unit: unknown): boolean {
  if (typeof unit !== 'string' || !isPercentScaledUnit(unit) || Math.abs(figure) > 1) return true;
  return typeof value === 'number' && Math.abs(value * 100 - figure) <= 1e-9 * Math.max(1, Math.abs(figure));
}

export interface EstimatePoint {
  readonly factor_id: string;
  readonly label: string;
  readonly figure: string;
  readonly authorship: ValueAuthorship;
  readonly via: 'driver' | 'goal_path' | 'shown_first';
}

/**
 * ONE selection, at most three. No influence stability licence exists, so the remainder uses Strengthen's goal
 * distance/id order. run_delta value rows carry amounts, not both ends' authorship or proof of presentation; Run input
 * snapshots carry source plus an opaque authorship digest, not a shown-to-user receipt. Pending proposals record the
 * held change, not a persisted prefilled-and-edited pair. None proves rule (ii): user/unknown figures stay excluded.
 */
export function estimatePointsOf(f: ActionFacts): EstimatePoint[] {
  const candidates = f.estimateCandidates.filter(p => p.value_authorship === 'olumi_estimate' || p.value_authorship === 'olumi_accepted');
  const nearest = [...candidates].sort((a, b) => a.goal_distance - b.goal_distance
    || (a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0));
  const driverIds = new Set(f.estimateDriverIds);
  const ordered = [...f.estimateDriverIds.flatMap(id => candidates.filter(p => p.factor_id === id)), ...nearest];
  const seen = new Set<string>();
  return ordered.filter(p => {
    if (seen.has(p.factor_id)) return false;
    seen.add(p.factor_id);
    return true;
  }).slice(0, 3)
    .map(p => ({ factor_id: p.factor_id, label: p.label, figure: p.figure, authorship: p.value_authorship,
      via: driverIds.has(p.factor_id) ? 'driver' : 'goal_path' }));
}
