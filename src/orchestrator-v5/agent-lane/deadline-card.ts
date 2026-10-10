import { goalDeadlineFromRecord } from '../goal-target/goal-kind.js';
import { readStatedDeadline } from '../goal-target/deadline-date.js';
import type { PendingAction } from '../session/pending-action.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import { constructionOperationId } from './runtime/build-model.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';

export interface DeadlineTurnStart {
  readonly rowId: string | null;
  readonly rows: readonly SessionTurnWithContent[];
  /**
   * The pending actions COMMITTED with one answer row (`readCommittedTurn`, the same path a replay uses: `readRecent` deliberately
   * omits them). Absent, or a throw / missing row, means the build turn's offers are UNKNOWN, and unknown fails closed.
   */
  readonly committedPending?: (turnId: string) => Promise<readonly unknown[] | null | undefined>;
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
  return buildAnswersSinceDraft(start, scenarioId, brief) !== undefined;
}
/**
 * The Agent answers since the draft, when they are at most the ONE answer to the turn that built it; otherwise undefined (closed).
 * The build turn is identified by its user message being the stored brief (the typed message keeps its whitespace, the stored brief
 * is trimmed), never by anything the answer SAYS: no reply prose decides this (DL github-6d, #2948 r6-r9).
 */
function buildAnswersSinceDraft(start: DeadlineTurnStart | undefined, scenarioId: string, brief: string): readonly SessionTurnWithContent[] | undefined {
  if (!start || !start.rowId || brief.trim() === '') return undefined;
  const rows = start.rows;
  if (rows[0]?.id !== start.rowId) return undefined;
  const draftTurnId = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  const at = rows.findIndex(r => r.scenario_id === scenarioId && typeof r.request_hash === 'string'
    && (r.turn_id === draftTurnId && r.request_hash.startsWith('graph_registration:')
      || r.turn_class === 'direct_answer' && r.handler_id === null && r.response_emitted === true && r.user_message === brief
        && !r.request_hash.startsWith('agent_turn:')));
  if (at < 0) return undefined;
  const newer = rows.slice(0, at);
  if (!newer.every(r => r.scenario_id === scenarioId && typeof r.request_hash === 'string')) return undefined;
  const answers = newer.filter(r => r.request_hash.startsWith('agent_turn:'));
  const builtTheDraft = (r: SessionTurnWithContent): boolean => typeof r.user_message === 'string' && r.user_message.trim() === brief.trim();
  return answers.length === 0 || (answers.length === 1 && builtTheDraft(answers[0]!)) ? answers : undefined;
}
/** One committed pending action that carries a proposal to set the goal's deadline (the `propose_goal_deadline` card's own operation). */
const carriesDeadlineProposal = (entry: unknown): boolean => {
  if (!record(entry) || !record(entry.action) || !record(entry.action.inline_patch) || !record(entry.action.inline_patch.agent_proposal)) return false;
  const ops = entry.action.inline_patch.agent_proposal.operations;
  return Array.isArray(ops) && ops.some(o => record(o) && o.op === 'set_goal_deadline');
};
/**
 * ⭐ THE STRUCTURAL SIGNAL (DL github-6d, #2948 r6-r9: the free-text "did the answer offer a date?" test was a symptom-chase).
 * The turn that built the draft already OFFERED a deadline when the pending actions committed with its answer row carry a
 * `set_goal_deadline` proposal. Only that makes the next turn's route-issued card a repeat. Nothing in the reply prose decides it, so
 * an answer that merely mentions a year, or asks anything, leaves the offer alone. A row whose pending actions cannot be read, or an
 * entry that is not a record, is UNKNOWN and fails closed (no offer). A model that already holds the goal's deadline is refused by
 * `deadlineCardToIssue` itself. No Agent build answer at all means nothing was offered.
 */
