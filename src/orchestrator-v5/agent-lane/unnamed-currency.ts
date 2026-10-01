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

/** The placeholder word of the drafter template's currency slot ("<currency>"), as a unit head may carry it. */
const PLACEHOLDER_HEAD = /^<?currency>?$/i;

/** A template slot still unfilled anywhere in a unit ("<period>", "<item>"). */
const UNFILLED_SLOT = /<[^<>]*>/;

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
 * every other byte kept exactly: "currency/quarter" + "£" → "£/quarter"; "currency per month" + "GBP" → "GBP per month".
 * Null when there is nothing to name: `goalUnit` is not an unnamed currency, `statedHead` is empty or has a space or "/"
 * in it, or the tail still holds an unfilled template slot ("<currency>/<period>" names no period either, and "£/<period>"
 * would be stored as if it did).
 */
export function unitNamingCurrency(goalUnit: string, statedHead: string): string | null {
  if (!isUnnamedCurrencyUnit(goalUnit)) return null;
  const head = statedHead.trim();
  if (head === '' || /[\s/]/.test(head)) return null;
  const at = /^(\s*)([^\s/]+)/.exec(goalUnit);
  if (at === null) return null;
  const tail = goalUnit.slice(at[0].length);
  if (UNFILLED_SLOT.test(tail)) return null;
  return `${at[1]}${head}${tail}`;
}
