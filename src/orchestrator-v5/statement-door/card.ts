/**
 * ⭐ SYSTEM 1: ONE card template for every user statement, the shape the AIE's three delivered cards share (6179240850 chance,
 * 6180193788 measurement and timing): "From your words: “…”. Olumi reads this as {the reading, with the details it states}.
 * {ONE question}? {each separate assumption}". Each field's reading, question and assumptions are SYSTEM 4's signed table words.
 * ONE button records what they said. Pure.
 */
import type { DoorReading } from './read.js';

/** The ONE button on a door card (#3139's, AIE 6179240850 item 3). Its words are the press when typed exactly. */
export const DOOR_APPROVE = { label: 'Record what you said', message: 'Yes, record what I said.' } as const;

export function doorCardWords(r: DoorReading): string {
  const said = [...new Set(r.statements.map((s) => s.source))].map((s) => `“${s}”`).join(' and ');
  const assumptions = r.assumptions.map((a) => a.trim()).filter((a) => a !== '');
  // A quoted sentence, or a reading, that ends its own statement takes no second full stop.
  const reading = r.reading.trim();
  return `From your words: ${said}${/[.!?…]”$/.test(said) ? '' : '.'} Olumi reads this as ${reading}${/[.!?…]$/.test(reading) ? '' : '.'} `
    + `${r.question ?? 'Record this reading?'}${assumptions.length > 0 ? ` ${assumptions.join(' ')}` : ''}`;
}

/**
 * What the Agent is told beside a door card: AIE 6179240850 item 4's note, said of any statement (AIE_TEXT_PENDING as generalised).
 */
export const DOOR_PROPOSED_NOTE = 'Show the complete card as public_label. It proposes recording the user\u2019s verified statement as Olumi reads it; '
  + 'preserve their qualifications and conditions, and distinguish any Olumi interpretation or assumption. Do not substitute a different '
  + 'subject, window or figure. Only the bound approval button records the shown change. A successful committed change then follows the '
  + 'existing automatic analysis and contextual SAME-Run coaching flow; an unconfirmed save or proposal does not. Do not issue a duplicate scientific Run.';
