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
 * Read from BOTH carriers (#1983 review B1′): the bound graph's option nodes AND the bound
 * run's own `analysis_ready.options`, because the graph a card holds may carry no option
 * interventions (`bound-graph.ts` `everyLimitProvedUnanchored` reads the run's options for
 * the same reason). Either one naming the node silences the card.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { collectInterventionControlledFactorIds } from '../context/intervention-controlled-drivers.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { readRatifiedConstraints, type StoredLimitVerdicts } from '../../orchestrator/context/constraint-feasibility.js';
import { sayLevel } from './bound-graph.js';
import {
  ELICITATION_CLOSE,
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
  return estimatedLimitForConstraint(graph, ratified[0]!);
}

/**
 * One ratified limit joined by identity to its node, when that node's level is not the user's own figure; null when
 * the node is missing, duplicated, unlabelled, carries no usable level, or the limit's unit is not the node's own.
 */
function estimatedLimitForConstraint(
  graph: Record<string, unknown>,
  ratified: { readonly constraint_id: string; readonly node_id?: string | null; readonly unit?: unknown },
): EstimatedLimit | null {
  if (!Array.isArray(graph.nodes)) return null;
  const nodeId = ratified.node_id;
  if (nodeId === null || nodeId === undefined || nodeId.length === 0) return null;
  const matches = graph.nodes.filter((n) => readRecord(n)?.id === nodeId);
  if (matches.length !== 1) return null;
  const node = readRecord(matches[0])!;
  // ⛔ A check Olumi cannot cite: a limit whose unit is not the node's own (e.g. "£k" on a "£" node, ×1000) was not
  // checked in the unit it states. A RELABELLED limit is exempt: the relabel is what framed it (MG #70 5856264807 —
  // 17d1's "%" reached ISL as 0.04), so "checked against …" is true there (AI Quality 5856373468).
  const row = (Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [])
    .map(readRecord).find((r) => r?.constraint_id === ratified.constraint_id);
  const nodeUnit = readRecord(node.observed_state)?.unit;
  const limitUnit = ratified.unit;
  if (row?.provenance_unit_relabelled === undefined && typeof limitUnit === 'string' && typeof nodeUnit === 'string'
    && limitUnit.trim() !== nodeUnit.trim()) return null;
  const level = levelOf(readRecord(node.observed_state));
  const label = typeof node.label === 'string' ? node.label.trim() : '';
  const kind = typeof node.kind === 'string' && TARGETABLE_NODE_KINDS.includes(node.kind) ? node.kind : null;
  return level !== null && label.length > 0 ? { nodeId, kind, label, ...level } : null;
}

/** The per-limit verdict reason (#2146) each `whose` must agree with: two facts, one answer, or no card. */
const WHOSE_BY_REASON: Readonly<Record<string, EstimatedLimit['whose']>> = {
  level_olumi_estimate: 'olumi',
  level_user_assumption: 'ratified',
};

/**
 * B5 (#2146): the limit the run CHECKED only against a figure that is not the user's, from the per-limit verdicts'
 * OWN rows (`state: 'estimate_only'`), never from the aggregate. Joined by `constraint_id` to the bound graph's
 * ratified limit and its node; the row's reason and the node's value source must name the same owner; a factor an
 * option sets is not this card (its level is the option's, not today's). When several qualify, the one on the factor
 * the result depends on most (PLoT's `importance_rank`) — one card, the consequential one. Pure; null otherwise.
 */
export function estimatedLimitFromVerdicts(
  graph: Record<string, unknown> | null,
  perLimit: StoredLimitVerdicts,
  runOptions: unknown,
  analysisResult: unknown,
): EstimatedLimit | null {
  if (graph === null) return null;
  const ratified = readRatifiedConstraints(graph);
  const controlled = new Set([
    ...collectInterventionControlledFactorIds(graph),
    ...collectInterventionControlledFactorIds({ options: runOptions }),
  ]);
  const rankOf = new Map<string, number>();
  const rows = readRecord(readRecord(analysisResult)?.enrichment)?.factor_sensitivity;
  for (const r of Array.isArray(rows) ? rows.map(readRecord) : []) {
    if (typeof r?.factor_id === 'string' && typeof r.importance_rank === 'number') rankOf.set(r.factor_id, r.importance_rank);
  }
  const candidates: EstimatedLimit[] = [];
  for (const verdict of perLimit.per_limit) {
    if (verdict.state !== 'estimate_only') continue;
    const whose = verdict.reason !== undefined ? WHOSE_BY_REASON[verdict.reason] : undefined;
    const limitRow = ratified.find((c) => c.constraint_id === verdict.constraint_id);
    if (whose === undefined || limitRow === undefined) continue;
    const limit = estimatedLimitForConstraint(graph, limitRow);
    if (limit === null || limit.whose !== whose || controlled.has(limit.nodeId)) continue;
    candidates.push(limit);
  }
  const rank = (l: EstimatedLimit): number => rankOf.get(l.nodeId) ?? Number.POSITIVE_INFINITY;
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * The ask plus {@link ELICITATION_CLOSE}: the first form within the contract's prompt bound (the basis clause is the
 * one that yields), so a long label shortens the ask rather than refusing the card.
 */
function elicitationPrompt(lead: string): string {
  const forms = [
    `${lead} Ask me what the real figure is and what it rests on. ${ELICITATION_CLOSE}`,
    `${lead} Ask me what the real figure is. ${ELICITATION_CLOSE}`,
  ];
  return forms.find((f) => f.length <= RUN_TURN_COACHING_CONTRACT.limits.action_prompt_max) ?? forms[forms.length - 1]!;
}

/** The title when no form naming the limit and its figure fits `title_max`; the body still names both. */
export const ESTIMATED_LIMIT_FALLBACK_TITLE = 'Check the figure your limit was checked against';

/**
 * The first title form within the contract's bound. The Reasoning tab's "Challenge the thinking" shows the TITLE
 * alone (Paul's test 27 Sep, Panel S3), so the title names the limit and the figure it was checked against; a long
 * label or level falls back to a shorter form, never refusing the card.
 */
function titleNamingIt(forms: readonly string[]): string {
  return forms.find((f) => f.length <= RUN_TURN_COACHING_CONTRACT.limits.title_max) ?? ESTIMATED_LIMIT_FALLBACK_TITLE;
}

/** The card's words. */
export function composeEstimatedLimitCard(limit: EstimatedLimit): FragileLinkChallengeCopy {
  if (limit.whose === 'ratified') {
    return {
      title: titleNamingIt([
        `Your “${limit.label}” limit was checked against an assumed ${limit.level}`,
        `“${limit.label}” limit checked against an assumed ${limit.level}`,
        `Your limit was checked against an assumed ${limit.level}`,
      ]),
      body: `Your limit on “${limit.label}” was checked against about ${limit.level} today, a figure recorded `
        + 'as an assumption rather than a measurement. If you know the real figure, it is worth saying.',
      action_label: 'Give the real figure',
      action_prompt: elicitationPrompt(`Olumi checked my limit on “${limit.label}” against about ${limit.level} today, a figure `
        + 'recorded as an assumption.'),
    };
  }
  return {
    title: titleNamingIt([
      `Your “${limit.label}” limit was checked against Olumi's estimate of ${limit.level}`,
      `“${limit.label}” limit checked against Olumi's estimate of ${limit.level}`,
      `Your limit was checked against Olumi's estimate of ${limit.level}`,
    ]),
    body: `Your limit on “${limit.label}” was checked against Olumi's estimate that it is about ${limit.level} `
      + 'today, not a figure you gave. If you know the real figure, it is worth saying.',
    action_label: 'Give the real figure',
    action_prompt: elicitationPrompt(`Olumi checked my limit on “${limit.label}” against its estimate that it is about `
      + `${limit.level} today.`),
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
  /** The bound run's `analysis_ready.options` (their interventions); unknown shape → no ids. */
  runOptions: unknown,
  /**
   * B5 (#2146): the SAME read's per-limit verdicts (`readLimitVerdicts`). When attested they are the authority —
   * each limit's own row, not the aggregate — and several limits are fine; absent → the aggregate path, unchanged.
   */
  perLimit: StoredLimitVerdicts | null = null,
): EstimatedLimitCardDecision {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }
  if (perLimit === null && verdictState !== EVALUATED_FEASIBLE) return { block: null, reason: 'not_checked_against_an_estimate' };
  const limit = perLimit !== null
    ? estimatedLimitFromVerdicts(boundGraph, perLimit, runOptions, result)
    : estimatedLimitIn(boundGraph);
  if (limit === null) return { block: null, reason: 'not_checked_against_an_estimate' };
  // An option that sets this factor was checked at its own level, never today's (see above).
  if (
    collectInterventionControlledFactorIds(boundGraph).has(limit.nodeId)
    || collectInterventionControlledFactorIds({ options: runOptions }).has(limit.nodeId)
  ) {
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
