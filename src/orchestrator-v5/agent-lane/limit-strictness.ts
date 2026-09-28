/**
 * ⭐ A LIMIT IS AS STRICT AS THE USER'S OWN WORD FOR IT (served journey E, DL pj-x3 final 5864154474: PJ-E-A2 STABLE FAIL).
 *
 * "…while keeping annual salary spend under £400k" registered `operator: "<="` with NO `operator_as_stated` in 3 of 3
 * runs, so every surface said "at most £400,000": the drafter wrote "<=", as the build prompt tells it to for a spend cap
 * ("a budget, cost or spend cap is an upper bound"). Journey A's "under 4%" kept its "<" only because that drafter wrote
 * it. Whether a limit is strict was the drafter's reading, never the user's.
 *
 * THE RULE, grounded in the typed figure (never an open word list over the brief): find where the user WROTE the limit's
 * own figure (`figureTheUserWrote`, on each written amount alone), and read the comparator written right before it.
 *   · "under", "below", "less than", "fewer than", "lower than" → strict upper (`operator_as_stated: "<"`);
 *     "over", "above", "more than", "greater than" → strict lower (`">"`);
 *   · "at most", "no more than", "not more than", "up to", "maximum", "max" → non-strict upper; "at least",
 *     "no less than", "not less than", "minimum", "min" → non-strict lower: no `operator_as_stated` (a drafter's
 *     strict "<" on "at most £400k" is not the user's).
 * Only a word on the limit's OWN side counts ("under" never touches a ">=" limit), and only one answer: two writings of
 * the figure that disagree, or none with a word before it, leave the drafter's reading as it was. The store's `operator`
 * never changes (PLoT and ISL receive "<=" / ">=" either way); only what every surface SAYS does. Pure.
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { figureTheUserWrote } from './stated-by-user.js';

type Side = 'upper' | 'lower';
type Strictness = { readonly side: Side; readonly strict: boolean };

/** The comparator written right before a figure, longest phrases first; an optional "of" before the figure. */
const COMPARATOR_BEFORE = /(?:^|[^\p{L}])(no more than|not more than|no less than|not less than|less than|fewer than|lower than|more than|greater than|at most|at least|up to|under|below|over|above|maximum|minimum|max|min)(?:\s+of)?\s*$/iu;
const WORD: Readonly<Record<string, Strictness>> = {
  'under': { side: 'upper', strict: true }, 'below': { side: 'upper', strict: true },
  'less than': { side: 'upper', strict: true }, 'fewer than': { side: 'upper', strict: true },
  'lower than': { side: 'upper', strict: true },
  'over': { side: 'lower', strict: true }, 'above': { side: 'lower', strict: true },
  'more than': { side: 'lower', strict: true }, 'greater than': { side: 'lower', strict: true },
  'at most': { side: 'upper', strict: false }, 'no more than': { side: 'upper', strict: false },
  'not more than': { side: 'upper', strict: false }, 'up to': { side: 'upper', strict: false },
  'maximum': { side: 'upper', strict: false }, 'max': { side: 'upper', strict: false },
  'at least': { side: 'lower', strict: false }, 'no less than': { side: 'lower', strict: false },
  'not less than': { side: 'lower', strict: false }, 'minimum': { side: 'lower', strict: false },
  'min': { side: 'lower', strict: false },
};

interface LimitRow {
  readonly operator: string;
  readonly operator_as_stated?: string;
  readonly value: number;
  readonly unit?: string;
  readonly provenance?: string;
  readonly provenance_unit_normalised?: { readonly original_value: number; readonly original_unit: string };
}

/** The user's own strictness for one limit, or null when the brief does not say it once, unambiguously, on its side. */
export function statedStrictness(row: LimitRow, brief: string | null | undefined): boolean | null {
  if (typeof brief !== 'string' || brief.length === 0) return null;
  const side: Side | null = row.operator === '<=' ? 'upper' : row.operator === '>=' ? 'lower' : null;
  if (side === null) return null;
  const value = row.provenance_unit_normalised?.original_value ?? row.value;
  const unit = row.provenance_unit_normalised?.original_unit ?? row.unit;
  const said = new Set<boolean>();
  for (const a of findStatedAmounts(brief)) {
    if (typeof a.index !== 'number' || !figureTheUserWrote(value, unit, a.matchedText)) continue;
    const word = COMPARATOR_BEFORE.exec(brief.slice(Math.max(0, a.index - 32), a.index))?.[1]?.toLowerCase().replace(/\s+/g, ' ');
    const reading = word === undefined ? undefined : WORD[word];
    if (reading !== undefined && reading.side === side) said.add(reading.strict);
  }
  return said.size === 1 ? [...said][0]! : null;
}

/** Each limit the user stated, with `operator_as_stated` as the user's own word says it; every other row unchanged. */
export function attestLimitStrictness<R extends LimitRow>(rows: readonly R[], brief: string | null | undefined): R[] {
  return rows.map((row) => {
    if (row.provenance !== 'explicit') return row;
    const strict = statedStrictness(row, brief);
    if (strict === null) return row;
    const asStated = row.operator === '<=' ? '<' : '>';
    if (strict) return row.operator_as_stated === asStated ? row : { ...row, operator_as_stated: asStated };
    if (row.operator_as_stated === undefined) return row;
    const { operator_as_stated: _dropped, ...rest } = row;
    return rest as R;
  });
}
