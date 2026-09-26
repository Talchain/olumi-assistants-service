/**
 * ⛔ A FIGURE IS RECORDED AS THE USER'S ONLY WHEN THE USER WROTE IT.
 *
 * Served on CEE fbb12b8 (guest witness, scenario fb2e5613; #70 5843805457): "Add an option: keep the price at £49
 * and run a win-back offer for churned customers. It reduces Monthly churn." The Agent passed `level: {value: 0}`
 * for Monthly churn to mean "not set", and one approval stored `{value: 0, unit: "percent per month", source:
 * "user_specified"}` — a 0% churn level recorded as the user's, who stated none. The tool text already said "a
 * level ONLY for a figure the user stated"; nothing enforced it, and the unit check (#1966) cannot see it (% on %).
 *
 * THE RULE: a figure the Agent attributes to the user must be PRESENT in the user's own words (`user_text`, bound
 * by the route from the conversation's user messages, never from model output), read by the repo's one scanner
 * (`findStatedAmounts`). It is a NECESSARY condition, never attestation (see that module): not present ⇒ the
 * user's claim is withdrawn; present ⇒ there are no grounds to withdraw it.
 *
 * KIND: a written amount grounds a figure only in a compatible kind of unit, read by the family classifier #1966
 * uses (`unitPhraseFamily` — `readUnit` reads "£ per month" and "GBP/month" as plain, so it would disown every
 * price level). A bare number ("59", "7 engineers") grounds any kind; "£49" grounds only a money figure (never a
 * churn level); "4%" only a percentage. A unit nobody can classify accepts any written kind.
 *
 * A written percentage also grounds its fraction ("40%" → 0.4, a share kept as 0–1), unlike the brief-extraction
 * claim `stated-amounts.ts` refuses it for: here the Agent is told to pass the factor's own units, and a share factor's
 * own units are 0–1.
 *
 * Every miss fails toward UNDER-claiming (the figure is left unset or recorded as Olumi's, and said): word-form
 * numerals ("four percent"), a figure the Agent derived ("down a point" → 4), and a magnitude written with a suffix
 * the Agent dropped (£54k vs 54).
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { unitPhraseFamily } from './unit-conflict.js';
import { isBoardEditNote } from './history-store.js';

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether `value`, in `unit`, is a figure written in `userText`. No text (or none bound) proves nothing: false. */
export function figureTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const family = unitPhraseFamily(unit);
  return findStatedAmounts(userText).some((a) => {
    if (a.kind === 'currency') return (family === null || family === 'currency') && same(a.magnitude, value);
    // "40%" is 40 on a percentage, or 0.4 on a share kept as 0–1: the Agent passes the factor's own units.
    if (a.kind === 'percent') return (family === null || family === 'percent') && (same(a.magnitude, value) || same(a.magnitude / 100, value));
    return same(a.magnitude, value);
  });
}

/**
 * Olumi's own words replayed as the user's, with the labels it quoted taken out. An approval chip's message is
 * product-authored — "Yes, add option 'Test £54 at release', link 'Choose a price' to …" (the held chip,
 * `buildGmHeldPublicCopy`) — and the click replays it as a user message, so a figure only the Agent put in a label
 * would read as written once the user approved the option. Everything between the first and last quote of a
 * "Yes, …" message goes; a user who typed "Yes, let's try £54, it's fine" loses £54 too, which fails toward
 * under-claiming, never over.
 */
function withoutEchoedLabels(text: string): string {
  if (!text.startsWith('Yes, ')) return text;
  const first = text.indexOf("'");
  const last = text.lastIndexOf("'");
  return first >= 0 && last > first ? `${text.slice(0, first)}${text.slice(last + 1)}` : text;
}

/**
 * The user's own words in this conversation: every `role: 'user'` text in the history the Agent is given, then this
 * turn's message. A figure the user gave two turns ago ("test £54 vs £59", then "add those") is still theirs.
 *
 * ⛔ PRODUCT-AUTHORED TEXT IN A USER ITEM IS NOT THE USER'S (#1978 review 5844589340 B1). The route records a board
 * edit as a `role: 'user'` note in Olumi's own narration ("Updated Tech lead hires from 0 hires to 1 hire."), so its
 * 0 grounded the served 0-level defect after any such edit; board-edit notes are skipped. The labels an approval
 * chip quotes are removed (`withoutEchoedLabels`).
 */
export function userWordsOf(history: readonly unknown[] | undefined, message: string): string {
  const said: string[] = [];
  for (const item of history ?? []) {
    const it = item as { role?: unknown; content?: unknown } | null;
    if (it?.role !== 'user' || isBoardEditNote(it)) continue;
    if (typeof it.content === 'string') { said.push(withoutEchoedLabels(it.content)); continue; }
    if (!Array.isArray(it.content)) continue;
    for (const part of it.content as { type?: unknown; text?: unknown }[]) {
      if (part?.type === 'input_text' && typeof part.text === 'string') said.push(withoutEchoedLabels(part.text));
    }
  }
  said.push(withoutEchoedLabels(message));
  return said.join('\n');
}
