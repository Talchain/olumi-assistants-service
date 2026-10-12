import assert from 'node:assert/strict';

/** RUN52 DISCLOSED synthetic fixture-contract migration; historical drafter bytes did not emit this receipt.
 * Only the caller's exact original sentence is attached; the public verifier still decides credit.
 */
export function withOriginalReceipt<T extends { options?: unknown }>(model: T, brief: string, quote: string,
  cells: readonly (readonly [factor: string, value: number])[]): T {
  const start = brief.indexOf(quote);
  assert.ok(start >= 0 && start === brief.lastIndexOf(quote), 'the original receipt must occur uniquely in the fixture brief');
  const result = structuredClone(model);
  if (!Array.isArray(result.options)) return result;
  for (const option of result.options) {
    if (!Array.isArray(option.interventions)) continue;
    for (const iv of option.interventions) {
      if (iv.provenance !== 'explicit' || iv.value_kind !== 'absolute' || iv.stated_evidence != null
        || !cells.some(([factor, value]) => iv.factor_label === factor && iv.value === value)) continue;
      Object.assign(iv, { stated_evidence: { quote, start, end: start + quote.length, amount_start: start,
        option_quote: quote, option_start: start, option_end: start + quote.length } });
    }
  }
  return result;
}
