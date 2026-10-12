import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { assembleGuidanceSignals } from './turn-context/guidance-signals.js';
import { olumiEstimatesFeedingResult } from './olumi-estimates-feeding-result.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** RC4 alone supplies the attribution stored with this Run's licensed points. */
export function goalChanceEstimateLinkCount(graph: unknown, optionIds?: readonly string[], goalId?: unknown): number {
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return 0;
  const omitted = new Set(stored.nodes.map(rec).filter(n => n?.kind === 'option'
    && optionIds !== undefined && !optionIds.includes(String(n.id))).map(n => n!.id));
  const nodes = stored.nodes.filter(n => !omitted.has(rec(n)?.id));
  // The shared signal reader uses the first goal; place this Run's scored goal there.
  if (typeof goalId === 'string') nodes.sort((a, b) => Number(rec(b)?.id === goalId) - Number(rec(a)?.id === goalId));
  const analysed = asAnalysed({ ...stored, nodes,
    edges: Array.isArray(stored.edges) ? stored.edges.filter(e => !omitted.has(rec(e)?.from) && !omitted.has(rec(e)?.to)) : stored.edges });
  const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph: analysed,
    analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
  return olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(analysed),
    goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] }).links.length;
}

/**
 * ⭐ Recovery Batch C, amendment 7 (independent check r1 item 6): a result rests on EVERY Olumi input on this Run's goal
 * paths, not only its link sizes — an estimated factor starting value and an Olumi option setting count too. The same RC4
 * census (`olumiEstimatesFeedingResult`), fed the option settings the action state already feeds it: links, starting
 * values and settings, counted apart so the sentence can name them. Restricted to this Run's options and scored goal.
 */
export function goalChanceEstimateCounts(graph: unknown, optionIds?: readonly string[], goalId?: unknown): {
  readonly links: number; readonly values: number;
  /** An option setting is that option's own input: counted per option, never said on another option's result. */
  readonly settingsByOption: Readonly<Record<string, number>>;
} {
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return { links: 0, values: 0, settingsByOption: {} };
  const omitted = new Set(stored.nodes.map(rec).filter(n => n?.kind === 'option'
    && optionIds !== undefined && !optionIds.includes(String(n.id))).map(n => n!.id));
  const nodes = stored.nodes.filter(n => !omitted.has(rec(n)?.id));
  if (typeof goalId === 'string') nodes.sort((a, b) => Number(rec(b)?.id === goalId) - Number(rec(a)?.id === goalId));
  const analysed = asAnalysed({ ...stored, nodes,
    edges: Array.isArray(stored.edges) ? stored.edges.filter(e => !omitted.has(rec(e)?.from) && !omitted.has(rec(e)?.to)) : stored.edges });
  const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph: analysed,
    analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
  const factors = signals['model.goal_path_factors'];
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
    goalPathFactors: factors, goalPathLinks: signals['model.goal_path_links'], optionSettings: settings });
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