export async function buildTurnAlreadyOfferedDeadline(start: DeadlineTurnStart | undefined, scenarioId: string, brief: string): Promise<boolean> {
  const answers = buildAnswersSinceDraft(start, scenarioId, brief);
  if (answers === undefined) return true;
  if (answers.length === 0) return false;
  const read = start?.committedPending;
  if (read === undefined) return true;
  try {
    const pending = await read(answers[0]!.turn_id);
    return !Array.isArray(pending) || pending.some(entry => !record(entry) || carriesDeadlineProposal(entry));
  } catch { return true; }
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
  // The goal's own unit names its subject ("riders") — byte-for-byte the earlier rule. A unit with no letters ("%": served
  // b2ad8385, a share-of-riders goal) names none, so the goal's LABEL does, and only when the date's sentence carries TWO of
  // the label's distinct content words (4-letter stems: riders+turning for "Riders served without being turned away"), so one
  // shared word ("customers served", "the survey of riders") never attributes another quantity's date (buddy r2 P2).
  const unit = plainOf(String(goal.goal_threshold_unit ?? ''));
  const unitHasLetters = /\p{L}/u.test(unit);
  const subject = unitHasLetters ? unit : plainOf(String(goal.label ?? ''));
  const nouns = subject.match(/\p{L}+/gu)?.filter(w => !['at', 'month', 'months', 'per', 'the', 'a', 'level', 'surplus'].includes(w)) ?? [];
  const FUNCTION = ['without', 'being', 'within', 'under', 'over', 'about', 'after', 'before', 'between', 'through', 'during', 'their',
    'there', 'these', 'those', 'where', 'which', 'while', 'would', 'could', 'should'];
  const stemsOf = (text: string): string[] => [...new Set((text.match(/\p{L}+/gu) ?? []).filter(w => w.length >= 5).map(w => w.slice(0, 4)))];
  const labelStems = unitHasLetters ? [] : stemsOf(nouns.filter(w => !FUNCTION.includes(w)).join(' '));
  const ownsSubject = (sentence: string): boolean => unitHasLetters ? nouns.some(noun => whole(noun, sentence))
    : labelStems.length > 0 && labelStems.filter(stem => stemsOf(sentence).includes(stem)).length >= Math.min(2, labelStems.length);
  return sentences.some((sentence) => {
    if (!whole(words, sentence) || /\b(?:rival|competitor|example|e\.g|their|they|another goal|other goal)\b/.test(sentence)) return false;
    if (/\b(?:not (?:a |the |our |my )?(?:deadline|target|goal)|duration|lasts?|as an? (?:training )?course)\b/.test(sentence)) return false;
    if (/\b(?:goal|target)\b/.test(sentence) && !ownsSubject(sentence)) return false;
    const before = sentence.slice(0, sentence.indexOf(plainOf(words)));
    // A letterless-unit goal is a LEVEL stance (stay/keep/reach/grow …): "finish/complete/deliver" are task verbs, and a date whose own
    // clause ("…, and finish our depot renovation in ten months") carries a verb but none of the label's words belongs to that clause.
    const intent = unitHasLetters ? /\b(?:stay|keep|reach|achieve|grow|reduce|increase|deadline|deliver|finish|complete)\b/
      : /\b(?:stay|keep|reach|achieve|grow|reduce|increase|deadline)\b/;
    if (!unitHasLetters) {
      // The clause that owns the date (since the last "and" or ";", across its commas) may hold ONLY words of a level stance on this
      // goal: the speaker, a want/need, a stance verb, a ceiling/target word, time words, the label's own words, and "without anyone
      // …". ANY other word ("survey", "responses", "renovate", "depot", a number) means the clause has its own subject, so it owns its
      // own date and is refused (closed = silent, never a wrong offer; the unit-with-letters path covers the common goals).
      const ownClause = before.split(/;|\band\b/).pop() ?? '';
      const ALLOWED = new Set(['we', 'i', 'us', 'our', 'my', 'want', 'wants', 'need', 'needs', 'must', 'should', 'will', 'would', 'to', 'that', 'this', 'it', 'them',
        'stay', 'keep', 'reach', 'achieve', 'grow', 'reduce', 'increase', 'under', 'below', 'above', 'without', 'anyone', 'no', 'one', 'any', 'not',
        'ceiling', 'cap', 'limit', 'target', 'level', 'threshold', 'maximum', 'minimum', 'at', 'most', 'least',
        'over', 'the', 'next', 'within', 'in', 'for', 'by', 'end', 'of', 'during', 'about', 'around', 'roughly', 'approximately', 'another', 'coming',
        'then', 'so', 'is', 'are', 'be', 'a', 'an', 'than', 'less', 'more', 'later', 'from', 'now', 'today']);
      const words = ownClause.match(/\p{L}+/gu) ?? [];
      const labelWords = new Set(nouns.map(w => w.slice(0, 4)));
      if (/\d/.test(ownClause) || !words.every(w => ALLOWED.has(w) || labelWords.has(w.slice(0, 4)))) return false;
    }
    if (!/\b(?:we|i|us|our|my)\b/.test(before)
      || !intent.test(before)
      || !/\b(?:by|within|over|next|deadline|before|until|in)\b/.test(before)) return false;
    // A bare owned deadline refers to the sole goal. Otherwise its subject must occur in THIS goal-intent sentence: a
    // noun of the previous sentence never attributes a date to this goal (buddy r1 P1: "We have registered riders. We
    // must reach revenue of £10,000 in ten months." is revenue's date). The d2 ceiling sentence names its riders itself.
    return /\b(?:our|my) deadline\b/.test(before) || ownsSubject(sentence);
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
