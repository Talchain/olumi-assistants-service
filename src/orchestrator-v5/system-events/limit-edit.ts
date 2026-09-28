/**
 * SLICE C2 — the limit edit: a new figure for a limit the model ALREADY holds. Canonical State ruling #70 5855234599.
 *
 * Paul's served test (27 Sep, export 08bf9a1f): he said the budget rose to £30k, and the Agent answered "I can't
 * update that budget constraint with the available model actions". The product has the writer — `add_constraint`
 * updates a `goal_constraints` row in place, keyed (node_id, operator) — but the only typed route to it the Agent could
 * reach is goal-only (`goal_target_edit`), and the chat chip route applies on click with no base hash and drops the
 * row's frame. This is `applyGoalTargetEdit`'s machinery (`goal-target-edit.ts`) with the goal-only check REPLACED:
 *
 *   · the SAME analysis-space stale gate on the raw persisted bytes, BEFORE anything is resolved (→ a typed conflict);
 *   · the target: EXACTLY ONE node, NOT an option (and not a decision), and NOT the goal — a goal's target is
 *     `goal_target_edit`'s, and a second route to it would be a second authority;
 *   · the row: EXACTLY ONE EXISTING `goal_constraints` row keyed (node_id, operator). This path never creates a limit;
 *   · the SAME proposal, validator, `add_constraint` handler and re-merge (`applyConstraintEditThroughAddConstraint`),
 *     given the row's OWN unit and label (the handler would otherwise fall back to the node's unit and retitle the row)
 *     and relaying the row's OWN `value_frame` through the handler's side-band — the handler keeps a frame only for an
 *     unchanged figure, so a new figure would otherwise land unframed and ISL would refuse the limit;
 *   · then the written row is CHECKED, not trusted: the same constraint_id and operator, exactly the new value, the
 *     row's unit and value_frame unchanged, and `provenance: 'explicit'` — the user's own figure (the user approved it;
 *     `admit-constraint.ts` reads 'explicit' as user-authored). Anything else is refused with nothing written.
 *   · ⭐ A2 follow-up (DL verdict on #2180): the comparator as the user stated it. A new figure alone KEEPS the row's
 *     `operator_as_stated` ("under 4%" → "under 5%"; `add_constraint` carries it). A comparator the user STATED on this
 *     edit (`stated_operator`, typed by the Agent, same direction as the row) is relayed through the handler's side-band
 *     and replaces it: "at most" clears it, "less than" sets it. The written row is checked for that comparator too.
 *
 * This file owns no mutation logic: every byte it could write is written by `add_constraint`.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { GraphV3 } from '../../schemas/cee-v3.js';
import { statedOperatorOf, type CandidateOperator } from '../agent-lane/admit-constraint.js';
import { log } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { FRACTION_SPELLED_UNIT } from '../coaching/bound-graph.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import {
  applyConstraintEditThroughAddConstraint,
  InvalidPersistedGoalTargetGraphError,
  type GoalTargetEditResult,
} from './goal-target-edit.js';

export interface LimitEditRequest {
  readonly node_id: string;
  readonly operator: '<=' | '>=';
  /** The new figure, in the row's own unit. */
  readonly raw_value: number;
  /** The analysis-space hash of the model the user approved against. */
  readonly base_graph_hash: string;
  /**
   * A2 follow-up: the comparator the user STATED for the limit on this edit, when they stated one (typed, never from
   * words), in the row's direction: `<`/`<=` for a `<=` row, `>`/`>=` for a `>=` row. ABSENT for a new figure alone,
   * which keeps the row's own `operator_as_stated`.
   */
  readonly stated_operator?: CandidateOperator;
}

export interface ApplyLimitEditParams {
  readonly payload: Pick<SystemEventTurnPayload, 'scenario_id' | 'turn_id' | 'stage'>;
  readonly request: LimitEditRequest;
  readonly requestId: string;
  readonly persistedGraph: unknown;
  readonly priorFacts: readonly HandlerFact[];
}

const refused = (reason: string): GoalTargetEditResult => ({ kind: 'refused', reason });

type Row = { constraint_id?: unknown; node_id?: unknown; operator?: unknown; operator_as_stated?: unknown; value?: unknown; unit?: unknown; value_frame?: unknown; label?: unknown; provenance?: unknown };
/** The held operator a stated comparator is the twin of (`<` → `<=`, `>` → `>=`). */
const heldOf = (op: CandidateOperator): '<=' | '>=' => (op === '<' || op === '<=' ? '<=' : '>=');
const rowsOf = (g: unknown): Row[] => {
  const raw = g !== null && typeof g === 'object' ? (g as { goal_constraints?: unknown }).goal_constraints : undefined;
  return Array.isArray(raw) ? raw.filter((c): c is Row => c !== null && typeof c === 'object') : [];
};

