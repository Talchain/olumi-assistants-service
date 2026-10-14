/**
 * ⭐ SYSTEM 1: readiness asks are said in the SAME subject as the door's card, so every ask has its card by construction: the
 * ask carries its `DoorSubject`, and an answer to it is bound to that subject when Olumi's preceding reply said those exact words.
 * Pure.
 */
import { subjectKey, type DoorSubject } from './subject.js';

/** One readiness ask: the exact words Olumi says, and the subject a statement answering it is about. */
export interface StatementAsk {
  readonly subject: DoorSubject;
  readonly words: string;
}

/** The subjects whose ask Olumi's preceding reply said, exactly (one subject per key). */
export function askedSubjects(preceding: string | undefined, asks: readonly StatementAsk[]): DoorSubject[] {
  if (typeof preceding !== 'string' || preceding.trim() === '') return [];
  const seen = new Map<string, DoorSubject>();
  for (const a of asks) if (a.words.trim() !== '' && preceding.includes(a.words)) seen.set(subjectKey(a.subject), a.subject);
  return [...seen.values()];
}
