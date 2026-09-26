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
 *   · The HASH-BOUND graph (`coaching/bound-graph.ts`): exactly ONE limit node
 *     whose `observed_state.source === 'cee_inference'` and whose
 *     `raw_value` (schemas: "the same level as `value`, in the units `unit`
 *     names") is a finite number. Joined by `goal_constraints[].node_id`.
 * The only number it says is that node's own level. Never "you said".
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
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
/** The observed-state source a level Olumi supplied carries. */
export const OLUMI_ESTIMATE_SOURCE = 'cee_inference';

/** Node kinds a target ref may name (`TargetRefKind`, schemas boundary). */
const TARGETABLE_NODE_KINDS: readonly string[] = Object.freeze(['factor', 'goal', 'risk', 'outcome']);

export interface EstimatedLimit {
  readonly nodeId: string;
  /** The node's own kind when a target ref may name it; null → the card carries no target. */
  readonly kind: string | null;
  readonly label: string;
  /** e.g. "7% per month" — the node's own level in its own units. */
  readonly level: string;
}

function levelOf(observed: Record<string, unknown> | null): string | null {
  if (observed === null || observed.source !== OLUMI_ESTIMATE_SOURCE) return null;
  const raw = observed.raw_value;
  const unit = typeof observed.unit === 'string' ? observed.unit.trim() : '';
  if (typeof raw !== 'number' || !Number.isFinite(raw) || unit === '') return null;
  return sayLevel(raw, unit);
}

/**
 * THE one limit node whose level is Olumi's estimate, joined by identity; null when
 * there is no such node, or more than one (one next action names one figure).
 */
export function estimatedLimitIn(graph: Record<string, unknown> | null): EstimatedLimit | null {
  if (graph === null || !Array.isArray(graph.goal_constraints) || !Array.isArray(graph.nodes)) return null;
  const nodeIds = [...new Set(graph.goal_constraints.map((r) => readRecord(r)?.node_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const found: EstimatedLimit[] = [];
  for (const nodeId of nodeIds) {
    const matches = graph.nodes.filter((n) => readRecord(n)?.id === nodeId);
    if (matches.length !== 1) continue;
    const node = readRecord(matches[0])!;
    const level = levelOf(readRecord(node.observed_state));
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    const kind = typeof node.kind === 'string' && TARGETABLE_NODE_KINDS.includes(node.kind) ? node.kind : null;
    if (level !== null && label.length > 0) found.push({ nodeId, kind, label, level });
  }
  return found.length === 1 ? found[0]! : null;
}

/** The card's words. */
export function composeEstimatedLimitCard(limit: EstimatedLimit): FragileLinkChallengeCopy {
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
  | { readonly block: null; readonly reason: 'not_checked_against_an_estimate' | 'identity_mismatch' | 'copy_gate' };

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

  const copy = composeEstimatedLimitCard(limit);
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };
  const trigger: RunTurnTrigger =
    input.trigger === 'auto_first_pass' || isAutomaticRun(readRecord(result.enrichment)) ? 'auto_first_pass' : 'explicit_run';
  const signalId = `${ESTIMATED_LIMIT_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${trigger}`;
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
