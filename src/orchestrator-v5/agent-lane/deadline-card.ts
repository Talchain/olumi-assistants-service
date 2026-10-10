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
 * The strict pending read and the content read must identify the SAME newest non-claim row, and no Agent answer is newer
 * than this brief's construction row — EXCEPT the one answer to the turn that BUILT the draft: the user's message there
 * IS the stored brief (served 08bbe2eb, scenario b2ad8385: the create turn is itself an Agent turn, so its answer row
 * is always newer than the registration row, and the offer could never fire). Earlier (pre-draft) Agent conversation and
 * later system events are not an offer of this card; the Agent answer that carries the offer is, so it can never be
 * offered twice (buddy r1 P2). A second Agent answer of any kind closes the offer.
 */
export function firstAgentTurnAfterDraft(start: DeadlineTurnStart | undefined, scenarioId: string, brief: string): boolean {
  if (!start || !start.rowId || brief.trim() === '') return false;
  const rows = start.rows;
  if (rows[0]?.id !== start.rowId) return false;
  const draftTurnId = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  const at = rows.findIndex(r => r.scenario_id === scenarioId && typeof r.request_hash === 'string'
    && (r.turn_id === draftTurnId && r.request_hash.startsWith('graph_registration:')
      || r.turn_class === 'direct_answer' && r.handler_id === null && r.response_emitted === true && r.user_message === brief
        && !r.request_hash.startsWith('agent_turn:')));
  if (at < 0) return false;
  const newer = rows.slice(0, at);
  if (!newer.every(r => r.scenario_id === scenarioId && typeof r.request_hash === 'string')) return false;
  const answers = newer.filter(r => r.request_hash.startsWith('agent_turn:'));
  // The stored brief is trimmed, the answer row keeps the message as typed (buddy r1 P2: " "+brief+"\n" never matched). An
  // answer that itself ASKS the deadline question is an offer, not the build answer (buddy r1 P2: a resent brief whose answer
  // carried the card, declined next turn, would otherwise look like the build answer and re-offer).
  const builtTheDraft = (r: SessionTurnWithContent): boolean => typeof r.user_message === 'string' && r.user_message.trim() === brief.trim()
    && !/\bis your deadline\b/i.test(r.assistant_message ?? '');
  return answers.length === 0 || (answers.length === 1 && builtTheDraft(answers[0]!));
}
/**
 * Cheap pre-read gate: more than ONE Agent answer newer than the newest construction registration is never a first
 * offer (the offer was already possible, or the card was already carried/answered), so nothing is read for it.
 */
export function moreThanOneAnswerSinceDraft(start: DeadlineTurnStart | undefined): boolean {
  const rows = start?.rows ?? [];
  const reg = rows.findIndex(r => typeof r.request_hash === 'string' && r.request_hash.startsWith('graph_registration:'));
  return (reg < 0 ? rows : rows.slice(0, reg))
    .filter(r => typeof r.request_hash === 'string' && r.request_hash.startsWith('agent_turn:')).length > 1;
}
const plainOf = (t: string): string => t.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
const escaped = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const whole = (words: string, text: string): boolean => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped(plainOf(words))}(?=$|[^\\p{L}\\p{N}])`, 'u').test(plainOf(text));
type RecordLike = Record<string, unknown>;
const record = (v: unknown): v is RecordLike => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Conservative goal attribution, separate from phrase occurrence: ownership, intent, subject and temporal scope. */
function goalOwnsDeadline(goal: RecordLike, words: string, source: string): boolean {
  const sentences = plainOf(source).split(/[.!?\n]+/);
  // The goal's own unit names its subject ("riders"); a unit with no letters ("%": served b2ad8385, a share-of-riders goal)
  // names none, so the goal's label does — minus function words, which would attribute any sentence containing "without".
  const unit = plainOf(String(goal.goal_threshold_unit ?? ''));
  const subject = /\p{L}/u.test(unit) ? unit : plainOf(String(goal.label ?? ''));
  const FUNCTION = ['at', 'month', 'months', 'per', 'the', 'a', 'level', 'surplus', 'without', 'being', 'within', 'under', 'over', 'about',
    'after', 'before', 'between', 'through', 'during', 'their', 'there', 'these', 'those', 'where', 'which', 'while', 'would', 'could', 'should'];
  const nouns = subject.match(/\p{L}+/gu)?.filter(w => !FUNCTION.includes(w) && (subject === unit || w.length >= 5)) ?? [];
  return sentences.some((sentence) => {
    if (!whole(words, sentence) || /\b(?:rival|competitor|example|e\.g|their|they|another goal|other goal)\b/.test(sentence)) return false;
    if (/\b(?:not (?:a |the |our |my )?(?:deadline|target|goal)|duration|lasts?|as an? (?:training )?course)\b/.test(sentence)) return false;
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
