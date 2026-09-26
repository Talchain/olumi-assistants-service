/**
 * A LIMIT CHECKED AGAINST OLUMI'S OWN ESTIMATE — the run-turn card for a limit
 * the analysis DID check, but only against a level Olumi supplied (AI Quality
 * 5842174563; carrier accepted by Canonical State 5842184546).
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 * When a limit becomes scoreable (Paul's churn), the check holds the limit's
 * quantity at ONE figure. On Paul's brief that figure is Olumi's estimate
 * ("7% per month", `observed_state.source: 'cee_inference'`), not his. A
 * "checked" limit then rests on an assumption the user never saw named. The
 * one honest next move is to say which figure it was checked against, and to
 * ask for the real one.
 *
 * ── WHAT IT READS (typed only) ─────────────────────────────────────────────
 *   · the READBACK's verdict state `=== 'evaluated_feasible'`: the graph read's
 *     top-level `analysis_constraint_verdict_state`, read from the same fact as
 *     `analysis_result` and carried as `final.constraintVerdictState` (Canonical
 *     5842397050). Absent/null → no card: "evaluated" is never derived from
 *     `withheld_reason`.
 *   · The HASH-BOUND graph (`coaching/bound-graph.ts`) carries exactly ONE ratified
 *     limit, read by the verdict's own reader (`readRatifiedConstraints`), and its
 *     node's level is NOT the user's own figure and whose `raw_value` (schemas:
 *     "the same level as `value`, in the units `unit` names") is a finite
 *     number. Joined by `goal_constraints[].node_id`. Whose figure it is comes
 *     from the ONE authority, `classifyValueSource(observed_state.source)`:
 *       - `ai_drafted` / `system_repaired` → Olumi's estimate ("not a figure you gave");
 *       - `user_ratified` → a figure the user adopted or confirmed, e.g. Paul's served
 *         churn level `user_assumption` (AI Quality 5844723106). Never "not a figure
 *         you gave": the user may have typed it into the starting point;
 *       - `user_stated` / `unattributed` → no card.
 * The only number it says is that node's own level. Never "you said".
 *
 * ── WHY EXACTLY ONE LIMIT (#1983 review B1) ────────────────────────────────
 * The carried verdict state is an AGGREGATE. `evaluated_feasible` proves that every
 * limit left AFTER the producer's filter (`_meta.filtered_constraints`) and the
 * unmeasured partition was scored — not that THIS limit was. With two limits, PLoT can
 * drop one (any limit carrying `deadline_metadata`), score the other, and the state is
 * still `evaluated_feasible`: a "was checked" card would then be false. With exactly one
 * ratified limit, a filtered or unmeasured row leaves nothing to score, and
 * `deriveConstraintVerdict` returns `not_applicable` (step 0), never
 * `evaluated_feasible`. So on a one-limit graph the state proves that limit was scored.
 * More than one limit → no card, until the scored ids are carried beside the state.
 *
 * ── WHY AN OPTION THAT SETS THE LIMIT'S FACTOR SILENCES IT (#1983 review B1, AI Quality) ──
 * An option that SETS the limited factor is checked at the level IT sets, not at today's
 * level (ISL #179: "an option that SETS a limit's target is compared at the level it
 * sets"). With a price cap and a "raise to £59" option, that option was checked at the
 * user's £59, so "checked against Olumi's estimate of about £49" is false for it, and the
 * card's ask ("give the real figure") cannot change its check. When ANY option intervenes
 * on the limit's node, read by the one structural authority
 * (`collectInterventionControlledFactorIds`, every shape unioned), there is no card.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { collectInterventionControlledFactorIds } from '../context/intervention-controlled-drivers.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { readRatifiedConstraints } from '../../orchestrator/context/constraint-feasibility.js';
import { sayLevel } from './bound-graph.js';
import {
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  isAutomaticRun,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
  type RunTurnTrigger,
} from './fragile-link-challenge.js';

export const ESTIMATED_LIMIT_SIGNAL_ID_PREFIX = 'coach:limit_estimate:';
/** The one verdict this card speaks on (`ConstraintVerdictState`, constraint-feasibility.ts). */
export const EVALUATED_FEASIBLE = 'evaluated_feasible';
/** The observed-state source a level Olumi supplied carries (one of the `ai_drafted` stamps). */
export const OLUMI_ESTIMATE_SOURCE = 'cee_inference';
/** The signal suffix of the ratified arm; Olumi's own estimate keeps the bare signal. */
export const RATIFIED_SIGNAL_SUFFIX = ':ratified';

/** Node kinds a target ref may name (`TargetRefKind`, schemas boundary). */
const TARGETABLE_NODE_KINDS: readonly string[] = Object.freeze(['factor', 'goal', 'risk', 'outcome']);

export interface EstimatedLimit {
  readonly nodeId: string;
  /** The node's own kind when a target ref may name it; null → the card carries no target. */
  readonly kind: string | null;
  readonly label: string;
  /** e.g. "7% per month" — the node's own level in its own units. */
  readonly level: string;
  /** Whose figure the level is: Olumi's estimate, or one the user adopted/confirmed. */
  readonly whose: 'olumi' | 'ratified';
}

/** Whose figure a level is, from the one value-source authority. The user's own, or unknown → null. */
function whoseLevel(source: unknown): EstimatedLimit['whose'] | null {
  const klass = classifyValueSource(source);
  switch (klass) {
    case 'ai_drafted':
    case 'system_repaired':
      return 'olumi';
    case 'user_ratified':
      return 'ratified';
    case 'user_stated':
    case 'unattributed':
      return null;
    default: {
      const unreachable: never = klass;
      return unreachable;
    }
  }
}

