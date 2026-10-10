import { goalDeadlineFromRecord } from '../goal-target/goal-kind.js';
import { readStatedDeadline } from '../goal-target/deadline-date.js';
import type { PendingAction } from '../session/pending-action.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import { constructionOperationId } from './runtime/build-model.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';

// An offered date always carries its year, in any format ("10 August 2027", "August 10th, 2027", "10/08/2027", "2027-08-10").
const CALENDAR_DATE = /\b(?:19|20)\d{2}\b/;
/**
 * Whether an answer ASKS a question that names the deadline, in any wording or case. Sentences end at . ! ? followed by a
 * capital (so "Is your deadline 10 Aug. 2027?" stays one sentence) or at a blank line; a single newline stays inside one
 * (buddy r4 P2: "Aug." and a newline inside the question both slipped past a [^.!?\n] matcher).
 */
export function asksAboutTheDeadline(text: string): boolean {
  // An answer is an offer of the card's date when it names the deadline AND (asks about it in one sentence, or carries a calendar year
  // ANYWHERE in the answer: the date and its question may sit in separate sentences, lines or paragraphs: buddy r6-r8 P2s such as
  // "The deadline is 10 August 2027. Does that work for you?" and "Your deadline is:\n\n10 August 2027.\n\nDoes that work for you?").
  // The served build answer, which says "The model holds no deadline yet" and asks other questions, carries no year and stays the
  // build answer. A broader match only closes the offer (silent), never makes a wrong one.
  return /\bdeadline\b/i.test(text) && (CALENDAR_DATE.test(text)
    || text.split(/(?<=[.!?])\s+(?=[A-Z\u201C"\u2018(])|\n\s*\n/).some(sentence => /\bdeadline\b/i.test(sentence) && sentence.includes('?')));
}
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
  // The answer content must be READ to be judged: a null/blank/malformed assistant message cannot show it was not the offer, so
  // it fails closed (buddy r2 P2). The marker is any QUESTION that names the deadline (one sentence, ends in "?", any case or
  // wording: the card's own "Is your deadline <date> (<n> months from …)?" and a model's own "Is your deadline …?"), not prose that
  // merely says "is your deadline of ten months." (buddy r2 P3, r3 P2).
  const builtTheDraft = (r: SessionTurnWithContent): boolean => typeof r.user_message === 'string' && r.user_message.trim() === brief.trim()
    && typeof r.assistant_message === 'string' && r.assistant_message.trim() !== '' && !asksAboutTheDeadline(r.assistant_message);
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
