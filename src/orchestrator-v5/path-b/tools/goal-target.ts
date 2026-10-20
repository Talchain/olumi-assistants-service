/**
 * ⭐ PATH-B: A GOAL TARGET AS ONE COMPLETE CANDIDATE (C5 candidate 2; buddy AMEND 16:0x, PL 16:05). No meaning is read here:
 * the AI's declared comparator, figure, unit and stance are carried literally into the product's own target writer
 * (`applyGoalTargetEdit` behind `add_constraint`, in memory, under the stated comparator), and the existing carriers record
 * whose it is — the estate's 3-dimension pattern (agent-capabilities.ts saved-correction card):
 *  · the target figure: Olumi's reading of the binding (`threshold_source: 'cee_inference'`, the row `provenance: 'inferred'`),
 *    which every target reader shows as "the target", never "your target" (`targetNounOf`, `isOlumiSourceStamp`);
 *  · a person's words: kept as theirs beside it (`user_statements`, speaker `user`, or `unknown` for anyone else).
 * The registration of this ONE candidate is the save; `change-tools.ts` owns approval, exactly-once and the receipt.
 */
import { isDeepStrictEqual } from 'node:util';
import { PatchOperationsArraySchema } from '../../../orchestrator/patch-validation.js';
import { buildAddFactorTransaction, MAX_FACTORS_PER_ADD } from '../../routing/add-factor-transaction.js';
import { sameLabel } from '../../routing/add-option-transaction.js';
import { executeGmHeldResume } from '../../handlers/gm-held-execute.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyGoalHorizonEdit } from '../../goal-target/goal-horizon-write.js';
import { periodWords } from '../../goal-target/goal-target-basis.js';
import { readGoalRecord } from '../../goal-target/goal-record.js';
import { GOAL_TARGET_ROLE } from '../../goal-target/goal-targets-joint.js';
import { applyConstraintEditThroughAddConstraint, applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { runWithStatedGoalOperator } from '../../agent-lane/stated-goal-operator-context.js';
import { statedOperatorOf } from '../../agent-lane/limit-operator-words.js';
import { claimRecordsOn, userStatementRecord, userStatementsOn, withUserStatement } from '../../statement-door/statements.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { isOlumiSourceStamp } from '../../../cee/provenance/provenance-of.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const nodesOf = (g: Rec): Rec[] => (Array.isArray(g.nodes) ? g.nodes.filter(isRec) : []);
const rowsOf = (g: Rec): Rec[] => (Array.isArray(g.goal_constraints) ? g.goal_constraints.filter(isRec) : []);

export type Comparator = '<' | '<=' | '>' | '>=';
export interface TargetDeclaration {
  readonly goal_id: string;
  readonly comparator: Comparator;
  readonly value: number;
  readonly unit: string;
  readonly origin: 'user' | 'third_party' | 'olumi' | 'unknown';
  readonly quote: string | null;
  /** The complete line of the user's typed words holding the quote, found literally at propose time. */
  readonly said_in: string | null;
  /** When the proposal was made: the statement's `recorded_at`, so a retry builds the same candidate. */
  readonly recorded_at: string;
}

export interface JointTargetDeclaration {
  readonly goal_id: string;
  /** Missing on the approved base: these factors must retain unknown baselines on readback. */
  readonly new_quantities?: readonly string[];
  readonly links?: readonly { readonly from: string; readonly to: string; readonly sign: 'positive' | 'negative' }[];
  readonly conditions: readonly (TargetDeclaration & { readonly quantity: string; readonly source: { readonly origin: TargetDeclaration['origin']; readonly named_source: string | null } })[];
  readonly timing: { readonly months: number | null; readonly reference: 'today' | 'launch'; readonly period_kind: 'at_end' | 'over_period'; readonly deadline: string | null } | null;
}

const inclusiveOf = (c: Comparator): '>=' | '<=' => (c === '>' || c === '>=' ? '>=' : '<=');

/** The goal's statement for this target, as the existing carrier holds it (`undefined` for Olumi's own target). */
function statementOf(t: TargetDeclaration, goalLabel: string): UserStatement | undefined {
  if (t.origin === 'olumi' || t.quote === null) return undefined;
  const speaker = t.origin === 'user' ? 'user' as const : 'unknown' as const;
  return { speaker, quote: t.quote, source: t.said_in ?? t.quote, form: 'describes', subject: { quantity: goalLabel, node_id: t.goal_id },
    ...(speaker === 'user' ? { unit: t.unit } : {}), reading: 'olumi' };
}

/**
 * The ONE complete candidate: the product's writer on the read graph, then the declared source on the carriers that hold it.
 * Every other part of the saved model is checked unchanged (the writer may not alter other work on a target-only change).
 */
async function singleTargetCandidate(scenarioId: string, operationId: string, requestId: string, t: TargetDeclaration,
  graph: Rec, graphHash: string): Promise<{ readonly candidate: Rec } | { readonly refusal: string }> {
  const event = { kind: 'goal_target_edit' as const, goal_node_id: t.goal_id, constraint_type: inclusiveOf(t.comparator) === '>=' ? 'at_least' as const : 'at_most' as const,
    raw_value: t.value, unit: t.unit, base_graph_hash: graphHash };
  let res: Awaited<ReturnType<typeof applyGoalTargetEdit>>;
  try {
    res = await runWithStatedGoalOperator({ scenario_id: scenarioId, goal_node_id: t.goal_id, turn_id: operationId, operator: t.comparator },
      () => applyGoalTargetEdit({ payload: { kind: 'system_event', scenario_id: scenarioId, turn_id: operationId, stage: 'frame', event } as never,
        event: event as never, requestId, persistedGraph: graph, priorFacts: [] }));
  } catch {
    return { refusal: 'target_not_prepared' };
  }
  if (res.kind === 'base_hash_diverged') return { refusal: 'superseded' };
  if (res.kind !== 'mutated') return { refusal: res.reason };
  const candidate = JSON.parse(JSON.stringify(res.mutatedGraph)) as Rec & { nodes: unknown[] };
  const goal = nodesOf(candidate).find((n) => n.id === t.goal_id);
  const row = rowsOf(candidate).find((r) => r.node_id === t.goal_id && r.operator === inclusiveOf(t.comparator));
  if (goal === undefined || row === undefined) return { refusal: 'target_not_prepared' };
  goal.threshold_source = 'cee_inference';
  row.provenance = 'inferred';
  const others = (g: Rec) => ({ ...g, nodes: nodesOf(g).filter((n) => n.id !== t.goal_id), goal_constraints: rowsOf(g).filter((r) => r.node_id !== t.goal_id) });
  if (!isDeepStrictEqual(others(graph), others(candidate))) return { refusal: 'target_would_change_other_work' };
  const statement = statementOf(t, String(goal.label ?? t.goal_id));
  if (statement === undefined) return { candidate };
  const subject = { kind: 'goal' as const, id: t.goal_id, field: 'target' as const };
  const held = userStatementsOn(goal).filter((r) => r.field === 'target').flatMap((r) => r.statements).filter((s) => !isDeepStrictEqual(s, statement));
  const withWords = withUserStatement(candidate, userStatementRecord(subject, [...held, statement], t.recorded_at), subject);
  return withWords === undefined ? { refusal: 'target_not_prepared' } : { candidate: withWords };
}

/** The target as the saved model now holds it, and whether that is exactly the declaration on the carriers above. */
function singleTargetReadback(graph: Rec, t: TargetDeclaration): { holds: boolean; row: Rec } {
  const goal = nodesOf(graph).find((n) => n.id === t.goal_id && n.kind === 'goal');
  const rows = rowsOf(graph).filter((r) => r.node_id === t.goal_id && r.operator === inclusiveOf(t.comparator));
  const row = rows.length === 1 ? rows[0] : undefined;
  const comparator = row === undefined ? null : statedOperatorOf(row) ?? null;
  const figure = typeof row?.value === 'number' ? row.value : null;
  const olumiReading = goal !== undefined && isOlumiSourceStamp(goal.threshold_source);
  const statement = goal === undefined ? undefined : statementOf(t, String(goal.label ?? t.goal_id));
  const wordsKept = statement === undefined || userStatementsOn(goal).some((r) => r.field === 'target'
    && r.statements.some((s) => s.quote === statement.quote && s.speaker === statement.speaker && s.reading === 'olumi'));
  const holds = goal !== undefined && comparator === t.comparator && figure === t.value
    && (inclusiveOf(t.comparator) === '<=' || goal.goal_threshold_raw === t.value) && olumiReading && wordsKept;
  return { holds, row: { op: 'set_goal_target', goal_id: t.goal_id, comparator, figure, unit: typeof row?.unit === 'string' ? row.unit : null,
    target_read_as: olumiReading ? 'olumi_reading' : 'other', words_kept: statement === undefined ? null : wordsKept } };
}

/** Build the whole AND goal in memory through the existing writer; registration remains the caller's ONE CAS. */
export async function targetCandidate(scenarioId: string, operationId: string, requestId: string, t: TargetDeclaration | JointTargetDeclaration,
  graph: Rec, graphHash: string): Promise<{ readonly candidate: Rec } | { readonly refusal: string }> {
  if (!('conditions' in t)) return singleTargetCandidate(scenarioId, operationId, requestId, t, graph, graphHash);
  const ids = t.conditions.map(c => c.goal_id);
  if (new Set(ids).size !== ids.length) return { refusal: 'target_not_prepared' };
  let candidate = structuredClone(graph);
  const missing = t.conditions.filter(c => !nodesOf(graph).some(n => n.id === c.goal_id));
  // The add-factor door's name identity applies to every addition, including unlinked conditions.
  // A new id for a taken name is ambiguous: preserve the existing quantity and refuse before approval.
  if (missing.some((c, i) => nodesOf(graph).some(n => sameLabel(String(n.label ?? ''), c.quantity))
    || missing.slice(0, i).some(n => sameLabel(n.quantity, c.quantity)))) return { refusal: 'target_not_prepared' };
  const links = t.links ?? [];
  if (missing.length > MAX_FACTORS_PER_ADD || new Set(links.map(l => l.from)).size !== links.length
    || links.some(l => !missing.some(c => c.goal_id === l.from))) return { refusal: 'target_not_prepared' };
  if (missing.length > 0) {
    // Only declared causal links use the compound add-factor builder. Conditions alone add unlinked quantities.
    const built = links.length === 0 ? null : buildAddFactorTransaction({ factors: links.map(l => ({ id: l.from,
      label: missing.find(c => c.goal_id === l.from)!.quantity, link: { to_id: l.to, effect_direction: l.sign } })) }, GraphV3.parse(graph));
    if (built !== null && !built.matched) return { refusal: built.reason };
    const operations = PatchOperationsArraySchema.safeParse([
      ...missing.filter(c => !links.some(l => l.from === c.goal_id)).map(c => ({ op: 'add_node', path: c.goal_id,
        value: { id: c.goal_id, kind: 'factor', label: c.quantity, category: 'external' } })),
      ...(built?.matched ? built.proposal.operations : []),
    ]);
    if (!operations.success) return { refusal: 'target_not_prepared' };
    // The compound add's pure executor; no userToday member means no invented current value. No write occurs here.
    const added = executeGmHeldResume({ operations: operations.data, currentGraph: graph, currentGraphHash: graphHash,
      userStatedNodeIds: missing.filter(c => c.origin === 'user').map(c => c.goal_id), freshness: 'none', hasExistingAnalysis: false,
      scenarioId, turnId: operationId, requestId });
    if (added.status !== 'executed') return { refusal: 'target_not_prepared' };
    candidate = added.mutatedGraph as Rec;
  }
  // Replacing the goal's targets retires those targets only. Independent limits keep their identity and bytes.
  candidate.goal_constraints = rowsOf(candidate).filter(r => r.role !== GOAL_TARGET_ROLE
    && !(r.node_id === t.goal_id && r.deadline_metadata === undefined && (r.value_frame === undefined || r.value_frame === 'level')));
  for (const c of t.conditions) {
    const node = nodesOf(candidate).find(n => n.id === c.goal_id);
    if (node === undefined || !['goal', 'factor', 'outcome'].includes(String(node.kind))) return { refusal: 'target_not_prepared' };
    const hash = computeAnalysisAffectingGraphHash(candidate as never);
    if (hash === null) return { refusal: 'target_not_prepared' };
    if (node.kind === 'goal') {
      const built = await singleTargetCandidate(scenarioId, operationId, requestId, c, candidate, hash);
      if ('refusal' in built) return built;
      candidate = built.candidate;
    } else {
      // This is applyGoalTargetEdit's own add_constraint adapter, also used by A's non-goal target/limit path.
      const res = await applyConstraintEditThroughAddConstraint({ payload: { scenario_id: scenarioId, turn_id: operationId, stage: 'frame' },
        requestId, persistedGraph: candidate, graph: GraphV3.parse(candidate), priorFacts: [], targetId: c.goal_id,
        constraintType: inclusiveOf(c.comparator) === '>=' ? 'at_least' : 'at_most', rawValue: c.value, unit: c.unit,
        label: c.quantity, confirmedConstraintValueFrame: 'level', statedConstraintOperator: c.comparator,
        eventName: 'goal_target_edit', logBase: { scenario_id: scenarioId } });
      if (res.kind !== 'mutated') return { refusal: res.kind === 'refused' ? res.reason : 'target_not_prepared' };
      candidate = res.mutatedGraph as Rec;
    }
    const row = rowsOf(candidate).find(r => r.node_id === c.goal_id && r.operator === inclusiveOf(c.comparator));
    if (row === undefined) return { refusal: 'target_not_prepared' };
    row.role = GOAL_TARGET_ROLE;
    row.provenance = 'inferred';
    const subject = { kind: node.kind === 'goal' ? 'goal' as const : 'factor' as const, id: c.goal_id, field: 'target' as const };
    const statement = jointStatement(c, t.timing);
    const withWords = withUserStatement({ ...candidate, nodes: nodesOf(candidate) }, userStatementRecord(subject, [statement], c.recorded_at), subject);
    if (withWords === undefined) return { refusal: 'target_not_prepared' };
    candidate = withWords;
  }
  const goal = nodesOf(candidate).find(n => n.id === t.goal_id);
  if (goal === undefined) return { refusal: 'target_not_prepared' };
  if (!ids.includes(t.goal_id)) {
    // A compound goal has no scalar surrogate when the goal itself is not one of the declared quantities.
    for (const key of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_unit', 'goal_threshold_cap', 'goal_threshold_frame', 'goal_threshold_cap_provenance', 'success_threshold', 'threshold_source', 'goal_direction', 'goal_target_basis']) delete goal[key];
  }
  if (t.timing !== null) {
    if (t.timing.deadline !== null) {
      const dated = applyGoalHorizonEdit(candidate, { goal_id: t.goal_id, deadline: t.timing.deadline,
        expected_deadline: readGoalRecord(graph, t.goal_id)?.horizon?.deadline ?? null });
      if (dated.kind === 'refused') return { refusal: dated.reason };
      if (dated.kind === 'mutated') candidate = dated.mutatedGraph;
    }
    const timedGoal = nodesOf(candidate).find(n => n.id === t.goal_id)!;
    if (t.timing.months !== null) {
      timedGoal.goal_horizon_months = t.timing.months;
      if (t.timing.deadline === null && readGoalRecord(candidate, t.goal_id)?.horizon?.deadline === undefined) timedGoal.goal_horizon = { months: t.timing.months };
    }
    const primary = t.conditions.find(c => c.goal_id === t.goal_id);
    if (primary !== undefined && isRec(timedGoal.goal_target_basis)) Object.assign(timedGoal.goal_target_basis, { target_raw: primary.value,
      reference: t.timing.reference, period_kind: t.timing.period_kind, ...(t.timing.months === null ? {} : { period_months: t.timing.months }) });
  }
  return targetReadback(candidate, t).holds ? { candidate } : { refusal: 'target_not_prepared' };
}

function jointStatement(c: JointTargetDeclaration['conditions'][number], timing: JointTargetDeclaration['timing']): UserStatement {
  return { ...(c.origin === 'user' ? { speaker: 'user' as const } : { said_by: c.origin === 'third_party' ? 'party' as const : c.origin }),
    ...(c.origin === 'third_party' && c.source.named_source !== null ? { party: c.source.named_source, relayed_by: 'user' as const } : {}),
    quote: c.quote ?? c.quantity, source: c.said_in ?? c.quote ?? c.quantity, subject: { quantity: c.quantity, node_id: c.goal_id },
    form: c.comparator === '>' || c.comparator === '>=' ? 'lower_bound' : 'upper_bound',
    ...(c.comparator === '>' || c.comparator === '>=' ? { low: c.value } : { high: c.value }), unit: c.unit, stance: 'target', reading: 'olumi',
    ...(timing === null ? {} : { reference: timing.reference,
      ...(timing.months === null ? {} : { period: periodWords({ ...timing, period_months: timing.months }) }),
      ...(timing.deadline === null ? {} : { conditions: `deadline:${timing.deadline}` }) }) };
}

/** Full readback: every declared quantity, comparison, source, reference, period and deadline, never just the primary. */
export function targetReadback(graph: Rec, t: TargetDeclaration | JointTargetDeclaration): { holds: boolean; row: Rec } {
  if (!('conditions' in t)) return singleTargetReadback(graph, t);
  const conditions = t.conditions.map(c => {
    const matches = rowsOf(graph).filter(r => r.node_id === c.goal_id && r.operator === inclusiveOf(c.comparator));
    const row = matches.length === 1 ? matches[0] : undefined;
    const node = nodesOf(graph).find(n => n.id === c.goal_id);
    const words = claimRecordsOn(node).filter(r => r.field === 'target').flatMap(r => r.statements);
    const declaredLinks = (t.links ?? []).filter(l => l.from === c.goal_id);
    const addedLinks = Array.isArray(graph.edges) ? graph.edges.filter((e): e is Rec => isRec(e) && (e.from === c.goal_id || e.to === c.goal_id)) : [];
    const addedHolds = !t.new_quantities?.includes(c.goal_id) || (node?.kind === 'factor' && node.label === c.quantity
      && node.observed_state === undefined && (c.origin !== 'user' || node.provenance === 'user_set')
      && addedLinks.length === declaredLinks.length && declaredLinks.every(l => addedLinks.some(e => e.from === l.from && e.to === l.to
        && e.effect_direction === l.sign && isRec(e.strength) && typeof e.strength.mean === 'number'
        && Math.sign(e.strength.mean) === (l.sign === 'positive' ? 1 : -1))));
    const holds = addedHolds && row?.role === GOAL_TARGET_ROLE && row.provenance === 'inferred' && row.value === c.value && row.unit === c.unit
      && statedOperatorOf(row) === c.comparator && words.some(s => isDeepStrictEqual(s, jointStatement(c, t.timing)));
    return { node_id: c.goal_id, holds, comparator: row === undefined ? null : statedOperatorOf(row), figure: row?.value ?? null, unit: row?.unit ?? null };
  });
  const goal = nodesOf(graph).find(n => n.id === t.goal_id);
  const horizon = readGoalRecord(graph, t.goal_id)?.horizon;
  const timingHolds = t.timing === null || ((t.timing.months === null || (horizon?.months === t.timing.months && goal?.goal_horizon_months === t.timing.months))
    && (t.timing.deadline === null || horizon?.deadline === t.timing.deadline));
  return { holds: conditions.every(c => c.holds) && timingHolds, row: { op: 'set_goal_target', goal_id: t.goal_id, conditions, timing: t.timing, timing_kept: timingHolds } };
}
