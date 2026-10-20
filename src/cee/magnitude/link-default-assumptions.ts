import { RepairEntrySchema, type RepairEntry } from '@talchain/schemas';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** Read the admission ledger, never infer a default from a coincidentally equal number or the point's author. */
export function linkDefaultAssumptionsOf(edge: unknown, evaluated: unknown = edge): RepairEntry[] {
  const e = rec(edge), used = rec(evaluated), provenance = rec(e?.provenance);
  if (e === undefined || used === undefined || e.from !== used.from || e.to !== used.to) return [];
  const values = (link: Rec): Record<string, unknown> => ({ 'strength.std': rec(link.strength)?.std, exists_probability: link.exists_probability });
  const stored = values(e), sent = values(used);
  const ledger = provenance?.uncertainty_defaults;
  return (Array.isArray(ledger) ? ledger : []).flatMap(entry => {
    const parsed = RepairEntrySchema.safeParse(entry);
    if (!parsed.success) return [];
    const row = parsed.data;
    return Object.keys(stored).some(field => row.field_path === `edges[${e.from}::${e.to}].${field}`
      && row.before === null && typeof row.after === 'number' && Number.isFinite(row.after)
      && row.after === stored[field] && row.after === sent[field]) ? [row] : [];
  });
}

/** Descriptive facts of the existing D3 evaluator, not a probability law supplied by the person's interval. */
export interface LinkDefaultAssumptions {
  readonly status: 'Illustrative calculation — uses untested Olumi assumptions.';
  readonly origin: 'olumi';
  readonly coefficient_distribution: 'unbounded_normal';
  readonly stated_range_use: 'recorded_not_sampled_or_tail_bounds';
  readonly links: readonly { readonly from: string; readonly to: string; readonly loss: readonly RepairEntry[] }[];
}

/** Validate the stored projection without rebuilding it from today's graph. */
export function readLinkDefaultAssumptions(value: unknown): LinkDefaultAssumptions | undefined {
  const r = rec(value);
  if (r?.status !== 'Illustrative calculation — uses untested Olumi assumptions.' || r.origin !== 'olumi'
    || r.coefficient_distribution !== 'unbounded_normal' || r.stated_range_use !== 'recorded_not_sampled_or_tail_bounds'
    || !Array.isArray(r.links) || r.links.length === 0) return undefined;
  if (!r.links.every((link): link is LinkDefaultAssumptions['links'][number] => {
    const l = rec(link);
    return typeof l?.from === 'string' && typeof l.to === 'string' && Array.isArray(l.loss) && l.loss.length > 0
      && l.loss.every(entry => RepairEntrySchema.safeParse(entry).success);
  })) return undefined;
  return { status: r.status, origin: r.origin, coefficient_distribution: r.coefficient_distribution,
    stated_range_use: r.stated_range_use, links: r.links };
}
