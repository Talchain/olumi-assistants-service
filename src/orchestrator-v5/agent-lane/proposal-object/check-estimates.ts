/**
 * ⭐ "CHECK ESTIMATES" (DL 7 Oct, for ACTION-BAR): the host's own first call, opening the S-D panel on up to three
 * factors' CURRENT figures with no change proposed. It is one `propose_assumptions` keep per named factor, so the card is
 * the ordinary held proposal: each field shows the figure, unit and whose it is; the user edits it (approve-with-edits,
 * `edited_from:`) or confirms, and Submit lands through `authorise_change`. The capability, not this builder, decides
 * whose figure it is and what exactly is stored (ONE rule, `heldFigureOwner` + `keptFigureFor`): a figure that is not
 * Olumi's own comes back `not_keepable` and is said, never kept. Pass the result as `runAgentTurn`'s `hostFirstCall`.
 * `undefined` (nothing is opened) for 0 or more than 3 ids, or when ANY id does not name a factor holding a figure.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const CHECK_ESTIMATES_MAX_FACTORS = 3;
export const CHECK_ESTIMATES_BASIS = 'Olumi’s current estimate, for you to check';

export type CheckEstimatesCall = {
  readonly name: 'propose_assumptions';
  readonly args: { readonly assumptions: readonly { factor_label: string; value: number; unit: string; basis: string; keep: true }[] };
};

export function checkEstimatesCall(graph: unknown, factorIds: readonly string[]): CheckEstimatesCall | undefined {
  const ids = [...new Set(factorIds)];
  if (ids.length === 0 || ids.length > CHECK_ESTIMATES_MAX_FACTORS) return undefined;
  const nodes = isRec(graph) && Array.isArray(graph['nodes']) ? graph['nodes'].filter(isRec) : [];
  const assumptions: CheckEstimatesCall['args']['assumptions'][number][] = [];
  for (const id of ids) {
    const node = nodes.find((n) => n['id'] === id && n['kind'] === 'factor');
    const os = isRec(node?.['observed_state']) ? node['observed_state'] : undefined;
    if (node === undefined || typeof node['label'] !== 'string' || typeof os?.['value'] !== 'number') return undefined;
    // The figure in the user's units where one is stored; the keep itself always takes the STORED figure, never this.
    const value = typeof os['raw_value'] === 'number' ? os['raw_value'] : os['value'];
    assumptions.push({ factor_label: node['label'], value, unit: typeof os['unit'] === 'string' ? os['unit'] : '',
      basis: CHECK_ESTIMATES_BASIS, keep: true });
  }
  return { name: 'propose_assumptions', args: { assumptions } };
}
