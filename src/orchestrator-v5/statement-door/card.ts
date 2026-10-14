/**
 * ⭐ SYSTEM 1: ONE card template for every user statement (AIE_TEXT_PENDING: the template itself is signed once; each field's
 * reading and assumptions are SYSTEM 4's signed table words): the user's complete words, Olumi's reading of them, every Olumi
 * assumption it rests on, and ONE button that records what they said. Pure.
 */
import type { DoorReading } from './read.js';

/** The ONE button on a door card (#3139's, AIE 6179240850 item 3). Its words are the press when typed exactly. */
export const DOOR_APPROVE = { label: 'Record what you said', message: 'Yes, record what I said.' } as const;

export function doorCardWords(r: DoorReading): string {
  const said = [...new Set(r.statements.map((s) => s.source))].map((s) => `“${s}”`).join(' and ');
  const assumptions = r.assumptions.map((a) => a.trim()).filter((a) => a !== '');
  return `From your words: ${said}. Olumi reads this as ${r.reading}.${assumptions.length > 0 ? ` ${assumptions.join(' ')}` : ''} Record this reading?`;
}
