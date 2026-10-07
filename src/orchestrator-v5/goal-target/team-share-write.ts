/** S2b's one team-time writer, called only by the atomic batch door. TIME is sampled as stated. */
import { isDeepStrictEqual } from 'node:util';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { draftedTeamPartOf, eventShareCarrierOf } from './event-by-date-model.js';
import { goalDeadlineOf, isShareCalendarDate } from './goal-kind.js';
import { sayDate, timeBetween } from './deadline-date.js';
import { cappedTeamShareMean, teamShareMoments } from './event-by-date-share.js';
import { displayedPctAt } from './goal-chance-driver.js';

type Rec = Record<string, any>;
/** A complete duration clause, with bounded conversational framing and unit conversion. */
const TIME_NUMBER = '(?:[0-9]{1,3}(?:\\.[0-9]{1,2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|a|an)';
export const TEAM_TIME = new RegExp(`^(?:probably[ \\t]{1,4}|(?:we|I)[ \\t]{1,4}(?:think|expect|estimate)[ \\t]{1,4}|(?:it(?:['’](?:ll|d)|[ \\t]{1,4}(?:will|would|could|should))|the[ \\t]{1,4}(?:current[ \\t]{1,4})?team)[ \\t]{1,4}(?:take|takes|need|needs)[ \\t]{1,4}|it[ \\t]{1,4}takes[ \\t]{1,4})?(?:(?:about|around|roughly|approximately)[ \\t]{1,4})?(?:between[ \\t]{1,4})?(${TIME_NUMBER})(?:[ \\t]{0,4}(?:–|—|-|to|and)[ \\t]{0,4}(${TIME_NUMBER}))?[ \\t]{1,4}(months?|weeks?|years?)(?:[ \\t]{1,4}(?:with[ \\t]{1,4}(?:the|our)[ \\t]{1,4}(?:current[ \\t]{1,4})?team|for[ \\t]{1,4}(?:the|our)[ \\t]{1,4}(?:current[ \\t]{1,4})?team|to[ \\t]{1,4}(?:finish|complete|deliver|launch)))?(?:,[ \\t]{0,4}I[ \\t]{1,4}think)?[.!?]{0,1}$`, 'iu');
const TIME_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, a: 1, an: 1 };
export function readTeamTime(words: unknown): { low_months: number; high_months: number } | null {
  if (typeof words !== 'string' || words.length > 1000) return null;
  // Consume the complete duration clause. Unsupported prefixes never expose a numeric suffix.
  const expression = words.trim();
  const m = TEAM_TIME.exec(expression);
  if (m === null) return null;
  const read = (s: string): number => TIME_WORDS[s.toLowerCase()] ?? Number(s);
  const scale = /^years?$/i.test(m[3]!) ? 12 : /^weeks?$/i.test(m[3]!) ? 12 * 7 / 365.25 : 1;
  const a = read(m[1]!) * scale, b = read(m[2] ?? m[1]!) * scale;
  if (!(a > 0 && b > 0) || !Number.isFinite(a + b)) return null;
  return { low_months: Math.min(a, b), high_months: Math.max(a, b) };
}
/** Weeks have no terminating month representation. Admit the exact conversion or its two-decimal tool rendering;
 * the writer always uses the server's unrounded conversion, never the model's number. */
export function teamTimeArgumentsMatch(words: unknown, args: { low_months: number; high_months: number }, stated: { low_months: number; high_months: number }): boolean {
  const convertedWeeks = typeof words === 'string' && /\bweeks?\b/i.test(words);
  const same = (a: number, b: number): boolean => a === b || (convertedWeeks && a === Math.round(b * 100) / 100);
  return same(args.low_months, stated.low_months) && same(args.high_months, stated.high_months);
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
  if (a.low_months === a.high_months) return { quantity: 'months_to_finish', most_likely: a.low_months,
    unit: 'months', deadline: a.deadline, reference_date: a.reference_date };
  const m = teamShareMoments(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months);
  return { value: m.mean, std: m.sd, raw_value: m.mean * 100, unit, cap: 100, source: 'cee_inference',
    stated_time: { quantity: 'months_to_finish', low: a.low_months, high: a.high_months, unit: 'months',
      deadline: a.deadline, reference_date: a.reference_date } };
}
/** Single estimates live on the held definition carrier, outside modelled numeric observed_state. */
export function teamTimeIsHeld(team: Rec, a: ApprovedTeamTime, unit: string, graph: unknown): boolean {
  return isDeepStrictEqual(a.low_months === a.high_months ? eventShareCarrierOf(graph)?.provenance.share_by_date.stated_time : team.observed_state, teamObservedState(a, unit));
}
export function teamTimeCard(a: ApprovedTeamTime, _unit: string, deliverable: string): string {
  if (a.low_months === a.high_months) return `Use about ${a.low_months} months as your most likely time with today's team? The chance stays withheld until you give the soonest and latest times.`;
  const time = a.low_months === a.high_months ? `${a.low_months}` : `${a.low_months}–${a.high_months}`;
  const pct = displayedPctAt(cappedTeamShareMean(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months), 'whole');
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
  if (teamTimeIsHeld(part.team, a, String(part.goal.goal_threshold_unit), graph)) return { kind: 'unchanged' };
  if (computeAnalysisAffectingGraphHash(graph as never) !== expectedHash) return { kind: 'refused', reason: 'stale_graph' };
  const out = structuredClone(graph) as Rec;
  const team = out.nodes.find((n: Rec) => n.id === a.team_id);
  const carrier = eventShareCarrierOf(out)!.provenance.share_by_date;
  if (a.low_months === a.high_months) { carrier.stated_time = os; delete team.observed_state; }
  else { team.observed_state = os; delete carrier.stated_time; }
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
    for (const edge of out.edges ?? []) if (edge.from === id && edge.provenance?.share_by_date?.team_id === id) delete edge.provenance.share_by_date.stated_time;
    return out;
  };
  return isDeepStrictEqual(strip(before), strip(after));
}
