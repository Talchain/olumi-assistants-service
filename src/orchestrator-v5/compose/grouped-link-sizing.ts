import { linkSizing, type LinkSizing } from '../../cee/magnitude/link-sizing.js';
import { sameUnit } from '../agent-lane/reconciling-product.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const text = (v: unknown, fallback: string): string => typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;

export interface GroupedLinkSizingItem {
  readonly from: string;
  readonly to: string;
  readonly source_label: string;
  readonly target_label: string;
  readonly source_unit: string;
  readonly target_unit: string;
  readonly question: string;
  readonly sizing: LinkSizing;
  readonly estimate?: {
    readonly amount: number;
    readonly amount_unit: string;
    readonly per_source_change: number;
    readonly per_source_change_unit: string;
    readonly display: string;
  };
}

export interface GroupedLinkSizingAction {
  readonly type: 'grouped_link_sizing';
  readonly action_id: string;
  readonly label: 'Size the links Olumi needs';
  readonly links: readonly GroupedLinkSizingItem[];
}

/** The exact plain-language lines used by the terminal press and its card. */
export function groupedLinkSizingLines(action: GroupedLinkSizingAction): readonly string[] {
  return action.links.map((link) => link.estimate === undefined
    ? `${link.source_label} → ${link.target_label}: needs your figure: ${link.question}`
    : `${link.source_label} → ${link.target_label}: Olumi's reading: ${link.estimate.display}`);
}

/** Natural-unit estimate already present on the edge; never derives one from bands. */
function estimateOf(edge: Rec, sourceUnit: string, targetUnit: string): GroupedLinkSizingItem['estimate'] {
  const natural = rec(rec(edge.provenance)?.natural_effect);
  if (natural === undefined || typeof natural.amount !== 'number' || !Number.isFinite(natural.amount)
    || typeof natural.per_source_change !== 'number' || !Number.isFinite(natural.per_source_change)
    || natural.per_source_change === 0 || typeof natural.amount_unit !== 'string'
    || typeof natural.per_source_change_unit !== 'string'
    || !sameUnit(natural.amount_unit, targetUnit) || !sameUnit(natural.per_source_change_unit, sourceUnit)) return undefined;
  return {
    amount: natural.amount,
    amount_unit: natural.amount_unit,
    per_source_change: natural.per_source_change,
    per_source_change_unit: natural.per_source_change_unit,
    display: `${natural.amount} ${natural.amount_unit} per ${natural.per_source_change} ${natural.per_source_change_unit}`,
  };
}

/**
 * Lists every unsized/placeholder edge on an option-to-goal path. This is a
 * discovery helper only: admission and the writers remain the authorities.
 */
export function groupedGoalPathLinks(input: unknown): readonly GroupedLinkSizingItem[] {
  const graph = rec(input);
  if (graph === undefined || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return [];
  const nodes = graph.nodes.map(rec).filter((x): x is Rec => x !== undefined);
  const edges = graph.edges.map(rec).filter((x): x is Rec => x !== undefined && typeof x.from === 'string' && typeof x.to === 'string');
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const labels = new Map(nodes.map((n) => [String(n.id), text(n.label, String(n.id))]));
  const units = new Map(nodes.map((n) => [String(n.id), text(n.unit ?? rec(n.observed_state)?.unit, 'the model units')]));
  const goals = new Set(nodes.filter((n) => n.kind === 'goal').map((n) => n.id));
  const options = new Set(nodes.filter((n) => n.kind === 'option').map((n) => n.id));
  const reached = new Set<unknown>(options);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (reached.has(e.from) && !reached.has(e.to) && kind.get(e.to) !== 'option' && kind.get(e.to) !== 'decision') { reached.add(e.to); changed = true; }
  }
  const toGoal = new Set(goals);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (toGoal.has(e.to) && !toGoal.has(e.from)) { toGoal.add(e.from); changed = true; }
  }
  const result: GroupedLinkSizingItem[] = [];
  for (const e of edges) {
    if (!reached.has(e.from) || !reached.has(e.to) || !toGoal.has(e.from) || !toGoal.has(e.to)
      || kind.get(e.from) === 'option' || kind.get(e.to) === 'option' || kind.get(e.to) === 'decision') continue;
    const sizing = linkSizing(e);
    if (sizing !== 'placeholder' && sizing !== 'unmarked') continue;
    const sourceUnit = units.get(String(e.from)) ?? 'one change';
    const targetUnit = units.get(String(e.to)) ?? 'the target unit';
    const source = labels.get(String(e.from)) ?? String(e.from);
    const target = labels.get(String(e.to)) ?? String(e.to);
    const estimate = estimateOf(e, sourceUnit, targetUnit);
    result.push({ from: String(e.from), to: String(e.to), source_label: source, target_label: target, source_unit: sourceUnit, target_unit: targetUnit,
      question: `How much does ${target} change, in ${targetUnit}, when ${source} changes by one ${sourceUnit} per change?`, sizing,
      ...(estimate !== undefined ? { estimate } : {}) });
  }
  return result;
}

export function groupedLinkSizingAction(graph: unknown, actionId: string): GroupedLinkSizingAction | undefined {
  const links = groupedGoalPathLinks(graph);
  return links.length === 0 ? undefined : { type: 'grouped_link_sizing', action_id: actionId, label: 'Size the links Olumi needs', links };
}
