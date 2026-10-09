import { readUnitParts } from '../../agent-lane/same-unit.js';
import { statedOperatorOf } from '../../agent-lane/limit-operator-words.js';

/**
 * The stored-row → PLoT wire boundary (S7 A1, Science §(ae)): the ONE place a stored limit becomes an engine row.
 * Kept out of run-analysis.ts, whose handler-ownership guard forbids arithmetic there. Admission stores the quantity unit on the row; no node label or unit is used.
 * Inclusive limits retain their value. Strict continuous limits use the same threshold with today's inclusive wire.
 * Strict counts exclude the threshold: integer <N uses N−1 and >N uses N+1; non-integer <N uses floor(N), >N ceil(N).
 * The stated comparator is withheld only from this copy; stored rows and their displayed limits are unchanged.
 */
export function engineConstraint(row: Record<string, unknown>): Record<string, unknown> {
  const { operator_as_stated: _stated, ...wire } = row;
  const stated = statedOperatorOf(row);
  if (stated !== '<' && stated !== '>') return wire;
  wire.operator = stated === '<' ? '<=' : '>=';
  if (readUnitParts(row.unit)?.kind === 'count' && typeof row.value === 'number' && Number.isFinite(row.value)) {
    wire.value = stated === '<'
      ? (Number.isInteger(row.value) ? row.value - 1 : Math.floor(row.value))
      : (Number.isInteger(row.value) ? row.value + 1 : Math.ceil(row.value));
  }
  return wire;
}
