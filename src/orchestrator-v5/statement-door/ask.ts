/**
 * ⭐ SYSTEM 1: readiness asks are said in the SAME subject as the door's card, so every ask has its card by construction: the
 * ask carries its `DoorSubject`, and an answer to it is bound to that subject when Olumi's preceding reply said those exact words.
 * Pure.
 */
import { subjectKey, type DoorSubject } from './subject.js';

/** One readiness ask: the exact words Olumi says, the subject a statement answering it is about, and the turn Olumi said it in. */
export interface StatementAsk {
  readonly subject: DoorSubject;
  readonly words: string;
  readonly turn_id?: string;
}

/**
 * The ask ONE statement answers (SCIENCE AMEND (b), DL 23:19Z): the Agent names it by Olumi's exact words, and it binds only when
 * the route's recent asks (`DoorContext.asks`, each one Olumi actually said) hold exactly one ask with those words. A statement
 * can answer an earlier ask than the last reply's (a cohort's "the same people" answers the goal's question).
 */
export function answeredAsk(answering: string | undefined, asks: readonly StatementAsk[]): StatementAsk | undefined {
  const words = typeof answering === 'string' ? answering.trim() : '';
  if (words === '') return undefined;
  const hits = asks.filter((a) => a.words.trim() === words);
  return hits.length === 1 ? hits[0] : undefined;
}

/** The subjects whose ask Olumi's preceding reply said, exactly (one subject per key). */
export function askedSubjects(preceding: string | undefined, asks: readonly StatementAsk[]): DoorSubject[] {
  if (typeof preceding !== 'string' || preceding.trim() === '') return [];
  const seen = new Map<string, DoorSubject>();
  for (const a of asks) if (a.words.trim() !== '' && preceding.includes(a.words)) seen.set(subjectKey(a.subject), a.subject);
  return [...seen.values()];
}

/** Olumi's last reply in this conversation (its question, if it asked one), from the session's held items. */
export function precedingAssistantText(items: readonly unknown[] | undefined): string | undefined {
  for (const raw of [...(items ?? [])].reverse()) {
    const i = raw as { role?: unknown; type?: unknown; content?: unknown } | null;
    if (i?.role !== 'assistant' && !(i?.type === 'message' && i.role === undefined)) continue;
    const text = typeof i.content === 'string' ? i.content : Array.isArray(i.content)
      ? i.content.map((p: { text?: unknown }) => (typeof p.text === 'string' ? p.text : '')).join('') : '';
    if (text.trim() !== '') return text;
  }
  return undefined;
}
