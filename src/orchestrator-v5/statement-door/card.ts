/**
 * ⭐ SYSTEM 1: ONE card template for every user statement, AIE 6181498097 exact: "From your message: “{complete applicable
 * statement}”. Olumi proposes this reading: {subject, field, figure/form/unit/reference/window/conditions}. {Any derived
 * interpretation or separate Olumi assumption, its basis and limits}. Record this reading?" Every assumption is on the shown card
 * BEFORE the question. Each field's reading and assumptions are SYSTEM 4's signed table words. Pure.
 */
import type { DoorReading } from './read.js';

/** The button for a FAITHFUL human statement write (AIE 6179240850 item 3; 6181498097). Its words are the press when typed exactly. */
export const DOOR_APPROVE = { label: 'Record what you said', message: 'Yes, record what I said.' } as const;
/** AIE 6181498097: where the written postimage adds an Olumi derivation, the button never implies the human authored it. */
export const DOOR_DERIVED_APPROVE = { label: 'Use this reading', message: 'Yes, use this reading.' } as const;

export function doorCardWords(r: DoorReading): string {
  const said = [...new Set(r.statements.map((s) => s.source))].map((s) => `“${s}”`).join(' and ');
  const assumptions = r.assumptions.map((a) => a.trim()).filter((a) => a !== '');
  // A quoted sentence, or a reading, that ends its own statement takes no second full stop.
  const reading = r.reading.trim();
  return `From your message: ${said}${/[.!?…]”$/.test(said) ? '' : '.'} Olumi proposes this reading: ${reading}${/[.!?…]$/.test(reading) ? '' : '.'}`
    + `${assumptions.length > 0 ? ` ${assumptions.join(' ')}` : ''} Record this reading?`;
}

/**
 * What the Agent is told beside a door card: AIE 6179240850 item 4's note, said of any statement (AIE_TEXT_PENDING as generalised).
 */
export const DOOR_PROPOSED_NOTE = 'Show the complete card as public_label. It proposes recording the user\u2019s verified statement as Olumi reads it; '
  + 'preserve their qualifications and conditions, and distinguish any Olumi interpretation or assumption. Do not substitute a different '
  + 'subject, window or figure. Only the bound approval button records the shown change. A successful committed change then follows the '
  + 'existing automatic analysis and contextual SAME-Run coaching flow; an unconfirmed save or proposal does not. Do not issue a duplicate scientific Run.';
