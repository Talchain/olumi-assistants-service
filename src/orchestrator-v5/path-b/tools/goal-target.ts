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
import { applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { runWithStatedGoalOperator } from '../../agent-lane/stated-goal-operator-context.js';
import { statedOperatorOf } from '../../agent-lane/limit-operator-words.js';
import { userStatementRecord, userStatementsOn, withUserStatement } from '../../statement-door/statements.js';
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
export async function targetCandidate(scenarioId: string, operationId: string, requestId: string, t: TargetDeclaration,
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
export function targetReadback(graph: Rec, t: TargetDeclaration): { holds: boolean; row: Rec } {
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
