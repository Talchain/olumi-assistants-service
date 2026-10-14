/**
 * ⭐ AN OPTION THE USER TOOK OUT IS NOT COMPARED, AND THE RUN SAYS SO (MG F1 T6; spec §3 O1; F5 I1.3).
 *
 * `option_status_edit` writes the user's word (`option_status`: `infeasible` | `removed`) and the participation it
 * means (`analysis_participation: 'retained_excluded'`). The participation guard then withholds the node from the wire
 * graph — and REFUSES the whole Run if the option is still submitted ("an exclusion that cannot be honoured").
 * So the option leaves the SUBMISSION here, before the analysable gate, and is named in the Run's own records:
 * `option_participation` (`excluded_infeasible` / `excluded_removed`) and `input_snapshot.options_not_sent`
 * (`infeasible` / `removed`), schemas 0.69.0. The analysed set and the shown set are then one set.
 *
 * Keyed ONLY on the user's own word on the option NODE (bound by id), never on a label or a missing field: an option
 * with no `option_status` is `feasible` (the contract's read-time default), exactly as before 0.69.0.
 */
type Rec = Record<string, unknown>;

export interface UserExcludedOption {
  readonly option_id: string;
  readonly label: string | null;
  readonly status: 'infeasible' | 'removed';
}

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const optionIdOf = (o: Rec): string | null =>
  typeof o.option_id === 'string' && o.option_id.length > 0 ? o.option_id : typeof o.id === 'string' && o.id.length > 0 ? o.id : null;

export function userExcludedOptions<T>(input: { readonly options: ReadonlyArray<T>; readonly graph: unknown }): {
  readonly options: ReadonlyArray<T>;
  readonly excluded: readonly UserExcludedOption[];
} {
  const nodes = isRec(input.graph) && Array.isArray(input.graph.nodes) ? input.graph.nodes.filter(isRec) : [];
  const out = new Map<string, UserExcludedOption>();
  for (const n of nodes) {
    if (n.kind !== 'option' || typeof n.id !== 'string') continue;
    if (n.option_status === 'infeasible' || n.option_status === 'removed') {
      out.set(n.id, { option_id: n.id, label: typeof n.label === 'string' ? n.label : null, status: n.option_status });
    }
  }
  if (out.size === 0) return { options: input.options, excluded: [] };
  const kept = input.options.filter((o) => { const id = isRec(o) ? optionIdOf(o) : null; return id === null || !out.has(id); });
  // Only the options this Run would otherwise have submitted are named: a status on an option the Run never saw says nothing.
  const seen = new Set(input.options.map((o) => (isRec(o) ? optionIdOf(o) : null)));
  return { options: kept, excluded: [...out.values()].filter((e) => seen.has(e.option_id)) };
}

/** The Run-record words for one exclusion (schemas 0.69.0 closed sets). */
export const PARTICIPATION_STATE_FOR = { infeasible: 'excluded_infeasible', removed: 'excluded_removed' } as const;
