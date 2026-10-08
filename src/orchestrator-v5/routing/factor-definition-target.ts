/** The factor gate and stamped approval share Science's definition redirect and its exact held-carrier predicate. */
import { currentDefinitionalCarrier, endsOfGraph, heldLinkOf } from '../goal-target/held-user-links.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const labelOf = (n: Rec | undefined): string | null => (typeof n?.label === 'string' && n.label !== '' ? n.label : null);
const quote = (label: string): string => `‘${label}’`;

/** S-DEF is reached through its real held-carrier predicate, never inferred from a node's label. */
export function factorDefinitionRedirect(raw: unknown, id: string): string | undefined {
  const graph = rec(raw);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(rec).filter((n): n is Rec => n !== undefined) : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges.map(rec).filter((e): e is Rec => e !== undefined) : [];
  const n = nodes.find((x) => x.id === id);
  if (n === undefined || labelOf(n) === null) return undefined;
  const ends = endsOfGraph(raw);
  const fixed = rec(n.nonlinear_identity);
  const operands = new Set(Array.isArray(fixed?.factor_ids) ? fixed.factor_ids : []);
  const sources = edges.filter((e) => e.to === id && (operands.has(e.from)
    || (currentDefinitionalCarrier(e) !== undefined && ['definition', 'user_range'].includes(heldLinkOf(e, ends(e))?.reason ?? ''))))
    .map((e) => nodes.find((x) => x.id === e.from)).filter((x): x is Rec => x !== undefined && labelOf(x) !== null);
  // An identity can name its operands without drawing their edges.
  for (const source of nodes.filter((x) => operands.has(x.id) && labelOf(x) !== null)) {
    if (!sources.some((x) => x.id === source.id)) sources.push(source);
  }
  if (sources.length === 0) return undefined;
  return `${quote(labelOf(n)!)} is worked out from ${sources.map((x) => quote(labelOf(x)!)).join(' and ')}, so a new cause would act on one of those. Press + on one of them.`;
}
