/** S2b's one team-time writer, called only by the atomic batch door. TIME is sampled as stated. */
import { isDeepStrictEqual } from 'node:util';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { draftedTeamPartOf } from './event-by-date-model.js';
import { goalDeadlineOf, isShareCalendarDate } from './goal-kind.js';
import { sayDate, timeBetween } from './deadline-date.js';
import { teamShareMoments } from './event-by-date-share.js';
import { displayedPctAt } from './goal-chance-driver.js';

type Rec = Record<string, any>;
/** Bounded numeric/time grammar. One numeric range, months only; never word-form numbers. */
export const TEAM_TIME = /^(?:(?:between[ \t]{1,4}([0-9]{1,3}(?:\.[0-9]{1,2})?)[ \t]{1,4}and[ \t]{1,4}([0-9]{1,3}(?:\.[0-9]{1,2})?))|(?:(?:about|around|roughly)[ \t]{1,4})?([0-9]{1,3}(?:\.[0-9]{1,2})?)(?:[ \t]{0,4}(?:–|—|-|to)[ \t]{0,4}([0-9]{1,3}(?:\.[0-9]{1,2})?))?)[ \t]{0,4}months?$/iu;
export function readTeamTime(words: unknown): { low_months: number; high_months: number } | null {
  if (typeof words !== 'string' || words.length > 1000) return null;
  // Consume the complete duration clause. Unsupported prefixes never expose a numeric suffix.
  const expression = words.trim().replace(/[.!]$/, '').replace(/^(?:it(?:['’]ll| will)[ \t]{1,4}take|it[ \t]{1,4}(?:takes|would[ \t]{1,4}take)|the[ \t]{1,4}team[ \t]{1,4}(?:takes|needs))[ \t]{1,4}/i, '');
  const m = TEAM_TIME.exec(expression);
  if (m === null) return null;
  const low = Number(m[1] ?? m[3]), high = Number(m[2] ?? m[4] ?? m[3]);
  const amounts = findStatedAmounts(words);
  if (!(low > 0 && high >= low) || ![low, high].every(n => amounts.some(a => a.magnitude === n))) return null;
  return { low_months: low, high_months: high };
}

export interface ApprovedTeamTime {
  readonly goal_id: string;
  readonly team_id: string;
  readonly low_months: number;
  readonly high_months: number;
  readonly deadline: string;
  readonly reference_date: string;
}
export function teamObservedState(a: ApprovedTeamTime, unit: string): Rec {
  const m = teamShareMoments(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months);
  return { value: m.mean, std: m.sd, raw_value: m.mean * 100, unit, cap: 100, source: 'user_override',
    stated_time: { quantity: 'months_to_finish', low: a.low_months, high: a.high_months, unit: 'months',
      deadline: a.deadline, reference_date: a.reference_date } };
}
export function teamTimeCard(a: ApprovedTeamTime, unit: string, deliverable: string): string {
  const time = a.low_months === a.high_months ? `${a.low_months}` : `${a.low_months}–${a.high_months}`;
  const pct = displayedPctAt(teamObservedState(a, unit).value, 'whole');
  return `Use ${time} months for today's team? By ${sayDate(a.deadline)} that is about ${pct}% of ${deliverable}.`;
}
export type TeamTimeEditResult =
  | { kind: 'mutated'; mutatedGraph: Rec; handlerFacts: readonly HandlerFact[]; confirmation: string }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: string };
export function applyTeamShareEdit(graph: unknown, a: ApprovedTeamTime, expectedHash: string): TeamTimeEditResult {
  const part = draftedTeamPartOf(graph);
  if (part === null || part.goal.id !== a.goal_id || part.team.id !== a.team_id) return { kind: 'refused', reason: 'team_not_found' };
  if (![a.low_months, a.high_months].every(Number.isFinite) || a.low_months <= 0 || a.high_months < a.low_months
    || !isShareCalendarDate(a.deadline) || !isShareCalendarDate(a.reference_date)
    || timeBetween(a.reference_date, a.deadline, 'months') <= 0) return { kind: 'refused', reason: 'invalid_time' };
  if (goalDeadlineOf(part.goal) !== a.deadline) return { kind: 'refused', reason: 'deadline_changed' };
  const os = teamObservedState(a, String(part.goal.goal_threshold_unit));
  // The landed postimage itself proves an equal retry, before CAS (the first write moved the hash).
  if (isDeepStrictEqual(part.team.observed_state, os)) return { kind: 'unchanged' };
  if (computeAnalysisAffectingGraphHash(graph as never) !== expectedHash) return { kind: 'refused', reason: 'stale_graph' };
  const out = structuredClone(graph) as Rec;
  out.nodes.find((n: Rec) => n.id === a.team_id).observed_state = os;
  const fact = EditGraphHandlerFactSchema.parse({ fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: { edit_kind: 'parameter_update', status: 'applied', operations_count: 1,
      affected_entities: [{ kind: 'factor', label: part.team.label.slice(0, 120) }],
      graph_hash_before: expectedHash, graph_hash_after: computeAnalysisAffectingGraphHash(out as never),
      safe_summary: teamTimeCard(a, String(part.goal.goal_threshold_unit), part.deliverable).split('?')[0], impact: 'low', rerun_recommended: true } });
  return { kind: 'mutated', mutatedGraph: out, handlerFacts: [fact as HandlerFact], confirmation: teamTimeCard(a, String(part.goal.goal_threshold_unit), part.deliverable).split('? ')[1]! };
}
/** Only the one part's observed state can differ. */
export function teamSharePostimageIsScoped(before: unknown, after: unknown, id: string): boolean {
  const strip = (g: unknown): unknown => {
    const out = structuredClone(g) as Rec;
    if (!Array.isArray(out?.nodes)) return null;
    for (const n of out.nodes) if (n.id === id) delete n.observed_state;
    return out;
  };
  return isDeepStrictEqual(strip(before), strip(after));
}
