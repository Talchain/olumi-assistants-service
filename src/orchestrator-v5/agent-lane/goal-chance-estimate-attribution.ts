import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { factorValueHash, linkValueHash, valueAuthorshipOf, type GoalPathFactor, type GoalPathLink } from './turn-context/guidance-signals.js';
import { linkSizing } from '../../cee/magnitude/link-sizing.js';
import { olumiEstimatesFeedingResult } from './olumi-estimates-feeding-result.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** RC4 alone supplies the attribution stored with this Run's licensed points (the one census below, its relationships). */
export function goalChanceEstimateLinkCount(graph: unknown, optionIds?: readonly string[], goalId?: unknown): number {
  return goalChanceEstimateCounts(graph, optionIds, goalId).links;
}

/**
 * ⭐ Recovery Batch C, amendment 7 (independent check r1 item 6): a result rests on EVERY Olumi input it is computed from, not
 * only its link sizes — an estimated starting value and an Olumi option setting count too. RC4's one census
 * (`olumiEstimatesFeedingResult`) counts them, apart, so the sentence can name them. Restricted to this Run's options.
 *
 * ⛔ RE-SCOPE (DL after independent check r2, BLOCKING 4; re-scope check r1, BLOCKING 2): the census is EVERY node UPSTREAM
 * of EVERY node of the event, by ANY path — the scored goal, each other target and each included limit the Run sent
 * (`eventNodeIds`) — never only the option-lever paths into the scored goal. A factor no option sets that feeds conversion,
 * an included limit's own starting value, and an option's setting on it all count. Links: every link INTO that set (an
 * option's own link to the factor it sets is its setting, counted as one). Starting values: every node of that set but the
 * options and the scored goal (whose own level is admission's guard, amendment 7's `estimate_only`). Settings: each option's
 * own Olumi settings on that set, per option.
 */
export function goalChanceEstimateCounts(graph: unknown, optionIds?: readonly string[], goalId?: unknown,
  eventNodeIds: readonly string[] = []): {
  readonly links: number; readonly values: number;
  /** An option setting is that option's own input: counted per option, never said on another option's result. */
  readonly settingsByOption: Readonly<Record<string, number>>;
} {
  const none = { links: 0, values: 0, settingsByOption: {} };
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return none;
  const omitted = new Set(stored.nodes.map(rec).filter(n => n?.kind === 'option'
    && optionIds !== undefined && !optionIds.includes(String(n.id))).map(n => n!.id));
  const analysed = asAnalysed({ ...stored, nodes: stored.nodes.filter(n => !omitted.has(rec(n)?.id)),
    edges: Array.isArray(stored.edges) ? stored.edges.filter(e => !omitted.has(rec(e)?.from) && !omitted.has(rec(e)?.to)) : stored.edges });
  const nodes = analysed.nodes.map(rec).filter((n): n is Rec => n !== undefined && typeof n.id === 'string');
  const byId = new Map(nodes.map(n => [n.id as string, n] as const));
  const edges = (Array.isArray(analysed.edges) ? analysed.edges : []).map(rec)
    .filter((e): e is Rec => e !== undefined && typeof e.from === 'string' && typeof e.to === 'string' && byId.has(e.from) && byId.has(e.to));
  // The scored goal, as before (this Run's goal when given, else the first goal), and every other node of the event.
  const goals = nodes.filter(n => n.kind === 'goal');
  const scored = (typeof goalId === 'string' ? goals.find(n => n.id === goalId) : undefined) ?? goals[0];
  const event = [...new Set([...(scored !== undefined ? [scored.id as string] : []), ...eventNodeIds.filter(id => byId.has(id))])];
  if (event.length === 0) return none;
  // Everything upstream of the event, by any path (reverse breadth-first; the distance orders RC4's examples only).
  const distance = new Map<string, number>(event.map(id => [id, 0]));
  const into = new Map<string, string[]>();
  for (const e of edges) (into.get(e.to as string) ?? into.set(e.to as string, []).get(e.to as string)!).push(e.from as string);
  for (const queue = [...event]; queue.length > 0;) {
    const u = queue.shift()!;
    for (const v of into.get(u) ?? []) if (!distance.has(v)) { distance.set(v, distance.get(u)! + 1); queue.push(v); }
  }
  const isOption = (id: unknown): boolean => byId.get(id as string)?.kind === 'option';
  const labelOf = (id: string): string => (typeof byId.get(id)?.label === 'string' ? byId.get(id)!.label as string : id);
  const inSet = [...distance.keys()].filter(id => !isOption(id) && id !== scored?.id);
  const factors: GoalPathFactor[] = inSet.map(id => ({ factor_id: id, label: labelOf(id),
    value_authorship: valueAuthorshipOf(byId.get(id)!.observed_state), goal_distance: distance.get(id)!, value_hash: factorValueHash(byId.get(id)!) }));
  const links: GoalPathLink[] = edges.filter(e => distance.has(e.to as string) && !isOption(e.from)).map(e => ({
    link_id: `${e.from as string}->${e.to as string}`, from_label: labelOf(e.from as string), to_label: labelOf(e.to as string),
    link_sizing: linkSizing(e), option_ids: [], goal_distance: distance.get(e.to as string)! + 1, value_hash: linkValueHash(e) }));
  // An option's own setting on a node of the set: Olumi's when its cell says so (`cee_hypothesis`). The status quo mirrors
  // today's levels, which the node's own authorship already counts.
  const target = new Set(inSet);
  const optionOf = new Map<string, string>();
  const settings = nodes.flatMap((o) => {
    if (o.kind !== 'option' || o.is_baseline === true) return [];
    return Object.entries(rec(o.interventions) ?? rec(rec(o.data)?.interventions) ?? {}).flatMap(([nodeId, cell]) => {
      const source = rec(cell)?.source;
      if (!target.has(nodeId) || typeof source !== 'string') return [];
      const id = `${o.id as string}:${nodeId}`;
      optionOf.set(id, o.id as string);
      return [{ id, label: labelOf(nodeId), authorship: source === 'cee_hypothesis' ? 'olumi_estimate' as const : 'user' as const }];
    });
  });
  const census = olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(analysed),
    goalPathFactors: factors, goalPathLinks: links, optionSettings: settings });
  const valueIds = new Set(inSet);
  const settingsByOption: Record<string, number> = {};
  for (const v of census.values) {
    const option = valueIds.has(v.id) ? undefined : optionOf.get(v.id);
    if (option !== undefined) settingsByOption[option] = (settingsByOption[option] ?? 0) + 1;
  }
  return { links: census.links.length, values: census.values.filter(v => valueIds.has(v.id)).length, settingsByOption };
}

/** The words the screen says a provisional point rests on: "1 starting value, 2 option settings and 3 relationships". */
export function olumiEstimateWords(counts: { readonly links?: number; readonly values?: number; readonly settings?: number }): string | undefined {
  const part = (n: number | undefined, one: string, many: string): string[] => (n !== undefined && n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  const parts = [...part(counts.values, 'starting value', 'starting values'), ...part(counts.settings, 'option setting', 'option settings'),
    ...part(counts.links, 'relationship', 'relationships')];
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
