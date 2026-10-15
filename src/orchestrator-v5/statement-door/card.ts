/**
 * ⭐ SYSTEM 1: ONE card template for every user statement, in the shape of the AIE's delivered card (6179240850 item 1: "From your
 * message: “…”. Olumi reads this as … . Record this reading? {the separate assumption}"); each field's reading and assumptions are
 * SYSTEM 4's signed table words. The user's complete words, Olumi's reading of them, ONE question, then every Olumi assumption it
 * rests on, and ONE button that records what they said. Pure.
 */
import type { DoorReading } from './read.js';

/** The ONE button on a door card (#3139's, AIE 6179240850 item 3). Its words are the press when typed exactly. */
export const DOOR_APPROVE = { label: 'Record what you said', message: 'Yes, record what I said.' } as const;

export function doorCardWords(r: DoorReading): string {
  const said = [...new Set(r.statements.map((s) => s.source))].map((s) => `“${s}”`).join(' and ');
  const assumptions = r.assumptions.map((a) => a.trim()).filter((a) => a !== '');
  // A quoted sentence that ends its own statement takes no second full stop after the closing mark.
  return `From your message: ${said}${/[.!?…]”$/.test(said) ? '' : '.'} Olumi reads this as ${r.reading}. Record this reading?`
    + (assumptions.length > 0 ? ` ${assumptions.join(' ')}` : '');
}

/**
 * What the Agent is told beside a door card: AIE 6179240850 item 4's note, said of any statement (AIE_TEXT_PENDING as generalised).
 */
export const DOOR_PROPOSED_NOTE = 'Show the complete card as public_label. It proposes recording the user\u2019s verified statement as Olumi reads it; '
  + 'preserve their qualifications and conditions, and distinguish any Olumi interpretation or assumption. Do not substitute a different '
  + 'subject, window or figure. Only the bound approval button records the shown change. A successful committed change then follows the '
  + 'existing automatic analysis and contextual SAME-Run coaching flow; an unconfirmed save or proposal does not. Do not issue a duplicate scientific Run.';
