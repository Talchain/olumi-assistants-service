import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { assembleGuidanceSignals } from './turn-context/guidance-signals.js';
import { olumiEstimatesFeedingResult } from './olumi-estimates-feeding-result.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** RC4 alone supplies the attribution stored with this Run's licensed points (the one census below, its relationships). */
export function goalChanceEstimateLinkCount(graph: unknown, optionIds?: readonly string[], goalId?: unknown): number {
  return goalChanceEstimateCounts(graph, optionIds, goalId).links;
}

/** The view's one sink: every target of the event feeds it, so "on a goal path" means "on a path to ANY target". */
const EVENT_SINK = '__goal_chance_event_targets__';

/**
 * ⭐ Recovery Batch C, amendment 7 (independent check r1 item 6): a result rests on EVERY Olumi input on this Run's goal
 * paths, not only its link sizes — an estimated factor starting value and an Olumi option setting count too. The same RC4
 * census (`olumiEstimatesFeedingResult`), fed the option settings the action state already feeds it: links, starting
 * values and settings, counted apart so the sentence can name them. Restricted to this Run's options.
 *
 * ⛔ RE-SCOPE (DL after independent check r2, BLOCKING 4): ONE census over EVERY target in the event. A joint ("at least 20
 * new customers AND conversion above 15%") rests on every input feeding ANY of its targets, so the paths are the UNION of
 * the paths to the scored goal and to each other target the Run sent (`otherTargetIds`). The shared signal reader
 * (`assembleGuidanceSignals`) scores paths to one goal; it is given one sink that every target feeds, in a view only — so a
 * link, starting value or setting that feeds the conversion target alone is counted, and a secondary target's OWN Olumi
 * starting value is too (it is a factor on that path; the scored goal's own level stays amendment 7's `estimate_only`).
 * With no other target, the paths are exactly the scored goal's, as before.
 */
export function goalChanceEstimateCounts(graph: unknown, optionIds?: readonly string[], goalId?: unknown,
  otherTargetIds: readonly string[] = []): {
  readonly links: number; readonly values: number;
  /** An option setting is that option's own input: counted per option, never said on another option's result. */
  readonly settingsByOption: Readonly<Record<string, number>>;
} {
  const none = { links: 0, values: 0, settingsByOption: {} };
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return none;
  const omitted = new Set(stored.nodes.map(rec).filter(n => n?.kind === 'option'
    && optionIds !== undefined && !optionIds.includes(String(n.id))).map(n => n!.id));
  const nodes = stored.nodes.filter(n => !omitted.has(rec(n)?.id));
  const analysed = asAnalysed({ ...stored, nodes,
    edges: Array.isArray(stored.edges) ? stored.edges.filter(e => !omitted.has(rec(e)?.from) && !omitted.has(rec(e)?.to)) : stored.edges });
  const present = new Set(analysed.nodes.map(rec).map(n => n?.id).filter((id): id is string => typeof id === 'string'));
  // The scored goal, as the shared reader chose it before (this Run's goal when given, else the first goal).
  const goals = analysed.nodes.map(rec).filter((n): n is Rec => n?.kind === 'goal' && typeof n.id === 'string');
  const scored = (typeof goalId === 'string' ? goals.find(n => n.id === goalId) : undefined) ?? goals[0];
  const targets = [...new Set([...(scored !== undefined ? [scored.id as string] : []), ...otherTargetIds.filter(id => present.has(id))])];
  if (targets.length === 0 || present.has(EVENT_SINK)) return none;
  const view = { ...analysed,
    nodes: [{ id: EVENT_SINK, kind: 'goal', label: EVENT_SINK }, ...analysed.nodes],
    edges: [...(Array.isArray(analysed.edges) ? analysed.edges : []), ...targets.map(t => ({ from: t, to: EVENT_SINK }))] };
  const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph: view,
    analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
  const factors = signals['model.goal_path_factors'];
  const pathLinks = signals['model.goal_path_links'].filter(l => !l.link_id.endsWith(`->${EVENT_SINK}`));
  const onPath = new Map(factors.map(f => [f.factor_id, f] as const));
  // An option's own setting on a goal-path factor: Olumi's when its cell says so (`cee_hypothesis`). The status quo mirrors
  // today's levels, which the factor's own authorship already counts.
  const optionOf = new Map<string, string>();
  const settings = nodes.map(rec).flatMap((o) => {
    if (o?.kind !== 'option' || typeof o.id !== 'string' || o.is_baseline === true) return [];
    return Object.entries(rec(o.interventions) ?? rec(rec(o.data)?.interventions) ?? {}).flatMap(([factorId, cell]) => {
      const f = onPath.get(factorId);
      const source = rec(cell)?.source;
      if (f === undefined || typeof source !== 'string') return [];
      const id = `${o.id as string}:${factorId}`;
      optionOf.set(id, o.id as string);
      return [{ id, label: f.label, authorship: source === 'cee_hypothesis' ? 'olumi_estimate' as const : 'user' as const }];
    });
  });
  const census = olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(analysed),
    goalPathFactors: factors, goalPathLinks: pathLinks, optionSettings: settings });
  const valueIds = new Set(factors.map(f => f.factor_id));
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
