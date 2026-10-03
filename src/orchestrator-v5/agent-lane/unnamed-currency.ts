/**
 * ⭐ AN UNNAMED CURRENCY: A UNIT WHOSE HEAD IS OUR DRAFTER SCHEMA'S OWN PLACEHOLDER (R3 F5 D1, #85 5934208404; served CEE
 * `2166aa0b`, guest 6bc6cae6; owner ruling MG; DL 380e54 constraints).
 *
 * The drafter's factor `unit` description (`runtime/build-model.ts`, the `factors[].unit` schema text) offers the template
 * "<currency>/<period>". On a brief that names no currency the drafter copies the placeholder word itself, so the saved
 * goal "quarterly revenue" held `goal_threshold_unit: "currency/quarter"` (twice on staging: 6bc6cae6 and dcd72dc3). That
 * word is a token of OUR schema, never a reading of the user's words: the unit is money, and its currency is ABSENT.
 *
 * ⛔ STRUCTURAL ONLY. This module reads only a unit WE stored, against OUR template's placeholder word. It never reads the
 * user's text and never names a currency itself: the currency that replaces the placeholder comes from the caller (the
 * level card's typed `unit`, which the level door's own words rule grounds in what the user wrote).
 */
import { unitPhraseHead } from './unit-conflict.js';
import { ratePeriodWord } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

/** The placeholder word of the drafter template's currency slot ("<currency>"), as a unit head may carry it. */
const PLACEHOLDER_HEAD = /^<?currency>?$/i;

/**
 * The template's own money form and nothing else: the placeholder head, one "/", one word (CEE #2468 P2). The word must then
 * be a period the estate folds (`ratePeriodWord`); "<period>" is not one, so an unfilled slot names nothing.
 */
const TEMPLATE_FORM = /^(<currency>|currency)\/([^\s/]+)$/i;

/**
 * Is this unit our template's money unit with NO currency named: its head (`unitPhraseHead`, the leading token before a
 * space or "/") is the placeholder word "currency" or "<currency>", any case, with any tail ("currency/quarter",
 * "Currency per month", "<currency>/<period>", "currency")? Never true for a named currency ("GBP per quarter",
 * "£/quarter") or for a word that merely contains it ("cryptocurrency", "currencies").
 */
export function isUnnamedCurrencyUnit(unit: unknown): boolean {
  const head = unitPhraseHead(unit);
  return head !== null && PLACEHOLDER_HEAD.test(head);
}

/**
 * The unnamed-currency `goalUnit` with its placeholder head replaced by `statedHead` (the currency the caller was given),
 * the "/" and the period kept byte for byte: "currency/quarter" + "£" → "£/quarter"; "<currency>/month" + "GBP" →
 * "GBP/month". ⛔ ONLY the template's own forms (CEE #2468 P2, CODEX_CLI_OVERFLOW: "currency (USD)/quarter" was stored as
 * "£ (USD)/quarter", and "currency per year per quarter" with both periods). Null for anything else: another tail
 * ("currency per month", "currency (USD)/quarter", "currency/fortnightly"), no period (a bare "currency"), an unfilled slot
 * ("currency/<period>", "<currency>/<period>"), or a `statedHead` that is empty or holds a space or "/".
 */
export function unitNamingCurrency(goalUnit: string, statedHead: string): string | null {
  const form = TEMPLATE_FORM.exec(goalUnit);
  if (form === null || ratePeriodWord(form[2]!) === null) return null;
  const head = statedHead.trim();
  if (head === '' || /[\s/]/.test(head)) return null;
  return `${head}/${form[2]}`;
}

/**
 * The period of an EXACT validated template unit (`currency/<period>` or `<currency>/<period>`, the period one the estate
 * folds), else null. "currency (USD)/quarter", "currency per month", a bare "currency" and "<currency>/<period>" are all null.
 */
export function templatePeriod(unit: unknown): string | null {
  if (typeof unit !== 'string') return null;
  const form = TEMPLATE_FORM.exec(unit);
  return form === null ? null : ratePeriodWord(form[2]!);
}

/**
 * ⛔ A UNIT THE GOAL ALREADY HOLDS (CEE #2468 P1, CODEX_CLI_OVERFLOW: a user's level in "USD/quarter" beside the target's
 * "currency/quarter" was overwritten by a £ card): the first unit on the goal's own level (`observed_state.unit`) or on a
 * limit row on the goal (`goal_constraints[].unit` joined by `node_id`) that is anything but the goal's OWN placeholder.
 * ⛔ EXACT TEMPLATES ONLY (overflow round 2, 5936050145 P1): a held unit is exempt only when it is an exact validated
 * template (`templatePeriod`) naming the SAME period as the goal's own template unit. "currency (USD)/quarter" — a
 * placeholder head with a currency in its tail — once passed on its head alone and was replaced by "£/quarter"; so was a
 * held template in ANOTHER period. Null when there is none. Reads only what WE stored; called at proposal AND at apply.
 */
export function unitAlreadyOnGoal(
  goal: { readonly id?: unknown; readonly observed_state?: unknown },
  rawGraph: unknown,
  goalUnit: unknown,
): string | null {
  const goalPeriod = templatePeriod(goalUnit);
  const rows = (rawGraph as { goal_constraints?: unknown } | null | undefined)?.goal_constraints;
  const units = [
    (goal.observed_state as { unit?: unknown } | null | undefined)?.unit,
    ...(Array.isArray(rows) ? rows : [])
      .filter((r) => (r as { node_id?: unknown } | null)?.node_id === goal.id)
      .map((r) => (r as { unit?: unknown }).unit),
  ];
  for (const u of units) {
    if (typeof u !== 'string' || u.trim() === '') continue;
    const exempt = goalPeriod !== null && templatePeriod(u) === goalPeriod;
    if (!exempt) return u;
  }
  return null;
}
