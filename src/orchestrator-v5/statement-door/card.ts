/**
 * ⭐ SYSTEM 1: ONE card template for every user statement, AIE 6181498097 exact: "From your message: “{complete applicable
 * statement}”. Olumi proposes this reading: {subject, field, figure/form/unit/reference/window/conditions}. {Any derived
 * interpretation or separate Olumi assumption, its basis and limits}. Record this reading?" Every assumption is on the shown card
 * BEFORE the question. Each field's reading and assumptions are SYSTEM 4's signed table words. Pure.
 */
import { saidByOf, type UserStatement } from '../agent-lane/user-statements.js';
import type { DoorReading } from './read.js';
import { bindingReadingWords } from './statements.js';

/** The button for a FAITHFUL human statement write (AIE 6179240850 item 3; 6181498097). Its words are the press when typed exactly. */
export const DOOR_APPROVE = { label: 'Record what you said', message: 'Yes, record what I said.' } as const;
/** AIE 6181498097: where the written postimage adds an Olumi derivation, the button never implies the human authored it. */
export const DOOR_DERIVED_APPROVE = { label: 'Use this reading', message: 'Yes, use this reading.' } as const;

/**
 * ⭐ GATE → LABEL (change 1; GATE-TO-LABEL-DESIGN authorship invariant): the user's own words, figure and unit, all found by the host's
 * word checks. Which item they concern may still be Olumi's reading (`DoorReading.binding`): the figure stays theirs, the binding Olumi's.
 */
export const yourWords = (s: UserStatement): boolean => saidByOf(s) === 'user' && s.checks?.words_found !== false
  && s.checks?.figure_found !== false && s.checks?.unit_found !== false;

/**
 * ⭐ GATE → LABEL: whose words a statement is, in the estate's words (AIE 13:10Z templates; Codex co-design §1), for a card that quotes
 * it beside a figure: the user's own, a reported party's, an unresolved source's, or words found in no message of the user's.
 */
export function claimSourceWords(s: UserStatement): string {
  const by = saidByOf(s);
  return s.checks?.words_found === false ? `Olumi’s proposed reading — source unverified: “${s.quote}”`
    : by === 'party' ? `Reported source: ${s.party}${s.relayed_by === 'user' ? ', as relayed by you' : ''}: “${s.source}”`
      : by === 'unknown' ? `Recorded words — speaker/source unknown: “${s.source}”`
        : yourWords(s) ? `From your words: “${s.source}”` : `From your words: “${s.source}”; Olumi could not find this figure in them`;
}

/** A card that carries a label (Olumi's reading of the item, or a word check not passed): its press adopts Olumi's reading. */
export const doorCardLabelled = (r: Pick<DoorReading, 'binding' | 'statements'>): boolean => r.binding !== undefined
  || r.statements.some((s) => s.checks !== undefined);

export function doorCardWords(r: DoorReading): string {
  const said = [...new Set(r.statements.map((s) => s.source))].map((s) => `“${s}”`).join(' and ');
  // The labels, each said once, before the card's question: which item the words concern, and a figure the words do not write.
  const labels = [...(r.binding !== undefined ? [bindingReadingWords(r.label, r.binding.bound_label)] : []),
    ...(r.statements.some((s) => s.checks?.words_found !== false && s.checks?.figure_found === false)
      ? ['Olumi could not find this figure in the quoted words: it is Olumi’s reading of them, not a stated figure.'] : [])];
  const assumptions = [...r.assumptions.map((a) => a.trim()).filter((a) => a !== ''), ...labels];
  // A quoted sentence, or a reading, that ends its own statement takes no second full stop.
  const reading = r.reading.trim();
  const stop = (w: string): string => (/[.!?…]”?$/.test(w) ? '' : '.');
  const rest = `${assumptions.length > 0 ? ` ${assumptions.join(' ')}` : ''}`;
  // Words found in no message of the user's: Olumi's proposed reading, its source unverified (Codex co-design §1 exact words).
  if (r.statements.some((s) => s.checks?.words_found === false)) {
    return `Olumi’s proposed reading — source unverified: ${said}${stop(said)} Olumi proposes this reading: ${reading}${stop(reading)}${rest} Use this reading?`;
  }
  // ⭐ CLAIM RECORD (AIE 13:10Z exact templates): a party's estimate keeps its source on the card, beside Olumi's interpretation, and the
  // press approves only that interpretation. An unresolved source says so in the estate's words. The user's own words: unchanged.
  const party = r.statements.find((s) => saidByOf(s) === 'party');
  if (party !== undefined) {
    const relayed = party.relayed_by === 'user';
    return `Reported source: ${party.party}${relayed ? ', as relayed by you' : ''}. ${said}${stop(said)} Olumi’s interpretation: ${reading}${stop(reading)}${rest}`
      + ` Approval applies only this displayed model interpretation. The source remains ${party.party}${relayed ? ', as you reported it' : ''}.`;
  }
  if (r.statements.some((s) => saidByOf(s) !== 'user')) {
    return `Recorded words — speaker/source unknown: ${said}${stop(said)} Olumi proposes this reading: ${reading}${stop(reading)}${rest} Use this reading?`;
  }
  return `From your message: ${said}${/[.!?…]”$/.test(said) ? '' : '.'} Olumi proposes this reading: ${reading}${/[.!?…]$/.test(reading) ? '' : '.'}`
    + `${rest} Record this reading?`;
}

/**
 * What the Agent is told beside a door card: AIE 6179240850 item 4's note, said of any statement (AIE_TEXT_PENDING as generalised).
 */
export const DOOR_PROPOSED_NOTE = 'Show the complete card as public_label. It proposes recording the user\u2019s verified statement as Olumi reads it; '
  + 'preserve their qualifications and conditions, and distinguish any Olumi interpretation or assumption. Do not substitute a different '
  + 'subject, window or figure. Only the bound approval button records the shown change. A successful committed change then follows the '
  + 'existing automatic analysis and contextual SAME-Run coaching flow; an unconfirmed save or proposal does not. Do not issue a duplicate scientific Run.';
