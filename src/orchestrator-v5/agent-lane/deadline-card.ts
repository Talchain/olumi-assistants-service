import { goalDeadlineFromRecord } from '../goal-target/goal-kind.js';
import { readStatedDeadline } from '../goal-target/deadline-date.js';
import type { PendingAction } from '../session/pending-action.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import { constructionOperationId } from './runtime/build-model.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';

export interface DeadlineTurnStart {
  readonly rowId: string | null;
  readonly rows: readonly SessionTurnWithContent[];
}
/**
 * The strict pending read and the content read must identify the SAME newest non-claim row, and NO Agent answer is newer
 * than this brief's construction row. Earlier (pre-draft) Agent conversation and later system events are not an offer
 * of this card; the Agent answer that carries the offer is, so it can never be offered twice (buddy r1 P2).
 */
export function firstAgentTurnAfterDraft(start: DeadlineTurnStart | undefined, scenarioId: string, brief: string): boolean {
  if (!start || !start.rowId || brief.trim() === '') return false;
  const rows = start.rows;
  if (rows[0]?.id !== start.rowId) return false;
  const draftTurnId = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  const at = rows.findIndex(r => r.scenario_id === scenarioId && typeof r.request_hash === 'string'
    && (r.turn_id === draftTurnId && r.request_hash.startsWith('graph_registration:')
      || r.turn_class === 'direct_answer' && r.handler_id === null && r.response_emitted === true && r.user_message === brief));
  return at >= 0 && rows.slice(0, at).every(r => r.scenario_id === scenarioId && typeof r.request_hash === 'string'
    && !r.request_hash.startsWith('agent_turn:'));
}
/** Cheap pre-read gate: the newest row is itself an Agent answer, so an offer was already possible and is never repeated. */
export function newestRowIsAgentAnswer(start: DeadlineTurnStart | undefined): boolean {
  const row = start?.rows[0];
  return row !== undefined && typeof row.request_hash === 'string' && row.request_hash.startsWith('agent_turn:');
}
const plainOf = (t: string): string => t.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
const escaped = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const whole = (words: string, text: string): boolean => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped(plainOf(words))}(?=$|[^\\p{L}\\p{N}])`, 'u').test(plainOf(text));
type RecordLike = Record<string, unknown>;
const record = (v: unknown): v is RecordLike => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Conservative goal attribution, separate from phrase occurrence: ownership, intent, subject and temporal scope. */
function goalOwnsDeadline(goal: RecordLike, words: string, source: string): boolean {
  const sentences = plainOf(source).split(/[.!?\n]+/);
  const subject = plainOf(String(goal.goal_threshold_unit ?? goal.label ?? ''));
  const nouns = subject.match(/\p{L}+/gu)?.filter(w => !['at', 'month', 'months', 'per', 'the', 'a', 'level', 'surplus'].includes(w)) ?? [];
  return sentences.some((sentence) => {
    if (!whole(words, sentence) || /\b(?:rival|competitor|example|e\.g|their|they|another goal|other goal)\b/.test(sentence)) return false;
    if (/\b(?:not (?:a |the |our |my )?(?:deadline|target|goal)|duration|lasts?|takes?|course)\b/.test(sentence)) return false;
    if (/\b(?:goal|target)\b/.test(sentence) && !nouns.some(noun => whole(noun, sentence))) return false;
    const before = sentence.slice(0, sentence.indexOf(plainOf(words)));
    if (!/\b(?:we|i|us|our|my)\b/.test(before)
      || !/\b(?:stay|keep|reach|achieve|grow|reduce|increase|deadline|deliver|finish|complete)\b/.test(before)
      || !/\b(?:by|within|over|next|deadline|before|until|in)\b/.test(before)) return false;
    // A bare owned deadline refers to the sole goal. Otherwise its subject must occur in THIS goal-intent sentence: a
    // noun of the previous sentence never attributes a date to this goal (buddy r1 P1: "We have registered riders. We
    // must reach revenue of £10,000 in ten months." is revenue's date). The d2 ceiling sentence names its riders itself.
    return /\b(?:our|my) deadline\b/.test(before) || nouns.some(noun => whole(noun, sentence));
  });
}
export interface DeadlineIssueInput {
  readonly graph: unknown;
  readonly storedBrief: string | null | undefined;
  readonly typedNow: string | null;
  readonly reference: string | undefined;
  readonly toolCalls: readonly { readonly name: string }[];
  readonly mutated: boolean;
  readonly fastPath: string | undefined;
  readonly proposalOffered: boolean;
  readonly pending: readonly PendingAction[];
  readonly priorOffer: boolean;
}
/** A proposal only: immutable R, one owned goal, no existing deadline/change, and the user's verbatim words. */
export function deadlineCardToIssue(p: DeadlineIssueInput): { readonly goal_id: string; readonly words: string; readonly reference: string; readonly date: string } | undefined {
  if (p.priorOffer || p.mutated || p.fastPath === 'approve' || p.proposalOffered || p.pending.length > 0 || p.reference === undefined
    || p.toolCalls.some(c => c.name.startsWith('propose_') || c.name === 'authorise_change') || !record(p.graph) || !Array.isArray(p.graph.nodes)) return undefined;
  const goals = p.graph.nodes.filter((n): n is RecordLike => record(n) && n.kind === 'goal');
  if (goals.length !== 1) return undefined;
  const goal = goals[0]!;
  if (typeof goal.id !== 'string' || goalDeadlineFromRecord(p.graph, goal.id) !== undefined) return undefined;
  const words = typeof goal.goal_deadline_as_stated === 'string' ? goal.goal_deadline_as_stated.trim() : '';
  if (words === '' || words.length > 80) return undefined;
  const sources = [p.storedBrief, p.typedNow].filter((s): s is string => typeof s === 'string');
  if (!sources.some(s => whole(words, s)) || !sources.some(s => goalOwnsDeadline(goal, words, s))) return undefined;
  const stated = readStatedDeadline(words, p.reference);
  return stated === null ? undefined : { goal_id: goal.id, words, reference: p.reference, date: stated.date };
}
