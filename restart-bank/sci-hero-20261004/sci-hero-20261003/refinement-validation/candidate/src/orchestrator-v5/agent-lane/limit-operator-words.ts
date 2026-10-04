/**
 * The comparator vocabulary a limit is SAID in, and the comparator a stored row states — a LEAF module: no imports.
 *
 * Split out of `admit-constraint.ts` (which re-exports all three, so its importers are unchanged) because
 * `format-confirmation.ts` needs only these, and `admit-constraint.ts` reads `GoalConstraintSchema` at load: through
 * that import every test that mocks `schemas/assist.js` without it failed to load (`cee.unified-pipeline.stage-4`,
 * `repair.contract`; staging red from #2186, #72 5863059333).
 */

export type CandidateOperator = '>=' | '<=' | '>' | '<';

/** The words a limit's comparator is said in, to the user and to the Agent's model. One vocabulary, never restated. */
export const LIMIT_OPERATOR_WORDS: Readonly<Record<CandidateOperator, string>> = {
  '>=': 'at least', '<=': 'at most', '>': 'more than', '<': 'less than',
};

/**
 * The comparator a STORED row states: its `operator_as_stated` when that is the strict twin of its held `operator`
 * (`<` beside `<=`, `>` beside `>=`), otherwise the held `operator`. A stamp that contradicts the held comparator is
 * never said. `undefined` for a row with no readable operator.
 */
export function statedOperatorOf(row: { readonly operator?: unknown; readonly operator_as_stated?: unknown }): CandidateOperator | undefined {
  const held = row.operator;
  if (held !== '<=' && held !== '>=') return undefined;
  if (held === '<=' && row.operator_as_stated === '<') return '<';
  if (held === '>=' && row.operator_as_stated === '>') return '>';
  return held;
}
