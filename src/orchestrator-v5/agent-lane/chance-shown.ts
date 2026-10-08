import type { CanonicalAnalysisCell } from '../../routes/canonical-analysis-view.js';

/** The route retains each displayed cell's option identity without changing the canonical wire cell. */
export type OptionChanceCell = CanonicalAnalysisCell & { readonly option_id?: string };

/** Only a displayed figure or range licenses words about a chance, optionally for one named option. */
export function chanceShownFor(cells: readonly OptionChanceCell[], optionId?: string): boolean {
  return cells.some(cell => (cell.kind === 'figure' || cell.kind === 'range')
    && (optionId === undefined || cell.option_id === optionId));
}
