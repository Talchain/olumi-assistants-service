import { RepairEntrySchema, type RepairEntry } from '@talchain/schemas';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** Read the edge or observed-level admission ledger, never infer a default from a coincidentally equal number or the point's author. */
export function linkDefaultAssumptionsOf(edge: unknown, evaluated: unknown = edge): RepairEntry[] {
  const e = rec(edge), used = rec(evaluated), provenance = rec(e?.provenance);
  if (e === undefined || used === undefined) return [];
  const node = typeof e.id === 'string' && e.from === undefined;
  if (node ? e.id !== used.id || rec(e.observed_state)?.value !== rec(used.observed_state)?.value
    || rec(e.observed_state)?.source !== rec(used.observed_state)?.source || rec(e.observed_state)?.std_source !== 'olumi' || rec(used.observed_state)?.std_source !== 'olumi'
    : e.from !== used.from || e.to !== used.to) return [];
  const path = node ? `nodes[${e.id}]` : `edges[${e.from}::${e.to}]`;
  const values = (link: Rec): Record<string, unknown> => node ? { 'observed_state.std': rec(link.observed_state)?.std }
    : { 'strength.std': rec(link.strength)?.std, exists_probability: link.exists_probability };
  const stored = values(e), sent = values(used);
  const ledger = (node ? rec(e.observed_state) : provenance)?.uncertainty_defaults;
  return (Array.isArray(ledger) ? ledger : []).flatMap(entry => {
    const parsed = RepairEntrySchema.safeParse(entry);
    if (!parsed.success) return [];
    const row = parsed.data;
    return Object.keys(stored).some(field => row.field_path === `${path}.${field}`
      && row.before === null && typeof row.after === 'number' && Number.isFinite(row.after)
      && (!node || row.after > 0) && row.after === stored[field] && row.after === sent[field]) ? [row] : [];
  });
}

/** Descriptive facts of the existing D3 evaluator, not a probability law supplied by the person's interval. */
export interface LinkDefaultAssumptions {
  readonly status: 'Illustrative calculation — uses untested Olumi assumptions.';
  readonly origin: 'olumi';
  readonly coefficient_distribution: 'unbounded_normal';
  readonly stated_range_use: 'recorded_not_sampled_or_tail_bounds';
  readonly nodes?: readonly { readonly id: string; readonly loss: readonly RepairEntry[] }[];
  readonly links: readonly { readonly from: string; readonly to: string; readonly loss: readonly RepairEntry[] }[];
}

/** Validate the stored projection without rebuilding it from today's graph. */
export function readLinkDefaultAssumptions(value: unknown): LinkDefaultAssumptions | undefined {
  const r = rec(value);
  if (r?.status !== 'Illustrative calculation — uses untested Olumi assumptions.' || r.origin !== 'olumi'
    || r.coefficient_distribution !== 'unbounded_normal' || r.stated_range_use !== 'recorded_not_sampled_or_tail_bounds'
    || !Array.isArray(r.links) || (r.links.length === 0 && (!Array.isArray(r.nodes) || r.nodes.length === 0))) return undefined;
  if (!r.links.every((link): link is LinkDefaultAssumptions['links'][number] => {
    const l = rec(link);
    return typeof l?.from === 'string' && typeof l.to === 'string' && Array.isArray(l.loss) && l.loss.length > 0
      && l.loss.every(entry => RepairEntrySchema.safeParse(entry).success);
  })) return undefined;
  if (r.nodes !== undefined && (!Array.isArray(r.nodes) || !r.nodes.every(n => {
    const node = rec(n);
    return typeof node?.id === 'string' && Array.isArray(node.loss) && node.loss.length > 0
      && node.loss.every(entry => {
        const parsed = RepairEntrySchema.safeParse(entry);
        return parsed.success && parsed.data.field_path === `nodes[${node.id}].observed_state.std`
          && parsed.data.before === null && typeof parsed.data.after === 'number' && Number.isFinite(parsed.data.after) && parsed.data.after > 0;
      });
  }))) return undefined;
  return { status: r.status, origin: r.origin, coefficient_distribution: r.coefficient_distribution,
    stated_range_use: r.stated_range_use, links: r.links, ...(r.nodes === undefined ? {} : { nodes: r.nodes }) };
}