function levelOf(observed: Record<string, unknown> | null): { level: string; whose: EstimatedLimit['whose'] } | null {
  if (observed === null) return null;
  const whose = whoseLevel(observed.source);
  if (whose === null) return null;
  const raw = observed.raw_value;
  const unit = typeof observed.unit === 'string' ? observed.unit.trim() : '';
  if (typeof raw !== 'number' || !Number.isFinite(raw) || unit === '') return null;
  return { level: sayLevel(raw, unit), whose };
}

/**
 * THE run's one ratified limit, joined by identity to its node, when that node's level is
 * not the user's own figure; null when the graph carries no ratified limit or more than one
 * (see WHY EXACTLY ONE LIMIT), or when the node is missing, duplicated, unlabelled or
 * carries no usable level.
 */
export function estimatedLimitIn(graph: Record<string, unknown> | null): EstimatedLimit | null {
  if (graph === null || !Array.isArray(graph.nodes)) return null;
  const ratified = readRatifiedConstraints(graph);
  if (ratified.length !== 1) return null;
  const nodeId = ratified[0]!.node_id;
  if (nodeId === null || nodeId === undefined || nodeId.length === 0) return null;
  const matches = graph.nodes.filter((n) => readRecord(n)?.id === nodeId);
  if (matches.length !== 1) return null;
  const node = readRecord(matches[0])!;
  const level = levelOf(readRecord(node.observed_state));
  const label = typeof node.label === 'string' ? node.label.trim() : '';
  const kind = typeof node.kind === 'string' && TARGETABLE_NODE_KINDS.includes(node.kind) ? node.kind : null;
  return level !== null && label.length > 0 ? { nodeId, kind, label, ...level } : null;
}

/** The card's words. */
export function composeEstimatedLimitCard(limit: EstimatedLimit): FragileLinkChallengeCopy {
  if (limit.whose === 'ratified') {
    return {
      title: 'Check the figure your limit was checked against',
      body: `Your limit on “${limit.label}” was checked against about ${limit.level} today, a figure recorded `
        + 'as an assumption rather than a measurement. If you know the real figure, it is worth saying.',
      action_label: 'Give the real figure',
      action_prompt: `Olumi checked my limit on “${limit.label}” against about ${limit.level} today, a figure recorded `
        + 'as an assumption. Ask me what the real figure is and what it rests on. Don\'t change the model or re-run anything yet.',
    };
  }
  return {
    title: 'Check the figure your limit was checked against',
    body: `Your limit on “${limit.label}” was checked against Olumi's estimate that it is about ${limit.level} `
      + 'today, not a figure you gave. If you know the real figure, it is worth saying.',
    action_label: 'Give the real figure',
    action_prompt: `Olumi checked my limit on “${limit.label}” against its estimate that it is about ${limit.level} `
      + 'today. Ask me what the real figure is and what it rests on. Don\'t change the model or re-run anything yet.',
  };
}

export type EstimatedLimitCardDecision =
  | { readonly block: CoachingBlock; readonly reason: null }
  | {
    readonly block: null;
    readonly reason: 'not_checked_against_an_estimate' | 'limit_target_set_by_an_option' | 'identity_mismatch' | 'copy_gate';
  };

/**
 * Build the one estimated-limit card, or say why not. Total. `verdictState` is the
 * READBACK's verdict state (`final.constraintVerdictState`); `boundGraph` is the graph
 * proven to be the run's own (null otherwise).
 */
export function buildEstimatedLimitCard(
  input: FragileLinkChallengeInput,
  verdictState: unknown,
  boundGraph: Record<string, unknown> | null,
): EstimatedLimitCardDecision {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }
  if (verdictState !== EVALUATED_FEASIBLE) return { block: null, reason: 'not_checked_against_an_estimate' };
  const limit = estimatedLimitIn(boundGraph);
  if (limit === null) return { block: null, reason: 'not_checked_against_an_estimate' };
  // An option that sets this factor was checked at its own level, never today's (see above).
  if (collectInterventionControlledFactorIds(boundGraph).has(limit.nodeId)) {
    return { block: null, reason: 'limit_target_set_by_an_option' };
  }

  const copy = composeEstimatedLimitCard(limit);
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };
  const trigger: RunTurnTrigger =
    input.trigger === 'auto_first_pass' || isAutomaticRun(readRecord(result.enrichment)) ? 'auto_first_pass' : 'explicit_run';
  const signalId = `${ESTIMATED_LIMIT_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${trigger}`
    + (limit.whose === 'ratified' ? RATIFIED_SIGNAL_SUFFIX : '');
  const parsed = CoachingBlockSchema.safeParse({
    type: 'coaching',
    coaching_kind: 'assumption_check',
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: input.computedAt,
    source_handler: RUN_TURN_COACHING_CONTRACT.block.source_handler,
    graph_hash_at_generation: input.graphHash,
    freshness: 'fresh',
    source: RUN_TURN_COACHING_CONTRACT.block.source,
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    target_refs: limit.kind !== null ? [{ kind: limit.kind, id: limit.nodeId, label: limit.label }] : [],
    ...copy,
  });
  return parsed.success ? { block: parsed.data, reason: null } : { block: null, reason: 'copy_gate' };
}