export async function applyLimitEdit(params: ApplyLimitEditParams): Promise<GoalTargetEditResult> {
  const { payload, request, requestId, persistedGraph, priorFacts } = params;
  const logBase = { request_id: requestId, scenario_id: payload.scenario_id, node_id: request.node_id, operator: request.operator };

  // ── 1. a base we can trust, or nothing ───────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) return refused('no_persisted_graph');
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error({ ...logBase, event: 'v5.system_event.limit_edit.persisted_graph_invalid' }, 'limit_edit — non-null persisted graph is malformed; failing closed');
    throw new InvalidPersistedGoalTargetGraphError();
  }
  const graph = graphParse.data;

  // ── 2. THE ANALYSIS-SPACE STALE GATE, before anything is resolved (raw bytes, as goal_target_edit) ─────
  const currentBaseHash = computeAnalysisAffectingGraphHash(persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);
  if (currentBaseHash === null || currentBaseHash !== request.base_graph_hash) {
    log.info({ ...logBase, event: 'v5.system_event.limit_edit.base_hash_diverged', server_base_graph_hash: currentBaseHash },
      'limit_edit — base hash diverged from the persisted graph; refusing');
    return {
      kind: 'base_hash_diverged',
      conflict: { recovery_action: 'refresh_and_reconfirm', conflict_category: BASE_HASH_DIVERGED, expected_base_graph_hash: currentBaseHash },
    };
  }

  // ── 3. the target, BY ID: one node, a quantity — never an option, a decision or the goal ─────────────
  const matches = graph.nodes.filter((n) => n.id === request.node_id);
  if (matches.length !== 1) return refused(matches.length === 0 ? 'target_not_found' : 'target_ambiguous');
  const kind = matches[0]!.kind;
  if (kind === 'option') return refused('target_is_option');
  if (kind === 'decision') return refused('target_is_decision');
  if (kind === 'goal') return refused('target_is_goal');

  // ── 3b. the row: EXACTLY ONE EXISTING (node_id, operator) row — this path changes a limit, never adds one ──
  const rows = rowsOf(persistedGraph).filter((c) => c.node_id === request.node_id && c.operator === request.operator);
  if (rows.length === 0) return refused('no_existing_limit');
  if (rows.length > 1) return refused('limit_ambiguous');
  const row = rows[0]!;
  const unit = typeof row.unit === 'string' && row.unit !== '' ? row.unit : undefined;
  // ⛔ A row stored as a FRACTION of one (the pricing example's NRR: 1.1 'fraction', shown as 110%). The writer stores
  // the figure as given, in the row's unit, and the user states a percent: 115 would land as 11,500%. The percent →
  // fraction conversion is the unit/frame slice's (A3); until then this path refuses, and nothing is written.
  if (unit !== undefined && FRACTION_SPELLED_UNIT.test(unit)) return refused('limit_stored_as_fraction');
  const label = typeof row.label === 'string' && row.label !== '' ? row.label : undefined;
  const frame = typeof row.value_frame === 'string' ? (row.value_frame as NonNullable<Parameters<typeof applyConstraintEditThroughAddConstraint>[0]['confirmedConstraintValueFrame']>) : undefined;
  // A2: a comparator stated on this edit must be in the row's own direction ("at most" on an "at least" limit is a
  // different limit, which this path never writes).
  if (request.stated_operator !== undefined && heldOf(request.stated_operator) !== request.operator) return refused('stated_operator_direction');
  /** The comparator the written row must state: the one the user stated now, else the row's own (kept). */
  const statedAfter = request.stated_operator ?? statedOperatorOf(row);

  // ── 4–7. the product's own writer, with the row's own unit, label and frame ─────────────────────────
  const result = await applyConstraintEditThroughAddConstraint({
    payload,
    requestId,
    persistedGraph,
    graph,
    priorFacts,
    targetId: request.node_id,
    constraintType: request.operator === '>=' ? 'at_least' : 'at_most',
    rawValue: request.raw_value,
    ...(unit !== undefined ? { unit } : {}),
    ...(label !== undefined ? { label } : {}),
    // ⭐ KEPT, NEVER RELABELLED: the row's frame, which the handler would drop for a new figure.
    ...(frame !== undefined ? { confirmedConstraintValueFrame: frame } : {}),
    // A2: only a comparator the user STATED is relayed; a new figure alone leaves the handler to keep the row's own.
    ...(request.stated_operator !== undefined ? { statedConstraintOperator: request.stated_operator } : {}),
    eventName: 'limit_edit',
    logBase,
  });
  if (result.kind !== 'mutated') return result;

  // ── 8. the written row is CHECKED against the ruling before anything is committed ─────────────────
  const written = rowsOf(result.mutatedGraph).filter((c) => c.node_id === request.node_id && c.operator === request.operator);
  const w = written[0];
  const kept = written.length === 1
    && w!.constraint_id === row.constraint_id
    && w!.value === request.raw_value
    && w!.unit === row.unit
    && w!.value_frame === row.value_frame
    && (label === undefined || w!.label === label)
    && w!.provenance === 'explicit'
    // A2: the comparator as the user stated it — kept on a new figure alone, replaced when they stated one.
    && statedOperatorOf(w!) === statedAfter
    // Every other limit is untouched.
    && rowsOf(result.mutatedGraph).length === rowsOf(persistedGraph).length;
  if (!kept) {
    log.warn({ ...logBase, event: 'v5.system_event.limit_edit.row_not_kept' }, 'limit_edit — the writer would not keep the row as ruled; refusing, nothing written');
    return refused('row_not_kept');
  }
  return result;
}
